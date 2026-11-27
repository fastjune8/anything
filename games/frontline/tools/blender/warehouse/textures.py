# 창고용 절차적 텍스처 생성 (numpy + PIL). 반복해도 이음매가 안 보이도록 FFT 노이즈로 만든다.
#   Blender 없이도 돌아간다:  python3 textures.py <출력 폴더>
# 종류와 해상도(메모리 관리): concrete 512(색·법선)+256(ORM) / paint 256+512(법선, 골판)+128 / metal 128+256+128 / wood 256+256(법선)+128
#   ORM = R 가림(1) · G 거칠기 · B 금속성 (glTF 규칙)
import os, sys
import numpy as np
from PIL import Image

def fnoise(n, beta, seed, stretch=(1.0, 1.0)):
    """타일 반복되는 1/f^beta 노이즈 (평균 0, 표준편차 1). stretch 로 한 방향으로 길게 늘인다 (물때·솔질 자국)"""
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(n)
    fx, fy = np.meshgrid(f * stretch[0], f * stretch[1])
    r = np.sqrt(fx ** 2 + fy ** 2); r[0, 0] = 1
    spec = (rng.normal(size=(n, n)) + 1j * rng.normal(size=(n, n))) / r ** beta
    spec[0, 0] = 0
    a = np.fft.ifft2(spec).real
    return (a - a.mean()) / a.std()

def normal_from_height(h, strength):
    # 이미지 위쪽이 +v: 행이 늘어나는 쪽이 아래
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) * 0.5
    n = np.stack([-dx * strength, -dy * strength, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5

def save(a, path, fmt='PNG', q=88):
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
    im.save(path, fmt, **({'quality': q} if fmt == 'JPEG' else {}))
    return os.path.getsize(path)

def resize(a, n):
    if a.shape[0] == n: return a
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)).resize((n, n), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255

def hexc(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255

def concrete(out):
    N = 512
    low, mid, fine = fnoise(N, 2.4, 1), fnoise(N, 1.6, 2), fnoise(N, 0.9, 3)
    streak = fnoise(N, 2.0, 4, stretch=(1.0, 0.07))            # 세로 물때 (위아래로 길다)
    pores = np.clip(fnoise(N, 0.4, 5) - 2.2, 0, None)          # 드문 작은 구멍
    base = hexc('#c9c2b2')
    v = 1 + 0.06 * low + 0.035 * mid + 0.02 * fine - 0.05 * np.clip(streak, 0, None) - 0.45 * pores
    col = base[None, None, :] * v[..., None]
    col[..., 2] *= 1 - 0.015 * low                              # 얼룩이 살짝 따뜻/차갑게
    save(col, os.path.join(out, 'concrete_bc.jpg'), 'JPEG')
    h = 0.55 * mid + 0.35 * fine - 1.4 * pores
    save(normal_from_height(h, 0.55), os.path.join(out, 'concrete_n.png'))
    rough = np.clip(0.86 + 0.05 * low + 0.04 * fine + 0.1 * pores, 0.6, 1)
    orm = np.stack([np.ones_like(rough), rough, np.zeros_like(rough)], -1)
    save(resize(orm, 256), os.path.join(out, 'concrete_orm.png'))

def paint(out):
    N = 256
    rib = 0.5 + 0.5 * np.sin(np.linspace(0, 2 * np.pi * 4, N, endpoint=False))[None, :]   # 골판: 한 타일에 4줄 (가로로 반복)
    rib = np.repeat(rib, N, 0)
    peel, scuff = fnoise(N, 1.2, 11), fnoise(N, 0.8, 12, stretch=(1.0, 0.25))
    v = 1 + 0.03 * peel - 0.04 * np.clip(scuff - 1.0, 0, None) - 0.05 * (1 - rib)
    col = np.stack([v, v, v], -1) * 0.92
    save(col, os.path.join(out, 'paint_bc.jpg'), 'JPEG')
    n = normal_from_height(rib * 2.2 + 0.25 * peel, 1.0)
    save(n, os.path.join(out, 'paint_n.png'))
    rough = np.clip(0.52 + 0.04 * peel + 0.1 * np.clip(scuff - 0.8, 0, None), 0.35, 0.9)
    save(resize(np.stack([np.ones_like(rough), rough, np.zeros_like(rough)], -1), 128), os.path.join(out, 'paint_orm.png'))

def metal(out):
    streak = fnoise(256, 1.4, 21, stretch=(1.0, 0.04))          # 솔질 자국 (가로로 길다)
    spot = fnoise(256, 1.8, 22)
    v = 1 + 0.045 * streak + 0.03 * spot
    base = hexc('#aab0b5')
    save(resize(base[None, None, :] * v[..., None], 128), os.path.join(out, 'metal_bc.jpg'), 'JPEG')
    save(normal_from_height(0.5 * streak + 0.15 * spot, 0.45), os.path.join(out, 'metal_n.png'))
    rough = np.clip(0.42 + 0.06 * streak + 0.05 * spot, 0.25, 0.7)
    save(resize(np.stack([np.ones_like(rough), rough, np.ones_like(rough)], -1), 128), os.path.join(out, 'metal_orm.png'))

def wood(out):
    N = 256
    grain = fnoise(N, 1.8, 31, stretch=(1.0, 0.05))             # 결: 가로로 길다
    knots = fnoise(N, 2.2, 32)
    plank = (np.arange(N) // 64 % 2)[:, None] * 0.05            # 널 4장 (가로 줄이 아니라 이음새 색 차이)
    v = 1 + 0.10 * grain + 0.04 * knots - plank
    seam = np.zeros((N, N)); seam[::64, :] = 1; seam[1::64, :] = 0.5
    col = hexc('#a87a40')[None, None, :] * v[..., None] * (1 - 0.35 * seam[..., None])
    save(col, os.path.join(out, 'wood_bc.jpg'), 'JPEG')
    # 법선: 결 + 널 이음새 홈 (감시탑처럼 나무 면이 넓은 에셋용. 256px)
    save(normal_from_height(0.35 * grain + 0.1 * knots - 2.5 * seam, 0.9), os.path.join(out, 'wood_n.png'))
    rough = np.clip(0.78 + 0.06 * grain + 0.12 * seam, 0.55, 0.95)
    save(resize(np.stack([np.ones_like(rough), rough, np.zeros_like(rough)], -1), 128), os.path.join(out, 'wood_orm.png'))

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    for f in (concrete, paint, metal, wood): f(out)
    tot = 0
    for fn in sorted(os.listdir(out)):
        sz = os.path.getsize(os.path.join(out, fn)); tot += sz
        print(f'{fn:20s} {Image.open(os.path.join(out, fn)).size}  {sz / 1024:.0f} KB')
    print(f'합계 {tot / 1024:.0f} KB')
