"""FRONTIER — modular clothing pipeline for Blender (Project Frontier / Hyper FPS).

Run inside the character rig file (hyperfps_character_rigged_V.9+.blend):
    W = {}; exec(open('<repo>/games/frontline/tools/blender/frontier_wear.py').read(), W)

What it gives
  * REGIONS / region_of / bake_regions  — the body-mask regions (must match shared/cosmetics.js REGIONS)
  * garment                             — a garment shell grown from body regions (same skin weights as the skin under it)
  * skin_like_body                      — copy skin weights onto any mesh from the nearest body surface (pockets, straps …)
  * attach_to_bone                      — rigid accessory parented to an existing bone (Head, Chest, BackWeaponSocket …)
  * check_wearable                      — the rules of docs/CHARACTER_CUSTOMIZATION.md (bones, weights, budget, materials)
  * export_wearable                     — GLB with the armature + the item only (no animations, attributes on)

Rules (short):  never make another skeleton, never move the rest pose, weight only deform bones, max 4 influences,
material names = colour slots (fabric fabric2 leather metal accent team core), no textures.
"""
import bpy, bmesh, math, os
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

TP_SKEL, FP_SKEL = 'HyperFPS_Skeleton', 'Viewmodel_Skeleton'
TP_BODY, FP_BODY = 'Body_Mesh', 'Viewmodel_Mesh'

# ---------------------------------------------------------------- body regions
# index = bit number in the game's mask (shared/cosmetics.js REGIONS has the same order)
REGIONS = ['head', 'neck', 'chest', 'abdomen', 'pelvis',
           'shoulder_l', 'upperarm_l', 'forearm_l', 'hand_l', 'thigh_l', 'shin_l', 'foot_l',
           'shoulder_r', 'upperarm_r', 'forearm_r', 'hand_r', 'thigh_r', 'shin_r', 'foot_r']
SLOT_COLORS = ['fabric', 'fabric2', 'leather', 'metal', 'accent', 'team', 'core']


def region_of(bone):
    """deform bone name -> region name"""
    side = 'l' if bone.startswith('Left') else 'r' if bone.startswith('Right') else ''
    for key, r in (('Thumb', 'hand'), ('Index', 'hand'), ('Middle', 'hand'), ('Ring', 'hand'), ('Little', 'hand'), ('Hand', 'hand'),
                   ('ForeArm', 'forearm'), ('UpperArm', 'upperarm'), ('Shoulder', 'shoulder'),
                   ('UpperLeg', 'thigh'), ('LowerLeg', 'shin'), ('Foot', 'foot'), ('Toe', 'foot')):
        if key in bone and side: return f'{r}_{side}'
    if 'Head' in bone: return 'head'
    if 'Neck' in bone: return 'neck'
    if 'Chest' in bone: return 'chest'          # Chest, ViewmodelChest
    if 'Spine' in bone: return 'abdomen'
    return 'pelvis'


def vertex_regions(obj):
    """region index per vertex: the bone with the largest weight; a vertex group MASK_<region> (weight > 0.5) overrides it"""
    vg = {g.index: g.name for g in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        over = [vg[g.group][5:] for g in v.groups if vg[g.group].startswith('MASK_') and g.weight > 0.5 and vg[g.group][5:] in REGIONS]
        if over: out.append(REGIONS.index(over[0])); continue
        best = max((g for g in v.groups if not vg[g.group].startswith('MASK_')), key=lambda g: g.weight, default=None)
        out.append(REGIONS.index(region_of(vg[best.group])) if best else REGIONS.index('pelvis'))
    return out


def bake_regions(obj):
    """write the _REGION point attribute (float) — glTF exports it as _REGION, three.js reads geometry.attributes._region"""
    reg = vertex_regions(obj)
    a = obj.data.attributes.get('_REGION') or obj.data.attributes.new('_REGION', 'FLOAT', 'POINT')
    a.data.foreach_set('value', [float(r) for r in reg])
    return {REGIONS[i]: reg.count(i) for i in range(len(REGIONS)) if reg.count(i)}


# ---------------------------------------------------------------- helpers
def collection(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c)
    return c


def slot_material(slot, color=(0.2, 0.2, 0.2), rough=0.8, metal=0.0):
    """colour-slot material (name = slot). The game re-colours by slot; these values are the Blender preview / defaults"""
    m = bpy.data.materials.get(slot) or bpy.data.materials.new(slot)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*color, 1)
    return m


