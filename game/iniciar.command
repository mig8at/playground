#!/bin/zsh
# Abre FUGA en http://127.0.0.1:5180. Deja esta terminal abierta mientras lo usas.
cd "$(dirname "$0")" || exit 1
[ -d node_modules ] || npm install
(sleep 2 && open http://127.0.0.1:5180) &
npm run dev
