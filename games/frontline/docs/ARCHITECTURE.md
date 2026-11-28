# 구조

> **기준 문서:** 게임 기획의 최상위 기준은 [`GAME_DESIGN.md`](GAME_DESIGN.md) 이다. 이 문서·코드·다른 docs 와 내용이 다르면 기획서가 우선한다.

서버가 방(Room) 단위로 60Hz 시뮬레이션을 돌리고(권한), 브라우저는 같은 시뮬레이션 코드로 먼저 반응(예측)하며 three.js 로 그린다.
엔진 구조와 기획서 미확정 사항의 임시값은 [`ENGINE.md`](ENGINE.md), 메시지는 [`PROTOCOL.md`](PROTOCOL.md).
빌드 단계 없이 ES 모듈을 그대로 쓴다. (`npm install` 후 바로 실행)

```
games/frontline/
├── shared/                 서버·브라우저 공용 (THREE·DOM 의존 없음)
│   ├── sim/                ★ 게임 엔진: 결정적 시뮬레이션
│   │   ├── config.js       tick·몸·이동·체력·부활·버튼/상태 비트 (미확정 수치는 여기)
│   │   ├── movement.js     캐릭터 컨트롤러 (가속/마찰·점프·슬라이딩·넘어가기·넉백·넘어짐·스킬 이동·충돌)
│   │   ├── player.js       stepPlayer: cmd → 이동 + 무기 + 스킬 → 사건. 출전 무기 정리(makeLoadout)
│   │   ├── abilities.js    스킬 19종 동작
│   │   ├── kunai.js        듀얼 쿠나이: 비행·앵커·회수·끌려가기 (docs/weapons/DUAL_KUNAI.md)
│   │   ├── thread.js       쿠나이 와이어 네트워크 (W9): 노드·핀·선분·교차·영역, 설치 검사
│   │   ├── hitscan.js      광선·관통·근접 판정
│   │   ├── domination.js   점령 규칙·점수·연장전 판단 (순수 함수)
│   │   ├── spawn.js        동적 스폰 점수
│   │   ├── noise.js        소리 탐지 거리
│   │   └── rng.js          결정적 난수 (탄퍼짐)
│   ├── weapons.js · skills.js · modes.js · looks.js · cosmetics.js   데이터(content/) 읽기 + 검사
│   ├── collision.js · vault.js · hitbox.js   광선-박스, 넘어가기 경로, 사람 판정 모양
│   ├── content/            schema.js(데이터 모양·검사, 스튜디오 입력 칸) · registry.js · format.js
│   └── maps/               맵 목록·조립 (build.js, parts.js)
├── server/
│   ├── index.js · config.js · http.js · net.js(연결 = 세션, hello 뒤 hub 로)
│   ├── lobby/
│   │   ├── hub.js          세션·친구·파티·채팅·빠른 매칭·커스텀 방 (메시지를 방으로 넘김)
│   │   └── accounts.js     손님 계정·레벨·경험치·전적 (data/accounts.json)
│   ├── game/
│   │   ├── room.js         방: 60Hz 루프·cmd 처리·사격 판정·피해/처치/어시스트/낙사·부활·스냅샷·결과/재매치
│   │   ├── lagcomp.js      자세 기록·되감기
│   │   ├── projectiles.js  유탄
│   │   └── modes/          domination.js · deathmatch.js
│   ├── bots/               brain.js(봇 = cmd 를 만드는 AI) · nav.js(A*) · names.js
│   ├── chat.js             채팅 글자 정리·도배 방지
│   └── devtools.js         스튜디오 저장 API (개발 서버만)
├── client/js/
│   ├── main.js             프레임 루프 · 3인칭(V) · 자동 입장(?auto) · 디버그 훅(window.__g)
│   ├── state.js            공유 상태 (me.ps = 내 시뮬레이션 상태, wp = 1인칭 연출, game, lobby)
│   ├── predict.js          예측·보정(넷코드)만. 사건은 onSimEvents 로 내보낸다    clock.js  서버 시각 추정
│   ├── playerfx.js         내 사건 연출: 소리·궤적·탄흔·총구 불빛·총 모델 반동   recoil.js  시선·화면 반동 수치
│   ├── net.js              통신 (로비 + 경기)        input.js  키·마우스 → inp
│   ├── lobby.js            로비 화면                 loadout.js  출전 무기·스킬·외형 저장
│   ├── lobbyview.js        로비 가운데의 무기 3D 미리보기 (등록된 .glb 모델 + 총기 스킨)   lobbyart.js  3D 를 못 쓸 때의 그림·스킨 색 (프리셋은 modelrules.js SKINS)
│   ├── hud.js              전투 HUD 진입점 → hud/ (common·vitals·skills·combat·match·feed·screens: 이름·체력/탄약·스킬 바·맞힘/조준선/도트·점수/거점·킬피드·사망/점수판/결과)
│   ├── minimap.js          미니맵·전술 지도·소리 방향  objective.js  거점 3D 표시·화면 표식
│   ├── remotes.js          다른 사람: 스냅샷 보간·모델·상태 연출·이름표
│   ├── viewmodel.js        1인칭 무기 코어 → viewmodel/ (offhand: 왼손 무기·아킴보/쿠나이, poses: 근접 휘두르기·볼트/펌프)   weaponview.js  무기가 보이는 방식(조준 방식·연출 배율, 순수)
│   ├── selfview.js         내 화면: 카메라(1·3인칭·로비)·3인칭 몸   quality.js  자동 화질   mousefilter.js · lookdiag.js  마우스 이상치 필터·시점 진단(?debuglook)
│   └── (그리기·자산: scene · world(→ world/ proctex·matstyle·materials·indoor·geometry) · guns · gunmat · gunanim · charassets · charanim · charik · outfit · fx · vfx · effects · dashfx · audio · sfx · textures — 스튜디오와 공용)
├── content/                게임 데이터 (스튜디오가 쓴다): maps/ · weapons · skills · modes · models · looks · cosmetics …
├── studio/                 FRONTIER Studio (개발 서버의 /studio/)
├── tools/maps/gen_v2_maps.mjs   레벨 디자인 v2.0 세 맵 생성기 (골목극장 = 대표 맵 · 아스테르 항만 · 교차 동력실)
├── tools/maps/gen_outpost.mjs   예전 대표 맵 "전초기지" 생성기 (보관)
├── tests/                  engine(단위) · server(통합) · browser · studio · cosmetics · garment
└── archive/                예전 버전 (pre-overhaul-2026-11-19 = 엔진 개편 직전 코드, git 에는 안 올라감)
```

