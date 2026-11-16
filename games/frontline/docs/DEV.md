# 개발 가이드

**로컬에서 고치고 테스트 → 가끔 한 번씩 라이브에 반영** 하는 방식이다. 오라클 서버에는 개발/스테이징 환경을 따로 두지 않는다.

## 매일 하는 작업

```bash
cd games/frontline
npm install          # 처음 한 번
npm run dev          # http://localhost:3002  (서버 코드를 고치면 자동 재시작)
```
- 서버 코드(`server/`, `shared/`)를 고치면 서버가 알아서 재시작된다.
- 화면 코드(`client/`)는 브라우저 새로고침(Cmd+Shift+R)만 하면 반영된다.
- 같은 네트워크의 다른 기기에서 테스트하려면 `npm run dev` 가 출력하는 `같은 네트워크` 주소로 접속.
- 화면 아래에 `DEV · v2.0.0` 표시가 떠서 라이브와 헷갈리지 않는다. (라이브에는 표시가 없다.)
- 혼자서도 봇이 채워 주므로 바로 해 볼 수 있다. 사람이 둘 필요하면 브라우저 탭을 두 개 연다.

## 테스트

```bash
npm run lint         # 정의되지 않은 이름·안 쓰는 변수 같은 실수 (1초)
npm run test:unit    # 채팅 규칙·명중 검증 같은 순수 함수 (1초)
npm test             # 단위 + 서버 규칙(방/봇/명중/채팅/부활/팀전/친선전/출전 무기·파츠/경기 종료) (약 1분)
npm run test:browser # 실제 Chrome 으로 접속해 화면·이동·사격·채팅·무기고 확인 (약 1분)
npm run test:all     # 위 전부
```
- 서버/브라우저 테스트는 매번 **무작위 포트에 임시 서버**를 따로 띄우므로 dev 서버나 라이브와 겹치지 않는다.
- Chrome 경로가 다르면 `CHROME_PATH=/경로 npm run test:browser`.
- **라이브에 올리기 전에는 `npm run test:all`.**
- 브라우저 테스트가 쓰는 `window.__g` 는 디버그용 훅이다(`client/js/main.js`).

## 라이브 반영

설정: `deploy/targets.env` (git 에 올라가지 않음. 형식은 `deploy/targets.example.env`)

```bash
./deploy/deploy.sh prod --status    # 접속자 수·버전 확인 (아무것도 바꾸지 않음)
npm run deploy:prod                 # 라이브에 배포
npm run rollback:prod               # 직전 버전으로 되돌리기
```

**배포하면 서버가 재시작되어 접속 중인 모든 유저의 연결이 끊긴다** (주소는 그대로, 새로고침하면 바로 재접속). 그래서:
1. 테스트가 먼저 돌고, 실패하면 배포하지 않는다.
2. **접속자가 있으면 중단**한다. 유저가 적은 시간에 하거나, 감수하려면 `--even-if-users`.
3. `deploy prod` 라고 직접 입력해야 진행된다.
4. 직전 버전을 서버의 `~/frontline-duel.prev` 에 백업한다.
5. 새 버전이 응답하지 않으면 **자동으로 직전 버전으로 복구**한다.

서버 주소(IP/포트)는 배포로 바뀌지 않는다. 같은 서비스(`frontline-duel`)의 코드만 교체하고 재시작한다.

## 알아둘 점
- 게임 상태(방, 점수)는 서버 메모리에만 있다. 재시작하면 모든 방이 사라진다. 저장되는 데이터가 없다.
- `/status` 는 누구나 볼 수 있다 (환경, 버전, 방 수, 접속자 수만 나온다).
- 테스트용 환경변수: `MATCH_SECONDS`, `RESTART_SECONDS`, `GOAL`, `BOT_FILL`, `PORT`, `APP_ENV` (`server/config.js`).
