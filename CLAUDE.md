# CREDITOP · playground

Espacio propio de Miguel: organiza el conocimiento de **CreditOp** (fintech colombiana de originación
de crédito) y agrupa las herramientas de prueba. Existe para que un modelo entienda **antes** de atacar
una tarea. Cada carpeta tiene su `README.md`; la profundidad vive en `<herramienta>/docs/`.

## Antes de investigar, leé el mapa (no explores a ciegas)

El código real vive **fuera** de acá, en `~/Desktop/CREDITOP/github/` (`legacy-backend`,
`frontend-monorepo`, `legacy-application`, `pre-approvals-service`). Son grandes: entrar por grep sin
mapa es la forma lenta.

1. **`context/docs/ROUTE-MAP.md`** — índice de 29 nodos curados. Elegí los que matcheen la tarea y abrí
   su `context/server/data/flows/<id>/doc.md` (el análisis) + `map.json` (las rutas fuente exactas).
2. **`context/server/data/flows/findings/doc.md`** — bitácora de hallazgos (F-01…). **Mirala antes de
   depurar un muro en local**: si ya nos pasó, está ahí con causa raíz verificada y arreglo.

## La partición: `context` es el conocimiento, `tablero` es el trabajo

Desde el **2026-07-21** son dos cosas distintas y no se mezclan:

| | **`context/`** | **`tablero/`** |
|---|---|---|
| Responde | *¿cómo **es** CreditOp?* | *¿en qué se está **trabajando**?* |
| Contiene | contextos del sistema + el mapa del código (rutas validadas) | esfuerzos, tareas, tiempo, estado, borradores y claves de Jira |
| Naturaleza | durable — sobrevive a las tareas | efímero — tiene estado y fecha |
| Formato | markdown versionado, lo lee cualquier modelo | SQLite local (`tablero/server/data/`), por API |

**El árbol NO lleva nodos-tarea.** Un esfuerzo del tablero guarda su detalle técnico en `tech_notes`
(privado, **sin guard** — puede nombrar archivos y repos) y a qué nodos apunta en `context_nodes`.

⚠ **La regla al terminar:** lo que se **mergea** deja de ser tarea y **gradúa** al nodo de contexto que
corresponda — ahí pasa a ser "cómo funciona CreditOp". Lo que no se mergeó se queda en el tablero.
Ejemplo hecho: la omisión de Experian por cupo ya confirmado vive hoy en el nodo `kyc`.

## Git

- **Este repo** (`playground`) se commitea local. El push lo decide Miguel — no pushees por tu cuenta.
- **Los repos reales** (`legacy-backend`, `frontend-monorepo`, `legacy-application`) trabajan en ramas y
  stashes locales. **No armes PRs ni pushees ahí sin pedir permiso explícito.**

## Entorno local

- Hay una **copia local de la BD** en Docker: contenedor `legacy-backend-mysql-1`, schema `creditop`.
  Usala para verificar contra datos reales en vez de suponer.
- **`E2E_TARGET` por defecto es `dev`**, no `local` (`frontend-e2e/pkg/db.ts:12`). Cualquier consulta o
  script que lo omita pega contra el **dev compartido**. Para local, exportalo:
  `E2E_TARGET=local`. (`dev/sweep.ts:34` ya lo fuerza; el panel setea
  `I_KNOW_THIS_TOUCHES_SHARED_DEV` cuando el target es `dev`.)
- El harness del wizard se maneja desde el **panel**: `cd frontend-e2e && npm run dev`. Los `bin/` son
  plumbing, no una segunda entrada.

## Trampas que ya costaron tiempo

- En `user_requests`, el estado de la solicitud es **`user_request_status_id`**, no `status`. Mirar la
  columna equivocada hace creer que una solicitud cancelada está sana (F-50).
- `playground/docs/` **fue borrada** de `main` (absorbida por `context/`). Toda ruta `docs/X.md` que veas
  citada es histórica: `git show 159906a:docs/<archivo>`.

## Cuando descubras algo

El entregable no es solo el arreglo: es dejarlo escrito donde el próximo modelo lo encuentre. Agregá una
entrada a **`findings`** (síntoma → causa raíz verificada → evidencia → arreglo) y, si tocaste rutas de
un nodo, validá con `python3 context/tools/oracle.py <map.json>`.

**Nunca afirmes como verificado algo que no comprobaste contra el código.** Si no lo miraste, decilo.

## Variables de entorno

Cada herramienta guarda su configuración por target en su propio **`.env.<target>`** (`local` · `dev` ·
`staging`), **autosuficiente**: ahí viven tanto los **hechos** del entorno (BD, API base, `APP_KEY`)
como las **perillas** (Cognito, mocks, `SEED`). Ya **no** hay capa compartida `env/<target>.env` — se
eliminó el 2026-07-22 (solo la usaba `frontend-e2e`; `backend-e2e`/`backend-mcp`, que la compartían, se
borraron). Prioridad: `process.env` > `<herramienta>/.env.<target>`. Ojo: `staging` comparte BD/API con
`dev`, así que esos valores son una **copia** de dev — si rotan, actualizá los dos.

**Los permisos no van en archivo.** El flag `I_KNOW_THIS_TOUCHES_SHARED_DEV` **no** vive en ningún
`.env.*`: se exporta a mano en la shell cuando de verdad vas a escribir a la BD compartida de dev (el
panel lo inyecta solo para sus corridas). Meterlo en un archivo desarma la guarda (F-53).

`.env.*` está gitignoreado (trae secretos); las plantillas versionadas y documentadas son
`<herramienta>/.env.<target>.example`.
