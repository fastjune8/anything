"""FRONTIER — garment production pipeline helpers for Blender (check, prepare, export).

This file does NOT build clothing. It assists garments that are MODELED BY HAND (or by any DCC) on top of the approved
rig: it inspects them, runs the rules of docs/GARMENT_ASSET_SPEC.md, helps with weights, and exports a GLB the game accepts.
The old procedural generator (tools/blender/frontier_wear.py `garment`) is untouched and still usable.

Run inside the character rig file (hyperfps_character_rigged_V.9+.blend):

    G = {}; exec(open('<repo>/games/frontline/tools/blender/garment_pipeline.py', encoding='utf-8').read(), G)
    G['init']('<repo>/games/frontline')                    # loads frontier_wear.py as G['W']
    G['inspect_scene']()                                   # what is in the file
    r = G['check_garment'](obj, 'upper')                   # every rule; r['issues'] is [(level, text)], level ok/warn/fail
    G['deform_test'](obj, 'upper')                         # pose the rig, measure body penetration and stretching
    G['export_garment']([obj], 'tactical_jacket_002', 'upper', version=1, out_dir='<repo>/games/frontline/content/wearables')

Never overwrites an existing GLB (version numbers only go up). Every function except the explicit
`ensure_structure`, `weights_from_body`, `join_pieces` and `export_garment` only reads the scene.
"""
import bpy, bmesh, math, os, re, json, struct
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

W = None                                   # frontier_wear.py namespace (set by init)
TP_SKEL, FP_SKEL = 'HyperFPS_Skeleton', 'Viewmodel_Skeleton'
TP_BODY, FP_BODY = 'Body_Mesh', 'Viewmodel_Mesh'
SLOT_COLORS = ['fabric', 'fabric2', 'leather', 'metal', 'accent', 'team', 'core', 'hair']
SLOTS = ['head', 'hair', 'upper', 'lower', 'hands', 'feet', 'back', 'waist', 'acc1', 'acc2']
BUDGET = {'upper': 5000, 'lower': 4000, 'head': 2500, 'hair': 2500, 'hands': 2000, 'feet': 2000, 'back': 2500, 'waist': 2500, 'acc1': 1000, 'acc2': 1000, 'fp': 3500}
ID_RE = re.compile(r'^[a-z][a-z0-9]*(_[a-z0-9]+)*_\d{3}(_fp)?$')        # tactical_jacket_001 / tactical_jacket_001_fp
HS_RE = re.compile(r'^[a-z][a-z0-9_]*\.hs\.[a-z0-9_]+$')               # <item id>.hs.<part>  hard-surface piece, joined at export
MIN_CLEAR, MAX_STRETCH = 0.003, 2.5                                      # metres / ratio


def init(game_dir):
    """load the shared body-region / weight tools next to this file's repo"""
    global W
    p = os.path.join(game_dir, 'tools', 'blender', 'frontier_wear.py')
    W = {}
    exec(compile(open(p, encoding='utf-8').read(), p, 'exec'), W)
    return True


def _skel(fp): return bpy.data.objects[FP_SKEL if fp else TP_SKEL]
def _body(fp): return bpy.data.objects[FP_BODY if fp else TP_BODY]
def _tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)


class rest_pose:
    """with rest_pose(arm): ... — rest pose (no action), restored afterwards"""
    def __init__(self, arm): self.arm = arm
    def __enter__(self):
        a = self.arm; self.saved = (a.data.pose_position, a.animation_data.action if a.animation_data else None)
        a.data.pose_position = 'REST'; bpy.context.view_layer.update(); return a
    def __exit__(self, *e):
        self.arm.data.pose_position = self.saved[0]; bpy.context.view_layer.update()


def _bvh(obj, depsgraph=None):
    """BVH of an object's (optionally evaluated) surface in world space"""
    if depsgraph:
        ev = obj.evaluated_get(depsgraph); me = ev.to_mesh(); mw = ev.matrix_world.copy()
    else:
        me = obj.data; mw = obj.matrix_world
    pts = [mw @ v.co for v in me.vertices]; polys = [tuple(p.vertices) for p in me.polygons]
    if depsgraph: ev.to_mesh_clear()
    return BVHTree.FromPolygons(pts, polys), pts