def hex_rgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)   # sRGB -> linear


class BodyRef:
    """rest-pose body surface: KD tree (nearest vertex), BVH (nearest surface), per-vertex weights and regions"""
    def __init__(self, body):
        from mathutils.bvhtree import BVHTree
        self.obj = body; mw = body.matrix_world
        self.co = [mw @ v.co for v in body.data.vertices]
        self.no = [(mw.to_3x3() @ v.normal).normalized() for v in body.data.vertices]
        self.kd = KDTree(len(self.co))
        for i, p in enumerate(self.co): self.kd.insert(p, i)
        self.kd.balance()
        self.bvh = BVHTree.FromPolygons(self.co, [tuple(p.vertices) for p in body.data.polygons])
        self.groups = {g.index: g.name for g in body.vertex_groups}
        self.weights = [{self.groups[g.group]: g.weight for g in v.groups if g.weight > 1e-4 and not self.groups[g.group].startswith('MASK_')} for v in body.data.vertices]
        self.region = vertex_regions(body)

    def nearest(self, p, k=1):
        return self.kd.find_n(p, k) if k > 1 else self.kd.find(p)

    def blend_weights(self, p, k=3):
        """inverse-distance blend of the k nearest body vertices' weights -> {group: w} (max 4, normalised)"""
        acc = {}
        hits = self.kd.find_n(p, k)
        for co, i, d in hits:
            w = 1.0 / max(d, 1e-4)
            for g, x in self.weights[i].items(): acc[g] = acc.get(g, 0) + x * w
        top = sorted(acc.items(), key=lambda t: -t[1])[:4]
        s = sum(x for _, x in top) or 1
        return {g: x / s for g, x in top}

    def signed_dist(self, p):
        loc, n, i, d = self.bvh.find_nearest(p, 1.0)
        if loc is None: return 1.0, None, None
        return (p - loc).dot(n), loc, n


def set_weights(bm, dl, v, weights, group_index):
    dv = v[dl]; dv.clear()
    for g, w in weights.items():
        if g in group_index: dv[group_index[g]] = w


def ensure_groups(obj, names):
    for n in names:
        if n not in obj.vertex_groups: obj.vertex_groups.new(name=n)
    return {g.name: g.index for g in obj.vertex_groups}


# ---------------------------------------------------------------- garment shell
def ensure_clearance(obj, ref, min_d, pred=None):
    """push garment vertices out along the body normal until they are min_d from the rest body (pred(world_pos) limits it)"""
    mw = obj.matrix_world; inv = mw.inverted(); n = 0
    for v in obj.data.vertices:
        p = mw @ v.co
        if pred and not pred(p): continue
        d, loc, nrm = ref.signed_dist(p)
        if loc is not None and d < min_d:
            v.co = inv @ (loc + nrm * min_d); n += 1
    return n


def assign_material(obj, slot, pred):
    """faces whose world centre/normal satisfy pred(centre, normal) get material `slot` (added if missing)"""
    mats = [m.name for m in obj.data.materials]
    if slot not in mats: obj.data.materials.append(bpy.data.materials[slot]); mats.append(slot)
    idx = mats.index(slot); mw = obj.matrix_world; n = 0
    for f in obj.data.polygons:
        if pred(mw @ f.center, (mw.to_3x3() @ f.normal).normalized()): f.material_index = idx; n += 1
    return n


def raise_faces(obj, pred, height, slot=None):
    """extrude the faces matching pred(centre, normal) outward by `height` (pads, panels). weights follow the source verts"""
    mw = obj.matrix_world
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.faces.ensure_lookup_table()
    faces = [f for f in bm.faces if pred(mw @ f.calc_center_median(), (mw.to_3x3() @ f.normal).normalized())]
    if not faces: bm.free(); return 0
    mats = [m.name for m in obj.data.materials]
    if slot and slot not in mats: obj.data.materials.append(bpy.data.materials[slot]); mats.append(slot)
    res = bmesh.ops.extrude_face_region(bm, geom=faces)
    new_v = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
    new_f = [g for g in res['geom'] if isinstance(g, bmesh.types.BMFace)]
    for v in new_v: v.co += v.normal * height
    if slot:
        for f in new_f: f.material_index = mats.index(slot)
    bmesh.ops.delete(bm, geom=faces, context='FACES_ONLY')
    bm.normal_update(); bm.to_mesh(obj.data); bm.free()
    return len(new_f)