## 책임을 나누는 기준
- **데이터는 `content/`, 규칙은 `shared/`** — 수치와 배치(맵·무기·파츠)는 JSON 데이터, 그걸 해석하는 코드는 `shared/`. 둘 다 서버와 브라우저가 같이 쓴다.
- **모드 규칙은 `server/game/modes/`** — 방(`room.js`)은 입장·스폰·피해 같은 공통 진행만 하고, 점수·승리·봇 목표는 모드 규칙 객체에 맡긴다.
- **판정은 서버** — 브라우저는 입력(cmd)만 보낸다. 위치·탄약·쿨타임·명중은 서버가 같은 시뮬레이션으로 계산해 정한다 (브라우저 계산은 예측일 뿐).
- **스튜디오와 게임은 같은 코드로 그린다** — 모델 에디터·맵 에디터·분위기 에디터는 게임의 모듈(`world.js`, `guns.js`, `gunmat.js`, `gunanim.js`)을 그대로 불러 쓴다. 에디터에서 본 그대로 게임에 나온다.
- **규칙은 순수 함수로** — `shared/sim/domination.js`, `spawn.js`, `chat.js` 처럼 입력→결과만 있는 함수로 두면 단위 테스트가 쉽다.
- **브라우저 모듈 간 값 공유는 `state.js` 의 객체로** — `wp.cur = 3` 처럼 속성으로 바꾼다. (모듈 간에 변수를 직접 바꿀 수 없기 때문)
- **브라우저 모듈 의존은 한 방향** — `util → state → loadout → scene/sfx/textures → charassets → charanim → fx/clock/remotes/viewmodel/hud/minimap → predict → playerfx → selfview → lobby → net/input → main`. 순환 참조를 만들지 않는다 (arch.test.mjs 가 확인).
- **캐릭터 애니메이션은 상태로 다시 만든다** — 뼈 자세를 네트워크로 보내지 않는다. 각 브라우저가 스냅샷의 속도·상태 비트(정조준·달리기·공중·슬라이딩·넘어짐 …)·사격(`shot`)·재장전(`rl`) 사건으로 같은 컨트롤러를 돌린다 (docs/CHARACTER_ANIMATION.md).

