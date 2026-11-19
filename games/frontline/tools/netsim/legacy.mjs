// 개선 전(v3.0.0) 클라이언트의 시계·보간을 그대로 옮긴 것 — 개선 효과를 같은 조건에서 비교하려고 남겨 둔다 (client/js/clock.js · remotes.js 의 sample 원본).
const TICK_HZ = 60, INTERP_TICKS = 6;
const angLerp = (a, b, t) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

export class LegacyClock {
  constructor(nowMs = () => performance.now()) { this.nowMs = nowMs; this.off = null; }
  onTick(n) {
    const est = n - this.nowMs() * TICK_HZ / 1000;
    if (this.off === null || est > this.off) this.off = est;
    else this.off += (est - this.off) * 0.02;
  }
  update() {}
  now() { return this.off === null ? 0 : this.off + this.nowMs() * TICK_HZ / 1000; }
  render() { return this.now() - INTERP_TICKS; }
}
// 반환: { x, y, z, ..., under } 또는 null. under = 최신 스냅샷보다 앞서 가는 중 (예측으로 그림)
export function legacySample(b, rt) {
  if (!b.length) return null;
  let i = b.length - 1;
  while (i > 0 && b[i - 1].n > rt) i--;
  const B = b[i], A = i > 0 ? b[i - 1] : null;
  if (A && A.n <= rt && B.n > A.n) {
    const k = Math.min(1, (rt - A.n) / (B.n - A.n));
    return { x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, z: A.z + (B.z - A.z) * k, yaw: angLerp(A.yaw, B.yaw, k), vx: B.vx, vz: B.vz, under: false };
  }
  const ex = Math.max(0, Math.min(3, rt - B.n)) / 60;
  return { x: B.x + B.vx * ex, y: B.y + B.vy * ex, z: B.z + B.vz * ex, yaw: B.yaw, vx: B.vx, vz: B.vz, under: rt > B.n };
}
export const legacy = { name: 'legacy', makeClock: now => new LegacyClock(now), sample: legacySample };
