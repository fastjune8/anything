# Outpost 창고 (C 거점) 모델 → content/assets/warehouse.glb
#   헤드리스 Blender(bpy 모듈)로 돌린다:  python3 build_warehouse.py <출력.glb> [--tex <텍스처 폴더>]
#   Blender 앱 안에서도 돌아간다 (Scripting 탭 → 열고 ▶ 실행, 맨 아래 OUT 경로를 고친다).
#   규칙(원점·축·재질 이름·NS_ 접두어·예산): docs/ENV_ASSET_PIPELINE.md
#
# ── 좌표 ──
#   이 스크립트의 모든 치수는 "게임 좌표"로 적는다: x = 동(+), y = 위(+), z = 북(+).  (Blender 로는 (x, −z, y) 로 바꿔 넣고
#   glTF 내보내기가 다시 Y-up 으로 돌려서, 게임(Three.js)에서 이 모델의 x, y, z 가 그대로 게임 좌표가 된다.)
#   원점 = 건물 가운데 바닥. 맵 데이터에서 { type: 'asset', id: 'warehouse', x: 31, z: 0 } 한 줄로 놓는다.
#
# ── 충돌체와의 약속 (shared/maps/parts.js building() 과 같은 치수) ──
#   건물 20 × 16 m, 높이 4.2, 벽 두께 0.3, 지붕판 20.6 × 16.6 × 0.25 (y 4.2~4.45)
#   문 = 높이 2.2 이하가 뚫림, 창 = 높이 1.0~2.0 이 뚫림. 이 구멍들은 시각 모델에서도 그대로 비어 있어야 한다.
#   벽 바깥면에서 1.2 m 이하 높이로는 0.15 m 이상 튀어나오지 않는다 (몸이 장식에 박혀 보이지 않게). 그 위(캐노피)는 자유.
import bpy, bmesh, math, os, sys, random
from mathutils import Vector, Euler
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd(), '..', 'env'))
from envkit import *   # lin·mul·WHITE·GLASS·box·bar·cyl·quad·tri·grp·C·P·PN·M_·MN·CN·WD·GL·export (공통 도구)

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd()
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = args[0] if args and not args[0].startswith('--') else os.path.join(HERE, 'warehouse.glb')
TEX = args[args.index('--tex') + 1] if '--tex' in args else os.path.join(HERE, '_tex')

# ───────────────────────── 치수 ─────────────────────────
W, D, H, T = 20.0, 16.0, 4.2, 0.3
X0, X1, Z0, Z1 = -W / 2, W / 2, -D / 2, D / 2
OUTER, INNER = T / 2, -T / 2               # 벽 가운데선 기준 바깥/안쪽 면
DOOR_H, WIN_Y0, WIN_Y1 = 2.2, 1.0, 2.0
PLINTH_H, CORNICE_Y0 = 0.4, 3.75
BAND_Y0, BAND_Y1 = 3.0, 3.75               # 높은 곳 유리띠
ROOF_T, ROOF_OVER = 0.25, 0.3

# ───────────────────────── 색 (팔레트: docs/ENV_ART_BIBLE.md) ─────────────────────────
PAINT_FRAME = lin('#56626b')      # 문틀·창틀·난간 (청회색)
PAINT_DOOR = lin('#5b6a58')       # 문짝 (바랜 올리브)
PAINT_DARK = lin('#2c3338')       # 유리띠 뒷판
PAINT_ROOF = lin('#6d7274')       # 지붕판 · 처마판
PAINT_BEAM = lin('#4a545b')       # 천장 보
PAINT_UNIT = lin('#a3a8a9')       # 옥상 설비
BARE = WHITE
GLASS = (0.55, 0.68, 0.72, 0.38)

rnd = random.Random(7)

