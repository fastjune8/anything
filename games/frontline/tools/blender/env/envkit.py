# 환경 에셋 공통 도구 (Blender bpy). 건물·구조물 스크립트(build_*.py)가 같이 쓴다.
#   - 좌표: 모든 치수는 게임 좌표 (x 동, y 위, z 북). B() 가 Blender 좌표로 바꾼다
#   - 메쉬: 재질 × 그림자(NS_) 묶음별로 모아서 한 메쉬씩 내보낸다 (그리기 호출 = 묶음 수)
#   - 재질: 이름이 같으면 게임이 하나로 공유한다 (client/js/mapassets.js). 그래서 모든 에셋이 같은 make_materials()·같은 텍스처를 쓴다
#   규칙: docs/ENV_ASSET_PIPELINE.md
import bpy, bmesh, os
from mathutils import Vector, Euler

def lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple((v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c) + (1.0,)
def mul(c, k): return (min(1, c[0] * k), min(1, c[1] * k), min(1, c[2] * k), 1.0)
WHITE = (1, 1, 1, 1)
GLASS = (0.55, 0.68, 0.72, 0.38)

# ───────────────────────── 메쉬 모으기 ─────────────────────────
class Group:
    def __init__(s, name, mat):
        s.name, s.mat, s.v, s.f, s.uv, s.col = name, mat, [], [], [], []
        s.tris = 0
GROUPS = {}
def grp(name, mat):
    if name not in GROUPS: GROUPS[name] = Group(name, mat)
    return GROUPS[name]

def B(x, y, z):  # 게임 좌표 → Blender
    return Vector((x, -z, y))

def add_face(g, pts, col, tile, off, swap=False):
    n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
    if n.length < 1e-12: return
    n.normalize()
    ax = max(range(3), key=lambda i: abs(n[i]))
    base = len(g.v)
    g.v.extend(pts); g.f.append(tuple(range(base, base + len(pts))))
    for p in pts:
        if ax == 2: u, v = p.x, p.y
        elif ax == 0: u, v = p.y, p.z
        else: u, v = p.x, p.z
        if swap: u, v = v, u                     # 결 방향을 90° 돌린다 (나무 결을 세로로 등)
        g.uv.append((u / tile + off[0], v / tile + off[1]))
        g.col.append(col)
    g.tris += len(pts) - 2

def box(g, cx, cy, cz, sx, sy, sz, col=WHITE, bevel=0.0, tile=3.0, off=(0, 0), skip=(), rot=None, swap=False):
    """게임 좌표 상자. 가운데 (cx, cy, cz), 크기 (sx, sy, sz). bevel = 모서리 깎기. skip = {'up','down'} 이면 그 면은 만들지 않는다"""
    if sx < 1e-4 or sy < 1e-4 or sz < 1e-4: return
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * sx, v.co.y * sz, v.co.z * sy))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(sx, sy, sz) * 0.45), offset_type='OFFSET', segments=1, profile=0.5, affect='EDGES')
    bm.normal_update()
    M = None
    if rot is not None: M = Euler(rot).to_matrix().to_4x4()
    for f in bm.faces:
        n = f.normal
        if 'up' in skip and n.z > 0.99: continue
        if 'down' in skip and n.z < -0.99: continue
        pts = []
        for v in f.verts:
            p = v.co.copy()
            if M is not None: p = M @ p
            pts.append(p + B(cx, cy, cz))
        add_face(g, pts, col, tile, off, swap)
    bm.free()

def prism(g, prof, z0, z1, col=WHITE, tile=1.0):
    """x–y 평면의 볼록 다각형 prof [(x, y), …] (반시계) 을 z0~z1 로 민 덩어리 (계단 옆판 등)"""
    n = len(prof)
    add_face(g, [B(x, y, z1) for x, y in prof], col, tile, (0, 0))
    add_face(g, [B(x, y, z0) for x, y in reversed(prof)], col, tile, (0, 0))
    for i in range(n):
        (xa, ya), (xb, yb) = prof[i], prof[(i + 1) % n]
        add_face(g, [B(xa, ya, z0), B(xb, yb, z0), B(xb, yb, z1), B(xa, ya, z1)], col, tile, (0, 0))

def bar(g, p0, p1, w, h, col=WHITE, tile=1.0):
    """두 점(게임 좌표)을 잇는 막대 (단면 w × h)"""
    a, b = B(*p0), B(*p1)
    d = b - a; L = d.length
    q = Vector((1, 0, 0)).rotation_difference(d.normalized())
    rot = q.to_euler()
    c = (a + b) / 2
    box(g, c.x, c.z, -c.y, L, h, w, col, 0, tile, rot=rot)

