#!/bin/zsh
cd /Users/furkanturkkan/brand-pulse || exit 1
PORT=3000
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  PORT=3040
fi
echo "Brand Pulse → http://127.0.0.1:$PORT"
echo "DNS kontrol: $(node -e "require('dns').lookup('news.google.com',(e,a)=>console.log(e?e.code:'OK'))")"
npm run start -- -H 127.0.0.1 -p "$PORT"
