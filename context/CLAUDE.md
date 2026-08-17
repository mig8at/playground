# context — protocolo de curación del árbol

Qué es el árbol y cómo se lee: `README.md` + `docs/ROUTE-MAP.md`. Acá solo el protocolo.

## La vara es `main`. Lo que no está en main, se marca

Este árbol describe **lo que corre**, no lo que se está construyendo. Un nodo que documenta una rama sin
mergear es peor que un nodo faltante: se lee como verdad.

- **Verificá contra `main`**, no contra el working tree. Ante la duda: `git cat-file -e main:<relpath>`.
- El encabezado de cada nodo dice **contra qué se validó, cuándo y con qué método**. Si lo tocás,
  actualizá esa línea.
- Si hay que documentar algo que **todavía no está en main**, marcalo donde aparece:

  ```markdown
  > ⏳ **PENDIENTE DE MERGE** — esto vive en `feature/<rama>`, no en `main`.
  > Al mergear: re-verificar con el oráculo, actualizar y **borrar esta marca**.
  ```

  Inline y no en una lista aparte: se ve justo donde engaña, y todas se encuentran con
  `grep -rn "PENDIENTE DE MERGE" .`. **Después de cada merge, revisá esa lista** — y `alinear.py`
  también la chequea sola (señal 🔁).

- **Lo que es tarea no va acá.** Planes, decisiones pendientes, riesgos y preguntas abiertas viven en
  `tablero/data/<tarea>.md`. El test: *si esto se mergea mañana, ¿el texto sigue siendo cierto?* Si deja
  de tener sentido, es tarea. (Se coló dos veces en un mismo día: un plan completo y una sección de
  "restricciones del diseño pendiente".)

## Reglas de escritura de un nodo

Están codificadas en las plantillas (`server/data/doc-templates/`, leé el comentario de
`referencia.md`) y las vigila `tools/lint.py`. Las cinco que más costó aprender:

1. **El `when` se escribe ANTES que el doc.** Es la interfaz real: si no matchea el vocabulario con
   el que *llega* la tarea, el nodo no se abre nunca y nada de lo que escribas adentro existe.
2. **«Antes de concluir» va SEGUNDO, no al final.** Un modelo abre 2–4 nodos con una hipótesis ya
   formada, y lo primero que necesita es qué de esa hipótesis es falso. Se midió: ese bloque estaba
   llegando al **60–92 %** del documento en todos los nodos menos `creditop` —que lo pone al 8 % y es
   el que todos usan de ejemplo—, o sea después de toda la descripción, donde ya no cambia nada.
3. **Test del párrafo:** o cambia lo que un modelo haría en una tarea plausible, o previene un error
   que ya pasó (con su F-xx). Si ninguna de las dos, no va.
4. **Un hecho, una casa.** Si el hecho pertenece a otro nodo: `→ ver <nodo> § <sección>`, sin repetir.
   Lo que vive en el código (columnas, enums, códigos de error) no se copia: se apunta a la línea.
   Y marcá el estado de cada afirmación: lo **inferido** se declara inferido; leerse igual que lo
   verificado es como `servicing` llamó «stand-by» al estado 21 durante meses.
5. **Nada de estado-vivo contable** («hoy hay N…»): eso lo imprimen las tools. Un número-evidencia de
   una historia cerrada que sostiene una regla sí puede quedar. Y: **historia → git · preguntas →
   tablero · trampas con síntoma → findings.**

## Confluence: hay oro, y hay specs disfrazadas de descripciones

`python3 tools/confluence.py espacios | paginas <ESP> | leer <id> | buscar <texto>` (solo lectura;
credenciales en `.env`, gitignoreado). Ahí vive lo que el código **no** puede decir: por qué una regla
existe, qué se le ofrece al comercio cuando pide una configuración, qué significa un booleano.

**Nada de ahí entra al árbol sin pasar por el código.** Toda afirmación se clasifica:

- **confirmada** — el código coincide. Entra, y lo que aporta es el **porqué**, no el qué. El mejor caso
  real: `debt_capacity_amount_validation` es un booleano cuyo nombre sugiere lo contrario de lo que hace,
  y el documento lo explica porque es **una pregunta que se le hace al comercio**.
- **contradicha** — difieren. Son las más valiosas y hay que decir **las dos cosas**: `loan_limit` es
  «el monto a colocar mensualmente» y está implementado como un acumulado que nada reinicia (F-119).
- **no verificable** — política pura, sin huella en el código. Se marca como tal o no se escribe.