def hem(obj, depth=0.004, slot=None, ref=None):
    """turn every open border inward by `depth` (toward the body) so the cloth shows a thickness instead of a paper edge.
    With `ref` (BodyRef) the fold goes straight toward the skin (no teeth on decimated borders)"""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    mw = obj.matrix_world; inv = mw.inverted()
    edges = [e for e in bm.edges if e.is_boundary]
    if not edges: bm.free(); return 0
    mats = [m.name for m in obj.data.materials]
    if slot and slot not in mats: obj.data.materials.append(bpy.data.materials[slot]); mats.append(slot)
    norms = {v: v.normal.copy() for e in edges for v in e.verts}
    res = bmesh.ops.extrude_edge_only(bm, edges=edges)
    for g in res['geom']:
        if isinstance(g, bmesh.types.BMVert):
            src = [e.other_vert(g) for e in g.link_edges if e.other_vert(g) in norms]
            if not src: continue
            if ref is not None:
                p = mw @ src[0].co; d, loc, n = ref.signed_dist(p)
                g.co = inv @ (p - n * min(depth, max(d - 0.0015, 0.0))) if loc is not None else g.co - norms[src[0]] * depth
            else:
                g.co -= norms[src[0]] * depth
        if slot and isinstance(g, bmesh.types.BMFace): g.material_index = mats.index(slot)
    bm.normal_update(); bm.to_mesh(obj.data); bm.free()
    return len(edges)


def add_box(obj, ref, center, axes, half, slot, bevel=0.0, segs=1, rigid=False):
    """a (bevelled) box on the garment: pockets, buckles, straps. axes = (x, y, z) world unit vectors, half = half sizes.
    skinned garments: every new vertex gets the blended weights of the nearest body skin"""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    dl = bm.verts.layers.deform.verify()
    gi = {g.name: g.index for g in obj.vertex_groups}
    inv = obj.matrix_world.inverted()
    before = set(bm.verts)
    ret = bmesh.ops.create_cube(bm, size=1.0)
    vs = ret['verts']
    ax, ay, az = [Vector(a).normalized() for a in axes]
    for v in vs:
        p = Vector(center) + ax * (v.co.x * 2 * half[0]) + ay * (v.co.y * 2 * half[1]) + az * (v.co.z * 2 * half[2])
        v.co = inv @ p
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list({e for v in vs for e in v.link_edges}), offset=bevel, segments=segs, affect='EDGES', profile=0.5)
    mats = [m.name for m in obj.data.materials]
    if slot not in mats: obj.data.materials.append(bpy.data.materials[slot]); mats.append(slot)
    new = [v for v in bm.verts if v not in before]
    for f in bm.faces:
        if all(v in new for v in f.verts): f.material_index = mats.index(slot); f.smooth = False
    if not rigid:
        for v in new: set_weights(bm, dl, v, ref.blend_weights(obj.matrix_world @ v.co), gi)
    bm.normal_update(); bm.to_mesh(obj.data); bm.free()
    return len(new)


def ribbon(obj, ref, pts, width, thick, slot, up=None, rigid=False):
    """a strap along world points `pts` (each with the surface normal from the body), width x thick"""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    dl = bm.verts.layers.deform.verify()
    gi = {g.name: g.index for g in obj.vertex_groups}
    inv = obj.matrix_world.inverted()
    mats = [m.name for m in obj.data.materials]
    if slot not in mats: obj.data.materials.append(bpy.data.materials[slot]); mats.append(slot)
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        d, loc, n = ref.signed_dist(p)
        n = (n or Vector((0, 0, 1))) if up is None else Vector(up)
        side = t.cross(n).normalized(); n = side.cross(t).normalized()
        ring = []
        for sx, sz in ((-1, 0), (1, 0), (1, 1), (-1, 1)):
            q = p + side * (sx * width / 2) + n * (sz * thick)
            v = bm.verts.new(inv @ q)
            if not rigid: set_weights(bm, dl, v, ref.blend_weights(q), gi)
            ring.append(v)
        rings.append(ring)
    faces = []
    for a, b in zip(rings, rings[1:]):
        for k in range(4):
            faces.append(bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k])))
    faces.append(bm.faces.new(list(reversed(rings[0])))); faces.append(bm.faces.new(rings[-1]))
    for f in faces: f.material_index = mats.index(slot); f.smooth = False
    bm.normal_update(); bm.to_mesh(obj.data); bm.free()
    return len(faces)


