// 서버와 클라이언트가 함께 쓰는 게임 규칙 상수
export const GOAL = 20;          // 승리에 필요한 킬 수 (FFA)
export const MAX_HP = 100;
export const RESPAWN_MS = 3000;        // 봇이 자동으로 부활하는 시간
export const RESPAWN_MIN_MS = 1500;    // 사람: 죽은 뒤 이 시간이 지나야 부활할 수 있다 (그 뒤 아무 입력이나 하면 부활)
export const MATCH_RESTART_MS = 10000;
export const MATCH_TIME_MS = 5 * 60 * 1000; // 시간 제한 (킬 수 미달이면 최다 킬이 승리)
export const ROOM_MAX = 8;       // 방 최대 인원 (사람 + 봇)
export const BOT_FILL = 6;       // 사람이 적으면 봇으로 이 인원까지 채운다
export const SPAWN_PROTECT_MS = 3000; // 스폰 직후 무적 시간 (쏘면 바로 풀린다)
export const CHAT_MAX_LEN = 120;     // 채팅 한 줄 최대 글자 수