def cyl(g, cx, y0, cz, r, h, seg=10, col=WHITE, tile=1.0, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bm.normal_update()
    for f in bm.faces:
        pts = [v.co + B(cx, y0 + h / 2, cz) for v in f.verts]
        add_face(g, pts, col, tile, (0, 0))
    bm.free()

def quad(g, p0, p1, p2, p3, col, tile=3.0):
    add_face(g, [B(*p) for p in (p0, p1, p2, p3)], col, tile, (0, 0))

def tri(g, p0, p1, p2, col):
    add_face(g, [B(*p) for p in (p0, p1, p2)], col, 1.0, (0, 0))

# 재질 묶음 (그림자 던짐 / 안 던짐 = NS_)
C = lambda: grp('Concrete', 'concrete')
CN = lambda: grp('NS_Concrete', 'concrete')
P = lambda: grp('PaintedMetal', 'paint')
PN = lambda: grp('NS_PaintedMetal', 'paint')
M_ = lambda: grp('BareMetal', 'metal')
MN = lambda: grp('NS_BareMetal', 'metal')
WD = lambda: grp('NS_Wood', 'wood')
WDS = lambda: grp('Wood', 'wood')         # 그림자를 던지는 나무 (감시탑 기둥·바닥)
GL = lambda: grp('NS_Glass', 'glass')

# ───────────────────────── 재질 · 텍스처 ─────────────────────────
def img(path, nc):
    im = bpy.data.images.load(path)
    if nc: im.colorspace_settings.name = 'Non-Color'
    return im

def make_mat(name, bc=None, n=None, orm=None, n_strength=1.0, rough=0.7, metal=0.0, glass=False, scale=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nodes, links = nt.nodes, nt.links
    for n_ in list(nodes): nodes.remove(n_)
    out = nodes.new('ShaderNodeOutputMaterial')
    bs = nodes.new('ShaderNodeBsdfPrincipled'); links.new(bs.outputs['BSDF'], out.inputs['Surface'])
    bs.inputs['Roughness'].default_value = rough; bs.inputs['Metallic'].default_value = metal
    if glass:
        bs.inputs['Base Color'].default_value = GLASS[:3] + (1,)
        bs.inputs['Alpha'].default_value = GLASS[3]
        bs.inputs['Roughness'].default_value = 0.06
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
        try: m.blend_method = 'BLEND'
        except Exception: pass
        m.use_backface_culling = False        # 유리는 양면
        return m
    m.use_backface_culling = True             # 닫힌 덩어리는 한 면만 (glTF doubleSided = false)
    vc = nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    tx = nodes.new('ShaderNodeTexImage'); tx.image = img(bc, False)
    mix = nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1.0
    links.new(tx.outputs['Color'], mix.inputs['A']); links.new(vc.outputs['Color'], mix.inputs['B'])
    links.new(mix.outputs['Result'], bs.inputs['Base Color'])
    if n:
        nm = nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = n_strength
        tn = nodes.new('ShaderNodeTexImage'); tn.image = img(n, True)
        links.new(tn.outputs['Color'], nm.inputs['Color']); links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    if orm:
        to = nodes.new('ShaderNodeTexImage'); to.image = img(orm, True)
        sp = nodes.new('ShaderNodeSeparateColor')
        links.new(to.outputs['Color'], sp.inputs['Color'])
        links.new(sp.outputs['Green'], bs.inputs['Roughness']); links.new(sp.outputs['Blue'], bs.inputs['Metallic'])
    return m

def make_materials(tex):
    t = lambda f: os.path.join(tex, f)
    return {
        'concrete': make_mat('Concrete', t('concrete_bc.jpg'), t('concrete_n.png'), t('concrete_orm.png'), 0.8),
        'paint': make_mat('PaintedMetal', t('paint_bc.jpg'), t('paint_n.png'), t('paint_orm.png'), 0.5),
        'metal': make_mat('BareMetal', t('metal_bc.jpg'), t('metal_n.png'), t('metal_orm.png'), 0.7),
        'wood': make_mat('Wood', t('wood_bc.jpg'), t('wood_n.png'), t('wood_orm.png'), 0.6),
        'glass': make_mat('Glass', glass=True),
    }

def emit(tex):
    mats = make_materials(tex)
    stats = {}
    for name, g in GROUPS.items():
        if not g.f: continue
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in g.v], [], g.f)
        me.update()
        uvl = me.uv_layers.new(name='UVMap'); ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        i = 0
        for poly in me.polygons:
            for li in poly.loop_indices:
                uvl.data[li].uv = g.uv[i]; ca.data[li].color = g.col[i]; i += 1
        me.materials.append(mats[g.mat])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        stats[name] = (len(me.polygons), g.tris)
    return stats


def export(out, tex, reset=True):
    """모은 묶음을 메쉬로 만들어 GLB 로 내보낸다. tex = textures.py 출력 폴더"""
    st = emit(tex)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=False, export_image_format='AUTO',
                              export_cameras=False, export_lights=False, export_vertex_color='ACTIVE', export_extras=False, export_animations=False)
    tot = sum(t for _, t in st.values())
    print('=== 그룹별 (면 수, 삼각형 수) ===')
    for k, v in st.items(): print(f'{k:20s} {v[0]:6d} {v[1]:6d}')
    print(f'합계 삼각형 {tot}  →  {out}  ({os.path.getsize(out) / 1024:.0f} KB)')
    return tot

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    GROUPS.clear()
