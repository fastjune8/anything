// 네트워크 장애 재현 프록시 (TCP 바이트를 그대로 전달하면서 지연·지터·손실을 끼워 넣는다).
//   브라우저/봇 ↔ [이 프록시] ↔ 게임 서버.  WebSocket 도 HTTP 도 그냥 지나간다.
//   프로필: { rtt(ms, 왕복), jitter(ms, 한 방향 ± 흔들림), loss(0~1, 메시지 하나가 손실될 확률) }, 실행 중에 setProfile 로 바꿀 수 있다.
//   손실은 TCP 처럼: 잃어버린 조각은 재전송을 기다리는 동안(빠른 재전송 ≈ 1.1×RTT, 15% 는 타임아웃 max(200ms, 2×RTT)) 뒤따르는 조각도 못 나간다 (head-of-line blocking).
//   그래서 WebSocket 위에서의 손실은 "메시지가 사라지는 것" 이 아니라 "잠깐 멈췄다가 몰려오는 것" 으로 나타난다 — 실제 브라우저가 겪는 모양.
//   한계: 실제 장비의 큐 지연·대역폭 제한·혼잡 제어는 흉내 내지 않는다. 실제 리눅스 서버에서는 `tc qdisc add dev <nic> root netem delay 75ms 10ms loss 1%` 로 같은 시험을 할 수 있다.
import net from 'node:net';

const rnd = () => Math.random();
class Link {
  constructor(dest, getProf, stats, dir) { this.dest = dest; this.getProf = getProf; this.last = 0; this.stats = stats; this.dir = dir; }
  push(chunk) {
    const p = this.getProf(), now = performance.now();
    let d = p.rtt / 2 + (rnd() * 2 - 1) * p.jitter;
    if (d < 0) d = 0;
    if (p.loss > 0 && rnd() < p.loss) {
      d += rnd() < 0.15 ? Math.max(200, p.rtt * 2) : p.rtt * 1.1 + 5;
      this.stats.lost++;
    }
    const at = Math.max(this.last, now + d); // TCP 는 순서를 지킨다
    this.last = at;
    this.stats[this.dir] += chunk.length;
    if (at - now < 0.5) { if (!this.dest.destroyed) this.dest.write(chunk); return; }
    setTimeout(() => { if (!this.dest.destroyed) this.dest.write(chunk); }, at - now);
  }
}

export function createProxy({ target, port = 0, profile = { rtt: 0, jitter: 0, loss: 0 } }) {
  let prof = { rtt: 0, jitter: 0, loss: 0, ...profile };
  const stats = { lost: 0, up: 0, down: 0, conns: 0 };
  const socks = new Set();
  const server = net.createServer(c => {
    stats.conns++;
    const u = net.connect(target.port, target.host || '127.0.0.1');
    c.setNoDelay(true); u.setNoDelay(true); socks.add(c); socks.add(u);
    const up = new Link(u, () => prof, stats, 'up'), down = new Link(c, () => prof, stats, 'down');
    c.on('data', d => up.push(d)); u.on('data', d => down.push(d));
    const end = () => { c.destroy(); u.destroy(); socks.delete(c); socks.delete(u); };
    c.on('close', end); u.on('close', end); c.on('error', end); u.on('error', end);
  });
  return new Promise(res => server.listen(port, '127.0.0.1', () => res({
    port: server.address().port, stats,
    setProfile(p) { prof = { rtt: 0, jitter: 0, loss: 0, ...p }; },
    close() { for (const s of socks) s.destroy(); server.close(); },
  })));
}