# ───────────────────────── 벽 ─────────────────────────
class Wall:
    """axis 'x' = 벽이 x 방향으로 뻗음(남·북), 'z' = z 방향(동·서). fixed = 벽 가운데선 좌표, out = 바깥이 +(1) / −(−1)."""
    def __init__(s, name, axis, fixed, out, span, ops):
        s.name, s.axis, s.fixed, s.out, s.span = name, axis, fixed, out, span
        s.ops = sorted(ops, key=lambda o: o[0])
    def box(s, g, u0, u1, y0, y1, v0, v1, col=WHITE, bevel=0.0, tile=3.0, off=(0, 0), skip=()):
        if u1 - u0 < 1e-4: return
        uc, vc = (u0 + u1) / 2, (v0 + v1) / 2
        du, dv = u1 - u0, v1 - v0
        if s.axis == 'x': x, z, sx, sz = uc, s.fixed + s.out * vc, du, dv
        else: x, z, sx, sz = s.fixed + s.out * vc, uc, dv, du
        box(g, x, (y0 + y1) / 2, z, sx, y1 - y0, sz, col, bevel, tile, off, skip)
    def pt(s, u, y, v):
        return (u, y, s.fixed + s.out * v) if s.axis == 'x' else (s.fixed + s.out * v, y, u)
    def openings(s):
        return [(a - w / 2, a + w / 2, t) for a, w, t in s.ops]
    def solids(s):
        cur, out = s.span[0], []
        for a, b, _ in s.openings():
            out.append((cur, a)); cur = b
        out.append((cur, s.span[1]))
        return out

WALLS = [
    Wall('N', 'x', Z1 - T / 2, +1, (X0, X1), [(-6, 2.6, 'door'), (0, 1.8, 'win'), (6, 2.6, 'door')]),
    Wall('S', 'x', Z0 + T / 2, -1, (X0, X1), [(-6, 2.6, 'door'), (0, 1.8, 'win'), (6, 2.6, 'door')]),
    Wall('W', 'z', X0 + T / 2, -1, (Z0 + T, Z1 - T), [(-3.5, 1.8, 'win'), (0, 2.4, 'door'), (3.5, 1.8, 'win')]),
    Wall('E', 'z', X1 - T / 2, +1, (Z0 + T, Z1 - T), [(0, 2.4, 'door')]),
]
PIL = {'N': (-2.0, 2.0), 'S': (-2.0, 2.0), 'W': (-6.05, 6.05), 'E': (-5.0, 5.0)}   # 기둥형 벽 띠 (문짝이 접히는 자리를 피해서)

def concrete_col(k, jitter=0.03):
    return mul(WHITE, k * (1 + rnd.uniform(-jitter, jitter)))

