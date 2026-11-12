// 서버와 클라이언트가 함께 쓰는 게임 규칙 데이터
export const GOAL = 20;          // 승리에 필요한 킬 수 (FFA)
export const MAX_HP = 100;
export const RESPAWN_MS = 3000;
export const MATCH_RESTART_MS = 10000;
export const MATCH_TIME_MS = 5 * 60 * 1000; // 시간 제한 (킬 수 미달이면 최다 킬이 승리)
export const ROOM_MAX = 8;       // 방 최대 인원 (사람 + 봇)
export const BOT_FILL = 6;       // 사람이 적으면 봇으로 이 인원까지 채운다

// 각도 단위는 도(degree), 거리 m, 시간 s
export const WEAPONS = [
  {
    id: 'm4', name: 'M4A1', cls: '돌격소총', auto: true, rpm: 800,
    dmg: 26, head: 2.0, pellets: 1, mag: 30, reserve: 120, reload: 2.2,
    hip: 2.0, ads: 0.12, bloom: 0.12, bloomMax: 1.4, recoilV: 0.55, recoilH: 0.25,
    adsFov: 48, adsTime: 0.2, falloff: [35, 80, 0.7], move: 0.95, draw: 0.45,
    snd: { f: 1900, dur: 0.16, vol: 0.8, thump: 130 },
  },
  {
    id: 'ak', name: 'AK-47', cls: '돌격소총', auto: true, rpm: 600,
    dmg: 33, head: 2.0, pellets: 1, mag: 30, reserve: 120, reload: 2.5,
    hip: 2.4, ads: 0.18, bloom: 0.18, bloomMax: 1.8, recoilV: 0.85, recoilH: 0.4,
    adsFov: 50, adsTime: 0.22, falloff: [40, 90, 0.72], move: 0.93, draw: 0.5,
    snd: { f: 1400, dur: 0.2, vol: 0.9, thump: 105 },
  },
  {
    id: 'mp5', name: 'MP5', cls: '기관단총', auto: true, rpm: 800,
    dmg: 21, head: 1.8, pellets: 1, mag: 30, reserve: 150, reload: 1.9,
    hip: 1.4, ads: 0.3, bloom: 0.09, bloomMax: 1.1, recoilV: 0.38, recoilH: 0.2,
    adsFov: 55, adsTime: 0.15, falloff: [15, 40, 0.55], move: 1.0, draw: 0.35,
    snd: { f: 2400, dur: 0.11, vol: 0.6, thump: 160 },
  },
  {
    id: 'm870', name: 'M870', cls: '산탄총', auto: false, rpm: 75,
    dmg: 13, head: 1.5, pellets: 9, mag: 6, reserve: 30, reload: 0.5, shell: true,
    hip: 3.4, ads: 2.8, bloom: 0, bloomMax: 0, recoilV: 3.6, recoilH: 0.8,
    adsFov: 58, adsTime: 0.2, falloff: [8, 28, 0.25], move: 0.95, draw: 0.5,
    snd: { f: 900, dur: 0.3, vol: 1.0, thump: 80 },
  },
  {
    id: 'awm', name: 'AWM', cls: '저격소총', auto: false, rpm: 40,
    dmg: 90, head: 2.5, pellets: 1, mag: 5, reserve: 25, reload: 3.4, bolt: true,
    hip: 5.0, ads: 0.0, bloom: 0, bloomMax: 0, recoilV: 4.2, recoilH: 0.6,
    adsFov: 9, adsTime: 0.32, scope: true, falloff: null, move: 0.88, draw: 0.7,
    snd: { f: 1000, dur: 0.42, vol: 1.0, thump: 60 },
  },
  {
    id: 'm249', name: 'M249', cls: '경기관총', auto: true, rpm: 750,
    dmg: 28, head: 2.0, pellets: 1, mag: 100, reserve: 200, reload: 5.2,
    hip: 3.2, ads: 0.35, bloom: 0.1, bloomMax: 1.6, recoilV: 0.6, recoilH: 0.38,
    adsFov: 50, adsTime: 0.35, falloff: [45, 100, 0.75], move: 0.82, draw: 0.8,
    snd: { f: 1500, dur: 0.18, vol: 0.9, thump: 95 },
  },
  {
    id: 'm9', name: 'M9', cls: '권총', auto: false, rpm: 420,
    dmg: 24, head: 2.0, pellets: 1, mag: 15, reserve: 60, reload: 1.5,
    hip: 1.2, ads: 0.25, bloom: 0.25, bloomMax: 1.5, recoilV: 1.1, recoilH: 0.35,
    adsFov: 60, adsTime: 0.12, falloff: [15, 40, 0.6], move: 1.05, draw: 0.25,
    snd: { f: 2600, dur: 0.1, vol: 0.55, thump: 170 },
  },
];

export function calcDamage(wi, part, dist) {
  const w = WEAPONS[wi];
  if (!w) return 0;
  let d = w.dmg;
  if (part === 'head') d *= w.head;
  else if (part === 'leg') d *= 0.75;
  if (w.falloff) {
    const [a, b, m] = w.falloff;
    const k = Math.min(1, Math.max(0, (dist - a) / (b - a)));
    d *= 1 - (1 - m) * k;
  }
  return d;
}

// 부활 지점 [x, z] — 맵은 원점 대칭
const HALF = [[0, -54], [-30, -53], [-47, -46], [30, -53], [48, -48], [-52, -14], [52, -24]];
export const SPAWNS = [...HALF, ...HALF.map(([x, z]) => [-x, -z])];
