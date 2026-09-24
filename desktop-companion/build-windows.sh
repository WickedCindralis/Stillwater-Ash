#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT="$SCRIPT_DIR/Stillwater.Companion.csproj"
OUTPUT_DIR="$SCRIPT_DIR/release"
OUTPUT="$OUTPUT_DIR/Stillwater.Companion.exe"

if [ -f "$OUTPUT" ] && [ "$OUTPUT" -nt "$PROJECT" ]; then
  sources_current=true
  for SOURCE in "$SCRIPT_DIR"/*.cs; do
    [ -f "$SOURCE" ] || continue
    if [ ! "$OUTPUT" -nt "$SOURCE" ]; then
      sources_current=false
      break
    fi
  done
  if [ "$sources_current" = true ]; then
    exit 0
  fi
fi

rm -rf "$OUTPUT_DIR"
DOTNET_CLI_TELEMETRY_OPTOUT=1 dotnet publish "$PROJECT" \
  --configuration Release \
  --runtime win-x64 \
  --self-contained true \
  --property:PublishSingleFile=true \
  --property:IncludeNativeLibrariesForSelfExtract=true \
  --property:DebugType=None \
  --output "$OUTPUT_DIR"