def decimate_to(obj, max_tris, symmetric=True):
    """collapse-decimate to a triangle budget (vertex groups are interpolated). Call before binding (no armature modifier)"""
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris <= max_tris: return tris
    md = obj.modifiers.new('Decimate', 'DECIMATE'); md.ratio = max_tris / tris
    md.use_symmetry = symmetric; md.symmetry_axis = 'X'
    obj.modifiers.move(len(obj.modifiers) - 1, 0)
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
        bpy.ops.object.modifier_apply(modifier=md.name)
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def bone_frame(arm, name):
    """world rest frame of a bone: head, tail, unit axes x, y (along the bone), z"""
    b = arm.data.bones[name]; m = arm.matrix_world @ b.matrix_local
    return dict(h=arm.matrix_world @ b.head_local, t=arm.matrix_world @ b.tail_local,
                x=m.col[0].xyz.normalized(), y=m.col[1].xyz.normalized(), z=m.col[2].xyz.normalized())


def along(p, bf):
    """(t, r): t = 0 at the bone head, 1 at the tail (unclamped), r = distance from the bone line"""
    d = bf['t'] - bf['h']; L = d.length; u = d / L
    t = (p - bf['h']).dot(u)
    return t / L, (p - (bf['h'] + u * t)).length


def garment(body, ref, regions, name, offset_fn, margin=2, cuts=(), max_tris=None, smooth=0, coll=None, symmetric=True, min_clear=0.003,
            base=None, paint=(), smooth_pred=None, seams=()):
    """The garment pipeline.
    1 copy the body, keep the faces of `regions` (+ `margin` edge rings past their border)
    2 decimate to `max_tris`
    3 cut clean hems with planes: cuts = [(world point, world normal[, near, radius])], the side the normal points to is removed
    4 rebuild every vertex as  nearest body surface point + normal * offset_fn(point, region)  (no stacking errors)
    5 optional smoothing, then a clearance pass so nothing ends closer than `min_clear` to the skin
    Vertex groups come along from the body (bisect/decimate interpolate them), so the shell deforms like the skin."""
    want = {REGIONS.index(r) for r in regions}
    reg = vertex_regions(body)
    o = body.copy(); o.data = body.data.copy(); o.name = name; o.data.name = name
    for m in list(o.modifiers): o.modifiers.remove(m)
    o.parent = None; o.matrix_world = body.matrix_world.copy()
    (coll or bpy.context.scene.collection).objects.link(o)
    for k in [g.name for g in o.vertex_groups if g.name.startswith('MASK_')]: o.vertex_groups.remove(o.vertex_groups[k])
    if '_REGION' in o.data.attributes: o.data.attributes.remove(o.data.attributes['_REGION'])
    mw = o.matrix_world; inv = mw.inverted()
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
    sel = {v.index for v in bm.verts if reg[v.index] in want}
    for _ in range(margin):
        grow = set()
        for i in sel:
            for e in bm.verts[i].link_edges: grow.add(e.other_vert(bm.verts[i]).index)
        sel |= grow
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in sel], context='VERTS')
    bm.to_mesh(o.data); bm.free()
    o.data.materials.clear()
    if max_tris: decimate_to(o, max_tris, symmetric)      # decimate first: the hem cuts below then stay straight
    bm = bmesh.new(); bm.from_mesh(o.data)
    for cut in cuts:
        co, no = cut[0], cut[1]
        lco = inv @ Vector(co); lno = (inv.to_3x3() @ Vector(no)).normalized()
        if len(cut) > 2:                              # (co, no, near, radius): only cut geometry within radius of near
            near, rad = inv @ Vector(cut[2]), cut[3]
            vs = {v for v in bm.verts if (v.co - near).length < rad}
            geom = list(vs) + [e for e in bm.edges if all(v in vs for v in e.verts)] + [f for f in bm.faces if all(v in vs for v in f.verts)]
        else:
            geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=lco, plane_no=lno, clear_outer=True, dist=1e-5)
    # drop loose bits left by the cuts (keep the biggest islands only if tiny)
    bm.verts.ensure_lookup_table()
    loose = [v for v in bm.verts if not v.link_faces]
    if loose: bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(o.data); bm.free()
    def place():
        for v in o.data.vertices:
            p = mw @ v.co
            loc, n, i, d = ref.bvh.find_nearest(p, 0.2)
            if loc is None: continue
            co, vi, dd = ref.kd.find(loc)
            v.co = inv @ (loc + n * offset_fn(loc, REGIONS[ref.region[vi]]))
    place()
    if smooth:
        bm = bmesh.new(); bm.from_mesh(o.data)
        for _ in range(smooth):
            vs = [v for v in bm.verts if not v.is_boundary and (smooth_pred is None or smooth_pred(mw @ v.co))]
            bmesh.ops.smooth_vert(bm, verts=vs, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bm.to_mesh(o.data); bm.free()
        ensure_clearance(o, ref, min_clear)
    if smooth: reweight(o, ref)              # smoothing slid vertices over other skin: take that skin's weights
    for f in o.data.polygons: f.use_smooth = True
    # 6 seams: straight panel borders cut into the (decimated) shell, then the panels are painted by face centre
    for sm in seams: seam(o, *sm)
    if base:
        o.data.materials.append(bpy.data.materials[base])
        for slot, pred in paint: assign_material(o, slot, pred)
    return o


def reweight(o, ref, k=4):
    """every vertex gets the blended weights of the skin right under it (nearest surface point -> k nearest body verts)"""
    mw = o.matrix_world
    gi = ensure_groups(o, {g for w in ref.weights for g in w})
    bm = bmesh.new(); bm.from_mesh(o.data); dl = bm.verts.layers.deform.verify()
    for v in bm.verts:
        p = mw @ v.co
        loc, n, i, d = ref.bvh.find_nearest(p, 0.3)
        set_weights(bm, dl, v, ref.blend_weights(loc if loc is not None else p, k), gi)
    bm.to_mesh(o.data); bm.free()


def seam(o, co, no, near=None, rad=None):
    """cut an edge loop into the mesh along a world plane (optionally only within rad of near): panel borders, bands"""
    mw = o.matrix_world; inv = mw.inverted()
    bm = bmesh.new(); bm.from_mesh(o.data)
    lco = inv @ Vector(co); lno = (inv.to_3x3() @ Vector(no)).normalized()
    if near is not None:
        nl = inv @ Vector(near)
        vs = {v for v in bm.verts if (v.co - nl).length < rad}
        geom = list(vs) + [e for e in bm.edges if all(v in vs for v in e.verts)] + [f for f in bm.faces if all(v in vs for v in f.verts)]
    else:
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=lco, plane_no=lno, clear_outer=False, clear_inner=False, dist=1e-5)
    bm.to_mesh(o.data); bm.free()


