// 시뮬레이션 엔진 공용 상수 (서버·브라우저가 똑같이 쓴다). 기획서(docs/GAME_DESIGN.md)에서 "미확정"인 수치는
// 여기서 임시로 정해 두었다 — 바꿀 때는 이 파일 한 곳만 고치면 서버 판정·브라우저 예측이 함께 바뀐다.

// ───── 시간 ─────
export const TICK_HZ = 60;            // 시뮬레이션 주기. 입력(cmd) 1개 = 1 tick
export const DT = 1 / TICK_HZ;
export const SNAP_EVERY = 2;          // 다른 플레이어 상태는 2 tick 마다(30Hz) 보낸다
export const HISTORY_TICKS = 60;      // 랙 보정용 자세 기록 (1초)
export const MAX_REWIND_TICKS = 22;   // 최대 0.37초까지 되감아 판정 (favor-the-shooter 한도). 보간 버퍼 최대 14tick + 편도 지연 약 8tick(RTT 270ms)까지 맞는다
export const INTERP_TICKS = 6;        // 브라우저가 다른 플레이어를 그리는 지연 (0.1초)

// ───── 몸 ─────
export const BODY = {
  STAND_H: 1.75, CROUCH_H: 1.2, SLIDE_H: 1.0, RADIUS: 0.35, STEP: 0.45,
  EYE: 0.23,                          // 몸 꼭대기에서 눈까지 (서 있을 때 눈 1.52m — 캐릭터 머리 판정 1.50m 에 맞춤)
};

// ───── 이동 (m/s, m/s²) ─────
export const MOVE = {
  walk: 4.8, sprint: 7.0, crouch: 2.4,
  groundAccel: 11, airAccel: 2.6, friction: 7.5, stopSpeed: 2.2,
  gravity: 19, jumpV: 6.4,
  coyote: 0.1, jumpBuffer: 0.12,      // 발이 떨어진 뒤에도 점프되는 시간 / 미리 누른 점프를 기억하는 시간
  // 슬라이딩 (기획 17장: 지속 시간·쿨다운 미확정 → 임시값)
  slideMinSpeed: 5.2,                 // 이 속도 이상으로 달리던 중에만 슬라이딩
  slideBoost: 2.6, slideMax: 11.5,    // 시작할 때 더하는 속도 / 상한
  slideFriction: 5.2, slideDur: 0.9, slideCooldown: 1.6, slideEndSpeed: 3.2, // slideCooldown = 기본 가속(+2.6)을 다시 받기까지 (슬라이딩 자체는 언제든)
  slideSlopeAccel: 9,                 // 내리막에서 가속
  // 이어 달리기 (Apex 식): 착지하며 슬라이딩 · 슬라이딩 점프
  landSlideWindow: 0.12,              // 착지 뒤 이 시간 안에 앉기를 누르고 있으면 바로 슬라이딩
  landSlideMin: 4.4,                  // 착지 슬라이딩에 필요한 최소 속도 (걷다 점프해도 이어진다)
  landBoost: 0.4,                     // 땅을 떠난 곳보다 낮게 떨어진 높이 h 만큼의 낙하 속도 √(2gh) × 0.4 를 슬라이딩 속도로 바꾼다
  boostCap: 13,                       // 착지·슬라이딩 가속으로 만들 수 있는 최대 속도 (그 이상은 외부 힘 — 반동·폭발 — 으로만)
  slideGrace: 0.25, slideGraceMul: 0.25, // 슬라이딩 처음 0.25초는 마찰이 1/4 (착지·연계 직후 속도가 바로 죽지 않게)
  slideOverDrag: 1.6,                 // 최대(slideMax) 보다 빠른 슬라이딩은 더 빨리 줄어든다 (초과분 × 이 값 / 초)
  slideJumpLift: 0.3, slideJumpLiftMax: 2.2, // 슬라이딩 점프: 달리기보다 빠른 만큼 × 0.3 을 점프 속도에 더한다 (더 높이)
  knockFriction: 0.22, knockControl: 0.25, // 밀려나는 동안 마찰·조작 배율 (얼음판처럼 미끄러짐)
};

// ───── 체력 · 부활 (기획 4장·5장: 수치 미확정 → 임시값) ─────
export const HEALTH = { max: 150, regenDelay: 5, regenRate: 30 };
export const SPAWN = { protect: 3.0, intro: 0.7 };   // 부활 보호 최대 시간 / 등장 연출 시간 (초)
export const KILL_Y = -12;                            // 이 높이 아래로 떨어지면 낙사
export const ASSIST_WINDOW = 10;                      // 이 시간 안에 피해를 준 사람은 어시스트 (통계용)
export const ENV_CREDIT = 6;                          // 낙사 전 이 시간 안에 피해·밀어내기를 준 적이 처치자

// ───── 입력 버튼 (cmd 의 btn 비트) ─────
export const BTN = { jump: 1, crouch: 2, sprint: 4, fire: 8, ads: 16, reload: 32, sk1: 64, sk2: 128, mode: 256, node: 512 }; // node = 쿠나이 핀 노드 (F) // mode = 쿠나이 기동/설치 모드 전환 (X)

// ───── 다른 사람에게 보이는 상태 비트 (스냅샷의 f) ─────
export const PF = {
  ads: 1, sprint: 2, air: 4, slide: 8, crouch: 16, stun: 32, stealth: 64, protect: 128,
  invuln: 256, reload: 512, grapple: 1024, dash: 2048, intro: 4096, dr: 8192,
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
