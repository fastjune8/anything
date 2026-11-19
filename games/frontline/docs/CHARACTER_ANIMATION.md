# 캐릭터 애니메이션 (게임 런타임)

캐릭터 모델과 클립을 실제 게임에 연결한 구조. 모델·클립 제작은 `모델링/character/`(animation_spec.md, animation_phase3_report.md), 모델 규칙은 `docs/CHARACTER_MODELING.md`.

## 1. 파일
| 파일 | 하는 일 |
|---|---|
| `content/characters/hyperfps_thirdperson_v_6.glb` | 3인칭 전신 (뼈 59개, 클립 17개). Blender `hyperfps_character_rigged_V.8.blend` / `build_animations_V.3.py` (품질 수정 + 무기 0.9배, 2026-11-18). 이전 v_5·v_4 는 보존 |
| `content/characters/hyperfps_viewmodel_v_5.glb` | 1인칭 팔 (뼈 44개, 클립 5개). 같은 판. 이전 v_4·v_3 은 보존 |
| `content/guns/ar_lancer.glb` | 기본 돌격소총 (왼손 자리 `socket_hand_l` V.5) |
| `client/js/charassets.js` | 두 .glb 를 처음 한 번 불러온다. 클립 이름을 **파일에서 읽어** 확인하고(없으면 경고 + 그 동작만 건너뜀), 이동 클립을 하체/상체로 나누고, 반동 클립을 더하기용으로 만든다. 사람마다 `makeInstance` 로 복제(SkeletonUtils) |
| `client/js/charanim.js` | 컨트롤러: `TPAnimator`(3인칭) · `FPAnimator`(1인칭) · `newCharState` · `attachGun` |
| `client/js/charik.js` | 팔 IK (`reachGrip` — 왼손을 총의 `socket_hand_l` 에) |
| `client/js/remotes.js` | 다른 플레이어: 받은 상태 → CharState → TPAnimator. 모델이 없으면 예전 상자 병사 |
| `client/js/viewmodel.js` | 내 1인칭: 라이플이면 팔 모델 + FPAnimator, 그 밖의 무기는 예전 코드 포즈 |
| `client/js/main.js` | 내 3인칭 몸(확인용, `localTP`) + 확인 카메라(V) |

## 2. 상태 → 애니메이션 (CharState)
매 프레임 호출하는 쪽이 채운다. 내 캐릭터는 `me`·`wp`(이동·무기 상태)에서, 다른 사람은 네트워크에서 다시 만든다.

| 칸 | 내 캐릭터 | 다른 플레이어 |
|---|---|---|
| `fwd`, `side` (몸 기준 수평 속도) | `me.vel` 을 `me.yaw` 기준으로 | 그려지는 위치 변화 ÷ 실제 시간 (부드럽게) |
| `air`, `vy` | `!me.onGround`, `me.vel.y` | `s.f & 4`, 높이 변화 |
| `ads` | `wp.adsT` (0~1) | `s.f & 1` → 0.2초 걸쳐 0~1 |
| `sprint` | `wp.sprinting` | `s.f & 2` |
| `rifle` | 든 무기가 `RIFLE_WEAPONS`(지금 `ar`) | `s.w` 가 라이플 |
| `reloadF` (0~1 / null) | `wp.reload.t / total` | `rl` 받은 시각부터 실제 시간 ÷ 재장전 시간(파츠 반영) |
| `shots` (늘어나면 반동) | `wp.shots` (`weapon.js fire()`) | `shot` 받을 때마다 +1 |
| `pitch` | `me.pitch` | `s.x` |

