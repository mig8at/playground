# CREDITOP · playground

Espacio propio de Miguel: organiza el conocimiento de **CreditOp** (fintech colombiana de originación
de crédito) y agrupa las herramientas de prueba. Existe para que un modelo entienda **antes** de atacar
una tarea.

## `make` es la puerta única

`make` sin argumentos lista todo lo que se puede correr, agrupado por para qué sirve. No hace falta
recordar en qué carpeta vive cada script — ni correr `make`: el hook `SessionStart`
(`.claude/hooks/herramientas.py`) inyecta ese catálogo al arrancar, al reanudar y **después de
compactar**. Por eso acá **no hay lista de comandos**: la que había era una copia a mano que quedaba
vieja (llegó a anunciar un target `qa` que no existe). Lo que va acá es lo que `make` no puede decir:
**cuál elegir, y contra qué ambiente**.

⚠ **Antes de decir «no tengo acceso a eso», mirá el catálogo.** Loki, Redash, las cuatro bases de
datos, PostHog y Confluence ya están cableados y con credenciales. El error caro no es no tener la
herramienta: es suponer que no está y contestar de memoria.

### Qué herramienta según qué estás preguntando

| Tu pregunta | Con qué se contesta |
|---|---|
| **no conozco el dominio, ¿por dónde empiezo?** | `workers/cli.py negocio` — los 23 conceptos en orden, con el nodo que explica cada uno |
| **¿cómo funciona X?** | `context/` — no es una herramienta: `docs/ROUTE-MAP.md` → nodo. **Siempre primero** |
| **¿ya nos pasó?** | `context/server/data/flows/findings/doc.md`, entrando por su índice de síntomas |
| **¿por qué existe esta regla?** (política, contrato, qué se le ofreció al comercio) | `make confluence` — el porqué del negocio no está en el código |
| **…y si `context/` no lo cubre** | `workers/` — el índice se deriva de `main`, así que cubre TODO el código, incluido lo que nadie escribió (ver abajo) |
| **¿qué archivos toco para esto?** | `workers/cli.py buscar "…"` — describís en palabras, te da archivos con el porqué |
| **¿cómo está construido este repo?** | `workers/cli.py repos <alias>` · `subramas` · `mapa` — entra POR REPO, no por síntoma |
| **¿por qué este comercio/lender se porta distinto?** | `workers/cli.py quemado` — los lugares donde el código decide por IDENTIDAD y no por config, con cada id resuelto a su nombre. ⚠ indexado por (columna, id): `24` es Credifamilia como lender y *Creditop* como comercio |
| **¿con qué se une esta tabla?** · **¿qué tablas toco para X?** | `workers/cli.py relaciones` — las 247 en 13 vecindarios. ⚠ el esquema declara **44** FK: las otras 388 relaciones están reconstruidas y cada una dice de dónde salió |
| **¿quién llama a esto?** · **¿difieren los dos monolitos?** | herramientas de los agentes (`quien_usa`, `gemelos`); a mano, `workers/cli.py gemelos` |
| **hay MUCHO código que leer para contestar** | `make agente-analisis PREGUNTA='…'` — plan → N buscadores → lector de 300k. La receta: `workers/README.md` §«Cómo se orquesta» |
| **¿esto pasa de verdad, y cuánto?** | `make trazador-sql` contra **prod**. Es la única forma de contestarlo. Con agente: `make agente-datos TARGET=prod` |
| **¿qué le pasó a ESTA solicitud?** | `make harness-loki UREQ=…` · `make trazador-acceso` |
| **leí un error, ¿de qué archivo salió?** | `workers/cli.py logs "<mensaje>"` — el mapa va del mensaje al archivo y su línea. Para una corrida entera, la herramienta `archivos_de_la_traza` del agente que mide |
| **¿qué VIO el cliente en pantalla?** | `make trazador-posthog` |
| **¿funciona, corriéndolo?** | `harness` (`make panel`) — se comprueba corriendo, no leyendo |
| **¿en qué anda el equipo?** | Slack (MCP) · `make cuadrilla` · `make tablero` |

