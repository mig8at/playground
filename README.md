# Playground

Espacio propio de Miguel: el conocimiento de **CreditOp** —fintech colombiana de originación de
crédito— junto a las herramientas para probarlo. No es un repo de la empresa: es el taller. **Su
objetivo explícito es orientar a un modelo LLM antes de que ataque una tarea**: que alguien que llega
en frío entienda cómo funciona el sistema real y pueda actuar en minutos, en vez de deducirlo
grepeando repos enormes.

Este README orienta a humanos. **El contrato operativo del repo es [`CLAUDE.md`](CLAUDE.md)** (el
ciclo tarea→contexto local→prueba→cierre, las reglas de git y de entornos); los números vivos (cuántos
nodos, qué valida, qué derivó) los imprimen las herramientas, no la prosa.

## Cómo se usa

- **La puerta única es `make`**: sin argumentos lista todo lo que se puede correr, agrupado por para
  qué sirve. No hace falta recordar en qué carpeta vive cada script.
- Los dev servers y sus puertos viven en [`.claude/launch.json`](.claude/launch.json) — esa es la
  fuente; si un puerto choca, ahí se ve contra qué.

## Mapa de carpetas

| Carpeta | Qué es |
|---|---|
| [`knowledge/`](knowledge/README.md) | Conocimiento local editable y versionado, con fuentes revisadas contra el código. |
| [`connectors/`](connectors/) | El cliente ÚNICO de cada servicio externo (base, Loki, PostHog, Gemini, repos), por ambiente y con la fuente que contestó. Se usa con `bin/pg` (`make pg ARGS=help`). También posee los logins y sesiones de admin/asesor: [contrato](connectors/CLAUDE.md). |
| [`harness/`](harness/README.md) | Playwright + TypeScript manejando el wizard real punta a punta con KYC/buró sintético: panel visual, flota de mocks y barrido headless por API. |
| [`tablero/`](tablero/README.md) | Las **tareas** (una = una carpeta en `tasks/`), el dashboard del sprint y el pulso. |
| [`trazador/`](trazador/) | Herramienta de soporte (Go) sobre Loki + BD: «¿qué le pasó a ESTA solicitud y por qué?». `make trazador-acceso` prueba el acceso. |

## Por dónde empezar

| Si venís a… | Arrancá por |
|---|---|
| Entender un flujo o subsistema | `make knowledge-map`, `knowledge-search Q=…` y `knowledge-read ID=…`; completar y verificar en el código de `main` |
| Consultar conocimiento de negocio/producto que no se puede comprobar en local | Canon, opcional: `make canon-search Q=…` y `make canon-read IDS=…` |
| «¿Ya nos pasó esto?» | [las trampas del sistema](tablero/data/traps/doc.md): entrá por el índice de síntomas |
| Probar un flujo corriendo | `cd harness && npm run dev` → el panel maneja el wizard real |
| Investigar una solicitud rota | `make trazador-acceso`, y después `make trazador-ureq UREQ=…` |

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

**Secretos:** `.env*` está gitignoreado salvo los `.example`. `tablero/server/.env` tiene tokens
reales: no lo imprimas ni lo cites.

## Advertencias de mapa

Cosas que vas a encontrar escritas por ahí y **ya no son ciertas**:

- **`playground/docs/` fue borrada** de `main` (2026-07-17, absorbida por el árbol de contexto). Toda
  ruta `docs/X.md` es histórica: `git show 159906a:docs/<ruta>`.
- **`context/` se apagó** (2026-09-21): lo que valía graduó a **canon** —el corpus compartido, en otro
  repo— y las trampas del sistema se mudaron a `tablero/data/traps/`. Toda ruta
  `context/server/data/flows/<nodo>/` es histórica. No reconstruyas ese servicio: `knowledge/` son archivos del taller, sin sincronización ni copia
  automática del corpus productivo.
- Referencias a **`soporte/`, `examples/`, `backend-e2e` o `backend-mcp`**: todo eso se borró. El <!-- lint:ok -->
  trazador vigente es `playground/trazador` y el harness absorbió lo que hacían las herramientas Go.