## 클라이언트 구조 — 책임 나누기와 기능 넣는 곳

프레임 한 번은 `main.js` 가 아래 순서로 **부르기만** 한다 (계산은 각 모듈이):
`입력(input) → 예측(predict) → 연출·반동(playerfx) → 카메라(selfview) → 1인칭 무기(viewmodel) → 내 몸(selfview) → 전송(net) → 다른 사람·효과·HUD → 그리기`

| 층 | 모듈 | 하는 일 | 알면 안 되는 것 |
|---|---|---|---|
| 규칙 | `shared/sim/*` | 결정적 시뮬레이션 (서버와 같음) | 브라우저·three·DOM |
| 넷코드 | `predict.js` `clock.js` `net.js` | cmd 전송·보정·시계 | 소리·그리기 (연출) |
| 상태 | `state.js` | `me` `wp` `inp` `game` 공유 값 | 다른 모듈 (값만 가진다) |
| 연출 규칙 | `weaponview.js` `recoil.js` | 조준 방식별 배율·반동 수치 | 아무것도 불러오지 않음 / 상태·유틸만 |
| 연출 | `playerfx.js` `viewmodel.js` `selfview.js` `hud.js` `remotes.js` `fx/vfx/sfx` | 화면·소리 | 서버 규칙 (읽기만) |
| 조립 | `main.js` | 프레임 순서 | 계산 (부르기만) |

**기능을 넣을 때 어디에?**
- **새 조준 방식**(홀로그램·레이저 등): `weaponview.js` 의 `SIGHTS` 에 항목 하나 + `sightFor` 에서 쓸 무기를 정한다. 다른 파일은 `viewOf(무기 번호).ads` 만 읽으므로 안 바뀐다. (무기 종류 `w.kind === '…'` 로 연출을 나누지 않는다)
- **새 반동·화염·소리 연출**: `playerfx.js`. 시선이 움직이는 수치는 `recoil.js`. `predict.js` 에 소리·효과를 넣지 않는다.
- **카메라·시야각·3인칭**: `selfview.js`.
- **새 시뮬레이션 규칙**(이동·무기·스킬): `shared/sim/` — 서버와 브라우저가 같이 쓰므로 둘 다 테스트(`engine.test.mjs`)에 걸린다.
- **새 HUD 표시**: `hud.js` (조준점·십자선 포함). 값은 `state.js` 에서 읽는다.
- **새 무기 동작**(근접·볼트·펌프 같은 포즈 보정): `viewmodel/poses.js` 의 `APPLY` 에 함수 추가. **왼손에 두 번째 무기**를 드는 무기: `viewmodel/offhand.js` 의 `KINDS` 에 항목 추가.
- **새 재질·무늬·실내 조명**: `world/` 의 맞는 파일 (`proctex` 바탕 무늬 · `matstyle` 분위기별 그리기 · `materials` 물성 프리셋 · `indoor` 실내 조명). `world.js` 는 조립만 한다.
- **새 HUD 요소**: `hud/` 의 맞는 파일에 넣고, 다른 모듈이 불러야 하면 `hud.js` 에서 다시 내보낸다.
- **한 값을 여러 모듈이 같이 쓰는 새 상태**: `wp.x` 처럼 전역 필드를 늘리기 전에 "누가 쓰고 누가 읽는가" 를 정한다. 쓰는 모듈은 하나로 하고, 다른 모듈은 읽기만 한다. 계산해서 나오는 값은 필드에 저장하지 말고 `weaponview.js` 같은 순수 함수로 조회한다 (예전 `wp.dot` 이 그 사례 — 5개 모듈이 얽혔다).

**구조 가드** `tests/arch.test.mjs` (`npm test` 에 포함, 1초): `wp` 필드는 쓰는 모듈이 정해져 있다(`WP_OWNERS` — 새 필드를 만들면 쓰는 모듈을 거기 적어야 통과). 위 표의 "알면 안 되는 것" 중 기계로 확인할 수 있는 것을 지킨다 — `shared/` 는 브라우저·서버를 모른다, `predict.js` 는 연출을 모른다, 순수 모듈은 아무것도 불러오지 않는다, 순환 참조 없음. 규칙은 `RULES` 표에 한 줄 추가. 규칙을 일부러 바꿀 때는 이 문서의 표도 같이 고친다.

