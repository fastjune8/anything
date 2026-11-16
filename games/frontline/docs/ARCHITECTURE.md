# 구조

서버가 방(Room) 단위로 경기를 진행하고, 브라우저는 three.js 로 그리면서 서버와 WebSocket 으로 통신한다.
빌드 단계 없이 ES 모듈을 그대로 쓴다. (`npm install` 후 바로 실행)

```
games/frontline/
├── server/                 Node 서버
│   ├── index.js            진입점 (HTTP + WebSocket 시작)
│   ├── config.js           환경변수·경로·시간 설정 (process.env 는 여기서만 읽는다)
│   ├── http.js             정적 파일(client/, shared/, three.js)과 /status
│   ├── net.js              WebSocket 접속·메시지를 해당 방으로 분배
│   ├── rooms.js            방 목록. 빠른 시작(빈 방 찾기)과 친선전(만들기·코드 입장·목록)
│   ├── room.js             방 하나: 입장/퇴장, 봇 채우기, 스폰, 피해·킬, 경기 진행, 채팅
│   ├── chat.js             채팅 규칙 (글자 정리, 도배 방지)       ← 순수 함수
│   ├── combat.js           명중 신고 검증·피해 합산               ← 순수 함수
│   ├── devtools.js         스튜디오용 API: 맵·총 모델·데이터 저장, 시험 플레이용 임시 맵 (개발 서버에서만)
│   ├── modes/              모드 규칙: 점수·승리·봇 목표 (index.js 에 규칙 객체가 갖출 것 설명)
│   │   ├── deathmatch.js   개인·팀 데스매치 (킬 = 점수)
│   │   └── zone.js         점령전 (stepZone = 거점 게이지 규칙, 순수 함수)
│   └── bots/
│       ├── nav.js          맵을 격자로 바꿔 A* 길찾기
│       ├── bot.js          봇 AI: 시야 → 이동 → 조준 → 사격
│       └── names.js        봇 이름
├── shared/                 서버와 브라우저가 같이 쓰는 규칙 (THREE·DOM 에 의존하지 않는다)
│   ├── constants.js        체력·시간 등 공통 상수
│   ├── modes.js            게임 모드 목록 (수치는 content/modes.json)
│   ├── movement.js         캐릭터 이동 물리 (걷기·점프·충돌·넘어가기·기울이기) — 순수 함수, 나중에 서버도 같이 씀 (M1)
│   ├── weapons.js          무기 데이터(content/weapons.json)와 피해 계산
│   ├── parts.js            총기 파츠(content/parts.json)와 출전 무기 2개 규칙: 성능 계산, 입력값 정리
│   ├── content/
│   │   ├── schema.js       콘텐츠 데이터 모양 정의 + 검사 (스튜디오 입력 칸도 여기서 만든다)
│   │   └── format.js       콘텐츠 JSON 저장 형식 (한 항목 = 한 줄)
│   ├── collision.js        광선-박스 충돌
│   ├── vault.js            낮은 구조물 넘어가기/오르기 경로 계산 (findVault)
│   └── maps/
│       ├── index.js        맵 목록(content/maps), getMap(id)
│       ├── build.js        맵 데이터의 물체 목록 → 박스·나무·충돌 박스 (회전·대칭 포함)
│       └── parts.js        물체 모양 (벽, 건물, 컨테이너, 상자 …)
├── content/                게임 데이터 (코드가 아님, 스튜디오가 쓴다): maps/, guns/, weapons.json, parts.json, modes.json
├── studio/                 FRONTIER Studio (개발 서버의 /studio/, 라이브에는 없다) — 사용법 docs/STUDIO.md
│   ├── studio.js           틀: 콘텐츠 목록·탭·공용 3D 화면·키보드·콘솔·시험 플레이(iframe)
│   ├── docs/map.js         맵 문서    docs/gun.js  총 모델 문서    docs/data.js  무기·파츠·모드 문서
│   ├── form.js             스키마 → 입력 칸 자동 생성
│   └── samplegun.js        규칙대로 만든 예시 총
├── tools/blender/          Blender 총 모델 템플릿 스크립트
├── client/                 브라우저
│   ├── index.html, css/style.css
│   └── js/
│       ├── main.js         시작 + 프레임 루프
│       ├── state.js        공유 상태 (me, wp, inp, game, roster, net)
│       ├── scene.js        렌더러·카메라       world.js  맵/하늘 그리기
│       ├── player.js       키 입력 → 이동 물리(shared/movement.js) → 소리·연출   weapon.js 사격·재장전·교체
│       ├── gunmodel.js     Blender 총 모델(.glb) 읽기·규칙 검사·스킨
│       ├── gunmodels.js    등록된 모델(content/models.json) 중 무기에 연결된 것을 미리 불러온다 → guns.js 가 그 모델로 총을 만든다
│       ├── viewmodel.js    1인칭 총 포즈       guns.js   총/병사 모델 생성, 파츠 모델 달기(setGunParts)
│       ├── loadout.js      출전 무기·파츠 저장(브라우저)과 성능 갱신     armory.js  무기고 화면(벽에 걸린 총 + 패널)
│       ├── remotes.js      다른 플레이어 모델·명중 판정·머리 위 이름표/체력바
│       ├── minimap.js      미니맵(회전 원형 지도)   minimath.js  미니맵 좌표 계산(단위 테스트 대상)
│       ├── objective.js    점령전 거점 표시 (바닥 원, 거점 상태 HUD, 화면 위 거점 표식)
│       ├── fx.js           궤적·탄흔·파편      textures.js  이펙트 텍스처
│       ├── hud.js          체력·탄약·순위표·킬 피드·종료 화면
│       ├── chat.js         채팅 입력/표시
│       ├── net.js          서버 통신           input.js  키보드·마우스
│       ├── menu.js         로비(빠른 시작·친선전)·설정      audio.js / sfx.js  소리
│       └── util.js, dom.js 도우미
├── tests/                  unit / protocol·tdm·zone 등(서버) / browser·studio(Chrome)
├── deploy/                 라이브 배포 스크립트
└── docs/                   DEV.md, PROTOCOL.md, ARCHITECTURE.md
```

