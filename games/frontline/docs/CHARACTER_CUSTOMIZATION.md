# 캐릭터 옷 (꾸미기) — 구조와 새 옷 만드는 법

> **생산 방침 변경 (2026-11-19)** — 절차적 생성·실험 모델링으로 만든 옛 의상(`tactical_*` v_1~v_4)은 **프로덕션 에셋이 아니다.** 카탈로그(`content/cosmetics.json` `items`)와
> 기본 복장(`defaults.items`)에서 뺐고 GLB 는 `archive/retired_garments/2026-11-19_procedural/` 로 옮겼다(Blender 원본·스크립트는 `모델링/wearables/_deprecated_procedural/`).
> 앞으로 의상은 **외부에서 구한 고품질 3D 에셋**을 이 캐릭터에 맞춰 가져와 쓴다. 아래 도구·규격·입히기 코드는 그대로이며, 외부 에셋을 가져오기·맞추기·검사·내보내기 하는 데 쓴다.
> 카탈로그가 비어 있는 동안 캐릭터는 맨몸이고, 도구 시험은 `tests/fixtures/garment/`(옛 의상 사본)로 돌린다. 본문의 `tactical_*` 는 모두 예시 이름이다.

설계 근거: `character_docs/06_customization/CHARACTER_CUSTOMIZATION_PLAN.md`
첫 세트 보고서: `character_docs/07_outfit_001/OUTFIT_001_REPORT.md`

## 1. 한눈에

| 무엇 | 어디 |
|---|---|
| 아이템·팔레트·기본 옷 데이터 | `content/cosmetics.json` (검사: `shared/content/schema.js` `checkCosmetics`) |
| 규칙 (슬롯·몸 영역·기본값 채우기·정리·네트워크 모양) | `shared/cosmetics.js` (서버·클라이언트 공용) |
| 옷 GLB 불러오기·캐시·재질 합치기 | `client/js/charassets.js` `loadWearable()` |
| 입히기·벗기기·교체·몸 가리기·색 | `client/js/outfit.js` (`dress` `setOutfit` `equip` `setTeamColor` `undress`) |
| 내 선택 저장·전송 | `client/js/loadout.js` (`fd_outfit`, `outfitMessage()`) |
| 서버 | `server/lobby/hub.js`(`lo` 메시지에서 `sanitizeOutfit`) · `server/game/room.js` (`info(P).ck`, 봇 `botOutfit`) |
| 옷 모델 | `content/wearables/<id>_v_<n>.glb` (+ 1인칭 `<id>_v_<n>_fp.glb`) |
| Blender 원본·생성 스크립트 | `모델링/wearables/` · 공용 도구 `tools/blender/frontier_wear.py` |
| 테스트 | `tests/cosmetics.test.mjs` · `tests/garment.test.mjs` (옷 사본 픽스처: `tests/fixtures/garment/`) |

애니메이션·IK·판정·이동 코드(`charanim.js` `charik.js` `shared/hitbox.js` `shared/movement.js`)는 옷을 모른다.
옷 메시는 그 캐릭터의 뼈에 **뼈 이름으로** 묶이므로 모든 클립이 그대로 옷도 움직인다.

## 2. 슬롯과 몸 영역

슬롯: `head hair upper lower hands feet back waist acc1 acc2` (한 슬롯 = 아이템 하나).

몸 영역 19개 (몸·1인칭 팔 GLB 정점의 `_REGION` 번호 = 비트 번호):
`head neck chest abdomen pelvis shoulder_l upperarm_l forearm_l hand_l thigh_l shin_l foot_l shoulder_r upperarm_r forearm_r hand_r thigh_r shin_r foot_r`

- 아이템의 `mask` = 그 옷이 **완전히** 덮는 영역만. 입으면 그 영역의 몸 픽셀을 셰이더가 버린다 (몸 메시는 지우지 않는다. 벗으면 바로 다시 보인다).
- 영역 경계는 삼각형 단위로 들쭉날쭉하다 → 옷은 경계를 **2 cm 이상 넘어** 덮는다.
- 불러오는 중인 옷의 영역은 가리지 않는다 (몸에 구멍이 보이지 않게).

## 3. 아이템 한 줄 (`content/cosmetics.json` `items`)

