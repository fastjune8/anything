#!/usr/bin/env bash
# 사용법:
#   ./deploy/deploy.sh staging                  스테이징에 배포 (유저 영향 없음)
#   ./deploy/deploy.sh prod                     라이브에 배포 (확인 절차 있음)
#   ./deploy/deploy.sh prod --rollback          직전 버전으로 되돌리기
#   ./deploy/deploy.sh <env> --status           서버 상태만 보기 (아무것도 바꾸지 않음)
# 옵션: --skip-tests  테스트 생략 / --yes  확인 질문 생략 / --even-if-users  접속자가 있어도 진행
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f deploy/targets.env ] || { echo "deploy/targets.env 가 없습니다. deploy/targets.example.env 를 복사해 채우세요."; exit 1; }
# shellcheck disable=SC1091
source deploy/targets.env

TARGET="${1:-}"; shift || true
ROLLBACK=0; STATUS_ONLY=0; SKIP_TESTS=0; YES=0; EVEN_IF_USERS=0
for a in "$@"; do
  case "$a" in
    --rollback) ROLLBACK=1 ;; --status) STATUS_ONLY=1 ;; --skip-tests) SKIP_TESTS=1 ;;
    --yes) YES=1 ;; --even-if-users) EVEN_IF_USERS=1 ;;
    *) echo "알 수 없는 옵션: $a"; exit 1 ;;
  esac
done

case "$TARGET" in
  prod)    HOST=$PROD_HOST;    PORT=$PROD_PORT;    DIR=$PROD_DIR;    SERVICE=$PROD_SERVICE;    LIMITS="" ;;
  staging) HOST=$STAGING_HOST; PORT=$STAGING_PORT; DIR=$STAGING_DIR; SERVICE=$STAGING_SERVICE; LIMITS=$'MemoryMax=150M\nCPUQuota=30%\nNice=10' ;;
  *) echo "사용법: $0 <staging|prod> [--rollback|--status] [--skip-tests] [--yes] [--even-if-users]"; exit 1 ;;
esac

SSH_BASE=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o LogLevel=ERROR)
remote() { ssh "${SSH_BASE[@]}" "$SSH_USER@$HOST" "$@"; }

# 서버가 알려주는 상태: "접속자수 버전 환경" 또는 "?"
live_status() {
  curl -s --max-time 5 "http://$HOST:$PORT/status" | node -e '
    let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{ try{ const s=JSON.parse(d); console.log(s.humans+" "+s.version+" "+s.env); }catch{ console.log("?"); } })' 2>/dev/null || echo "?"
}

echo "== 대상: $TARGET  ($SSH_USER@$HOST  포트 $PORT  폴더 ~/$DIR  서비스 $SERVICE)"

if [ "$STATUS_ONLY" = 1 ]; then
  echo "서비스 상태: $(remote "systemctl is-active $SERVICE 2>&1 || true")"
  read -r H V E <<< "$(live_status)"
  if [ "$H" = "?" ]; then echo "게임 상태: 확인 불가 (꺼져 있거나 이전 버전이거나 포트가 막힘)"; else echo "게임 상태: 접속자 ${H}명 · v$V · $E"; fi
  exit 0
fi

# ---------- 되돌리기 ----------
if [ "$ROLLBACK" = 1 ]; then
  remote "[ -d ~/$DIR.prev ]" || { echo "백업(~/$DIR.prev)이 없어 되돌릴 수 없습니다."; exit 1; }
  if [ "$YES" != 1 ]; then read -r -p "[$TARGET] 직전 버전으로 되돌립니다. 접속자는 연결이 끊깁니다. 계속할까요? (yes) " ans; [ "$ans" = yes ] || { echo "취소"; exit 1; }; fi
  remote "sudo systemctl stop $SERVICE; rsync -a --delete ~/$DIR.prev/ ~/$DIR/; sudo systemctl start $SERVICE; sleep 2; systemctl is-active $SERVICE"
  echo "되돌리기 완료. 현재 상태: $(live_status)"
  exit 0
fi

# ---------- 1) 테스트 ----------
if [ "$SKIP_TESTS" != 1 ]; then
  echo "== 테스트 실행 (실패하면 배포하지 않습니다)"
  npm test --silent
fi

