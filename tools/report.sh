#!/bin/sh
# Screenshots the toolbar strip so the fit report can be read at a glance.
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
node "$DIR/tools/build.js" >/dev/null
F=$(ls -t "$DIR"/cyborg-news-*.html | head -1)
mkdir -p "$DIR/build"
"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1500,150 --force-device-scale-factor=2 --virtual-time-budget=20000 \
  --default-background-color=FFFFFFFF \
  --screenshot="$DIR/build/report.png" "file://$F" 2>/dev/null
echo "build/report.png"
