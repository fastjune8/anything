// 서버 통신: 연결 하나로 로비와 경기를 모두 (docs/PROTOCOL.md). 페이지를 열면 바로 접속해 손님 계정으로 로그인한다.
import { WEAPONS } from '/shared/weapons.js';
import { HEALTH } from '/shared/sim/config.js';
import { me, wp, inp, game, roster, net, lobby } from './state.js';
import { fromServer } from './loadout.js';
import { makeLoadout } from '/shared/sim/player.js';
import { addChatLine, clearChat, closeChat } from './chat.js';
import { impact, addTracer, spawnGrenade, explode, clearGrenades } from './fx.js';
import { playFx, vfx } from './vfx.js';
import { killFeed, feedNote, hurt, showHit, damageNumber, rosterSet, applyKD, showEnd, showDeath, setHudOn, banner, setZones } from './hud.js';
import { remotes, addRemote, removeRemote, clearRemotes, remoteFired, remoteReload, onSnapshot, remoteSpawn, remoteDied, remoteHook } from './remotes.js';
import { onSound, clearSounds } from './minimap.js';
import { loadMap } from './scene.js';
import { sfx, audioAt } from './sfx.js';
import { clock } from './clock.js';
import { takeCmds, reconcile, resetSession, placeMe, bindSend, teleport } from './predict.js';
import { lobbyUpdate, lobbyNote, showLobby } from './lobby.js';
import { $, V3, NOLOCK, setMode, START_AT, esc } from './util.js';
import { setDisplay } from './dom.js';

const _v = new V3(), _w = new V3();
let retry = 0;
bindSend(m => net.send(m));

export function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  net.ws = ws;
  ws.onopen = () => { retry = 0; net.open = true; ws.send(JSON.stringify({ t: 'hello', token: localStorage.getItem('fd_token') || undefined, name: localStorage.getItem('fd_name') || undefined })); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
  ws.onclose = () => {
    if (net.ws !== ws) return;
    net.open = false;
    if (game.joined) toLobbyScreen('서버와의 연결이 끊어졌습니다. 다시 연결하는 중…');
    else lobbyNote('서버에 연결하는 중…');
    setTimeout(connect, Math.min(5000, 800 * ++retry));
  };
}

// 경기 화면 → 로비 화면 (상태 정리)
function toLobbyScreen(message = '') {
  game.joined = false; game.matchState = 'idle'; game.room = null; game.end = null; game.death = null; game.dom = null;
  clearRemotes(); roster.clear(); clearGrenades(); clearSounds(); vfx.clear();
  me.alive = true; me.team = -1;
  inp.keys.clear(); inp.fireHeld = inp.adsHeld = false;
  if (inp.chatOpen) closeChat();
  clearChat();
  if (document.pointerLockElement) document.exitPointerLock();
  for (const id of ['pause', 'dead', 'endscr', 'banner', 'roomtag']) setDisplay($(id), false);
  setHudOn(false);
  showLobby(message);
}
export function leaveMatch() { net.send({ t: 'leave' }); }

const DENIED = { not_found: '그 코드의 방이 없습니다.', full: '방이 가득 찼습니다.', limit: '지금은 방을 더 만들 수 없습니다.', password: '비밀번호가 틀렸습니다.' };

