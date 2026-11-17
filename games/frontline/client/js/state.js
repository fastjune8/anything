// 여러 모듈이 같이 읽고 쓰는 게임 상태.
// 모듈 간에 값을 공유하려면 객체의 속성으로 바꿔야 하므로 (wp.cur = 3), 변수 대신 이 객체들을 쓴다.
import { MAX_HP } from '/shared/constants.js';
import { WEAPONS } from '/shared/weapons.js';
import { BODY } from '/shared/movement.js';
import { V3, DEG, MODE_CFG, lerp } from './util.js';

// ───── 플레이어(나) ─────
export const { STAND_H, CROUCH_H, RADIUS, STEP, GRAVITY, JUMP_V } = BODY; // 몸 크기·중력 (이동 물리와 같은 값)
export const PITCH_MAX = 88 * DEG;

export const me = {
  id: -1, name: '', pos: new V3(0, 0, -54), vel: new V3(), yaw: Math.PI, pitch: 0,
  onGround: true, crouch: false, h: STAND_H, hp: MAX_HP, alive: true, stepOff: 0, deadT: 0,
  team: -1, // 팀전에서 내 팀 (0/1), 개인전은 -1
  dashT: 0, dashCd: 0, dashV: null, // 대쉬(스킬): 남은 시간 / 다시 쓸 수 있을 때까지 / 속도
  stunT: 0, slideT: 0, kickCd: 0,   // 밀어내기에 맞아 넘어진 시간 / 밀려나며 미끄러지는 시간 / 밀려나기(스킬) 간격
  vault: null, vaultLock: false, // 넘어가는 중이면 진행 정보 / 넘은 뒤 Space 를 뗄 때까지 다시 넘지 않음
  airT: 0,                      // 땅을 떠난 뒤 지난 시간 (점프 직후 공중에서도 넘을 수 있게)
};
export const inv = WEAPONS.map(w => ({ ammo: w.mag, reserve: w.reserve })); // 무기별 탄약

// ───── 출전 무기 (무기고에서 고른다. 저장/변경은 loadout.js) ─────
// slots: 들고 들어가는 무기 2개 (WEAPONS 번호), parts: 무기별로 달아 둔 파츠 { 자리: 파츠id }
// skills: 무기별로 고른 스킬 [1번 자리일 때, 2번 자리일 때] (스킬 id)
export const loadout = { slots: [0, WEAPONS.length - 1], parts: WEAPONS.map(() => ({})), skills: WEAPONS.map(() => [null, null]) };
// 파츠가 반영된 무기 성능. 게임 중 성능은 WEAPONS[i] 대신 eff[i] 를 읽는다. (loadout.js 가 내용을 채운다)
export const eff = WEAPONS.map(w => ({ ...w }));

// ───── 무기/뷰모델 상태 (wp = weapon) ─────
export const wp = {
  cur: 0, prev: WEAPONS.length - 1,                       // 현재/이전 무기
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
export const game = { joined: false, matchState: 'idle', respawnAt: 0, endAt: 0, matchEndsAt: 0, goalKills: 20, invUntil: 0, teamScores: [0, 0], room: null, zone: null }; // zone: 점령전 거점 상태 { o: 주인 팀, ct: 점령 중인 팀, p: 게이지 0~1, c: 교전 중, n: [팀별 인원] } // room: 친선전이면 { code, name, minutes } // invUntil: 내 스폰 무적이 끝나는 시각
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
  const w = eff[wp.cur];
  return lerp(w.hip, w.ads, wp.adsT) * (me.crouch ? 0.75 : 1)
    + hSpeed() * 0.25 * (1 - 0.7 * wp.adsT) + (me.onGround ? 0 : 3) + wp.bloom * (1 - 0.5 * wp.adsT);
}