def build_wall(w):
    cn = C()
    # u 방향 끝: 남북 벽은 모서리 기둥까지(0.06 더) 가고, 동서 벽은 남북 벽 안쪽 면에서 만난다 (겹치면 같은 평면 면이 깜빡인다)
    u_lo, u_hi = w.span[0] - (0.06 if w.axis == 'x' else 0), w.span[1] + (0.06 if w.axis == 'x' else 0)
    # 기단: 문 자리는 비운다
    cur = u_lo
    doors = [(a, b) for a, b, t in w.openings() if t == 'door']
    runs = []
    for a, b in doors: runs.append((cur, a - 0.004)); cur = b + 0.004   # 문틀 막대 끝면과 같은 평면이 되지 않게 4 mm 물러난다
    runs.append((cur, u_hi))
    for a, b in runs:
        w.box(cn, a, b, 0, PLINTH_H, INNER - 0.04, OUTER + 0.06, concrete_col(0.6), 0.03)
    # 판 (패널): 칸마다 2.5 m 안팎으로 나눠 이음새를 만든다
    def panels(a, b, y0, y1, k, split=None):
        n = max(1, round((b - a) / 2.5))
        for i in range(n):
            p0, p1 = a + (b - a) * i / n, a + (b - a) * (i + 1) / n
            off = (rnd.random(), rnd.random())
            kk = k * (0.9 if i % 2 else 1.0)       # 판마다 살짝 다른 밝기: 큰 벽의 단조로움을 깬다
            sk = ('down',) if y0 <= PLINTH_H + 1e-6 else ()      # 기단 위에 얹힌 면은 안 보이므로 만들지 않는다
            if split and y0 < split < y1:
                w.box(cn, p0, p1, y0, split, INNER, OUTER, concrete_col(kk * 0.88), 0.03, 3.0, off, sk)
                w.box(cn, p0, p1, split, y1, INNER, OUTER, concrete_col(kk), 0.03, 3.0, off)
            else:
                w.box(cn, p0, p1, y0, y1, INNER, OUTER, concrete_col(kk), 0.03, 3.0, off, sk)
    for a, b in w.solids():
        panels(a, b, PLINTH_H, BAND_Y0, 0.92, split=1.2)
    for a, b, t in w.openings():
        if t == 'door': panels(a, b, DOOR_H, BAND_Y0, 0.92)
        else:
            panels(a, b, PLINTH_H, WIN_Y0, 0.84)
            panels(a, b, WIN_Y1, BAND_Y0, 0.92)
    # 유리띠: 뒷판은 바깥 면에서 0.06 들어가고, 그 앞에 유리가 있다
    pn = P()
    w.box(pn, w.span[0] + 0.02, w.span[1] - 0.02, BAND_Y0, BAND_Y1, INNER, OUTER - 0.06, PAINT_DARK, 0.0, 1.0, (0, 0), ('up', 'down'))
    gl = GL()
    u0, u1 = w.span[0] + 0.3, w.span[1] - 0.3
    a_, b_ = w.pt(u0, BAND_Y0 + 0.07, OUTER - 0.03), w.pt(u1, BAND_Y0 + 0.07, OUTER - 0.03)
    c_, d_ = w.pt(u1, BAND_Y1 - 0.07, OUTER - 0.03), w.pt(u0, BAND_Y1 - 0.07, OUTER - 0.03)
    quad(gl, a_, b_, c_, d_, GLASS)
    # 유리 틀: 아래·위 레일 + 1.3 m 간격 세로살
    pnn = PN()
    w.box(pnn, u0 - 0.04, u1 + 0.04, BAND_Y0, BAND_Y0 + 0.07, OUTER - 0.06, OUTER + 0.025, PAINT_FRAME, 0.0, 1.0)
    w.box(pnn, u0 - 0.04, u1 + 0.04, BAND_Y1 - 0.07, BAND_Y1, OUTER - 0.06, OUTER + 0.025, PAINT_FRAME, 0.0, 1.0, (0, 0), ('up',))
    nm = max(1, round((u1 - u0) / 1.3))
    for i in range(nm + 1):
        u = u0 + (u1 - u0) * i / nm
        w.box(pnn, u - 0.03, u + 0.03, BAND_Y0, BAND_Y1, OUTER - 0.06, OUTER + 0.025, PAINT_FRAME, 0.0, 1.0)
    # 처마 돌림띠 (벽 위 끝): 바깥으로 0.05
    ce_lo, ce_hi = (w.span[0] - 0.06, w.span[1] + 0.06) if w.axis == 'x' else w.span
    w.box(cn, ce_lo, ce_hi, CORNICE_Y0, H, INNER - 0.03, OUTER + 0.05, concrete_col(1.04, 0.01), 0.02, 3.0, (rnd.random(), rnd.random()))
    # 벽 띠 (기둥형): 바깥으로 0.07
    for u in PIL[w.name]:
        w.box(cn, u - 0.17, u + 0.17, PLINTH_H, CORNICE_Y0, OUTER, OUTER + 0.07, concrete_col(0.94, 0.02), 0.02, 3.0, (rnd.random(), rnd.random()), ('down',))

