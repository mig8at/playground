# context — protocolo de curación del árbol

Qué es el árbol y cómo se lee: `README.md` + `docs/ROUTE-MAP.md`. Acá solo el protocolo.

## La vara es `main`. Lo que no está en main, se marca

Este árbol describe **lo que corre**, no lo que se está construyendo. Un nodo que documenta una rama sin
mergear es peor que un nodo faltante: se lee como verdad.

- **Verificá contra `main`**, no contra el working tree. El índice del oráculo es un snapshot del working
  tree, así que con una rama feature checkeada puede dar por buena una ruta que en main no existe (y al
  revés, dropear una viva). Ante la duda: `git cat-file -e main:<relpath>`.
- El encabezado de cada nodo dice **contra qué se validó y cuándo**. Si lo tocás, actualizá esa línea.
- Si hay que documentar algo que **todavía no está en main**, marcalo donde aparece:

  ```markdown
  > ⏳ **PENDIENTE DE MERGE** — esto vive en `feature/<rama>`, no en `main`.
  > Al mergear: re-verificar con el oráculo, actualizar y **borrar esta marca**.
  ```

  Inline y no en una lista aparte: se ve justo donde engaña, y todas se encuentran con
  `grep -rn "PENDIENTE DE MERGE" .`. **Después de cada merge, revisá esa lista**: lo que entró actualiza
  el contexto, y así el árbol siempre describe lo que de verdad está corriendo.

- **Lo que es tarea no va acá.** Planes, decisiones pendientes, riesgos y preguntas abiertas viven en
  `tablero/data/<tarea>.md`. El test: *si esto se mergea mañana, ¿el texto sigue siendo cierto?* Si deja
  de tener sentido, es tarea. (Ya pasó dos veces en un mismo día: se coló un plan completo y una sección
  de "restricciones del diseño pendiente".)

## El MCP está retirado — no lo reconstruyas

El server Go, el WebSocket, el conector stdio y el sistema de "derivar" se borraron a propósito
(`471d5a4` → `50f689e`). Hoy esto es un mapa **estático** + 3 scripts Python.

- `server/` **no tiene código**: sobrevive como carpeta de datos (`server/data/flows/`). No muevas
  esos 31 directorios — toda ruta citada en los docs apunta ahí.
- `src/App.vue` (`npm run dev` → Vite :5193) es una viz **read-only** que lee `tree.json` y
  `flows/*` por `import.meta.glob`. No le agregues backend, WS ni botones de crear/derivar/guardar.

## El oráculo y el ROUTE-MAP corren SOLOS (hooks)

No hay que acordarse de nada: al escribir cualquier `map.json` del árbol, un hook regenera el índice,
valida que las rutas citadas existan y rehace el `ROUTE-MAP.md` (~0,3 s). Si algo no resuelve, te lo
devuelve como error con la lista. `.claude/hooks/oraculo.py` · registrado en `.claude/settings.json`.
Y `ROUTE-MAP.md` / `tools/index.txt` **no se pueden editar a mano**: otro hook lo bloquea, porque son
generados y el cambio se perdería en la próxima regeneración.

Lo único que sigue siendo tu criterio cuando el hook dropea una ruta:

- **`.md`, `.sql` y `.yaml` SIEMPRE dropean**: el índice solo mira
  `.php .go .ts .tsx .js .jsx .mjs .cjs .vue` (`tools/build-index.py:15`). No van en `files[]` —
  mencionalos en el `doc.md`.
- **Si el archivo existe pero en otra rama**, no es un error de tipeo: es contexto sin mergear. Sacalo
  de `files[]` y marcá la sección con `⏳ PENDIENTE DE MERGE` (arriba). Verificá con
  `git cat-file -e main:<relpath>` antes de decidir.

## Nodo nuevo: dos lugares, los dos a mano

1. `server/data/flows/<id>/map.json` (`name`, `kind`, `when`, `files[]`) + `doc.md` armado desde
   `server/data/doc-templates/` (raiz · group · contexto · referencia · flujo · tarea).
2. **Registralo en `tree.json`** (`parent`, y `contexts[]` si es task). Sin esa entrada el nodo es
   invisible para ROUTE-MAP y para la viz aunque el directorio exista.

- El `kind` del `map.json` gana sobre lo que se infiera de `tree.json`. No copies
  `combination`/`group` (map.json) ni `targets`/`baseline` (tree.json): restos muertos del Go.
- El `when` va en el vocabulario con el que **llega** la tarea, no en el del código: sin embeddings,
  esa línea es lo único que rutea al modelo.

## Findings

Entrada nueva = `### F-NN` correlativo **al final de su sección temática** (A–L; letra nueva si el
tema no existe), con los 5 campos síntoma → causa raíz → evidencia → arreglo → estado. La causa raíz
va **verificada** o marcada `hipótesis, sin confirmar`; si el síntoma engaña, decilo en el título.
