# context — mapa de conocimiento cross-repo (CreditOp)

Un árbol de **33 nodos curados** que le dice a un LLM *qué leer* antes de tocar CreditOp: por cada tema,
un análisis en prosa (`doc.md`) y la lista exacta de archivos fuente que hay que abrir (`map.json`),
apuntando a **6 repos** distintos. No es un buscador ni un índice automático: es curación a mano,
verificada contra el código.

Existe porque el conocimiento de CreditOp está partido en repos que no se referencian entre sí
(`legacy-backend` + `frontend-monorepo` + `application` + micros). Ningún `import` expresa el salto
frontend↔backend, y ningún grep te dice *cuáles* de los 5.711 archivos importan para tu tarea. El árbol
responde eso: elegís 2–4 nodos, leés sus docs, abrís sus archivos.

> **⚠ El MCP fue RETIRADO (2026-07-18, commit `50f689e`).** Se borró el server Go, el WebSocket, el
> conector stdio y el sistema de "derivar". **No lo reconstruyas.** Lo que quedó —y es lo que valía— es
> el contenido: `ROUTE-MAP.md` + los `flows/<id>/`, un toolkit Python de 92 líneas, y una viz Vue
> read-only que se agregó después (`f4e9d6d`).

---

## Arranque rápido

**Si sos un LLM (el caso principal): no corras nada.** Abrí [`ROUTE-MAP.md`](docs/ROUTE-MAP.md), leé los
`Cuándo:` de cada nodo, elegí 2–4 que matcheen la tarea, y abrí sus `doc.md` + `map.json`. Ese archivo
está diseñado para entrar entero en una ventana de contexto (~16 KB); los 4.275 renglones de doc no.

**Si sos un humano y querés VER la organización:**

```bash
cd /Users/miguelochoa/Desktop/CREDITOP/playground/context
npm install
npm run dev          # Vite en http://localhost:5193 — solo front, sin backend
```

La viz es **read-only**: lee `tree.json` + todos los `flows/*/{map.json,doc.md}` con `import.meta.glob`
y los renderiza (árbol de contextos a la izquierda, tasks con sus chips abajo, doc a la derecha).
Editás un `doc.md` y se actualiza sola por HMR. No hay nada que guardar desde la UI.

**Mantenimiento (después de tocar nodos o repos):**

```bash
python3 tools/build-index.py                          # reindexa los 6 repos → tools/index.txt
python3 tools/oracle.py server/data/flows/<id>/map.json   # ¿resuelven las rutas de ese nodo?
python3 tools/build-route-map.py                      # regenera ROUTE-MAP.md desde tree.json + los map.json
```

## El modelo: contextos, tasks, y dónde vive cada cosa

| Concepto | Qué es | Cuántos hoy |
|---|---|---|
| **root** | `creditop` — el tronco, material transversal y "no sé por dónde empezar" | 1 |
| **reference** | un tema acotado y reutilizable (`kyc`, `aggregator`, `formalization`, `findings`…) | 28 |
| **task** | trabajo concreto en curso; declara qué contextos consume | 4 |

La partición importa: un **contexto** describe cómo *es* el sistema y sobrevive a las tareas; una **task**
es efímera y se apoya en contextos (`motai-v2` → `motai`, `creditopx`, `merchants`, `dynamic-forms`, `kyc`).

**Dos archivos, dos responsabilidades:**

- `tree.json` → el **wiring**: qué nodo cuelga de cuál (`parent`) y qué contextos consume una task
  (`contexts`). Es lo único que define la forma del árbol.
- `server/data/flows/<id>/map.json` → el **contenido** del nodo: `name`, `kind`, `when` y `files[]`.
- `server/data/flows/<id>/doc.md` → el **análisis** en prosa. Es el producto real; todo lo demás es andamiaje.

El campo `when` es el que hace funcionar el ruteo: está escrito en el vocabulario con el que *llega* una
tarea ("el listado no muestra CrediPullman en el comercio X"), no en el vocabulario del código. Sin
embeddings, a propósito: el que decide qué abrir es el modelo leyendo esas líneas.

## Los 6 repos indexados

Las rutas de `files[]` son `alias/relpath`. Los alias se resuelven así (definido en `tools/build-index.py`
y duplicado en `tools/build-route-map.py`):

| alias | root | archivos indexados |
|---|---|---|
| `application` | `~/Desktop/CREDITOP/github/legacy-application` | 1.747 |
| `legacy-backend` | `~/Desktop/CREDITOP/github/legacy-backend` | 2.176 |
| `frontend-monorepo` | `~/Desktop/CREDITOP/github/frontend-monorepo` | 1.549 |
| `pre-approvals-service` | `~/Desktop/CREDITOP/github/pre-approvals-service` | 137 |
| `frontend-e2e` | `~/Desktop/CREDITOP/playground/frontend-e2e` | 78 |

Ojo con el alias `application`: apunta a la carpeta **`legacy-application`**. No son dos repos.

## El oráculo, y por qué existe

Una ruta mal escrita en un `map.json` **no falla en ningún lado**: la viz la cuenta, el LLM la lee, e
intenta abrir un archivo que no existe. Se cae en silencio. `oracle.py` es la defensa: compara los
`files[]` contra `tools/index.txt` y te dice qué no resuelve.

```
$ python3 tools/oracle.py server/data/flows/findings/map.json
KEPT 42 / DROPPED 0 (of 42)
```

**Un `DROP` tiene tres causas posibles, y solo una es un error tuyo:**

1. **Typo o archivo movido** — el caso que querés cazar.
2. **Extensión no indexada.** `build-index.py` solo indexa `.php .go .ts .tsx .js .jsx .mjs .cjs .vue`.
   Un `openapi.yaml`, un `.sql` o un `.md` del repo **siempre** va a dropear aunque exista. No los pongas
   en `files[]`; mencionálos en el `doc.md`.
