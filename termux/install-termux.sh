#!/data/data/com.termux/files/usr/bin/bash
# Установка RLM в Termux: зависимости + короткая команда запуска «rlm»
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$PREFIX/bin/rlm"

echo "→ пакеты…"
pkg install -y nodejs-lts >/dev/null 2>&1 || pkg install -y nodejs >/dev/null 2>&1 || true

echo "→ зависимости сервера (долго, один раз)…"
(cd "$HERE/server" && npm install --omit=dev)

cat > "$BIN" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
exec "$HERE/start-termux.sh" "\$@"
EOF
chmod +x "$BIN"

echo
echo "готово. запуск одной командой:  rlm"