## 모드/맵 전환은 새로고침 없이
- 클라이언트의 현재 모드는 `MODE_CFG`(`util.js`)에 있고 `setMode(id)` 로 바뀐다. 다른 모듈은 이 객체를 그대로 읽는다.
- 맵은 `scene.js` 의 `loadMap(id)` 가 구조물을 통째로 갈아 끼우고 `colliders` 배열 내용을 교체한다. (하늘·지면·조명은 그대로)
- 방에 들어갈 때는 서버가 보낸 `welcome.mode` 를 기준으로 모드/맵을 맞춘다. 나갈 때는 연결은 그대로 두고 `net.js` 의 `toLobbyScreen()` 이 상태·화면을 정리한다.

## 데이터 흐름 (한 번의 사격)
1. `input.js` 가 클릭을 `inp.fireHeld` 에 기록 → `predict.js` 가 1/60초 cmd 에 사격 비트를 넣고 `stepPlayer` 로 바로 계산 → 사격 사건으로 반동·궤적·맞힘 표시를 그린다
2. cmd 는 그 순간 화면 시각(vt)과 함께 서버로 → `room.runCmd` 가 같은 `stepPlayer` 로 같은 사격 사건(같은 탄 방향)을 만든다
3. `room.resolveShot`: 다른 사람을 vt 로 되감아(`lagcomp.js`) 히트스캔 → `damage` → 처치·어시스트·점수
4. 사건(`dmg`·`kill`·`shot` …)은 tick 끝에 한 묶음(`ev`)으로 보낸다

## 자주 하는 수정은 어디를?

| 하고 싶은 것 | 고칠 곳 |
|---|---|
| 무기 성능·이동 속도·달리기/슬라이딩 중 사격 | 스튜디오 → 무기 (`content/weapons.json`) |
| 스킬 수치·자리별 값 | 스튜디오 → 스킬 (`content/skills.json`, 보조무기 자리 값은 `secondary`) |
| 스킬 동작 자체 / 새 스킬 | `shared/sim/abilities.js` (액티브) · `shared/sim/player.js` 의 `fire()` (사격에 붙는 패시브) + schema 의 `SKILL_EFFECTS`·`SKILL_NEEDS` |
| 이동 감각 (속도·가속·점프·슬라이딩) | `shared/sim/config.js` 의 `MOVE` |
| 체력·회복·부활 보호 | `shared/sim/config.js` 의 `HEALTH`·`SPAWN`, 모드별 부활 대기는 `content/modes.json` |
| 점령 시간·인원별 속도·점수 속도·연장전 | 스튜디오 → 모드 (`content/modes.json` 의 `dom`) |
| 거점 개수·위치 | 맵 데이터의 `zones` (스튜디오 맵 에디터) |
| 맵 수정·새 맵 | 스튜디오(`/studio/`) → `content/maps/<id>.json`. 대표 맵 셋은 `tools/maps/gen_v2_maps.mjs` 로 만들었다 (다시 돌리면 덮어쓴다) |
| 스폰 고르는 기준 | `shared/sim/spawn.js` |
| 소리 탐지 거리 | `shared/sim/noise.js` |
| 랙 보정 한도·보간 지연 | `shared/sim/config.js` 의 `MAX_REWIND_TICKS`·`INTERP_TICKS` |
| 봇 실력·행동 | `server/bots/brain.js` (`STYLE`, `skill`) |
| 경험치·레벨 곡선 | `server/lobby/accounts.js` |
| 파티 인원·커스텀 방 옵션 | `server/lobby/hub.js` |
| HUD·킬피드·결과 화면 | `client/js/hud.js`, 모양은 `client/css/style.css` 아래 "새 화면" |
| 로비 화면 | `client/js/lobby.js`, `client/index.html` |
| 명중 판정 크기 | `shared/hitbox.js` 의 `HITBOX` (눈높이는 `BODY.EYE`) |
| 넘어가기 판정 | `shared/vault.js` 맨 위 `VAULT` |
| 캐릭터 모델·애니메이션 | `client/js/charassets.js`, `charanim.js` (docs/CHARACTER_ANIMATION.md) |
| 조작키 | `client/js/input.js` (로비 아래 조작 안내는 `client/index.html`) |
| 새 메시지 | `docs/PROTOCOL.md` 맨 아래 순서대로 |