3. **La rama checkeada no tiene el archivo.** El índice es un snapshot del *working tree*, no de `main`.

La causa 3 está viva ahora mismo y conviene entenderla antes de "arreglar" nada:

```
merchants  → 1 DROP     motai → 9 DROPs     motai-v2 → 7 DROPs
```

Los 9 archivos únicos (`AlliedMode.php`, `UserRequestMode.php`, `merchant-mode.tsx`, sus repos e
interfaces) **existen en `main`** — lo verifiqué con `git cat-file -e main:<path>`. Lo que pasa es que
`legacy-backend` y `frontend-monorepo` están hoy checkeados en `feature/motai-v2`, y esa rama los borró
(la des-motaización, commit `936f0a7c`). Los `map.json` están bien; el índice refleja otra rama.
**Antes de sacar una ruta de un `map.json`, fijate en qué rama están los repos.**

## Cómo está armado

```
context/
├── ROUTE-MAP.md      ← GENERADO · el índice que lee un LLM (33 nodos con su `Cuándo`)
├── tree.json         ← A MANO · el wiring: parent + contexts. Fuente de la forma del árbol
├── server/data/
│   ├── flows/<id>/   ← A MANO · 33 nodos: map.json (archivos) + doc.md (análisis)
│   └── doc-templates/  ← 6 plantillas: raiz · group · contexto · referencia · flujo · tarea
├── tools/
│   ├── build-index.py      ← camina los 6 repos → index.txt
│   ├── oracle.py           ← valida un map.json contra el índice
│   ├── build-route-map.py  ← tree.json + map.json → ROUTE-MAP.md
│   └── index.txt           ← GENERADO, gitignored (5.711 rutas)
├── src/App.vue       ← la viz read-only (142 líneas, mini-render de markdown sin deps)
└── package.json      ← solo vue + vite. NO hay scripts de server (los de Go murieron con el MCP)
```

`server/` ya no tiene código: sobrevive como carpeta de datos porque ahí vivían los flows del MCP y
mover 33 directorios rompería toda ruta citada en los docs.

## El nodo `findings` — buscá acá primero

[`server/data/flows/findings/doc.md`](server/data/flows/findings/doc.md) es la **bitácora viva**: 52
hallazgos (F-01..F-52) de cosas que costaron tiempo descubrir en local, agrupados en secciones A–L.
Cada uno trae síntoma → causa raíz verificada → evidencia → arreglo → estado.

Se lee al revés de lo que uno espera: **antes de depurar un muro en local, buscalo ahí**. Buena parte de
lo que parece un bug del producto es una variable de entorno faltante (F-04: `/lenders` da 500 en todo
local por H2O sin host) o un error que el front se traga en silencio (F-01, F-02) — y F-03 para el caso
simétrico: el harness reportando verde una corrida rota por un `.catch(() => {})` vacío.

Para agregar uno, seguí las reglas del propio doc: la causa raíz va **verificada** o marcada como
hipótesis, y si el síntoma engaña, decilo en el título.

## Gotchas

- **`tools/index.txt` está gitignored.** Si clonás fresco, `oracle.py` corta con
  `falta tools/index.txt → corré: python3 tools/build-index.py`. No es un bug.
- **`ROUTE-MAP.md` es generado.** Editarlo a mano se pierde al siguiente `build-route-map.py`. El
  `Cuándo` sale del campo `when` del `map.json` — editá ahí.
- **`kind` vive en el `map.json`, no en `tree.json`,** y gana. El nodo `payments` tiene `contexts` en
  `tree.json` pero `kind: reference` en su `map.json`, así que sale como referencia y no como task. Si
  querés que algo sea task, ponelo en el `map.json`.
- **Campos muertos.** `targets` y `baseline` en `tree.json`, y `combination` y `group` en los `map.json`,
  no los lee **nadie** (grepeado sobre `src/` y `tools/`): son restos del engine Go. No los mantengas.
- **La viz importa los 33 `doc.md` crudos al bundle** → `npm run build` escupe 845 kB y avisa por el
  tamaño del chunk. Es esperado, no lo optimices.
- **Las rutas `playground/docs/X.md` que veas por ahí son punteros históricos.** Esa carpeta se borró de
  `main` el 2026-07-17 (absorbida en estos nodos); se recupera con `git show 159906a:docs/<ruta>`. Los
  docs del árbol ya citan esa forma — no la "arregles".
- **Convención playground: commit local, sin push.** Nada de acá va a un PR.

## Relacionados

- [`ROUTE-MAP.md`](docs/ROUTE-MAP.md) — el índice de los 33 nodos. Punto de entrada de toda tarea.
- `server/data/doc-templates/*.md` — las 6 plantillas de doc, con comentarios HTML que explican qué va
  en cada sección. Usalas al crear un nodo nuevo.
- `../EXAMPLES.md` — cheatsheet de demos visuales del wizard vía `frontend-e2e` (`bin/asesor`,
  split-view, dbops). El `../README.md` de la raíz es un stub de una línea, no un índice.
- Las otras herramientas del playground son directorios hermanos:
  `frontend-e2e`, `flow`, `soporte`, `domain-model`, `tools`.

---

*Verificado el 2026-07-19 contra el código: scripts de `package.json`, puerto en `vite.config.js`, los 3
tools de `tools/`, y las cuentas (33 nodos · 1.218 archivos únicos en 1.913 referencias · 4.275 líneas de
doc · 5.711 rutas indexadas). Lo único que no probé es levantar `npm run dev` — sí verifiqué que
`vite build` compila.*
