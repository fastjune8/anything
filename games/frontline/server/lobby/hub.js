// 로비 (기획 12장): 접속한 사람(세션)·친구·파티·채팅·빠른 매칭·커스텀 방. 경기 중 메시지는 그 사람의 방으로 넘긴다.
//   세션 = 계정 하나의 연결 하나. 같은 계정으로 다시 접속하면 예전 연결을 끊는다.
//   빠른 매칭: 동시 접속이 적어도 바로 시작되도록, 고른 모드에서 자리가 있는 방에 넣고(파티는 같은 팀) 없으면 새로 만든다. 모자란 인원은 봇.
import { MODES, DEFAULT_MODE } from '../../shared/modes.js';
import { MAP_IDS } from '../../shared/maps/index.js';
import { makeLoadout, loadoutWire } from '../../shared/sim/player.js';
import { sanitizeOutfit } from '../../shared/cosmetics.js';
import { sanitizeChat, allowChat } from '../chat.js';
import { login, rename, getAccount, byTag, profile, publicCard, saveSoon, recordMatch } from './accounts.js';
import { Room } from '../game/room.js';
import { matchMsFor } from '../config.js';
import { perf } from '../perf.js';

const PARTY_MAX = 5;
const MAX_CUSTOM = 30;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const sessions = new Map();   // 계정 id → 세션
export const rooms = new Set();
const parties = new Map();           // 파티 id → { id, leader, members: Set(계정 id), invites: Set }
let nextParty = 1, nextRoom = 1;

const send = (s, m) => { if (s && s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify(m)); };
const sessionOf = id => sessions.get(id) || null;
const statusOf = s => (!s ? 'offline' : s.room ? `match:${s.room.mode}` : s.queue ? 'queue' : 'lobby');

// ───── 접속 / 종료 ─────
export function hello(ws, m) {
  const acc = login(m.token, m.name);
  const old = sessions.get(acc.id);
  if (old && old.ws !== ws) { send(old, { t: 'kicked', reason: 'dup' }); dropSession(old); try { old.ws.close(); } catch { /* 이미 닫힘 */ } }
  const s = { id: acc.id, acc, ws, room: null, player: null, party: null, queue: null, chatTimes: [] };
  s.loadout = loadoutWire(makeLoadout(acc.loadout));
  s.outfit = sanitizeOutfit(acc.outfit);
  sessions.set(acc.id, s);
  send(s, { t: 'hi', token: acc.token, me: profile(acc), loadout: s.loadout, outfit: s.outfit, modes: Object.keys(MODES), maps: MAP_IDS });
  pushFriends(s); notifyFriends(acc.id);
  return s;
}
export function dropSession(s) {
  if (sessions.get(s.id) !== s) return;
  if (s.room) s.room.leave(s);
  leaveParty(s);
  sessions.delete(s.id);
  notifyFriends(s.id);
}

