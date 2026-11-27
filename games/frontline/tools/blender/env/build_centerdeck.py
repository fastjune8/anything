# Outpost 가운데 데크 (맵 중심 2층 발판 + 경사로 2 + 계단 2 + 철판 난간 4) → content/assets/centerdeck.glb
#   python3 build_centerdeck.py <출력.glb> --tex <textures.py 출력 폴더>
#   공통 도구·재질: envkit.py  ·  규칙: docs/ENV_ASSET_PIPELINE.md
#
# 원점 = 맵 중심 바닥 (데크 가운데). 충돌체 (content/maps/outpost.json 의 platform·ramp·stairs·box, 그대로 둔다):
#   바닥판 10 × 10, y 2.1~2.4 · 기둥 (±4.75, ±4.75) 0.35 · 경사로 폭 3: 북 z 5~11 (z 5 가 높다), 남 z −11~−5
#   계단 폭 2, 8단 (단 0.3 × 0.625): 서 x −10~−5 (z 2~4), 동 x 5~10 (z −4~−2)
#   철판 난간 높이 1 (y 2.4~3.4): 동 x 4.45~4.75 z 2~5 · 서 x −4.75~−4.45 z −5~−2 · 북 x −4.5~−0.5 z 4.7~5 · 남 x 0.5~4.5 z −5~−4.7
# 디자인: 프리캐스트 콘크리트 판 4장(이음 홈) + 판 밑 테두리 보 + 기둥머리 + 철판 난간(세로 보강·손스침·아래 경고띠)
#   경사로 미끄럼 방지 쇠띠, 계단 앞 모서리 쇠. 데크 밑(사람 키)은 보 깊이 0.14 m 만 내려온다 (충돌 바닥 2.1 → 보 1.96)
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd())
from envkit import *

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = args[0] if args and not args[0].startswith('--') else 'centerdeck.glb'
TEX = args[args.index('--tex') + 1] if '--tex' in args else '_tex'

HALF, TOP, SLAB = 5.0, 2.4, 0.3
BOT = TOP - SLAB
PIL, PIL_C = 0.35, 4.75
RAMP_W, RAMP_L = 3.0, 6.0
ST_N, ST_RUN, ST_RISE, ST_W = 8, 0.625, 0.3, 2.0
RAILS = [(4.45, 4.75, 2.0, 5.0), (-4.75, -4.45, -5.0, -2.0), (-4.5, -0.5, 4.7, 5.0), (0.5, 4.5, -5.0, -4.7)]   # x0, x1, z0, z1
RAIL_H = 1.0

CONC = lambda k: mul(WHITE, k)
CONC_DARK = mul(WHITE, 0.14)                  # 계단 = Outpost concreteDark 쪽 (선형값. 콘크리트 텍스처에 곱해 #5f5a55 근처)
PANEL = lin('#6d7274'); FRAME = lin('#56626b'); RIB = lin('#5f6567')
HAZARD = lin('#e8a33a'); STEEL = lin('#8c9296')

def slab():
    c = C()
    n = 4   # 판 4 × 4 장 (2.5 m): 모서리 깎기로 이음 홈이 생기고, 판마다 밝기·무늬 위치를 조금씩 다르게 (넓은 윗면이 한 장처럼 밋밋하지 않게)
    import random; rr = random.Random(3)
    for i in range(n):
        for k in range(n):
            x0, z0 = -HALF + 2 * HALF * i / n, -HALF + 2 * HALF * k / n
            box(c, x0 + HALF / n, BOT + SLAB / 2, z0 + HALF / n, 2 * HALF / n, SLAB, 2 * HALF / n, CONC(rr.uniform(0.8, 0.9)), 0.03, 3.0, (rr.random(), rr.random()))
    # 판 밑 테두리 보 (0.14 깊이, 바깥 면은 판 옆면에서 1 cm 안). x 방향 보와 z 방향 보는 밑면 높이를 5 mm 다르게 (겹친 면이 깜빡이지 않게)
    for sz in (-1, 1): box(c, 0, (BOT + BOT - 0.14) / 2, sz * (HALF - 0.15), 2 * HALF - 0.02, 0.14, 0.28, CONC(0.86), 0.0, 3.0, skip=('up',))
    for sx in (-1, 1): box(c, sx * (HALF - 0.15), (BOT + BOT - 0.135) / 2, 0, 0.28, 0.135, 2 * HALF - 0.58, CONC(0.86), 0.0, 3.0, skip=('up',))
    # 가운데 십자 보
    box(c, 0, BOT - 0.07, 0, 2 * HALF - 0.6, 0.14, 0.24, CONC(0.84), 0.0, 3.0, skip=('up',))
    box(c, 0, BOT - 0.0675, 0, 0.24, 0.135, 2 * HALF - 0.6, CONC(0.84), 0.0, 3.0, skip=('up',))

