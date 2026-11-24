# 시각 모델(.glb)이 충돌 박스와 어긋나지 않는지 검사한다 (내보낸 파일을 Blender 로 다시 불러와서 잰다).
#   python3 check_fit.py <warehouse.glb> <colliders.json> [--origin 31,0]
#   colliders.json = [[가운데x, 바닥y, 가운데z, 너비, 높이, 깊이], …]  (모델 원점 기준. gen 은 아래 node 한 줄로 만든다)
#     node -e "import('./shared/maps/build.js').then(async m=>{const d=JSON.parse(require('fs').readFileSync('content/maps/outpost.json'));
#              const L=m.buildLayout(d);console.log(JSON.stringify(L.boxes.filter(b=>b.swap==='warehouse'&&!b.noCollide).map(b=>[b.x-31,b.y,b.z,b.w,b.h,b.d])))})"
#  ① 덮임: 충돌 박스 안의 점마다 시각 표면이 (벽 두께의 절반 + 여유) 안에 있어야 한다 → 시각 모델에 구멍이 없다
#  ② 비어 있음: 문·창 구멍 안(벽 두께만큼의 부피)에서 시각 표면에 닿는 점의 비율이 낮아야 한다 (틀·살·유리 조각만)
#  ③ 튀어나옴: 몸이 서는 높이(y < 2.4)에서 충돌 박스 겉면 밖으로 0.16 m 넘게 나온 시각 표면이 없어야 한다
#  ④ 겹침: 같은 방향·같은 평면(2 mm)에서 겹치는 면이 없어야 한다 (z-fighting)
import bpy, sys, json, math, random
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from collections import defaultdict
glb, colf = sys.argv[1], sys.argv[2]
cols = json.load(open(colf))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
dg = bpy.context.evaluated_depsgraph_get()
def G(x, y, z): return Vector((x, -z, y))      # 게임 → Blender
solid_tris, all_tris = [], []
sv, sf, av, af = [], [], [], []
for ob in bpy.context.scene.objects:
    if ob.type != 'MESH': continue
    me = ob.to_mesh(); me.calc_loop_triangles()
    ca = me.color_attributes[0] if len(me.color_attributes) else None
    isglass = any('Glass' in (m.name if m else '') for m in ob.data.materials)
    for t in me.loop_triangles:
        pts = [ob.matrix_world @ me.vertices[i].co for i in t.vertices]
        col = tuple(round(c, 3) for c in ca.data[t.loops[0]].color) if ca else None
        all_tris.append((pts, isglass, ob.name, col))
def tree(tris):
    v, f = [], []
    for pts, *_r in tris:
        b = len(v); v.extend(pts); f.append((b, b + 1, b + 2))
    return BVHTree.FromPolygons(v, f)
bv_all = tree(all_tris); bv_solid = tree([t for t in all_tris if not t[1]])
rnd = random.Random(1)
bad = []
# ① 덮임
worst = 0.0; n = 0
for cx, y0, cz, w, h, d in cols:
    half = min(w, h, d) / 2 + 0.08     # 기단은 벽보다 0.1 두껍다
    for _ in range(400):
        p = G(cx + (rnd.random() - .5) * w, y0 + rnd.random() * h, cz + (rnd.random() - .5) * d)
        loc, nor, idx, dist = bv_solid.find_nearest(p)
        n += 1
        if dist is None or dist > half:
            bad.append(f'덮임: 충돌 박스 ({cx:.2f},{y0:.2f},{cz:.2f} {w:.2f}x{h:.2f}x{d:.2f}) 안의 점이 시각 표면에서 {dist:.2f} m (허용 {half:.2f})'); break
        worst = max(worst, dist / half)
print(f'① 덮임: {n}점, 최악 비율 {worst:.2f} (1 이하면 통과)')
# ② 비어 있음: 문·창 구멍 (모델 좌표) — 충돌이 없어야 하는 자리를 직접 만든다
OPEN = [  # (축, 고정좌표, 바깥 부호, 구간 a, b, y0, y1, 종류)
    ('x', 7.85, 1, -7.3, -4.7, 0, 2.2, 'door'), ('x', 7.85, 1, 4.7, 7.3, 0, 2.2, 'door'), ('x', 7.85, 1, -.9, .9, 1.0, 2.0, 'win'),
    ('x', -7.85, -1, -7.3, -4.7, 0, 2.2, 'door'), ('x', -7.85, -1, 4.7, 7.3, 0, 2.2, 'door'), ('x', -7.85, -1, -.9, .9, 1.0, 2.0, 'win'),
    ('z', -9.85, -1, -4.4, -2.6, 1.0, 2.0, 'win'), ('z', -9.85, -1, -1.2, 1.2, 0, 2.2, 'door'), ('z', -9.85, -1, 2.6, 4.4, 1.0, 2.0, 'win'),
    ('z', 9.85, 1, -1.2, 1.2, 0, 2.2, 'door')]
