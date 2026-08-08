# context — mapa de conocimiento cross-repo (CreditOp)

Un árbol de nodos curados que le dice a un LLM *qué leer* antes de tocar CreditOp: por cada tema, un
análisis en prosa (`doc.md`) y la lista exacta de archivos fuente que hay que abrir (`map.json`),
apuntando a los repos reales. No es un buscador ni un índice automático: es curación a mano,
**verificada contra el código**. Existe porque el conocimiento está partido en repos que no se
referencian entre sí, y ningún grep te dice *cuáles* archivos importan para tu tarea.

Los números vivos (cuántos nodos, cuántos archivos, qué está viejo) los imprimen las herramientas:
`make context-salud` y `make status`. El **protocolo de curación** (la vara `main`, sellos, marcas
`⏳ PENDIENTE DE MERGE`, findings, qué hacer al cerrar una tarea) vive en [`CLAUDE.md`](CLAUDE.md).

## Arranque rápido

**Si sos un LLM (el caso principal): no corras nada.** Abrí [`docs/ROUTE-MAP.md`](docs/ROUTE-MAP.md),
leé los `Cuándo:` de cada nodo, elegí dos a cuatro que matcheen la tarea, y abrí sus `doc.md` +
`map.json`. De ahí, el código real.

**Si sos humano y querés VER el árbol:**

```bash
cd context && npm install && npm run dev   # viz read-only (puerto: .claude/launch.json)
```

Lee `tree.json` + `flows/*/{map.json,doc.md}` + `alineacion.json` por `import.meta.glob` y los
renderiza. Editás un `doc.md` y se actualiza por HMR. No hay nada que guardar desde la UI.

**Mantenimiento** — los hooks corren solos al escribir `map.json` o `tree.json`; a mano:

```bash
python3 tools/oracle.py server/data/flows/<id>/map.json   # ¿las rutas resuelven contra main?
python3 tools/refs.py [nodo]                              # ¿las citas archivo:línea siguen bien?
python3 tools/alinear.py                                  # ¿qué nodos quedaron viejos? (tras cada merge)
python3 tools/build-route-map.py                          # regenera el índice
make context-salud                                        # ¿el árbol SIRVE para un LLM?
```

## El modelo

- **`tree.json`** = el wiring (qué nodo cuelga de cuál). **`ROUTE-MAP.md` es GENERADO**: el `Cuándo`
  se edita en el campo `when` del `map.json`, nunca en el mapa.
- **`flows/<id>/map.json`** = `name` · `kind` · `when` · `sintomas[]` · `files[]` · `verified`.
  **`doc.md`** = el análisis en prosa: el producto real; todo lo demás es andamiaje.
- El `when` está escrito en el vocabulario con el que *llega* una tarea, no en el del código: sin
  embeddings, esa línea es lo único que rutea al modelo.
- **El árbol NO lleva tareas** (partición del 2026-07-21): una tarea tiene estado, tiempo y Jira —
  vive en `tablero/data/`. Al mergear, lo aprendido **gradúa** al nodo que corresponda.
- **Nodo nuevo:** `flows/<id>/{map.json,doc.md}` desde las plantillas de
  [`server/data/doc-templates/`](server/data/doc-templates/) (las reglas de escritura están en el
  comentario de `referencia.md`) **+ registrarlo en `tree.json`** — sin esa entrada el nodo queda
  invisible para el mapa (el hook lo regenera solo).

## El nodo `findings` — buscá acá primero

[`server/data/flows/findings/doc.md`](server/data/flows/findings/doc.md) es la bitácora de trampas:
síntoma → causa raíz verificada → evidencia → arreglo. Se lee al revés de lo que uno espera:
**antes de depurar un muro, buscá tu síntoma en su índice** — buena parte de lo que parece un bug
del producto ya está diagnosticado ahí.

## Gotchas

- **`server/` no tiene código**: es la carpeta de datos que sobrevivió al MCP (retirado — el porqué
  y el «no lo reconstruyas» están en `CLAUDE.md`). **No muevas los directorios de `flows/`**: toda
  ruta citada en los docs apunta ahí.
- **`ROUTE-MAP.md`, `tools/index.txt` y `alineacion.json` son GENERADOS** — un hook bloquea
  editarlos a mano.
- **`kind` vive en el `map.json`** y gana sobre lo que se infiera de `tree.json`. Los campos
  `targets`/`baseline` (tree.json) y `combination`/`group` (map.json) están muertos: nadie los lee.
- **Las rutas `playground/docs/X.md` que veas citadas son históricas** (carpeta borrada el
  2026-07-17; se recupera con `git show 159906a:docs/<ruta>`). No las «arregles».
- La viz importa los `doc.md` crudos al bundle: el build avisa por el tamaño del chunk. Es esperado.
