#!/bin/sh
# Compila el avisador del chat (notifier/main.swift) como app: «Chat del playground.app», con su identificador propio
# para que macOS le dé su permiso de avisos. Queda en ~/Applications para que macOS la encuentre al tocar un aviso.
# Sin swiftc (las Command Line Tools) no hace nada: el servidor sigue con osascript.
#
#   sh scripts/notifier.sh          compila si cambió (o si no está)
#   sh scripts/notifier.sh --force  compila igual
set -eu
chat=$(cd "$(dirname "$0")/.." && pwd -P)
src="$chat/notifier/main.swift"
app="$HOME/Applications/Chat del playground.app"
bin="$app/Contents/MacOS/ChatNotifier"

command -v swiftc >/dev/null 2>&1 || { echo "chat · sin swiftc: el avisador no se compila (los avisos salen por osascript)"; exit 0; }
if [ "${1:-}" != "--force" ] && [ -x "$bin" ] && [ ! "$src" -nt "$bin" ] && [ ! "$0" -nt "$bin" ]; then
  exit 0
fi

mkdir -p "$app/Contents/MacOS"
cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.creditop.playground.chat-notifier</string>
  <key>CFBundleName</key><string>Chat del playground</string>
  <key>CFBundleDisplayName</key><string>Chat del playground</string>
  <key>CFBundleExecutable</key><string>ChatNotifier</string>
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
codesign --force --sign - "$app" >/dev/null 2>&1 || true
# Que LaunchServices la conozca: así un toque en el aviso la vuelve a abrir.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app" >/dev/null 2>&1 || true
echo "chat · avisador compilado: $app"
