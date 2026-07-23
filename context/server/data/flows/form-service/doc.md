# Form Service · referencia
> **estado:** al día con main (repo clonado 2026-07-23) · **MS Go** (v1.1.3, puerto **8082**, `VITE_FORM_SERVICE_BASE_URL`) dueño del **formulario dinámico G2** ("backend-driven", la pantalla `additional-info`). Sirve el schema desde 5 tablas legacy y **escribe las respuestas directo en `user_field_values` de la BD `creditop`** (borra-y-reinserta). Autor: José.

<!-- Este nodo resuelve la caja negra que dynamic-forms daba como "no verificable desde estos repos":
     ahora el repo está clonado (github/form-service) e indexado. -->

## Qué responde
- ¿El form-service persiste las respuestas de G2 en `user_field_values`? (dynamic-forms lo daba como pregunta abierta) → **SÍ**, verificado.
- ¿Dónde/cómo se arma el schema del form dinámico G2 y de dónde salen las opciones de los selects?
- ¿Cómo agrego/edito un campo del form (ej. una cascada Departamento→Ciudad)?
- ¿Qué valida el backend al guardar, y qué NO?

## Qué es
`form-service` es un microservicio **Go** (clean-arch: ports/adapters, `fx` DI, `gin`, oapi-codegen; ~220 archivos) que es el backend del **form dinámico G2** — el que el wizard renderiza en `additional-info` (la "información adicional" por entidad, ver nodo **dynamic-forms**). Lo consume el frontend vía el **workspace package `@creditop/backend-driven-form`** (no en el source de `apps/`, sino en `modules/loan-request-wizard/backend-driven-form/`). Es transversal: cualquier entidad con un `form_type` activo (hoy: **Credifamilia**, `form_type` **id 6**) pasa por acá.

Es el más nuevo de los **tres** "form service" que conviven y que NO hay que confundir (ver dynamic-forms):
1. **form-service** (este, `VITE_FORM_SERVICE_BASE_URL`, `/v1/dynamic-form/...`) — G2, additional-info.
2. **onboarding-forms-service** (`VITE_ONBOARDING_FORM_SERVICE`, `/dynamic/{hash}/schema`) — wizard RD (G1).
3. legacy `/api/partners/dynamic-form/session` + pkg `@creditop/dynamic-form` — sesión del wizard RD.

## Contenido

### El modelo en una línea
**TEMPLATE (5 tablas legacy) → el MS lo arma en JSON → el front lo renderiza genérico → las respuestas, keyed por `field_id`, caen en `user_field_values`.** El MS es *stateless* sobre datos que ya viven en `creditop`: no inventa un modelo nuevo, re-sirve el modelo relacional de 2023 (`form_types`/`forms`/`fields`/`field_options`/`field_categories`) que ya usaba `application`.

### Tres capas de storage (`internal/infra/storage/module.go`, config `legacy_mysql`)
| store | rol | qué guarda |
|---|---|---|
| **MySQL `creditop`** (host `inertia-dev…rds`, DB `creditop`, user `admin`) | **sistema de registro** | lee las 5 tablas del template + `settings`/`countries`/`zones`/`cities`; **escribe `user_field_values`** (las respuestas) |
| **Redis** | cache | schemas / responses / country-tree / supplementary-info |
| **S3** | cache-aside durable | JSON del schema armado + del response + country-tree |

Repos MySQL wired en `module.go:20-30`: FormType/Form/Field/FieldOption/FieldCategory/Setting/Country/CountryZone/CountryCity/**UserFieldValue**/**UserRequest**.

### API (README §API + `openapi.yaml`)
- `GET|PUT /v1/dynamic-form/{form_id}/schema` — leer / (re)construir el schema. **`{form_id}` es el `form_type_id`** (naming flojo: la ruta lo llama `form_id`).
- `POST|GET /v1/dynamic-form/{form_id}/response/{user_request_id}` — guardar / leer respuestas. El `user_id` **NO** va en la URL: el MS lo resuelve desde `user_requests` (deuda, abajo).
- `GET|PUT /v1/field-options/country-tree[/{country_id}]` · `GET|PUT /v1/field-options/countries` — opciones de los selects grandes.
- `GET /v1/suplementary-info/user-info/{user_request_id}` — valores previos para pre-llenar (typo `suplementary` a propósito, el front lo replica).

### Cómo se ARMA el schema (`schema_builder.go` → `get_schema/usecase.go`)
`build(formID)` lee **las 5 tablas legacy en paralelo** (`errgroup`): `form_types.GetByID(formID)` + `forms.ListByFormTypeID(formID)` → `fields.ListByIDs` + `field_options.ListByFieldIDs` → `field_categories.ListByIDs`. El mapper (`dynamic_form_schema_mapper.go`) agrupa **campos en secciones por categoría** con el `sort`, y valida ≥1 sección (si no → `SchemaNotFound`). `GET /schema` es **cache-aside**: Redis → S3 → rebuild MySQL (`get_schema/usecase.go`). `PUT /schema` fuerza `BuildAndReplace` (rebuild + pisar cache).