## 책임을 나누는 기준
- **데이터는 `content/`, 규칙은 `shared/`** — 수치와 배치(맵·무기·파츠)는 JSON 데이터, 그걸 해석하는 코드는 `shared/`. 둘 다 서버와 브라우저가 같이 쓴다.
- **모드 규칙은 `server/modes/`** — 방(`room.js`)은 입장·스폰·피해 같은 공통 진행만 하고, 점수·승리·봇 목표는 모드 규칙 객체에 맡긴다.
- **검증은 서버** — 브라우저가 보내는 건 "신고"일 뿐이다. 서버가 `combat.js`/`chat.js` 로 검증하고 결과를 정한다.
- **서버 규칙은 순수 함수로** — `chat.js`, `combat.js` 처럼 입력→결과만 있는 함수로 두면 단위 테스트가 쉽다.
- **브라우저 모듈 간 값 공유는 `state.js` 의 객체로** — `wp.cur = 3` 처럼 속성으로 바꾼다. (모듈 간에 변수를 직접 바꿀 수 없기 때문)
- **브라우저 모듈 의존은 한 방향** — `util → state → loadout → scene/sfx/textures → fx/remotes/viewmodel → player/hud → weapon → net/input → menu/armory → main`. 순환 참조를 만들지 않는다.

## 모드/맵 전환은 새로고침 없이
- 클라이언트의 현재 모드는 `MODE_CFG`(`util.js`)에 있고 `setMode(id)` 로 바뀐다. 다른 모듈은 이 객체를 그대로 읽는다.
- 맵은 `scene.js` 의 `loadMap(id)` 가 구조물을 통째로 갈아 끼우고 `colliders` 배열 내용을 교체한다. (하늘·지면·조명은 그대로)
- 방에 들어갈 때는 서버가 보낸 `welcome.mode` 를 기준으로 모드/맵을 맞춘다. 나갈 때는 `net.js` 의 `leaveToLobby()` 가 연결·상태·화면을 정리한다.

## 무기고: 출전 무기와 파츠
- 전장에는 무기고에서 고른 **2자루**만 들고 간다. 무기마다 파츠를 5자리(조준경·총열·손잡이·탄창·개머리판)에 달 수 있다.
- 규칙은 `shared/parts.js` 한 곳: 어떤 무기에 무엇을 달 수 있는지(`partsFor`), 성능 변화(`applyParts`), 설명(`describePart`), 입력값 정리(`sanitizeLoadout`).
  모든 파츠는 장점과 단점을 함께 가져야 하고, 단위 테스트가 무기×파츠 조합 전부를 확인한다.
