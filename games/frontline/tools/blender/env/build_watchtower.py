# Outpost 감시탑 (서쪽 저격 자리, 맵 x -47, z 0) → content/assets/watchtower.glb
#   python3 build_watchtower.py <출력.glb> --tex <textures.py 출력 폴더>
#   공통 도구·재질: envkit.py  ·  규칙: docs/ENV_ASSET_PIPELINE.md
#
# 원점 = 탑 가운데 바닥. 충돌체 (shared/maps/parts.js tower(), 그대로 둔다):
#   다리 4개 (±1.8, ±1.8) 0.25 × 3.0 · 바닥판 4 × 4, y 3.0~3.2 · 기둥 0.12 × 2.1 · 지붕판 4.6 × 4.6, y 5.3~5.42
#   난간 높이 1.0 두께 0.12 (서쪽은 z ±0.62 사이가 계단 입구) · 계단 10단 (서쪽, x −6.5~−2.0, 폭 1.2, 단 높이 0.32, 디딤판 두께 0.12)
# 디자인: 강철 다리 + 콘크리트 기초 + 나무 바닥·난간 판 + 골판 지붕. 다리 사이(사람 키 높이)는 비워 둔다 —
#   충돌이 없는 곳을 가새로 막아 보이게 하지 않는다 (무릎 가새는 머리 위 2.5 m 이상에만)
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd())
from envkit import *

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = args[0] if args and not args[0].startswith('--') else 'watchtower.glb'
TEX = args[args.index('--tex') + 1] if '--tex' in args else '_tex'

TOP, DECK_T, LEG, LX = 3.2, 0.2, 0.25, 1.8
POST, ROOF_Y, ROOF_T, ROOF_W = 0.12, 5.3, 0.12, 4.6
RAIL_H, RAIL_T, RAIL_C = 1.0, 0.12, 1.94
N_STEP, RISE, RUN, STEP_T, STEP_W = 10, TOP / 10, 0.45, 0.12, 1.2
X_STAIR0 = -2 - RUN * N_STEP                     # 계단 아래 끝 (x −6.5)

STEEL = lin('#4a545b')        # 다리·가새 (어두운 칠한 강철)
FRAME = lin('#56626b')        # 기둥·난간 뚜껑 (팔레트 청회색)
FASCIA = lin('#3d4448')       # 바닥판 테두리
ROOF = lin('#6d7274')
HAZARD = lin('#e8a33a')       # 계단 입구 경고 띠 (Outpost trim 색)
CONC = mul(WHITE, 0.78)

def legs():
    m, mn, c = M_(), MN(), C()
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = sx * LX, sz * LX
            box(c, x, 0.15, z, 0.4, 0.3, 0.4, CONC, 0.03, 2.0, skip=('down',))                         # 기초 (다리 겉면에서 0.075)
            box(m, x, 0.3 + (TOP - DECK_T - 0.3) / 2, z, LEG, TOP - DECK_T - 0.3, LEG, STEEL, 0.02, 1.0, skip=('down',))
            for y in (0.36, TOP - DECK_T - 0.1): box(mn, x, y, z, LEG + 0.03, 0.06, LEG + 0.03, STEEL, 0.0, 1.0)   # 띠쇠
            # 무릎 가새: 다리 안쪽 면에서 바닥판 밑으로 (2.55 m 위라 지나가는 몸과 겹치지 않는다)
            bar(mn, (x - sx * 0.13, 2.55, z), (x - sx * 0.9, TOP - DECK_T - 0.04, z), 0.08, 0.08, STEEL, 1.0)
            bar(mn, (x, 2.55, z - sz * 0.13), (x, TOP - DECK_T - 0.04, z - sz * 0.9), 0.08, 0.08, STEEL, 1.0)

def deck():
    w, p, pn = WDS(), P(), PN()
    half = 2.0
    # 널판 (윗면 3.06~3.2): 결은 x 방향, 텍스처 이음새가 널 너비(0.485)와 맞게 tile = 1.94
    n = 8
    for i in range(n):
        z0 = -half + 0.06 + (2 * half - 0.12) * i / n; z1 = -half + 0.06 + (2 * half - 0.12) * (i + 1) / n
        box(w, 0, TOP - 0.07, (z0 + z1) / 2, 2 * half - 0.12, 0.14, z1 - z0, mul(WHITE, 0.92 + 0.12 * ((i * 5) % 3) / 2), 0.0, 1.94, (0, 0.03 * i))
    # 장선 (밑에서 보이는 것): 3.0~3.06
    for z in (-1.2, 0.0, 1.2): box(w, 0, TOP - DECK_T + 0.03, z, 2 * half - 0.12, 0.06, 0.12, mul(WHITE, 0.8), 0.0, 1.94, skip=('up',))
    # 테두리 철판 (바닥판 옆면 0.2, 바깥 0.06 두께 = 충돌 상자 안)
    for sz in (-1, 1): box(p, 0, TOP - DECK_T / 2, sz * (half - 0.03), 2 * half, DECK_T, 0.06, FASCIA, 0.0, 1.0)
    for sx in (-1, 1): box(p, sx * (half - 0.03), TOP - DECK_T / 2, 0, 0.06, DECK_T, 2 * half - 0.12, FASCIA, 0.0, 1.0)

