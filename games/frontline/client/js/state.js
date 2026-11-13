// 여러 모듈이 같이 읽고 쓰는 게임 상태.
// 모듈 간에 값을 공유하려면 객체의 속성으로 바꿔야 하므로 (wp.cur = 3), 변수 대신 이 객체들을 쓴다.
import { MAX_HP } from '/shared/constants.js';
import { WEAPONS } from '/shared/weapons.js';
import { V3, DEG, MODE_CFG, lerp } from './util.js';

// ───── 플레이어(나) ─────
export const STAND_H = 1.75, CROUCH_H = 1.2, RADIUS = 0.35, STEP = 0.45, GRAVITY = 19, JUMP_V = 6.4;
export const PITCH_MAX = 88 * DEG;

export const me = {
  id: -1, name: '', pos: new V3(0, 0, -54), vel: new V3(), yaw: Math.PI, pitch: 0,
  onGround: true, crouch: false, h: STAND_H, hp: MAX_HP, alive: true, stepOff: 0, deadT: 0,
  team: -1, // 팀전에서 내 팀 (0/1), 개인전은 -1
};
export const inv = WEAPONS.map(w => ({ ammo: w.mag, reserve: w.reserve })); // 무기별 탄약

// ───── 무기/뷰모델 상태 (wp = weapon) ─────
export const wp = {
  cur: 0, prev: 6,                       // 현재/이전 무기
  drawT: 0, cooldown: 0, bloom: 0,       // 꺼내는 시간 / 연사 간격 / 탄퍼짐
  adsT: 0, sprintT: 0,                   // 정조준 / 달리기 정도 (0~1)
  reload: null,                          // 재장전 중이면 진행 정보
  kickP: 0, kickY: 0, vmKick: 0, flashT: 0, // 반동
  bobPhase: 0, swayX: 0, swayY: 0, stepDist: 0, sprinting: false,
  burstN: 0, burstSeed: 0, sinceShot: 9,  // 연사 중 몇 발째인지 (반동이 점점 커진다)
};

// ───── 입력 (inp = input) ─────
export const inp = {
  keys: new Set(), fireHeld: false, fireFresh: false, adsHeld: false,
  mdx: 0, mdy: 0,                        // 이번 프레임 마우스 이동량
  chatOpen: false,
  sens: Number(localStorage.getItem('fd_sens')) || 1,
};
export const adsInput = () => inp.adsHeld || inp.keys.has('KeyT'); // 우클릭 또는 T키

// ───── 경기 ─────
export const game = { joined: false, matchState: 'idle', respawnAt: 0, endAt: 0, matchEndsAt: 0, goalKills: 20, invUntil: 0, teamScores: [0, 0] }; // invUntil: 내 스폰 무적이 끝나는 시각
export const roster = new Map(); // id → { id, name, bot, k, d } (나 포함 방 전체)

// 팀전에서 같은 팀인가 (개인전은 항상 false)
export const isAlly = team => MODE_CFG.teams > 0 && team === me.team;

// ───── 네트워크 연결 (실제 연결/수신은 net.js) ─────
export const net = {
  ws: null,
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
};

// ───── 상태만으로 계산되는 값 ─────
export function hSpeed() { return Math.hypot(me.vel.x, me.vel.z); }
export function currentSpread() {
  const w = WEAPONS[wp.cur];
  return lerp(w.hip, w.ads, wp.adsT) * (me.crouch ? 0.75 : 1)
    + hSpeed() * 0.25 * (1 - 0.7 * wp.adsT) + (me.onGround ? 0 : 3) + wp.bloom * (1 - 0.5 * wp.adsT);
}
