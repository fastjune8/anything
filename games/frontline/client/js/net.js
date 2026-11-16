// 서버 통신: 접속, 받은 메시지 처리, 내 상태 주기 전송. 메시지 종류는 docs/PROTOCOL.md 참고.
import { RESPAWN_MIN_MS, MAX_HP } from '/shared/constants.js';
import { WEAPONS } from '/shared/weapons.js';
import { applyParts } from '/shared/parts.js';
import { loadoutMessage } from './loadout.js';
import { addChatLine, clearChat, closeChat } from './chat.js';
import { impact, addTracer } from './fx.js';
import { feed, hurt, nameOf, sideOf, rosterSet, applyScores, showEnd, setHudOn } from './hud.js';
import { remotes, addRemote, removeRemote, clearRemotes } from './remotes.js';
import { loadMap } from './scene.js';
import { sfx, audioAt } from './sfx.js';
import { me, wp, inp, game, roster, net } from './state.js';
import { $, V3, NOLOCK, MODE_CFG, setMode, lerp, esc, START_AT } from './util.js';
import { setText, setDisplay } from './dom.js';
import { placeMe } from './weapon.js';
import { takeInputs, reconcile, resetPrediction, resetSession, teleport } from './player.js';

const _v = new V3();
const QUIET = WEAPONS.map(w => applyParts(w, { barrel: 'suppressor' })); // 소음기를 단 상대의 총소리

// opts: { mode } 빠른 시작 | { code } 친선전 코드로 입장 | { mode, create: { name, private, bots, minutes } } 친선전 방 만들기
export function connect(name, opts = {}) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  net.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, mode: MODE_CFG.id, loadout: loadoutMessage(), ...opts }));
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
  ws.onclose = () => {
    if (net.ws !== ws) return;
    leaveToLobby(game.joined ? '서버와의 연결이 끊어졌습니다.' : '서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.');
  };
}

// 방에서 나가 로비로 돌아간다 (연결 종료 + 화면/상태 정리). 새로고침이 필요 없다.
export function leaveToLobby(message = '') {
  const ws = net.ws; net.ws = null;
  if (ws) ws.close();
  game.joined = false; game.matchState = 'idle'; game.room = null;
  clearRemotes(); roster.clear();
  me.alive = true; me.team = -1; me.hp = 100; wp.reload = null;
  inp.keys.clear(); inp.fireHeld = inp.adsHeld = inp.fireFresh = false;
  if (inp.chatOpen) closeChat();
  clearChat();
  if (document.pointerLockElement) document.exitPointerLock();
  for (const id of ['pause', 'dead', 'endscr', 'inv', 'banner', 'roomtag']) setDisplay($(id), false);
  setDisplay($('menu'), true, 'flex'); setHudOn(false);
  $('join').disabled = false;
  $('msg').textContent = message;
}

const DENIED = { not_found: '그 코드의 방을 찾을 수 없습니다. (방이 사라졌거나 코드가 틀렸습니다)', full: '방이 가득 찼습니다.', limit: '지금은 방을 더 만들 수 없습니다. 잠시 뒤에 다시 시도하세요.' };