⚠ **El espacio mezcla RUNBOOKS y PRDs, y se leen igual.** Las señas de un PRD: «objetivos», «fuera de
alcance», «historias de usuario», proyecciones de revenue — pero **la que decide es el grep**: hay un
«Modelo de Cobro de Gastos en Cartera en Mora» con modelo de datos completo de una feature que no
existe en ningún repo. ⚠ Y **un documento viejo es indistinguible de uno equivocado**: si el código y
el documento difieren y `git log` no dice cuál cambió, la contradicción se escribe como contradicción.

## El MCP está retirado — no lo reconstruyas

El server Go, el WebSocket, el conector stdio y el sistema de "derivar" se borraron a propósito
(`471d5a4` → `50f689e`). Hoy esto es un mapa **estático** + scripts Python.

- `server/` **no tiene código**: sobrevive como carpeta de datos (`server/data/flows/`). No muevas
  esos directorios — toda ruta citada en los docs apunta ahí.
- `src/App.vue` (la viz) es **read-only**: lee `tree.json`, `flows/*` y `alineacion.json` por
  `import.meta.glob`. No le agregues backend, WS ni botones de guardar. **Si necesitás mostrar algo
  que la viz no puede calcular** (git, la BD): que un **comando** lo calcule y deje un JSON que la viz
  lee por el mismo glob — así se hizo la alineación.

## El oráculo y el ROUTE-MAP corren SOLOS (hooks)

Al escribir cualquier `map.json` del árbol, un hook valida las rutas y regenera el `ROUTE-MAP.md`; al
escribir `tree.json`, regenera el mapa (registrar un nodo sin regenerar lo dejaba invisible — así quedó
`microservicios` afuera sin que nada avisara). `.claude/hooks/oraculo.py` · registrado en
`.claude/settings.json`. Y `ROUTE-MAP.md` / `tools/index.txt` / `alineacion.json` **no se editan a
mano**: otro hook lo bloquea, porque son generados.

**El oráculo valida contra `main`** (vía `git ls-tree`, read-only, sin fetch ni checkout), no contra lo
que tengas checkeado. Eso tapa el error grave, que no es el falso DROP sino el **falso OK**: con otra
rama puesta, una ruta que solo existe ahí resolvía perfecto mientras el nodo afirmaba describir `main` —
así entró la deriva de `motai`.

```bash
python3 tools/oracle.py <map.json>              # contra main (default)
python3 tools/oracle.py <map.json> --ref qa     # contra otro ref
python3 tools/oracle.py <map.json> --worktree   # contra el índice: lo que está checkeado
```

Exit: `0` limpio · `1` hay DROPs · `2` algún repo no se pudo consultar (sale como **`SIN VERIFICAR`** y
**no cuenta como OK** — callarlo sería inventar un verde).

Cuando dropea una ruta, tu criterio:

- **`.md`, `.sql` y `.yaml` SIEMPRE dropean**: solo se indexan extensiones de código (`tools/roots.py`).
  No van en `files[]` — mencionalos en el `doc.md`.
- **Si el archivo existe pero en otra rama**, es contexto sin mergear: sacalo de `files[]` y marcá la
  sección con `⏳ PENDIENTE DE MERGE`.

⚠ `ROOTS`/`EXTS` viven en **`tools/roots.py`**, importado por los demás scripts. Estuvo duplicado y se
desincronizó: un repo agregado en un solo lado da un veredicto equivocado sin fallar en ningún lado.

## El sello `verified`: para saber si un nodo quedó VIEJO

El oráculo contesta *¿el archivo existe?*. La otra pregunta —*¿sigue diciendo lo mismo que cuando
escribí el nodo?*— necesita una fecha legible por máquina, y por eso cada `map.json` lleva:

```json
"verified": { "ref": "main", "date": "2026-07-31", "source": "cabecera" }
```

`source` dice **cómo** se obtuvo la fecha, y evita tratar una estimación como un hecho: `cabecera`
(alguien la escribió al verificar) · `git-doc` (**estimada**: último commit del `doc.md`; es un piso) ·
`manual` (la puso el comando al sellar). Con eso la deriva se calcula con git y ve lo que el oráculo no
puede: un nodo con todas las rutas resolviendo puede describir código que cambió por debajo.

**Al re-verificar un nodo, sellalo:** `python3 tools/sellar-verificado.py <nodo>`. Si no, el nodo queda
contando una deriva que ya arreglaste.

### Cómo se re-verifica un nodo (el método, antes de sellar)

