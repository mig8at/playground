#!/bin/sh
# Compila el avisador de Cockpit (main.swift, al lado) como app: «Cockpit Avisos.app», que en el aviso dice «Cockpit»,
# con su identificador propio para que macOS le dé su permiso de avisos. Queda en ~/Applications para que macOS la
# encuentre al tocar un aviso. Sin swiftc (las Command Line Tools) no hace nada: lib/notice sigue con osascript.
#
#   sh cockpit/notifier/build.sh          compila si cambió (o si no está)
#   sh cockpit/notifier/build.sh --force  compila igual
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
src="$here/main.swift"
app="$HOME/Applications/Cockpit Avisos.app"
bin="$app/Contents/MacOS/CockpitNotifier"

command -v swiftc >/dev/null 2>&1 || { echo "cockpit · sin swiftc: el avisador no se compila (los avisos salen por osascript)"; exit 0; }
if [ "${1:-}" != "--force" ] && [ -x "$bin" ] && [ ! "$src" -nt "$bin" ] && [ ! "$0" -nt "$bin" ]; then
  exit 0
fi

mkdir -p "$app/Contents/MacOS"
cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.creditop.my-tools.notifier</string>
  <key>CFBundleName</key><string>Cockpit</string>
  <key>CFBundleDisplayName</key><string>Cockpit</string>
  <key>CFBundleExecutable</key><string>CockpitNotifier</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF
tmp="$bin.$$"
swiftc -O -o "$tmp" "$src" -framework AppKit -framework UserNotifications
mv -f "$tmp" "$bin"
# Firma fija (bin/sign): el permiso de avisos queda atado a ella y no se pierde al recompilar.
sh "$here/../../bin/sign" "$app" com.creditop.my-tools.notifier || codesign --force --sign - "$app" >/dev/null 2>&1 || true
# Que LaunchServices la conozca: así un toque en el aviso la vuelve a abrir.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app" >/dev/null 2>&1 || true
echo "cockpit · avisador compilado: $app"
