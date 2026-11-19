#!/bin/zsh
# Records the scripted demo tour and turns it into the README GIF and screenshot.
# Uses a throwaway project, so nothing from your machine ends up in the images.
#
#   scripts/make-demo.sh
#
# Needs Google Chrome (or CHROME_PATH), ffmpeg and ImageMagick
# (brew install ffmpeg imagemagick), plus `npm install` for puppeteer-core.
set -euo pipefail
cd "$(dirname "$0")/.."

WIDTH="${GIF_WIDTH:-1100}"
FPS="${GIF_FPS:-15}"
OUT=docs
WORK=build/demo
mkdir -p "$OUT"

echo "› Recording"
node scripts/demo/tour.js "$WORK"

echo "› Encoding GIF"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$WORK/frames.ffconcat" \
  -vf "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle" \
  -loop 0 "$OUT/demo.gif"

echo "› Screenshot"
magick "$WORK/screenshot.png" -resize 2000x -strip -define png:compression-level=9 "$OUT/screenshot.png"

ls -lh "$OUT/demo.gif" "$OUT/screenshot.png" | awk '{print "  " $5 "  " $9}'
