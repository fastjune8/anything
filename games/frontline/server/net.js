// WebSocket: 접속을 받아 메시지를 해당 방의 처리 함수로 넘긴다. 메시지 종류는 docs/PROTOCOL.md 참고.
import { WebSocketServer } from 'ws';
import { MODES, DEFAULT_MODE } from '../shared/modes.js';
import { findRoom } from './rooms.js';

// join 이후에 받는 메시지별 처리. me = 보낸 플레이어, room = 그 플레이어의 방
const HANDLERS = {
  // 내 위치/시선 → 다른 사람에게 그대로 전달
  s(me, m, room) {
    if (!(Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite))) return;
    me.pos = m.p; me.crouch = m.c ? 1 : 0;
    m.id = me.id; room.broadcast(m, me);
  },
  // 사격 / 재장전 → 소리와 이펙트용으로 다른 사람에게 전달
  shot(me, m, room) { if (me.alive) { me.invulnUntil = 0; m.id = me.id; room.broadcast(m, me); } }, // 쏘면 스폰 무적 해제
  rl(me, m, room) { if (me.alive) { m.id = me.id; room.broadcast(m, me); } },
  hit: (me, m, room) => room.onHit(me, m),
  chat: (me, m, room) => room.onChat(me, m),
  respawn: (me, m, room) => room.onRespawn(me),
};

export function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, maxPayload: 16 * 1024 });

  wss.on('connection', ws => {
    let me = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', raw => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object') return;

      if (m.t === 'join') {
        if (me) return;
        const name = String(m.name || '').trim().slice(0, 14) || '병사';
        const mode = typeof m.mode === 'string' && Object.hasOwn(MODES, m.mode) ? m.mode : DEFAULT_MODE;
        me = findRoom(mode).join(ws, name);
        return;
      }
      if (!me) return;
      const handler = HANDLERS[m.t];
      if (handler) handler(me, m, me.room);
    });

    ws.on('close', () => { if (me) me.room.leave(me); });
  });

  // 끊긴 연결 정리 (프록시/공유기가 유휴 연결을 끊는 것도 방지)
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false; ws.ping();
    }
  }, 25000);

  return wss;
}