```json
{"id": "tactical_jacket_001", "name": "택티컬 재킷", "slot": "upper", "set": "tactical_001",
 "tp": "wearables/tactical_jacket_001_v_1.glb", "fp": "wearables/tactical_jacket_001_v_1_fp.glb",
 "mount": "skin", "mask": ["chest", "abdomen", "shoulder_l", "shoulder_r", "upperarm_l", "upperarm_r", "forearm_l", "forearm_r"],
 "rarity": "rare", "unlock": {"type": "default"}, "tags": ["tactical"]}
```

| 칸 | 뜻 |
|---|---|
| `id` | 고유 id (소문자·숫자·`_`). 저장된 선택이 이 id 를 쓰므로 바꾸지 않는다 |
| `slot` | 위 슬롯 중 하나 |
| `tp` / `fp` | 3인칭 모델 / 1인칭 모델 (`content/` 기준). **팔·손·가슴(1인칭에 보이는 영역)을 가리면 `fp` 필수** — 검사기가 막는다 |
| `mount` | `"skin"` (관절 따라 휘는 옷) 또는 `{"bone": "Head"}` (단단한 물건, 그 뼈에 붙임) |
| `mask` | 가리는 몸 영역. 뼈에 붙이는 물건은 빈 목록 |
| `rarity` `unlock` | `common/rare/epic/legendary`, `{type: default/shop/season/achievement}` (지금은 읽기만) |
| `occupies` `blocks` `replaces` | 위아래 한 벌, 머리를 다 덮는 헬멧 같은 충돌 규칙 (`resolveOutfit`) |
| `set` `tags` `season` `variantOf` | 묶음·상점용 (게임 동작에는 영향 없음) |

요구서 예시 칸과의 대응: `model` → `tp`, `viewmodelModel` → `fp`, `bodyMask` → `mask`.

색은 아이템이 아니라 **팔레트**가 정한다: 옷 재질 이름 = 색 칸(`fabric fabric2 leather metal accent team core hair`), 색은 `palettes`, 거칠기·금속성은 `materials`.
`team` 칸은 팀전에서 아군/적 색으로 바뀐다 (개인전은 사람마다 다른 색). 상의에는 `team` 칸을 꼭 넣는다 (멀리서 팀 구분).

## 4. 새 옷 만들기 (Blender)

1. `모델링/character/hyperfps_character_rigged_V.9.blend` (이후 버전)를 연다. **뼈대·몸은 바꾸지 않는다.**
2. 공용 도구를 불러온다: `W = {}; exec(open('<repo>/games/frontline/tools/blender/frontier_wear.py').read(), W)`
3. 모양 만들기 — 둘 중 하나
   - **스크립트 (폐기 — 더 이상 기본 방법이 아님, 초안·실험용)**: `W['garment'](몸, BodyRef, 영역목록, 이름, 두께함수, cuts=[밑단 평면…], seams=[무늬 경계…], paint=[(색칸, 조건)…])` → 몸에서 떼어 부풀린 껍데기 (가중치가 몸과 같아 관절에서 같이 휜다). 주머니·끈·버클은 `add_box` `ribbon`, 패드는 `raise_faces`, 밑단 두께는 `hem`. 예: `모델링/wearables/build_tactical_set_001_V.1.py`
   - **직접 모델링**: 몸 위에 만든 뒤 Data Transfer(가장 가까운 면 보간)로 몸 가중치를 옮기고 관절(어깨·겨드랑이·팔꿈치·손목·엉덩이·무릎)을 다듬는다. 그다음 `W['reweight']` 대신 손으로 정리.
4. 규칙
   - 스킨 옷: `HyperFPS_Skeleton` (1인칭 = `Viewmodel_Skeleton`) 의 Armature 모디파이어 하나, 변형 뼈에만 가중치, 정점당 4개 이하, 합 1 (`W['normalize_weights']`).
   - 단단한 물건: 뼈 부모(`attach_to_bone(obj, arm, 'Head')`). 소켓 뼈(`BackWeaponSocket` 등)도 된다. 새 뼈는 만들지 않는다.
   - 간격: 가린 몸 위 3–6 mm, 보이는 몸 위 6 mm 이상(관절 근처 10 mm), 옷과 옷 사이 6–8 mm (바깥 옷이 더 두껍게).
   - 재질 이름 = 색 칸, 텍스처 없음.
   - 삼각형 예산: upper 5k · lower 4k · head/hair 2.5k · hands/feet 2k · back/waist 2.5k · acc 1k · 1인칭 3.5k. 캐릭터 전체 35k 목표.
