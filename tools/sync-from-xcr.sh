#!/bin/sh
# Pull the device, presets, target database and analysis library from an
# XC-R checkout into this static build, and recompile the stylesheet.
#
#   tools/sync-from-xcr.sh ../XC_R
set -eu

XCR="${1:-../XC_R}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
APP="$XCR/APP"

# The export the XC-R player loads — keep in step with PATCH_EXPORT_URL in js/app.js
EXPORT="${EXPORT:-patch.export.json}"
SRC="$APP/public/assets/rnbo_export"
DST="$HERE/assets/rnbo_export"

if [ ! -f "$SRC/$EXPORT" ]; then
  echo "No $EXPORT found in $SRC" >&2
  exit 1
fi

# Replace the export (only the files, never .DS_Store or backups)
mkdir -p "$DST"
find "$DST" -maxdepth 1 -type f -name '*.export.*' -exec rm -f {} +
cp "$SRC/$EXPORT" "$DST/"
LICENSE="$SRC/${EXPORT%.json}.license"
[ -f "$LICENSE" ] && cp "$LICENSE" "$DST/"
[ -f "$SRC/dependencies.json" ] && cp "$SRC/dependencies.json" "$DST/"

# Ship only the rnbo.js the export was made with
VERSION=$(sed -n 's/.*"rnboversion": *"\([^"]*\)".*/\1/p' "$DST/$EXPORT" | head -n 1)
if [ -f "$APP/public/assets/rnbo/$VERSION/rnbo.min.js" ]; then
  mkdir -p "$HERE/assets/rnbo/$VERSION"
  cp "$APP/public/assets/rnbo/$VERSION/rnbo.min.js" "$HERE/assets/rnbo/$VERSION/"
  find "$HERE/assets/rnbo" -mindepth 1 -maxdepth 1 -type d ! -name "$VERSION" -exec rm -r {} +
else
  echo "warning: XC-R has no rnbo.js $VERSION — the page will fall back to the Cycling '74 CDN" >&2
fi
echo "RNBO export synced: $EXPORT (rnbo.js $VERSION)"

# Presets of the preset space, target database (calibration), Essentia
cp "$APP/public/assets/BH1-presets.txt" "$HERE/assets/"
[ -f "$APP/data/targets.json" ] && cp "$APP/data/targets.json" "$HERE/assets/targets.json"
mkdir -p "$HERE/assets/essentia"
cp "$APP/public/assets/essentia/"essentia* "$HERE/assets/essentia/"
echo "presets, targets and essentia synced"

# Shared libraries, used as they are
for lib in preset-space descriptors sound-analysis radar score-order; do
  cp "$APP/src/lib/$lib.js" "$HERE/js/lib/"
done
echo "js/lib synced"

npx --yes sass --no-source-map "$HERE/style/app.scss" "$HERE/style/app.css"
echo "style/app.css rebuilt"
