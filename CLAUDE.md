# CREDITOP · playground

Espacio propio de Miguel: organiza el conocimiento de **CreditOp** (fintech colombiana de originación
de crédito) y agrupa las herramientas de prueba. Existe para que un modelo entienda **antes** de atacar
una tarea.

## SOLO TRES CARPETAS IMPORTAN PARA TRABAJAR

Si estás por atacar una tarea, tu mundo son estas tres y nada más:

| Carpeta | Qué es | Cuándo la tocás |
|---|---|---|
| **`context/`** | **El contexto validado contra el código**, sobre `main`. Cómo **es** CreditOp hoy. | Siempre, ANTES de investigar |
| **`tablero/`** | **Las tareas a realizar**: en qué se trabaja, por qué y para qué. Un `.md` por tarea. | Cuando la tarea tiene estado, decisiones o preguntas abiertas |
| **`frontend-e2e/`** | **La herramienta para validar una tarea contra el código real** (mocks, runners, el panel). | Cuando hay que comprobar algo corriendo, no leyendo |

⚠ **El resto NO son herramientas para contextualizarte** — hoy: `flow`, `engine`, `domain-model`,
`diccionario`, `creditop-woocommerce`. Son exploraciones que Miguel armó para entender él mismo el
negocio: simuladores, prototipos y modelos que **no están validados contra el código**, y varios
describen un *deber ser*, no lo que corre en producción. **No las cites como fuente ni las uses para
decidir.** Si algo de ahí resulta cierto, se verifica contra el código y gradúa a `context/` — hasta
entonces, no existe para tu tarea.

## Antes de investigar, leé el mapa (no explores a ciegas)

El código real vive **fuera** de acá, en `~/Desktop/CREDITOP/github/` (`legacy-backend`,
`frontend-monorepo`, `legacy-application`, `pre-approvals-service`). Son grandes: entrar por grep sin
mapa es la forma lenta.

1. **`context/docs/ROUTE-MAP.md`** — índice de 31 nodos curados. Elegí los que matcheen la tarea y abrí
   su `context/server/data/flows/<id>/doc.md` (el análisis) + `map.json` (las rutas fuente exactas).
2. **`context/server/data/flows/findings/doc.md`** — bitácora de hallazgos (F-01…). **Mirala antes de
   depurar un muro en local**: si ya nos pasó, está ahí con causa raíz verificada y arreglo.

## La partición: `context` es el conocimiento, `tablero` es el trabajo

Desde el **2026-07-21** son dos cosas distintas y no se mezclan:

| | **`context/`** | **`tablero/`** |
|---|---|---|
| Responde | *¿cómo **es** CreditOp?* | *¿en qué se está **trabajando**, por qué y para qué?* |
| Contiene | contextos del sistema + el mapa del código (rutas validadas contra `main`) | las tareas: estado, decisiones, riesgos, preguntas abiertas, tiempo, borradores de Jira |
| Naturaleza | durable — sobrevive a las tareas | efímero — tiene estado y fecha |
| Formato | markdown versionado, lo lee cualquier modelo | **un `.md` por tarea** en `tablero/data/` |

**El árbol NO lleva nodos-tarea.** Una tarea del tablero guarda su detalle técnico en el cuerpo de su
`.md` (privado, **sin guard** — puede nombrar archivos y repos) y a qué nodos apunta en `context_nodes`.
El enlace es **unidireccional**: la tarea apunta a los nodos, el nodo **no** apunta a tareas — si lo
hiciera, quedaría mintiendo el día que la tarea gradúa.

### El test para saber dónde va algo

> **Si esto se mergea mañana, ¿el texto sigue siendo cierto?**
> **Sí** → `context/`. **Deja de tener sentido** porque hablaba de una decisión, un riesgo, un plan o una
> pregunta abierta → `tablero/`.

Es más filoso que "durable vs efímero" y detecta el error típico en un segundo. Ese error se comete por
**fricción**, no por no entender la regla: cuando escribir en el lugar correcto cuesta más, el contenido
se va a donde es fácil. Hoy cuesta lo mismo — las dos cosas son un archivo markdown.

⚠ **La regla al terminar:** lo que se **mergea** deja de ser tarea y **gradúa** al nodo de contexto que
corresponda — ahí pasa a ser "cómo funciona CreditOp". Lo que no se mergeó se queda en el tablero.
Ejemplo hecho: la omisión de Experian por cupo ya confirmado vive hoy en el nodo `kyc`.

## El contexto se mide contra `main`, y lo que no está en main se marca

`context/` describe **lo que corre**, y la vara es `main` (o la rama que sirva ese target — ver abajo).
Un contexto que describe una rama sin mergear es una trampa: se lee como verdad y no lo es.

Cuando haya que documentar algo que **todavía no está en `main`**, se marca en el propio `doc.md`, en el
lugar donde aparece:

```markdown
> ⏳ **PENDIENTE DE MERGE** — esto vive en `feature/motai-v2`, no en `main`.
> Al mergear: re-verificar con el oráculo, actualizar y **borrar esta marca**.
```

Dos razones por las que la marca va inline y no en una lista aparte: se ve justo donde engaña, y todas se
encuentran de una con `grep -rn "PENDIENTE DE MERGE" context/`. Revisá esa lista después de cada merge:
lo que entró **actualiza el contexto**, y así el árbol siempre describe lo que de verdad está corriendo.

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
borraron). Prioridad: `process.env` > `<herramienta>/.env.<target>`.

**Qué rama sirve cada target** (`local` → local · `dev` → **develop** · `staging` → **qa**). `staging`
comparte la **BD** con `dev` (mismas credenciales; si rotan, actualizá las dos) pero **NO el API**: en el
cluster `inertia-develop` conviven dos servicios —`legacy-backend` (rama `develop`) y
**`legacy-backend-qa`** (rama `qa`)—, así que el nombre del cluster engaña. Apuntar `staging` al backend
de dev mezcla ambientes y te hace validar código que no es el del front desplegado; costó varias corridas
creyendo que un feature estaba roto cuando la rama con el cambio no era la que respondía.

**Los permisos no van en archivo.** El flag `I_KNOW_THIS_TOUCHES_SHARED_DEV` **no** vive en ningún
`.env.*`: se exporta a mano en la shell cuando de verdad vas a escribir a la BD compartida de dev (el
panel lo inyecta solo para sus corridas). Meterlo en un archivo desarma la guarda (F-53).

`.env.*` está gitignoreado (trae secretos); las plantillas versionadas y documentadas son
`<herramienta>/.env.<target>.example`.
