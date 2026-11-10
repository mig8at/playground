#!/bin/sh
# El servidor del chat como servicio del Mac (LaunchAgent): arranca con la sesión y se levanta solo si se cae, así el
# historial (server/history.go) junta los mensajes y baja las imágenes aunque no esté abierto `make chat`.
#
#   sh scripts/service.sh install     compila el servidor a un lugar fijo, escribe el agente y lo arranca
#   sh scripts/service.sh refresh     recompila si cambió el código y lo reinicia (lo usa `make chat`)
#   sh scripts/service.sh status      ¿está corriendo? y las últimas líneas del registro
#   sh scripts/service.sh uninstall   lo saca (el historial en disco se queda)
#
# Sólo el servidor (:5185): la interfaz sigue siendo `make chat`, que usa este servidor si el servicio está puesto.
set -eu
label=com.creditop.playground.chat
chat=$(cd "$(dirname "$0")/.." && pwd -P)
root=$(cd "$chat/.." && pwd -P)
bin="${XDG_CACHE_HOME:-$HOME/.cache}/playground/chat-server"
plist="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/Library/Logs/creditop-playground-chat.log"
domain="gui/$(id -u)"

installed() { launchctl print "$domain/$label" >/dev/null 2>&1; }

build() {
  # El avisador de macOS (notifier/main.swift): sin él, los avisos con el chat cerrado pueden no verse.
  sh "$chat/scripts/notifier.sh" || echo "⚠ el avisador no compiló: los avisos salen por osascript" >&2
  mkdir -p "$(dirname "$bin")"
  tmp="$bin.$$"
  (cd "$root" && go build -o "$tmp" ./chat/server) && mv -f "$tmp" "$bin"
}

stale() {
  [ ! -x "$bin" ] && return 0
  [ -n "$(find "$chat/server" "$chat/cli" "$chat/notifier" \( -name '*.go' -o -name '*.swift' \) -newer "$bin" 2>/dev/null | head -n 1)" ]
}

# El PATH del servicio: launchd arranca con uno mínimo y el servidor llama a `playground` (node) y a `claude`.
service_path() {
  p="$HOME/.local/bin"
  for tool in node playground claude go; do
    d=$(dirname "$(command -v "$tool" 2>/dev/null || echo /usr/bin/x)")
    case ":$p:" in *":$d:"*) ;; *) p="$p:$d" ;; esac
  done
  echo "$p:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
}

write_plist() {
  mkdir -p "$(dirname "$plist")" "$(dirname "$log")"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$bin</string><string>-serve</string><string>127.0.0.1:5185</string></array>
  <key>WorkingDirectory</key><string>$root</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(service_path)</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
</dict>
</plist>
EOF
}

case "${1:-status}" in
  install)
    build
    write_plist
    launchctl bootout "$domain/$label" 2>/dev/null || true
    # Si :5185 lo tiene otro servidor (un `make chat` viejo con `go run`), el servicio no podría arrancar.
    if lsof -nP -iTCP:5185 -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "⚠ el puerto 5185 está ocupado (¿un make chat abierto?): cerralo y volvé a correr install" >&2
      exit 1
    fi
    launchctl bootstrap "$domain" "$plist"
    sleep 2
    echo "✓ servidor del chat instalado como servicio ($label)"
    echo "  binario  $bin"
    echo "  registro $log"
    ;;
  refresh)
    installed || { echo "el servicio no está instalado: sh scripts/service.sh install" >&2; exit 1; }
    if stale; then
      build
      launchctl kickstart -k "$domain/$label"
      echo "chat · servicio recompilado y reiniciado"
    fi
    ;;
  status)
    if installed; then
      echo "✓ instalado · $(launchctl print "$domain/$label" | awk '/state =/{print $3; exit}')"
      tail -n 5 "$log" 2>/dev/null || true
    else
      echo "✗ no instalado (sh scripts/service.sh install)"
    fi
    ;;
  uninstall)
    launchctl bootout "$domain/$label" 2>/dev/null || true
    rm -f "$plist"
    echo "✓ servicio quitado (el historial sigue en ~/Library/Application Support/creditop-playground-chat)"
    ;;
  *) echo "uso: sh scripts/service.sh install|refresh|status|uninstall" >&2; exit 2 ;;
esac
