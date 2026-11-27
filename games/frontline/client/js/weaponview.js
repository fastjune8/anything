// 무기가 "어떻게 보이는가" — 1인칭 조준 화면(도트·가늠자·스코프)과, 그에 따라 달라지는 연출 수치를 한 곳에서 정한다.
//   순수 모듈: 아무것도 import 하지 않는다 (THREE·DOM·다른 모듈의 상태 없음). Node 에서 그대로 테스트한다 — tests/arch.test.mjs.
//
//   규칙: 연출 코드(카메라·총 모델·화염·HUD)는 무기 종류(w.kind === '...')를 직접 묻지 말고 viewOf(무기 번호).ads 만 읽는다.
//   새 조준 방식(예: 홀로그램, 레이저)은 SIGHTS 에 항목 하나를 더하고, sightFor 에서 어떤 무기가 쓰는지 정하면 된다 — 다른 파일은 그대로.
// ads 수치: "정조준(adsT = 1)일 때 줄이는 비율". 실제 배율 = 1 - 값 × adsT
export const SIGHTS = {
  iron: { // 기본 가늠자
    reticle: null,        // 화면 가운데에 그리는 조준점 (null = 없음, 'dot' = 빨간 점)
    crosshair: 0.35,      // 정조준 때 HUD 십자선의 불투명도
    cameraKick: 0,        // 화면(카메라)이 반동으로 흔들리는 양을 줄이는 비율
    vmKick: 0.45,         // 총 모델이 튀는 양
    flash: 0.5,           // 총구 화염 크기
    light: 0,             // 총구 불빛
    fireClip: 0,          // 팔 모델의 발사 반동 클립 세기
  },
  dot: { // 도트 사이트(레드 도트): 조준경 유리 한가운데의 빨간 점. 화염·흔들림이 시야를 덜 가리게 한다.
    //   화면(시각) 반동은 실제 탄이 가는 방향(me.yaw·pitch)과 별개라 쏘는 동안 화면 중앙이 탄착점에서 벗어난다 → 정조준하면 거의 없애서 점 = 탄착점이 되게 한다
    reticle: 'dot', crosshair: 0, cameraKick: 0.85, vmKick: 0.75, flash: 0.92, light: 0.8, fireClip: 0.7,
  },
  scope: { // 스코프(저격소총): 별도 스코프 화면(HUD #scope)이 덮는다
    reticle: null, crosshair: 0, cameraKick: 0, vmKick: 0.45, flash: 0.5, light: 0, fireClip: 0,
  },
};

// 도트 사이트를 달 수 있는 무기인가 (무기 데이터만으로 정하는 규칙). 저격소총(스코프)·근접·쿠나이는 아니다
export const wantsDot = w => !w.scope && w.kind !== 'melee' && w.kind !== 'kunai';
// 총 모델을 만들 때 기본으로 다는 부품 (guns.js 의 setGunParts 가 받는 모양). 부품 수치(조준 속도·탄퍼짐)는 건드리지 않는다 — 모양과 조준 화면만 바뀐다
export const defaultParts = w => (wantsDot(w) ? { optic: 'reddot' } : {});
// 무기 + 만들어진 총 모델 → 조준 방식. 조준경 받침이 없는 총 모델(리볼버 등)은 달 수 없으므로 가늠자를 쓴다
export const sightFor = (w, gun) => (w.scope ? 'scope' : wantsDot(w) && gun && gun.optic ? 'dot' : 'iron');

// 무기 번호(WEAPONS 의 위치) → 조준 방식. 총 모델을 만드는 쪽(viewmodel.js)이 무기마다 한 번 알려 준다. 알리기 전에는 가늠자
const sights = [];
export const bindSight = (wi, sight) => { if (SIGHTS[sight]) sights[wi] = sight; };
const VIEWS = Object.fromEntries(Object.entries(SIGHTS).map(([sight, ads]) => [sight, { sight, ads }])); // 매 프레임 부르므로 객체를 새로 만들지 않는다
export const viewOf = wi => VIEWS[sights[wi] || 'iron'];
