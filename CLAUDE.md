# CREDITOP · playground

Espacio propio de Miguel: organiza el conocimiento de **CreditOp** (fintech colombiana de originación
de crédito) y agrupa las herramientas de prueba. Existe para que un modelo entienda **antes** de atacar
una tarea.

Este archivo lleva sólo lo que cambia una decisión en CUALQUIER tarea. Lo que sirve al tocar algo
concreto vive al lado de ese algo, y se lee ahí:

| al tocar… | leé |
|---|---|
| estilos o la forma de una UI (tema, regiones, separadores) | [`tools/ui/CLAUDE.md`](tools/ui/CLAUDE.md) |
| el diseño de una herramienta, o cómo se valida contra otra | [`tools/CLAUDE.md`](tools/CLAUDE.md) |
| una tarea del tablero, el cierre de sesión, Jira | [`tablero/CLAUDE.md`](tablero/CLAUDE.md) |
| el harness, o qué es real en cada ambiente | [`harness/CLAUDE.md`](harness/CLAUDE.md) |
| canon: leerlo, dictarle, ponerlo al día | el skill **`canon`** (`.claude/skills/canon/SKILL.md`) |

## `make` es la puerta única

`make` sin argumentos lista todo lo que se puede correr, agrupado por para qué sirve, con los
parámetros de cada uno. El hook `SessionStart` (`tablero/server/internal/hooks`) inyecta los NOMBRES al
arrancar, al reanudar y después de compactar, y con ellos el **mapa de canon**: sus temas por etapa del
crédito, desde una copia local del tablero que se revalida gratis (`make canon-mapa` da títulos y resúmenes).
⛔ Canon se LEE (`canon-search`, `canon-read`, `canon-mapa`); `/api/ask` es para credibot y herramientas
externas, no para trabajar desde acá — el hook `ask-guard` lo frena (calibrar canon: `I_AM_CALIBRATING_CANON=1`). Acá va lo que `make` no puede decir: **cuál elegir, y
contra qué ambiente**. Convención de nombres: los nombres propios se quedan (`tablero`, `harness`,
`panel`) y los verbos van en inglés (`align`, `refs`, `seal`, `check`), como `proyecto-verbo`.

⚠ **Antes de decir «no tengo acceso a eso», mirá el catálogo.** Loki, Redash, las cuatro bases de
datos, PostHog, Confluence, Jira y Slack ya están cableados y con credenciales. El error caro no es no
tener la herramienta: es suponer que no está y contestar de memoria.

### Qué herramienta según qué estás preguntando