def _world_pts(obj, depsgraph=None):
    if depsgraph:
        ev = obj.evaluated_get(depsgraph); me = ev.to_mesh(); pts = [ev.matrix_world @ v.co for v in me.vertices]; ev.to_mesh_clear(); return pts
    return [obj.matrix_world @ v.co for v in obj.data.vertices]


# ------------------------------------------------------------------ 1. read-only inspection
def inspect_scene():
    """table of every object: type, parent, collections, modifiers, groups, tris, materials, UV (read-only)"""
    rows = []
    for o in bpy.data.objects:
        if o.type == 'EMPTY' and not o.children: continue
        r = {'name': o.name, 'type': o.type, 'parent': o.parent.name if o.parent else None, 'parent_type': o.parent_type if o.parent else None,
             'parent_bone': o.parent_bone or None, 'collections': [c.name for c in o.users_collection]}
        if o.type == 'MESH':
            r.update(verts=len(o.data.vertices), tris=_tris(o), modifiers=[(m.type, getattr(m, 'object', None) and m.object.name) for m in o.modifiers],
                     vgroups=len(o.vertex_groups), materials=[m.name if m else None for m in o.data.materials], uv=[u.name for u in o.data.uv_layers],
                     scale=[round(x, 4) for x in o.scale])
        elif o.type == 'ARMATURE':
            r.update(bones=len(o.data.bones), deform=sum(b.use_deform for b in o.data.bones), pose=o.data.pose_position)
        rows.append(r)
    return rows


# ------------------------------------------------------------------ 2. rules (read-only)
def check_naming(obj, slot=None, fp=False):
    out = []
    if not ID_RE.match(obj.name): out.append(('fail', f'{obj.name}: object name must match {ID_RE.pattern} (item id, e.g. tactical_jacket_001)'))
    if fp != obj.name.endswith('_fp'): out.append(('fail', f'{obj.name}: first-person garments end in _fp, third-person ones must not'))
    if slot is not None and slot not in SLOTS: out.append(('fail', f'unknown slot {slot}'))
    if not any(c.name.startswith('WEAR_') for c in obj.users_collection): out.append(('warn', f'{obj.name}: not inside a WEAR_<set> collection (see ensure_structure)'))
    return out


def check_transforms(obj, fp=False):
    out = []; arm = _skel(fp)
    if obj.parent != arm: out.append(('fail', f'{obj.name}: must be parented to {arm.name}'))
    if any(abs(s - 1) > 1e-4 for s in obj.scale): out.append(('fail', f'{obj.name}: scale {tuple(round(x, 4) for x in obj.scale)} — apply scale (Ctrl+A)'))
    if any(abs(a) > 1e-4 for a in obj.rotation_euler) and obj.rotation_mode != 'QUATERNION': out.append(('fail', f'{obj.name}: rotation not applied'))
    if obj.parent_type == 'OBJECT' and obj.location.length > 1e-4: out.append(('warn', f'{obj.name}: location {tuple(round(x, 4) for x in obj.location)} is not 0 (skinned garments sit at the armature origin)'))
    bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]; bbb = [_body(fp).matrix_world @ Vector(c) for c in _body(fp).bound_box]
    size = lambda b: [max(p[i] for p in b) - min(p[i] for p in b) for i in range(3)]
    sg, sb = size(bb), size(bbb)
    if any(g > b * 1.4 + 0.05 for g, b in zip(sg, sb)): out.append(('fail', f'{obj.name}: size {tuple(round(x, 2) for x in sg)} m is far outside the body {tuple(round(x, 2) for x in sb)} (wrong scale/units?)'))
    return out


