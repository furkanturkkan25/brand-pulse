#!/bin/zsh
cd "$(dirname "$0")/.." || exit 1
echo "=== Brand Pulse ==="
echo "Klasör: $(pwd)"
# Eski bozuk portları bırak; temiz port kullan
PORT=3050
echo "DNS: $(/usr/bin/python3 -c 'import socket; print(socket.gethostbyname("news.google.com"))' 2>&1)"
echo "Sunucu: http://127.0.0.1:$PORT"
echo ""
npm run start -- -H 127.0.0.1 -p "$PORT"
