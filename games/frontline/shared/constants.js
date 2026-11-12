// 서버와 클라이언트가 함께 쓰는 게임 규칙 상수
export const GOAL = 20;          // 승리에 필요한 킬 수 (FFA)
export const MAX_HP = 100;
export const RESPAWN_MS = 3000;
export const MATCH_RESTART_MS = 10000;
export const MATCH_TIME_MS = 5 * 60 * 1000; // 시간 제한 (킬 수 미달이면 최다 킬이 승리)
export const ROOM_MAX = 8;       // 방 최대 인원 (사람 + 봇)
export const BOT_FILL = 6;       // 사람이 적으면 봇으로 이 인원까지 채운다
export const CHAT_MAX_LEN = 120;     // 채팅 한 줄 최대 글자 수