5. 검사: `W['check_wearable']([obj], 'upper')` → 실패 항목 0.
6. 내보내기: `W['export_wearable']([obj], '<repo>/games/frontline/content/wearables/<id>_v_<n>.glb', fp=False)` (1인칭은 `fp=True`, 파일명 끝 `_fp`).
   원본은 덮어쓰지 않고 `모델링/wearables/<id>_V.<n>.blend` 로 버전을 올린다.
7. `content/cosmetics.json` 에 한 줄 추가 → `node tests/cosmetics.test.mjs` (파일·뼈대 순서·재질·예산까지 검사).

이것으로 끝이다. 게임 코드는 바꾸지 않는다.

## 5. 게임에서 확인

- URL: `?outfit=upper:-` (상의 벗기), `?outfit=none` (전부), `?outfit=hair:tactical_hair_001,skin:2`, `?outfit=default`
- 개발 서버에서 `?tpcam` 또는 **V** 키 = 내 3인칭 + 오른쪽 아래 1인칭
- 콘솔: `__g.wear.equipOutfit('upper', null)` · `__g.wear.setOutfitChoice({ items: {} })` · `__g.wear.outfitState(__g.localTP.outfit)`

## 6. 네트워크

입장 `join` 에 `outfit: { items, palette, skin }` → 서버 `sanitizeOutfit` → 플레이어 정보 `ck = [팔레트, 피부, [슬롯, id|0], …]` (기본과 다른 슬롯만). 매 틱 전송 없음. 자세한 것은 `docs/PROTOCOL.md`.

## 7. 성능 메모

- 아이템 하나 = 메시 하나 = draw call 하나 (아이템 안의 색 칸은 정점 속성 `_slot` + 색 배열 uniform 으로 한 재질에 합친다).
- 스킨 옷은 몸의 `Skeleton` 을 그대로 공유 (뼈 행렬 계산·업로드 캐릭터당 1번).
- 형상은 경로별 캐시 하나를 모든 캐릭터가 공유. 벗기면 메시만 떼고 형상은 남긴다. 캐릭터 재질은 `undress` 때 정리.
- 옷 셰이더 프로그램 1개(모든 캐릭터 공유) + 몸 가리기 프로그램 2개(색·그림자).

## 8. 아직 없는 것

로비 옷장 화면, 소유·상점, 옷끼리 가리기(안쪽 옷 영역 숨기기), 먼 거리 LOD, 웅크리기 클립(웅크리기 자세 자체가 아직 없다).

## 스튜디오에서 확인하기 (옷 탈부착 · 교체)

`npm run dev` → http://localhost:3002/studio/ → 홈 → 모델 → 의상 → "의상 입혀 보기". 칸마다 옷을 고르면 입히고(교체), 벗고, 1인칭 창까지 같이 본다.
새 옷은 위 §3 의 한 줄을 `content/cosmetics.json` 에 더한 뒤 "새 의상 찾기" (등록 전이면 `.glb` 를 화면에 끌어다 놓아 임시로 입혀 본다).
"검사 실행"이 장착 · 해제 · 같은 칸 교체 · 연속 요청 · 갈아입기 누수를 돌려 준다. 사용법: [MODEL_EDITOR.md](MODEL_EDITOR.md).

## 직접 모델링한 옷 (제작 파이프라인)

몸을 부풀려 만드는 §4 의 방법 외에, 사람이 직접 모델링한 옷을 검사·내보내기·검증하는 도구와 규격이 있다: `docs/GARMENT_ASSET_SPEC.md`(규격), `GARMENT_MODELING_WORKFLOW.md`, `GARMENT_BLENDER_AUTOMATION.md`(`tools/blender/garment_pipeline.py`), `GARMENT_GLB_EXPORT.md`, `GARMENT_THREEJS_INTEGRATION.md`, `GARMENT_QA_CHECKLIST.md`, `GARMENT_FOLDER_STRUCTURE.md`. GLB 검증: `node tools/validate_garment.mjs <glb> --slot <슬롯>`, 테스트: `tests/garment.test.mjs`.