# ---------- 2) 라이브 보호 ----------
if [ "$TARGET" = prod ]; then
  read -r H V E <<< "$(live_status)"
  if [ "$H" = "?" ]; then
    echo "!! 라이브 서버 상태를 확인할 수 없습니다 (이전 버전이라 /status 가 없거나 서버가 꺼진 상태)."
  else
    echo "== 라이브 현재: 접속자 ${H}명 · v$V · $E"
    if [ "$H" -gt 0 ] && [ "$EVEN_IF_USERS" != 1 ]; then
      echo "!! 지금 ${H}명이 접속 중입니다. 배포하면 서버가 재시작되어 모두 연결이 끊깁니다."
      echo "   유저가 없을 때 하거나, 감수하려면 --even-if-users 를 붙이세요."
      exit 1
    fi
  fi
  if [ "$YES" != 1 ]; then
    read -r -p "== 라이브 서버($HOST)에 v$(node -p "require('./package.json').version") 을 배포합니다. 'deploy prod' 라고 입력하세요: " ans
    [ "$ans" = "deploy prod" ] || { echo "취소"; exit 1; }
  fi
fi

# ---------- 3) 배포 ----------
UNIT="[Unit]
Description=Frontline Duel ($TARGET)
After=network.target

[Service]
User=$SSH_USER
WorkingDirectory=/home/$SSH_USER/$DIR
Environment=PORT=$PORT
Environment=APP_ENV=$TARGET
ExecStart=/usr/bin/env node server/index.js
Restart=always
RestartSec=2
$LIMITS

[Install]
WantedBy=multi-user.target"

echo "== 이전 버전 백업 (~/$DIR.prev)"
remote "mkdir -p ~/$DIR && rm -rf ~/$DIR.prev && cp -a ~/$DIR ~/$DIR.prev"

echo "== 파일 전송"
rsync -az --delete --exclude node_modules --exclude deploy --exclude tests --exclude .git --exclude '*.log' \
  -e "ssh ${SSH_BASE[*]}" ./ "$SSH_USER@$HOST:~/$DIR/"

echo "== 설치 및 서비스 재시작"
printf '%s\n' "$UNIT" | remote "cat > /tmp/$SERVICE.service"
remote "
  set -e
  cd ~/$DIR && npm install --omit=dev --no-audit --no-fund --loglevel=error
  sudo mv /tmp/$SERVICE.service /etc/systemd/system/$SERVICE.service
  sudo restorecon /etc/systemd/system/$SERVICE.service 2>/dev/null || true
  sudo firewall-cmd --permanent --add-port=$PORT/tcp >/dev/null 2>&1 || true
  sudo firewall-cmd --reload >/dev/null 2>&1 || true
  sudo systemctl daemon-reload
  sudo systemctl enable $SERVICE >/dev/null 2>&1
  sudo systemctl restart $SERVICE
"

echo "== 상태 확인"
OK=0
for i in 1 2 3 4 5 6 7 8; do
  sleep 2
  if remote "curl -s --max-time 3 http://localhost:$PORT/status" | grep -q '"version"'; then OK=1; break; fi
done
if [ "$OK" = 1 ]; then
  echo "서버 안에서 응답 확인: $(remote "curl -s http://localhost:$PORT/status")"
  read -r H V E <<< "$(live_status)"
  if [ "$H" = "?" ]; then echo "※ 서버 안에서는 정상이지만 밖($HOST:$PORT)에서는 응답이 없습니다. 오라클 콘솔의 Security List 에 $PORT 포트 허용이 필요할 수 있습니다."
  else echo "밖에서도 접속 확인: http://$HOST:$PORT  (접속자 ${H}명 · v$V · $E)"; fi
  echo "완료."
else
  echo "!! 새 버전이 응답하지 않습니다. 최근 로그:"
  remote "journalctl -u $SERVICE -n 15 --no-pager" || true
  if [ "$TARGET" = prod ]; then
    echo "!! 라이브이므로 직전 버전으로 자동 복구합니다."
    remote "sudo systemctl stop $SERVICE; rsync -a --delete ~/$DIR.prev/ ~/$DIR/; sudo systemctl start $SERVICE"
    sleep 3; echo "복구 후 상태: $(live_status)"
  fi
  exit 1
fi