⚠ **El silencio de `context/` NO es «no existe».** El árbol sólo sabe lo que alguien escribió, y su
hueco se lee igual que una ausencia real. Medido el 2026-08-16: dos funcionalidades mergeadas —el
endpoint de regeneración de Credifamilia (13/8) y el flag `can_check_preapproval` (10/8)— no estaban
en ningún nodo. **Cuando el árbol no diga nada de algo que debería existir, no concluyas: preguntale
a `workers/`, que se deriva del código.**

Regla de oro: **una afirmación verificable se verifica antes de escribirla**, y la herramienta que la
verifica casi siempre existe ya. Y la salida de un agente **también se verifica** —contra `main`, con
`git show main:<ruta>`, nunca contra el working tree: los repos viven en ramas.

### Contra qué ambiente

Elegí **el más chico que conteste la pregunta**. Subir de ambiente agrega riesgo, no verdad.

| | qué es | regla |
|---|---|---|
| `local` | tuyo, Docker | ⚠ **`E2E_TARGET` por defecto es `dev`, NO `local`** — omitirlo pega contra el dev compartido |
| `dev` | rama `develop`, **compartido con el equipo** | leer libre; **escribir** pide `I_KNOW_THIS_TOUCHES_SHARED_DEV` a mano (F-53) |
| `staging` | rama `staging`, backend propio | ⚠ **comparte la BD con `dev`** (es la misma) y corre con `APP_ENV=development` |
| `prod` | lo real | **SOLO LECTURA, siempre.** Las herramientas del trazador no escriben en ningún ambiente |

⚠ Y no asumas que el código está en los cuatro: **`Modules/Backoffice` existe sólo en `main`** — no
está en `develop` ni en `staging`, así que `/api/backoffice` da 404 en dev y en staging **y no es un
bug**. Antes de depurar un 404 de un módulo nuevo: `git -C <repo> ls-tree -r --name-only <rama> <ruta>`.

El detalle de cada `.env.<target>`, la partición de credenciales y por qué los permisos no van en
archivo: §«Variables de entorno», al final.

Convención: los **nombres propios** se quedan (`context`, `tablero`, `harness` son carpetas; `panel`
es la UI del harness) y los **verbos** van en inglés (`align`, `refs`, `seal`, `check`), como
`proyecto-verbo`.

## EL CICLO — acá siempre pasa lo mismo

Se viene a resolver **tareas** sobre CreditOp con cuatro piezas — **tablero** (la tarea), **context**
(el conocimiento curado), **workers** (el índice derivado del código, para lo que el conocimiento aún
no cubre) y **harness** (la prueba) — y el circuito es fijo:

1. **La TAREA vive en `tablero/data/<tarea>.md`** (una tarea = un archivo): en qué se trabaja, por
   qué y para qué — estado, decisiones, riesgos, preguntas abiertas.
2. **El CONTEXTO se lee ANTES de investigar.** `context/docs/ROUTE-MAP.md` es el índice (generado,
   validado contra `main`); abrí los que matcheen: `context/server/data/flows/<id>/doc.md` (el
   análisis) + `map.json` (las rutas fuente exactas). El código real vive **fuera**, en
   `~/Desktop/CREDITOP/github/` (`legacy-backend`, `frontend-monorepo`, `legacy-application`,
   `pre-approvals-service`) — grandes: entrar por grep sin mapa es la forma lenta.
3. **Lo que se descubre SE REGISTRA, con dos destinos.** El test: *si esto se mergea mañana, ¿el
   texto sigue siendo cierto?*
   - hallazgos **de la tarea** (avance, decisiones, riesgos, preguntas) → su `.md` del tablero;
   - trampas **del sistema**, verificadas (síntoma → causa raíz → evidencia → arreglo) →
     `context/server/data/flows/findings/doc.md` (F-01…). **Mirala antes de depurar un muro**: si
     ya nos pasó, está ahí.
4. **Probar de verdad es `harness/`** (panel, runners, mocks): se comprueba **corriendo**, no
   leyendo. Una afirmación que se puede verificar ahí se verifica **antes** de escribirla como cierta.
   ⚠ **Y en local/dev/staging las centrales de riesgo NO las atiende el proveedor**, sino un lambda de
   mocks de la empresa (`Creditop-SAS/risk-services-mockery-lambda`, un Mockoon; no está entre los
   repos de arriba). Se le puede **dictar la respuesta por cédula** — la receta, con sus trampas, en
   `tablero/data/mocks-de-centrales-un-solo-mecanismo.md`. Sin saber esto, una prueba de identidad ahí
   siempre devuelve la misma persona y parece que el código está roto.
