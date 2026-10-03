---
name: canon
description: Consulta opcional de conocimiento de negocio o producto de CreditOp que no se puede comprobar en local. Usala cuando se elige consultar Canon o Miguel solicita publicar o mantener el corpus del equipo. No se activa por toda investigación técnica ni obliga a publicar hallazgos o cerrar tareas. Cubre make canon-* y su API.
---

# Canon · leerlo y dictarle

Canon es el corpus del equipo: **cómo funciona CreditOp**, lo que el código no dice solo. Vive en su
base (Postgres) y se sirve en canon.playground.creditop.com. Cada tema tiene su **prosa** (secciones con
ancla) y su **mapa** (áreas: un objetivo, sus archivos con el hash del blob y sus tablas). Cada escritura
es una revisión con autor, motivo y fecha; al confirmarse ya es conocimiento vigente para todos.

Todo sale de `CANON_URL`: por defecto **producción**, que pide la **VPN de prod**. Sin ella los comandos
dicen «canon no respondió». `CANON_URL=http://localhost:8080` apunta al canon local, que tiene **su
propia base**: sirve para ensayar, y lo que se escribe ahí no lo ve nadie.

## Leer — cuando hace falta conocimiento de negocio o producto

    make canon-search Q='monto avisado al comercio'     # qué sección (prosa) y qué área (mapa) lo cubren
    make canon-read IDS='cuota/context#<ancla>'         # la sección completa; varias por coma, o el tema
    make canon-code AREA=cuota/context N=2              # los archivos que declara esa área (de la copia local)

**Y está copiado en disco**: `tablero/canon/content/<tema>/context.md` (la prosa) y `map.json`
(las áreas con sus archivos y hashes), más `globalmap.json`, `tablas.json` y `diccionario.json`. Se lee con
rg y Read, sin VPN. Es una copia histórica: el arranque de sesión y el servidor del tablero no la
revalidan. El botón «Canon · opcional» solicita una actualización explícita (`VERSION.json` dice de cuál es).
**No se edita** (es de sólo lectura): lo que haya que cambiar se dicta abajo.

1. **Buscá con palabras del negocio, en español y cortas.** La búsqueda es léxica: una consulta en
   inglés o un relato largo no encuentran nada. Probá dos o tres formulaciones antes de concluir.
2. **Leé la sección entera** antes de citarla: un buen puesto en la búsqueda no garantiza que conteste.
3. **El silencio de Canon NO es «no existe».** Una afirmación técnica se verifica en `main`; una política de negocio sin fuente queda pendiente de verificar. No se dicta automáticamente.
4. En una tarea, lo que se usó se cita en su bloque como `[texto](canon:tema#ancla)` y el tema entra a
   `canon:` del frontmatter.

Los comandos son `tablero/server/cmd/canon` (Go, sobre el conector `connectors/canon`). Para
Python, `tools/canon.py` da `maps()`, `prose()`, `files_by_topic()`, `topics_by_repo()` y
`tables_by_topic()`: no lee canon, se lo pide a `canon corpus`, así que hay un solo cliente.

## Escribir — cuando Miguel solicita publicar o mantener Canon

La publicación no es parte obligatoria de una tarea local. Prepará una pieza revisable cuando se
solicita compartir conocimiento; tener un tema en `knowledge/` no autoriza su publicación.

**Qué entra** (`skills/dictar.md` del repo de canon): una regla técnica, de negocio o de producto **que existe en `main`**, incluidos sus errores.
**No entra:** la crónica (quién lo descubrió, cómo se probó), un PR sin mergear, ni lo que la tarea en
curso agregó y todavía no está en `main`.

**Antes de escribir, verificala** (el subagente `main-verifier` lo hace y devuelve archivo:línea con su commit): `git show origin/main:<ruta>` en **los dos monolitos**
(`legacy-backend` y `legacy-application`). Medir en producción (`make trazador-sql TARGET=prod`) sirve
para entender qué camino pesa, pero **la medición no va a la prosa**: ni cifras del ambiente ni fechas de
cuándo se midió o descubrió algo. Caducan, no ahorran leer el código y el agente las repite como regla;
el lint las rechaza. Entra lo que el código no dice o lo que ahorra leerlo.

1. **Armá la pieza** (`piece.json`, formato abajo).
2. `make canon-propose PIECE=piece.json` — no escribe; dice `ready`, qué rechaza el lint y dónde iría.
   Para un lote de piezas (o una `operacion:"verificado"`, que `canon-propose` no entiende):
   `make canon-write DRY=1 PIECE='a.json b.json'` hace el recorrido entero SIN cerrar —cada pieza al borrador,
   con sus avisos y los archivos que un `verificado` releería— y abandona el borrador. No escribe.
3. `make canon-write PIECE=piece.json TITLE='…'` — **escribe**: abre el borrador, manda cada pieza y
   cierra en una sola revisión. Si algo falla, abandona el borrador y no queda nada a medias.
4. Verificá con `make canon-search` que aparece, y dejá en la tarea un bloque con la cita.

**Cuando una pieza no alcanza** (un archivo que main borró o renombró: un `verificado` no reapunta el mapa), se
reescribe el archivo entero: `make canon-export DIR=<carpeta nueva>` baja el corpus de HOY, se edita el
`content/<tema>/map.json`, y `make canon-patch DIR=… REASON='…'` ensaya (valida el corpus resultante y muestra
el diff); con `APPLY=1` publica. Sólo viajan los archivos que cambiaron, y canon lo rechaza si el corpus
cambió desde el export. ⚠ No se edita sobre `tablero/canon`: esa copia puede ir atrás.