| Tu pregunta | Con qué se contesta |
|---|---|
| **no conozco el dominio** · **¿cómo funciona X?** | **canon, siempre primero**: `make canon-search Q='…'` con palabras del negocio (gratis) → `make canon-read IDS=…`, el tema entero. Y está copiado en disco, al día con su `ETag`: `grep -rn '…' tablero/canon/content` y leer `<tema>/context.md` y su `map.json`, sin VPN (no se edita) |
| **retomo una tarea del tablero** | `make retomar N=… BRIEF=1`: la tarea ya declara sus temas en `canon:` y la ficha de cada uno alcanza para decidir cuál abrir. `CANON=1` trae ya las secciones enteras de esos temas que el título y el resumen de la tarea encuentran (sin modelo), y avisa si declara un tema que canon no tiene. Si la ficha no contesta, no probés otro tema: la pregunta va al código de `main` |
| **¿ya nos pasó?** | `tablero/data/traps/doc.md`, entrando por su índice de síntomas |
| **¿por qué existe esta regla?** (política, contrato, qué se le ofreció al comercio) | `make confluence`: el porqué del negocio no está en el código |
| **canon no lo cubre** · **¿qué archivos toco?** | el código de `main` con `git grep` contra la rama, nunca el working tree. La ref de cada repo: `go run ./cmd/repos ref <alias>` desde `tablero/server`. **En los dos monolitos**, o la afirmación sale falsa con evidencia real. Para verificar una afirmación, delegala al subagente **`main-verifier`**: mira los dos, sin tocar nada, y devuelve veredicto con archivo:línea |
| **¿esto pasa de verdad, y cuánto?** | `make trazador-sql` contra **prod** |
| **¿qué le pasó a ESTA solicitud?** | `make trazador-ureq UREQ=…` ancla en la BD y es la única que llega a **prod**; `make harness-loki UREQ=…` ancla en los logs, trae la regla de cada entidad y el `timeline.ndjson`, y **no mira prod**. ⚠ Sus defaults son opuestos (`local` vs `prod`): escribí `TARGET=` siempre (F-234). Con sólo la cédula o el celular, `make trazador-buscar Q=…` primero |
| **leí un error, ¿de qué archivo salió?** | `trazador/logs.json` (mensaje → archivo:línea); para una corrida entera, la sección «archivos» de `make trazador-ureq` |
| **¿qué VIO el cliente en pantalla?** | `make trazador-posthog UREQ=… TEL=…`. ⚠ Sin `TEL` ves la mitad: la fase de AUTH se identifica por teléfono |
| **Miguel pegó una URL de una pantalla o capa** · pasar un diseño a código | `make visor-url U='<lo que pegó>'`. ⚠ Lo que pega es el ANCLA: no salgas a buscar pantallas. `visor-buscar` sólo si nadie pegó nada |
| **¿qué entidades le salen a ESTE comercio?** | `make harness-listing MERCHANT=…` (3 s, por API). Canon explica la cascada; esto contesta el caso |
| **¿qué pasa si el cliente es así?** | `make harness-case CASES='…'`, en paralelo; `CLOSE=1` llega al desenlace |
| **¿esta regla excluye, o sólo reordena?** | corré el caso con y sin el dato. Una regla que «debería» excluir y no excluye es el error más caro del dominio (F-162) |
| **¿funciona, corriéndolo?** | por consola: `harness-case` (segundos) · `harness-walk-wizard` (HTTP, ~20 s) · `harness-walk-wizard ENGINE=browser` (Chromium, ~3 min). `make panel` es el camino visual de Miguel. El canal de asesor pide sesión: `make harness-session` / `make harness-login` |
| **¿en qué anda el equipo?** | Slack (MCP) · `make cuadrilla` · `make tablero` |
| **Jira o Slack** | `bin/pg jira …` · `bin/pg slack …`, o sus herramientas MCP. Leer es libre; lo que escribe **sin `--apply` sólo muestra** |

⚠ **Hay preguntas que no se contestan leyendo: se contestan corriendo.** Canon describe el mecanismo;
una corrida describe el caso. Y correr encuentra lo que leer no puede: de 12 hallazgos del 2026-08-23,
11 salieron de una corrida.

⚠ **El silencio de canon NO es «no existe».** El corpus sólo sabe lo que alguien escribió. Cuando no
diga nada de algo que debería existir, andá al código de `main`, que es lo que corre.

⚠ **Menos se lee igual que «no existe».** Una herramienta que lee de una fuente vieja o incompleta no
falla: devuelve menos. Ante un resultado tranquilizador, preguntá de qué está leyendo.

**Una afirmación verificable se verifica antes de escribirla**, y la medición no se escribe a mano: con
`BLOQUE=<tarea>` el trazador, el harness y `tablero-db` la agregan solos a la pila de la tarea, con el
comando y lo que dio. La salida de un agente también se verifica, contra `git show main:<ruta>`.

### Contra qué ambiente

Elegí **el más chico que conteste la pregunta**. Subir de ambiente agrega riesgo, no verdad.

| | qué es | regla |
|---|---|---|
| `local` | tuyo, Docker | ⚠ **`E2E_TARGET` por defecto es `dev`, NO `local`**: omitirlo pega contra el dev compartido |
| `dev` | rama `develop`, **compartido con el equipo** | leer libre; **escribir** pide `I_KNOW_THIS_TOUCHES_SHARED_DEV` a mano (F-53) |
| `staging` | rama `staging`, backend propio | **comparte la BD con `dev`**. Su `APP_ENV` está en disputa: no des por apagado nada ahí (`harness/CLAUDE.md`) |
| `prod` | lo real | **SOLO LECTURA, siempre** |

