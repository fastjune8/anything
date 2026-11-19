# 통신 규약

> 기준 문서: [`GAME_DESIGN.md`](GAME_DESIGN.md). 엔진 구조는 [`ENGINE.md`](ENGINE.md).

연결 하나(WebSocket, JSON)로 로비와 경기를 모두 주고받는다. 페이지를 열면 바로 접속해 `hello` 를 보낸다.
경기 중 메시지는 그 사람의 방(`server/game/room.js`)이, 나머지는 로비(`server/lobby/hub.js`)가 처리한다.

## 접속 · 로비

| 보내는 쪽 | 메시지 | 내용 |
|---|---|---|
| 브라우저 | `hello` `{ token?, name? }` | 손님 계정 로그인. 토큰이 없거나 모르는 토큰이면 새 계정 |
| 서버 | `hi` `{ token, me, loadout, outfit, modes, maps }` | 토큰은 브라우저가 `localStorage.fd_token` 에 저장. `me` = 프로필(아래) |
| 브라우저 | `name` `{ name }` | 이름 변경 → 서버 `profile` |
| 브라우저 | `lo` `{ loadout?, outfit? }` | 출전 무기 2개와 자리별 스킬 `[{ id, skill }, { id, skill }]`, 외형. 서버가 정리해서 `lo` 로 돌려준다 (계정에 저장) |
| 브라우저 | `stats` | 서버 `profile` |
| 서버 | `profile` `{ me }` | `me = { id, name, tag, level, xp, next, stats }` — stats: 플레이 시간·승/패/무·킬·데스·어시스트·점령·무기별 기록 |
| 브라우저 | `chat` `{ ch: 'lobby'\|'party'\|'room', text }` | 로비·파티 채팅 (경기 중에는 `room` = 방 전체) |
| 서버 | `chat` `{ ch, from(계정 id), name, text, id?(방 안 번호) }` | |
| 브라우저 | `fr+` `{ tag: '이름#1234' }` · `fra` `{ id, ok }` · `fr-` `{ id }` | 친구 요청 · 수락/거절 · 삭제 |
| 서버 | `friends` `{ list: [{ id, name, tag, level, status }], inc: [요청] }` | status: `offline` · `lobby` · `queue` · `match:<모드>` |
| 브라우저 | `pinv` `{ id }` · `pjoin` `{ party }` · `pleave` | 파티 초대(친구만) · 참가 · 나가기 |
| 서버 | `pinv` `{ party, from, name }` · `party` `{ party: { id, leader, members } \| null }` | |
| 브라우저 | `qm` `{ mode }` | 빠른 매칭 (파티면 파티장만, 파티 전원이 같은 팀) |
| 서버 | `queue` `{ mode }` → 곧 `welcome` | |
| 브라우저 | `rooms` · `rcreate` `{ name, mode, map, minutes, max, pass, bots }` · `rjoin` `{ code, pass }` | 커스텀 방 목록 · 만들기 · 코드로 입장 |
| 서버 | `rooms` `{ list }` · `denied` `{ reason: not_found\|full\|limit\|password }` | |
| 서버 | `note` `{ text }` · `kicked` | 알림 · 같은 계정으로 다른 곳에서 접속해 끊김 |
| 서버 | `lobby` `{ me }` | 경기에서 나와 로비로 |

## 경기

