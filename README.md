# anything

여러 게임 프로젝트를 모아 둔 저장소.

| 폴더 | 내용 |
|---|---|
| [`games/frontline/`](games/frontline/) | **FRONTLINE DUEL** — 웹 FPS 자유 대전 (봇 포함, 채팅). 라이브 운영 중 |
| `src/`, `default.project.json` | **Coin Clicker** — Roblox 키우기 게임 (Rojo) |
| `archive/frontline-duel/` | 예전 1대1 버전 보관 (실행용 아님) |

## Roblox 프로젝트 (Coin Clicker)

Rojo 로 VS Code 와 Studio 를 동기화한다.

| 경로 | Studio 위치 | 내용 |
|---|---|---|
| `src/shared/Config.luau` | ReplicatedStorage/Shared | 밸런스·게임패스 ID 등 설정 |
| `src/shared/Formulas.luau` | ReplicatedStorage/Shared | 비용·수입 공식, 숫자 표시 |
| `src/server/Main.server.luau` | ServerScriptService/Server | 클릭·구매·자동수입 처리 |
| `src/server/PlayerData.luau` | ServerScriptService/Server | DataStore 저장 |
| `src/client/Main.client.luau` | StarterPlayerScripts/Client | UI (코드로 생성) |

```bash
rojo serve           # 이 폴더에서. Studio 에서 Plugins → Rojo → Connect
```
게임패스 판매는 `Config.luau` 의 `Gamepass2xId` 에 ID 를 넣으면 켜진다. 저장 테스트는 게시 후 Studio 에서
"Enable Studio Access to API Services" 를 켜야 한다.

## 주의
- `Important/`, `*.key`, `deploy/targets.env` 는 서버 접속 정보라 git 에 올라가지 않는다.