def check_geometry(obj, fp=False):
    """loose/degenerate/duplicate geometry, n-gons, flipped faces (vs the body surface normal)"""
    out = []; me = obj.data
    bm = bmesh.new(); bm.from_mesh(me)
    loose = sum(1 for v in bm.verts if not v.link_edges); degen = sum(1 for f in bm.faces if f.calc_area() < 1e-9)
    ngon = sum(1 for f in bm.faces if len(f.verts) > 4); nonman = sum(1 for e in bm.edges if len(e.link_faces) > 2)
    kd = KDTree(len(bm.verts))
    for v in bm.verts: kd.insert(v.co, v.index)
    kd.balance()
    dup = sum(1 for v in bm.verts if sum(1 for _ in kd.find_range(v.co, 1e-5)) > 1)
    bm.free()
    for n, t, lvl in ((loose, 'loose vertices', 'fail'), (degen, 'zero-area faces', 'fail'), (ngon, 'n-gons (> 4 sides)', 'warn'), (nonman, 'edges shared by > 2 faces', 'fail'), (dup, 'vertices on top of each other', 'warn')):
        if n: out.append((lvl, f'{obj.name}: {n} {t}'))
    # flipped faces: judged per connected piece. A closed box (pocket, buckle) legitimately has a face that looks at the body
    # (its underside), so a piece only counts as flipped when most of it looks at the body; the main shell tolerates 2 %.
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    seen = set(); islands = []
    for f in bm.faces:
        if f.index in seen: continue
        stack = [f]; seen.add(f.index); isl = []
        while stack:
            c = stack.pop(); isl.append(c.index)
            for e in c.edges:
                for n in e.link_faces:
                    if n.index not in seen: seen.add(n.index); stack.append(n)
        islands.append(isl)
    bm.free()
    with rest_pose(_skel(fp)):
        bvh, _ = _bvh(_body(fp)); mw = obj.matrix_world; n3 = mw.to_3x3(); inward = {}
        for p in me.polygons:
            hit = bvh.find_nearest(mw @ p.center)
            inward[p.index] = hit[0] is not None and (n3 @ p.normal).dot(hit[1]) < -0.2
    main = max(islands, key=len) if islands else []
    for isl in islands:
        bad = sum(inward[i] for i in isl); frac = bad / len(isl)
        if isl is main and len(isl) > 50:
            if frac > 0.10: out.append(('fail', f'{obj.name}: {bad}/{len(isl)} faces of the main shell point INTO the body ({frac:.0%}) — flip normals (Shift+N)'))
            elif frac > 0.02: out.append(('warn', f'{obj.name}: {bad}/{len(isl)} faces of the main shell point into the body ({frac:.1%})'))
        elif len(isl) >= 4 and frac > 0.6: out.append(('fail', f'{obj.name}: a separate piece of {len(isl)} faces looks into the body — flip its normals'))
    return out


def check_materials(obj):
    out = []; mats = obj.data.materials
    if not len(mats): out.append(('fail', f'{obj.name}: no materials (names must be colour slots {SLOT_COLORS})'))
    for i, m in enumerate(mats):
        if m is None: out.append(('fail', f'{obj.name}: empty material slot {i}')); continue
        if m.name.split('.')[0] not in SLOT_COLORS: out.append(('fail', f'{obj.name}: material "{m.name}" is not a colour slot {SLOT_COLORS}'))
    used = {p.material_index for p in obj.data.polygons}
    for i in range(len(mats)):
        if i not in used: out.append(('warn', f'{obj.name}: material slot {i} ({mats[i].name if mats[i] else None}) is not used by any face'))
    if not obj.data.uv_layers: out.append(('warn', f'{obj.name}: no UV map (the game ignores UVs today; a UV map is required once textures are used — see spec)'))
    if any(m and m.node_tree and any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes) for m in mats): out.append(('warn', f'{obj.name}: image textures are ignored by the game (colours come from the palette)'))
    return out


