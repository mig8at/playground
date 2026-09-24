# Playground

Espacio propio de Miguel: el conocimiento de **CreditOp** —fintech colombiana de originación de
crédito— junto a las herramientas para probarlo. No es un repo de la empresa: es el taller. **Su
objetivo explícito es orientar a un modelo LLM antes de que ataque una tarea**: que alguien que llega
en frío entienda cómo funciona el sistema real y pueda actuar en minutos, en vez de deducirlo
grepeando repos enormes.

Este README orienta a humanos. **El contrato operativo del repo es [`CLAUDE.md`](CLAUDE.md)** (el
ciclo tarea→contexto→prueba→graduación, las reglas de git y de entornos); los números vivos (cuántos
nodos, qué valida, qué derivó) los imprimen las herramientas, no la prosa.

## Cómo se usa

- **La puerta única es `make`**: sin argumentos lista todo lo que se puede correr, agrupado por para
  qué sirve. No hace falta recordar en qué carpeta vive cada script.
- Los dev servers y sus puertos viven en [`.claude/launch.json`](.claude/launch.json) — esa es la
  fuente; si un puerto choca, ahí se ve contra qué.

## Mapa de carpetas

| Carpeta | Qué es |
|---|---|
| [`connectors/`](connectors/) | El cliente ÚNICO de cada servicio externo (base, Loki, PostHog, Gemini, repos), por ambiente y con la fuente que contestó. Se usa con `bin/pg` (`make pg ARGS=help`). |
| [`harness/`](harness/README.md) | Playwright + TypeScript manejando el wizard real punta a punta con KYC/buró sintético: panel visual, flota de mocks y barrido headless por API. |
| [`tablero/`](tablero/README.md) | Las **tareas** (una = un archivo en `data/`), el dashboard del sprint y el pulso. |
| [`trazador/`](trazador/) | Herramienta de soporte (Go) sobre Loki + BD: «¿qué le pasó a ESTA solicitud y por qué?». `make trazador-acceso` prueba el acceso. |
| `flow/` · `engine/` · `domain-model/` · `diccionario/` | Exploraciones de Miguel para entender el negocio. **No están validadas contra el código** — no las cites como fuente ni las uses para decidir (la regla y el porqué: `CLAUDE.md`). |

## Por dónde empezar

| Si venís a… | Arrancá por |
|---|---|
| Entender un flujo o subsistema | **canon**, el corpus compartido: `cd ~/Desktop/CREDITOP/github/playground/tools/canon && go run . -pregunta '…'`, o canon.playground.creditop.com |
| «¿Ya nos pasó esto?» | [las trampas del sistema](tablero/data/traps/doc.md): entrá por el índice de síntomas |
| Probar un flujo corriendo | `cd harness && npm run dev` → el panel maneja el wizard real |
| Investigar una solicitud rota | `make trazador-acceso`, y después `make trazador-ureq UREQ=…` |

**Regla de oro para un modelo:** empezá siempre por **canon**, aunque la tarea parezca de código.
Es más barato leer el tema que grepear los repos a ciegas. ⚠ Canon vive en **otro repo**
(`github/playground/tools/canon`, compartido con el equipo). Hasta el 2026-09-21 este repo tenía
además su propio árbol curado, `context/`; se apagó porque mantener dos contextos a la par cuesta el
doble y el que valía era el compartido.

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
  `context/server/data/flows/<nodo>/` es histórica. **No lo reconstruyas**: dos contextos en paralelo
  fue exactamente el problema.
- Referencias a **`soporte/`, `examples/`, `backend-e2e` o `backend-mcp`**: todo eso se borró. El <!-- lint:ok -->
  trazador vigente es `playground/trazador` y el harness absorbió lo que hacían las herramientas Go.
