// 실내 조명(P3-2): 지붕 있는 시각 모델 안쪽에서 주변광을 줄이고 따뜻한 등 빛을 더하는 재질 셰이더 패치.
import * as THREE from 'three';

// 지붕 있는 시각 모델 안쪽(상자)에서는 하늘빛·주변 반사(그늘 빛)를 줄이고, 위에서 내려오는 따뜻한 등 빛을 더한다.
// 실제 광원(PointLight)을 늘리지 않고 맵 재질 셰이더에 상자 몇 개만 넘긴다 → 그리기 호출·그림자 비용 그대로.
// 캐릭터 재질에는 넣지 않는다: 실내에서도 적이 배경보다 밝게 떠 보이도록.
// 모델 기준 실내 상자 (벽 안쪽 면·천장 아래). 모델이 바뀌면 여기만 고친다
export const INDOOR_BOXES = { warehouse: { min: [-9.85, -1, -7.85], max: [9.85, 4.9, 7.85] } };
export const MAX_INDOOR = 4;
export const INDOOR = {
  uIndoorN: { value: 0 },
  uIndoorMin: { value: Array.from({ length: MAX_INDOOR }, () => new THREE.Vector3()) },
  uIndoorMax: { value: Array.from({ length: MAX_INDOOR }, () => new THREE.Vector3()) },
  uIndoorAmb: { value: 0.4 },
  uIndoorCol: { value: new THREE.Color() },
};
function indoorPatch(sh) {
  Object.assign(sh.uniforms, INDOOR);
  sh.vertexShader = 'varying vec3 vIndoorW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vIndoorW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = `uniform int uIndoorN; uniform vec3 uIndoorMin[${MAX_INDOOR}]; uniform vec3 uIndoorMax[${MAX_INDOOR}]; uniform float uIndoorAmb; uniform vec3 uIndoorCol; varying vec3 vIndoorW;
float indoorK(vec3 p) {
  float k = 0.0;
  for (int i = 0; i < ${MAX_INDOOR}; i++) {
    if (i >= uIndoorN) break;
    vec3 o = max(max(uIndoorMin[i] - p, p - uIndoorMax[i]), 0.0); // 상자 밖으로 나간 거리
    k = max(k, 1.0 - smoothstep(0.0, 0.28, length(o)));
  }
  return k;
}
` + sh.fragmentShader.replace('#include <aomap_fragment>', `{
    float kIn = indoorK(vIndoorW);
    if (kIn > 0.0) {
      float a = mix(1.0, uIndoorAmb, kIn);
      reflectedLight.indirectDiffuse *= a; reflectedLight.indirectSpecular *= a;
      vec3 nW = inverseTransformDirection(normal, viewMatrix);
      reflectedLight.directDiffuse += kIn * uIndoorCol * (0.45 + 0.55 * clamp(nW.y * 0.5 + 0.5, 0.0, 1.0)) * BRDF_Lambert(material.diffuseColor);
    }
  }
  #include <aomap_fragment>`);
}
export const patchIndoor = m => { if (m.onBeforeCompile !== indoorPatch) { m.onBeforeCompile = indoorPatch; m.needsUpdate = true; } return m; };
