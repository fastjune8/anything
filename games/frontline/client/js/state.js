// 여러 모듈이 같이 읽고 쓰는 브라우저 상태. 모듈 간에 값을 공유하려면 객체의 속성으로 바꾼다 (wp.cur = 3).
//   me.ps  = 내 시뮬레이션 상태 (shared/sim/player.js — 서버와 같은 모양). 예측(predict.js)이 매 tick 갱신
//   me.*   = 화면용으로 풀어 둔 값 (위치·시선·높이 …): 1인칭 무기·카메라·소리가 읽는다
//   wp     = 1인칭 무기 연출 상태 (반동·흔들림·재장전 진행 …)
import { HEALTH, BODY } from '/shared/sim/config.js';
import { WEAPONS } from '/shared/weapons.js';
import { makeLoadout, newPlayerSim } from '/shared/sim/player.js';
import { V3, DEG, MODE_CFG } from './util.js';

export const { STAND_H, CROUCH_H, RADIUS } = BODY;
export const PITCH_MAX = 88 * DEG;

export const me = {
  id: -1, name: '', team: -1, pos: new V3(0, 0, -54), vel: new V3(), yaw: Math.PI, pitch: 0,
  onGround: true, crouch: false, h: STAND_H, hp: HEALTH.max, alive: true, stepOff: 0, deadT: 0,
  dashT: 0, dashV: null, stunT: 0, slide: 0, vault: null,
  lo: makeLoadout(null), ps: null,
};
me.ps = newPlayerSim(0, me.lo);
export const eff = WEAPONS; // 무기 성능 (부착물 시스템은 기획 3.7 에 따라 초기 범위에서 뺐다 → 데이터 그대로)

export const wp = {
  cur: me.lo[0].wi, slot: 0,                 // 들고 있는 무기 (WEAPONS 번호) / 자리 (0·1)
  drawT: 0, cooldown: 0, adsT: 0, sprintT: 0, reload: null,
  kickP: 0, kickY: 0, vmKick: 0, flashT: 0, swing: 0,
  bobPhase: 0, swayX: 0, swayY: 0, stepDist: 0, sprinting: false,
  burstN: 0, burstSeed: 0, sinceShot: 9, shots: 0, side: 0, // side: 아킴보 — 이번에 쏜 손 (0 오른손, 1 왼손)
  kThrow: [0, 0],                            // 쿠나이: 왼손·오른손이 던지며 앞으로 나간 정도 (1 → 0)
};

export const inp = {
  keys: new Set(), fireHeld: false, adsHeld: false, mdx: 0, mdy: 0, chatOpen: false, tactical: false, board: false,
  sens: Number(localStorage.getItem('fd_sens')) || 1, wantSlot: 0, skillPress: [false, false], reloadPress: false, modePress: false, nodePress: false,
};

// matchState: idle | playing | victory | results
export const game = {
  joined: false, matchState: 'idle', mode: MODE_CFG.id, room: null, teamScores: [0, 0], goal: 100, endsAt: 0, overtime: false,
  dom: null, zones: [], respawn: 5, respawnAt: 0, death: null, end: null, rematch: null, tick: 0,
};
export const roster = new Map(); // id → { id, name, bot, team, k, d, a, lvl }
export const lobby = { me: null, friends: [], inc: [], party: null, rooms: [], chat: { lobby: [], party: [] }, invites: [] };

export const isAlly = team => MODE_CFG.teams > 0 && team === me.team;

export const net = {
  ws: null, open: false,
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
};
export function hSpeed() { return Math.hypot(me.vel.x, me.vel.z); }