### Cómo se GUARDAN las respuestas (`store_response/usecase.go`) — 11 pasos
1. Rechaza answers vacío.
2. **Resuelve `userID` desde `userRequestID`** con un round-trip extra a la tabla legacy `user_requests` (deuda auto-documentada, ver Gotchas).
3. Probe Redis (¿había cache?).
4. Arma `ResponseRecord{FormID, UserID, UserRequestID, Answers}`.
5. Proyecta a filas `UserFieldValue` (`dynamic_form_response_mapper.go`): cada **key del answer se parsea como `field_id` int>0** (si no, "invalid field id"); el value es string tal cual, o **JSON** si es número/bool/compuesto; dedup por field_id (último gana), orden ascendente.
6. **`ReplaceValues` = `DELETE … WHERE form_id=? AND user_id=? AND user_request_id=?` + `INSERT` en UNA transacción** (`user_field_value_queries.sql`, .sql → no indexado). O sea **borra-y-reinserta**, no upsert; `status=1` hardcodeado, `file`/`file_name` NULL.
7-8. Serializa + sube el JSON a S3.
9-10. Evicta cache de response + de supplementary-info.
11. Devuelve el record.

→ **Esto explica las filas con `form_id=6`** en `user_field_values`: las escribe este MS, con `form_id` = el `form_type_id` de la URL. **`user_field_values` no tiene FK ni unique**: la unicidad la da el patrón DELETE+INSERT, no la BD.

### Las opciones de los selects: el country-tree (`country_tree_builder.go`)
`PUT /v1/field-options/country-tree/{countryId}` lee `country_zones` (departamentos, `status=1`) + `country_cities` (por `country_zone_id IN`) y arma el árbol país→zona→ciudad, cache en S3/Redis. **Colombia = country_id 47** (36 departamentos / ~1123 municipios en dev). El front pide este árbol y filtra las ciudades por la zona elegida (ver dynamic-forms G2 / la cascada). Un campo `select` referencia el árbol con `data_source='field_options.country_tree.zones'` (departamento) o `'…zones.cities'` (ciudad).

### El consumidor front: `@creditop/backend-driven-form` (workspace pkg)
Usado por la ruta `additional-info` (`additional-info.tsx` → gate, `additional-info-form.tsx` → render). 6 repos; el **split** es claro:
| repo | endpoint | backend |
|---|---|---|
| `form-type.repository` | `GET /api/loans/customer/{lrId}/form-type` | **legacy** (qué form aplica, por lender) |
| `dynamic-form-schema.repository` | `GET {FORM_SERVICE}/v1/dynamic-form/{formTypeId}/schema` | **form-service** |
| `save-form-response.repository` | `POST {FORM_SERVICE}/v1/dynamic-form/{formTypeId}/response/{userRequestId}` | **form-service** |
| `supplementary-info` / `countries` / `country-tree` | `GET {FORM_SERVICE}/v1/…` | **form-service** |

`additional-info-form.tsx` fetchea los 4 (schema+country-tree+countries+supp) en el **loader (SSR)** — lo pega el Node del wizard, no el browser; si `supp` falla igual renderiza (solo se pierde el pre-llenado). El submit manda el **nombre** (label) de zona/ciudad, no el id (`resolve-submit-answer-value.ts`).

## Dónde mirar
- **Wiring / entrada** (form-service): `cmd/http-server/main.go`, `internal/infra/storage/module.go` (repos), `internal/core/usecases/module.go`.
- **Schema (armado + cache-aside)**: `internal/core/usecases/dynamic_forms/schema_builder.go`, `schema_persistence.go`, `get_schema/usecase.go`, `internal/core/mappers/dynamic_form_schema_mapper.go`.
- **Response (persistencia)**: `internal/core/usecases/dynamic_forms/store_response/usecase.go`, `internal/core/mappers/dynamic_form_response_mapper.go`, `internal/infra/storage/mysql/repositories/user_field_value_repository.go` (+ `user_field_value_queries.sql`, .sql, no indexado), `user_request_repository.go` (el round-trip).
- **Validación (solo estructural)**: `internal/infra/handlers/http/dynamic_form_response/validators.go`, `http_handler.go`.
- **Country-tree (cascada)**: `internal/core/usecases/field_options/country_tree_builder.go`, `internal/infra/storage/mysql/repositories/country_zone_repository.go`, `country_city_repository.go`.
- **Front (pkg @creditop/backend-driven-form)**: `modules/loan-request-wizard/backend-driven-form/src/infrastructure/repositories/{dynamic-form-schema,save-form-response,form-type,country-tree}.repository.ts`, `application/resolve-country-tree-options.ts`, `resolve-submit-answer-value.ts`; ruta `apps/loan-request-wizard/app/routes/additional-info-form.tsx` (+ `additional-info.tsx` gate).
- **Quién decide el form (legacy)**: `legacy-backend/Modules/Loans/App/Services/FormTypeService.php`.

