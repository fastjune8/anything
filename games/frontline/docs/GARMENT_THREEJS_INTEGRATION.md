# Three.js 통합 안내

## 결론: 독립 모델링 옷을 받기 위한 엔진 변경은 필요 없다 (확인함)
`client/js/outfit.js` `attach()` 와 `client/js/charassets.js` `prepareWearable()` 이 이미 다음을 한다.

1. **GLB 를 읽어** 같은 노드의 primitive 들을 한 부품으로 합치고, position/normal/skinIndex/skinWeight 외 속성은 버리고, 재질 이름으로 `_slot` 색 칸을 만든다 (`prepareWearable`).
2. 스킨 부품은 **뼈 이름 목록·역바인드·bindMatrix 를 에셋에 담아 둔다** (`boneNames`, `boneInverses`).
3. 입힐 때 (`attach`):
   - 에셋의 뼈 목록·순서·역바인드가 **몸의 Skeleton 과 같으면** 몸의 `Skeleton` 을 공유 (뼈 행렬 계산 한 번).
   - 아니면 `p.boneNames.map(n => inst.bones.get(n))` 로 **그 캐릭터의 뼈를 이름으로 찾아** 새 `THREE.Skeleton(bones, boneInverses)` 를 만들어 묶는다. 캐릭터에 없는 뼈가 하나라도 있으면 경고하고 그 옷을 입히지 않는다.
   → "분리된 GLB 가 자동으로 같은 스킨 인스턴스를 공유한다" 고 가정하지 않는다: 공유는 조건이 맞을 때만, 아니면 이름 바인딩.
4. 단단한 물건은 `mount: {bone}` 뼈의 자식으로 붙는다.
5. 벗기기 (`detach`) 는 `skeleton = null` 후 제거, 형상은 경로별 캐시에 남기고 재질은 `undress` 에서 정리. 교체·몸 가리기·1인칭(`fp` GLB + 별도 팔 마스크)·네트워크(`ck`)는 기존 그대로.

## 직접 확인한 것 (2026-11-19, 컨테이너 Chrome + swiftshader)
뼈 54개(몸은 59) 만 담은 바지 GLB (`export_def_bones=True`) 를 `registerWearableBuffer` 로 등록해 입혔다:
`sharedSkeleton: false`, 모든 뼈가 캐릭터의 뼈 객체와 동일(`boundToCharacterBones: true`), `LeftUpperLeg` 를 돌리자 그 뼈에 묶인 정점이 0.082 m 움직이고 오른쪽 다리 정점은 0, 벗기자 기본 바지로 복원. 재현: `python3 tools/qa/garment_bind_check.py ...` (PASS).

## 바인딩 약속 (모델러가 지킬 것)
- 관절 이름은 캐릭터 뼈 이름의 부분집합 (새 뼈 없음). 순서는 자유 (몸과 같으면 더 가볍다).
- 역바인드 행렬은 같은 REST 자세에서 → `bind-pose` 검사.
- 아마추어 노드 아래 메시 위치가 그대로 옮겨진다 (`parent: arm.name`, `matrix: rel`).

## 알려진 불일치 (바꾸지 않았다)
- `tests/cosmetics.test.mjs` 는 스킨 옷의 관절이 **몸과 완전히 같기**를 요구한다 (엔진은 부분집합도 허용). "변형 뼈만" 으로 내보낸 GLB 는 게임에선 되지만 이 테스트에서 실패한다. 규칙을 느슨하게 할지는 사람이 정할 일이라 기존 테스트는 그대로 두었다. 대신 `tools/validate_garment.mjs` 가 부분집합을 `info` 로 허용한다.
- 텍스처/UV: 엔진이 속성을 지운다 → 사용 불가 (규격 §4).
- 팔·손·가슴을 가리는 옷은 `fp` 모델 필수 (`checkCosmetics`).
- 옷끼리 가리기(안쪽 옷 영역 숨김)는 아직 없다 (`CHARACTER_CUSTOMIZATION.md` §8).

## 코드 지점 (변경 시)
| 하는 일 | 위치 |
|---|---|
| 읽기·캐시·재질 합치기 | `client/js/charassets.js` `loadWearable`, `prepareWearable`, `registerWearableBuffer` |
| 붙이기·벗기기·교체·색 | `client/js/outfit.js` `attach`, `detach`, `dress`, `setOutfit`, `equip`, `undress`, `outfitState` |
| 규칙·네트워크 모양 | `shared/cosmetics.js` |
| 데이터 검사 | `shared/content/schema.js` `checkCosmetics` |