// ───── 메시지 ─────
const LOBBY = {
  name(s, m) { rename(s.acc, m.name); send(s, { t: 'profile', me: profile(s.acc) }); notifyFriends(s.id); refreshParty(s.party); },
  lo(s, m) { // 출전 무기·스킬, 외형 (매치 시작 전에 고른다, 기획 3.3)
    if (m.loadout) { const lo = makeLoadout(m.loadout); s.loadout = loadoutWire(lo); s.acc.loadout = s.loadout; }
    if (m.outfit) { s.outfit = sanitizeOutfit(m.outfit); s.acc.outfit = s.outfit; }
    saveSoon();
    send(s, { t: 'lo', loadout: s.loadout, outfit: s.outfit });
  },
  chat(s, m) {
    const text = sanitizeChat(m.text);
    if (!text || !allowChat(s, Date.now())) return;
    const line = { t: 'chat', ch: m.ch, from: s.id, name: s.acc.name, text };
    if (m.ch === 'party' && s.party) for (const id of s.party.members) send(sessionOf(id), line);
    else if (m.ch === 'room' && s.room) s.room.chat(s, text);
    else if (m.ch === 'lobby') for (const o of sessions.values()) if (!o.room) send(o, { ...line, ch: 'lobby' });
  },
  // 친구 (기획 12.4): 요청 → 수락하면 서로 친구
  'fr+'(s, m) {
    const [name, tag] = String(m.tag || '').split('#');
    const t = byTag((name || '').trim(), (tag || '').trim());
    if (!t || t.id === s.id) { send(s, { t: 'note', text: '그 친구 코드를 찾을 수 없습니다 (이름#숫자4자리)' }); return; }
    if (s.acc.friends.includes(t.id)) { send(s, { t: 'note', text: '이미 친구입니다' }); return; }
    if (t.requests.includes(s.id)) { send(s, { t: 'note', text: '이미 요청을 보냈습니다' }); return; }
    if (s.acc.requests.includes(t.id)) { LOBBY.fra(s, { id: t.id, ok: true }); return; } // 상대도 나에게 요청했다 → 바로 친구
    t.requests.push(s.id); saveSoon();
    send(s, { t: 'note', text: `${t.name}#${t.tag} 에게 친구 요청을 보냈습니다` });
    pushFriends(sessionOf(t.id));
  },
  fra(s, m) {
    const id = m.id | 0, i = s.acc.requests.indexOf(id), o = getAccount(id);
    if (i < 0 || !o) return;
    s.acc.requests.splice(i, 1);
    if (m.ok) { if (!s.acc.friends.includes(id)) s.acc.friends.push(id); if (!o.friends.includes(s.id)) o.friends.push(s.id); }
    saveSoon(); pushFriends(s); pushFriends(sessionOf(id));
  },
  'fr-'(s, m) {
    const id = m.id | 0, o = getAccount(id);
    s.acc.friends = s.acc.friends.filter(x => x !== id);
    if (o) o.friends = o.friends.filter(x => x !== s.id);
    saveSoon(); pushFriends(s); pushFriends(sessionOf(id));
  },
  // 파티 (기획 12.2)
  pinv(s, m) {
    const o = sessionOf(m.id | 0);
    if (!o || !s.acc.friends.includes(o.id)) { send(s, { t: 'note', text: '접속 중인 친구만 초대할 수 있습니다' }); return; }
    const p = s.party || createParty(s);
    if (p.members.size >= PARTY_MAX) { send(s, { t: 'note', text: `파티는 최대 ${PARTY_MAX}명입니다` }); return; }
    p.invites.add(o.id);
    send(o, { t: 'pinv', party: p.id, from: s.id, name: s.acc.name });
    send(s, { t: 'note', text: `${o.acc.name} 을(를) 파티에 초대했습니다` });
  },
  pjoin(s, m) {
    const p = parties.get(m.party | 0);
    if (!p || !p.invites.has(s.id) || p.members.size >= PARTY_MAX) { send(s, { t: 'note', text: '파티에 들어갈 수 없습니다 (초대가 끝났거나 가득 참)' }); return; }
    leaveParty(s);
    p.invites.delete(s.id); p.members.add(s.id); s.party = p;
    refreshParty(p);
  },
  pleave(s) { leaveParty(s); },
  // 빠른 매칭 (기획 12.3). 파티는 파티장이 시작한다
  qm(s, m) {
    const mode = typeof m.mode === 'string' && MODES[m.mode] ? m.mode : DEFAULT_MODE;
    if (s.room) return;
    if (s.party && s.party.leader !== s.id) { send(s, { t: 'note', text: '파티장만 매칭을 시작할 수 있습니다' }); return; }
    const group = s.party ? [...s.party.members].map(sessionOf).filter(x => x && !x.room) : [s];
    for (const g of group) { g.queue = mode; send(g, { t: 'queue', mode }); }
    refreshParty(s.party);
    const room = findRoom(mode, group.length);
    for (const g of group) g.queue = null;
    room.joinGroup(group);
    for (const g of group) notifyFriends(g.id);
    refreshParty(s.party);
  },
  // 커스텀 방 (기획 12.6)
  rooms(s) { send(s, { t: 'rooms', list: [...rooms].filter(r => r.custom).map(r => r.summary()) }); },
  rcreate(s, m) {
    if (s.room) return;
    if ([...rooms].filter(r => r.custom).length >= MAX_CUSTOM) { send(s, { t: 'denied', reason: 'limit' }); return; }
    const mode = typeof m.mode === 'string' && MODES[m.mode] ? m.mode : DEFAULT_MODE, cfg = MODES[mode];
    const minutes = [3, 5, 8, 10, 15].includes(m.minutes) ? m.minutes : cfg.minutes;
    const max = Number.isInteger(m.max) ? Math.max(2, Math.min(cfg.max, m.max)) : cfg.max;
    const custom = {
      code: makeCode(), name: (sanitizeChat(m.name) || '').slice(0, 20) || `${s.acc.name}의 방`,
      pass: typeof m.pass === 'string' ? m.pass.slice(0, 16) : '', bots: m.bots !== false, minutes, max,
      map: typeof m.map === 'string' && MAP_IDS.includes(m.map) ? m.map : cfg.map, host: s.id,
      matchMs: process.env.MATCH_SECONDS ? matchMsFor(cfg) : minutes * 60000,
    };
    const room = newRoom(mode, custom);
    room.joinGroup([s]);
    notifyFriends(s.id);
  },
  rjoin(s, m) {
    if (s.room) return;
    const room = [...rooms].find(r => r.custom && r.custom.code === String(m.code || '').trim().toUpperCase());
    if (!room) { send(s, { t: 'denied', reason: 'not_found' }); return; }
    if (room.custom.pass && room.custom.pass !== String(m.pass || '')) { send(s, { t: 'denied', reason: 'password' }); return; }
    if (room.humans().length >= room.custom.max) { send(s, { t: 'denied', reason: 'full' }); return; }
    room.joinGroup([s]);
    notifyFriends(s.id);
  },
  stats(s) { send(s, { t: 'profile', me: profile(s.acc) }); },
};