## 3. 3인칭 (TPAnimator)
```
바깥 그룹 (위치·yaw) → 모델 (정면 +Z 로 만든 것을 게임 정면 -Z 로 180° 돌림)
  하체 층  : TP_Idle / Walk·Run ×4방향 / Jump / Fall / Landing 의 "하체 트랙만" (Root·Hips·다리 8)
  상체 층  : 같은 이동 클립의 "상체 트랙만" × (1 − 라이플)  +  TP_Rifle_Idle·Walk·Aim·Reload × 라이플
  더하기 층: TP_Rifle_Fire (0프레임과의 차이) — 쏠 때마다 처음부터
  뒤처리   : 조준 방향 보정 → 위아래 시선 → 왼손 IK → 탄창 따라가기
```
- **같은 뼈를 두 층이 쓰지 않는다**: 클립을 뼈 단위로 나눠서(`#lower`/`#upper`) 하체 층은 하체 뼈만, 상체 층은 상체 뼈만 갖는다. three.js AnimationMixer 에 뼈 마스크가 없어서 트랙을 걸러 낸 클립을 쓰는 방식. 라이플 클립은 원래 상체만 키가 있다.
- **각 층의 가중치 합 = 1** (모자라면 three.js 가 레스트 자세를 섞어 버린다). 시험에서 모든 캐릭터·모든 프레임에서 하체 1.00 / 상체 1.00 확인.
- **시간은 직접 맞춘다** (`timeScale 0`): 걷기·달리기는 같은 **걸음 위상**으로 섞는다. 위상 속도 = 걷기/달리기 비율로 섞은 (실제 속도 ÷ 기준 속도 ÷ 클립 길이). 기준 속도 걷기 1.6 · 달리기 4.6 m/s.
- **이동 섞기**: 속도로 대기↔이동(0.12~0.9 m/s), 걷기↔달리기(1.6~4.6 m/s), 방향은 진행 각도를 이웃한 두 방향에 나눈다(앞·오른쪽·뒤·왼쪽). 모두 0.1초 남짓 부드럽게 따라간다.
- **공중**: 땅을 떠난 지 0.07초 넘으면 공중 (계단·턱의 짧은 공중은 무시). 올라가는 속도 > 1 m/s 면 TP_Jump → 끝나면 TP_Fall, 아니면 바로 Fall. 내리면 TP_Landing 을 처음부터 (움직이고 있으면 약하게).
- **라이플**: 정조준 정도로 Idle/Walk ↔ Aim, 달리는 중·재장전 중에는 조준을 내린다. 재장전 중에는 Reload 가 상체를 맡는다(진행도로 시간 맞춤).
- **조준 방향 보정**: 상체 클립은 골반 기준이라, 걸음의 골반 흔들림(±6~9°)·옆걸음의 골반 40° 돌림·달리기 숙임이 총에 옮겨 간다. 섞은 뒤 `Spine` 에 (골반 회전 변화의 역)을 곱해 상체가 캐릭터 정면을 본다 (라이플일 때). 위아래 시선은 `Spine1`·`Chest` 에 반씩(라이플), 아니면 `Neck`·`Head` 에 조금.
- **왼손 IK**: 총의 `socket_hand_l` 을 쥔다 (charik `reachGrip`). 재장전 중에는 클립의 손을 쓰고, 섞는 동안은 IK 자세와 클립 자세를 가중치로 섞는다 (손이 튀지 않게).
- **총**: 규칙대로 `RightHandGrip` 뼈의 자식, 위치 = −`socket_hand_r`, 회전 없음.
- **탄창**: 재장전 진행도 0.24~0.36 잡고 빼기, 0.36~0.46 숨김, 0.46~0.68 새 탄창이 손에, 0.68 부터 총에 (animation_spec.md 재장전 이벤트).
- **라이플이 아닌 무기**: 총만 오른손 그립에 붙고 상체는 이동 클립의 팔 흔들기 (무기별 클립은 다음 단계).
- **앉기·쓰러짐**: 앉기 클립이 없어 서 있는 자세 그대로(판정만 낮아짐), 쓰러짐은 예전처럼 몸 전체를 눕힌다 (다음 단계).
- **성능**: 캐릭터 하나 갱신 약 0.2 ms. 30 m 밖은 1/30초, 60 m 밖은 1/15초마다 계산, 안 보이면 건너뜀 (처음 보일 때는 바로).

## 4. 1인칭 (FPAnimator)
```
vm 그룹 (카메라 공간, 코드 움직임: 마우스 흔들림·달릴 때 내림·꺼내기·점프)
  └ 팔 모델 (ViewmodelRoot = 눈)
      클립: FP_Rifle_Idle ↔ Aim (wp.adsT), Walk (속도), Reload (진행도), Fire (더하기)
      뒤처리: 정조준 가늠자 맞춤 → 왼손 IK → 탄창
```
- 게임은 1인칭을 별도 카메라(`vmCam`, 52°, near 0.01)로 덧그린다. 클립은 이 카메라 기준으로 만들었다 (허리 자세 총 원점 = 눈에서 오른쪽 9 · 앞 29 · 아래 10 cm).
- 예전 코드 포즈 중 클립이 맡는 것(허리↔정조준 위치, 걸음 흔들림, 반동, 재장전 기울임)은 빼고, 나머지(마우스 흔들림·달릴 때 내림·꺼내기·점프)만 vm 그룹에 얹는다.
- **정조준 가늠자 맞춤**: 조준경 파츠에 따라 조준선 높이가 다르다 → 조준점이 화면 중앙에 오도록 팔 전체를 옮긴다 (정조준 정도만큼).
- 총구 불빛·과열/충전 효과는 예전 총 객체의 값을 팔이 든 총에 옮긴다 (`weapon.js` 는 그대로).