No asumas que el código está en los cuatro: un módulo nuevo puede faltar en `develop` o `staging`, y su
404 no ser un bug. Antes de depurarlo: `git -C <repo> ls-tree -r --name-only <rama> <ruta>`.

## ⛔ La suite de PHPUnit de `legacy-backend` NO se corre entera. Nunca, en ningún ambiente

**El 2026-08-19 la BD compartida de dev+staging quedó vacía.** `phpunit.xml` fija `DB_DATABASE=testing`
pero nunca `DB_HOST`, así que las pruebas se conectan al servidor que diga el `.env`, con credenciales
del usuario maestro del RDS; un test con `RefreshDatabase` corrió `migrate:fresh` ahí. Desde el PR
`Creditop-SAS/legacy-backend#1140` una **guarda** en `tests/CreatesApplication.php` aborta si el host no
es local o el schema no es `testing` (CORE-431). **Pero `make fresh` no pasa por esa guarda**, y apunta
a donde diga tu `.env`.

El hook `destructive-tests` (PreToolUse) frena lo de abajo en esta sesión; fuera de una sesión con
hooks, la regla es la misma. Para recrear de verdad tu base local: `I_KNOW_THIS_RECREATES_MY_LOCAL_DB=1`.

**Lo que NO se hace:**

- `make test` en `legacy-backend` (es `artisan test` pelado: corre todo)
- `make fresh` (es `migrate:fresh --seed --force`) ni `db:wipe`
- `artisan test` / `artisan migrate:fresh` sin ruta
- darle *Run* a un test desde el editor: PhpStorm y VS Code no siempre cargan `phpunit.xml`

**Lo que sí: correr SOLO lo que valida la tarea, con ruta explícita.**

    ./vendor/bin/sail artisan test <ruta/al/archivo o carpeta>
    ./vendor/bin/sail artisan test --filter=nombreDelTest <ruta>
    make test-onboarding                                            # ya viene acotado por rutas

**Antes de correr una carpeta, comprobá que no arrastra el trait**, que se activa de TRES formas: el
trait en la clase (`use RefreshDatabase;`), Pest por archivo (`uses(RefreshDatabase::class);`) y Pest
por DIRECTORIO (un `Pest.php` con `->in('Feature')`, que lo hereda cualquier archivo de la carpeta sin
decirlo; `Modules/UserRequestV1/tests/Pest.php` lo hace).

    grep -rlE '^\s*use RefreshDatabase;|uses\(.*RefreshDatabase::class' <ruta>
    ls <ruta>/Pest.php <ruta>/../Pest.php 2>/dev/null   # si hay, LEELO

⚠ Contra una RAMA, `git grep` **no entiende `\s`** y devuelve cero sin fallar: usá
`'^[[:space:]]*use RefreshDatabase;'`. Y grepear sólo `RefreshDatabase` da falsos positivos (imports,
comentarios): anclá el `use`.

**Si creés que hace falta correr algo destructivo, preguntá.** No alcanza con mirar el `.env`: también
cuentan el entorno de la shell y `DATABASE_URL`, que pisa a todos. La causa raíz, qué archivos
arrastraban el trait y la guarda: `tablero/tasks/tests-pueden-borrar-la-bd-compartida/task.md`.

## EL CICLO — acá siempre pasa lo mismo

Se resuelven **tareas** sobre CreditOp con cuatro piezas: **tablero** (la tarea), **canon** (el
conocimiento curado, compartido con el equipo), **harness** (la prueba) y **trazador** (lo que ya pasó,
incluido prod). Lo que canon no cubre se lee en el código de `main`.

Canon vive en otro repo (`~/Desktop/CREDITOP/github/playground/tools/canon`, `Creditop-SAS/playground`)
y se publica en canon.playground.creditop.com. **`context/` y `workers/` ya no existen**: si los ves
citados, está viejo. Las exploraciones de Miguel (`flow`, `engine`, `plantillas`…) están en
`~/Desktop/CREDITOP/temp/`, fuera de git, **no están validadas: no las cites ni decidas con ellas**.

