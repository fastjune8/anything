#!/usr/bin/env bash
# 사용법: ./deploy/deploy.sh <SSH키 경로> <유저@서버IP>
# 예:     ./deploy/deploy.sh ~/.ssh/oracle.key opc@123.45.67.89
# 서버에 Node.js(npm 포함)와 rsync가 설치되어 있어야 한다.
set -euo pipefail

KEY="${1:?SSH 키 경로를 넣어주세요}"
HOST="${2:?유저@IP 를 넣어주세요}"
REMOTE_USER="${HOST%@*}"
cd "$(dirname "$0")/.."

SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"

# 서비스 파일의 계정/경로를 접속 계정에 맞게 바꿔서 올린다 (Ubuntu=ubuntu, Oracle Linux=opc)
TMP_SVC="$(mktemp)"
sed "s#/home/ubuntu#/home/${REMOTE_USER}#g; s#User=ubuntu#User=${REMOTE_USER}#" deploy/frontline-duel.service > "$TMP_SVC"

rsync -avz --delete --exclude node_modules --exclude deploy -e "$SSH" ./ "$HOST:~/frontline-duel/"
scp -i "$KEY" "$TMP_SVC" "$HOST:/tmp/frontline-duel.service"
rm -f "$TMP_SVC"

$SSH "$HOST" '
  set -e
  cd ~/frontline-duel
  npm install --omit=dev
  sudo mv /tmp/frontline-duel.service /etc/systemd/system/frontline-duel.service
  sudo restorecon /etc/systemd/system/frontline-duel.service 2>/dev/null || true
  sudo systemctl daemon-reload
  sudo systemctl enable frontline-duel
  sudo systemctl restart frontline-duel
  sleep 1
  systemctl is-active frontline-duel
'
echo "완료: http://${HOST#*@}:3000"
