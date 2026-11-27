# 옷 에셋 규격 (Garment Asset Specification)

독립 모델링된 옷(외부에서 구해 이 캐릭터에 맞춘 에셋 포함)을 게임에 넣기 위한 규격. 절차적 생성으로 만든 옛 옷은 폐기됐고(`archive/retired_garments/`) 프로덕션 에셋으로 취급하지 않는다. 모든 항목은 실제 코드/파일에서 확인한 사실이거나, 아래 "검사" 칸의 도구로 기계 검사된다.
기존 옷 생성기(`tools/blender/frontier_wear.py`의 `garment`, 몸 표면을 부풀리는 방식)는 그대로 남아 있고 이 규격과 같은 규칙을 쓴다.

## 1. 기준 데이터

| 무엇 | 값 | 출처 |
|---|---|---|
| 3인칭 뼈대 / 몸 | `HyperFPS_Skeleton` (뼈 59, 변형 뼈 52) / `Body_Mesh` | `모델링/character/hyperfps_character_rigged_V.9.blend` |
| 1인칭 뼈대 / 팔 | `Viewmodel_Skeleton` (뼈 44, 변형 39) / `Viewmodel_Mesh` | 같은 파일 |
| 게임용 몸 GLB | `content/characters/hyperfps_thirdperson_v_8.glb` (관절 61), `hyperfps_viewmodel_v_7.glb` (관절 46, 아래팔 꼬임 뼈 포함) | `tests/cosmetics.test.mjs` |
| 좌표 | Blender Z 위, 캐릭터는 -Y 를 본다, 왼쪽 = +X, 키 약 1.6 m, 1 단위 = 1 m, T 자세 REST | 몸 파일 |
| 내보내기 축 | glTF Y 위 (`export_yup=True`) | `frontier_wear.export_wearable` |

## 2. 기하

| 규칙 | 값 | 검사 |
|---|---|---|
| 아이템 하나 = 메시 하나 (그려 내기 호출 하나). 주머니·버클 같은 단단한 조각은 `<id>.hs.<이름>` 으로 따로 모델링하고 내보내기 전에 합친다 | 1 | `validate_garment.mjs` one-mesh (warn) |
| 이름 | `^[a-z][a-z0-9]*(_[a-z0-9]+)*_\d{3}(_fp)?$` 예: `tactical_jacket_001`, 1인칭은 `_fp` | `check_naming` |
| 변환 | 스케일 1, 회전 0 적용(Ctrl+A). 스킨 옷은 아마추어의 자식, 위치 0 | `check_transforms` |
| 크기 | 몸 상자의 1.4배 + 5 cm 이내 | 둘 다 (scale) |
| 삼각형 예산 | upper 5000 · lower 4000 · head/hair 2500 · hands/feet 2000 · back/waist 2500 · acc 1000 · **1인칭 3500** | 둘 다 (`tests/cosmetics.test.mjs` 와 같은 값) |
| 법선 | 바깥을 본다. 본체의 2 % 넘게 몸 쪽을 보면 경고, 10 % 넘으면 실패. 단힌 조각(상자)은 밑면이 몸을 봐도 된다 | `check_geometry`, winding |
| 깨끗한 면 | 떠 있는 정점·넓이 0 삼각형·세 면 이상이 만나는 모서리 없음. n-각형(>4)과 겹친 정점은 경고 | `check_geometry` |
| 두께/간격 | 가린 몸 위 3–6 mm, 보이는 몸 위 6 mm 이상 (관절 근처 10 mm). 몸 안쪽으로 1 % 넘게 들어가면 실패, 3 mm 미만이 10 % 넘으면 경고 | `check_clearance`, clearance |
| 겹옷 간격 | 옷과 옷 사이 6–8 mm (바깥 옷이 더 두껍게) | 수동 (QA 체크리스트) |

## 3. 리그

- 스킨 옷: 아마추어 모디파이어 하나(`HyperFPS_Skeleton`, 1인칭은 `Viewmodel_Skeleton`). **새 뼈를 만들지 않는다**, 기준 자세(REST)를 바꾸지 않는다.
- 버텍스 그룹 이름 = 뼈 이름 그대로 (`LeftUpperArm` …). 변형 뼈에만 가중치 (소켓 뼈 `BackWeaponSocket` 등은 단단한 물건 전용).
- 정점당 영향 뼈 4개 이하, 합 1, 가중치 없는 정점 없음.
- 단단한 물건(헤드셋·백팩·머리카락): 뼈 부모로 붙인다 (`mount: {"bone": ...}`), 스킨 불필요.
- 가중치 만들기/고치기: `weights_from_body` (몸의 가장 가까운 정점 가중치를 섞고 4개로 줄이고 이웃 평균으로 다듬음) 로 시작해서 Weight Paint 로 손본다.
- 변형 시험: `deform_test` — 무릎·팔꿈치·어깨·목·고관절 등을 돌려서 (a) 몸 안으로 파묻히는 정점 비율 (b) 가장 늘어난 모서리를 잰다. 늘어남은 같은 자세에서 몸이 늘어난 정도의 2배(최소 2.5배)를 넘으면 실패.
- 역바인드 행렬은 몸과 같아야 한다 (같은 REST 자세에서 내보낸 것). 검사: `bind-pose`.

## 4. 재질

- 재질 이름 = 색 칸: `fabric fabric2 leather metal accent team core` (+ `hair`). 이 이름이 아니면 `fabric` 으로 그려진다 (`client/js/charassets.js` `slotIndex`).
- 색·거칠기·금속성은 아이템이 아니라 `content/cosmetics.json` 의 `palettes`/`materials` 가 정한다. 상의에는 `team` 칸을 꼭 넣는다.
- **텍스처·UV 는 지금 게임이 쓰지 않는다**: `prepareWearable` 은 position/normal/skinIndex/skinWeight 외의 속성을 지운다. 그래서 규격은 "텍스처 없음". (Blender 에는 UV 를 만들어 둬도 되지만 GLB 에서 버려진다.) 텍스처를 쓰려면 `charassets.js`/`outfit.js` 셰이더 확장이 필요하다 — 로드맵 항목이지 지금 기능이 아니다.
- 공유 재질: `ensure_structure()` 가 색 칸 재질 7종을 만들고 fake user 를 건다. 새 재질을 만들지 않는다.

## 5. Blender 정리 (컬렉션)

```
WEAR_<세트>                 ← 세트 하나
 ├─ WEAR_<세트>_MESH        직접 모델링한 옷 본체 (<id>, <id>_fp)
 ├─ WEAR_<세트>_HARD        단단한 조각 (<id>.hs.<이름>)
 ├─ WEAR_<세트>_REF         참고용 (몸 복사본, 스케치) — 내보내지 않음
 └─ WEAR_<세트>_EXPORT      합친 복사본 (join_pieces 결과) — 내보내기 전용, 숨김
(재질 자원: 색 칸 재질 7종, fake user)
```
`ensure_structure('<세트>')` 가 만든다. 기존 세트 001 은 `WEAR_tactical_001` 한 컬렉션에 몰려 있다 (그대로 둔다).

## 6. 게임 쪽 약속 (바꾸지 않는 것)

아이템 id · 슬롯 · `equipOutfit/setOutfitChoice/dress/undress` · 몸 가리기(`mask`, `_REGION`) · 네트워크 `ck` · `fp` 모델 쌍. 새 규격은 이것들을 그대로 쓴다.
