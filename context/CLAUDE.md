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
- `src/App.vue` (`npm run dev` → Vite :5193) es una viz **read-only** que lee `tree.json`,
  `flows/*` y `alineacion.json` por `import.meta.glob`. No le agregues backend, WS ni botones de
  crear/derivar/guardar.
- **Si necesitás mostrar algo que la viz no puede calcular** (git, la BD, cualquier cosa fuera del
  repo): que un **comando** lo calcule y deje un JSON, y la viz lo lee. Así se hizo la alineación —
  el browser no puede correr git, y levantar un server para eso es reconstruir lo que se borró.
  El `import.meta.glob` del JSON va con glob y no con `import` directo a propósito: si el archivo no
  existe todavía, la viz sigue andando sin esa capa en vez de romperse.

## El oráculo y el ROUTE-MAP corren SOLOS (hooks)

No hay que acordarse de nada: al escribir cualquier `map.json` del árbol, un hook regenera el índice,
valida que las rutas citadas existan y rehace el `ROUTE-MAP.md` (~0,3 s). Si algo no resuelve, te lo
devuelve como error con la lista. `.claude/hooks/oraculo.py` · registrado en `.claude/settings.json`.
Y `ROUTE-MAP.md` / `tools/index.txt` **no se pueden editar a mano**: otro hook lo bloquea, porque son
generados y el cambio se perdería en la próxima regeneración.

**El oráculo valida contra `main`, no contra lo que tengas checkeado.** Usa `git ls-tree`, que es
**read-only**: no hace checkout, no hace fetch, no mueve el HEAD de nadie (~0,13 s en los 6 roots). Eso
tapa el error grave, que no es el falso DROP sino el **falso OK**: con `qa` puesta, una ruta que solo
existe en `qa` resolvía perfecto y el oráculo decía «todo bien» mientras el nodo afirmaba describir
`main`. **Así entró la deriva de `motai`.**

```bash
python3 tools/oracle.py <map.json>              # contra main (default)
python3 tools/oracle.py <map.json> --ref qa     # contra otro ref
python3 tools/oracle.py <map.json> --worktree   # contra el índice: lo que está checkeado
```

Exit: `0` limpio · `1` hay DROPs · `2` algún repo no se pudo consultar. Ese `2` importa: las rutas de un
root ilegible salen en un bloque **`SIN VERIFICAR`** y **no cuentan como OK** — callarlas sería inventar
un verde. Y si el ref local tiene más de 14 días, lo avisa (no hace fetch solo: tocar la red por debajo
no es su trabajo).

Lo único que sigue siendo tu criterio cuando dropea una ruta:

- **`.md`, `.sql` y `.yaml` SIEMPRE dropean**: solo se miran
  `.php .go .ts .tsx .js .jsx .mjs .cjs .vue` (`tools/roots.py`). No van en `files[]` — mencionalos en
  el `doc.md`.
- **Si el archivo existe pero en otra rama**, no es un error de tipeo: es contexto sin mergear. Sacalo
  de `files[]` y marcá la sección con `⏳ PENDIENTE DE MERGE` (arriba).

⚠ `ROOTS`/`EXTS` viven en **`tools/roots.py`**, importado por `build-index.py` y `oracle.py`. Tenerlo
dos veces era una divergencia esperando: un repo agregado en un solo lado hace que se valide contra un
universo distinto del que se indexa, y eso no falla — da un veredicto equivocado.

## El sello `verified`: para saber si un nodo quedó VIEJO

El oráculo contesta *¿el archivo existe?*. La otra pregunta —*¿sigue diciendo lo mismo que cuando
escribí el nodo?*— necesita una fecha legible por máquina, y por eso cada `map.json` lleva:

```json
"verified": { "ref": "main", "date": "2026-07-31", "source": "cabecera" }
```

`source` dice **cómo** se obtuvo la fecha, y es lo que evita tratar una estimación como un hecho:
`cabecera` (alguien la escribió al verificar) · `git-doc` (**estimada**: último commit del `doc.md`; es
un piso, no una verificación) · `manual` (la puso el comando al sellar). Hoy: **11 de cabecera, 20
estimados**.

Con eso, la deriva de contenido se calcula con git en ~1 s para los 31 nodos, y ya dice cosas que el
oráculo no puede ver: `findings` tiene **16 de 44** archivos tocados en `main` desde su verificación,
`harness` 8 de 44. Un nodo puede tener todas las rutas resolviendo y describir código que cambió por
debajo.

**Al re-verificar un nodo, sellalo:** `python3 tools/sellar-verificado.py <nodo>` (pone la fecha de hoy
y `source: manual`). Si no lo sellás, el nodo queda contando una deriva que ya arreglaste.