def pillars():
    c, mn = C(), MN()
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = sx * PIL_C, sz * PIL_C
            box(c, x, (BOT - 0.15) / 2, z, PIL, BOT - 0.15, PIL, CONC(0.82), 0.02, 3.0, skip=('down',))
            box(c, x, BOT - 0.075, z, 0.46, 0.15, 0.46, CONC(0.88), 0.015, 3.0, skip=('up',))          # 기둥머리 (1.95~2.1)
            box(mn, x, 0.02, z, 0.45, 0.04, 0.45, STEEL, 0.0, 0.6, skip=('down',))                       # 바닥 판
            for ox, oz in ((-0.17, -0.17), (0.17, -0.17), (-0.17, 0.17), (0.17, 0.17)):
                cyl(mn, x + ox, 0.04, z + oz, 0.025, 0.03, 6, STEEL, 0.5)                                 # 볼트

def edge_trim():
    """판 윗면 모서리 쇠(5 mm 턱)와 그 안쪽 경고띠 (3 mm). 난간이 선 자리는 뺀다"""
    mn, pn = MN(), PN()
    def free(a, b, fixed, along_x):
        cuts = sorted((r[0], r[1]) if along_x else (r[2], r[3]) for r in RAILS
                      if (abs(((r[2] + r[3]) / 2 if along_x else (r[0] + r[1]) / 2) - fixed) < 0.4))
        out, cur = [], a
        for c0, c1 in cuts:
            if c1 <= cur or c0 >= b: continue
            if c0 > cur: out.append((cur, c0))
            cur = max(cur, c1)
        if cur < b: out.append((cur, b))
        return out
    for sz in (-1, 1):
        for a, b in free(-HALF, HALF, sz * (HALF - 0.15), True):
            box(mn, (a + b) / 2, TOP - 0.02, sz * (HALF - 0.022), b - a, 0.05, 0.05, STEEL, 0.0, 0.5)
            box(pn, (a + b) / 2, TOP + 0.0015, sz * (HALF - 0.17), max(0.01, b - a - 0.2), 0.003, 0.1, HAZARD, 0.0, 1.0)
    for sx in (-1, 1):
        for a, b in free(-HALF + 0.05, HALF - 0.05, sx * (HALF - 0.15), False):
            box(mn, sx * (HALF - 0.022), TOP - 0.02, (a + b) / 2, 0.05, 0.05, b - a, STEEL, 0.0, 0.5)
            box(pn, sx * (HALF - 0.17), TOP + 0.0015, (a + b) / 2, 0.1, 0.003, max(0.01, b - a - 0.4), HAZARD, 0.0, 1.0)