1. **La TAREA vive en `tablero/tasks/<slug>/`** (`task.md`, su pila `context.jsonl`, sus `artifacts/`).
   **Buscá la que ya cubre esto antes de crear una: `make tareas TODAS=1`.** Una con `id: 0` no aparece
   en el tablero. Al cerrar la sesión, `make cierre` chequea las tres piezas —el bloque del día, `ramas:`
   medidas y la bitácora con minutos MEDIDOS— y el hook de `Stop` lo corre solo.
2. **El CONTEXTO se lee ANTES de investigar, y está en canon** (`make canon-search`, o
   `go run . -pregunta '…'` desde su repo). El código real vive en
   `~/Desktop/CREDITOP/github/` (`legacy-backend`, `frontend-monorepo`, `legacy-application`,
   `pre-approvals-service`); entrar por grep sin mapa es la forma lenta.
3. **Lo que se descubre SE REGISTRA.** El test: *si esto se mergea mañana, ¿sigue siendo cierto?*
   - una **regla de negocio** que existe en `main` y canon no tiene → **canon**, en el momento (el
     recorrido: `tablero/CLAUDE.md` §«Cuando aparece una regla de negocio»);
   - hallazgos **de la tarea** → su **pila**, como bloques (`make tarea-bloque`, o `BLOQUE=`);
   - trampas **del sistema**, verificadas → `tablero/data/traps/doc.md`. **Mirala antes de depurar un
     muro.**
4. **Probar de verdad es `harness/`**: se comprueba corriendo, no leyendo. ⚠ En local/dev/staging las
   centrales de riesgo las atiende un lambda de mocks de la empresa
   (`Creditop-SAS/risk-services-mockery-lambda`, un Mockoon), al que se le dicta la respuesta por
   cédula (F-139): sin saberlo, una prueba de identidad siempre devuelve la misma persona.
5. **Al mergear, GRADÚA:** lo aprendido pasa a canon y la tarea se marca `archived`. Canon rechaza la
   crónica: van las reglas que existen en `main`, sin el relato ni PRs sin mergear. **Un PR sin mergear
   no se dicta.** Lo que no pasa ese filtro y aun así vale es una trampa del sistema. En una tarea, una
   nota sobre algo sin mergear es legítima: `grep -rn "PENDIENTE DE MERGE" .` las junta para revisarlas
   después de cada merge.

Canon no documenta las herramientas de este repo: cada una se documenta en su `CLAUDE.md`. El enlace
tarea → canon es unidireccional (`canon:` en el frontmatter). De una tarea sólo salen a Jira
`jira_title` y `## Tarea (publicable)`, que pasan el guard; el resto es privado.

## Git

- **Este repo** (`playground`) se trabaja directamente sobre `main` y se commitea local. No crees ramas
  para sus mejoras. El push lo decide Miguel: no pushees por tu cuenta.
- **Varias sesiones comparten este worktree y su índice de git**: se stagea y se commitea por RUTA
  (`git commit -m … -- <rutas>`, o `git add <rutas> && git commit …` en el mismo comando). El hook
  `index-guard` frena `git add -A`, `git commit -a` y el commit sin rutas. *(Un worktree por sesión no
  sirve hoy: los `.env`, la bitácora y las cachés están fuera de git, y desde un worktree fallan en silencio.)*
- **Los repos reales** (`legacy-backend`, `frontend-monorepo`, `legacy-application`) trabajan en ramas y
  stashes locales. **No armes PRs ni pushees ahí sin pedir permiso explícito.**
- **UN PR por tarea y por repo, con TODO lo que la tarea toque de ese repo.** Cinco PRs chicos de la
  misma tarea se revisan cinco veces y se mergean en cinco momentos, así que `main` pasa por estados que
  nadie probó (se decidió el 2026-09-14). La única división es **por repo**.
