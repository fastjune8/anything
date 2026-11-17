// WebSocket: 접속을 받아 메시지를 해당 방의 처리 함수로 넘긴다. 메시지 종류는 docs/PROTOCOL.md 참고.
import { WebSocketServer } from 'ws';
import { resolveRoom } from './rooms.js';
import { applyInputs, teleport } from './motion.js';
import { onShot, useSkill, fireGrenade } from './skills.js';
import { APP_ENV } from './config.js';

// join 이후에 받는 메시지별 처리. me = 보낸 플레이어, room = 그 플레이어의 방
const HANDLERS = {
  // 이동 입력 (1/60초 단위). 위치는 서버가 계산한다 (server/motion.js). 결과는 방의 tick 이 보낸다
  in(me, m, room) { applyInputs(me, m, room.map.layout.colliders); },
  // 개발·테스트용 순간이동 (라이브에서는 무시). 스튜디오의 "여기서 시작", 자동 테스트가 쓴다
  tp(me, m) {
    if (APP_ENV === 'prod' || !(Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite))) return;
    teleport(me, m.p, Number(m.y));
  },
  // 사격 / 재장전 → 소리와 이펙트용으로 다른 사람에게 전달
  shot(me, m, room) {
    m.w |= 0;
    const w = me.wstats[m.w];
    if (!me.alive || !w) return;                 // 들고 있지 않은 무기의 사격은 무시
    if (me.ms && me.ms.stunT > 0) return;        // 넘어져 있는 동안은 쏠 수 없다 (밀어내기)
    if (!onShot(me, m.w)) return;                // 스킬: 과열 중에는 쏠 수 없다, 차지 샷·밀어내기 준비
    me.invulnUntil = 0;                          // 쏘면 스폰 무적 해제
    m.id = me.id; delete m.q;
    if (w.quiet) m.q = 1;                        // 소음기: 받는 쪽에서 소리를 줄이고 미니맵에 표시하지 않는다
    room.broadcast(m, me);
  },
  // 스킬: 누르는 스킬(아드레날린) / 유탄 발사 (server/skills.js)
  sk: (me, m, room) => useSkill(room, me, m),
  gl: (me, m, room) => fireGrenade(room, me, m),
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
        const res = resolveRoom(m, name);
        if (res.error) { ws.send(JSON.stringify({ t: 'denied', reason: res.error })); ws.close(); return; } // 방을 못 찾음/가득 참 등
        me = res.room.join(ws, name, m.loadout);
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
