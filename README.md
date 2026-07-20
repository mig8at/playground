# Playground

Espacio propio de Miguel donde vive el conocimiento de **CreditOp** —fintech colombiana de originación de
crédito— junto a las herramientas para probarlo. No es un repo de la empresa: es el taller.

**Su objetivo explícito es orientar a un modelo LLM antes de que ataque una tarea.** Todo lo de acá existe
para que alguien que llega en frío —persona o modelo— entienda cómo funciona el sistema real y pueda
actuar en los próximos minutos, en vez de deducirlo leyendo seis repos.

---

## Por qué existe

CreditOp corre sobre **6 repos** (`legacy-application`, `legacy-backend`, `frontend-monorepo`,
`pre-approvals-service`, más los dos harness de acá) con una migración a medio camino, decenas de
entidades de crédito con reglas propias y un flujo de originación que se bifurca por `response_type`,
producto, modo y canal. Preguntas que en otro lado serían de 5 minutos —"¿por qué esta entidad no
aparece en el listado?", "¿dónde se decide el cupo?"— ahí adentro cuestan horas de grep.

El playground ataca eso por tres frentes:

1. **Mapas curados** que dicen *qué archivo abrir y en qué repo* (`context/`), en vez de buscar a ciegas.
2. **Harness** que ejercen el flujo real punta a punta inyectando el KYC/buró sintético, para no depender
   de Experian ni de un cliente real (`frontend-e2e/`).
3. **Simuladores y visualizadores** para razonar y alinear con negocio sin levantar el stack
   (`flow/`, `domain-model/`, `soporte/`, `examples/`).

La bitácora de todo lo que se rompió y por qué está en un solo lugar:
**[`context/server/data/flows/findings/doc.md`](context/server/data/flows/findings/doc.md)** — 52
hallazgos (F-01…F-52) con síntoma → causa raíz verificada → evidencia → arreglo. **Antes de depurar un
muro, buscá ahí.** Es lo más rentable del repo.

---

## Por dónde empezar según lo que vengas a hacer

| Si venís a… | Arrancá por | Concretamente |
|---|---|---|
| **Entender cómo funciona un flujo** (listado de entidades, cupo, formalización, un lender puntual) | `context/` | Abrí [`context/ROUTE-MAP.md`](context/docs/ROUTE-MAP.md) (33 nodos con su campo *Cuándo*), elegí 2-4 nodos, leé `context/server/data/flows/<id>/doc.md`. **No hay que correr nada.** |
| **Ver si un problema ya está diagnosticado** | `context/` | [`findings/doc.md`](context/server/data/flows/findings/doc.md), secciones A–L. 52 hallazgos verificados. Buscá el síntoma, no la causa. |
| **Probar un flujo punta a punta con navegador** | `frontend-e2e/` | `cd frontend-e2e && npm run dev` → panel en **:5195**. Maneja el wizard real (`:5174`) con Playwright. |
| **Probar el flujo sin navegador** (API + BD, rápido y repetible) | `frontend-e2e/` | `node dev/sweep.ts close <comercio> <lenderId>` — recorre el cierre endpoint por endpoint, traza contra la BD y su exit code es el veredicto. |
| **Depurar un muro del harness** (pantalla en blanco, 500, no lista la entidad) | `context/` → `frontend-e2e/` | Primero [`findings`](context/server/data/flows/findings/doc.md); si no está, la sección de gotchas del [README de frontend-e2e](frontend-e2e/README.md). |
| **Fabricar un caso / inyectar buró y KYC sintético** | `frontend-e2e/` | El panel (`npm run dev`) define el usuario sintético; por CLI, `node bin/dbops.ts synth-fill <uReq>`. |
| **Entender las reglas de decisión sin levantar el stack** | `flow/` | `cd flow && npm run dev` → **:5190**. Simulador editable: tocás monto y documento, ves qué entidad se cae y por qué. Ojo: el catálogo **arranca vacío**. |
| **Entender el modelo de datos** | `domain-model/` | `cd domain-model && npm install && npm run dev` → **:5183**. 105 entidades del deber-ser, cada una con puntero a su tabla real del legacy. |
| **Investigar una solicitud rota (soporte)** | `flow/FAQ-SOPORTE.md` → `soporte/` | La FAQ tiene los códigos de diagnóstico. El trazador (`:5192`) está en **Fase 0: datos mock** — una cédula real no devuelve nada. |
| **Entender el canal ecommerce** (contrato base64, checkout de tienda) | `creditop-woocommerce/` | El plugin es el emisor original del contrato. Port en TS: `frontend-e2e/pkg/ecommerce.ts`. |
| **Explicarle algo a negocio / alinear un rediseño** | `examples/` | HTML de un solo archivo, doble clic. Son **deber-ser**, no el sistema real — leé los gotchas antes de citarlos. |
| **Crear una tarea en Jira o postear en Slack** | `tablero/` | Conectores MCP propios en Go. Hoy **ninguno está registrado** en Claude Code. |