# ───────────────────────── 문·창 ─────────────────────────
FW = 0.11   # 틀 너비
def build_openings(w):
    pnn, mn, cn = PN(), MN(), C()
    for a, b, t in w.openings():
        y0 = 0.0 if t == 'door' else WIN_Y0
        y1 = DOOR_H if t == 'door' else WIN_Y1
        for face, (v0, v1) in (('o', (OUTER, OUTER + 0.035)), ('i', (INNER - 0.035, INNER))):
            w.box(pnn, a - FW, a, y0, y1, v0, v1, PAINT_FRAME, 0.0, 1.0)
            w.box(pnn, b, b + FW, y0, y1, v0, v1, PAINT_FRAME, 0.0, 1.0)
            w.box(pnn, a - FW, b + FW, y1, y1 + FW, v0, v1, PAINT_FRAME, 0.0, 1.0)
            if t == 'win': w.box(pnn, a - FW, b + FW, y0 - FW, y0, v0, v1, PAINT_FRAME, 0.0, 1.0)
        if t == 'door':
            w.box(mn, a, b, 0.0, 0.014, INNER, OUTER + 0.03, BARE, 0.0, 0.6)                 # 문턱판 (몸이 지나가는 높이는 그대로)
        else:
            w.box(cn, a - FW - 0.07, b + FW + 0.07, y0 - FW - 0.075, y0 - FW, OUTER, OUTER + 0.09, mul(WHITE, 0.92), 0.015, 2.0)   # 창턱 (바깥)
            # 가운데 세로·가로 살 (얇게). 유리는 깨져 남은 조각만
            um = (a + b) / 2
            w.box(pnn, um - 0.025, um + 0.025, y0, y1, -0.02, 0.02, PAINT_FRAME, 0.0, 1.0)
            w.box(pnn, a, b, (y0 + y1) / 2 - 0.025, (y0 + y1) / 2 + 0.025, -0.02, 0.02, PAINT_FRAME, 0.0, 1.0)
            gl = GL()
            for (pa, pb) in ((a, um), (um, b)):
                for (qa, qb) in ((y0, (y0 + y1) / 2), ((y0 + y1) / 2, y1)):
                    # 한 칸마다 구석 하나에 삼각형 조각 두 개
                    cu = rnd.choice((pa + 0.03, pb - 0.03)); cy = rnd.choice((qa + 0.03, qb - 0.03))
                    su = 1 if cu < (pa + pb) / 2 else -1; sy = 1 if cy < (qa + qb) / 2 else -1
                    L1, L2 = rnd.uniform(0.14, 0.26), rnd.uniform(0.1, 0.2)
                    tri(gl, w.pt(cu, cy, 0), w.pt(cu + su * L1, cy, 0), w.pt(cu, cy + sy * L2, 0), GLASS)
                    tri(gl, w.pt(cu + su * L1 * 0.5, cy + sy * L2 * 0.62, 0.002), w.pt(cu + su * L1 * 1.05, cy + sy * L2 * 0.25, 0.002), w.pt(cu + su * L1 * 0.7, cy + sy * L2 * 1.1, 0.002), GLASS)

def build_doors(w):
    p, pn, mn, wd = P(), PN(), MN(), WD()
    for a, b, t in w.openings():
        if t != 'door': continue
        wd_leaf = (b - a) / 2 - (0.0 if (b - a) > 2.5 else 0.2)
        for sgn, edge in ((-1, a - FW - 0.03), (+1, b + FW + 0.03)):
            u_in, u_out = (edge, edge + sgn * wd_leaf)
            ua, ub = min(u_in, u_out), max(u_in, u_out)
            y0_, y1_ = 0.06, 2.12
            # 바깥벽에 붙여 완전히 열린 철문 (납작한 판 + 테두리 + 가로 보강)
            w.box(p, ua, ub, y0_, y1_, OUTER + 0.045, OUTER + 0.085, PAINT_DOOR, 0.0, 1.2)
            for (ca, cb) in ((ua, ua + 0.07), (ub - 0.07, ub)): w.box(pn, ca, cb, y0_, y1_, OUTER + 0.085, OUTER + 0.105, PAINT_DOOR, 0.0, 1.0)
            for (cy0, cy1) in ((y0_, y0_ + 0.08), (y1_ - 0.08, y1_), (1.02, 1.1)): w.box(pn, ua, ub, cy0, cy1, OUTER + 0.085, OUTER + 0.105, PAINT_DOOR, 0.0, 1.0)
            hx = u_out - sgn * 0.12
            w.box(mn, hx - 0.025, hx + 0.025, 0.95, 1.2, OUTER + 0.105, OUTER + 0.145, BARE, 0.0, 0.5)    # 손잡이
            for hy in (0.45, 1.08, 1.75):
                ctr = u_in
                w.box(mn, ctr - 0.045, ctr + 0.045, hy - 0.06, hy + 0.06, OUTER + 0.035, OUTER + 0.07, BARE, 0.0, 0.5)
        # 캐노피: 문 위 (사람 머리 위, 2.55 m 이상이라 바깥으로 1 m 나가도 된다)
        uc = (a + b) / 2; half = (b - a) / 2 + 0.45
        w.box(p, uc - half, uc + half, 2.72, 2.77, OUTER, OUTER + 1.05, PAINT_FRAME, 0.0, 1.0)
        w.box(p, uc - half, uc + half, 2.77, 2.83, OUTER + 1.0, OUTER + 1.05, PAINT_FRAME, 0.0, 1.0)
        for s in (-1, 1):
            ub = uc + s * (half - 0.14)
            w.box(wd, ub - 0.045, ub + 0.045, 2.57, 2.72, OUTER, OUTER + 0.95, WHITE, 0.0, 1.0)             # 목재 보
            g0, g1 = w.pt(ub, 2.3, OUTER + 0.02), w.pt(ub, 2.58, OUTER + 0.8)
            bar(mn, g0, g1, 0.03, 0.05, BARE, 0.6)                                                           # 쇠 받침대

