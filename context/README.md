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

Desde la raíz del playground también se levanta con `make context` en `http://localhost:5193`.
Un enlace `/?node=motai` selecciona el nodo exacto; `/?q=texto` inicia una búsqueda libre.
Los enlaces del tablero apuntan a esta vista local. Canon es el corpus compartido y se consulta aparte.

La interfaz no lista ramas: Context usa la alineación del nodo contra `main` como señal operativa.
Los estados de deriva, rutas muertas o pendiente de merge dicen qué documento requiere atención sin
mezclar el diagnóstico Git global con el contenido curado.

Al abrir un nodo, el sidebar derecho lista los archivos declarados en su `map.json`, agrupados por
repositorio y con filtro local. Así la prosa responde *qué entender* y la referencia lateral responde
*qué abrir*.

**El buscador de la viz muestra la VECINDAD, no una lista.** Busca en cuatro lados —el nombre, los
síntomas, los archivos declarados y el cuerpo del `doc.md`— y dice en cuál pegó. El árbol se recorta a
lo encontrado (con aro), **las conexiones más cercanas del nodo abierto** (más apagadas) y los
ancestros que hacen falta para que siga siendo un árbol (apenas visibles): 8 filas de 39 para
«rotativo» en vez de las 39.

Y las conexiones no están escritas en ningún lado: **se derivan de los archivos que dos nodos
declaran** (`map.json`), más el árbol y las tasks. El panel las lista con el motivo —«Credifamilia · 4
archivos», «Onboarding · padre»— y son clicables.

⚠ Dos cosas medidas que explican por qué está así:

- **el texto del doc NO pesa igual que el nombre.** Con todo al mismo nivel, «rotativo» daba 17
  resultados de 39 (medido el 2026-09-09): los docs se nombran entre sí todo el tiempo. <!-- lint:ok --> Si pega el nombre, un síntoma o un
  archivo declarado, ese nodo es la respuesta; el que sólo lo nombra en la prosa queda a un clic
  («+ N que lo mencionan») con la cuenta a la vista. Una búsqueda libre como «403», que nadie declara,
  pasa sola al modo mención.
- **la vecindad es del nodo ABIERTO, no de la unión de los resultados.** Medido el 2026-09-09:
  «deceval» pegaba en 5 nodos y la unión de sus vecindades daba 20 de 39 <!-- lint:ok --> — otra vez
  «está en todo el árbol». Se muestra la del que estás
  mirando, y seguirla es hacer clic en otro resultado.

**Mantenimiento** — los hooks corren solos al escribir `map.json` o `tree.json`; a mano:

```bash
python3 tools/oracle.py server/data/flows/<id>/map.json   # ¿las rutas resuelven contra main?
python3 tools/refs.py [nodo]                              # ¿las citas archivo:línea siguen bien?
python3 tools/alinear.py                                  # ¿qué nodos quedaron viejos? (tras cada merge)
python3 tools/build-route-map.py                          # regenera el índice
make context-salud                                        # ¿el árbol SIRVE para un LLM?
```

## Evaluar Jev en local

`make context-jev ARGS='route "pregunta"'` sugiere entradas por búsqueda local. Con `--live`
compara con Jev mediante su API; las decisiones quedan en reportes locales revisables. El protocolo,
los datos enviados, la preselección compacta y el modo experimental `make agente-analisis JEV=1`
están en [`docs/JEV.md`](docs/JEV.md).

En desarrollo, el mismo buscador muestra primero el resultado local y, después de **550 ms sin
teclear**, pide una sugerencia a Jev. La petición va al proceso local de Vite —nunca al navegador con
una clave— y es efímera: no crea un reporte en `.runs/jev`. Sólo se envían la pregunta y el catálogo
compacto de nodos (`name`, `when`, `sintomas`), no documentos, archivos ni datos de casos. El campo
detecta y bloquea patrones de cédulas, teléfonos, solicitudes, correos y credenciales; de todas
formas, no pegues datos sensibles. Si Jev no está configurado, la búsqueda local continúa normalmente.

La consola inferior `JEV` usa el mismo principio, pero para profundizar: `brief` prepara una ficha
general local del nodo; `scope` permite elegir hasta tres archivos ya declarados en el `map.json` y
mostrar una versión de `main`/`origin/main` limitada y redactada; sólo `guide` envía esa evidencia
acotada a Jev para que elija **qué revisar después**. No responde ni ejecuta código, y no guarda el
scope. El detalle del contrato y los comandos equivalentes están en [`docs/JEV.md`](docs/JEV.md).

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

## Las trampas del sistema (`F-xx`) — se mudaron

Las trampas del sistema (`F-xx`) **ya no viven acá**: se mudaron a
[`tablero/data/trampas/doc.md`](../tablero/data/trampas/doc.md) el 2026-09-21, porque su lector real
es el tablero. Eran la bitácora de trampas:
síntoma → causa raíz verificada → evidencia → arreglo. Se lee al revés de lo que uno espera:
**antes de depurar un muro, buscá tu síntoma en su índice** — buena parte de lo que parece un bug
del producto ya está diagnosticado ahí.

## Gotchas

- **`server/` no tiene código**: es la carpeta de datos que sobrevivió al MCP (retirado — el porqué
  y el «no lo reconstruyas» están en `CLAUDE.md`). **No muevas los directorios de `flows/`**: toda
  ruta citada en los docs apunta ahí.
- **`ROUTE-MAP.md`, `tools/index.txt`, `alineacion.json` y `ramas.json` son GENERADOS** — un hook bloquea
  editarlos a mano.
- **`kind` vive en el `map.json`** y gana sobre lo que se infiera de `tree.json`. Los campos
  `targets`/`baseline` (tree.json) y `combination`/`group` (map.json) están muertos: nadie los lee.
- **Las rutas `playground/docs/X.md` que veas citadas son históricas** (carpeta borrada el
  2026-07-17; se recupera con `git show 159906a:docs/<ruta>`). No las «arregles».
- La viz importa los `doc.md` crudos al bundle: el build avisa por el tamaño del chunk. Es esperado.
