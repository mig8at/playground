# CREDITOP · ERD del deber-ser

Visualizador interactivo (Vue 3 + [Vue Flow](https://vueflow.dev/)) del **modelo de dominio v4** de
CreditOp: 105 entidades agrupadas en 8 contextos, cada una con su mapeo a la tabla real del legacy.

> ## ⚠ Esto NO es el esquema actual
>
> Todo lo que ves acá es el **DEBER-SER** — un rediseño propuesto, no lo que corre en producción.
> Ninguna de estas tablas existe con esta forma en la BD. Si venís a entender **cómo funciona
> CreditOp HOY**, este no es el lugar: andá a **[`../context/docs/ROUTE-MAP.md`](../context/docs/ROUTE-MAP.md)**
> (índice del árbol de contexto, 33 nodos con su "cuándo usar cada uno") y arrancá por
> [`../context/server/data/flows/creditop/doc.md`](../context/server/data/flows/creditop/doc.md).
>
> El puente entre ambos mundos vive **acá adentro**: [`CONTEXT.md`](docs/CONTEXT.md) (what-is en inglés,
> con rutas de archivo) y [`docs/audit/REALIDAD-ACTUAL.md`](docs/audit/REALIDAD-ACTUAL.md) (lo mismo
> en español). Los dos son de **2026-06-03**: tratalos como fotos con fecha, no como estado vivo.

---

## Por qué existe

El esquema físico de CreditOp tiene **212 tablas** (verificado: `docs/audit/real_tables.txt`) con
deudas que se arrastran de años — una tabla por integración, la misma condición de elegibilidad
copiada en 140 lenders, catálogos como tablas, `country_id=1` (Afganistán) de default en una
operación colombiana. El deber-ser las reorganiza en **105 entidades / 21 agregados**, y —esto es lo
que hace la app útil en vez de decorativa— **cada entidad conserva el puntero a su tabla legacy**.

O sea: no es un ERD lindo. Es un **mapa de traducción** entre el rediseño y lo que hoy existe, y por
eso el panel de detalle te muestra qué tablas viejas colapsó cada entidad y qué columnas se
"redujeron" y a dónde.

El giro conceptual detrás de todo (el que justifica el modelo): **hoy sumar un lender / un comercio /
un país es escribir código; en el deber-ser es insertar filas.**

### Muestra de la traducción

| Hoy (físico) | Deber-ser | Por qué mejora |
|---|---|---|
| 4 tablas de transacción de cierre (`lender_transactions`, `payvalida_transactions`, `sistecredito_transactions`, `payment_gateway_transactions`) | 1 `LenderTransaction` (puerto + adapter) | Lender nuevo = un adapter, no una tabla ni un branch |
| 6 proveedores KYC, tabla propia cada uno (Jumio, CrossCore, Metamap, OCR, Netco…) | 1 `IdentityVerification` + VO `Provider` | Cambiar de proveedor sin tocar el esquema |
| 3 tablas de reglas (`lender_rules`, `group_rules`, `category_rules`) con la condición copiada | `RuleDefinition` referenciable | "Definir una vez, referenciar muchas" |
| Catálogos `*_statuses` / `*_types` como tablas | 75 value-objects | Lo que es un valor deja de ser una entidad |
| `cell_phone` UNIQUE **global** | unicidad por `(country_id, cell_phone)` | No colisiona al abrir otro país |
| Qué centrales consultar, en 6 bloques de `SP_Update_..._Risk_Centrals` | `CountryBureauPolicy` + `BureauFieldMapping` | El buró pasa a ser dato |

## Arranque rápido

```bash
cd ~/Desktop/CREDITOP/playground/domain-model
npm install
npm run dev        # http://localhost:5183 (abre solo)
```

Los **únicos tres scripts** de `package.json` son:

| Script | Qué hace |
|---|---|
| `npm run dev` | Vite dev server en **:5183** (`vite.config.ts`, `server.open: true`) |
| `npm run build` | `vue-tsc --noEmit` (type-check estricto) **y después** `vite build` → `dist/` |
| `npm run preview` | sirve el `dist/` ya construido |

Node 18+. `npm run build` verificado el 2026-07-19: pasa limpio (~850 ms, bundle 635 kB).
Hay también un `.claude/launch.json` con la config `erd` apuntando a `npm run dev` / puerto 5183.

## Qué ves en pantalla

Una sola vista (`/`, hash-router). La barra superior tiene:

- **Todos / Ninguno** + un **chip por contexto** con el conteo de entidades. Click = mostrar/ocultar.
- **Buscador**: matchea contra el nombre nuevo, la `key`, **la tabla legacy** (`legacy.tabla`),
  el texto de green-field (`legacy.ref`) y las **tablas absorbidas** (`legacy.absorbe`). Es la
  función más útil de la app: buscás `payvalida_transactions` y te dice en qué entidad terminó.

En el canvas, cada nodo es una tabla:

| Marca | Significado |
|---|---|
| `◆` en el título | aggregate root |
| `☁` + borde punteado | sistema externo (los 7 servicios AWS del contexto `platform`) |
| número en el ángulo | cuántas tablas legacy unifica esta entidad |
| `PK` ámbar / `FK` azul / sigla gris (`S3`, `SM`, `COG`…) | tipo de columna |
| franja verde + badge `nuevo` | columna que **no existe** en la tabla legacy (25 en total) |
| `↯` violeta | la columna publica un domain event (solo 2 en el modelo) |
| línea sólida vs punteada | relación interna (74) vs referencia entre contextos (127) |

Click en un nodo → **atenúa todo lo que no sea vecino directo** y abre el panel de detalle:
relaciones salientes, "referenciada por", las columnas con su descripción de negocio y su columna
legacy, las **columnas reducidas** (`legacy` → vía por la que se derivan ahora) y las **tablas
unificadas**. Los links del panel son clicables: saltás de entidad en entidad.

## La fuente de datos

Todo sale de **`src/data/modelo-dominio.json`** (314 kB, `version: 4.0`). Es self-contained: no hay
backend, no hay fetch. `src/lib/transform.ts` lo convierte en nodos/edges y hace el layout.

Cifras contadas contra el JSON (2026-07-19), no copiadas de nadie:

| | |
|---|---|
| contextos | 8 (`geography`, `identity`, `commerce`, `credit`, `origination`, `creditopX`, `decisioning`, `platform`) |
| entidades | **105** = 22 `aggregateRoot` + 76 `entity` + 7 `external` |
| agregados declarados | 21 |
| value-objects | 75 |
| relaciones | 201 (74 internas + 127 referencias entre contextos) |
| atributos | 893, de los cuales **831 con descripción de negocio (93 %)** |
| marcados `nuevo` | 25 · con ref AWS: 16 · que emiten evento: 2 |
| entidades green-field (sin tabla legacy) | 27 (0 con `absorbe`, 1 con `reducidas`) |
| entidades con `absorbe` / con `reducidas` (todo el modelo) | 6 · 11 |

### Convención de `entidad.legacy` (leer antes de tocar el JSON)

Confundir estos cuatro campos es el error más fácil de cometer acá:

| Campo | Qué es | Se valida contra |
|---|---|---|
| `legacy.tabla` | la tabla real base | `docs/audit/real_tables.txt` |
| `legacy.absorbe[]` | otras tablas reales que colapsaron en esta entidad | idem |
| `legacy.reducidas[]` | **columnas** (no tablas) colapsadas o derivadas, con el `via` que las reemplaza | — |
| `legacy.ref` con texto `green-field (...)` | entidad **nueva a propósito**, sin tabla legacy | — |
| atributo con `nuevo: true` | **columna** nueva del deber-ser; distingue "es nueva" de "me olvidé de mapearla" | — |

## Cómo está armado

```
src/
  data/modelo-dominio.json   la fuente de verdad (v4.0)
  lib/types.ts               tipos que reflejan el JSON
  lib/transform.ts           JSON→nodos/edges, colores y labels de contexto, layout dagre por cluster
  components/TableNode.vue   el nodo de tabla (header + columnas + handles por columna)
  components/DetailPanel.vue el panel lateral
  views/ErdView.vue          la vista única: Vue Flow + chips + búsqueda + persistencia
  router/index.ts            hash-router con UNA ruta: "/"
  App.vue / main.ts          shell + bootstrap
scripts/
  audit-legacy-refs.mjs      regenera docs/audit/ground-truth.json (cruce determinístico)
  apply-alignment-fixes.mjs  §1-§3 de docs/audit/ALINEAMIENTO.md → muta el JSON (idempotente)
  apply-alignment-fixes-2.mjs §4 y §6 de ALINEAMIENTO.md → idem
  db.sh                      helper para consultar la BD local
docs/                        el rastro de cómo se llegó al modelo (ver abajo)
```

Los tres `.mjs` **no tienen entrada en `package.json`** — se corren a mano:

```bash
node scripts/audit-legacy-refs.mjs      # read-only sobre el JSON; escribe ground-truth.json
node scripts/apply-alignment-fixes.mjs  # MUTA src/data/modelo-dominio.json
node scripts/apply-alignment-fixes-2.mjs
```

El primero, corrido hoy: **0 referencias rotas** · 71 entidades mapeadas a tablas existentes · 27
green-field marcadas OK · 7 externas · 0 "nuevas sin marcar". El modelo no apunta a ninguna tabla
que no exista.

### BD local (opcional, para contrastar contra la realidad)

`apply-alignment-fixes-2.mjs` resuelve tipos desde `docs/audit/real_columns.tsv`, que salió de una
copia local del dump de dev en Docker. Para regenerarlo o para verificar cualquier cosa:

```bash
bash scripts/db.sh "SHOW TABLES;"
bash scripts/db.sh "DESCRIBE lenders;"
docker exec legacy-backend-mysql-1 mysql -uroot -ppassword creditop -e "SELECT COUNT(*) FROM user_requests;"
```

Contenedor `legacy-backend-mysql-1`, base `creditop`. Detalle y cómo refrescar dev→local en
[`CLAUDE.md`](CLAUDE.md). **Sin ese contenedor levantado, `db.sh` falla pero la app funciona
igual** — la viz no depende de la BD para nada.

## Gotchas

- **Las posiciones se guardan en `localStorage` y no hay botón para resetearlas.** La clave es
  `creditop-erd-positions-v1`. Si arrastraste nodos y querés volver al layout automático, no hay UI:
  `localStorage.removeItem('creditop-erd-positions-v1')` en la consola y recargá.
- **No hay "Auto-organizar" ni toggle LR/TB.** El layout es `layoutClustered(..., cols=3, dir='TB')`
  hardcodeado en `ErdView.vue:36`. Si querés otra dirección, se toca el código.
- **El buscador está en AND con los chips de contexto.** Si tenés un contexto apagado, lo que busques
  ahí no aparece aunque matchee. El contador de resultados sí lo respeta, así que "0 resultado(s)"
  puede significar "está filtrado", no "no existe".
- **El JSON tiene ~15 secciones que la app NUNCA renderiza**: `eventos`, `decision`, `politicas`,
  `estados` (catálogo + transiciones), `patronesCierre`, `roles`, `rolesDeberSer`, `paises`,
  `tiposDocumento`, `separacionData`, `referencias`, `cambiosV2`/`cambiosV4`, `preguntasAbiertas`
  (15 dudas abiertas), `fueraDeAlcance`. Hay conocimiento real ahí que solo se ve leyendo el archivo.
- **El `nota` y el `cambiosV4` del propio JSON están desactualizados**: dicen "12 agregados / 71
  entidades" y hoy son 21 y 105. Los scripts de refinamiento crecieron el modelo y nadie tocó el
  encabezado. No los cites.
- **22 entidades tienen `tipo: aggregateRoot` pero `agregados` lista 21.** La huérfana es
  `bonification`. Sin verificar si es intencional o un olvido.
- **93 %, no 100 %, de las columnas tienen descripción de negocio.** Las que más faltan:
  `identityValidationAttempt` (15), `bonification` (8), `socialStrataMultiplier` (7),
  `occupationMultiplier` (6), `termCapitalAdjustmentFactor` (6).
- **Las etiquetas de contexto en inglés viven en el código**, no en el JSON (`CONTEXT_LABELS` en
  `transform.ts`) — a propósito, para que sobrevivan a un refresh del modelo. El JSON las trae en
  español.

## Docs de esta carpeta

Están en orden cronológico de cómo se construyó el modelo; cada `apply-*` histórico nació de uno.

| Doc | Qué aporta |
|---|---|
| [`CONTEXT.md`](docs/CONTEXT.md) | **What-is en inglés** (2026-06-03): flujos end-to-end con rutas de archivo y línea, motor SQL de scoring, cierre por lender, deuda técnica. Para no releer `legacy-backend`/`application`. |
| [`CLAUDE.md`](CLAUDE.md) | Cómo consultar la BD local + convención de `entidad.legacy` + resumen de la arquitectura real. |
| [`docs/audit/ALINEAMIENTO.md`](docs/audit/ALINEAMIENTO.md) | El barrido modelo↔tablas reales: 0 refs rotas, 30 hallazgos de columna, gap inverso de 135 tablas no cubiertas. |
| [`docs/audit/REALIDAD-ACTUAL.md`](docs/audit/REALIDAD-ACTUAL.md) | Versión española y larga del what-is. |
| [`docs/HALLAZGOS-BD.md`](docs/HALLAZGOS-BD.md) | 5 dudas del modelo resueltas con `SELECT` read-only contra dev (canales N:M, `role`==`user_profile`, `multiple_allieds`, FKs colgantes). |
| [`docs/REFINAMIENTO-DEBER-SER.md`](docs/REFINAMIENTO-DEBER-SER.md) | Revisión multi-agente: promesas que el modelo declaraba en prosa y no modelaba. |
| [`docs/VALIDACION-INVERSION.md`](docs/VALIDACION-INVERSION.md) | ¿Los actores se adaptan a CreditOp o al revés? Veredicto **PARCIAL**, área por área. |
| [`docs/AUDITORIA-REDUCCION.md`](docs/AUDITORIA-REDUCCION.md) | Cuánto más se puede simplificar: ~95-110 columnas y ~13-16 entidades, priorizado por impacto/riesgo. |
| [`docs/DISENO-EVALUABLE-FIELD.md`](docs/DISENO-EVALUABLE-FIELD.md) | Diseño del registro de *facts* (`EvaluableField`) que abre el espacio de reglas sin código. |
| [`docs/TRABAJO-REGLAS-SIMPLIFICACION.md`](docs/TRABAJO-REGLAS-SIMPLIFICACION.md) | Brief autocontenido para retomar el hilo de reglas lender×merchant. |
| `docs/audit/*.json` `*.tsv` `*.txt` | Insumos crudos: 212 tablas reales, 2582 columnas, `ground-truth.json`, `value-objects.json`, 135 tablas no cubiertas. |

## Estado / punteros rotos conocidos

Este README se reescribió el **2026-07-19** contra el código. Lo que había antes documentaba diez
scripts `npm run apply-*` y dos páginas (`/por-que`, `/reglas`) que **no existen en el repo**: los
`.mjs` correspondientes no están en `scripts/` y el router solo tiene `/`. O el trabajo se revirtió,
o nunca se commiteó. Si aparecen en algún stash, hay que volver a documentarlos.

Punteros rotos que **quedaron sin arreglar** en otros archivos de esta carpeta (no los toqué):

- `CONTEXT.md:14` y `:41` → `../flows/` no existe (la carpeta hermana se llama `flow`, singular, y es
  otra cosa: el simulador de onboarding).
- `CONTEXT.md:51`, `CLAUDE.md:64`, `docs/audit/REALIDAD-ACTUAL.md:3` y `:13` → `playground/docs/`
  **fue borrado** de `main` (absorbido por `../context/`; recuperable con `git show 159906a:docs/…`).
- `docs/TRABAJO-REGLAS-SIMPLIFICACION.md:16` y `:142` → `CREDITOP-MODELO-DATOS.md` no existe en
  ningún lado del playground.
- `docs/HALLAZGOS-BD.md:7` → `queries-cuestiones-abiertas.sql` no existe.