# ───────────────────────── 모서리·지붕 ─────────────────────────
def build_corners():
    cn = C()
    for sx in (-1, 1):
        for sz in (-1, 1):
            cx, cz = sx * (X1 - 0.225 + 0.0), sz * (Z1 - 0.225 + 0.0)
            # 기둥: 안쪽으로 0.15, 바깥으로 0.06
            x0, x1 = (X1 - T - 0.15, X1 + 0.06) if sx > 0 else (X0 - 0.06, X0 + T + 0.15)
            z0, z1 = (Z1 - T - 0.15, Z1 + 0.06) if sz > 0 else (Z0 - 0.06, Z0 + T + 0.15)
            box(cn, (x0 + x1) / 2, (PLINTH_H + CORNICE_Y0) / 2, (z0 + z1) / 2, x1 - x0, CORNICE_Y0 - PLINTH_H, z1 - z0, concrete_col(0.9, 0.01), 0.02, 3.0, (rnd.random(), rnd.random()), ('down',))

def build_roof():
    p, pn, cn, mn, m = P(), PN(), C(), MN(), M_()
    ex, ez = W / 2 + ROOF_OVER, D / 2 + ROOF_OVER
    box(p, 0, H + ROOF_T / 2, 0, 2 * ex, ROOF_T, 2 * ez, PAINT_ROOF, 0.0, 1.2)          # 지붕판 (충돌 박스와 같은 크기)
    f = 0.04
    for sz in (-1, 1): box(pn, 0, H + 0.025 - 0.0, sz * (ez + f / 2), 2 * ex + 2 * f, 0.55, f, PAINT_FRAME, 0.0, 1.0)  # 처마판 (바깥 고리, 안쪽 면은 지붕판 옆면)
    for sx in (-1, 1): box(pn, sx * (ex + f / 2), H + 0.025, 0, f, 0.55, 2 * ez, PAINT_FRAME, 0.0, 1.0)
    # 난간 턱 + 쇠 덮개
    pw, ph = 0.14, 0.2
    for sz in (-1, 1):
        box(cn, 0, H + ROOF_T + ph / 2, sz * (ez - 0.04 - pw / 2), 2 * ex - 0.08, ph, pw, concrete_col(1.0, 0.0), 0.012, 3.0, skip=('down',))
        box(mn, 0, H + ROOF_T + ph + 0.012, sz * (ez - 0.04 - pw / 2), 2 * ex - 0.04, 0.024, pw + 0.07, BARE, 0.0, 0.5)
    for sx in (-1, 1):
        box(cn, sx * (ex - 0.04 - pw / 2), H + ROOF_T + ph / 2, 0, pw, ph, 2 * ez - 0.08 - 2 * pw, concrete_col(1.0, 0.0), 0.012, 3.0, skip=('down',))
        box(mn, sx * (ex - 0.04 - pw / 2), H + ROOF_T + ph + 0.012, 0, pw + 0.07, 0.024, 2 * ez - 0.04 - 2 * pw, BARE, 0.0, 0.5)
    top = H + ROOF_T
    # 옥상 설비: 에어컨 실외기 · 환기구 · 배기통 · 점검 해치
    box(p, 3.6, top + 0.5, -2.2, 2.0, 1.0, 1.1, PAINT_UNIT, 0.02, 1.0, skip=('down',))
    cyl(mn, 3.1, top + 1.0, -2.2, 0.38, 0.05, 14, BARE, 0.8); cyl(mn, 4.1, top + 1.0, -2.2, 0.38, 0.05, 14, BARE, 0.8)
    box(pn, 3.6, top + 0.05, -2.2, 2.2, 0.1, 1.3, PAINT_FRAME, 0.0, 1.0, skip=('down',))
    for (vx, vz) in ((-4.0, 2.6), (-2.2, 3.4), (5.4, 3.0)):
        box(m, vx, top + 0.2, vz, 0.7, 0.4, 0.7, BARE, 0.02, 0.8, skip=('down',))
        box(m, vx, top + 0.45, vz, 0.86, 0.06, 0.86, BARE, 0.0, 0.8)
    cyl(m, -5.5, top, -2.6, 0.15, 1.35, 10, BARE, 0.8)
    cyl(m, -5.5, top + 1.35, -2.6, 0.3, 0.12, 10, BARE, 0.8, r2=0.02)
    box(cn, 0.0, top + 0.15, 3.0, 1.1, 0.3, 1.1, concrete_col(0.92, 0.0), 0.02, 3.0, skip=('down',))
    box(p, 0.0, top + 0.33, 3.0, 1.0, 0.06, 1.0, PAINT_UNIT, 0.0, 1.0)

