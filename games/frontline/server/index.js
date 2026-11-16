// 서버 진입점: HTTP + WebSocket 을 묶어서 시작한다
import { MODES } from '../shared/modes.js';
import { PORT, lanAddresses } from './config.js';
import { createHttpServer } from './http.js';
import { attachWebSocket } from './net.js';

const server = createHttpServer();
attachWebSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  FRONTIER 서버 실행 중\n');
  console.log(`  이 컴퓨터:        http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  같은 네트워크:    http://${ip}:${PORT}`);
  console.log(`\n  모드: ${Object.values(MODES).map(m => `${m.name}(최대 ${m.max}명)`).join(', ')}  (Ctrl+C 로 종료)\n`);
});
