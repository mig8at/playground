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
| [`context/`](context/README.md) | El árbol de contexto curado: por tema, un `doc.md` (análisis) + `map.json` (rutas exactas al código real). El índice es [`context/docs/ROUTE-MAP.md`](context/docs/ROUTE-MAP.md) (generado). Incluye la bitácora de trampas (`findings`). |
| [`harness/`](harness/README.md) | Playwright + TypeScript manejando el wizard real punta a punta con KYC/buró sintético: panel visual, flota de mocks y barrido headless por API. |
| [`tablero/`](tablero/README.md) | Las **tareas** (una = un archivo en `data/`), el dashboard del sprint y el pulso. |
| [`trazador/`](trazador/) | Herramienta de soporte (Go) sobre Loki + BD: «¿qué le pasó a ESTA solicitud y por qué?». `make trazador-acceso` prueba el acceso. |
| `flow/` · `engine/` · `domain-model/` · `diccionario/` · `creditop-woocommerce/` | Exploraciones de Miguel para entender el negocio. **No están validadas contra el código** — no las cites como fuente ni las uses para decidir (la regla y el porqué: `CLAUDE.md`). |

## Por dónde empezar

| Si venís a… | Arrancá por |
|---|---|
| Entender un flujo o subsistema | [`context/docs/ROUTE-MAP.md`](context/docs/ROUTE-MAP.md): elegí dos a cuatro nodos por su **Cuándo** y abrí sus `doc.md` + `map.json` |
| «¿Ya nos pasó esto?» | el nodo [`findings`](context/server/data/flows/findings/doc.md): entrá por el índice de síntomas |
| Probar un flujo corriendo | `cd harness && npm run dev` → el panel maneja el wizard real |
| Investigar una solicitud rota | `make trazador-acceso` + el nodo `trazador` |

**Regla de oro para un modelo:** empezá siempre por `context/`, aunque la tarea parezca de código.
Es más barato leer un `doc.md` que grepear los repos a ciegas.

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

- **`playground/docs/` fue borrada** de `main` (2026-07-17, absorbida por `context/`). Toda ruta
  `docs/X.md` es histórica: `git show 159906a:docs/<ruta>`.
- **El MCP de `context` está retirado.** Lo que queda es el mapa estático + el toolkit Python + una
  viz read-only. **No lo reconstruyas** — el protocolo completo está en `context/CLAUDE.md`.
- Referencias a **`soporte/`, `examples/`, `backend-e2e` o `backend-mcp`**: todo eso se borró. El <!-- lint:ok -->
  trazador vigente es `playground/trazador` y el harness absorbió lo que hacían las herramientas Go.
