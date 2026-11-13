# 통신 규약 (WebSocket)

브라우저와 서버는 WebSocket 으로 JSON 메시지를 주고받는다. 모든 메시지는 `t` 필드로 종류를 구분한다.
서버 처리: `server/net.js` (분배) → `server/room.js` / `server/chat.js` / `server/combat.js`.
클라이언트 처리: `client/js/net.js` (받기) / 각 모듈에서 `net.send(...)` (보내기).

좌표는 미터, 각도는 라디안. 플레이어 id 는 방 안에서만 유일한 0~7 정수. 위치 `p` 는 `[x, y, z]` (y 는 발 높이).

## 클라이언트 → 서버

| t | 필드 | 설명 |
|---|---|---|
| `join` | `name`, `mode`, 그리고 아래 중 하나 | 입장. 연결 후 가장 먼저 보낸다. 이름은 14자까지. `mode` 는 `ffa`(기본) 또는 `tdm`. 방 선택: (없음) = **빠른 시작**, `code` = 친선전 방 **코드로 입장**, `create` = 친선전 **방 만들기** `{name(20자), private, bots, minutes(3/5/10)}` |
| `s` | `p`, `y`(yaw), `x`(pitch), `c`(앉음 0/1), `w`(무기번호) | 내 위치/시선. 20회/초. 서버가 다른 사람들에게 그대로 전달한다. |
| `shot` | `w`, `o`(총구 위치), `e`(`[[x,y,z,n], ...]` 탄착점) | 사격. 소리/궤적용으로 다른 사람에게 전달된다. `n`=6 이면 사람에 맞음, 그 외는 벽 방향 번호. |
| `rl` | `w` | 재장전 시작 (소리용). |
| `hit` | `w`, `hits`(`[[부위, 거리, 대상id], ...]`) | 명중 신고. 부위는 `head`/`body`/`leg`. 서버가 검증하고 피해를 계산한다. |
| `respawn` | (없음) | 부활 요청. 죽은 뒤 1.5초가 지나야 받아 준다. 사람은 자동 부활이 없다 (봇은 3초 뒤 자동). |
| `chat` | `text` | 채팅. 120자 제한, 5초에 4개, 연속 400ms 미만은 무시. |

## 서버 → 클라이언트

| t | 필드 | 설명 |
|---|---|---|
| `denied` | `reason` | 입장 거부 후 연결이 닫힌다. `not_found`(코드의 방이 없음) / `full`(가득 참) / `limit`(방을 더 만들 수 없음) |
| `welcome` | `id`, `mode`, `room`, `team`, `ts`, `goal`, `left`(남은 ms), `state`, `players`, `lan`, `port` | 입장 직후 한 번. `players` = `[{id,name,bot,k,d,alive,hp,team}]`. `room` 은 친선전이면 `{code, name, minutes}`, 빠른 시작이면 `null`. `team` 은 팀전에서 0/1, 개인전은 -1. `ts` = 팀 점수 `[0팀, 1팀]` |
| `pj` | `player` | 누가 방에 들어옴 (봇 포함). |
| `pl` | `id` | 누가 방에서 나감. |
| `spawn` | `id`, `p` | 스폰/부활. 내 id 면 내 캐릭터를 그 위치로 옮긴다. |
| `s` | `id`, `p`, `y`, `x`, `c`, `w` | 다른 플레이어(사람/봇)의 위치. |
| `shot` | `id`, `w`, `o`, `e` | 다른 플레이어의 사격 (봇 사격 포함). |
| `rl` | `id`, `w` | 다른 플레이어 재장전. |
| `dmg` | `to`, `from`, `hp`, `dmg`, `head` | 누가 누구에게 피해를 줌. |
| `hp` | `hp` | 내 체력 회복 (5초간 피해 없으면 0.5초마다 +5). |
| `kill` | `killer`, `victim`, `w`, `head`, `sc`(`[[id,킬,데스], ...]`), `ts` | 킬. 팀전이면 `ts`(팀 점수)가 갱신된다. |
| `chat` | `id`, `name`, `text` | 채팅 (보낸 사람에게도 돌아온다). |
| `end` | `winner`, `wt`, `ts`, `sc`, `restart`(다음 경기까지 ms) | 경기 종료. `wt` = 팀전에서 이긴 팀 (-1 = 무승부/개인전). |
| `start` | `goal`, `ts`, `left`, `players` | 새 경기 시작 (기록 초기화, 이어서 `spawn`). |

## HTTP

| 경로 | 설명 |
|---|---|
| `/` , `/js/*`, `/css/*` | `client/` 폴더 |
| `/shared/*` | `shared/` 폴더 (서버와 같이 쓰는 규칙 코드) |
| `/vendor/three/*` | three.js |
| `/rooms` | `{rooms: [{code, name, mode, humans, max, state, minutes, bots}]}` — 공개 친선전 방 목록 (비공개 방은 나오지 않는다) |
| `/status` | `{env, version, uptime, rooms, humans, modes: {ffa: {rooms, humans}, tdm: {…}}}` — 로비의 모드별 인원 표시, 배포 전 접속자 확인 |

## 새 메시지를 추가하려면
1. 이 문서에 한 줄 추가
2. 클라이언트→서버: `server/net.js` 의 `HANDLERS` 에 함수 추가, 검증은 별도 모듈(`chat.js`, `combat.js` 처럼)에 순수 함수로 두면 단위 테스트가 쉽다.
3. 서버→클라이언트: `client/js/net.js` 의 `onMessage` 에 `case` 추가
4. `tests/protocol.test.mjs` 에 시나리오 추가