export function onMessage(s, m) {
  if (s.room && s.room.handle(s, m)) return; // 경기 메시지 (cmd · leave · rematch …)
  const h = LOBBY[m.t];
  if (h) h(s, m);
}

// ───── 방 ─────
function makeCode() {
  for (;;) {
    const code = Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
    if (![...rooms].some(r => r.custom && r.custom.code === code)) return code;
  }
}
function newRoom(mode, custom = null) {
  const room = new Room({ number: nextRoom++, mode, custom, hub: HUB });
  rooms.add(room);
  return room;
}
function findRoom(mode, size) {
  for (const r of rooms) if (!r.custom && r.mode === mode && r.canFit(size)) return r;
  return newRoom(mode);
}
// 방이 부르는 것
const HUB = {
  removeRoom(room) { rooms.delete(room); },
  // 경기에서 나와 로비로 (방에서 나감 / 결과 화면에서 로비 선택)
  toLobby(s) {
    s.room = null; s.player = null;
    send(s, { t: 'lobby', me: profile(s.acc) });
    notifyFriends(s.id); refreshParty(s.party);
  },
  profileOf: s => profile(s.acc),
  record: (s, r) => recordMatch(s.acc, r),
  account: s => s.acc,
  status: () => { notifyAll(); },
};

// ───── 친구 / 파티 표시 ─────
function pushFriends(s) {
  if (!s) return;
  const list = s.acc.friends.map(getAccount).filter(Boolean).map(a => ({ ...publicCard(a), status: statusOf(sessionOf(a.id)) }));
  const inc = s.acc.requests.map(getAccount).filter(Boolean).map(publicCard);
  send(s, { t: 'friends', list, inc });
}
function notifyFriends(id) {
  const a = getAccount(id);
  if (!a) return;
  for (const f of a.friends) pushFriends(sessionOf(f));
}
function notifyAll() { for (const s of sessions.values()) pushFriends(s); }
function createParty(s) {
  const p = { id: nextParty++, leader: s.id, members: new Set([s.id]), invites: new Set() };
  parties.set(p.id, p); s.party = p;
  refreshParty(p);
  return p;
}
function leaveParty(s) {
  const p = s.party;
  if (!p) return;
  p.members.delete(s.id); s.party = null;
  send(s, { t: 'party', party: null });
  if (!p.members.size) { parties.delete(p.id); return; }
  if (p.leader === s.id) p.leader = [...p.members][0];
  refreshParty(p);
}
function refreshParty(p) {
  if (!p) return;
  const members = [...p.members].map(id => { const o = sessionOf(id); return o ? { ...publicCard(o.acc), status: statusOf(o) } : null; }).filter(Boolean);
  for (const id of p.members) send(sessionOf(id), { t: 'party', party: { id: p.id, leader: p.leader, members } });
}

perf.setProbe(() => ({ players: [...rooms].reduce((n, r) => n + r.players.size, 0), rooms: rooms.size }));

// 상태 확인 (/status)
export function hubStats() {
  const modes = {};
  for (const id of Object.keys(MODES)) modes[id] = { rooms: 0, humans: 0 };
  let humans = 0;
  for (const r of rooms) { const n = r.humans().length; humans += n; modes[r.mode].rooms++; modes[r.mode].humans += n; }
  return { online: sessions.size, rooms: rooms.size, humans, modes, custom: [...rooms].filter(r => r.custom).length };
}