def normalize_weights(obj, limit=4):
    """deform bones only, max `limit` influences, sum 1"""
    arm = next((m.object for m in obj.modifiers if m.type == 'ARMATURE'), None)
    deform = {b.name for b in arm.data.bones if b.use_deform} if arm else None
    vg = {g.index: g.name for g in obj.vertex_groups}
    for v in obj.data.vertices:
        gs = [(g.group, g.weight) for g in v.groups if deform is None or vg[g.group] in deform]
        for g in list(v.groups):
            if deform is not None and vg[g.group] not in deform: obj.vertex_groups[g.group].remove([v.index])
        gs.sort(key=lambda t: -t[1]); keep = gs[:limit]; s = sum(w for _, w in keep) or 1
        for gidx, w in gs[limit:]: obj.vertex_groups[gidx].remove([v.index])
        for gidx, w in keep: obj.vertex_groups[gidx].add([v.index], w / s, 'REPLACE')


def bind_to(obj, arm):
    """skinned garment: parent to the armature with one Armature modifier"""
    for m in list(obj.modifiers):
        if m.type == 'ARMATURE': obj.modifiers.remove(m)
    obj.parent = arm; obj.matrix_parent_inverse = arm.matrix_world.inverted()
    md = obj.modifiers.new('Armature', 'ARMATURE'); md.object = arm
    return obj