## Frontera de simulación / harness
- **Para VER el form renderizado**: va por el flow **`self-service`** (público, sin auth) — NO `merchant` (el `public-layout` rebota `merchant`→`/`). URL: `/self-service/{branchHash}/{ur}/additional-info/{formTypeId}`. Renderiza SSR desde el form-service; alcanza `form-service.inertia-develop:8082` desde esta máquina. Spec de captura: `frontend-e2e/dev/credifamilia-form.spec.ts`.
- **`bin/asesor` ahora pasa `VITE_FORM_SERVICE_BASE_URL`** (antes NO → el loader fetcheaba a `undefined` y el form G2 nunca renderizaba en el harness).
- **En local NO hay mock G2**: el `mock-forms` del harness es del OTRO servicio (onboarding-forms-service, RD) y no cubre `/v1/dynamic-form` ni `/v1/field-options`. Local apunta igual a dev.
- Probado E2E en dev: `GET/PUT schema` + `POST response` → filas en `user_field_values`.

## Gotchas / riesgos
- **Sobre-ingeniería en infra, sub-ingeniería en dominio.** 3 stores (MySQL+Redis+**S3**) para datos 100% derivables de MySQL: S3 como 2º tier de cache sobre lo derivado compra poco y el `store_response` gasta párrafos justificando la consistencia MySQL-antes-que-S3.
- **NO valida semántica al guardar** (`validators.go`): chequea solo que la key sea int>0 y el value string-no-vacío **o entero**. NO chequea que el `field_id` pertenezca al `form_type`, ni tipo, ni requeridos → **el schema se autoría en el backend pero se enforcea en el front**; un cliente roto escribe basura tipada como string y los document builders la leen por magic-number.
- **Contradicción validator↔mapper**: el validator acepta solo string|entero, pero el mapper (`responseValueString`) está hecho para arrays/bool/JSON → esa rama del mapper es **prácticamente código muerto**, y **decimales / multiselect NO pasan** salvo como string. Para un form de crédito (montos con centavos, multiselección) es una limitación real.
- **Deuda auto-documentada del `user_id`**: la URL se redujo de `/response/{user_id}/{user_request_id}` (v1.1.0) a `/response/{user_request_id}`, forzando un round-trip a `user_requests` en cada POST. El propio docblock lo marca y culpa al front ("no persiste `user_id` … design error on the client side").
- **`{form_id}` de la ruta = `form_type_id`** (naming flojo). Y `user_field_values.form_id` = ese mismo id (para Credifamilia = 6).
- **El `form_type` de Credifamilia (id 6) NO tiene seeder** en ningún repo: es data cargada a mano en dev/local (dynamic-forms lo dice: sin seeders de `fields`/`forms`). Un campo nuevo se agrega por **migración/seeder en legacy-backend** resolviendo por NOMBRE (los ids de `fields` son auto-increment y difieren por ambiente).
- **`GET /schema` es cache-aside** → tras tocar la BD (agregar/editar un campo) hay que **`PUT /v1/dynamic-form/{id}/schema`** o el front sigue viendo el schema viejo.

## Preguntas abiertas
- [ ] ¿`ONBOARDING_FORMS_SERVICE_BASE_URL` (G1) y `VITE_FORM_SERVICE_BASE_URL` (G2/este) apuntan al mismo despliegue? Son paths y contratos distintos; este es `form-service.inertia-develop:8082`, el otro `onboarding-forms-service.inertia-develop:8092`.
- [ ] ¿Quién ejerce los `PUT` de schema/field-options en producción (rebuild del cache)? En el harness lo hacemos a mano; falta el trigger real (¿un admin? ¿cron?).

## Bitácora
- **2026-07-23** — Nodo creado. Repo `github/form-service` clonado + indexado (build-index.py, alias `form-service`, 203 archivos). Resuelve la caja negra G2 de dynamic-forms: verificado que el MS escribe `user_field_values` (DELETE+INSERT), el schema sale de las 5 tablas legacy, y no valida semántica. Disparado por la tarea "agregar Ciudad de nacimiento en cascada al form de Credifamilia" (ver credifamilia / la migración `add_ciudad_de_nacimiento_field_to_credifamilia_form`).

## Enlaces
- Padre: **dynamic-forms** (el concepto de las 3 generaciones; este nodo es el backend de la G2). Consultado por: **credifamilia** (su additional-info es form_type 6), **onboarding** (el journey donde corre), **profiling** (lo que el form escribe, la decisión lo lee vía `user_field_values`).
- Repo: `github/form-service` (README.md · CHANGELOG.md · openapi.yaml · graphify-out/GRAPH_REPORT.md). No hay doc fuente en playground/docs; este nodo ES el análisis.
- Memorias: `form-service-dynamic-forms` (el mismo hallazgo + la receta de campo en cascada + cómo capturar el render), `onboarding-decision-data-map` (el EAV como insumo de decisión).