**Para saber qué falta ponerse al día:** `make canon-round` es la ronda del SERVIDOR (qué archivos que el corpus declara
cambiaron en main; sale 1 si alguno). Compara contra los clones del servidor, así que si main avanzó hace un rato,
primero `make canon-clones SYNC=1` (los refresca; `make canon-clones` dice a qué commit llega cada uno) y después
`make canon-round FORCE=1`: el servidor cachea la ronda diez minutos y sin `FORCE` puede decir «al día» con un merge
de hace minutos sin ver.

Por debajo es la API con la llave de escritura (`CANON_WRITE_KEY`, en el `.env` de `tools/canon`):
`POST /api/draft` → una pieza por sección con `POST /api/draft/{id}` → `POST /api/draft/{id}/close`,
que valida el corpus entero y guarda todo en una revisión. `POST /api/propose` ensaya sin escribir.

### La pieza

```json
{
  "node": "cuota/context",
  "section": "Al comercio se le avisa lo financiado, no el total de su pedido",
  "text_file": "seccion.md",
  "kind": "addition",
  "source": "verified",
  "verified": "2026-09-23",
  "as_asked": "¿por qué el monto que le llega al comercio no coincide con el total del pedido?",
  "objetivo": "Avisarle a la tienda el veredicto de una compra: qué monto se le manda y de dónde sale.",
  "se_deduce_leyendo": "cómo se calcula el monto que se avisa y qué campo lo lleva en cada plataforma",
  "archivos": {"legacy-backend": ["Modules/Onboarding/App/Services/EcommerceRequestService.php"],
               "legacy-application": ["app/Http/Controllers/Customer/WoocommerceController.php"]},
  "tablas": ["user_requests", "ecommerce_requests"]
}
```

- `section` es el **título**; el ancla sale de él. Mismo `node` + `section` **reemplaza** la sección:
  corregir es reescribir, no agregar otra al lado (`kind: "correction"`). Reenviar el mismo texto con
  `archivos` es cómo se le declara el área a una sección que ya existe: la prosa queda igual.
- `text` o `text_file` (ruta relativa a la pieza): prosa en markdown, sin el título. Tope: 600 palabras.
- `objetivo` y `se_deduce_leyendo` son del **área** que nace con los archivos: una frase de negocio, no
  el título otra vez. Sin ellos el área nace con un eco del título que le compite en la búsqueda.
- `archivos` usa los nombres de repo de canon (`legacy-application`, no `application`) y se valida
  contra `main`. Un archivo que otra área ya declara no crea área nueva: la sección se **enlaza** a ésa.
- `source`: `verified` (leído en el código) · `measured` (medido) · `testimony` · `inference`.

## Mantenerlo al día — lo que mergea OTRO

Dictar cubre lo que mergeás vos. Lo que mergea el resto del equipo entra sin que nadie lo escriba, y
el hueco no avisa. **El bucle, probado el 2026-08-16 sobre el árbol que precedió a canon y que encontró
dos funcionalidades invisibles:**

1. **`go run . -ronda`** desde el repo de canon (`~/Desktop/CREDITOP/github/playground/tools/canon`) —
   qué archivos declarados cambiaron en `main` o desaparecieron. Cada área declara sus `fuentes` con el
   **hash del blob** contra el que se verificó, así que esto es una comparación exacta, no una
   estimación. ⚠ Y **`-peso`** ordena esa lista por actividad de 90 días: sin eso, el ranking mezcla un
   archivo que cambió una vez con el que cambia todas las semanas. ⚠ Los dos aportan cosas distintas, y
   está medido: Credifamilia salió de la deriva (un archivo repitiéndose en varios temas), y
   `can_check_preapproval` salió de mirar el cambio de un tema con deriva **baja**. Mirar sólo el
   ranking se pierde lo segundo.
2. Confirmá que el hueco es real: `git log main --oneline -- <ruta>` (cuándo entró y quién) + una
   búsqueda en canon (`make canon-search`). Si nadie lo menciona, ahí hay algo.
3. Leé el código que cambió, en `main` y en los dos monolitos.
4. **Verificá contra `main`** lo que devuelva, y recién ahí dictalo (arriba). ⚠ El cambio de prosa y el
   del hash van **juntos**: mover el hash sin releer dice «esto sigue siendo cierto» sin que nadie lo
   haya comprobado.
5. **Una sección nueva no revalida el área entera.** Agregar no es revisar; decir que revisaste lo que
   sólo ampliaste es la forma más barata de envejecer un corpus sin que se note.

## Trampas que ya costaron

- **El cierre del borrador rechazaba toda sección nueva** con «sin id estable» hasta
  `Creditop-SAS/playground#284` (desplegado el 2026-09-24): no acuñaba el id de la sección ni el del
  área. Si un cierre vuelve a decir eso, algo lo revirtió; el recurso directo
  `POST /api/topics/{tema}/sections {title, text, reason, author}` sí acuña el id, pero crea la sección
  **sin área** (sin archivos ni tablas que la vigilen).
- **El `.env` de `tools/canon` trae `POSTGRES_*` de un ambiente real.** Para correr el binario contra
  otra base no se carga ese archivo: se corre desde un directorio sin `.env` (el binario lee el del
  directorio actual) con `DATABASE_URL` explícito, que tiene prioridad. Un password con símbolos va
  codificado en la URL.
- **El campo del borrador es `draft_id`**, no `id`.
- `/api/propose` sin llave no aparece en el catálogo: con la de lectura, el ensayo no existe.

## Y lo que NO es canon

Las herramientas de este repo (harness, trazador, tablero, connectors) se documentan en su `CLAUDE.md`,
no en canon: el corpus describe CreditOp. Lo de una tarea va a su pila; una trampa del sistema, a
`tablero/data/traps/doc.md`.