def rails():
    p, pn, mn = P(), PN(), MN()
    for x0, x1, z0, z1 in RAILS:
        cx, cz, sx, sz = (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0
        along_x = sx > sz
        box(p, cx, TOP + RAIL_H / 2, cz, sx, RAIL_H, sz, PANEL, 0.01, 1.0, skip=('down',))                # 철판 (충돌 상자 그대로)
        L = sx if along_x else sz
        # 손스침 (위로 0.05, 양옆 0.02)
        box(mn, cx, TOP + RAIL_H + 0.025, cz, sx + (0 if along_x else 0.04), 0.05, sz + (0.04 if along_x else 0), STEEL, 0.0, 0.5)
        # 세로 보강 (양면, 0.015 튀어나옴) + 아래 경고띠 (양면, 3~7 mm: 뒷면이 보강재 뒷면과 같은 평면이 되지 않게)
        n = max(2, round(L / 0.75))
        for side in (-1, 1):
            for i in range(n + 1):
                u = -L / 2 + 0.05 + (L - 0.1) * i / n
                if along_x: box(pn, cx + u, TOP + RAIL_H / 2, cz + side * (sz / 2 + 0.0075), 0.06, RAIL_H - 0.04, 0.015, FRAME, 0.0, 1.0)
                else: box(pn, cx + side * (sx / 2 + 0.0075), TOP + RAIL_H / 2, cz + u, 0.015, RAIL_H - 0.04, 0.06, FRAME, 0.0, 1.0)
            if along_x: box(pn, cx, TOP + 0.08, cz + side * (sz / 2 + 0.005), L - 0.1, 0.12, 0.004, HAZARD, 0.0, 1.0)
            else: box(pn, cx + side * (sx / 2 + 0.005), TOP + 0.08, cz, 0.004, 0.12, L - 0.1, HAZARD, 0.0, 1.0)

def ramp(sz):
    """sz = +1 북 (z 5~11) / −1 남. 데크 쪽(|z| = 5)이 높다"""
    c, mn = C(), MN()
    hw, zh, zl = RAMP_W / 2, sz * HALF, sz * (HALF + RAMP_L)
    P_ = lambda x, y, z: (x, y, z)
    col = CONC(0.9)
    A, Bp = P_(-hw, 0, zl), P_(hw, 0, zl)            # 낮은 끝
    Ch, Dh = P_(hw, TOP, zh), P_(-hw, TOP, zh)       # 높은 끝 윗모서리
    Cb, Db = P_(hw, 0, zh), P_(-hw, 0, zh)
    if sz > 0:
        quad(c, A, Bp, Ch, Dh, col, 3.0)                                       # 경사면 (+y·+z 쪽을 본다)
        tri(c, Bp, Cb, Ch, CONC(0.8)); tri(c, A, Dh, Db, CONC(0.8))            # 옆면
        quad(c, Cb, Db, P_(-hw, BOT, zh), P_(hw, BOT, zh), CONC(0.78), 3.0)    # 높은 끝 (데크 밑에서 보이는 0~2.1)
    else:
        quad(c, Bp, A, Dh, Ch, col, 3.0)
        tri(c, Cb, Bp, Ch, CONC(0.8)); tri(c, Dh, A, Db, CONC(0.8))
        quad(c, Db, Cb, P_(hw, BOT, zh), P_(-hw, BOT, zh), CONC(0.78), 3.0)
    # 미끄럼 방지 쇠띠 (경사면 위로 1 cm 안팎) · 옆 모서리 쇠
    for i in range(1, 10):
        t = i / 10; z = zl + (zh - zl) * t; y = TOP * t
        box(mn, 0, y + 0.004, z, RAMP_W - 0.3, 0.02, 0.05, STEEL, 0.0, 0.5)
    for sx in (-1, 1): bar(mn, (sx * hw, 0.03, zl), (sx * hw, TOP + 0.005, zh), 0.05, 0.05, STEEL, 0.6)   # 바닥에 묻히지 않게 3 cm 위

def stairs(sx):
    """sx = −1 서쪽 (x −10~−5, z 2~4, 동쪽으로 오른다) / +1 동쪽 (x 5~10, z −4~−2, 서쪽으로 오른다)"""
    c, mn = C(), MN()
    zc = -sx * 3.0; z0, z1 = zc - ST_W / 2, zc + ST_W / 2
    far = sx * (HALF + ST_N * ST_RUN)                 # 낮은 끝 x (±10)
    for i in range(ST_N):
        xa = far - sx * ST_RUN * i                    # 이 단의 앞(낮은 쪽) x
        xb = far - sx * ST_RUN * (i + 1)
        y0, y1 = ST_RISE * i, ST_RISE * (i + 1)
        lo, hi = min(xa, xb), max(xa, xb)
        col = mul(CONC_DARK, 1.0 + 0.04 * (i % 2))
        # 디딤면 (윗면)
        quad(c, (lo, y1, z1), (hi, y1, z1), (hi, y1, z0), (lo, y1, z0), col, 3.0)
        # 챌면 (앞)
        if sx < 0: quad(c, (xa, y0, z1), (xa, y1, z1), (xa, y1, z0), (xa, y0, z0), mul(col, 0.92), 3.0)   # 서쪽을 본다
        else: quad(c, (xa, y0, z0), (xa, y1, z0), (xa, y1, z1), (xa, y0, z1), mul(col, 0.92), 3.0)       # 동쪽을 본다
        # 옆면 (z0 쪽은 −z, z1 쪽은 +z 를 본다)
        quad(c, (lo, 0, z0), (lo, y1, z0), (hi, y1, z0), (hi, 0, z0), mul(col, 0.88), 3.0)
        quad(c, (hi, 0, z1), (hi, y1, z1), (lo, y1, z1), (lo, 0, z1), mul(col, 0.88), 3.0)
        # 앞 모서리 쇠 (위로 5 mm, 앞으로 5 mm). 첫·끝 단은 경고색
        box(mn, xa - sx * 0.02, y1 - 0.0225, zc, 0.05, 0.055, ST_W - 0.04, HAZARD if i in (0, ST_N - 1) else STEEL, 0.0, 0.5)
    # 뒤(높은 끝) 면: 데크 밑에서 보이는 0~2.1
    xe = sx * HALF
    if sx < 0: quad(c, (xe, 0, z0), (xe, BOT, z0), (xe, BOT, z1), (xe, 0, z1), mul(CONC_DARK, 0.85), 3.0)
    else: quad(c, (xe, 0, z1), (xe, BOT, z1), (xe, BOT, z0), (xe, 0, z0), mul(CONC_DARK, 0.85), 3.0)

reset()
slab(); pillars(); edge_trim(); rails()
ramp(1); ramp(-1); stairs(-1); stairs(1)
export(OUT, TEX)
