// 방 목록 관리
//  - 빠른 시작: 고른 모드에서 빈자리가 있는 방을 찾거나 새로 만든다
//  - 친선전: 사용자가 만드는 방. 코드(4자)로 찾고, 공개 방은 목록에 보인다. 빠른 시작과는 섞이지 않는다.
import { MODES, DEFAULT_MODE } from '../shared/modes.js';
import { MAP_IDS } from '../shared/maps/index.js';
import { Room } from './room.js';
import { sanitizeChat } from './chat.js';
import { MATCH_MS } from './config.js';

const MAX_CUSTOM_ROOMS = 30;
const MINUTES = [3, 5, 10];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 글자(0/O, 1/I) 제외

const rooms = new Set();
let nextNumber = 1;

const makeCode = () => {
  for (;;) {
    const code = Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
    if (![...rooms].some(r => r.custom && r.custom.code === code)) return code;
  }
};
const newRoom = (mode, custom) => {
  const room = new Room({ number: nextNumber++, mode, custom, onDestroy: r => rooms.delete(r) });
  rooms.add(room);
  return room;
};

export function findRoom(mode) {
  for (const room of rooms) if (!room.custom && room.mode === mode && room.humans().length < room.cfg.max) return room;
  return newRoom(mode, null);
}

export function roomByCode(code) {
  return [...rooms].find(r => r.custom && r.custom.code === code) || null;
}

// 공개 친선전 방 목록 (비공개 방은 코드로만 들어올 수 있다)
export function listCustomRooms() {
  return [...rooms].filter(r => r.custom && !r.custom.isPrivate).map(r => r.summary());
}

// 입장 메시지(join)에서 들어갈 방을 정한다. 반환: { room } 또는 { error: 'not_found' | 'full' | 'limit' }
export function resolveRoom(m, playerName) {
  const mode = typeof m.mode === 'string' && Object.hasOwn(MODES, m.mode) ? m.mode : DEFAULT_MODE;

  if (typeof m.code === 'string' && m.code.trim()) { // 코드로 입장
    const room = roomByCode(m.code.trim().toUpperCase().slice(0, 4));
    if (!room) return { error: 'not_found' };
    if (room.humans().length >= room.cfg.max) return { error: 'full' };
    return { room };
  }

  if (m.create && typeof m.create === 'object') { // 방 만들기
    if ([...rooms].filter(r => r.custom).length >= MAX_CUSTOM_ROOMS) return { error: 'limit' };
    const c = m.create;
    const name = (sanitizeChat(c.name) || '').slice(0, 20) || `${playerName}의 방`;
    const minutes = MINUTES.includes(c.minutes) ? c.minutes : 5;
    const matchMs = process.env.MATCH_SECONDS ? MATCH_MS : minutes * 60000; // 테스트에서 시간 재정의 허용
    const map = typeof c.map === 'string' && MAP_IDS.includes(c.map) ? c.map : null; // 맵을 고를 수 있다 (없으면 모드 기본 맵)
    return { room: newRoom(mode, { code: makeCode(), name, isPrivate: !!c.private, bots: !!c.bots, matchMs, map }) };
  }

  return { room: findRoom(mode) };
}

// 전체와 모드별 접속 현황 (로비 표시, 배포 전 확인용)
export function roomStats() {
  const modes = {};
  for (const id of Object.keys(MODES)) modes[id] = { rooms: 0, humans: 0 };
  let humans = 0;
  for (const r of rooms) { const n = r.humans().length; humans += n; modes[r.mode].rooms++; modes[r.mode].humans += n; }
  return { rooms: rooms.size, humans, modes, custom: [...rooms].filter(r => r.custom).length };
}