## `refs.py`: ¿las citas `archivo:línea` siguen apuntando a lo que dicen?

```bash
python3 tools/refs.py            # los 31 nodos, ~0,4 s
python3 tools/refs.py <nodo>     # uno solo
```

Hay **907** citas `archivo:línea` en 27 nodos, y son lo que se rompe **en silencio**: un refactor mueve
una función 30 líneas y la cita queda señalando otra cosa. El oráculo no lo ve (el archivo existe) y
`alinear.py` tampoco (solo dice que cambió).

**Cómo lo sabe: el ancla de git, no el símbolo de la prosa.** Para cada cita busca *cuándo se afirmó*
—`max(sello del nodo, `git blame` de esa línea del doc)`—, abre el archivo citado en `main` **a esa
fecha**, guarda el TEXTO de la línea, y lo busca en `main` hoy. Si está en otra línea, **dice cuál**.
No marca: corrige. Sigue renombres (`frontend-e2e/`→`harness/` no rompió ninguna cita).

⚠ **La versión que buscaba el símbolo en backticks nunca funcionó, y lo tapaba.** La cita va *dentro*
de backticks, así que la regex nunca cerraba par: de 889 «ok», **889 eran solo “el archivo tiene al
menos N líneas”** y cero comprobaban nada. Una cita corrida seis líneas pasó en verde y con ella se
selló un nodo. Si alguna vez volvés a tocar esto: **medí cuántos “ok” son del chequeo fuerte**, no
cuántos son “ok”.

Baldes, separados por lo que exigen: `ok` · **`corrida`** (≤3 líneas: el mismo bloque, el archivo ganó
algo arriba — no falla) · **`movida`** (apunta a otra parte, con la corrección) · `reescrita` (la línea
de entonces ya no está) · `fuera` · `sin ancla` (no se pudo verificar de verdad; chequeo débil, y se
declara) · `ambigua` · `no existe`.

⚠ **`ambigua` y `no existe` NO son deriva.** Hoy son 2 y 17, verificados: las herramientas Go
**borradas** (`backend-e2e`/`backend-mcp`), un **artefacto generado** (`.react-router/types/+routes.ts`),
un repo fuera de los roots (`creditop-woocommerce`) y **migraciones citadas por nombre parcial** —
Laravel las prefija con timestamp, así que `create_users_table.php` no matchea nada. Si escribís una
cita nueva de migración, poné el nombre completo.

**Estado al 2026-07-31: 804 ancladas exactas · 37 corridas ≤3 · 0 movidas · 47 sin ancla.** Ninguna
cita apunta a otra parte del archivo; lo que queda es juicio por nodo, no arreglo.

## `alinear.py`: qué nodos quedaron viejos (corrélo DESPUÉS DE CADA MERGE)

```bash
python3 tools/alinear.py          # calcula, imprime el informe y escribe alineacion.json
python3 tools/alinear.py --ver    # solo imprime
```

~4 s para los 31 nodos. Tres señales, y la tercera es la que antes no tenía dueño:

1. **⛔ rutas muertas** — `files[]` que no existen en `main`. El mapa está mintiendo.
2. **🔴🟡 deriva** — archivos que existen pero fueron **tocados en `main` después del sello**. Es lo que
   el oráculo no puede ver.
3. **🔁 marca ya mergeada** — un nodo con `pending_merge` cuyos archivos **ya están en `main`**. Esa es
   la regla "revisá las marcas después de cada merge", que hasta ahora dependía de que alguien se
   acordara. Cuando aparece: devolvé las rutas a `files[]`, re-verificá y **borrá la marca**.

Exit: `0` nada urgente · `1` hay rutas muertas o marcas ya mergeadas.

⚠ **«Cambió» se mide con el DIFF NETO (`git diff <sello>..main`), no con `git log`.** Dos intentos con
log fallaron, los dos en silencio: `--name-only` **no imprime archivos para los merges** (default de
git, y acá todo entra por PR) → 38 archivos sin contar y dos nodos 🟢 al día con deriva real; y
`--first-parent --diff-merges=first-parent` los muestra pero reporta el movimiento **a lo largo del
camino** → archivos que cambiaron en un merge y volvieron en otro salían como deriva con el diff
vacío. El diff neto contesta la pregunta exacta: *¿este archivo es distinto de cuando lo verifiqué?*

## Los commits atrasados y quién los hizo — para TRIAR, no para concluir

