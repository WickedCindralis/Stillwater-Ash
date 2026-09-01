#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT="$SCRIPT_DIR/Stillwater.Companion.csproj"
SOURCE="$SCRIPT_DIR/Program.cs"
OUTPUT_DIR="$SCRIPT_DIR/release"
OUTPUT="$OUTPUT_DIR/Stillwater.Companion.exe"

if [ -f "$OUTPUT" ] && [ "$OUTPUT" -nt "$PROJECT" ] && [ "$OUTPUT" -nt "$SOURCE" ]; then
  exit 0
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