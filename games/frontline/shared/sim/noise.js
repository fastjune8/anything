// 소리 탐지 (기획 9.3): 적이 낸 소리가 들리는 거리. 미니맵에는 정확한 위치가 아니라 대략의 방향만 보인다.
//   벽·장애물에 따른 감쇠는 아직 없다 (기획 17장 후속 항목).
export const NOISE = {
  walk: 9, sprint: 22, slide: 26, land: 18, fire: 60, quietFire: 0, reload: 10, skill: 20,
};
export const BEARING_STEP = Math.PI / 12; // 방향을 15° 단위로 뭉갠다 (정확한 좌표를 알 수 없게)
export const quantBearing = (dx, dz) => Math.round(Math.atan2(dx, dz) / BEARING_STEP) * BEARING_STEP;
