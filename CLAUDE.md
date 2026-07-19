# CREDITOP · playground

Espacio propio de Miguel: organiza el conocimiento de **CreditOp** (fintech colombiana de originación
de crédito) y agrupa las herramientas de prueba. Existe para que un modelo entienda **antes** de atacar
una tarea. Cada carpeta tiene su `README.md`; la profundidad vive en `<herramienta>/docs/`.

## Antes de investigar, leé el mapa (no explores a ciegas)

El código real vive **fuera** de acá, en `~/Desktop/CREDITOP/github/` (`legacy-backend`,
`frontend-monorepo`, `legacy-application`, `pre-approvals-service`). Son grandes: entrar por grep sin
mapa es la forma lenta.

1. **`context/docs/ROUTE-MAP.md`** — índice de 33 nodos curados. Elegí los que matcheen la tarea y abrí
   su `context/server/data/flows/<id>/doc.md` (el análisis) + `map.json` (las rutas fuente exactas).
2. **`context/server/data/flows/findings/doc.md`** — bitácora de hallazgos (F-01…). **Mirala antes de
   depurar un muro en local**: si ya nos pasó, está ahí con causa raíz verificada y arreglo.

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

Los **hechos** del entorno (BD, API base, `APP_KEY`) viven **compartidos** en `env/<target>.env`
(`local` · `dev`), no duplicados por herramienta. Cada herramienta guarda solo sus **perillas**
(Cognito, mocks, `SEED`) en su propio `.env.<target>`, y **el propio pisa al compartido**.
Prioridad: `process.env` > `<herramienta>/.env.<target>` > `env/<target>.env`.

**Acá van hechos, nunca interruptores.** Un flag de permiso (tipo `I_KNOW_THIS_TOUCHES_SHARED_DEV`)
en el archivo compartido desarmaría la guarda de todas las herramientas de una (F-53). Los permisos
quieren fricción: se exportan a mano en la shell de esa sesión.

`env/*.env` está gitignoreado; las plantillas versionadas son `env/*.env.example`.