**Regla de oro para un modelo:** empezá siempre por `context/`, aunque la tarea parezca de código. Es más
barato leer un `doc.md` de 100 líneas que grepear 5.700 archivos.

---

## Mapa de las carpetas

Cada una tiene su propio README con arranque verificado, gotchas y trampas conocidas.

| Carpeta | Qué es |
|---|---|
| [`context/`](context/README.md) | Árbol de **33 nodos curados** (`doc.md` en prosa + `map.json` con las rutas fuente exactas) que le dice a un LLM qué leer, en cuál de los 6 repos, antes de atacar una tarea. Incluye la bitácora `findings`. Viz Vue read-only en **:5193**. |
| [`frontend-e2e/`](frontend-e2e/README.md) | Harness **Playwright + TypeScript** que maneja el wizard real de originación (`:5174`) de punta a punta, con KYC/buró sintético, panel visual (**:5195**), flota de 8 mocks locales y barrido headless por API. |
| [`flow/`](flow/README.md) | **Simulador editable** del onboarding (Vue 3 + Vue Flow, sin backend, **:5190**): tocás monto, documento, burós y reglas, y ves en vivo qué entidad queda y por qué. |
| [`domain-model/`](domain-model/README.md) | Visualizador del **modelo de dominio deber-ser** (**:5183**): 105 entidades en 8 contextos, cada una apuntando a su tabla real. Mapa de traducción entre el rediseño y las 212 tablas de hoy. |
| [`soporte/`](soporte/README.md) | **Trazador de solicitudes** (**:5192**): buscás una cédula y ves cada intento dibujado etapa por etapa, con dónde y por qué se rompió. **Fase 0 — datos mock.** |
| [`tablero/`](tablero/README.md) | Mi sprint: dashboard Vue de tareas, registro de tiempo y hallazgos, sobre conectores **MCP propios en Go** para Jira Cloud y Slack (**:5191** + WS **:8787**). |
| [`creditop-woocommerce/`](creditop-woocommerce/README.md) | Plugin de **WordPress/WooCommerce** que agrega "Paga a cuotas con Creditop" al checkout y redirige con el carrito serializado en la URL. Emisor original del contrato base64 del canal ecommerce. |
| [`examples/`](examples/README.md) | **Prototipos HTML** de un solo archivo (sin build) usados para alinear con negocio antes de programar. Casi todos son deber-ser, no el sistema real. |

---

## Puertos (todos juntos, porque chocan)

| Puerto | Qué | Nota |
|---|---|---|
| 5174 | wizard `loan-request-wizard` | **no vive acá** — es `frontend-monorepo`; los harness lo levantan |
| 5183 | `domain-model` | `open: true` (abre el navegador solo) |
| 5190 | `flow` | **`strictPort: true`** → si está ocupado FALLA, no salta. Override: `PORT=5191 npm run dev` |
| 5191 | `tablero` (Vite) | colisiona con el target muerto `merchant-config` de `.claude/launch.json` |
| 5192 | `soporte` | **sin `strictPort`** → si está ocupado salta a 5193, que es `context`. Leé la línea `Local:` de Vite |
| 5193 | `context` (viz) | |
| 5195 | `frontend-e2e` (panel) | override con `PANEL_PORT` |
| 8095–8102 | mocks de `frontend-e2e` | preapprovals 8095 · redirect 8096 · payvalida 8097 · mdm 8098 · lenders 8099 · pdf-mapper 8100 · forms 8101 · abaco 8102 |
| 8787 | WS de `tablero` | el front lo tiene hardcodeado en `App.vue:4` |

---

## Convenciones

**Los repos de la empresa se tocan con guantes.** `legacy-backend`, `frontend-monorepo` y
`legacy-application` viven en `~/Desktop/CREDITOP/github/` y su trabajo va en **ramas y stashes locales**.
**No armes PRs ni pushees ahí sin pedirlo explícitamente.** Un harness que shellea a esos repos (mueve un
`.env`, flipea un `ecommerce_type_id`) tiene que revertir lo que tocó.

**Escrituras a entornos compartidos.** `dev` es una BD compartida con el equipo. Tanto el camino rápido como
`frontend-e2e` exige `I_KNOW_THIS_TOUCHES_SHARED_DEV=1` para escribir fuera de local, y no es burocracia:
cambiar de comercio en `frontend-e2e` **escribe en la BD**, y cada arranque hace un scrub que borra el
usuario de prueba y arrastra sus solicitudes anteriores.

