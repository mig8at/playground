#!/bin/bash
# Arma minutes/recorder/.build/Minutes.app si main.swift o Info.plist cambiaron.
#
# Firma con el mismo certificado autofirmado que Captura («Captura playground local», ver captura/build.sh): macOS
# ata los permisos de Grabación de pantalla y Micrófono al requisito de la firma (identificador + certificado), que no
# cambia al recompilar. Con firma ad hoc cada recompilación sería otra app y habría que volver a dar los permisos.
set -euo pipefail
cd "$(dirname "$0")"
app=.build/Minutes.app
bin=$app/Contents/MacOS/minutes-recorder
identity="Captura playground local"
if [ -x "$bin" ] && [ "$bin" -nt main.swift ] && [ "$bin" -nt Info.plist ]; then exit 0; fi
echo "  · compilando Minutes.app" >&2
mkdir -p "$app/Contents/MacOS"
cp Info.plist "$app/Contents/Info.plist"
swiftc -O main.swift -o "$bin"
if security find-identity -p codesigning 2>/dev/null | grep -q "\"$identity\""; then
  codesign --force --sign "$identity" "$app"
else
  echo "  ⚠ no está el certificado «$identity»: firma ad hoc, macOS va a volver a pedir los permisos" >&2
  codesign --force --sign - "$app"
fi
