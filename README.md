# Playground

Espacio propio de Miguel: el conocimiento de **CreditOp** —fintech colombiana de originación de
crédito— junto a las herramientas para probarlo. No es un repo de la empresa: es el taller. **Su
objetivo explícito es orientar a un modelo LLM antes de que ataque una tarea**: que alguien que llega
en frío entienda cómo funciona el sistema real y pueda actuar en minutos, en vez de deducirlo
grepeando repos enormes.

Este README orienta a humanos. **El contrato operativo del repo es [`CLAUDE.md`](CLAUDE.md)** (el
ciclo tarea→contexto local→prueba→cierre, las reglas de git y de entornos; cada `AGENTS.md` es un enlace
al `CLAUDE.md` de su carpeta, para los agentes que leen ese nombre: se edita el `CLAUDE.md`. `knowledge/` no lo lleva: no admite enlaces); los números vivos (cuántos
nodos, qué valida, qué derivó) los imprimen las herramientas, no la prosa.

## Cómo se usa

- **La puerta única es `make`**: sin argumentos lista todo lo que se puede correr, agrupado por para
  qué sirve. No hace falta recordar en qué carpeta vive cada script.
- **Las interfaces se miran en Cockpit** (`make cockpit` la instala en Aplicaciones): una app de escritorio
  con una barra como la de VS Code y, adentro, chat, tablero, el panel del harness, Jarvis, Designer y
  ecommerce. Levanta cada una la primera vez que la abrís y muestra en vivo lo que hace
  Claude. Cada herramienta sigue abriendo sola en el navegador con su `make`.
- Los dev servers y sus puertos viven en [`.claude/launch.json`](.claude/launch.json) — esa es la
  fuente; si un puerto choca, ahí se ve contra qué.

## Mapa de carpetas

| Carpeta | Qué es |
|---|---|
| [`knowledge/`](knowledge/README.md) | Conocimiento local editable y versionado, con fuentes revisadas contra el código. |
| [`connectors/`](connectors/) | El cliente ÚNICO de cada servicio externo (base, Loki, PostHog, Gemini, repos), por ambiente y con la fuente que contestó. Se usa con `bin/pg` (`make pg ARGS=help`). También posee los logins y sesiones de admin/asesor: [contrato](connectors/CLAUDE.md). |
| [`harness/`](harness/README.md) | Playwright + TypeScript manejando el wizard real punta a punta con KYC/buró sintético: panel visual, flota de mocks y barrido headless por API. |
| [`tablero/`](tablero/README.md) | Las **tareas** (una = una carpeta en `tasks/`), el dashboard del sprint y el pulso. |
| [`cockpit/`](cockpit/CLAUDE.md) | La app de escritorio (Tauri) que junta las interfaces en una barra, y `bin/cockpit` para manejarla por consola. |
| `chat/` | El chat del equipo: interfaz, su servidor (va adentro de Cockpit) y `bin/chat`. |
| [`jarvis/`](jarvis/CLAUDE.md) | Manejar paneles admin complejos en el Chrome de Miguel con su extensión, y dejarlos como recetas reproducibles. |
| [`visor/`](visor/CLAUDE.md) | Un diseño de Figma pantalla por pantalla al lado de su HTML traducido. En Cockpit se llama **Designer**. |
| [`sentinel/`](sentinel/CLAUDE.md) | El vigía de producción: si lo que entra por entidad y comercio se salió de lo normal, con los despliegues marcados. Sólo lectura. |
| [`ecommerce/`](ecommerce/README.md) | Qué le pasó a una prueba de tienda, por celular, URL del wizard o número de solicitud. |
| [`tienda-simple/`](tienda-simple/README.md) | La tienda VTEX de pruebas (tema y checkout). |
| [`tools/`](tools/CLAUDE.md) | Lo transversal: el sistema de diseño que comparten las interfaces ([`tools/ui/`](tools/ui/README.md)) y sus chequeos. |
| `keyring/` · `radar/` · `sala/` | A qué hay acceso ahora y cuándo vence · el uso real de las herramientas · agentes en paralelo sobre `knowledge/`. |

## Por dónde empezar

| Si venís a… | Arrancá por |
|---|---|
| Entender un flujo o subsistema | `make knowledge-map`, `knowledge-search Q=…` y `knowledge-read ID=…`; completar y verificar en el código de `main` |
| Consultar conocimiento de negocio/producto que no se puede comprobar en local | Canon, opcional: `make canon-search Q=…` y `make canon-read IDS=…` |
| «¿Ya nos pasó esto?» | [las trampas del sistema](tablero/data/traps/doc.md): entrá por el índice de síntomas |
| Probar un flujo corriendo | la app Harness de Cockpit, o `make panel` → el panel maneja el wizard real |
| Ver las tareas o el chat | Cockpit (`make cockpit`), o `make tablero` |
| Investigar una solicitud rota | en prod, el tracer del equipo (`tools/tracer` del playground compartido); fuera de prod, `make harness-loki UREQ=… TARGET=…` y `make harness-posthog UREQ=… TARGET=…` |

**El trabajo diario arranca en local:** `make retomar N=…` reúne la tarea y sus referencias
`knowledge:` sin consultar Canon. `make knowledge-check` detecta cambios en los archivos fuente;
no certifica la prosa ni el despliegue. Canon vive en `github/playground/tools/canon` y sirve al
equipo: consultarlo o publicar allí es una decisión explícita, no un requisito de estas herramientas.

## Convenciones

Las reglas completas viven en `CLAUDE.md`; las dos que más caro cuestan si se ignoran:

- **Los repos de la empresa se tocan con guantes**: ramas y stashes locales, **sin PRs ni pushes sin
  permiso explícito**.
- **Escribir a la BD compartida de dev** exige exportar `I_KNOW_THIS_TOUCHES_SHARED_DEV=1` a mano —
  y no es burocracia: cada arranque del harness hace un scrub que borra al usuario de prueba.

**Secretos:** `.env*` está gitignoreado y no hay plantillas versionadas. Las credenciales de cada servicio
viven en su conector (`connectors/.env` y `connectors/.env.<ambiente>`), y `tablero/server/.env` todavía
guarda algún token: no los imprimas ni los cites.

## Advertencias de mapa

Cosas que vas a encontrar escritas por ahí y **ya no son ciertas**:

- **`playground/docs/` fue borrada** de `main` (2026-07-17, absorbida por el árbol de contexto). Toda
  ruta `docs/X.md` es histórica: `git show 159906a:docs/<ruta>`.
- **`context/` se apagó** (2026-09-21): lo que valía graduó a **canon** —el corpus compartido, en otro
  repo— y las trampas del sistema se mudaron a `tablero/data/traps/`. Toda ruta
  `context/server/data/flows/<nodo>/` es histórica. No reconstruyas ese servicio: `knowledge/` son archivos del taller, sin sincronización ni copia
  automática del corpus productivo.
- Referencias a **`soporte/`, `examples/`, `backend-e2e` o `backend-mcp`**: todo eso se borró. El <!-- lint:ok -->
  harness absorbió lo que hacían las herramientas Go. El trazador personal (`trazador/`) también se retiró, el
  2026-10-13: la base, Loki y PostHog van por `bin/pg`, y la traza de prod la da el tracer del equipo.