def build_downspouts_and_extras():
    mn = MN()
    # 낙수관: 동서 벽 바깥면 (벽 띠·문짝과 겹치지 않는 자리). 바깥으로 0.125
    for sx, zz in ((1, -6.9), (1, 6.9), (-1, -6.9), (-1, 6.9)):
        x = sx * (X1 + 0.055 + 0.0) - sx * 0.0
        cyl(mn, x, 0.45, zz, 0.055, H - 0.5, 8, BARE, 0.6)
        for cy in (1.0, 2.2, 3.4): cyl(mn, x, cy, zz, 0.072, 0.07, 8, BARE, 0.6)

def build_interior():
    p, pn, mn = P(), PN(), MN()
    # 천장 보 (지붕판 아래로 0.5): 머리 위 3.7 m 이상이라 몸과 겹치지 않는다
    for bx in (-8, -4, 0, 4, 8):
        z0, z1 = Z0 + T, Z1 - T
        box(p, bx, H - 0.025, 0, 0.22, 0.05, z1 - z0, PAINT_BEAM, 0.0, 1.0)
        box(p, bx, H - 0.25, 0, 0.03, 0.4, z1 - z0, PAINT_BEAM, 0.0, 1.0)
        box(p, bx, H - 0.475, 0, 0.22, 0.05, z1 - z0, PAINT_BEAM, 0.0, 1.0)
    # 보 사이 가로 받침 (3줄)
    for pz in (-5.0, 0.0, 5.0):
        box(pn, 0, H - 0.52, pz, X1 - X0 - 2 * T, 0.05, 0.08, PAINT_BEAM, 0.0, 1.0)
    # 매달린 조명 (형광등 틀)
    for lx in (-6, -2, 2, 6):
        for lz in (-3.2, 3.2):
            box(pn, lx, 3.56, lz, 0.14, 0.07, 1.5, PAINT_UNIT, 0.0, 1.0)
            box(pn, lx, 3.5235, lz, 0.1, 0.003, 1.44, lin('#f6f3e8'), 0.0, 1.0, skip=('up',))   # 등 갓 아래 밝은 확산판
            for s in (-1, 1): bar(mn, (lx, H - 0.5, lz + s * 0.5), (lx, 3.6, lz + s * 0.5), 0.02, 0.02, BARE, 0.5)

