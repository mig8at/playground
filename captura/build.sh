#!/bin/bash
# Arma captura/.build/Captura.app si main.swift o Info.plist cambiaron.
# ⚠ La firma es ad hoc: cada recompilación cambia la huella y macOS puede volver a pedir el permiso de
# Grabación de pantalla. Por eso sólo se recompila cuando cambia el fuente.
set -euo pipefail
cd "$(dirname "$0")"
app=.build/Captura.app
bin=$app/Contents/MacOS/captura
if [ -x "$bin" ] && [ "$bin" -nt main.swift ] && [ "$bin" -nt Info.plist ]; then exit 0; fi
echo "  · compilando Captura.app" >&2
mkdir -p "$app/Contents/MacOS"
cp Info.plist "$app/Contents/Info.plist"
swiftc -O main.swift -o "$bin"
codesign --force --sign - "$app" >/dev/null 2>&1