for ax, fixed, sg, a, b, y0, y1, kind in OPEN:
    hit = tot = 0
    for _ in range(600):
        u = a + rnd.random() * (b - a); y = y0 + 0.02 + rnd.random() * (y1 - y0 - 0.04); v = (rnd.random() - .5) * 0.26
        p = G(u, y, fixed + sg * v) if ax == 'x' else G(fixed + sg * v, y, u)
        loc, nor, idx, dist = bv_solid.find_nearest(p)
        tot += 1; hit += (dist is not None and dist < 0.02)
    frac = hit / tot
    lim = 0.10 if kind == 'door' else 0.22
    print(f'② {kind} {ax}{fixed:+.2f} [{a},{b}]: 막힘 {frac * 100:.1f}% (한도 {lim * 100:.0f}%)')
    if frac > lim: bad.append(f'비어 있음: {kind} {ax}{fixed} [{a},{b}] 구멍이 {frac * 100:.0f}% 막혀 있다')
# ③ 튀어나옴: 모델 정점 중 y<2.4 에서 어느 충돌 박스 겉면에서도 0.16 넘게 떨어진 것은 없어야 한다 (벽 바깥 / 안쪽 모두)
def outside_dist(px, py, pz):
    best = 1e9
    for cx, y0, cz, w, h, d in cols:
        dx = max(abs(px - cx) - w / 2, 0); dy = max(y0 - py, py - (y0 + h), 0); dz = max(abs(pz - cz) - d / 2, 0)
        best = min(best, math.sqrt(dx * dx + dy * dy + dz * dz))
    return best
seen = set(); far = 0; farmax = 0; offenders = []
for pts, isglass, _o, _c in all_tris:
    for p in pts:
        gx, gy, gz = p.x, p.z, -p.y
        if gy >= 2.4 or gy < 0.02: continue
        key = (round(gx, 2), round(gy, 2), round(gz, 2))
        if key in seen: continue
        seen.add(key)
        # 문·창 구멍 가장자리의 틀·문짝은 구멍 쪽이 아니라 벽 겉면 위에 있으므로 이 검사로 충분하다
        if any(ax == 'x' and a - .001 < gx < b + .001 and y0 - .001 < gy < y1 + .001 and abs(gz - fixed) < 0.16 + 1e-6 or ax == 'z' and a - .001 < gz < b + .001 and y0 - .001 < gy < y1 + .001 and abs(gx - fixed) < 0.16 + 1e-6
               for ax, fixed, sg, a, b, y0, y1, kind in OPEN): continue   # 구멍 안 (가운데 살·유리 조각)은 충돌 박스 밖에 있는 것이 맞다
        dd = outside_dist(gx, gy, gz)
        if dd > 0.16:
            far += 1; farmax = max(farmax, dd); offenders.append((round(gx, 2), round(gy, 2), round(gz, 2), round(dd, 2)))
print(f'③ 몸 높이(y<2.4) 정점 {len(seen)}개 중 충돌 겉면에서 0.16 m 넘게 나온 것 {far}개 (최대 {farmax:.2f} m)')
if far: bad.append(f'튀어나옴: {far}개 정점이 0.16 m 넘게 나와 있다 (최대 {farmax:.2f} m) 예: {sorted(offenders, key=lambda o: -o[3])[:5]}')
# ④ 겹침
try:
    from shapely.geometry import Polygon
    buckets = defaultdict(list)
    for k, (pts, isglass, oname, tcol) in enumerate(all_tris):
        if isglass: continue
        n_ = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if n_.length < 1e-9: continue
        n_.normalize(); dd = n_.dot(pts[0])
        buckets[(round(n_.x * 20), round(n_.y * 20), round(n_.z * 20), round(dd / 0.002))].append(((oname, tcol), n_, pts))
    z = 0; ex = []
    for key, items in buckets.items():
        if len(items) < 2: continue
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                o1, n1, p1 = items[i]; o2, n2, p2 = items[j]
                if n1.dot(n2) < 0.999: continue
                # 같은 덩어리(재질)·같은 색이고 UV 가 월드 좌표라 값이 똑같이 나오는 겹침(막대 모서리 등)은 깜빡이지 않는다. 콘크리트는 판마다 UV 이동이 달라서 예외
                if o1 == o2 and 'Concrete' not in o1[0] and o1[1] is not None: continue
                ax_ = max(range(3), key=lambda a: abs(n1[a])); idx2 = [a for a in range(3) if a != ax_]
                A = Polygon([(p[idx2[0]], p[idx2[1]]) for p in p1]); Bp = Polygon([(p[idx2[0]], p[idx2[1]]) for p in p2])
                if A.is_valid and Bp.is_valid and A.intersection(Bp).area > 0.004:
                    z += 1; ex.append((tuple(round(c, 2) for c in (p1[0].x, p1[0].z, -p1[0].y)), key, o1[0] + '|' + o2[0]))
    from collections import Counter
    print(f'④ 같은 평면(2 mm)에서 겹치는 삼각형 쌍 {z}쌍', Counter(k for _, k, _o in ex).most_common(4))
    first = {}
    for pt, k, o in ex: first.setdefault(k, (pt, o))
    print('   예(게임 좌표):', list(first.items())[:8])
    if z: bad.append(f'겹침: {z}쌍 {ex[:3]}')
except ImportError:
    print('④ shapely 없음 — 건너뜀')
print('통과' if not bad else '실패:\n  ' + '\n  '.join(bad))
sys.exit(1 if bad else 0)
