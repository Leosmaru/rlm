#!/data/data/com.termux/files/usr/bin/bash
# RLM — запуск в Termux (без озвучки: голосовой сервис на телефон не ставится)
clear
G=$'\e[38;5;203m'; D=$'\e[38;5;240m'; W=$'\e[0m'
cat <<'ART'
ART
printf "%s" "$G"
cat <<'ART'
   ██████╗  ██╗      ███╗   ███╗
   ██╔══██╗ ██║      ████╗ ████║
   ██████╔╝ ██║      ██╔████╔██║
   ██╔══██╗ ██║      ██║╚██╔╝██║
   ██║  ██║ ███████╗ ██║ ╚═╝ ██║
   ╚═╝  ╚═╝ ╚══════╝ ╚═╝     ╚═╝
ART
printf "%s" "$D"
echo "   R o l e p l a y   M a c h i n e   ·   termux"
printf "%s\n" "$W"

cd "$(dirname "$0")" || exit 1
if [ ! -d server/node_modules ]; then
  echo "   ставлю зависимости (один раз, это долго)…"
  (cd server && npm install --omit=dev) || { echo "   не удалось поставить зависимости"; exit 1; }
fi
IP=$(ifconfig 2>/dev/null | awk '/inet /{print $2}' | grep -v 127.0.0.1 | head -1)
echo "   холст:      http://127.0.0.1:8100/rlm/"
[ -n "$IP" ] && echo "   с ПК/сети:  http://$IP:8100/rlm/"
echo
cd server && exec node server.js