El árbol afirma; re-verificar es intentar **refutarlo** contra el código. Una afirmación no auditada no
es una afirmación confirmada. El método, destilado de las veces que falló:

1. **Extraé del doc las afirmaciones verificables** — las que, si fueran falsas, cambiarían lo que un
   modelo hace. La prosa conectiva no se audita.
2. **Clasificá antes de verificar:** **CÓDIGO** (se decide leyendo `main` — se verifica acá) · **DATO**
   (habla de la BD o de prod: conteos, umbrales — **no lo leas: medilo**, `make trazador-sql` /
   `make agente-datos`) · **HISTORIA** (algo que pasó, con fecha — no se re-verifica; sólo marcá si el
   texto lo presenta como estado actual siendo viejo).
3. **Verificá el SIGNIFICADO, no el ancla.** ⚠ La lección que originó este método: una cita
   `archivo:línea` puede apuntar a una línea que existe, con el texto esperado — y ser de OTRA función
   que no hace lo que el doc dice (pasó con un «sello rt=2» que era un stamp post-listado). Leé la
   función alrededor. Un número corrido ≤3 líneas no es un hallazgo; la función equivocada, sí.
4. **Contra `main`, con git** (`git -C <repo> show main:<relpath>`), nunca el working tree — los repos
   viven en ramas. Las secciones `⏳ PENDIENTE DE MERGE` se verifican contra la rama que la marca
   nombra; si sus archivos ya están en `main`, eso es «marca ya mergeada» y vale oro.
5. **Al contar confirmadas, separá chequeo fuerte** (leíste la función y hace lo que el doc dice) **de
   débil** (sólo viste que el símbolo existe). Un ok débil declarado fuerte es la mentira que este
   árbol ya sufrió una vez. De ese conteo depende si el nodo se sella.

## `refs.py`: ¿las citas `archivo:línea` siguen apuntando a lo que dicen?

```bash
python3 tools/refs.py            # todos los nodos
python3 tools/refs.py <nodo>     # uno solo
```

Las citas `archivo:línea` son lo que se rompe **en silencio**: un refactor mueve una función 30 líneas
y la cita queda señalando otra cosa. El oráculo no lo ve (el archivo existe) y `alinear.py` tampoco
(solo dice que cambió).

**Cómo lo sabe: el ancla de git, no el símbolo de la prosa.** Para cada cita busca *cuándo se afirmó*
(max entre el sello del nodo y el `git blame` de esa línea del doc), abre el archivo citado en `main`
**a esa fecha**, guarda el texto de la línea y lo busca en `main` hoy. Si está en otra línea, **dice
cuál**. No marca: corrige. Sigue renombres.

⚠ La lección que dejó construirlo: una versión anterior buscaba el símbolo con una regex que nunca
matcheaba, y **todos sus «ok» eran del chequeo débil** («el archivo tiene al menos N líneas») — una cita
corrida seis líneas pasó en verde y con ella se selló un nodo. Si volvés a tocar esto: **medí cuántos
«ok» son del chequeo fuerte**, no cuántos son «ok». Los baldes débiles se declaran (`sin ancla`).

Baldes: `ok` · `corrida` (≤3 líneas, no falla) · **`movida`** (apunta a otra parte, con la corrección) ·
`reescrita` · `fuera` · `sin ancla` · `ambigua` · `no existe`. ⚠ `ambigua`/`no existe` **no siempre son
deriva**: herramientas borradas, artefactos generados, repos fuera de los roots y **migraciones citadas
por nombre parcial** — Laravel las prefija con timestamp, así que citálas con el nombre completo.

## `alinear.py`: qué nodos quedaron viejos (corrélo DESPUÉS DE CADA MERGE)

```bash
python3 tools/alinear.py          # calcula, imprime y escribe alineacion.json
python3 tools/alinear.py --ver    # solo imprime
```

Tres señales: **⛔ rutas muertas** (el mapa miente) · **🔴🟡 deriva** (archivos tocados en `main`
después del sello) · **🔁 marca ya mergeada** (un `pending_merge` cuyos archivos ya están en `main`:
devolvé las rutas a `files[]`, re-verificá y borrá la marca).

⚠ **«Cambió» se mide con el diff NETO (`git diff <sello>..main`), no con `git log`** — log falló dos
veces en silencio (no imprime archivos en merges con `--name-only`, y con first-parent reporta
movimiento de ida y vuelta como deriva). El diff neto contesta la pregunta exacta: *¿este archivo es
distinto de cuando lo verifiqué?*

