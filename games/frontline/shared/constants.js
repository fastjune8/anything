// 서버와 클라이언트가 함께 쓰는 게임 규칙 상수 (인원·킬 수 등 모드별 값은 modes.js)
export const MAX_HP = 100;
export const RESPAWN_MS = 3000;        // 봇이 자동으로 부활하는 시간
export const RESPAWN_MIN_MS = 1500;    // 사람: 죽은 뒤 이 시간이 지나야 부활할 수 있다 (그 뒤 아무 입력이나 하면 부활)
export const MATCH_RESTART_MS = 10000;
export const MATCH_TIME_MS = 5 * 60 * 1000; // 시간 제한 (킬 수 미달이면 최다 킬이 승리)
export const SPAWN_PROTECT_MS = 3000; // 스폰 직후 무적 시간 (쏘면 바로 풀린다)
export const CHAT_MAX_LEN = 120;
export const LEAN_DIST = 0.4;        // 기울이기(Q/E): 머리가 옆으로 나가는 최대 거리 (m)
export const LEAN_ANGLE = 0.46;      // 그때 다른 사람 화면에서 상체가 기울어지는 각도 (rad)     // 채팅 한 줄 최대 글자 수
