#!/data/data/com.termux/files/usr/bin/bash
# Установка RLM в Termux: зависимости + короткая команда запуска «rlm».
# Ошибки не прячем — если что-то падает, видно причину.

HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$PREFIX/bin/rlm"

echo "→ обновляю списки пакетов…"
pkg update -y || true

echo "→ ставлю node…"
if ! command -v node >/dev/null 2>&1; then
  pkg install -y nodejs || pkg install -y nodejs-lts || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "✗ node не поставился. Выполни вручную:"
  echo "    pkg update -y && pkg install -y nodejs"
  echo "  затем запусти установку снова."
  exit 1
fi
echo "  node $(node -v)"

echo "→ зависимости сервера (долго, один раз)…"
cd "$HERE/server" || { echo "✗ нет папки server рядом со скриптом"; exit 1; }
npm install --omit=dev --no-audit --no-fund
if [ ! -d node_modules ]; then
  echo
  echo "✗ npm не поставил зависимости. Попробуй ещё раз:"
  echo "    cd $HERE/server && npm install --omit=dev"
  exit 1
fi
cd "$HERE" || exit 1

chmod +x "$HERE/start-termux.sh" "$HERE/install-termux.sh" 2>/dev/null

cat > "$BIN" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
exec "$HERE/start-termux.sh" "\$@"
EOF
chmod +x "$BIN"

echo
echo "готово. запуск одной командой:  rlm"
echo "холст откроется в браузере телефона: http://127.0.0.1:8100/rlm/"