def clearance(obj, fp=False):
    """signed distance of every garment vertex to the rest-pose body surface (+ = outside). returns metrics dict"""
    with rest_pose(_skel(fp)):
        bvh, _ = _bvh(_body(fp)); mw = obj.matrix_world; d = []
        for v in obj.data.vertices:
            p = mw @ v.co; hit = bvh.find_nearest(p)
            if hit[0] is not None: d.append((p - hit[0]).dot(hit[1]))
    d.sort(); n = len(d)
    return {'verts': n, 'min_mm': round(d[0] * 1000, 1) if n else None, 'p05_mm': round(d[n // 20] * 1000, 1) if n else None, 'median_mm': round(d[n // 2] * 1000, 1) if n else None,
            'inside': sum(1 for x in d if x < 0), 'tight': sum(1 for x in d if x < MIN_CLEAR)}


def check_clearance(obj, fp=False):
    c = clearance(obj, fp); out = []
    if c['verts'] and c['inside'] / c['verts'] > 0.01: out.append(('fail', f'{obj.name}: {c["inside"]} vertices ({c["inside"] / c["verts"]:.1%}) are inside the body (min {c["min_mm"]} mm)'))
    elif c['inside']: out.append(('warn', f'{obj.name}: {c["inside"]} vertices inside the body (min {c["min_mm"]} mm)'))
    if c['verts'] and c['tight'] / c['verts'] > 0.10: out.append(('warn', f'{obj.name}: {c["tight"]} vertices closer than {MIN_CLEAR * 1000:.0f} mm to the body (z-fighting risk; median {c["median_mm"]} mm)'))
    return out, c


def weight_stats(obj):
    """influences per vertex histogram + bones used (read-only)"""
    vg = {g.index: g.name for g in obj.vertex_groups}; hist = {}; used = set()
    for v in obj.data.vertices:
        gs = [g for g in v.groups if g.weight > 1e-4]; hist[len(gs)] = hist.get(len(gs), 0) + 1
        used.update(vg[g.group] for g in gs)
    return {'influences': dict(sorted(hist.items())), 'bones_used': sorted(used)}


def check_garment(obj, slot, fp=False, geometry=True):
    """every rule of docs/GARMENT_ASSET_SPEC.md that Blender can check. -> {'issues': [(level,text)], 'tris', 'clearance', 'weights'}"""
    issues = []; issues += check_naming(obj, slot, fp); issues += check_transforms(obj, fp); issues += check_materials(obj)
    if geometry: issues += check_geometry(obj, fp)
    rig, tris = W['check_wearable']([obj], slot, fp)                    # armature, deform bones, <=4 influences, normalised, budget
    issues += [(lvl, t) for lvl, t in rig if lvl != 'ok'] + [(lvl, t) for lvl, t in rig if lvl == 'ok']
    cl, cmet = check_clearance(obj, fp); issues += cl
    return {'issues': issues, 'tris': tris, 'clearance': cmet, 'weights': weight_stats(obj),
            'fails': sum(1 for l, _ in issues if l == 'fail'), 'warns': sum(1 for l, _ in issues if l == 'warn')}


# ------------------------------------------------------------------ 3. deformation test (poses the rig, restores it)
POSES = {   # bone -> axes tested (local euler, degrees). Local axes depend on bone roll, so all three are tried.
    'upper': {'LeftUpperArm': 70, 'LeftForeArm': 90, 'LeftShoulder': 25, 'Spine1': 30, 'Neck': 35},
    'lower': {'LeftUpperLeg': 70, 'LeftLowerLeg': 90, 'Hips': 25, 'Spine': 30},
    'hands': {'LeftHand': 50, 'LeftForeArm': 60, 'LeftIndex1': 70, 'LeftThumb1': 50},
    'feet': {'LeftLowerLeg': 70, 'LeftFoot': 40, 'LeftToe': 40},
    'back': {'Spine1': 30, 'Chest': 25, 'Hips': 20},
}


def deform_test(obj, slot, fp=False, poses=None, depth_mm=2.0):
    """for each bone and axis: rotate it, evaluate rig, report garment vertices that end up inside the deformed body and the
    worst edge stretching vs rest. The pose is reset afterwards. -> {'worst': {...}, 'rows': [...], 'issues': [...]}"""
    arm = _skel(fp); body = _body(fp); poses = poses or POSES.get(slot, POSES['upper'])
    if fp: poses = {b: a for b, a in poses.items() if b in arm.pose.bones}
    rows = []; saved = {}
    me = obj.data; edges = [(e.vertices[0], e.vertices[1]) for e in me.edges]
    bme = [(e.vertices[0], e.vertices[1]) for e in body.data.edges]
    with rest_pose(arm):
        _dg = bpy.context.evaluated_depsgraph_get(); rest = _world_pts(obj, _dg); brest = _world_pts(body, _dg)
    brest_len = [(brest[a] - brest[b]).length for a, b in bme]
    rest_len = [(rest[a] - rest[b]).length for a, b in edges]
    # neutral pose: no action, every pose bone at identity, pose mode — everything is restored in `finally`
    ad = arm.animation_data; old_action = ad.action if ad else None; old_pp = arm.data.pose_position
    for b in arm.pose.bones: saved[b.name] = (b.rotation_mode, b.rotation_euler.copy(), b.rotation_quaternion.copy(), b.location.copy(), b.scale.copy())
    try:
        if ad: ad.action = None
        arm.data.pose_position = 'POSE'
        for b in arm.pose.bones:
            b.rotation_mode = 'XYZ'; b.rotation_euler = (0, 0, 0); b.location = (0, 0, 0); b.scale = (1, 1, 1)
        for bone, deg in poses.items():
            pb = arm.pose.bones.get(bone)
            if not pb: continue
            for axis in range(3):
                d = deg / 3 if axis == 1 else deg          # Y = along the bone: only a gentle twist (no twist bones in this rig)
                e = [0.0, 0.0, 0.0]; e[axis] = math.radians(d); pb.rotation_euler = e
                bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
                bvh, _ = _bvh(body, dg); pts = _world_pts(obj, dg)
                inside = 0; worst = 0.0
                for p in pts:
                    hit = bvh.find_nearest(p)
                    if hit[0] is not None:
                        s = (p - hit[0]).dot(hit[1])
                        if s < -depth_mm / 1000: inside += 1; worst = min(worst, s)
                st = 0.0
                for (a, b), l0 in zip(edges, rest_len):
                    if l0 > 1e-4: st = max(st, (pts[a] - pts[b]).length / l0)
                bp = _world_pts(body, dg); bst = max(((bp[a] - bp[b]).length / l0 for (a, b), l0 in zip(bme, brest_len) if l0 > 1e-4), default=1.0)
                rows.append({'bone': bone, 'axis': 'XYZ'[axis], 'deg': round(d), 'inside': inside, 'inside_pct': round(100 * inside / max(1, len(pts)), 2), 'deepest_mm': round(worst * 1000, 1), 'max_stretch': round(st, 2), 'body_stretch': round(bst, 2)})
            pb.rotation_euler = (0, 0, 0)
    finally:
        for bone, (mode, eul, q, loc, sc) in saved.items():
            pb = arm.pose.bones[bone]; pb.rotation_mode = mode; pb.rotation_euler = eul; pb.rotation_quaternion = q; pb.location = loc; pb.scale = sc
        if ad: ad.action = old_action
        arm.data.pose_position = old_pp
        bpy.context.view_layer.update()
    wr = max(rows, key=lambda r: r['inside_pct']) if rows else None; ws = max(rows, key=lambda r: r['max_stretch']) if rows else None
    issues = []
    if wr and wr['inside_pct'] > 3: issues.append(('fail', f'{obj.name}: {wr["inside_pct"]}% of vertices inside the body when {wr["bone"]} turns {wr["deg"]}° on {wr["axis"]} (deepest {wr["deepest_mm"]} mm)'))
    elif wr and wr['inside_pct'] > 1: issues.append(('warn', f'{obj.name}: {wr["inside_pct"]}% of vertices inside the body at {wr["bone"]} {wr["axis"]}'))
    if ws and ws['max_stretch'] > max(MAX_STRETCH, 2 * ws['body_stretch']): issues.append(('fail', f'{obj.name}: an edge stretches {ws["max_stretch"]}x at {ws["bone"]} {ws["axis"]} while the body only {ws["body_stretch"]}x (weights/topology at the joint)'))
    return {'worst_penetration': wr, 'worst_stretch': ws, 'rows': rows, 'issues': issues}


# ------------------------------------------------------------------ 4. helpers that assist manual modeling (modify the scene — explicit calls only)
def ensure_structure(set_name):
    """collections WEAR_<set>/{MESH,HARD,REF,EXPORT} + the shared colour-slot materials (fake user). Returns the collections."""
    root = bpy.data.collections.get(f'WEAR_{set_name}') or bpy.data.collections.new(f'WEAR_{set_name}')
    if root.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(root)
    kids = {}
    for k in ('MESH', 'HARD', 'REF', 'EXPORT'):
        c = bpy.data.collections.get(f'WEAR_{set_name}_{k}') or bpy.data.collections.new(f'WEAR_{set_name}_{k}')
        if c.name not in root.children: root.children.link(c)
        kids[k] = c
    kids['EXPORT'].hide_render = True
    for s in SLOT_COLORS:
        m = bpy.data.materials.get(s) or W['slot_material'](s); m.use_fake_user = True
    return {'root': root, **kids}


def weights_from_body(obj, fp=False, k=3, smooth=2):
    """skin weights for a hand-modeled garment or hard-surface piece: inverse-distance blend of the nearest body vertices
    (the body is the approved reference), then limit to 4, normalise and smooth. Replaces the groups of `obj`."""
    ref = W['BodyRef'](_body(fp)); arm = _skel(fp)
    names = [b.name for b in arm.data.bones if b.use_deform]
    obj.vertex_groups.clear()
    for n in names: obj.vertex_groups.new(name=n)
    idx = {g.name: g.index for g in obj.vertex_groups}; mw = obj.matrix_world
    with rest_pose(arm):
        for v in obj.data.vertices:
            for g, w in ref.blend_weights(mw @ v.co, k).items():
                if g in idx: obj.vertex_groups[idx[g]].add([v.index], w, 'REPLACE')
    W['normalize_weights'](obj, 4)
    if smooth:                                   # neighbour averaging along edges (plain Python: needs no UI mode or operator context)
        me = obj.data; nb = [[] for _ in me.vertices]
        for e in me.edges: nb[e.vertices[0]].append(e.vertices[1]); nb[e.vertices[1]].append(e.vertices[0])
        gname = {g.index: g.name for g in obj.vertex_groups}
        cur = [{gname[g.group]: g.weight for g in v.groups} for v in me.vertices]
        for _ in range(smooth):
            nxt = []
            for i, w in enumerate(cur):
                acc = {k: x * 0.5 for k, x in w.items()}
                if nb[i]:
                    f = 0.5 / len(nb[i])
                    for j in nb[i]:
                        for k, x in cur[j].items(): acc[k] = acc.get(k, 0) + x * f
                nxt.append(acc)
            cur = nxt
        for g in obj.vertex_groups: g.remove(range(len(me.vertices)))
        for i, w in enumerate(cur):
            for k, x in w.items():
                if x > 1e-4: obj.vertex_groups[k].add([i], x, 'REPLACE')
        W['normalize_weights'](obj, 4)
    return weight_stats(obj)


def join_pieces(pieces, name, collection=None):
    """duplicate the garment mesh + its `<id>.hs.*` hard-surface pieces and join the DUPLICATES into one mesh `name`
    (one item = one mesh = one draw call). Originals stay untouched. All pieces need the same armature modifier + groups."""
    arm_objs = {p.parent for p in pieces}
    if len(arm_objs) != 1: raise ValueError('all pieces need the same parent armature')
    dups = []
    for p in pieces:
        d = p.copy(); d.data = p.data.copy(); d.name = f'_join_{p.name}'
        (collection or bpy.context.scene.collection).objects.link(d); dups.append(d)
    names = {g.name for d in dups for g in d.vertex_groups}
    for d in dups:
        for n in names:
            if n not in d.vertex_groups: d.vertex_groups.new(name=n)
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for d in dups: d.select_set(True)
    bpy.context.view_layer.objects.active = dups[0]
    with bpy.context.temp_override(object=dups[0], active_object=dups[0], selected_objects=dups, selected_editable_objects=dups):
        bpy.ops.object.join()
    out = bpy.context.view_layer.objects.active; out.name = name; out.data.name = name
    return out


# ------------------------------------------------------------------ 5. GLB read-back + export
def read_glb(path):
    b = open(path, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]
    return json.loads(b[20:20 + n].decode('utf8'))


def verify_glb(path, fp=False):
    """re-open the exported file: joints must be the armature's bones in the same order, no animations/textures"""
    g = read_glb(path); arm = _skel(fp); out = []
    if not g.get('skins'): out.append(('fail', f'{os.path.basename(path)}: no skin in the GLB (export with the armature selected)'))
    else:
        joints = [g['nodes'][j]['name'] for j in g['skins'][0]['joints']]
        bones = [b.name for b in arm.data.bones]
        miss = [j for j in joints if j not in bones]
        if miss: out.append(('fail', f'joints not in the character skeleton: {miss[:5]}'))
    if g.get('animations'): out.append(('fail', 'GLB contains animations'))
    if g.get('textures'): out.append(('warn', 'GLB contains textures'))
    return out


def next_version(out_dir, item_id, fp=False):
    pat = re.compile(rf'^{re.escape(item_id)}_v_(\d+){"_fp" if fp else ""}\.glb$'); v = 0
    for f in os.listdir(out_dir):
        m = pat.match(f)
        if m: v = max(v, int(m.group(1)))
    return v + 1


def export_garment(objs, item_id, slot, fp=False, version=None, out_dir=None, report_dir=None, allow_warnings=True):
    """check -> export -> verify. Refuses on any `fail`, never overwrites a file (version = next free number by default).
    Writes `<id>_v_<n>[_fp].glb` and `<id>_v_<n>[_fp].report.json` (rule results) and returns both paths."""
    out_dir = out_dir or os.path.join(os.path.dirname(bpy.data.filepath), 'export_out'); os.makedirs(out_dir, exist_ok=True)
    results = {o.name: check_garment(o, slot, fp) for o in objs if o.parent_type != 'BONE'}
    fails = [t for r in results.values() for l, t in r['issues'] if l == 'fail']
    if fails: return {'ok': False, 'stage': 'check', 'fails': fails}
    if not allow_warnings and any(r['warns'] for r in results.values()): return {'ok': False, 'stage': 'check', 'fails': ['warnings not allowed']}
    version = version or next_version(out_dir, item_id, fp)
    path = os.path.join(out_dir, f'{item_id}_v_{version}{"_fp" if fp else ""}.glb')
    if os.path.exists(path): return {'ok': False, 'stage': 'export', 'fails': [f'{path} exists — versions are never overwritten']}
    size = W['export_wearable'](objs, path, fp)
    post = verify_glb(path, fp)
    rep = {'item': item_id, 'slot': slot, 'fp': fp, 'version': version, 'bytes': size, 'checks': {k: {'tris': v['tris'], 'warns': [t for l, t in v['issues'] if l == 'warn'], 'clearance': v['clearance'], 'weights': v['weights']} for k, v in results.items()}, 'glb': post}
    rp = os.path.join(report_dir or out_dir, os.path.basename(path)[:-4] + '.report.json'); json.dump(rep, open(rp, 'w'), indent=1)
    return {'ok': not any(l == 'fail' for l, _ in post), 'path': path, 'report': rp, 'bytes': size, 'post': post}


def summarize(res):
    """one line per issue, worst first"""
    order = {'fail': 0, 'warn': 1, 'ok': 2}
    return [f'[{l}] {t}' for l, t in sorted(res['issues'], key=lambda x: order[x[0]])]