- ⛔ **La descripción de un PR NO nombra las herramientas internas.** Nada de `harness`, `trazador`,
  `tablero`, `connectors`, `playground` ni sus comandos `make`: lo leen personas que no tienen este repo.
  Va **qué se midió y qué dio** —ambiente, caso, números, antes y después— y las rutas del repo tocado.
  El comando que lo reproduce va en el archivo de la tarea.

## Entorno local

- Hay una **copia local de la BD** en Docker: contenedor `legacy-backend-mysql-1`, schema `creditop`.
  Usala para verificar contra datos reales en vez de suponer.
- ⚠ **`E2E_TARGET` por defecto es `dev`** (`harness/pkg/db.ts`). Para local, exportalo:
  `E2E_TARGET=local`. Y un `||=` de esa variable **no gana a un import estático** que ya resolvió el
  target (F-187).
- El harness del wizard se maneja desde el **panel**: `cd harness && npm run dev`.

## Trampas que ya costaron tiempo

- En `user_requests`, el estado es **`user_request_status_id`**, no `status` (F-50).
- **El estado 11 «Autorizada» ES terminal**: de 10.182 solicitudes que lo tocaron en 90 días, 3
  avanzaron. **No cuentes desembolsos con esa columna**; usá `user_requests.disbursed_at` (desde el
  2026-09-18, con histórico reconstruido: ~23% salió de `updated_at`).
- ⚠ **`make trazador-acceso` es una SONDA: muestra una MUESTRA.** No cuentes sus líneas; para contar,
  `QUERY='sum(count_over_time({service_name="x", level="error"} [24h]))'`.
- `playground/docs/` fue borrada de `main`. Una ruta `docs/X.md` citada es histórica:
  `git show 159906a:docs/<archivo>`.

## Dos reglas de honestidad

- Si tocaste las `fuentes` de un tema de canon, validá que existan en `main`: una ruta mal escrita no
  falla en ningún lado. Lo mismo con las citas `archivo:línea` de una trampa: `make trampas` las ancla.
- **Nunca afirmes como verificado algo que no comprobaste contra el código.** Si no lo miraste, decilo.

## Variables de entorno

**Las credenciales de un servicio viven en UN lugar: su conector.**

| archivo | qué lleva |
|---|---|
| `connectors/.env.<target>` (`local` · `dev` · `qa` · `staging` · `prod`) | lo que depende del ambiente: la base (MySQL directo, o Redash en prod), Loki y PostHog |
| `connectors/.env` | lo que no: Gemini, Atlassian (Jira y Confluence, un token para los dos), Slack, Jev, Twilio y Figma |
| `<herramienta>/.env[.<target>]` | sólo las **perillas** de esa herramienta |

La plantilla es `connectors/.env.example`. **El proceso gana** sobre el archivo, y una variable vacía
en el proceso no tapa la del archivo. Desde otro lenguaje se llega por **`bin/pg`**.

- La única excepción es la base del **harness** (`E2E_DB_*` en `harness/.env.<target>`): siembra, o sea
  escribe, y la escritura no pasa por el conector a propósito.
- Las claves de base van con el prefijo `E2E_DB_`, **nunca `DB_HOST`**: ese es el que lee Laravel
  (CORE-431).
- Antes de agregar una clave a una herramienta, fijate si su conector ya la resuelve: una copia de una
  credencial vence sin avisar.

**Qué rama sirve cada target:** `local` → local · `dev` → `develop` · `staging` → `staging` · `qa` →
`qa`. `dev`, `qa` y `staging` **comparten la BD** (`inertia-dev`) pero **no el backend**: el detalle, en
`harness/CLAUDE.md` §«Qué es real en cada target».

**Los permisos no van en archivo.** `I_KNOW_THIS_TOUCHES_SHARED_DEV` se exporta a mano en la shell
cuando de verdad vas a escribir a la BD compartida; meterlo en un `.env` desarma la guarda (F-53).

`.env.*` está gitignoreado; las plantillas versionadas son `connectors/.env.example` y
`<herramienta>/.env.<target>.example`.