def build_floor():
    """바닥 콘크리트 판 + 줄눈 + 노란 통로선·문 앞 빗금 + 문턱 쇠 + 문 밖 콘크리트 패드.
    모두 1~2 cm 높이(충돌 없음, 발이 묻히는 정도)라 이동·시야와 무관하다. 땅(y 0)과 겹쳐 깜빡이지 않게 판 윗면은 1.2 cm."""
    c, mn = C(), MN()
    TOPF = 0.012
    IX, IZ = X1 - T, Z1 - T                          # 안쪽 면 (±9.7, ±7.7)
    box(c, 0, TOPF / 2, 0, W - 0.04, TOPF, D - 0.04, (0.44, 0.42, 0.38, 1), 0.0, 3.0, (0.37, 0.11), skip=('down',))   # 벽보다 어둡고 따뜻한 바닥 (선형값)
    JOINT = mul(WHITE, 0.32); YEL = lin('#e0a53a'); LINE = 0.1
    strip = lambda x, z, sx, sz, col, h: box(c, x, TOPF + h / 2, z, sx, h, sz, col, 0.0, 3.0, skip=('down',))
    # 줄눈 (4 m 칸, 2 mm 위로): 통로선보다 높게 그려 페인트를 가로지른다
    for x in (-8, -4, 0, 4, 8): strip(x, 0, 0.012, 2 * IZ, JOINT, 0.004)
    for z in (-4, 0, 4): strip(0, z, 2 * IX, 0.012, JOINT, 0.004)
    # 통로선: 벽 안쪽 1 m. 문 앞은 끊는다
    def run(fixed, along_x, a, b, gaps):
        cur = a
        for g0, g1 in sorted(gaps) + [(b, b)]:
            if g0 > cur:
                m, L = (cur + g0) / 2, g0 - cur
                if along_x: strip(m, fixed, L, LINE, YEL, 0.002)
                else: strip(fixed, m, LINE, L, YEL, 0.002)
            cur = max(cur, g1)
    ex, ez = IX - 1.0, IZ - 1.0
    ns_gaps = [(-6 - 1.3 - 0.3, -6 + 1.3 + 0.3), (6 - 1.3 - 0.3, 6 + 1.3 + 0.3)]
    for sz in (-1, 1): run(sz * ez, True, -ex - LINE / 2, ex + LINE / 2, ns_gaps)
    for sx in (-1, 1): run(sx * ex, False, -ez + LINE / 2, ez - LINE / 2, [(-1.2 - 0.3, 1.2 + 0.3)])
    # 문 앞 빗금 구역 (문 폭 + 0.4, 깊이 1.0): 테두리 + 45° 빗금 3줄
    def zone(cx, cz, along_x, width, inward):
        depth = 0.95
        if along_x:
            zc = cz + inward * depth / 2
            for sx_ in (-1, 1): strip(cx + sx_ * (width / 2 - LINE / 2), zc, LINE, depth, YEL, 0.002)
            strip(cx, cz + inward * (depth - LINE / 2), width - 2 * LINE, LINE, YEL, 0.002)
            for k in (-1, 0, 1):
                box(c, cx + k * width / 4, TOPF + 0.001, zc, 0.08, 0.002, depth * 1.2, YEL, 0.0, 3.0, skip=('down',), rot=(0, 0, math.radians(45)))
        else:
            xc = cx + inward * depth / 2
            for sz_ in (-1, 1): strip(xc, cz + sz_ * (width / 2 - LINE / 2), depth, LINE, YEL, 0.002)
            strip(cx + inward * (depth - LINE / 2), cz, LINE, width - 2 * LINE, YEL, 0.002)
            for k in (-1, 0, 1):
                box(c, xc, TOPF + 0.001, cz + k * width / 4, depth * 1.2, 0.002, 0.08, YEL, 0.0, 3.0, skip=('down',), rot=(0, 0, math.radians(45)))
    for dx in (-6, 6):
        zone(dx, IZ, True, 3.0, -1); zone(dx, -IZ, True, 3.0, 1)
    zone(-IX, 0, False, 2.8, 1); zone(IX, 0, False, 2.8, -1)
    # 문턱 쇠 (문 구멍 안, 2 cm) · 문 밖 콘크리트 패드 (1.8 cm, 벽에서 0.9 m. 문짝 아래 쇠(1.4 cm)와 높이가 겹치지 않게)
    for dx in (-6, 6):
        for sz in (-1, 1):
            box(mn, dx, 0.01, sz * (Z1 - T / 2), 2.6 - 0.02, 0.02, T - 0.02, lin('#8c9296'), 0.0, 0.5, skip=('down',))
            box(c, dx, 0.009, sz * (Z1 + 0.45), 3.8, 0.018, 0.9, mul(WHITE, 0.7), 0.005, 3.0, (0.2, 0.6), skip=('down',))
    for sx in (-1, 1):
        box(mn, sx * (X1 - T / 2), 0.01, 0, T - 0.02, 0.02, 2.4 - 0.02, lin('#8c9296'), 0.0, 0.5, skip=('down',))
        box(c, sx * (X1 + 0.45), 0.009, 0, 0.9, 0.018, 3.6, mul(WHITE, 0.7), 0.005, 3.0, (0.5, 0.3), skip=('down',))

def main():
    reset()
    for w in WALLS:
        build_wall(w); build_openings(w); build_doors(w)
    build_corners(); build_roof(); build_downspouts_and_extras(); build_interior(); build_floor()
    export(OUT, TEX)

main()