**Sobre el git de este repo — ojo con lo que vas a leer en otros lados.** La convención escrita (y el
encabezado de `.gitignore`, que dice *"Nunca se pushea (sin remoto)"*) afirma que playground es
**commit local sin push**. **Hoy eso no es cierto:** el repo tiene remoto
`git@github.com-personal:mig8at/playground.git` (GitHub **personal**, no de la empresa), `main` trackea
`origin/main`, y el reflog registra **14 pushes**, el último del 2026-07-19 —o sea, se viene pusheando a
diario. El comentario del `.gitignore` quedó viejo.

Lo que sigue vigente como regla de trabajo: **commiteá local y no pushees por iniciativa propia** — el
push lo hace Miguel. Y nunca confundas este remoto personal con los repos de la empresa.

**Secretos.** `.env*` está gitignoreado salvo `.env.example`. `tablero/server/.env` tiene tokens reales
(Slack `xoxb-`/`xoxp-`, API token de Atlassian): no lo imprimas ni lo cites.

---

## Advertencias de mapa

Cosas que un modelo va a encontrar escritas y que **ya no son ciertas**. Están acá para que no pierdas
tiempo persiguiéndolas.

- **`playground/docs/` FUE BORRADO** de `main` (commit `ef1d473`, 2026-07-17): se absorbió en el árbol de
  `context/`. **Cualquier ruta `playground/docs/X.md` o `../docs/X.md` que veas es un puntero histórico.**
  El contenido sobrevive en git: `git show 159906a:docs/<ruta>`. Punteros rotos vivos hoy:
  `domain-model/docs/CONTEXT.md:51`, `domain-model/CLAUDE.md:64` y
  `examples/merchant-config/README.md:4`.

- **[`frontend-e2e/README.md`](frontend-e2e/README.md) (raíz) está PODRIDO.** Documenta una interfaz de `bin/asesor` que **ya no
  existe**: verifiqué con grep que ni `--store`, ni `--mode=`, ni `--fresh`, ni `--lender=`, ni
  `--no-assign`, ni `--down`, ni `--wizard=`, ni `--headless`, ni `E2E_STEP_MS`/`E2E_LINGER_MS` aparecen
  en `frontend-e2e/bin/asesor`. La interfaz real es **sin flags**:
  `bin/asesor <comercio> [auto [success|rejected|pending]]` — y el comercio va **primero** (el script
  rechaza `bin/asesor auto` con un error explícito). Usá el [README de frontend-e2e](frontend-e2e/README.md),
  no EXAMPLES.md. *(No lo arreglé: no era el encargo.)*

- **El target `merchant-config` de [`.claude/launch.json`](.claude/launch.json) está muerto.** Sirve
  `playground/merchant-config`, carpeta que se movió a `examples/merchant-config` (commit `e631279`).
  Arranca y devuelve 404 en todo. Además ocupa el **:5191** de `tablero`.

- **El MCP de `context` está retirado.** Se borró el server Go (commit `50f689e`); lo que queda es el mapa
  estático `ROUTE-MAP.md`, el toolkit Python de `context/tools/` y una viz Vue read-only. **No lo
  reconstruyas.**

- **El simulador `flow/` es DEBER-SER en un punto clave:** muestra herencia viva entidad → comercio →
  sucursal, y el sistema real **no tiene herencia** — copia las reglas por sucursal (~37k filas, con
  deriva). Mismo espíritu en `domain-model/` y `examples/`: son el rediseño propuesto, no el IS.

- **`examples/motai.html` miente sobre Ábaco:** ahí Ábaco **decide** el corte de ingresos. En el sistema
  real Ábaco **no decide** — `AbacoParserService` persiste `average_income` y nadie lo lee. Hoy es solo un
  gate de paso.

- **`npm run test:onboarding` (frontend-e2e) apunta a `tests/onboarding`, carpeta que no existe.** Script
  roto. Y `npm test` colecta también los specs **interactivos** de `dev/` — para un run desatendido hay
  que pasar rutas explícitas.

---

## Docs de la raíz

| Archivo | Qué aporta |
|---|---|
| [`frontend-e2e/README.md`](frontend-e2e/README.md) | Demos visuales del wizard desde `frontend-e2e`. **Podrido** (ver arriba): los flags ya no existen. |
| [`.claude/launch.json`](.claude/launch.json) | Targets de dev server: `flow` (5190), `soporte` (5192), `context` (5193), `panel` (5195) y `merchant-config` (5191, **muerto**). |
| [`.claude/settings.local.json`](.claude/settings.local.json) | Permisos locales (gitignoreado). |

Fuera de la raíz, los tres docs que más rinden: [`context/ROUTE-MAP.md`](context/docs/ROUTE-MAP.md) (dónde está
cada cosa), [`context/server/data/flows/findings/doc.md`](context/server/data/flows/findings/doc.md) (qué
se rompió y por qué) y [`flow/FAQ-SOPORTE.md`](flow/docs/FAQ-SOPORTE.md) (diagnóstico de solicitudes rotas).