| 보내는 쪽 | 메시지 | 내용 |
|---|---|---|
| 서버 | `welcome` | `{ id, mode, map, team, n(서버 tick), state, left(ms), ot, goal, sc[2], respawn(초), room?, players, lo, dom? }` |
| 서버 | `start` | 재매치: 새 경기 (`welcome` 의 경기 부분과 같다) |
| 브라우저 | `cmd` `{ s: 첫 번호, c: [입력, …] }` | 1/60초 입력. 입력 = `[앞뒤, 좌우, 버튼, yaw, pitch, 무기 자리(0/1), vt]` · 버튼 비트: 점프 1 · 앉기/슬라이딩 2 · 달리기 4 · 사격 8 · 정조준 16 · 재장전 32 · 스킬Q 64 · 스킬E 128 · `vt` = 그 순간 화면에 보이던 서버 tick (랙 보정) |
| 서버 | `me` `{ q: 처리한 마지막 입력 번호, k, n, hp, alive, ps }` | 내 시뮬레이션 상태 전체 (바뀌었을 때, 30Hz). 브라우저는 `ps` 로 맞추고 `q` 이후 입력을 다시 계산한다 |
| 서버 | `snap` `{ n, p: [[id, x, y, z, yaw, pitch, f, 무기번호, hp, 앉음, vx, vy, vz], …] }` | 다른 사람 (30Hz, 나 제외). f = 상태 비트 (`shared/sim/config.js` 의 `PF`: 정조준·달리기·공중·슬라이딩·앉기·넘어짐·투명·부활보호·무적·재장전·그래플·돌진·등장·피해감소) |
| 서버 | `ev` `{ n, l: [사건, …] }` | 그 tick 의 사건 묶음 (아래) |
| 브라우저 | `leave` · `rematch` `{ v }` | 로비로 · 결과 화면에서 재매치 선택 |
| 서버 | `end` | `{ wt(이긴 팀, -1 무승부), top(개인전 1등 id), sc, dur(초), board: [{ id, name, team, bot, k, d, a, caps, w }], me: { result, xp, ups, profile }, victory(ms), results(ms) }` |
| 브라우저 | `tp` `{ p, y }` · `hp` `{ v }` | 개발·테스트용 (라이브 서버는 무시) |

### 사건 (`ev.l` 의 `e`)

| e | 내용 |
|---|---|
| `spawn` `{ id, p, y }` | 부활 (부활 보호·등장 연출 시작) |
| `pj` `{ p }` · `pl` `{ id }` | 들어옴(봇 포함) · 나감 |
| `shot` `{ id, w, o, l: [[x,y,z,면], …], c }` | 다른 사람의 사격 (서버가 판정한 탄 끝점. 면 6 = 사람). 쏜 사람에게는 오지 않는다 (예측으로 이미 그림) |
| `mel` `{ id }` · `rl` `{ id, w }` · `sw` `{ id, w }` · `sk` `{ id, k }` · `hook` `{ id, p }` | 근접 공격 · 재장전 · 무기 교체 · 스킬 · 그래플 지점 |
| `gl` `{ id, by, o, v }` · `boom` `{ id, p, r }` | 유탄 발사 · 폭발 |
| `dmg` `{ to, from, hp, d, h, k }` | 피해 (k = head·normal·melee·blast·bleed·fall) |
| `blk` `{ id }` | 부활 보호·무적에 막힘 (쏜 사람에게만) |
| `kill` `{ k, v, w, how, as, sc, kd, rs }` | 처치 (k = -1 이면 스스로/환경). how = 킬피드 아이콘, as = 어시스트 id, kd = [[id, 킬, 데스, 어시], …], rs = 부활 대기(초) |
| `shove` `{ id, by }` · `bleed` `{ id }` | 넉백에 넘어짐 · 출혈 시작 |
| `dom` `{ pts: [[주인, 진행팀, 진행도, 경합, 0팀 인원, 1팀 인원], …], sc }` | 점령전 거점 상태 (바뀌었을 때 0.2초마다) |
| `cap` `{ z, team }` · `contest` `{ z }` · `ot` | 점령 · 경합 시작 · 연장전 |
| `snd` `{ s, k, b, w }` | 들린 적의 소리: s = 소리 주인 표시용 번호(목숨마다 새로), k = 종류(walk·sprint·slide·land·fire·reload·skill), b = 방향(15° 단위, 월드 기준), w = 세기 1~3. **좌표는 없다** |
| `rm` `{ id, v }` | 누가 재매치를 골랐다 |

## 새 메시지를 추가할 때
1. 위 표에 적는다. 2. 서버: 로비면 `hub.js` 의 `LOBBY`, 경기면 `room.js` 의 `handle`. 3. 브라우저: `client/js/net.js` 의 `onMessage`/`onEvent`. 4. `tests/server.test.mjs` 에 확인을 더한다.