def posts_and_roof():
    p, pn, mn = P(), PN(), MN()
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(p, sx * LX, TOP + (ROOF_Y - TOP) / 2, sz * LX, POST, ROOF_Y - TOP, POST, FRAME, 0.01, 1.0, skip=('down', 'up'))
    # 지붕: 골판(윗면 5.36~5.42) + 밑 테두리 틀(5.3~5.36) + 도리 2줄
    box(p, 0, ROOF_Y + 0.03 + 0.03, 0, ROOF_W, 0.06, ROOF_W, ROOF, 0.0, 0.5)
    h = ROOF_W / 2
    for sz in (-1, 1): box(pn, 0, ROOF_Y + 0.03, sz * (h - 0.05), ROOF_W - 0.02, 0.06, 0.08, FRAME, 0.0, 1.0, skip=('up',))
    for sx in (-1, 1): box(pn, sx * (h - 0.05), ROOF_Y + 0.03, 0, 0.08, 0.06, ROOF_W - 0.18, FRAME, 0.0, 1.0, skip=('up',))
    for z in (-0.75, 0.75): box(pn, 0, ROOF_Y + 0.03, z, ROOF_W - 0.16, 0.06, 0.06, FRAME, 0.0, 1.0, skip=('up',))
    # 투광등 (북동 기둥 위, 지붕 밑. 머리 위)
    box(mn, LX - 0.2, ROOF_Y - 0.12, LX - 0.2, 0.22, 0.14, 0.18, lin('#2f3437'), 0.015, 0.5)
    box(mn, LX - 0.2, ROOF_Y - 0.12, LX - 0.29, 0.18, 0.1, 0.004, lin('#f2efe0'), 0.0, 0.5)

def rails():
    w, pn = WDS(), PN()
    segs = [  # (가운데 x, 가운데 z, 크기 x, 크기 z)
        (0, -RAIL_C, 4.0, RAIL_T), (0, RAIL_C, 4.0, RAIL_T), (RAIL_C, 0, RAIL_T, 3.76),
        (-RAIL_C, -1.25, RAIL_T, 1.26), (-RAIL_C, 1.25, RAIL_T, 1.26)]
    for cx, cz, sx, sz in segs:
        along_z = sz > sx
        # 널 4장 높이 (텍스처 이음새 0.25 m 마다 = tile 1.0, y 3.2 에서 시작하도록 v 를 밀어 맞춘다). 결은 가로
        box(w, cx, TOP + RAIL_H / 2, cz, sx, RAIL_H, sz, mul(WHITE, 0.95), 0.012, 1.0, (0, -0.2), skip=('down',), swap=False)
        # 뚜껑 (위로 0.04, 양옆으로 0.02)
        box(pn, cx, TOP + RAIL_H + 0.02, cz, sx + (0 if along_z else 0.0) + (0.04 if along_z else 0), 0.04, sz + (0.04 if not along_z else 0), FRAME, 0.0, 1.0)

def stairs():
    w, p, mn = WDS(), P(), MN()
    for i in range(N_STEP):
        x0 = X_STAIR0 + RUN * i
        top = RISE * (i + 1)
        box(w, x0 + RUN / 2, top - STEP_T / 2, 0, RUN, STEP_T, STEP_W, mul(WHITE, 0.9 + 0.1 * (i % 2)), 0.01, 1.2, swap=True)
        box(mn, x0 + 0.02, top - 0.025, 0, 0.05, 0.062, STEP_W, HAZARD if i in (0, N_STEP - 1) else lin('#8c9296'), 0.0, 0.5)   # 앞 모서리 쇠 (위로 6 mm, 첫·끝 단은 경고색)
    # 옆판 (두께 0.05, 디딤판 양옆 바깥). 위 = 디딤판 가운데 선 + 0.2, 아래 = − 0.3. 아래 끝은 첫 단 밑 0.14 에서 자른다
    k = RISE / RUN
    Lc = lambda x: RISE * ((x - X_STAIR0 - RUN / 2) / RUN + 1)
    xa, xb = X_STAIR0, -2.0
    prof = [(xa, RISE - STEP_T - 0.14), (xb, Lc(xb) - 0.3), (xb, Lc(xb) + 0.2), (xa, Lc(xa) + 0.2)]
    for sz in (-1, 1):
        z0, z1 = (STEP_W / 2, STEP_W / 2 + 0.05) if sz > 0 else (-STEP_W / 2 - 0.05, -STEP_W / 2)
        prism(p, prof, z0, z1, STEEL, 1.0)

reset()
legs(); deck(); posts_and_roof(); rails(); stairs()
export(OUT, TEX)
