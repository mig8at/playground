#!/bin/bash
# Arma captura/.build/Captura.app si main.swift o Info.plist cambiaron.
#
# Firma: con el certificado autofirmado «Captura playground local» del llavero de inicio de sesión (conserva el
# nombre de antes del renombre a my-tools: es el del llavero, y cambiarlo es recrear el certificado)
# (creado el 2026-11-10, vale 10 años). macOS ata los permisos de Grabación de pantalla y Accesibilidad
# al REQUISITO de la firma (identificador + certificado), que no cambia al recompilar. Con firma ad hoc
# los ata a la huella del binario, y cada recompilación era otra app para macOS: el interruptor seguía
# prendido en Ajustes pero ya no valía. Si el certificado no está (otra Mac), cae a ad hoc y avisa.
# Recrearlo: un certificado x509 con extendedKeyUsage=codeSigning, importado con
# `security import <p12> -k ~/Library/Keychains/login.keychain-db -T /usr/bin/codesign`.
set -euo pipefail
cd "$(dirname "$0")"
app=.build/Captura.app
bin=$app/Contents/MacOS/captura
identity="Captura playground local"
if [ -x "$bin" ] && [ "$bin" -nt main.swift ] && [ "$bin" -nt Info.plist ]; then exit 0; fi
echo "  · compilando Captura.app" >&2
mkdir -p "$app/Contents/MacOS"
cp Info.plist "$app/Contents/Info.plist"
swiftc -O main.swift -o "$bin"
if security find-identity -p codesigning 2>/dev/null | grep -q "\"$identity\""; then
  codesign --force --sign "$identity" "$app"
else
  echo "  ⚠ no está el certificado «$identity»: firma ad hoc, macOS va a volver a pedir los permisos" >&2
  codesign --force --sign - "$app"
fi
