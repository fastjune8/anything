// WebSocket: 연결 하나 = 세션 하나 (로비와 경기를 같은 연결로). 첫 메시지는 hello, 그 뒤는 server/lobby/hub.js 가 나눈다.
// 메시지 종류는 docs/PROTOCOL.md
import { WebSocketServer } from 'ws';
import { hello, onMessage, dropSession } from './lobby/hub.js';
import { perf } from './perf.js';

export function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, maxPayload: 32 * 1024 });
  wss.on('connection', ws => {
    let s = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', raw => {
      perf.in(raw.length);
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
      if (m.t === 'ping') { ws.send(JSON.stringify({ t: 'pong', c: m.c, n: s && s.room ? s.room.tickN : 0 })); return; } // RTT 측정 (로그인 전에도 된다)
      if (m.t === 'hello') { if (!s) s = hello(ws, m); return; }
      if (!s) return;
      try { onMessage(s, m); } catch (e) { console.error('[메시지 처리 오류]', m.t, e); }
    });
    ws.on('close', () => { if (s) dropSession(s); });
  });
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false; ws.ping();
    }
  }, 25000);
  return wss;
}
