# Coin Clicker (Roblox)

클릭해서 코인을 모으고 업그레이드하는 키우기 게임. Rojo로 VS Code ↔ Studio 동기화.

## 폴더 구조
| 경로 | Studio에서의 위치 | 내용 |
|---|---|---|
| `src/shared/Config.luau` | ReplicatedStorage/Shared | 밸런스·게임패스 ID 등 설정 |
| `src/shared/Formulas.luau` | ReplicatedStorage/Shared | 비용·수입 공식, 숫자 표시 |
| `src/server/Main.server.luau` | ServerScriptService/Server | 클릭·구매·자동수입 처리 |
| `src/server/PlayerData.luau` | ServerScriptService/Server | DataStore 저장 |
| `src/client/Main.client.luau` | StarterPlayerScripts/Client | UI (코드로 생성) |
| `assets/`, `docs/` | - | 원본 자료, 메모 |
| `archive/` | - | 예전 프로젝트 보관 |

## 실행
1. `rojo serve` (이 폴더에서)
2. Studio → Plugins → Rojo → Connect
3. F5로 테스트

## 수익화
`src/shared/Config.luau`의 `Gamepass2xId`에 게임패스 ID를 넣으면 "코인 2배" 구매 버튼이 나타남.

## 저장 테스트
Studio에서 저장을 테스트하려면 게임을 Roblox에 게시한 뒤
Game Settings → Security → "Enable Studio Access to API Services" 를 켜야 함.