Cada nodo con deriva trae en `alineacion.json` (y en la viz) **cuántos commits entraron desde el sello,
qué dijeron y quién los firmó**. Sirve para dos cosas concretas: decidir si vale abrirlo —al revisar
`ecommerce` alcanzó con leer «feat/customer-revolving-credit-detail» para saber que ese cambio era de
CreditopX y no tocaba el nodo— y saber **a quién preguntarle**.

⚠ Y ahí se acaba: el asunto dice la **intención**, no lo que pasó. Un «fix typo» puede mover una
función 40 líneas y un «Staging (#749)» no dice nada. Va con `--no-merges` justamente por eso: el autor
de un merge es quien mergeó, no quien escribió.

**Lo que decide es el código:**

```bash
make context-diff NODE=onboarding STAT=1   # cuánto cambió cada archivo
make context-diff NODE=onboarding          # el diff completo, para leer
```

Es el **diff acumulado** `sello..main`, no `git log -p`: para re-contextualizar no importa el camino
—el mismo archivo tocado por tres commits aparecería tres veces— sino **antes contra ahora**. Existe
porque leerlo costaba reconstruir a mano el repo, el commit del sello y las rutas, y esa fricción es
exactamente la que hace que un nodo se selle sin leer (pasó con `ecommerce` el 2026-07-31).

⚠ **La deriva es una señal de PRIORIDAD, no un veredicto.** El primer nodo que se atacó con esto,
`findings`, marcaba **36 % (16 de 44)** y la revisión terminó en **una** corrección: una referencia
`pkg/asesor.ts:203` que hoy es `:236`. Los otros 15 archivos habían cambiado sin invalidar nada, porque
los hallazgos citan **comportamientos**, no números de línea. Un nodo que cita mecanismos aguanta mucho
cambio; uno que cita `archivo:línea` se rompe con cualquier refactor. Ordená por deriva, pero no
concluyas que un 36 % son 16 errores.

Y al revisar, ojo con los falsos positivos al chequear `archivo:línea`: en esa misma pasada aparecieron
tres "fuera de rango" que **no eran deriva** — un artefacto generado (`.react-router/types/+routes.ts`),
un hallazgo que declara ser de otra rama (`feature/motai-v2`) y un archivo de una herramienta ya borrada.

**`pending_merge` va en el `map.json`, no solo en prosa.** La marca del `doc.md` es para que la lea un
humano; el chequeo inverso necesita las rutas estructuradas:

```json
"pending_merge": { "ref": "qa", "files": ["legacy-backend/…/AbacoStepResolver.php", "…"] }
```

⚠ **`alineacion.json` es GENERADO** (el hook bloquea editarlo). Se versiona a propósito: su historia en
git dice **cuánto tiempo** lleva viejo un nodo, no solo que hoy lo está. Y la viz read-only lo puede
leer con el mismo `import.meta.glob` que usa para `tree.json` — sin server, que es lo que se borró.

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

Entrada nueva = `### F-NN` correlativo, con los 5 campos síntoma → causa raíz → evidencia → arreglo →
estado. La causa raíz va **verificada** o marcada `hipótesis, sin confirmar`; si el síntoma engaña,
decilo en el título.

**Y agregala al índice `## Índice · ¿con qué síntoma llegás?`**, bajo la pregunta que contesta. Eso es
lo que la vuelve encontrable: el archivo pesa ~58.000 tokens y nadie lo lee entero.

⚠ **Las letras A–O ya NO son temas, son historia — no intentes clasificar por ahí.** La regla decía «al
final de su sección temática» y en la práctica dejó de cumplirse: lo nuevo se appendea al final físico
del archivo, así que hoy la sección «O · El código de compra en caja» contiene el código de compra
(F-79…F-92) **y además** F-93…F-106, que son de datos, logs y estados. «L · Motai» tiene harness,
Cognito y ecommerce adentro. Y los números tampoco van en orden de archivo (F-73…F-77 están arriba de
todo). Se dejó así a propósito: reordenar 106 hallazgos rompería las citas `F-xx` que hacen
`harness/pkg/trace.ts`, `harness/pkg/cognito.ts`, `trazador/server/etapas.go` y `tablero/data/*.md`.
**El índice es el que clasifica; la letra sólo dice cuándo se escribió.**

Y por lo mismo: **no muevas hallazgos a otros nodos.** El `F-xx` es un identificador público citado
desde código de tres herramientas; que todos vivan en `findings/doc.md` es lo que hace que esas citas
se puedan resolver. Partir el archivo tampoco sale gratis hoy: `refs.py` sólo valida `doc.md`, el
ROUTE-MAP sólo lo nombra a él y la viz sólo hace glob de `*/doc.md` — habría que tocar las tres.
