// 시험 전용: 서버가 가끔 CPU 를 못 받아 멈추는 상황(Oracle E2.1.Micro 의 CPU 제한)을 로컬에서 재현한다.
//   NETSIM_STALL="45:4000" → 평균 4초에 한 번, 대략 45ms(±30%) 동안 이벤트 루프를 막는다. 라이브(APP_ENV=prod)에서는 절대 켜지지 않는다.
const spec = String(process.env.NETSIM_STALL || '').split(':').map(Number);
if (spec.length === 2 && spec.every(Number.isFinite) && process.env.APP_ENV !== 'prod') {
  const [ms, every] = spec;
  const loop = () => setTimeout(() => {
    const d = ms * (0.7 + Math.random() * 0.6), e = performance.now() + d;
    while (performance.now() < e) { /* 의도적으로 막는다 */ }
    loop();
  }, every * (0.5 + Math.random()));
  loop();
  console.log(`  [시험] 서버 정지 재현: 약 ${ms}ms 씩 평균 ${every}ms 마다`);
}
