#!/bin/sh
# Compila la app de escritorio del chat (chat/src-tauri): el servidor de Go que va adentro, la interfaz que sirve y la
# app de Tauri. Queda en chat/src-tauri/target/release/bundle/macos/Chat.app. `make chat-app` la compila y la abre.
set -eu
chat=$(cd "$(dirname "$0")/.." && pwd -P)
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
command -v cargo >/dev/null 2>&1 || { echo "chat · falta Rust: https://rustup.rs" >&2; exit 1; }
triple=$(rustc -vV | sed -n 's/^host: //p')
mkdir -p "$chat/src-tauri/binaries"
(cd "$chat/.." && go build -o "chat/src-tauri/binaries/chat-server-$triple" ./chat/server)
sh "$chat/scripts/notifier.sh" || echo "⚠ el avisador no compiló: los avisos con la app cerrada salen por osascript" >&2
(cd "$chat" && npm run build --silent >/dev/null)
cd "$chat" && npx tauri build --bundles app