## 5. 1인칭 ↔ 3인칭 맞춤
내 캐릭터의 1인칭 팔과 3인칭 몸은 **같은 게임 상태**(`me`, `wp`)로 같은 프레임에 갱신된다. 정조준 입력·사격(`wp.shots`)·재장전(`wp.reload`)·이동이 둘에 같은 시각에 들어간다. 보이는 연출(위치·길이 대비)은 시점마다 다르게 만들었지만 사건(쏜 순간, 재장전 시작·끝)은 같다.
- 확인 카메라: **개발·테스트 서버에서 V 키** (또는 주소에 `?tpcam`). 화면 전체에 내 3인칭 몸, 오른쪽 아래에 실제 1인칭 화면. 조준·사격은 계속 1인칭 카메라 기준. 라이브 서버에서는 꺼져 있다.

## 6. 네트워크
- 뼈 자세는 보내지 않는다. 서버가 다른 사람에게 보내는 `s` 에 **`f` 상태 비트 하나**만 추가했다 (1 정조준, 2 달리기, 4 공중). 정조준 값은 서버가 이미 입력으로 받고 있었다(`in` 의 7번째 값). 사격은 `shot`, 재장전은 `rl` 이벤트를 그대로 쓴다.
- 봇: 적을 보고 겨누는 동안 `f = 1`.
- `f` 가 없는 예전 서버·클라이언트와도 호환 (없으면 0).

## 7. 명중 판정
`shared/hitbox.js` 의 `HITBOX` 를 캐릭터 모델(키 1.60 m)에 맞췄다: 몸통 위 1.47 → 1.38 m, 머리 중심 1.61 → 1.50 m, 머리 반지름 0.15 → 0.12 m (앉았을 때도 같은 비율). 눈높이·이동 몸통은 그대로. 봇이 노리는 머리 높이도 맞춤 (`bot.js visiblePoint`).

## 8. 확인 방법
- 개발 서버에서 게임에 들어가 V → 내 3인칭 몸과 1인칭이 같이 움직이는지
- 콘솔: `__g.clipNames()` (불러온 클립), `__g.localTP.anim`, `__g.fpArms.anim`, `__g.remotes.get(id).rig.anim` (가중치: `mixer._actions`)
- 모델이 없을 때: 콘솔에 `캐릭터 모델을 불러오지 못했습니다` → 예전 병사·예전 1인칭으로 동작


## 자산 품질 수정 (V.7, 2026-11-18)

보고서: `anything/character_docs/05_quality/ANIMATION_QUALITY_REPORT.md`

- 손목 비틀림: 손이 아래팔 축 둘레로 도는 회전의 절반을 `ForeArm` 뼈가 나눠 맡는다 (손 월드 변환은 그대로). 손목이 찌그러지지 않게 하는 규칙이라, 새 클립도 `build_animations_V.2.py` 의 `bake_clip` 으로 구우면 자동 적용된다. 게임의 왼손 IK(`charik.js reachGrip`)는 아래팔을 최소 회전으로만 돌리므로 이 비틀림을 유지한다.
- 3인칭 라이플 자세: 낮게 든 자세는 개머리판 끝이 오른쪽 어깨 앞, 조준은 볼을 개머리판에 붙인 위치 (총구 방향은 그대로).
- 재장전 끊김 (`charanim.js`): 재장전 진행도가 끝나기 전에 `null` 이 되면(무기 교체) 재장전 클립 시간을 마지막 진행도(`reloadT`)에 두고 가중치만 0.2 s 동안 줄인다. 정상 종료는 기존과 같다.
- 되돌리기: `charassets.js` 의 `CHAR_FILES` 를 `hyperfps_thirdperson_v_4` / `hyperfps_viewmodel_v_3` 으로.

## 무기 크기 (V.8, 2026-11-18)

보고서: `anything/character_docs/05_quality/weapon_scale/WEAPON_SCALE_REPORT.md`

- 게임은 모든 총과 파츠를 `client/js/guns.js` 의 `WEAPON_SCALE` (0.9) 배율로 그린다. 총 모델 파일은 실제 크기 그대로.
- 기준값(손잡이·가늠자·총구·왼손 소켓)도 같은 배율로 나온다 → 정조준, 1인칭 팔, 3인칭 손 IK 가 그대로 맞는다.
- 라이플 클립은 같은 배율의 소켓으로 구웠다 (`build_animations_V.3.py` 의 `WEAPON_SCALE`). **두 값을 바꿀 때는 함께 바꾸고 라이플 클립을 다시 굽는다.**
- 되돌리기: `WEAPON_SCALE = 1` + `CHAR_FILES` 를 `hyperfps_thirdperson_v_5` / `hyperfps_viewmodel_v_4` 로.
