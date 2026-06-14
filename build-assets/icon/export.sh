#!/usr/bin/env bash
#
# Tabula icon export: SVG → 多尺寸 PNG → .icns (macOS) + .ico (Windows)
#
# 依赖:
#   macOS:   rsvg-convert (brew install librsvg), iconutil (系统自带)
#   Linux:   rsvg-convert, imagemagick (icns/ico 需 macOS iconutil 或 icnsutils)
#   Windows: rsvg-convert (win Chocolatey: rsvg-convert), ImageMagick
#
# 用法:
#   ./export.sh            # 导出 PNG + icns + ico
#   ./export.sh png        # 只导出 PNG
#   ./export.sh icns       # 只导出 icns
#   ./export.sh ico        # 只导出 ico
#
# 输出:
#   build-assets/icon/png/{16,32,64,128,256,512,1024}.png
#   build-assets/icon/Tabula.icns
#   build-assets/icon/Tabula.ico
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SVG="$SCRIPT_DIR/icon.svg"
OUT_DIR="$SCRIPT_DIR/png"
ICON_NAME="Tabula"

# macOS icns 需要的尺寸 (含 @2x retina)
ICNS_SIZES=(16 32 64 128 256 512 1024)
# Windows ico 多分辨率合集
ICO_SIZES=(16 24 32 48 64 128 256)

# 颜色空间检查: rsvg-convert 默认 sRGB 够用
export RSVG_RC="${RSVG_RC:-}"

step() { printf "  → %s\n" "$*"; }
ok()   { printf "  ✓ %s\n" "$*"; }
err()  { printf "  ✗ %s\n" "$*" >&2; exit 1; }

command -v rsvg-convert >/dev/null 2>&1 || err "rsvg-convert 未安装 (brew install librsvg)"

# ---------- PNG 导出 ----------
export_png() {
  mkdir -p "$OUT_DIR"
  for size in "${ICNS_SIZES[@]}"; do
    step "PNG ${size}×${size}"
    rsvg-convert -w "$size" -h "$size" "$SVG" -o "$OUT_DIR/${size}.png"
  done
  ok "PNG 输出到 $OUT_DIR/"
}

# ---------- macOS .icns ----------
# 需要尺寸: 16, 32, 64, 128, 128@2x=256, 256, 256@2x=512, 512, 512@2x=1024
# macOS 自带 iconutil 接受 iconset 目录
export_icns() {
  if ! command -v iconutil >/dev/null 2>&1; then
    err "iconutil 仅 macOS 自带. 在 Linux/Windows 上跳过 icns 生成"
  fi
  local ICONSET="$SCRIPT_DIR/Tabula.iconset"
  rm -rf "$ICONSET"
  mkdir -p "$ICONSET"
  cp "$OUT_DIR/16.png"   "$ICONSET/icon_16x16.png"
  cp "$OUT_DIR/32.png"   "$ICONSET/icon_16x16@2x.png"
  cp "$OUT_DIR/32.png"   "$ICONSET/icon_32x32.png"
  cp "$OUT_DIR/64.png"   "$ICONSET/icon_32x32@2x.png"
  cp "$OUT_DIR/128.png"  "$ICONSET/icon_128x128.png"
  cp "$OUT_DIR/256.png"  "$ICONSET/icon_128x128@2x.png"
  cp "$OUT_DIR/256.png"  "$ICONSET/icon_256x256.png"
  cp "$OUT_DIR/512.png"  "$ICONSET/icon_256x256@2x.png"
  cp "$OUT_DIR/512.png"  "$ICONSET/icon_512x512.png"
  cp "$OUT_DIR/1024.png" "$ICONSET/icon_512x512@2x.png"
  step "iconutil 生成 icns"
  iconutil -c icns "$ICONSET" -o "$SCRIPT_DIR/${ICON_NAME}.icns"
  rm -rf "$ICONSET"
  ok "icns 输出到 $SCRIPT_DIR/${ICON_NAME}.icns"
}

# ---------- Windows .ico ----------
# ImageMagick 合成多分辨率 .ico
export_ico() {
  if ! command -v magick >/dev/null 2>&1 && ! command -v convert >/dev/null 2>&1; then
    err "ImageMagick 未安装"
  fi
  local CONVERT="$(command -v magick || command -v convert)"
  local INPUTS=()
  for s in "${ICO_SIZES[@]}"; do
    # 如果该尺寸 PNG 不存在, 生成临时
    if [ ! -f "$OUT_DIR/${s}.png" ]; then
      rsvg-convert -w "$s" -h "$s" "$SVG" -o "$OUT_DIR/${s}.png"
    fi
    INPUTS+=("$OUT_DIR/${s}.png")
  done
  step "$CONVERT 合成多分辨率 ico"
  $CONVERT "${INPUTS[@]}" "$SCRIPT_DIR/${ICON_NAME}.ico"
  ok "ico 输出到 $SCRIPT_DIR/${ICON_NAME}.ico"
}

# ---------- 入口 ----------
MODE="${1:-all}"
case "$MODE" in
  png) export_png ;;
  icns) export_png; export_icns ;;
  ico) export_png; export_ico ;;
  all) export_png; export_icns; export_ico ;;
  *) err "用法: $0 [png|icns|ico|all]" ;;
esac

ok "完成"