// 서버가 보낸 메시지 종류별 처리
function onMessage(m) {
  switch (m.t) {
    case 'welcome': {
      game.joined = true; me.id = m.id; me.team = m.team ?? -1; game.teamScores = m.ts || [0, 0]; game.room = m.room || null;
      setMode(m.mode); loadMap(m.map || MODE_CFG.map); // 들어간 방의 모드/맵에 맞춘다 (새로고침 없이). 친선전은 맵을 따로 고를 수 있다
      game.zone = m.zone || null;
      resetSession(); // 서버에서 나는 새 플레이어 → 이동 예측 기록도 처음부터
      clearRemotes(); roster.clear(); clearChat();
      setText($('roomtag'), game.room ? `친선전 · ${game.room.name} · 코드 ${game.room.code}` : ''); setDisplay($('roomtag'), !!game.room);
      setText($('pauseRoom'), game.room ? `친구에게 알려 주세요 → 방 코드 ${game.room.code}` : '');
      game.goalKills = m.goal; game.matchState = m.state; game.matchEndsAt = performance.now() + m.left; game.endAt = performance.now() + 10000;
      for (const p of m.players) { rosterSet(p); if (p.id !== m.id) addRemote(p); }
      setDisplay($('menu'), false); setHudOn(true);
      if (game.matchState === 'ended') showEnd(-1);
      if (!NOLOCK) setDisplay($('pause'), true, 'flex');
      break;
    }
    case 'pj':
      rosterSet(m.player); addRemote(m.player);
      if (!m.player.bot) feed(`<span class="w">${esc(m.player.name)} 입장</span>`);
      break;
    case 'pl': {
      const p = roster.get(m.id);
      if (p && !p.bot) feed(`<span class="w">${esc(p.name)} 퇴장</span>`);
      roster.delete(m.id); removeRemote(m.id);
      break;
    }
    case 'start':
      game.matchState = 'playing'; game.goalKills = m.goal; game.matchEndsAt = performance.now() + m.left; game.teamScores = m.ts || [0, 0]; game.zone = m.zone || null;
      roster.clear();
      for (const p of m.players) { rosterSet(p); if (p.id !== me.id) addRemote(p); }
      feed('<span class="w">새 경기 시작</span>');
      break;
    case 'spawn':
      if (m.id === me.id) {
        placeMe(m.p); resetPrediction(); game.invUntil = performance.now() + (m.inv || 0);
        // 스튜디오에서 "여기서 시작" 을 고르면 처음 한 번은 그 자리로 옮긴다 (개발 서버만 받아 준다)
        if (START_AT.length === 2 && !game.startedAt) teleport(START_AT[0], 0, START_AT[1]);
        game.startedAt = true;
      }
      else {
        const r = remotes.get(m.id);
        if (r) { r.alive = true; r.hasPos = true; r.deadT = 0; r.hp = MAX_HP; r.invUntil = performance.now() + (m.inv || 0); r.tpos.fromArray(m.p); r.pos.fromArray(m.p); }
      }
      break;
    case 'me': // 서버가 계산한 내 이동 상태 → 맞추고 남은 입력을 다시 적용 (player.js)
      if (game.joined) reconcile(m.q, m.st, m.k);
      break;
    case 's': { // 다른 사람의 위치/시선
      const r = remotes.get(m.id);
      if (!r) break;
      r.tpos.fromArray(m.p); r.tyaw = m.y; r.tpitch = m.x; r.crouchT = m.c ? 1 : 0; r.weapon = m.w | 0;
      r.tlean = Math.max(-1, Math.min(1, Number(m.l) || 0));
      if (!r.hasPos) { r.hasPos = true; r.pos.copy(r.tpos); }
      break;
    }
    case 'shot': {
      const w = WEAPONS[m.w]; if (!w) break;
      const o = new V3().fromArray(m.o), a = audioAt(o);
      sfx.shot(m.q ? QUIET[m.w] : w, a.dist, a.pan);
      if (w.bolt) sfx.mech('bolt', a.att, a.pan, 0.5);
      const r = remotes.get(m.id);
      if (r) { r.rig.flash.position.copy(o); r.rig.flashT = 0.05; r.invUntil = 0; if (!m.q) r.shotAt = performance.now(); } // 쏜 사람은 무적이 풀리고, 미니맵에 잠깐 표시된다 (소음기 q 는 표시되지 않는다)
      for (const e of m.e || []) {
        const end = new V3(e[0], e[1], e[2]);
        addTracer(o, end);
        if (e[3] !== 6) { impact(end, e[3]); const ia = audioAt(end); if (ia.dist < 12) sfx.impact(ia.dist, ia.pan); }
      }
      break;
    }
    case 'rl': {
      const r = remotes.get(m.id);
      if (!r) break;
      const a = audioAt(r.pos); sfx.mech('magout', a.att, a.pan, 0.2); sfx.mech('magin', a.att, a.pan, 1.2);
      break;
    }
    case 'dmg':
      if (m.to === me.id) {
        const src = remotes.get(m.from);
        me.hp = m.hp; hurt(m.dmg, src ? src.pos : null);
        wp.kickP += (Math.random() - 0.3) * 0.02; wp.kickY += (Math.random() - 0.5) * 0.02;
        sfx.hurt();
        _v.copy(me.pos); _v.y += 1.2; impact(_v, -1);
      } else {
        const r = remotes.get(m.to);
        if (r) { r.hp = m.hp; _v.copy(r.pos); _v.y += lerp(1.25, 0.8, r.crouch); impact(_v, 6); }
      }
      break;
    case 'hp': me.hp = m.hp; break;
    case 'rh': { const r = remotes.get(m.id); if (r) r.hp = m.hp; break; } // 다른 플레이어의 체력 회복
    case 'denied': leaveToLobby(DENIED[m.reason] || '입장할 수 없습니다.'); break;
    case 'chat': addChatLine(String(m.name), String(m.text), m.id === me.id); break;
    case 'kill': {
      applyScores(m.sc); if (m.ts) game.teamScores = m.ts;
      const mine = m.killer === me.id, iDie = m.victim === me.id, w = WEAPONS[m.w];
      const kn = nameOf(m.killer), vn = nameOf(m.victim);
      feed(`<span class="${sideOf(m.killer)}">${esc(kn)}</span><span class="w">[${w ? w.name : '?'}]</span><span class="${sideOf(m.victim)}">${esc(vn)}</span>${m.head ? '<span class="hs">헤드샷</span>' : ''}`);
      if (mine) sfx.kill();
      if (iDie) {
        me.alive = false; me.hp = 0; wp.reload = null; game.respawnAt = performance.now() + RESPAWN_MIN_MS; // 이 시각 이후 아무 입력이나 하면 부활
        setText($('deadBy'), `${kn} 의 ${w ? w.name : ''}${m.head ? ' · 헤드샷' : ''}`);
      } else {
        const r = remotes.get(m.victim);
        if (r) { r.alive = false; r.hp = 0; }
      }
      break;
    }
    case 'zone': // 점령전 거점 상태 (바뀔 때만 온다)
      game.zone = { o: m.o, ct: m.ct, p: m.p, c: m.c, n: m.n }; if (m.ts) game.teamScores = m.ts;
      break;
    case 'zcap': {
      const ours = m.team === me.team;
      feed(`<span class="${ours ? 'a' : 'e'}">${ours ? '아군이 거점을 점령했습니다' : '적이 거점을 점령했습니다'}</span>`);
      if (ours) sfx.kill();
      break;
    }
    case 'end':
      applyScores(m.sc); if (m.ts) game.teamScores = m.ts;
      game.matchState = 'ended'; game.endAt = performance.now() + (m.restart || 10000);
      showEnd(m.winner, m.wt);
      break;
  }
}

// 이동 입력을 0.05초마다 서버로 (한 번에 1/60초 입력 3개쯤). 위치는 서버가 계산한다
let sendAcc = 0;
export function sendState(dt) {
  sendAcc += dt;
  if (!game.joined || sendAcc < 0.05) return;
  sendAcc = 0;
  const m = takeInputs();
  if (m) net.send({ t: 'in', ...m });
}
