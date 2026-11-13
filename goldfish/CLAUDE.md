# goldfish — validar un PR con Elephant-Goldfish

Aplica el modelo [Elephant-Goldfish](https://github.com/google/elephant-goldfish-model) a los PRs de los repos reales.
**Quien propone no valida su propio trabajo.** Nació el 2026-11-13.

| qué | cómo |
|---|---|
| la app (Cockpit: **Goldfish**) | `make goldfish` → :5216 · API :5217 |
| tus PRs abiertos y los externos | `make goldfish-list` |
| validar un PR | `make goldfish-run PR=<url>`, o pegar la URL en la app |

## Qué lista

- **Un bloque por repo**: primero los principales (`legacy-backend`, `frontend-monorepo`, `legacy-application`, aunque
  estén vacíos), después los demás. Adentro, **los PRs abiertos de Miguel**, con el título que les puso: una sola
  `gh search prs --author=@me --state=open` en todo GitHub. Lo mergeado o cerrado no aparece.
- **Los externos**: un PR de otra persona que Miguel pegó para validar queda en el bloque de su repo, marcado
  «externo · autor», mientras siga abierto (`goldfish/.external.json`, fuera de git; al cerrarse o mergearse sale
  solo). La × lo saca a mano.
- Sin nada elegido, el editor es un **buscador** (estilo Google): se pega la URL de un PR y se valida enseguida.

## El método, adaptado a un PR

El repo de Google revisa DOCUMENTOS de diseño antes de construir; acá se revisa un PR:

1. **La propuesta** (Go, sin agente): el PR y su base se traen al clon local SÓLO como refs
   (`refs/goldfish/pr-<n>` y `origin/<base>`, sin tocar el árbol de trabajo ni la rama en la que esté el clon). Una
   carpeta con su título y descripción, el diff (`git diff base...pr`, cortado en 400 KB), los commits, los archivos
   tocados como quedan y, si la rama es de una tarea (`ramas:` de su `task.md`), lo que la tarea pide: sólo
   `Objetivo`, `Specs`, `Criterios`, `Tarea (publicable)` y `En una línea`.
2. **Dos goldfish, en paralelo y en frío**: `claude -p --restricted --strict-mcp-config` desde esa carpeta, con sólo
   `Read`, `Grep` y `Glob`. No hay CLAUDE.md en ningún padre ni configuración que cargar: saben únicamente lo que el
   PR dice. Uno mira **si la descripción y el cambio dicen lo mismo** (`prompts/goldfish-intent.md`), el otro **qué
   puede salir mal** (`prompts/goldfish-risk.md`).
3. **Elephant**, desde la raíz del playground: el veredicto de cada hallazgo contra el código real (confirmado ·
   plausible · descartado, con archivo:línea; puede pedirle a `main-verifier`) y lo que sólo se ve con el playground:
   las trampas, el conocimiento de la tarea, las reglas de los PRs (`prompts/elephant-verdict.md`).
4. **Informe**: `goldfish/.runs/<id>/report.md` (fuera de git, con `package/`, que es EXACTAMENTE lo que vieron los
   goldfish). Si la rama es de una tarea, una copia en sus `artifacts/` y un bloque corto en su pila.

**Miguel resuelve**: decide qué corregir o qué comentarle al autor. Goldfish no comenta en GitHub, no aprueba ni
pushea: el elephant tiene negados `Edit`, `Write` y los `git` que escriben.

## Lo que hay que saber antes de tocarlo

- **El clon de cada repo** sale de `~/Desktop/CREDITOP/github/*` por su remoto. Si hay dos (`legacy-backend` y
  `legacy-backend-finandina`), el que se llama como el repo. ⚠ Los remotos usan alias de `~/.ssh/config`
  (`git@github.com-mig:…`): `reRemote` los acepta; sin eso no había clon para ningún repo. Un repo sin clon se lista
  («sin clon») pero no se valida.
- **Las respuestas de los agentes van con `--json-schema`** (`review/schemas.go`): se leen sin adivinar.
- **Cuesta**: tres corridas de `claude -p` por validación, del límite del plan de equipo; cada paso muestra su costo
  equivalente en dólares de la API. Medido el 2026-11-13: un PR externo de un archivo (+14) costó US$2,36 (cada
  goldfish ~US$0,08; el veredicto, US$2,19 en 93 s). Encontró que el PR duplicaba otro ya mergeado en qa y main.
- **Una validación «corriendo» guarda su proceso** (`pid`): al arrancar, el servidor marca cortadas sólo las de un
  proceso muerto.
- Las validaciones del primer día, por rama local y sin PR, quedan en `.runs/` pero ya no se listan.
- Identificadores en inglés; prompts y comentarios en español.
