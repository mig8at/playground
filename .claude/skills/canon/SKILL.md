---
name: canon
description: Leer y escribir canon, el corpus compartido de CreditOp. Usala ANTES de investigar cómo funciona algo (buscar, leer la sección, ver el código que la respalda) y cada vez que aparezca una regla de negocio que canon no tiene y hay que dictarle (verificarla viva en main, ensayar la pieza, dictarla en una revisión). Cubre `make canon-*`, la API (/api/search, /api/read, /api/code, /api/propose, /api/draft) y sus trampas.
---

# Canon · leerlo y dictarle

Canon es el corpus del equipo: **cómo funciona CreditOp**, lo que el código no dice solo. Vive en su
base (Postgres) y se sirve en canon.playground.creditop.com. Cada tema tiene su **prosa** (secciones con
ancla) y su **mapa** (áreas: un objetivo, sus archivos con el hash del blob y sus tablas). Cada escritura
es una revisión con autor, motivo y fecha; al confirmarse ya es conocimiento vigente para todos.

Todo sale de `CANON_URL`: por defecto **producción**, que pide la **VPN de prod**. Sin ella los comandos
dicen «canon no respondió». `CANON_URL=http://localhost:8080` apunta al canon local, que tiene **su
propia base**: sirve para ensayar, y lo que se escribe ahí no lo ve nadie.

## Leer — antes de investigar, siempre

    make canon-search Q='monto avisado al comercio'     # qué sección (prosa) y qué área (mapa) lo cubren
    make canon-read IDS='cuota/context#<ancla>'         # la sección completa; varias por coma, o el tema
    make canon-code AREA=cuota/context N=2              # los archivos que declara esa área

1. **Buscá con palabras del negocio, en español y cortas.** La búsqueda es léxica: una consulta en
   inglés o un relato largo no encuentran nada. Probá dos o tres formulaciones antes de concluir.
2. **Leé la sección entera** antes de citarla: un buen puesto en la búsqueda no garantiza que conteste.
3. **El silencio de canon NO es «no existe».** Si no está, la pregunta va a `workers/` (derivado de
   `main`) o al código, y si resulta una regla viva, se dicta (abajo).
4. En una tarea, lo que se usó se cita en su bloque como `[texto](canon:tema#ancla)` y el tema entra a
   `canon:` del frontmatter.

Los comandos son `tablero/server/cmd/canon` (Go, sobre el cliente `internal/canon` del tablero). Para
Python, `tools/canon.py` da `maps()`, `prose()`, `files_by_topic()`, `topics_by_repo()` y
`tables_by_topic()`: no lee canon, se lo pide a `canon corpus`, así que hay un solo cliente.

## Escribir — cuando aparece una regla que canon no tiene

**Qué entra** (`skills/dictar.md` del repo de canon, y `tablero/CLAUDE.md` §«Cuando aparece una regla de
negocio»): una regla técnica, de negocio o de producto **que existe en `main`**, incluidos sus errores.
**No entra:** la crónica (quién lo descubrió, cómo se probó), un PR sin mergear, ni lo que la tarea en
curso agregó y todavía no está en `main`.

**Antes de escribir, verificala:** `git show origin/main:<ruta>` en **los dos monolitos**
(`legacy-backend` y `legacy-application`), `git log -S` para saber desde cuándo, y si se puede, cuánto
pasa en producción (`make trazador-sql TARGET=prod`). Un dato de un sistema vivo va con su fecha en la
misma frase.

1. **Armá la pieza** (`pieza.json`, formato abajo).
2. `make canon-propose PIECE=pieza.json` — no escribe; dice `ready`, qué rechaza el lint y dónde iría.
3. `make canon-write PIECE=pieza.json TITLE='…'` — **escribe**: abre el borrador, manda cada pieza y
   cierra en una sola revisión. Si algo falla, abandona el borrador y no queda nada a medias.
4. Verificá con `make canon-search` que aparece, y dejá en la tarea un bloque con la cita.

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

Las herramientas de este repo (harness, trazador, tablero, workers) se documentan en su `CLAUDE.md`,
no en canon: el corpus describe CreditOp. Lo de una tarea va a su pila; una trampa del sistema, a
`tablero/data/traps/doc.md`.