5. **Al mergear, GRADÚA:** lo mergeado deja de ser tarea y pasa al nodo de contexto — ahí es "cómo
   funciona CreditOp". La tarea se marca `archived` en su frontmatter. Ejemplo hecho: la omisión de
   Experian por cupo ya confirmado vive hoy en el nodo `kyc`.

### Y lo que mergea OTRO — el bucle para que el árbol no quede viejo

El paso 5 cubre lo que mergeás vos. Lo que mergea el resto del equipo entra sin que nadie lo escriba, y
el hueco no avisa. **El bucle, probado el 2026-08-16 y que encontró dos funcionalidades invisibles:**

1. `make context-align` — qué nodos quedaron viejos. Y `make context-diff NODE=x` — **qué cambió** en
   el código de uno. ⚠ Los dos aportan cosas distintas: Credifamilia salió de la deriva (un archivo
   repitiéndose en la de VARIOS nodos), y `can_check_preapproval` salió del diff de un nodo con deriva
   **baja**. Mirar sólo el ranking de deriva se pierde lo segundo.
2. Confirmá que el hueco es real: `git log main --oneline -- <ruta>` (cuándo entró y quién) + un grep
   en los `doc.md`. Si nadie lo menciona, ahí hay algo.
3. Preguntá. `make agente-analisis PREGUNTA='…'` si hay mucho que leer; a mano si son 3 archivos.
4. **Verificá contra `main`** lo que devuelva, y recién ahí escribilo en el nodo + su `map.json`.
   Validá con `python3 tools/oracle.py`, `make context-lint` y `tools/refs.py <nodo>`.
5. **NO sellés el nodo** por haber agregado una sección: sellar dice «lo revisé entero». El método de
   re-verificación completo está en `context/CLAUDE.md`.

⚠ **El resto de carpetas NO son herramientas para contextualizarte** — hoy: `flow`, `engine`,
`domain-model`, `diccionario`, `plantillas`, `cuadrilla`, `creditop-woocommerce`. Son exploraciones que Miguel armó para entender
él mismo el negocio: **no están validadas contra el código** y varias describen un *deber ser*, no lo
que corre en producción. **No las cites como fuente ni las uses para decidir.** Si algo de ahí resulta
cierto, se verifica contra el código y gradúa a `context/` — hasta entonces, no existe para tu tarea.

**Reglas de la partición** (para que no se vuelva a mezclar): el árbol de context **no** lleva
nodos-tarea. El enlace es **unidireccional** — la tarea apunta a nodos (`context_nodes`); el nodo
nunca apunta a tareas, porque quedaría mintiendo al graduar. Y del `.md` de una tarea **solo**
`jira_title` + la sección `## Tarea (publicable)` salen a Jira (pasan el guard); todo lo demás es
privado y puede nombrar repos, rutas y F-xx. El error de enrutar mal se comete por **fricción**, no
por no entender la regla — hoy los dos destinos cuestan lo mismo: un archivo markdown.

## El contexto se mide contra `main`, y lo que no está en main se marca

`context/` describe **lo que corre**, y la vara es `main`. Lo que todavía no mergeó se marca inline con
`⏳ PENDIENTE DE MERGE` justo donde engaña (`grep -rn "PENDIENTE DE MERGE" context/` las lista todas;
revisala después de cada merge). El protocolo completo de curación —la marca, los sellos, el oráculo,
qué hacer al cerrar una tarea— vive en **`context/CLAUDE.md`**.

## Git

- **Este repo** (`playground`) se commitea local. El push lo decide Miguel — no pushees por tu cuenta.
- **Los repos reales** (`legacy-backend`, `frontend-monorepo`, `legacy-application`) trabajan en ramas y
  stashes locales. **No armes PRs ni pushees ahí sin pedir permiso explícito.**

## Entorno local

- Hay una **copia local de la BD** en Docker: contenedor `legacy-backend-mysql-1`, schema `creditop`.
  Usala para verificar contra datos reales en vez de suponer.
