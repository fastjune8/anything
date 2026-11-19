// 결정적 난수: 같은 씨앗 → 같은 값. 탄퍼짐 방향을 서버와 브라우저가 똑같이 계산하는 데 쓴다
// (브라우저가 그린 탄 자국 = 서버가 판정한 탄 방향).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 플레이어 id · 몇 번째 사격인가 → 씨앗
export const shotSeed = (id, n) => (Math.imul((id | 0) + 1, 0x9e3779b1) ^ Math.imul((n | 0) + 7, 0x85ebca6b)) >>> 0;
