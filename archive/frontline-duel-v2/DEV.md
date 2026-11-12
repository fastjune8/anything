# 개발 가이드

라이브 서버(실제 유저가 접속 중)에 영향을 주지 않고 게임을 계속 고쳐 나가기 위한 환경.

## 환경 3단계

| 환경 | 어디서 | 주소 | 유저 영향 |
|---|---|---|---|
| **dev** | 이 컴퓨터 | http://localhost:3002 | 없음 |
| **staging** | 오라클 서버(같은 VM, 다른 포트) | http://서버IP:3001 | 없음 (자원 제한됨) — *아직 만들지 않음, 아래 참고* |
| **prod** | 오라클 서버 | http://서버IP:3000 | **있음** |

dev 나 staging 에서는 화면 아래에 `DEV · v2.0.0` 같은 표시가 떠서 라이브와 헷갈리지 않는다. prod 에는 표시가 없다.

## 매일 하는 작업

```bash
cd archive/frontline-duel-v2
npm run dev          # http://localhost:3002  (서버 코드를 고치면 자동 재시작)
```
- 서버 코드(`server.js`, `bots.js`, `public/js/shared.js`)를 고치면 서버가 알아서 재시작된다.
- 화면 코드(`public/`)는 브라우저 새로고침만 하면 반영된다.
- 같은 네트워크의 다른 기기에서 테스트하려면 `npm run dev` 가 출력하는 `같은 네트워크` 주소로 접속.

## 테스트

```bash
npm test             # 서버 규칙: 방/봇/명중/경기 종료·재시작 (약 25초, 브라우저 불필요)
npm run test:browser # 실제 Chrome 으로 접속해 화면 오류 확인 (CHROME_PATH 로 경로 지정 가능)
npm run test:all     # 둘 다
```
테스트는 매번 **무작위 포트에 임시 서버**를 따로 띄우므로 dev/라이브와 겹치지 않는다.

## 배포

설정: `deploy/targets.env` (git 에 올라가지 않음. 예시는 `deploy/targets.example.env`)

```bash
npm run deploy:staging                       # 스테이징에 배포
npm run deploy:prod                          # 라이브에 배포 (아래 안전장치)
./deploy/deploy.sh prod --status             # 라이브 상태만 보기 (접속자 수, 버전) — 아무것도 바꾸지 않음
npm run rollback:prod                        # 직전 버전으로 되돌리기
```

**라이브 배포 안전장치**
1. 테스트가 먼저 돌고, 실패하면 배포하지 않는다.
2. 현재 접속자 수를 확인한다. **접속 중인 유저가 있으면 중단**한다. (배포하면 서버가 재시작되어 모두 끊김.) 감수하려면 `--even-if-users`.
3. `deploy prod` 라고 직접 입력해야 진행된다.
4. 배포 직전 버전을 서버의 `~/frontline-duel.prev` 에 백업한다.
5. 새 버전이 응답하지 않으면 **자동으로 직전 버전으로 복구**한다.

## 권장 작업 순서

1. `npm run dev` 로 고치고 직접 해 본다.
2. `npm run test:all`
3. (스테이징을 만들었다면) `npm run deploy:staging` → 실제 서버 환경에서 확인
4. 유저가 적은 시간에 `./deploy/deploy.sh prod --status` 로 접속자 확인 후 `npm run deploy:prod`

## 스테이징 서버 만들기 (선택)

같은 오라클 VM 에 포트 3001 로 두 번째 서버를 띄운다. 별도 폴더·서비스라 라이브와 섞이지 않고, 메모리 150MB / CPU 30% 로 제한해 라이브를 방해하지 않게 한다. 단 **VM 자체는 하나**라서 스테이징에서 부하 테스트를 하면 라이브도 느려질 수 있다.
1. 오라클 콘솔 → 서브넷 → Security List → Ingress Rule 에 TCP **3001** 추가
2. `npm run deploy:staging` (서버 안쪽 방화벽 설정은 스크립트가 한다)

## 알아둘 점
- 게임 상태(방, 점수)는 서버 메모리에만 있다. 재시작하면 모든 방이 사라진다. 저장되는 데이터가 없으므로 환경끼리 데이터가 섞일 일은 없다.
- `/status` 는 누구나 볼 수 있다 (환경, 버전, 방 수, 접속자 수만 나온다).
- 라이브에 처음 새 코드를 올리기 전까지, 라이브는 `/status` 가 없는 이전 버전이다. 그래서 `--status` 가 "확인 불가"로 나온다.
