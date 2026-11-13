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
│   ├── rooms.js            방 목록. 빈자리 있는 방을 찾거나 새로 만든다
│   ├── room.js             방 하나: 입장/퇴장, 봇 채우기, 스폰, 피해·킬, 경기 진행, 채팅
│   ├── chat.js             채팅 규칙 (글자 정리, 도배 방지)       ← 순수 함수
│   ├── combat.js           명중 신고 검증·피해 합산               ← 순수 함수
│   └── bots/
│       ├── nav.js          맵을 격자로 바꿔 A* 길찾기
│       ├── bot.js          봇 AI: 시야 → 이동 → 조준 → 사격
│       └── names.js        봇 이름
├── shared/                 서버와 브라우저가 같이 쓰는 규칙 (THREE·DOM 에 의존하지 않는다)
│   ├── constants.js        체력·시간 등 공통 상수
│   ├── modes.js            게임 모드 (개인전 ffa / 팀전 tdm): 맵·인원·팀 수·목표 킬
│   ├── weapons.js          무기 7종 데이터와 피해 계산
│   ├── collision.js        광선-박스 충돌
│   └── maps/
│       ├── index.js        맵 목록, getMap(id)
│       ├── parts.js        맵 부품 (벽, 건물, 컨테이너, 상자 …)
│       ├── frontline.js    전선 (개인전)   — 배치 + 스폰 지점
│       └── warehouse.js    창고 (팀전)     — 배치 + 팀별 스폰 지점
├── client/                 브라우저
│   ├── index.html, css/style.css
│   └── js/
│       ├── main.js         시작 + 프레임 루프
│       ├── state.js        공유 상태 (me, wp, inp, game, roster, net)
│       ├── scene.js        렌더러·카메라       world.js  맵/하늘 그리기
│       ├── player.js       이동·충돌           weapon.js 사격·재장전·교체
│       ├── viewmodel.js    1인칭 총 포즈       guns.js   총/병사 모델 생성
│       ├── remotes.js      다른 플레이어 모델·명중 판정
│       ├── fx.js           궤적·탄흔·파편      textures.js  이펙트 텍스처
│       ├── hud.js          체력·탄약·순위표·킬 피드·종료 화면
│       ├── chat.js         채팅 입력/표시
│       ├── net.js          서버 통신           input.js  키보드·마우스
│       ├── menu.js         시작 메뉴·설정      audio.js / sfx.js  소리
│       └── util.js, dom.js 도우미
├── tests/                  unit / protocol(서버) / browser(Chrome)
├── deploy/                 라이브 배포 스크립트
└── docs/                   DEV.md, PROTOCOL.md, ARCHITECTURE.md
```

## 책임을 나누는 기준
- **규칙은 `shared/`** — 서버와 브라우저가 같은 값을 써야 하는 것(무기, 맵, 충돌). 한 곳만 고치면 양쪽에 반영된다.
- **검증은 서버** — 브라우저가 보내는 건 "신고"일 뿐이다. 서버가 `combat.js`/`chat.js` 로 검증하고 결과를 정한다.
- **서버 규칙은 순수 함수로** — `chat.js`, `combat.js` 처럼 입력→결과만 있는 함수로 두면 단위 테스트가 쉽다.
- **브라우저 모듈 간 값 공유는 `state.js` 의 객체로** — `wp.cur = 3` 처럼 속성으로 바꾼다. (모듈 간에 변수를 직접 바꿀 수 없기 때문)
- **브라우저 모듈 의존은 한 방향** — `util → state → scene/sfx/textures → fx/remotes/viewmodel → player/hud → weapon → net/input → menu → main`. 순환 참조를 만들지 않는다.

## 데이터 흐름 (한 번의 사격)
1. `input.js` 가 마우스 클릭을 `inp.fireHeld` 에 기록
2. `main.js` 프레임 루프 → `weapon.js` 의 `updateWeapon` 이 `fire()` 호출
3. `fire()` 가 광선을 쏴서 벽(`rayWorld`)·플레이어(`remoteHit`)를 판정하고 이펙트를 만든 뒤 `shot`/`hit` 를 서버로 보냄
4. 서버 `net.js` → `room.onHit` → `combat.resolveHits` 로 검증 → `applyDamage` → `dmg`/`kill` 을 방 전체에 전송
5. 각 브라우저의 `net.js` 가 받아서 `hud.js`(킬 피드·순위), `remotes.js`(쓰러짐) 등을 갱신

## 자주 하는 수정은 어디를?

| 하고 싶은 것 | 고칠 곳 |
|---|---|
| 총 성능·피해량 조절 | `shared/weapons.js` |
| 새 총 추가 | `shared/weapons.js` + 모델 `client/js/guns.js` (+ 봇이 쓰게 하려면 `server/bots/bot.js` 의 `WEAPON_POOL`, `PREF_RANGE`) |
| 맵 수정 | `shared/maps/<맵>.js` (배치와 스폰 지점이 한 파일에 있다) |
| 새 맵 추가 | `shared/maps/` 에 파일 추가 → `maps/index.js` 에 등록 → `modes.js` 에서 모드에 연결 |
| 새 모드 추가 | `shared/modes.js` 에 항목 추가 (로비 카드는 자동으로 생긴다). 규칙이 다르면 `server/room.js` |
| 봇 난이도 | `server/bots/bot.js` 맨 위 상수와 `skill`, 정확도는 `shoot()` 의 `pHit` |
| 방 인원·킬 수·봇 수 | `shared/modes.js` (모드별), 시간은 `shared/constants.js` |
| 채팅 제한 | `server/chat.js` 상단 상수, 글자 수는 `shared/constants.js` 의 `CHAT_MAX_LEN` |
| 화면 모양 | `client/css/style.css`, `client/index.html` |
| 순위표·HUD 표시 | `client/js/hud.js` |
| 조작키 | `client/js/input.js` (메뉴의 조작 안내는 `client/index.html`) |
| 새 메시지 추가 | `docs/PROTOCOL.md` 맨 아래 순서대로 |