- 브라우저: `loadout.js` 가 `localStorage`(`fd_loadout`)에 저장하고, 파츠가 반영된 성능을 `state.js` 의 `eff[무기번호]` 에 채운다. 게임 코드는 `WEAPONS[i]` 대신 `eff[i]` 를 읽는다.
- 서버: `join` 의 `loadout` 을 정리해 플레이어의 `wstats`(무기번호 → 성능)에 둔다. 여기 없는 무기의 `shot`/`hit` 는 무시하고, 피해는 이 성능으로 계산한다.
- 총 모델: `guns.js` 의 `setGunParts(gun, parts)` 하나를 1인칭 총, 다른 플레이어의 총, 무기고 벽의 총이 같이 쓴다.
- 얻은 무기 목록은 `loadout.js` 의 `owned`. 아직 획득 시스템이 없어 전부 가진 것으로 시작한다 (무기고는 못 얻은 무기를 윤곽으로 보여 주는 것까지 되어 있다. `?owned=m4,m9` 로 확인).

## 데이터 흐름 (한 번의 사격)
1. `input.js` 가 마우스 클릭을 `inp.fireHeld` 에 기록
2. `main.js` 프레임 루프 → `weapon.js` 의 `updateWeapon` 이 `fire()` 호출
3. `fire()` 가 광선을 쏴서 벽(`rayWorld`)·플레이어(`remoteHit`)를 판정하고 이펙트를 만든 뒤 `shot`/`hit` 를 서버로 보냄
4. 서버 `net.js` → `room.onHit` → `combat.resolveHits` 로 검증 → `applyDamage` → `dmg`/`kill` 을 방 전체에 전송
5. 각 브라우저의 `net.js` 가 받아서 `hud.js`(킬 피드·순위), `remotes.js`(쓰러짐) 등을 갱신

## 자주 하는 수정은 어디를?

| 하고 싶은 것 | 고칠 곳 |
|---|---|
| 총 성능·피해량 조절 | 스튜디오 → 무기 (`content/weapons.json`, 비교 표로 TTK 확인) |
| 새 총 추가 | `content/weapons.json` + 모델 `client/js/guns.js` (+ 봇이 쓰게 하려면 `server/bots/bot.js` 의 `WEAPON_POOL`, `PREF_RANGE`). 무기고 벽에는 자동으로 걸린다 |
| 파츠 성능 조절·새 파츠 추가 | 스튜디오 → 파츠 (`content/parts.json`) (+ 모양은 `client/js/guns.js` 의 `OPTIC`/`BARREL`/`GRIP`) |
| 기본 출전 무기 | `shared/parts.js` 의 `DEFAULT_LOADOUT` |
| 무기고 화면(벽 배치·조명·성능 표) | `client/js/armory.js`, 모양은 `client/css/style.css` 의 무기고 부분 |
| 맵 수정·새 맵 | 스튜디오(`/studio/`) → `content/maps/<id>.json`. 모드의 기본 맵은 스튜디오의 모드 데이터 `map` |
| 새 물체 종류 (맵 부품) | `shared/maps/build.js` 의 `OBJECT_TYPES` + `shared/content/schema.js` 의 `OBJECT_SCHEMAS` |
| 친선전 옵션(시간·정원 등) | `server/rooms.js` (`resolveRoom`), 로비 화면은 `client/js/menu.js` |
| 새 모드 추가 | 스튜디오의 모드 데이터에서 추가 (로비 카드는 자동). 점수·승리 규칙이 다르면 `server/modes/` 에 규칙 파일 + `index.js` 와 schema 의 `RULES` 에 등록 |
| 점령전 수치 (점령 시간·점수 속도·목표) | 스튜디오 → 모드 (`content/modes.json`) |
| 봇 난이도 | `server/bots/bot.js` 맨 위 상수와 `skill`, 정확도는 `shoot()` 의 `pHit` |
| 방 인원·킬 수·봇 수 | 스튜디오 → 모드 (모드별), 시간은 `shared/constants.js` |
| 채팅 제한 | `server/chat.js` 상단 상수, 글자 수는 `shared/constants.js` 의 `CHAT_MAX_LEN` |
| 화면 모양 | `client/css/style.css`, `client/index.html` |
| 순위표·HUD 표시 | `client/js/hud.js` |
| 미니맵 크기·표시 범위·적 표시 시간 | `client/js/minimap.js` 맨 위 상수 (`VIEW_M`), 적 표시 시간은 `minimath.js` |
| 이름표 크기·표시 거리 | `client/js/remotes.js` (`TAG_RANGE`, 크기 계산) |
| 넘어가기 판정(거리·높이·두께·속도) | `shared/vault.js` 맨 위 `VAULT` |
| 기울이기 거리·각도 | `shared/constants.js` 의 `LEAN_DIST`, `LEAN_ANGLE` (속도는 `shared/movement.js`, 화면 기울기는 `client/js/main.js`) |
| 조작키 | `client/js/input.js` (메뉴의 조작 안내는 `client/index.html`) |
| 새 메시지 추가 | `docs/PROTOCOL.md` 맨 아래 순서대로 |