function onMessage(m) {
  switch (m.t) {
    // ───── 로비 ─────
    case 'hi':
      localStorage.setItem('fd_token', m.token);
      lobby.me = m.me; me.name = m.me.name; fromServer(m.loadout);
      lobbyUpdate('me'); lobbyNote('');
      break;
    case 'profile': lobby.me = m.me; me.name = m.me.name; lobbyUpdate('me'); break;
    case 'friends': lobby.friends = m.list; lobby.inc = m.inc; lobbyUpdate('friends'); break;
    case 'party': lobby.party = m.party; lobbyUpdate('party'); break;
    case 'pinv': lobby.invites = [...lobby.invites.filter(i => i.party !== m.party), m]; lobbyUpdate('party'); break;
    case 'note': lobbyNote(m.text); break;
    case 'queue': lobbyNote('매치를 찾는 중…'); break;
    case 'rooms': lobby.rooms = m.list; lobbyUpdate('rooms'); break;
    case 'denied': lobbyNote(DENIED[m.reason] || '들어갈 수 없습니다.'); break;
    case 'lo': break;
    case 'lobby': lobby.me = m.me; toLobbyScreen(''); lobbyUpdate('me'); break;
    case 'kicked': lobbyNote('다른 곳에서 같은 계정으로 접속해 연결을 끊었습니다.'); net.ws = null; break;
    case 'chat':
      if (m.ch === 'room') addChatLine(String(m.name), String(m.text), m.from === (lobby.me && lobby.me.id));
      else { const list = lobby.chat[m.ch] || (lobby.chat[m.ch] = []); list.push(m); if (list.length > 60) list.shift(); lobbyUpdate('chat'); }
      break;

    // ───── 경기 ─────
    case 'welcome': {
      game.joined = true; me.id = m.id; me.team = m.team ?? -1; game.room = m.room; game.mode = m.mode;
      setMode(m.mode); loadMap(m.map);
      me.lo = makeLoadout(m.lo); me.ps.id = m.id;
      resetSession(); clock.reset(); clock.onTick(m.n);
      clearRemotes(); roster.clear(); clearChat(); clearGrenades(); clearSounds(); vfx.clear();
      startMatchState(m);
      for (const p of m.players) { rosterSet(p); if (p.id !== m.id) addRemote(p); }
      rosterSet({ id: m.id, name: me.name, team: me.team });
      setText('roomtag', game.room ? `커스텀 방 · ${game.room.name} · 코드 ${game.room.code}${game.room.locked ? ' 🔒' : ''}` : '');
      setDisplay($('menu'), false); setHudOn(true);
      if (!NOLOCK) setDisplay($('pause'), true, 'flex');
      if (m.state !== 'playing') { me.alive = false; }
      break;
    }
    case 'start':
      roster.clear(); rosterSet({ id: me.id, name: me.name, team: me.team });
      for (const p of m.players) { rosterSet(p); if (p.id !== me.id) addRemote(p); }
      startMatchState(m);
      feedNote('<span class="w">새 경기 시작</span>');
      break;
    case 'snap': clock.onTick(m.n); game.tick = m.n; onSnapshot(m.n, m.p); break;
    case 'me': if (game.joined) { reconcile(m); if (!m.alive) me.hp = 0; } break;
    case 'ev': clock.onTick(m.n); for (const e of m.l) onEvent(e); break;
    case 'end': game.matchState = 'victory'; showEnd(m); if (m.me && m.me.profile) lobby.me = m.me.profile; break;
  }
}
function startMatchState(m) {
  game.matchState = 'playing'; game.goal = m.goal; game.teamScores = m.sc || [0, 0];
  game.endsAt = performance.now() + (m.left || 0); game.overtime = !!m.ot; game.respawn = m.respawn || game.respawn;
  game.end = null; game.death = null; game.rematch = null;
  game.dom = m.dom ? { pts: m.dom.pts } : null;
  setZones(m.dom ? m.dom.zones.map(([id, name, x, z, r]) => ({ id, name, x, z, r })) : []);
}
const setText = (id, v) => { $(id).textContent = v; setDisplay($(id), !!v); };

