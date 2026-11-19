# 캐릭터 모델 규칙 (요약)

자세한 리깅 명세는 `모델링/character/rigging_specification.md` (리그 생성 스크립트 `build_character_rig.py` 와 같이 있다).
스튜디오 **모델 에디터**가 이 규칙으로 검사한다 — `.glb` 를 열면 리깅된 캐릭터는 자동으로 **캐릭터 보기**가 된다.

## 두 가지 파일
| | 뼈대 | 원점 · 방향 (glTF) |
|---|---|---|
| 3인칭 전신 | `HyperFPS_Skeleton` (Root, Hips …) | 두 발 사이 바닥, 정면 **+Z**, 위 +Y, 키 약 1.6~1.9m |
| 1인칭 팔 (뷰모델) | `Viewmodel_Skeleton` (ViewmodelRoot …) | 원점 = 눈(카메라), 정면 **−Z** — `camera.add()` 하면 그대로 |

## 검사하는 것
- **필수 뼈**: 3인칭 `Root Hips Spine Spine1 Chest Neck Head` + 양쪽 `Shoulder UpperArm ForeArm Hand UpperLeg LowerLeg Foot Toe`, 1인칭 `ViewmodelRoot ViewmodelChest` + 양팔
- **손가락**(없으면 확인 사항): `<Left|Right><Thumb|Index|Middle|Ring|Little><1|2|3>`
- **부착 지점**: 3인칭 `RightHandGrip LeftHandGrip WeaponRoot LeftHandIK BackWeaponSocket HipWeaponSocket`, 1인칭 `ViewmodelRightGrip ViewmodelLeftGrip ViewmodelWeaponRoot ViewmodelLeftHandIK`
- **웨이트**: 웨이트 없는 정점 ✕, 합이 1 이 아닌 정점 !, 한 정점에 뼈 4개까지
- **크기**: 3인칭 키 1.4~2.2m, 발바닥 y = 0, 정면 +Z. 크기가 1 이 아닌 뼈 !
- **삼각형**: 3인칭 권장 20,000 / 최대 40,000, 1인칭 권장 12,000 / 최대 20,000. 파일 최대 4MB
- **클립 이름**: 3인칭 `TP_<동작>[_<방향|무기종류>]`, 1인칭 `FP_<동작>_<무기종류>` — 단어마다 대문자로 시작 (예: `TP_Idle`, `TP_Walk_Left`, `TP_Run_Back`, `FP_Reload_Rifle`; 방향: Back Left Right, 무기 종류: Rifle Smg Shotgun Sniper Pistol Melee). 크기(scale) 키 !
- **이동 클립은 제자리(in-place)**: `Root` 에 키 없음. 게임이 캡슐을 움직이고 재생 속도 = 실제 속도 ÷ 클립 기준 속도 (기준 속도는 `모델링/character/animation_spec.md`)

## 무기 쥐기 (게임과 같은 규칙)
- 무기는 오른손 그립(`RightHandGrip` / `ViewmodelRightGrip`)에: 무기의 `socket_hand_r` 이 그 자리에 온다
- 왼손: 무기의 `socket_hand_l` 에 왼손 그립이 오도록 2-본 IK (`client/js/charik.js`)
- **팔이 닿지 않으면** 왼손을 총열을 따라 손잡이 쪽으로 당겨 닿는 데서 쥔다 — 모델 에디터가 몇 cm 당겼는지 알려 준다 (총의 `socket_hand_l` 을 옮기거나 크기를 맞출 때 참고)

## 애니메이션
- 파일 안의 클립, 또는 **같은 뼈대로 만든 애니메이션만 담은 .glb** 를 "애니메이션 불러오기" 로 붙여 본다 (뼈 이름으로 맞춘다)
- **상체 덧씌우기**: 하체 클립(걷기·달리기) 위에 상체 클립(조준·재장전)을 겹쳐 본다. 하체 = `Root Hips` + 양다리 8개, 나머지 = 상체
