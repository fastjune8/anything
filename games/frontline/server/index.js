// 서버 진입점: HTTP + WebSocket 을 묶어서 시작한다
import { ROOM_MAX } from '../shared/constants.js';
import { PORT, botFill, lanAddresses } from './config.js';
import { createHttpServer } from './http.js';
import { attachWebSocket } from './net.js';

const server = createHttpServer();
attachWebSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  FRONTLINE DUEL — 봇 대전(FFA) 서버 실행 중\n');
  console.log(`  이 컴퓨터:        http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  같은 네트워크:    http://${ip}:${PORT}`);
  console.log(`\n  방당 최대 ${ROOM_MAX}명, 사람이 적으면 봇이 ${botFill()}명까지 채웁니다. (Ctrl+C 로 종료)\n`);
});