function onEvent(e) {
  switch (e.e) {
    case 'spawn':
      if (e.id === me.id) {
        placeMe(e.p, e.y); me.hp = HEALTH.max; game.death = null;
        if (START_AT.length === 2 && !game.startedAt) teleport(START_AT[0], 0, START_AT[1]); // 스튜디오 "여기서 시작"
        game.startedAt = true;
      } else remoteSpawn(e.id, e.p, e.y);
      break;
    case 'pj': rosterSet(e.p); if (e.p.id !== me.id) addRemote(e.p); if (!e.p.bot) feedNote(`<span class="w">${esc(e.p.name)} 입장</span>`); break;
    case 'pl': { const p = roster.get(e.id); if (p && !p.bot) feedNote(`<span class="w">${esc(p.name)} 퇴장</span>`); roster.delete(e.id); removeRemote(e.id); break; }
    case 'shot': {
      const w = WEAPONS[e.w]; if (!w) break;
      _v.fromArray(e.o); const a = audioAt(_v);
      sfx.shot(w, a.dist, a.pan);
      if (w.bolt) sfx.mech('bolt', a.att, a.pan, 0.5);
      const r = remotes.get(e.id);
      if (r) { r.rig.flash.position.copy(_v); r.rig.flashT = 0.05; remoteFired(r); }
      for (const l of e.l) { _w.set(l[0], l[1], l[2]); addTracer(_v, _w); impact(_w, l[3]); }
      break;
    }
    case 'mel': { const r = remotes.get(e.id); if (r) { remoteFired(r); sfx.whoosh(audioAt(r.pos).pan); } break; }
    case 'rl': { const r = remotes.get(e.id); if (r) { const a = audioAt(r.pos); sfx.mech('magout', a.att, a.pan, 0.2); sfx.mech('magin', a.att, a.pan, 1.0); remoteReload(r, e.w); } break; }
    case 'sk': { const r = remotes.get(e.id); if (r) { const a = audioAt(r.pos); sfx.whoosh(a.pan); if (e.k === 'adrenaline') playFx('skill_adrenaline', r.pos); } break; }
    case 'sw': { const r = remotes.get(e.id); if (r) { r.weapon = e.w; r.reload = null; } break; }
    case 'hook': remoteHook(e.id, e.p); break;
    case 'gl': spawnGrenade(e.id, e.o, e.v); if (e.by !== me.id) { const a = audioAt(_v.fromArray(e.o)); sfx.mech('pump', a.att, a.pan); } break;
    case 'boom': { explode(e.id, e.p, e.r); const a = audioAt(_v.fromArray(e.p)); sfx.boom(a.dist, a.pan); break; }
    case 'dmg': {
      if (e.to === me.id) {
        const src = remotes.get(e.from);
        me.hp = e.hp; hurt(e.d, src ? src.pos : null); sfx.hurt();
        wp.kickP += (Math.random() - 0.3) * 0.02; wp.kickY += (Math.random() - 0.5) * 0.02;
      } else {
        const r = remotes.get(e.to);
        if (r) { r.hp = e.hp; if (e.k !== 'bleed') { _v.copy(r.pos); _v.y += 1.1; impact(_v, 6); } }
      }
      if (e.from === me.id && e.to !== me.id) { damageNumber(e.d, !!e.h); if (e.hp <= 0) showHit(!!e.h, true); }
      break;
    }
    case 'blk': damageNumber('보호', false); break;
    case 'kill': {
      applyKD(e.kd); if (e.sc) game.teamScores = e.sc;
      killFeed(e.k, e.v, e.w, e.how);
      if (e.k === me.id && e.v !== me.id) sfx.kill();
      if (e.v === me.id) { me.alive = false; me.hp = 0; game.respawnAt = performance.now() + (e.rs || game.respawn) * 1000; showDeath(e); }
      else remoteDied(e.v);
      break;
    }
    case 'shove':
      if (e.id === me.id) { sfx.hurt(); wp.kickP += 0.06; }
      else { const r = remotes.get(e.id); if (r) { const a = audioAt(r.pos); sfx.land(1 / (1 + a.dist / 10)); playFx('skill_shove_hit', _v.copy(r.pos).setY(r.pos.y + 1.2)); } }
      break;
    case 'bleed': if (e.id === me.id) banner('출혈!', 'e'); break;
    case 'dom': game.dom = { pts: e.pts }; game.teamScores = e.sc; break;
    case 'cap': {
      const z = game.zones[e.z], ours = e.team === me.team;
      banner(`${z ? z.id : ''} 거점 ${ours ? '점령!' : '을 빼앗겼다'}`, ours ? 'a' : 'e');
      feedNote(`<span class="${ours ? 'a' : 'e'}">${ours ? '아군' : '적'}이 ${z ? esc(z.name || z.id) : '거점'} 을 점령</span>`);
      if (ours) sfx.kill();
      break;
    }
    case 'contest': { const z = game.zones[e.z]; if (z && Math.hypot(me.pos.x - z.x, me.pos.z - z.z) < z.r + 12) banner(`${z.id} 거점 경합 중`, 'c'); break; }
    case 'ot': game.overtime = true; banner('연장전 — 점수가 갈리는 순간 끝납니다', 'c'); break;
    case 'snd': onSound(e); break;
  }
}

// 입력을 0.033초마다 서버로 (1/60초 입력 2개쯤)
let sendAcc = 0;
export function sendInputs(dt) {
  sendAcc += dt;
  if (!game.joined || sendAcc < 1 / 30) return;
  sendAcc = 0;
  const m = takeCmds();
  if (m) net.send({ t: 'cmd', ...m });
}