- **`E2E_TARGET` por defecto es `dev`**, no `local` (`harness/pkg/db.ts:12`). Cualquier consulta o
  script que lo omita pega contra el **dev compartido**. Para local, exportalo:
  `E2E_TARGET=local`. (`dev/sweep.ts:34` ya lo fuerza; el panel setea
  `I_KNOW_THIS_TOUCHES_SHARED_DEV` cuando el target es `dev`.)
- El harness del wizard se maneja desde el **panel**: `cd harness && npm run dev`. Los `bin/` son
  plumbing, no una segunda entrada.

## Trampas que ya costaron tiempo

- En `user_requests`, el estado de la solicitud es **`user_request_status_id`**, no `status`. Mirar la
  columna equivocada hace creer que una solicitud cancelada está sana (F-50).
- **El estado 11 es «Autorizada», y ES terminal**: medido en prod, de 10.182 solicitudes que lo
  tocaron en 90 días **3** avanzaron. El catálogo tiene estados posteriores (5 «Desembolsada», 20, 28,
  30) pero el desembolso y la cartera se llevan en otro lado. **No cuentes desembolsos con esa columna.**
- ⚠ **`make trazador-acceso` es una SONDA: te muestra una MUESTRA.** Con `-limit 200` trae 200 líneas
  e **imprime cuatro**, y las cuatro se ven idénticas a doscientas. Contarlas dio «46% de los errores
  son del profiler» cuando el número real era **9,2%**. Para contar, la expresión métrica:
  `QUERY='sum(count_over_time({service_name="x", level="error"} [24h]))'`.
- `playground/docs/` **fue borrada** de `main` (absorbida por `context/`). Toda ruta `docs/X.md` que veas
  citada es histórica: `git show 159906a:docs/<archivo>`.

## Dos reglas de honestidad

- Si tocaste rutas de un nodo, validá con `python3 context/tools/oracle.py <map.json>` — una ruta mal
  escrita no falla en ningún lado: la lee un modelo y abre un archivo inexistente.
- **Nunca afirmes como verificado algo que no comprobaste contra el código.** Si no lo miraste, decilo.

## Variables de entorno

Cada herramienta guarda su configuración por target en su propio **`.env.<target>`** (`local` · `dev` ·
`staging`), **autosuficiente**: ahí viven tanto los **hechos** del entorno (BD, API base, `APP_KEY`)
como las **perillas** (Cognito, mocks, `SEED`). Ya **no** hay capa compartida `env/` (se eliminó el
2026-07-22). Prioridad: `process.env` > `<herramienta>/.env.<target>`.

**Qué rama sirve cada target:** `local` → local · `dev` → **develop** · `staging` → **la rama
`staging`**. *(Acá decía «`staging` → qa». Está mal: se fueron sumando ambientes para poder probar,
pero **el real es `staging`** — corregido por Miguel el 2026-08-14. El workflow lo confirma:
`main-stg.yaml` dispara con push a `staging` y despliega el servicio `legacy-backend-stg`.)*

⚠ `staging` comparte la **BD con `dev`** — es la misma (`inertia-dev`), confirmado el 2026-08-15 por
el contador `AUTO_INCREMENT` de `user_requests`: una solicitud creada desde staging aparece ahí. Si
las credenciales rotan, actualizá las dos. Pero **NO comparten backend** — el detalle de los dos
servicios del cluster y cómo saber qué rama te respondió: `harness/CLAUDE.md` §«Qué es real en cada
target».

⚠ **`staging` corre con `APP_ENV=development`**, no `staging`. Se deduce de que el bypass de OTP de QA
funciona ahí y ese exige `local`/`development`. Importa más de lo que parece: **todas las condiciones
`app()->environment(['local','development'])` del código aplican en staging** — incluida la que apaga
la validación de nombre del KYC. Y al revés, un `config('app.env') === 'staging'` (hay uno en
`InitialFeePaymentService`) probablemente nunca dispara.

**Los permisos no van en archivo.** El flag `I_KNOW_THIS_TOUCHES_SHARED_DEV` **no** vive en ningún
`.env.*`: se exporta a mano en la shell cuando de verdad vas a escribir a la BD compartida de dev (el
panel lo inyecta solo para sus corridas). Meterlo en un archivo desarma la guarda (F-53).

`.env.*` está gitignoreado (trae secretos); las plantillas versionadas y documentadas son
`<herramienta>/.env.<target>.example`.