Cada nodo con deriva trae **cuántos commits entraron, qué dijeron y quién los firmó** — para decidir si
vale abrirlo y a quién preguntar. ⚠ El asunto dice la **intención**, no lo que pasó. Lo que decide es
el código:

```bash
make context-diff NODE=onboarding STAT=1   # cuánto cambió cada archivo
make context-diff NODE=onboarding          # el diff acumulado sello..main, para leer
```

⚠ **La deriva es una señal de PRIORIDAD, no un veredicto.** La primera revisión con esto encontró que
un 36% de archivos tocados se tradujo en UNA corrección: los hallazgos citan **comportamientos**, no
líneas. Un nodo que cita mecanismos aguanta mucho cambio; uno que cita `archivo:línea` se rompe con
cualquier refactor. Ordená por deriva, pero no concluyas que N archivos tocados son N errores.

**`pending_merge` va en el `map.json`, no solo en prosa** (el chequeo inverso necesita las rutas
estructuradas):

```json
"pending_merge": { "ref": "qa", "files": ["legacy-backend/…/AbacoStepResolver.php", "…"] }
```

⚠ `alineacion.json` es GENERADO y **se versiona a propósito**: su historia en git dice **cuánto
tiempo** lleva viejo un nodo, no solo que hoy lo está.

## Al CERRAR una tarea: ¿el árbol te llevó hasta la causa?

Es la única pregunta que hace que este árbol mejore solo, y son 10 minutos. Hacela **siempre**, aunque
la tarea haya salido bien — sobre todo si salió bien por `grep`.

**Si el árbol NO te ruteó** (fuiste directo al código, o abriste el nodo equivocado), tres arreglos:

1. **El archivo causa-raíz al `map.json` del nodo correcto, CON SU PORQUÉ en el `doc.md`.** Listarlo
   sin explicarlo no sirve — para eso `grep` es más rápido (`make context-salud` mide los mudos).
2. **La REGLA GENERAL a «Antes de concluir», no el caso.** «El export tiene un bug» se arregla y
   desaparece; «un filtro por rol con `when()` encadenados falla ABIERTO» sigue valiendo. Si la regla
   contradice una conclusión que parecía obvia, va también a los **invariantes** del nodo `creditop`.
3. **La frase con la que LLEGÓ el problema, a `sintomas[]` del `map.json`.** Es lo que arma la tabla
   «Entrá por el síntoma» del ROUTE-MAP.

**Y si el árbol SÍ te ruteó**, mirá si algo quedó desactualizado por lo que aprendiste: una cita
corrida, un `when` al que le faltó la seña que vos buscaste, un nodo para re-sellar.

Medí antes de decidir: `make context-salud` dice qué `when` no tiene señas, qué archivos están listados
y mudos, qué archivos-hub viven en demasiados nodos y qué `F-xx` quedó fuera del índice.

## Nodo nuevo: dos lugares, los dos a mano

1. `server/data/flows/<id>/map.json` (`name`, `kind`, `when`, `sintomas[]`, `files[]`) + `doc.md`
   desde las plantillas de `server/data/doc-templates/`.
2. **Registralo en `tree.json`** (`parent`). El hook regenera el mapa solo.

- El `kind` va en inglés (`root` · `reference` · `flujo` es la excepción ya acuñada) y vive en el
  `map.json`. Los campos `combination`/`group` (map.json) y `targets`/`baseline` (tree.json) están
  muertos: no los copies.
- El `when` va en el vocabulario con el que **llega** la tarea, no en el del código: sin embeddings,
  esa línea es lo único que rutea al modelo.

## Findings

Entrada nueva = `### F-NN` correlativo, con los 5 campos síntoma → causa raíz → evidencia → arreglo →
estado, **y su fila en el índice `## Índice · ¿con qué síntoma llegás?`** — eso es lo que la vuelve
encontrable: nadie lee el archivo entero. La causa raíz va **verificada** o marcada `hipótesis, sin
confirmar`; si el síntoma engaña, decilo en el título. El protocolo completo (techo de líneas, stubs,
cuándo gradúa una crónica a `cerrados.md`) vive en la cabecera del propio archivo.

**El `F-xx` es un identificador público** citado desde código de tres herramientas (`harness/`,
`trazador/`, `tablero/`): no se renumera, no se muda de archivo, y `findings/doc.md` no se parte —
**el ancla `### F-xx` tiene que seguir resolviendo siempre**. Al graduar el hecho a un nodo, el
cuerpo se colapsa a stub ese mismo día; la crónica queda en git y en `cerrados.md`.
