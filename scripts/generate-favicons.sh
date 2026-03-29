#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_SVG="${1:-$ROOT_DIR/public/favicon.svg}"
TMP_DIR="$(mktemp -d)"
TMP_PNG="$TMP_DIR/favicon.svg.png"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

if ! command -v qlmanage >/dev/null 2>&1; then
  echo "error: qlmanage is required to render the SVG source on macOS" >&2
  exit 1
fi

if ! command -v sips >/dev/null 2>&1; then
  echo "error: sips is required to resize PNG outputs on macOS" >&2
  exit 1
fi

if [[ ! -f "$SOURCE_SVG" ]]; then
  echo "error: source SVG not found: $SOURCE_SVG" >&2
  exit 1
fi

echo "Rendering favicon source from $SOURCE_SVG"
qlmanage -t -s 512 -o "$TMP_DIR" "$SOURCE_SVG" >/dev/null

if [[ ! -f "$TMP_PNG" ]]; then
  echo "error: expected rendered PNG not produced at $TMP_PNG" >&2
  exit 1
fi

cp "$SOURCE_SVG" "$ROOT_DIR/public/favicon.svg"
cp "$TMP_PNG" "$ROOT_DIR/public/favicon.png"
cp "$TMP_PNG" "$ROOT_DIR/public/apple-touch-icon.png"

sips -z 32 32 "$TMP_PNG" --out "$ROOT_DIR/public/favicon-32x32.png" >/dev/null
sips -z 16 16 "$TMP_PNG" --out "$ROOT_DIR/public/favicon-16x16.png" >/dev/null

cat <<EOF
Updated favicon assets:
- public/favicon.svg
- public/favicon.png
- public/favicon-32x32.png
- public/favicon-16x16.png
- public/apple-touch-icon.png

If the SVG design changed, also review:
- public/safari-pinned-tab.svg
- index.html version query params
EOF
