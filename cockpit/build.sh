#!/bin/sh
# Compila Cockpit (cockpit/src-tauri): el servidor del chat que va adentro (Go), la interfaz del chat que ese servidor
# sirve, el avisador de macOS y la app de Tauri con su carcasa (cockpit/shell). Queda en
# cockpit/src-tauri/target/release/bundle/macos/Cockpit.app. `make cockpit` la compila, la instala en Aplicaciones y la abre.
set -eu
cockpit=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$cockpit/.." && pwd -P)
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
command -v cargo >/dev/null 2>&1 || { echo "cockpit · falta Rust: https://rustup.rs" >&2; exit 1; }
triple=$(rustc -vV | sed -n 's/^host: //p')
mkdir -p "$cockpit/src-tauri/binaries"
(cd "$root" && go build -o "cockpit/src-tauri/binaries/chat-server-$triple" ./chat/server)
sh "$root/chat/scripts/notifier.sh" || echo "⚠ el avisador no compiló: los avisos salen por osascript" >&2
(cd "$root/chat" && npm run build --silent >/dev/null)
[ -d "$cockpit/node_modules" ] || (cd "$cockpit" && npm install --silent)
cd "$cockpit" && npx tauri build --bundles app
# Firma fija (bin/sign): que recompilar Cockpit no le vuelva a pedir a macOS el permiso de Escritorio.
sh "$root/bin/sign" "$cockpit/src-tauri/target/release/bundle/macos/Cockpit.app" com.creditop.my-tools.cockpit