def attach_to_bone(obj, arm, bone):
    """rigid accessory: parent to an existing bone, keeping the rest-pose world placement"""
    mw = obj.matrix_world.copy()
    pos = arm.data.pose_position; arm.data.pose_position = 'REST'; bpy.context.view_layer.update()
    obj.parent = arm; obj.parent_type = 'BONE'; obj.parent_bone = bone
    obj.matrix_world = mw
    arm.data.pose_position = pos; bpy.context.view_layer.update()
    return obj


# ---------------------------------------------------------------- checks + export
BUDGET = {'upper': 5000, 'lower': 4000, 'head': 2500, 'hair': 2500, 'hands': 2000, 'feet': 2000, 'back': 2500, 'waist': 2500, 'acc': 1000, 'fp': 3500}


def check_wearable(objs, slot, fp=False):
    """docs/CHARACTER_CUSTOMIZATION.md rules -> list of (level, text)"""
    out = []
    arm_name = FP_SKEL if fp else TP_SKEL
    tris = 0
    for o in objs:
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
        bad_mat = [m.name for m in o.data.materials if m and m.name.split('.')[0] not in SLOT_COLORS + ['hair']]
        if bad_mat: out.append(('fail', f'{o.name}: material names must be colour slots: {bad_mat}'))
        if any(m and m.node_tree and any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes) for m in o.data.materials): out.append(('warn', f'{o.name}: textures are not used'))
        if o.parent_type == 'BONE':
            if o.parent is None or o.parent.name != arm_name: out.append(('fail', f'{o.name}: rigid item must be bone-parented to {arm_name}'))
            continue
        arm = next((m.object for m in o.modifiers if m.type == 'ARMATURE'), None)
        if not arm or arm.name != arm_name: out.append(('fail', f'{o.name}: Armature modifier must use {arm_name}')); continue
        deform = {b.name for b in arm.data.bones if b.use_deform}
        vg = {g.index: g.name for g in o.vertex_groups}
        none = over = nondef = unnorm = 0
        for v in o.data.vertices:
            gs = [g for g in v.groups if g.weight > 1e-4]
            if not gs: none += 1
            if len(gs) > 4: over += 1
            if any(vg[g.group] not in deform for g in gs): nondef += 1
            if gs and abs(sum(g.weight for g in gs) - 1) > 0.01: unnorm += 1
        for n, t in ((none, 'vertices without weights'), (over, 'vertices with > 4 bones'), (nondef, 'vertices weighted to non-deform bones (sockets)'), (unnorm, 'vertices whose weights do not sum to 1')):
            if n: out.append(('fail', f'{o.name}: {n} {t}'))
    cap = BUDGET['fp'] if fp else BUDGET.get(slot, 2500)
    out.append(('ok' if tris <= cap else 'fail', f'triangles {tris} / {cap}'))
    return out, tris


def export_wearable(objs, path, fp=False):
    """GLB: the armature (joints, same order as the body) + these objects. No animations, custom attributes on"""
    arm = bpy.data.objects[FP_SKEL if fp else TP_SKEL]
    saved = (arm.location.copy(), arm.data.pose_position, arm.animation_data.action if arm.animation_data else None)
    if fp: arm.location = (0, 0, 0)
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects: o.select_set(False)
    arm.hide_set(False); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    for o in objs: o.hide_set(False); o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_skins=True, export_def_bones=False,
                              export_yup=True, export_apply=False, export_materials='EXPORT', export_animations=False,
                              export_attributes=True, export_cameras=False, export_lights=False, export_all_influences=False)
    arm.location, arm.data.pose_position = saved[0], saved[1]
    bpy.context.view_layer.update()
    return os.path.getsize(path)
