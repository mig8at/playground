---
id: 0
title: "Sacar el país del código y corregir el default Afganistán"
stage: work
created: "2026-08-24T10:00:00-05:00"
context_nodes: [entities, merchants, onboarding, hardcodes-entidades, smartpay]
jira: []
jira_title: ""
---

# Sacar el país del código y corregir el default Afganistán

## Si retomás esto sin contexto, empezá acá

Ocho consultas del producto preguntan literalmente `->where('country_id', 1)`, y **191 de las 192
entidades de prod tienen `country_id = 1`** — que es **Afganistán**. Funciona porque alguien editó esa
fila para que se comporte como Colombia (`locale es-CO`, `currency COP`, `cell_phone_lenght 10`). Esta
tarea desarma eso en el orden que **no** rompe producción.

**Lo que NO hay que volver a investigar** (medido el 2026-08-24, todo abajo como anotación): dónde están
los 8 filtros, cuántas tablas tienen el `DEFAULT 1`, qué le falta a la fila de Perú, y por qué el backfill
no puede ser una migración de Laravel.

Esta tarea es la **ejecución** de **CORE-365**, que el 2026-08-24 se reabrió y pasó a llamarse
**«Internacionalización de CreditOp»** (`tablero/data/internacionalizacion-onboarding.md`). Allá vive el
diagnóstico y la bitácora del hilo completo —incluida la corrección de rumbo en las ramas—; acá, el
detalle de lo que se está tocando. Antes de investigar de cero, leé la bitácora de esa tarea: casi todo
lo que parece una pregunta nueva ya está medido ahí.

**El próximo paso es:** abrir la rama en `legacy-backend` y cambiar los 3 filtros a
`whereIn('country_id', [1, $paisResuelto])`.

## Objetivo

Que **ninguna consulta del producto sepa en qué país está parada**: el país sale de la sucursal (o del
comercio), no de un literal. Y que `lenders.country_id` vuelva a ser configuración — que «sin definir»
sea distinguible de «definido mal».

La vara concreta: **dar de alta la entidad peruana sin tocar código**.

## Dónde se toca

**`legacy-backend`** — los 3 filtros literales (verificados contra `main` el 2026-08-24):

    Modules/Identity/App/Repositories/LenderRepository.php:52
    Modules/Onboarding/App/Services/OnboardingService.php:1782
    Modules/Onboarding/App/Services/lenders/LenderRetrievalService.php:470

Los tres tienen el mismo patrón, y el `country_id` ahí es **casi redundante** — la lista de entidades ya
salió de `LendersByAlliedBranch::where('allied_branch_id', …)`, o sea la sucursal ya acotó todo:

    Lender::where('status', 1)
        ->where('country_id', 1)
        ->whereIn('id', $lenders_by_allied_branch_ids)

⚠ **El gemelo de Onboarding ya hizo la mitad del trabajo, con la trampa puesta** —
`Modules/Onboarding/App/Repositories/LenderRepository.php:18` ya tiene la firma
`getActiveLendersByIds(array $lenderIds, int $countryId = 1)` y usa `->where('country_id', $countryId)`.
**El `= 1` de default es el problema**: si nadie le pasa el país, se comporta idéntico al hardcode. Hay que
matar el default, no sólo agregar el parámetro. Su interfaz:
`Modules/Onboarding/Contracts/Repositories/LenderRepositoryInterface.php:11`.

⚠ **El de `Identity` no recibe nada de dónde inferir** — hay que tocar la firma y la interfaz
(`Modules/Identity/Contracts/Repositories/LenderRepositoryInterface.php:15`). Sin llamadores visibles en
`main`: confirmar si está muerto antes de invertir en él.

**`legacy-application`** — los otros 5:

    app/Http/Controllers/Customer/ListLenderController.php:87
    app/Http/Controllers/Customer/PersonalInfoController.php:1329
    app/Http/Controllers/Customer/SimulatorController.php:44
    app/Services/lenders/LenderRetrievalService.php:174
    app/Services/lenders/LenderRetrievalService.php:459

Y el bloqueo duro que **no** es un filtro:

    app/Http/Requests/Admin/Allied/StoreRequest.php:57   →  Rule::in([47, 60])

Está en el **alta de comercio**: con los 8 filtros arreglados y el catálogo cargado, seguís sin poder
crear el comercio peruano. Debe pasar a «los países con `is_operating = 1`».

## El modelo de país — decidido

Tres tablas, tres preguntas distintas. **No son intercambiables**, y el filtro necesita dos de ellas:

| quién | contesta | estado en prod |
|---|---|---|
| **comercio** (`allieds.country_id`) | *«¿en qué país estoy parado?»* — el **contexto**: de ahí salen prefijo, moneda, burós, documentos | ✅ **ya está bien**: 317 en CO(47) · 14 en DO(60) · cero en 1 |
| **sucursal** (`allied_branches`) | nada: **hereda del comercio** | ✅ no tiene columna de país, y es deliberado |
| **entidad** (`lenders.country_id`) | *«¿en qué país opero yo?»* — un **atributo** de la fila, pegado a su economía (montos, tasas y cuotas están denominados en una moneda) | ❌ 191 en Afganistán · 1 en DO |

El filtro correcto es la **comparación** entre los dos extremos: *«de las entidades cableadas a esta
sucursal, dame las del mismo país que el comercio»*. Hoy, en lugar de esa comparación, hay un número
escrito a mano en el medio.

> **DECISIÓN · 2026-08-24** — el país **sale del comercio** (vía la sucursal que atiende) y se **compara**
> contra el de la entidad. No es «uno u otro»: el comercio da el contexto, la entidad es el atributo.

> **DECISIÓN · 2026-08-24** — la sucursal **no lleva país propio**. Sería una tercera copia del mismo dato
> y las copias se desincronizan (ya pasa con las reglas, copiadas 37.284 veces por sucursal). La cadena es
> sucursal → comercio → país.

> **DECISIÓN · 2026-08-24** — **una entidad pertenece a un solo país.** Si una entidad opera en dos, son
> dos filas de entidad, no una con dos países: la economía (`credit_line_by_lenders`) cuelga de
> `lender_id` y está denominada en moneda. Es lo que ya hace SmartPay en RD.

## Los tipos de documento — el dato ahora, la herencia después

**El modelo acordado**, y es el mismo que el del país: el **país define el universo** y la **sucursal
elige de ahí**. Ninguno de los dos manda solo — lo que se le ofrece al cliente es la intersección.

    países.document_types              ["CC", "CE", "PEP"]      ← qué EXISTE en el país
    lenders_by_allied_branches.        ["CC", "CE"]             ← qué ACEPTA esta sucursal
      document_types
    ────────────────────────────────────────────────────────
    lo que ve el cliente               ["CC", "CE"]             ← la intersección

**Lo que ya existe** (2026-08-25): la mitad de la sucursal está poblada —**7.164 de 7.211 filas**— y
**tiene lector**: `Loans\AlliedInfoController::resolveAllowedDocumentTypes` hace la unión de los
`document_types` de las entidades de esa sucursal y los expone como `allowed_document_types` en el
payload del comercio; el front los usa para el selector de `personal-info`. Y ahora la mitad del país
también está cargada, para los tres países que operan.

**Lo que falta es sólo el cruce.** Y es una línea — pero ⚠ **NO se puede hacer todavía**:

> **MEDICIÓN · 2026-08-25** — 🔴 **las sucursales de República Dominicana tienen cargados códigos
> COLOMBIANOS.** Las **17** filas de `lenders_by_allied_branches` de comercios del país 60 dicen
> `["CC","CE"]`; ninguna tiene `CED` ni `NUI`, que son los que sus propios clientes usan (medidos en
> `users`: CED 249, NUI 6). Es el mismo default ciego que puso 191 entidades en Afganistán.
>
> **Cruzar las dos listas hoy dejaría a RD sin ningún tipo de documento disponible** — intersección
> vacía. Primero hay que corregir ese lado.

**El orden, entonces:**

1. ✅ El país declara su universo (hecho: COL `CC/CE/PEP` · DOM `CED/NUI` · PER `DNI/CE`).
2. **Corregir las sucursales de RD** para que declaren los tipos de su país. Sin esto, nada más se puede
   hacer.
3. **Cruzar**: `resolveAllowedDocumentTypes` interseca contra el país del comercio. Una línea.
4. **La pantalla del admin** para elegir, por sucursal, cuáles de los tipos del país acepta. Es lo único
   que es trabajo de verdad, y lo que hoy obliga a editar la tabla a mano.
5. Y recién ahí, **quitar el `in:cc,ce`** de `CreditStudyRequest` y los enums quemados que el censo
   marcó en cuatro capas.

⚠ **Y el vocabulario es lo primero que hay que fijar**, antes del paso 2: hoy conviven `CC`, `CE`, `CED`,
`NUI`, `PEP`, `PAS` y `CI_VE` en `users` **sin catálogo** — nadie sabe qué es `NUI`, cómo se valida, cómo
se llama en pantalla ni qué se le manda a cada buró. Si el paso 2 se hace con códigos inventados, quedan
dos vocabularios para lo mismo, que es exactamente lo que pasó con `dial_code` y `phone_code`.

> **DECISIÓN · 2026-08-25 (Miguel)** — se carga **el dato ahora** y se cablea el comportamiento después.
> La objeción de que un dato sin lector se vuelve otra `address_format` es válida, pero acá el cruce **no
> se puede hacer todavía** por el estado del otro lado: cargarlo ahora es preparar el terreno, no
> abandonar una columna.

## Cómo se ataca

Tres pasos entregables por separado. **El orden es lo que evita la ventana rota.**

**P1 · el código acepta los dos mundos** (no destructivo, reversible)
Los 8 filtros → `whereIn('country_id', [1, $paisResuelto])` · matar el `= 1` del gemelo de Onboarding ·
firma + interfaz en Identity · `Rule::in([47, 60])` → países operativos. Un PR por repo. **Deploy.**
Esto solo ya desbloquea a BCP.

**P2 · el catálogo, como dato** (aditivo, independiente de P1 — puede ir en paralelo)
Migración: arreglar la fila **167** de Perú (`dial_code +51`, `cell_phone_lenght 9`, `locale es-PE`) ·
normalizar las 4 filas `es_XX` → `es-XX` (BCP-47) · agregar `is_operating` (true sólo 47/60) · seed de
LatAm con `is_operating = 0` · quitar el `DEFAULT 1` de las 9 tablas.

**P3 · devolver cada entidad a su país** (sólo con P1 **en producción**)
Comando de artisan idempotente con `--dry-run` y snapshot previo · las 139 que la inferencia resuelve ·
las 28 sin cablear **a mano** · limpiar el `1` del `whereIn` · y **al final**, la fila 1 vuelve a ser
Afganistán de verdad.

## Lo que se evaluó y NO se eligió

**Arreglar la fila de Afganistán primero.** Es lo intuitivo y es lo que rompe producción: la fila 1 hoy es
un **impostor funcional** (`es-CO`/`COP`/10 dígitos), y mientras 139 entidades apunten ahí, esa mentira es
lo único que las hace andar. Devolverle sus datos afganos reales antes de mover las entidades rompe la
moneda y la validación de celular de toda la operación colombiana. Va al final, no al principio.

**El backfill como migración de Laravel.** Descartado por dos razones medidas. (1) Un
`UPDATE lenders SET country_id = 47 WHERE country_id = 1` reemplaza un default silencioso por otro default
silencioso — exactamente el bug original, un piso más arriba; el dry-run del 2026-08-24 lo demuestra
mandando **BCP Consumo a Colombia**. (2) Una migración de datos que pisa `country_id` no tiene `down()`
honesto: perdido el «estaba en 1», ya no se distingue lo que movió el script de lo que siempre estuvo bien.
Va como comando con dry-run y snapshot.

**Mover los datos primero y después el código.** El radio de explosión está medido: 139 entidades activas
salen del default y las tres consultas de backend las dejan **fuera del listado sin lanzar error**. Nadie
se entera hasta que llama un comercio.

## Lo que está decidido

> **DECISIÓN · 2026-08-24** — **código primero (deploy), dato después.** Nunca al revés. El `whereIn` con
> los dos valores existe para que no haya un instante roto entre los dos deploys.

> **DECISIÓN · 2026-08-24** — el backfill **no** va como migración: comando de artisan con `--dry-run` y
> snapshot previo.

> **DECISIÓN · 2026-08-24** — la fila 1 se restaura a Afganistán **en la última migración de la serie**,
> nunca antes de mover las entidades.

> **DECISIÓN · 2026-08-24** — CORE-365 se cerró como `✅ Terminada`. Su ejecución terminó; su diagnóstico
> sigue siendo la fuente hasta que gradúe a un nodo de `context/`.

## Lo que está bloqueado

> **PREGUNTA · 2026-08-24 · Miguel** — ¿esta tarea lleva **todo** (P1 + P2 + P3) o se parte en tres? Se
> decide después de adelantar P1 y ver cuánto pesa de verdad.

> **PREGUNTA · 2026-08-24 · negocio** — el seed de LatAm: ¿qué países entran? ¿Sudamérica + México +
> Centroamérica + Caribe hispano, o un recorte que el negocio ya use en algún lado?

> **PREGUNTA · 2026-08-24 · negocio** — las **28 entidades sin cablear** (25 activas): no hay de dónde
> inferir su país. ¿A cuál van, o se apagan?

> **PREGUNTA · 2026-08-24 · negocio** — `cell_phone_lenght` de DO = **11** en prod (CO = 10). ¿Significa
> «con el 1» o está mal? Viene abierta de CORE-365 y hay que resolverla antes de que el front la lea.

## Riesgos

> **RIESGO · 2026-08-24** — si el backfill corre antes de que P1 esté **desplegado**, 139 entidades activas
> desaparecen de los listados **sin error**.

> **RIESGO · 2026-08-24** — si la entidad peruana se crea en prod con `country_id = 167` antes de P1, nace
> **invisible** para los 8 filtros. Hoy hay margen: BCP no existe en prod (sí en dev, id 206).

> **RIESGO · 2026-08-24** — `dev` y `staging` **comparten la BD**: una migración corrida en dev toca las dos.

> **RIESGO · 2026-08-24** — quitar el `DEFAULT 1` toca **9 tablas**, no sólo `lenders`. Cualquier `INSERT`
> que hoy se apoye en el default empieza a fallar: hay que revisar los seeders y las altas.

## Lo que NO entra

El front por país (la lista quemada `[+1, +57]`, la moneda de `formatCurrencyWithSymbol` y sus 58 formateos
manuales), el resolvedor único `CountryContext` con los 4 `$isDoLogic`, los tipos de documento por país, la
geo de Perú (árbol departamento→provincia→distrito), `'COP'` en la firma de Wompi, y la graduación del
diagnóstico de CORE-365 a un nodo de `context/`. Todo eso son tareas aparte; ésta termina cuando el país
sale del código y la columna dice la verdad.

## Cómo se comprueba

El dry-run del backfill, que no escribe nada y ya trae el radio de explosión:

    make harness-paises            # resumen + radio de explosión
    make harness-paises SQL=1      # los UPDATE propuestos, sin ejecutarlos

El estado de la columna en prod (sólo lectura):

    make trazador-sql TARGET=prod SQL='SELECT country_id, COUNT(*) n FROM lenders GROUP BY country_id'

Y que la entidad peruana **liste** en un comercio peruano, que es la prueba real:

    make harness-listado COMERCIO=<comercio-pe>

> **MEDICIÓN · 2026-08-24** — **prod**: `lenders` tiene **191 filas en `country_id = 1`** y **1 en 60**.
> `SELECT country_id, COUNT(*) n FROM lenders GROUP BY country_id ORDER BY n DESC`

> **MEDICIÓN · 2026-08-24** — **prod**: **9 tablas** tienen `country_id` con `DEFAULT 1` y `NOT NULL`:
> `allieds`, `lenders`, `users`, `settings`, `credit_lines`, `corporate_users`, `allied_categories`,
> `allied_industries`, `allied_types`. (`colombian_holidays` y `country_zones` lo tienen sin default.)
> `SELECT TABLE_NAME, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE COLUMN_NAME='country_id'`

> **MEDICIÓN · 2026-08-24** — **la fila 1 es un impostor**: se llama `Afghanistan` (`AF`/`AFG`) pero tiene
> `locale es-CO`, `currency COP` y `cell_phone_lenght 10`. Por eso el sistema funciona con 191 entidades
> apuntando ahí.

> **MEDICIÓN · 2026-08-24** — **la fila de Perú ya existe (id 167) y está a medio llenar**: `currency PEN` ✓,
> pero `locale = es_PE` (guion **bajo**), `dial_code` vacío (es +51) y `cell_phone_lenght` vacío (son 9).
> CO(47) = `57`/`10`/`es-CO`/`COP` · DO(60) = `1`/`11`/`es-DO`/`DOP`.

> **MEDICIÓN · 2026-08-24** — el guion bajo **no es cosmético**: `new Intl.NumberFormat('es_PE')` lanza
> `RangeError: Invalid language tag`. Y con el locale equivocado tampoco alcanza pasar bien la moneda:
> `es-CO` + `PEN` renderiza `PEN 1.234,50` en vez de `S/ 1,234.50`. Afecta a 4 filas (`es_AR`, `es_MX`,
> `es_PE`, `es_PR`).

> **MEDICIÓN · 2026-08-24** — dry-run de `make harness-paises` (target **dev**): 169 entidades ·
> **139 a poblar** · 2 ya correctas · **0 en conflicto** · **28 sin cablear (25 activas)**. La propia
> herramienta concluye: *«139 entidades ACTIVAS saldrían del default 1 al poblar la columna. Tres consultas
> filtran por el literal 1 y las dejarían FUERA DEL LISTADO, sin error → arreglar los filtros PRIMERO, el
> backfill después.»*

> **MEDICIÓN · 2026-08-24** — ⚠ **el dry-run manda la entidad peruana a Colombia**:
> `UPDATE lenders SET country_id = 47 WHERE id = 206; -- BCP Consumo`. No es un bug de la herramienta:
> infiere del cableado, y en dev BCP cuelga de un comercio colombiano. Es la razón por la que el backfill
> no puede ser un `UPDATE` ciego, y por la que **BCP tiene que nacer con su país puesto**.

> **MEDICIÓN · 2026-08-24** — **BCP no existe en prod** (`SELECT … FROM lenders WHERE name LIKE '%BCP%'`
> → sin filas); en **dev** sí, como id **206**. Hay margen para hacer P1 antes de que se cree.

> **MEDICIÓN · 2026-08-24** — sucursales con el país del comercio en conflicto con el de su ciudad (dev):
> **2** con comercio DO(60) vs ciudad CO(47), **3** con comercio en default 1 vs ciudad CO(47), y **10** sin
> ciudad (el país sólo se sabe por el comercio).

### El A/B de regresión — se toma ANTES de tocar el código

La validación es una comparación **antes/después** del listado de entidades, y hay dos criterios
distintos que no hay que confundir:

**Criterio 1 — que no se rompa nada (fase P1).** Para los comercios que hoy funcionan, el listado tiene
que quedar **idéntico**, entidad por entidad y en el mismo orden. Que *no cambie nada* ES el éxito: en
esta fase el `whereIn` sigue aceptando el país 1, así que las entidades que todavía dicen Afganistán
siguen apareciendo.

**Criterio 2 — que el cambio sirva de algo.** Con una entidad movida a su país real, tiene que seguir
apareciendo en un comercio de ese país, y **no** aparecer en uno de otro. Sin este segundo test, el
criterio 1 se cumple también si el cambio no hace nada.

⚠ **Va en `local`, no en dev**, por dos razones independientes: (1) en dev está desplegado `develop`, no
la rama — no se estaría probando el código nuevo; (2) `harness-listado` **escribe**: hace
`POST /api/onboarding/phone/register` y un `INSERT INTO user_requests` por corrida
(`harness/dev/listado.ts:111,123`), así que contra dev ensucia la BD compartida y pide el flag de F-53.

    E2E_TARGET=local make harness-listado COMERCIO=<comercio-co>   # baseline, con develop limpio
    E2E_TARGET=local make harness-listado COMERCIO=<comercio-do>

Se guardan las salidas, se aplica el cambio, se vuelve a correr y se diffea. **El baseline hay que
tomarlo con la rama sin tocar**: una vez cambiado el código, el «antes» ya no se puede reproducir sin
volver atrás.

> **MEDICIÓN · 2026-08-24** — **prod, la mitad del trabajo ya está hecha**: los **comercios ya tienen el
> país bien** (317 en 47 · 14 en 60 · **cero en el país 1**). Lo único roto es el lado de las entidades.
> `SELECT country_id, COUNT(*) n FROM allieds GROUP BY country_id`

> **MEDICIÓN · 2026-08-24** — **prod: las 146 entidades del país 1 que están cableadas sirven
> exclusivamente a comercios de CO(47)**. Cero dominicanas. Por eso el disfraz nunca dio problemas — y por
> eso cambiar el literal `1` por `47` «funcionaría igual»: igual de trabado, porque Perú seguiría afuera.
> Las otras 45 de las 191 no están cableadas a ningún comercio (son las que necesitan decisión).

> **MEDICIÓN · 2026-08-24** — ⚠ **local NO reproduce el disfraz de prod**, y puede engañar en un A/B:
> la fila 1 en local está **vacía** (`locale` y `currency` en NULL) mientras en prod tiene `es-CO`/`COP`;
> local tiene **2 comercios en el país 1** (prod no tiene ninguno) — hay que evitarlos al elegir los
> comercios del A/B; y `cell_phone_lenght` de DO es **10** en local y **11** en prod. Para el listado de
> entidades ninguna de las tres molesta, pero sí para cualquier prueba que toque prefijo o moneda.

> **MEDICIÓN · 2026-08-24** — 🔴 **el camino PRINCIPAL del listado no filtraba por país en absoluto.**
> `LenderRetrievalService::getLenders()` (la consulta de la línea 160 en `develop`) sólo filtraba por
> `status` y por las entidades cableadas a la sucursal. No estaba en el censo de literales porque **no hay
> ningún número que grepear**: la ausencia de filtro no se ve con un grep. Los 8 literales son el
> *fallback* (`processFallbackLenders`), el preaprobado (`OnboardingService`) y dos repositorios — ninguno
> es el camino que arma el listado real. **Lo destapó la corrida, no la lectura**: con el cambio aplicado
> sólo a los literales, una entidad movida a Perú **seguía apareciendo** en un comercio colombiano.

> **MEDICIÓN · 2026-08-24** — **A/B en local, criterio 1 (no romper): ✅ los 5 comercios idénticos**
> entidad por entidad — Kreditkasa 12/12 · godentist 9/9 · Motai 6/7 · Sonría 6/10 · CeluRD 0/2.
> Baseline tomado sobre `develop` limpio antes de ramificar.

> **MEDICIÓN · 2026-08-24** — **A/B en local, criterio 2 (que sirva): ✅** con el comercio Kreditkasa
> (Colombia, 47) y la entidad PayJoy (17) movida de país: **1 → sale** (compatibilidad con el default
> histórico) · **47 → sale** (el mecanismo nuevo) · **60 → no sale** · **167 → no sale**. El dato quedó
> restaurado a 1.

> **MEDICIÓN · 2026-08-24** — dos comercios de local que **no sirven** para el A/B: **Creditop (24)**
> devuelve HTTP 500 antes de llegar al listado (`Attempt to read property "sort" on null` en el servicio
> de probabilidad, ajeno a esto) y **CeluRD (270)** da **0 de 2** — sus entidades de SmartPay no tienen
> ciudades de cobertura ni reglas ni condiciones por monto en el dump local. **En local no hay ningún
> comercio no-colombiano funcional**, así que el caso multi-país sólo se puede probar moviendo una entidad
> de país a mano, como en el criterio 2.

> **MEDICIÓN · 2026-08-24** — **los dos monolitos divergen justo en el camino principal**: en
> `legacy-application` la consulta que arma el listado (`LenderRetrievalService:174`) **sí** filtraba por
> país; su gemelo de `legacy-backend` (`getLenders`, línea 160) **no**. El filtro se perdió al portar el
> código. Por eso el censo de literales daba 5 en application y 3 en backend: en backend el del camino
> principal no había quedado quemado, había quedado **ausente**.

> **MEDICIÓN · 2026-08-24** — **`legacy-application` no se puede validar corriéndolo en local**: tiene
> `docker-compose.yml` y sail, pero **cero contenedores levantados**, y su `.env` apunta a un `DB_HOST`
> que no es el MySQL local. Levantarlo a ciegas podría escribir contra la BD compartida. La validación de
> este repo quedó en lint + revisión + paridad con el gemelo ya validado por corrida.

## El paso a paso por ambiente

**Cuatro ramas, dos repos, y un orden que no es negociable.** Todas locales y sin push al 2026-08-24:

| # | repo | rama | commit | qué hace |
|---|---|---|---|---|
| **P1** | `legacy-backend` | `feature/pais-desde-el-comercio` | `7f5c2301` | 5 consultas: el país sale del comercio |
| **P1** | `legacy-application` | `feature/pais-desde-el-comercio` | `6ed5a649` | las 5 gemelas |
| **P2** | `legacy-backend` | `feature/catalogo-de-paises` | `3d9369d9` | 3 migraciones: `is_operating`, Perú, locales |
| **P2** | `legacy-application` | `feature/catalogo-de-paises` | `e9c4d4ce` | validar país contra `is_operating` |

### El orden, y por qué

1. **P1 primero, en los dos repos.** Es lo único que se puede desplegar sin coordinar con nada: acepta
   el país viejo y el nuevo a la vez, así que no importa en qué estado esté el dato.
2. **P2 después.** ⚠ **Nunca antes que P1**: P2 es justamente lo que habilita crear el comercio y la
   entidad peruanos, y si se crean con P1 sin desplegar, **nacen invisibles** para las consultas del
   listado.
3. **Dentro de P2, la migración va antes que la validación** — y son repos distintos. La regla de
   `legacy-application` consulta `countries.is_operating`; sin esa columna **rechaza todos los países**
   y no se puede dar de alta nada.
4. **P3 (el backfill) sólo con P1 en producción**, no mergeada: desplegada.

### Por ambiente

**local** — ya validado acá. `application` corre en `:8000` con el PHP del host y su `.env` **ya apunta
al MySQL local** (`DB_HOST=127.0.0.1`, schema `creditop`, `APP_ENV=local`); `legacy-backend` va por
Docker con `DB_HOST=mysql`. Los dos pegan al mismo MySQL, así que la migración se corre **una sola vez**.

    docker exec legacy-backend-laravel.test-1 php artisan migrate --force \
        --path=database/migrations/2026_08_24_100000_add_is_operating_to_countries_table.php

⚠ **Siempre con `--path` explícito, una por vez.** Un `artisan migrate` pelado en local corre **17
migraciones pendientes** —14 son de `develop`, ajenas a esta tarea— y deja la base en un estado que
nadie pidió. Es la misma regla que ya rige para los tests.

**dev** — la rama `develop`. ⚠ **Comparte la BD con `staging`**: la migración se corre **una vez y sirve
para los dos**. Si las credenciales rotan, se actualizan las dos.

**staging** — sólo `legacy-backend`; **`legacy-application` no tiene staging** (sólo `develop` y `main`).
Los criterios que tocan el admin se validan en dev.

**producción** — ⚠ **`legacy-application` despliega por TAG**, no por push a `main`: el cambio no sale
hasta que alguien taguee. Y ⚠ el strangler tiene a **`application` como default**, con allowlist por
comercio hacia legacy — o sea que el repo "viejo" es el que atiende a la mayoría.

### Cómo se verifica cada paso

Después de **P2-migración** (los tres países operando, y ningún locale inválido):

    make trazador-sql TARGET=<amb> SQL='SELECT iso_code_2, dial_code, phone_code, cell_phone_lenght, locale, currency, is_operating FROM countries WHERE is_operating = 1'
    make trazador-sql TARGET=<amb> SQL='SELECT COUNT(*) invalidos FROM countries WHERE locale LIKE "%\_%"'

Después de **P2-validación** (acepta los que operan, rechaza el resto):

    cd <legacy-application> && php artisan tinker --execute='...Rule::exists("countries","id")->where("is_operating", true)...'

Después de **P1** — el A/B del listado, que es el que importa:

    E2E_TARGET=local make harness-listado COMERCIO=<comercio>     # antes y después, se diffea

### Cómo se revierte

⚠ **`migrate:rollback --path=<archivo>` NO filtra por archivo** — medido acá: Laravel revierte el
**último batch** y busca los archivos en el path que le pasás, así que pasarle otro archivo devuelve
«Migration not found» y **no revierte nada**. Para revertir de verdad hay que ir por batch
(`--step=1`), y eso puede arrastrar migraciones de otra gente si compartieron batch.

Las tres migraciones tienen `down()`, con una excepción deliberada: la de locales **no se revierte**
—volver a escribir un separador inválido rompe a quien ya lo lea—. P1 se revierte con un revert del
commit: no tiene estado.

> **MEDICIÓN · 2026-08-24** — 🔴 **el alta y la edición de ENTIDADES no validaban el país en absoluto**:
> `Admin/Lender/StoreRequest.php:45` y `Admin/Lender/UpdateRequest.php:45` tenían `country_id` como
> `'required'` a secas — cualquier número pasaba. Es la otra mitad de por qué 191 entidades quedaron en
> Afganistán: la columna tiene `DEFAULT 1` **y** el formulario nunca preguntó qué país es. El censo sólo
> había visto el `Rule::in([47, 60])` del alta de comercio, que al menos validaba algo.

> **MEDICIÓN · 2026-08-24** — **P2 validado en local**. Tras las tres migraciones: Perú (167) queda
> `51` / `+51` / `9` / `es-PE` / `PEN` con `is_operating = 1`, junto a CO(47) y DO(60); **cero locales con
> guion bajo** (se normalizaron AR, MX, PR). Y la regla nueva, probada contra la BD: **acepta** 47, 60 y
> **167**; **rechaza** 1 (Afganistán) y 138 (México, que existe en la tabla pero no opera).

> **DECISIÓN · 2026-08-24** — **quitar el `DEFAULT 1` de las 9 tablas se mueve de P2 a P3.** Mientras las
> entidades sigan registradas en el país 1, ese default es coherente con el dato; quitarlo antes sólo
> hace fallar `INSERT`s sin arreglar nada. Va con el backfill, que es cuando deja de ser cierto.

> **DECISIÓN · 2026-08-24** — el **seed de LatAm no entra todavía**, y no por falta de tiempo: cargar
> prefijos y longitudes de celular de 20 países sería escribir datos que no verifiqué contra ninguna
> fuente. Y no hace falta: **un país apagado no necesita prefijo ni moneda** — esos datos se cargan cuando
> va a abrir. `is_operating` ya da el gate sin necesidad de precargar nada. Queda pendiente sólo la
> pregunta de negocio de qué países listar.

> **MEDICIÓN · 2026-08-24 · DEV, con el PR #1191 ya desplegado** — ✅ **el comercio peruano ve su
> entidad.** `Comercio pruebas BCP` (allied **337**, país **167**) tiene cableada `BCP Consumo`
> (lender **206**, país **167**, rt=1): el listado devuelve **1 de 1**. **Antes del cambio ese listado
> era 0 de 1** — el filtro pedía país 1 y la entidad está en 167. La entidad peruana ya estaba
> invisible en dev; no era un escenario hipotético.

> **MEDICIÓN · 2026-08-24 · DEV** — **sin regresiones**: Kreditkasa **10/10** · godentist **8/8** —
> todas las cableadas salen, cero exclusiones por país. CeluRD (DO) sigue en **0/2** con las mismas
> causas de siempre (sin ciudades de cobertura, sin reglas de datacrédito, sin condiciones por monto):
> ninguna es de país.

> **MEDICIÓN · 2026-08-24 · DEV** — el forense de Loki de la solicitud **465147**: **sin fallas**, y
> `206 BCP Consumo · regla 9867 · aprobado`. La entidad peruana no sólo aparece en el listado: **se
> evalúa y aprueba**.

> **MEDICIÓN · 2026-08-24** — **censo exhaustivo de supuestos de país** (13 agentes, 6 barridos por
> dimensión + verificación adversarial de cada hallazgo, sobre `develop` de los 4 repos):
> **186 confirmados, 2 descartados**, ~140 sitios distintos, **más de 400 líneas** contando gemelos.
> Informe completo: `tablero/data/artifacts/censo-hardcodes-pais-2026-08-24.md`.
> ⚠ La tasa de descarte (2 de 188) es muy baja: leer los hallazgos con criterio propio antes de
> convertirlos en tickets.

> **MEDICIÓN · 2026-08-24** — la conclusión del censo que reordena la tarea: **el problema no es que
> falte configuración por país.** `countries` ya tiene `locale`, `currency`, `nationality`, `phone_code`,
> `cell_phone_length` y `address_format`, y el backend ya arma `currency_format` en 4 controladores —
> **el código no las lee**. `countries.address_format` está declarada y **muerta**: nadie la lee en todo
> el repo. Y dos tercios de los hallazgos se concentran en dos familias: **el teléfono y la plata**.

> **MEDICIÓN · 2026-08-24** — ⚠ **trampa de nombres que va a costar tiempo**: `countries.iso_code_2`
> guarda el código de **TRES** letras (`COL`/`DOM`/`PER`), no el de dos. Un `where('iso_code_2','PE')`
> no matchea nada. Ya pasó: la migración `2026_02_20_100000_add_phone_code_to_countries_table.php:17`
> buscaba `'CO'` y no encontró Colombia. (Las migraciones de P2 usan las tres letras: correcto.)

> **MEDICIÓN · 2026-08-24** — **CORE-365 nunca llegó a producción.** Las 3 migraciones de países y el
> `AlliedInfoController` que expone `country` están en `develop`, `qa` y `staging` de `legacy-backend`
> y en `qa`/`staging` del front — **y en `main` de ninguno de los dos**. Lo único que sí está en `main`
> es el admin de `legacy-application` (el merge del 19/8). Producción quedó a medias: el admin filtra
> ciudades por país, pero el backend no manda el país y el front no lo consume.

> **MEDICIÓN · 2026-08-24 · A/B sobre `qa`, en local, con los dos países que SÍ operan** — baseline
> tomado sobre `origin/qa` limpio y repetido con el cambio, con el buró dictado (`LAMBDA=1`) para que
> sea determinista y con `PRE=1` para disparar la consulta de pre-aprobados:
>
> | caso | listado antes→después | pre-aprobados antes→después |
> |---|---|---|
> | **celurd** (RD, SmartPay 152) | 1 → 1 **idéntico** | 1 → 1 **idéntico** |
> | **kreditkasa** (CO) | 12 → 12 **idéntico** | 3 → 3 **idéntico** |
> | **godentist** (CO) | 9 → 9 **idéntico** | 5 → 5 **idéntico** |
>
> Con esto queda ejercitado el **preaprobado** (`OnboardingService`), que era uno de los dos sitios que
> el listado por API no tocaba.

> **MEDICIÓN · 2026-08-24** — ⚠ **el fallback NO se pudo ejercitar, y la razón es un hallazgo**:
> `processFallbackLenders` sólo corre cuando `count($format_lenders) == 0`
> (`LenderRetrievalService:223`), y **no hay forma de vaciar el listado desde el harness**. Probado:
> ingreso **100.000**, score **250**, monto **99.000.000** y monto **60.000** — en todos los casos el
> listado sale **completo** (12 entidades en Kreditkasa, 1 en CeluRD). Es **F-162 medido de la forma más
> contundente**: las reglas clasifican, no excluyen. Consecuencia práctica: el fallback es un camino que
> casi no se ejecuta, y por eso el criterio 1 daba verde incluso con el cambio incompleto.
> **Queda cubierto sólo por lectura y paridad** con el camino principal (mismo patrón, misma fuente del
> país; la única diferencia es que el valor entra al closure por `use`).

> **DECISIÓN · 2026-08-24 (Miguel)** — **un comercio pertenece a UN país, igual que una entidad.** Si una
> marca opera en varios países, se crea **una fila por país** (comercio y entidad), no una fila
> multi-país. El motivo es la herencia: la sucursal no tiene país propio y lo hereda del comercio — con
> un comercio de dos países, la sucursal no sabría cuál heredar y toda la cadena queda indefinida.

> **MEDICIÓN · 2026-08-24 · prod** — **la regla ya se cumple casi al 100%**: **cero entidades** con la
> misma marca en dos países, y **un solo comercio**: «Alan comunicaciones», con dos filas creadas **el
> mismo día**. `SELECT name, COUNT(DISTINCT country_id) FROM allieds GROUP BY name HAVING … > 1`

> **MEDICIÓN · 2026-08-24 · prod** — y ese caso **no es el patrón aplicado a propósito, es un intento
> fallido**: `allied 336` (país **47**, **0 sucursales, ninguna entidad**) y `allied 337` (país **60**,
> 1 sucursal, entidad 160), ambos del 2026-08-21. Alguien creó el comercio con el país por defecto,
> se dio cuenta, y creó otro: **el país no se puede corregir después**, así que equivocarse cuesta un
> comercio duplicado y huérfano. Es la evidencia de que `allieds.country_id` **ya es inmutable de
> hecho** (no está en el `->only([...])` de `AlliedController::update`), sin que nadie lo haya decidido.

> **MEDICIÓN · 2026-08-24 · prod** — ⚠ **el invariante ciudad↔país se viola en 12 comercios**, y **no es
> un problema de país sino de ciudades**: los 12 tienen `comercio = 60` y `entidad = 60` (SmartPay 160),
> correctos, pero sus **18 sucursales apuntan a ciudades colombianas** (`country_zones.country_id = 47`)
> — se dieron de alta cuando las ciudades de RD no estaban cargadas. La cadena real es
> `allied_branches.country_city_id → country_cities.country_zone_id → country_zones.country_id`.
> **✅ Nuestro cambio NO los rompe**, y por una razón de diseño: el filtro toma el país del **comercio**,
> no el de la ciudad. Si lo hubiéramos sacado de la ciudad de la sucursal, estos 12 comercios se caían.

El invariante, como consulta que se puede correr en cualquier ambiente:

    make trazador-sql TARGET=<amb> SQL='SELECT CONCAT(a.name, " · comercio=", a.country_id, " · ciudad=", cz.country_id) x FROM allied_branches ab JOIN allieds a ON a.id=ab.allied_id JOIN country_cities cc ON cc.id=ab.country_city_id JOIN country_zones cz ON cz.id=cc.country_zone_id WHERE a.country_id <> cz.country_id GROUP BY a.id, a.name, a.country_id, cz.country_id'

⚠ **Y una trampa del trazador al leer estos resultados**: imprime las columnas **en orden alfabético**,
no en el del `SELECT`. Con dos columnas de país (`pais_comercio`, `pais_ciudad`) se leen invertidas y la
conclusión sale al revés. Para consultas con varias columnas parecidas, armar un solo `CONCAT`.

> **MEDICIÓN · 2026-08-24** — 🔴 **la causa raíz de las 191 entidades en Afganistán no era el `DEFAULT 1`
> de la columna: era el formulario.** `LenderCreate.vue` y `LenderEdit.vue` tenían la lista de países
> escrita adentro, con **una sola opción**:
>
>     countries: [ { value: 1, title: 'Colombia' } ]
>
> El id 1 es **Afganistán**, rotulado «Colombia». El operador no podía elegir otra cosa ni darse cuenta.
> En cambio el alta de **comercios** (`AlliedInfoCreate.vue:120`) siempre leyó la lista del backend
> (`$page.props.settings.countries`) — **por eso los comercios sí tienen 47 y 60 bien**. Un formulario
> leía configuración y el otro la tenía escrita: esa es toda la diferencia entre los dos estados.

> **MEDICIÓN · 2026-08-24 · validado contra el admin corriendo, con sesión real** (`bin/admin-sesion`
> emite la cookie sin contraseña; el admin en `:8000` con el código de la rama). Las tres pantallas
> reciben ahora los tres países operativos, y Afganistán queda fuera:
>
> | ruta | `countries` que recibe |
> |---|---|
> | `/entidades/crear` | 47 Colombia · 60 Dominican Republic · **167 Peru** |
> | `/entidades/{id}/editar` | 47 · 60 · **167** |
> | `/aliados/crear` | 47 · 60 · **167** |
>
> ⚠ El bundle del admin **no se recompiló**: lo verificado es que el backend manda los datos correctos y
> que llegan a la página. El selector en pantalla toma el prop nuevo recién después del build.

> **MEDICIÓN · 2026-08-24** — **corregir el país de un comercio ENTRÓ al PR** (era la tarea (b), que
> quedaba afuera). Se puede mientras el comercio **no tenga sucursales ni solicitudes**; con operación
> encima el campo ni se muestra, y si llega igual el `UpdateRequest` lo rechaza. Probado en los cuatro
> casos: vacío + país operativo **acepta** · con operación **rechaza** (aunque el país sea válido) ·
> vacío + Afganistán **rechaza** · sin el campo **no rompe**. Y el flag llega a la pantalla:
> `alliedCountryEditable=true` en un comercio vacío, `false` en Kreditkasa.

> **MEDICIÓN · 2026-08-24** — dos cosas que costaron entender el admin y conviene tener escritas:
> **`AlliedEdit.vue` no es una página, es el LAYOUT** de las seis pestañas de edición del comercio (lo
> importan como `layout: AlliedEdit`), y por eso `AlliedInfoEdit.vue` sí está vivo aunque ningún
> controlador lo renderice. Y **`AlliedController::edit()` no muestra un formulario**: redirige a
> `admin.allieds.branches`. Los datos del país van por el **share de Inertia**
> (`HandleInertiaRequests`) justamente porque el formulario vive en ese layout: pasarlos por props
> obligaba a tocar los seis controladores. Se resuelven **sólo si la ruta trae un comercio**, así los
> listados no pagan la consulta.

> **MEDICIÓN · 2026-08-24** — ✅ **`dev`, `qa` y `staging` son UNA SOLA base de datos**: mismo host
> (`inertia-dev…`) y mismo schema (`creditop`) en `harness/.env.dev`, `.env.qa` y `.env.staging`. La
> migración se corre **una vez** y sirve para las tres. (El CLAUDE.md sólo decía que dev y staging la
> compartían; qa también.)

> **MEDICIÓN · 2026-08-24** — **la migración YA ESTÁ APLICADA en la base compartida.** Antes: 7 países
> con moneda · 4 con prefijo · **4 locales inválidos** · `is_operating` no existía. Después:
> **20 con moneda · 19 con prefijo · 0 locales inválidos · 3 operando** (COL, DOM, PER) y la fila 1
> (Afganistán) **apagada**. Verificado corriendo: Kreditkasa 10/10 y el comercio peruano 1/1, igual que
> antes.

> **MEDICIÓN · 2026-08-24** — ⚠ **`--pretend` SUBESTIMA lo que va a pasar** cuando la migración lee datos:
> mostró 3 sentencias (el `ALTER`, el `REPLACE` de locales y el `UPDATE` de `is_operating`) y **no** los
> 18 `UPDATE` del catálogo, porque en modo simulado los `SELECT` no se ejecutan y el bucle no encuentra
> filas. Sirve para ver el DDL, no como prueba completa.

> **MEDICIÓN · 2026-08-24** — en la base compartida había **una sola migración pendiente**: la nuestra.
> Las 402 restantes ya habían corrido. Aun así se aplicó con `--path` explícito.

> **DECISIÓN · 2026-08-24 (Miguel)** — **no se agrega un regex de celular por país; queda en la
> longitud**, que además ya tiene columna (`cell_phone_lenght`). Los rangos de prefijos móviles cambian
> cuando el regulador asigna bloques nuevos y un regex viejo **rechaza clientes reales** — falla cerrado.
> Y el patrón NO se deriva de los usuarios que ya tenemos: es un dato del país, como el `+57`.

> **DECISIÓN · 2026-08-24 (Miguel)** — **se cargan los 18 países de Latinoamérica**, apagados, con lo que
> es estándar y estable: código telefónico (E.164), moneda (ISO 4217), idioma (BCP-47) y longitud de
> celular **sin código de país ni cero troncal**. ⚠ Las longitudes de los que no operan quedan
> **pendientes de confirmar con negocio** antes de abrir cada país: varios planes de numeración son
> ambiguos sobre el cero troncal — la misma duda que hoy tenemos con RD (11 contra 10).

> **DECISIÓN · 2026-08-24 (Miguel)** — **los 18 países de Latinoamérica quedan HABILITADOS**, no sólo los
> tres que operan. El argumento que cambió la decisión: **dar de alta un comercio es configuración, no
> operación** — no origina crédito, así que no hay razón para impedirlo mientras el país se prepara. Que
> el flujo se caiga después por falta de buró, documentos o geografía es **otro problema** (el del censo),
> y confundirlos hacía que esta columna bloqueara trabajo legítimo de configuración.
>
> Con eso `is_operating` cambia de significado: ya no es «dónde operamos» sino **«dónde se puede dar de
> alta»**. Lo que sigue protegiendo es lo importante: que nadie elija un país del que no sabemos ni el
> prefijo telefónico. **Los otros 235 de la tabla siguen apagados.**

> **MEDICIÓN · 2026-08-24 · aplicado en local y en la compartida** — **18 habilitados** · 20 con moneda ·
> 19 con prefijo · **0 locales inválidos** · **Afganistán apagado**. El selector del admin ya ofrece los
> 18 (Argentina, Bolivia, Brasil, Chile, Colombia, Costa Rica, Rep. Dominicana, Ecuador, El Salvador,
> Guatemala, Honduras, México, Nicaragua, Panamá, Paraguay, Perú, Uruguay, Venezuela) y la validación
> acompaña: **Bolivia (26) acepta · Afganistán (1) rechaza · Vietnam (233) rechaza**.

> **MEDICIÓN · 2026-08-24 · el front está a UN PASO, no a un proyecto** (verificado sobre `origin/qa` de
> `frontend-monorepo`). El dato **ya viaja**: `allied-theme.repository.ts:114-120` guarda `phoneCode`,
> `currency` y `locale` del comercio en el theme, y `allied-theme.ts` los tipa. Y el helper
> `formatCurrencyWithSymbol(amount, locale = "es-CO", currency = "COP")` **ya acepta los parámetros**.
> Lo que falta es que alguien se los pase: **ningún llamador lo hace** — `formatCurrencyWithSymbol(cupo)`,
> `(lender.available_amount)`, `(accountsData.balance)`… todos caen en el default colombiano.
>
> La receta, cuando toque: **quitar los defaults** en vez de corregir llamador por llamador —así el que
> no pasa el país falla al compilar y aparece solo— y ⚠ **`maximumFractionDigits: 0`**, que está fijo en
> el helper y le borra los centavos a DOP, PEN, BRL y USD. Con COP no se nota, y por eso lleva años ahí.
>
> Para el celular: el prefijo **ya se preselecciona** desde `phone_code`; lo que sigue quemado es la
> **lista** de opciones (`[+1, +57]`), que ahora puede salir de `countries`.

> **MEDICIÓN · 2026-08-24** — **por qué el backfill necesita el DESPLIEGUE y no sólo el merge**, medido:
> `develop` ya tiene el cambio, pero **`qa` y `staging` NO** —siguen preguntando por el país 1— y **los
> tres pegan a la misma base**. Mover las 191 entidades hoy dejaría a dev andando y a qa y staging con
> **listados vacíos**. Por eso la migración sí se pudo correr antes: agregar una columna y llenar campos
> vacíos no le quita nada a nadie. En cuanto #1193 mergee a `qa`, el bloqueo desaparece.

> **MEDICIÓN · 2026-08-24** — 🔴 **los ids de `lenders` NO significan lo mismo en prod y en la base
> compartida**, y eso cambia el plan del backfill. 165 ids en común, 27 sólo en prod, 4 sólo en dev — y
> **12 ids comunes son entidades DISTINTAS**:
>
> | id | producción | compartida |
> |---|---|---|
> | **152** | Refurbicredit | **smartpay** |
> | **153** | Crediemo | **SmartPay** |
> | **160** | **SmartPay** | credifree |
> | 159 | Tu descuento credit | CREDIMOVIL |
> | 169 | HEALTH & FITNESS COMPANY | Crédito Directo X |
> | 170 | CrediGanga | My Tech YA |
>
> Explica el hardcode `production ? 160 : 152` de `isSmartPay()`: no era un capricho, el id **es** otro.
>
> **Consecuencia dura: un `UPDATE … WHERE id = 152` sería correcto en la compartida y CATASTRÓFICO en
> producción** —movería Refurbicredit, colombiana, a República Dominicana—. **El backfill se calcula en
> cada base desde el cableado, y la lista de una NUNCA se copia a la otra.** `harness-paises` ya trabaja
> así (infiere, no usa lista fija): hay que correrlo contra cada base y revisar su salida por separado.

> **MEDICIÓN · 2026-08-24 · EL ESTADO FINAL SIMULADO EN LOCAL, y funciona.** Se ejecutó el escenario
> completo —backfill aplicado **más** el `1` sacado del `whereIn` en los 5 sitios— para ver cómo queda
> todo cuando el hardcode desaparezca del todo:
>
> - backfill en local: 158 entidades en el país 1 → **129 a Colombia · 2 a RD · 28 quedan en el país 1**
>   (las que no están cableadas a ningún comercio, o sea las que necesitan decisión de negocio);
> - con el puente sacado, los tres casos dan **idéntico al baseline**: celurd 1 · kreditkasa 12 ·
>   godentist 9.
>
> **El plan cierra**: cuando se corrija el dato y se saque el `1`, nada cambia para quien ya funciona.
> Todo restaurado después —código con `git checkout`, datos desde un CSV de respaldo de las 159 filas— y
> verificado que los tres casos volvieron a dar lo mismo.

> **MEDICIÓN · 2026-08-24** — y **el «índice» que buscaba Miguel existe, pero recién en el ÚLTIMO paso**:
> con el puente sacado, una entidad que quedó en el país 1 **desaparece del listado de su comercio**
> (probado: PayJoy en 47 → el comercio la ve; en 1 → no la ve). Eso sirve para detectar entidades sin
> corregir **después** del backfill. ⚠ **Antes del backfill significaría lo contrario**: que las 139
> activas se cayeron del listado, que es precisamente el bug que el puente evita.

> **MEDICIÓN · 2026-08-25** — **el teléfono del wizard pasa a salir del país del comercio.** Dos ramas,
> desde `qa` en cada repo:
>
> - `frontend-monorepo` **`feature/telefono-prefijo-del-comercio`** (`30dd9124` + `c9dcfb3f`): el prefijo
>   deja de ser un desplegable con `[+1, +57]` escritos adentro y pasa a **mostrarse** como texto a la
>   izquierda del campo; y el largo del campo sale del país en vez de asumir 10.
> - `legacy-backend` **`feature/largo-celular-por-pais`** (`dcab6f50`): el payload del comercio expone
>   `cell_phone_length`, que no viajaba.
>
> **El componente `Input` ya soportaba `prefix`** —un prefijo no seleccionable— además de `prefixSelect`:
> el cambio fue usar el que corresponde, no construir nada. Typecheck idéntico a la base en los dos
> repos (11 errores preexistentes, **cero** en los archivos tocados).

> **DECISIÓN · 2026-08-25 (Miguel)** — **el prefijo se muestra, no se elige.** El teléfono tiene que ser
> del país donde opera el comercio. La razón por la que se dejaba elegir era de pruebas —usar un celular
> colombiano en un comercio de otro país— y **eso se resuelve del lado del envío**: en ambientes no
> productivos los mensajes van a un destino de pruebas sin importar el número.

> **DECISIÓN · 2026-08-25** — si el país no se puede resolver, el campo se muestra **sin prefijo** y el
> cliente escribe igual, en vez de caer a un `+57` de reserva. El backend no depende de eso: resuelve el
> país por el comercio de la solicitud, que es la fuente de verdad.

> **MEDICIÓN · 2026-08-25** — ⚠ **no se pudo mostrar en pantalla**: `request-phone` existe sólo bajo
> `merchant/:partner_hash/`, o sea es la pantalla del **asesor**, y redirige al login de Cognito. La
> verificación quedó en typecheck + revisión del diff.

> **MEDICIÓN · 2026-08-25** — **el registro dejaba de lado un dato que ya recibía.**
> `Onboarding\Http\Requests\CreateAndAuthUser` acepta `country_code` en el request —el front lo manda
> desde el país del comercio— y validaba el teléfono con `digits:10` sin mirarlo. Ahora el largo sale de
> ese prefijo, buscado en `countries` y **acotado a los países habilitados** (el `57` lo tienen Colombia
> **y** la fila 1, y el `1` lo comparte toda la numeración de Norteamérica). Probado por país:
>
> | país | 9 dígitos | 10 dígitos |
> |---|---|---|
> | Colombia (57) | rechaza | **acepta** |
> | **Perú (51)** | **acepta** | rechaza |
> | Rep. Dominicana (1) | — | **acepta** |
> | sin prefijo / desconocido | — | **acepta** (degrada a 10) |
>
> ⚠ **Degrada a 10** cuando falta el dato: una validación de formato no puede volverse más estricta por
> algo que no está cargado — dejaría gente afuera sin que nadie lo note.

> **MEDICIÓN · 2026-08-25** — quedan **4 sitios más** con `digits:10` que no entraron:
> `BackDoorCreateUserRequest:144`, `CreditStudyRequest:99`, `OnboardingV2\ValidateOtpAuthRequest:38` y
> `TestMarketingMessagesRequest:26`. Y dos casos que **no se deben tocar**: el regex de
> `ManualValidationService:100` y el de `EvidenteOtpGenerateRequest:33`, que responde al contrato de
> Credifamilia con su proveedor.

> **MEDICIÓN · 2026-08-25** — **la validación de OTP también dejaba fuera al peruano**, y era el segundo
> muro: `OnboardingV2\ValidateOtpAuthRequest:38` pedía `digits:10`, así que un cliente peruano no podía
> validar su código **aunque lo hubiera recibido**. Ahora el largo sale del país de la sucursal de la
> ruta (`partnerBranchId` → sucursal → comercio → país). Probado: sucursal colombiana → `57`, dominicana
> → `1`, y hash nulo, vacío o inexistente → `NULL`, que degrada al largo de siempre.

> **DECISIÓN · 2026-08-25** — **los otros cuatro `digits:10` se quedan como están, y por dos razones
> distintas**: `BackDoorCreateUserRequest`, `CreditStudyRequest` y `TestMarketingMessagesRequest` **no
> tienen de dónde sacar el país** —aplicar la regla ahí degradaría a 10 igual, o sea sería ruido—; y
> `EvidenteOtpGenerateRequest:33` responde al **contrato de Credifamilia con su proveedor**, donde el
> formato colombiano es parte del acuerdo. Tampoco se toca el regex de `ManualValidationService:100`.

> **MEDICIÓN · 2026-08-25 · los 18 largos, verificados contra los planes de numeración.** No contra los
> datos cargados ni contra los teléfonos guardados: **esos están contaminados** por la práctica de probar
> con celulares colombianos en comercios de otros países, así que muestran el síntoma y no la regla.
> Los 18 valores coincidieron con lo que se había cargado.
>
> **El caso que importaba, República Dominicana**: pertenece al **NANP**, su número nacional es 3 dígitos
> de área (809/829/849) + 3 + 4 = **10**, y el `1` es el **código de país** — el mismo lugar que ocupa el
> `57` en Colombia, que tampoco se cuenta. El **11** de producción mezcla las dos cosas, y validar con él
> **rechazaría a los dominicanos reales**. La migración lo corrige.

> **LECCIÓN · 2026-08-25 (corrección de Miguel)** — casi justifico ese cambio con **un comentario del
> propio código** (`AlliedInfoController` decía «el móvil dominicano también es de 10 dígitos») y con la
> forma de los teléfonos guardados. Las dos son **fuentes contaminadas**: el comentario se escribió
> cuando se recibían números colombianos y dominicanos a la vez —por las pruebas— y los datos guardados
> reflejan esa misma práctica. **Para un dato que es una regla externa —un plan de numeración, una norma
> ISO, un estándar— la fuente es la norma, no lo que el sistema haya acumulado.** Que la conclusión
> resultara la misma no valida el método.

> **MEDICIÓN · 2026-08-25 · el modelo de documentos ya era el correcto, y Miguel lo dijo antes que los
> datos.** Quien decide es la **entidad**, no el comercio ni la sucursal: `Motai Renting` y `Rent to Own`
> son **las dos únicas** filas de `lenders_by_allied_branches` con `PEP`; las otras 7.154 dicen
> `["CC","CE"]`. `resolveAllowedDocumentTypes` ya hacía la unión de las entidades de la sucursal — o sea
> el comportamiento estaba implementado y sólo faltaba el techo del país.
>
> Se cayó así todo el diseño de tres niveles (país → comercio → sucursal) que se estaba armando: **no
> hacían falta ni la columna en `allieds` ni las dos pantallas del admin.**

> **MEDICIÓN · 2026-08-25** — 🔴 **y había un piso quemado que nadie había visto**:
> `resolveAllowedDocumentTypes` agregaba **`['CC','CE']` SIEMPRE**, sin mirar el país ni las entidades.
> O sea **cualquier comercio del mundo ofrecía documentos colombianos** sin que nadie lo hubiera
> decidido. Ahora el país es piso y techo.

> **MEDICIÓN · 2026-08-25 · probado en los tres casos**: Kreditkasa (CO) muestra `CC/CE` —no se le cuela
> el PEP aunque el país lo tenga—, Motai muestra `CC/CE/PEP` —la excepción se respeta— y **CeluRD pasa a
> mostrar `CED/NUI`**, que es lo correcto para RD, **sin haber tocado el dato mal cargado de sus
> sucursales**: cuando el cruce queda vacío manda el país.

> **MEDICIÓN · 2026-08-25** — 🔴 **guardar una sucursal en el admin BORRABA los tipos de documento.**
> `AlliedAlliedBranchController::update` hace `delete()` de las filas de `lenders_by_allied_branches` y
> las recrea **sin `document_types`**. O sea el PEP de Motai desaparecía si alguien editaba esa sucursal,
> y nadie lo notaba porque el selector del cliente simplemente dejaba de ofrecerlo. Probablemente explica
> las **47 filas** que hoy están en `null`. Arreglado: se conservan, y una entidad nueva arranca con los
> tipos del país.

> **MEDICIÓN · 2026-08-25** — **dos divergencias más entre los modelos gemelos**, encontradas al hacer
> el selector: `document_types` **no estaba en el `fillable`** de `LendersByAlliedBranch` de
> `legacy-application` —un `create()` lo descartaba en silencio— y **ni ese modelo ni `Country`
> casteaban el JSON**, a diferencia de sus gemelos de `legacy-backend`. Se vio en la respuesta real: el
> selector recibía `["CC", "CE", "PEP"]` como **una sola opción**. Con el cast, un comercio colombiano
> recibe `CC/CE/PEP` y uno dominicano `CED/NUI`.

> **MEDICIÓN · 2026-08-25** — **el cast faltaba en TRES modelos, no en dos**, y el tercero se vio en
> pantalla: el selector mostraba un chip que decía literalmente `["CC", "CE"]` al lado de los chips
> reales. La causa: en el listado de entidades del punto de venta, `document_types` llega como **alias de
> una subconsulta** sobre `LendersByAllied` —otro modelo— y ése tampoco casteaba. El cast aplica igual a
> un alias que a una columna propia.
>
> Los tres son el mismo defecto: **un JSON que viaja como string porque el modelo no lo declara**. Y los
> tres existían sólo en `legacy-application`; sus gemelos de `legacy-backend` sí lo tenían.

> **MEDICIÓN · 2026-08-25** — **por qué algunas entidades muestran el campo de documentos vacío**: la
> pantalla lista las entidades del **comercio** (12 en la sucursal de prueba) pero sólo las asignadas a
> **esa sucursal** tienen fila en `lenders_by_allied_branches` (11). Las que figuran «Inactivo» no tienen
> configuración ahí todavía — y al habilitarlas arrancan con los tipos del país.
>
> No era un defecto, pero **la pantalla no lo explicaba**: «vacío porque no está asignada» y «vacío
> porque nadie eligió, o sea todos los del país» se veían igual. Ahora el hint distingue los dos casos y
> el placeholder muestra cuáles son esos «todos».

> **DECISIÓN · 2026-08-25 (Miguel)** — **los tipos de documento arrancan MARCADOS** con todos los del
> país, y de ahí se destildan los que la entidad no acepte. Se descartó la regla «vacío = todos»: es
> justo lo que nadie adivina mirando un campo en blanco.
>
> Y el argumento de fondo, que dio vuelta mi objeción: **si mañana el país suma un tipo, NO es deseable
> que todas las entidades empiecen a aceptarlo solas** — eso lo decide cada entidad. La herencia
> automática sonaba elegante y es peor. Además **explícito se audita leyendo la fila**, sin resolver el
> país al vuelo, y es lo que el dato ya hacía: las 7.164 filas tienen `["CC","CE"]` escrito, no `null`.
>
> ✅ Seguro de hacer: el guardado filtra `is_active == 1`, así que preseleccionar en todas **no activa
> ninguna** — las inactivas no crean fila.

> **DECISIÓN · 2026-08-25 (Miguel)** — **los tipos los define la ENTIDAD**, no el comercio: «Motai acepta
> PEP y Pullman no» es política de la entidad, no de quién vende. Y **el nivel sucursal×entidad se
> conserva** —una entidad puede no ofrecer algún tipo en un local puntual—, así que el modelo final tiene
> tres niveles y el más específico gana:
>
>     país                 el universo (techo)
>     entidad              lo que acepta por ser esa entidad     ← faltaba, se agrega
>     sucursal × entidad   el recorte de ese punto de venta      ← ya existía
>
> Se descartó por el camino el nivel **comercio**, que se había llegado a diseñar con dos pantallas: no
> aporta nada que la entidad no cubra.

> **MEDICIÓN · 2026-08-25** — **el dato estaba en el nivel equivocado, copiado**: sólo vivía en
> `lenders_by_allied_branches`, o sea **7.211 combinaciones** de sucursal×entidad cuando alcanza con
> **147** filas, una por entidad. Es el mismo patrón que las reglas de datacrédito (37.284 copias).
>
> Y hoy **nadie usa el override**: las únicas dos variantes que existen son `["CC","CE"]` y `null`, y los
> `null` son el bug del borrado, no una decisión. O sea el nivel de la sucursal está vacío de intención —
> lo que hay es el default colombiano copiado.

> **MEDICIÓN · 2026-08-25 · probado** — con Motai declarando `["CC","CE","PEP"]` como **política de la
> entidad** y sus filas de sucursal en `null`, el resolvedor devuelve `CC/CE/PEP`; Kreditkasa, cuyas
> entidades sí tienen el override, sigue devolviendo `CC/CE`. Los datos de prueba quedaron restaurados.
> Y la pantalla de crear entidad recibe el mapa país→tipos: `47 → CC/CE/PEP · 60 → CED/NUI ·
> 167 → DNI/CE`, con el selector oculto para los países sin tipos cargados.

> **MEDICIÓN · 2026-08-25 · en pantalla** — abrir una entidad en el admin mostraba el campo de **país
> vacío**: su valor (el 1) no está entre las opciones, que son los países con operación. Y como el
> `UpdateRequest` exige un país con operación, **guardar habría fallado en un campo que nadie tocó**, en
> **158 de las 159** entidades. Es el mismo puente que ya tenían los listados, que faltaba en el admin:
> el selector ofrece los habilitados **más** el heredado (rotulado) y la validación acepta ese valor.
> El trinquete gira para un solo lado — probado con los cuatro casos:
>
>     entidad en el país 1  →  guarda con el país 1        acepta   (si no, no se puede editar nada)
>     entidad en el país 1  →  se mueve a Colombia         acepta   (es lo que se quiere)
>     entidad en el país 1  →  se mueve a otro sin operar  rechaza
>     entidad en RD (60)    →  vuelve al país 1            rechaza
>
> Y el formulario **nunca cargaba** los tipos guardados (arrancaba en `[]`): editar cualquier otro campo
> los habría borrado. Comprobado sembrando `["CC","PEP"]` en la 168 — ahora los muestra como chips, con
> `CE` disponible sin marcar. Los datos quedaron restaurados.

> **DECISIÓN · 2026-08-25 (Miguel)** — **las 3 entidades que no se podían ni abrir SÍ entran a este PR.**
> Estaba anotado como «tarea aparte, no ensanchar el PR», y se revisó al medirlo: son **exactamente las
> 3 a las que el resto del PR no llega**. Esto le agrega un campo a una pantalla que para ellas no abría,
> así que arreglarlas es terminar lo de acá, no ampliarlo. Y las dos guardas viven en archivos que el PR
> ya toca.
>
> Eran **dos** anexos que pueden faltar, no uno: `additional_data` en `NULL` (3 entidades) y la línea de
> crédito inexistente (1, `QA Externo`, creada por fuera del admin). El primero deja la pantalla **en
> blanco** —`JSON.parse(null)` devuelve null y leerle un campo tira TypeError antes de montar—; el
> segundo revienta al **guardar**, así que a esa entidad no se le podía editar ni el nombre.
>
> La línea ahora se crea si falta: `store()` siempre la crea, o sea que **no tenerla es la anomalía**.
> Probado: las tres devuelven 200 y guardar `QA Externo` pasa de **500 a 302** dejando la fila creada.
> El estado del dump se restauró (se le borró la línea y se le volvió a poner `additional_data` en null).
>
> ⚠ El mismo patrón sin guarda sigue en la pantalla del CLIENTE (`ListLenders.vue`, 6 sitios). No entra
> acá: otra pantalla, otro riesgo.

> **MEDICIÓN · 2026-08-25 · el viejo contra el nuevo, en las 1.689 sucursales** — se corrió el
> resolvedor de antes y el de ahora sobre TODAS y se compararon las respuestas:
>
>     1.515  idénticas
>       173  Colombia   CC/CE  →  CC/CE/PEP
>         1  Rep. Dom.  CC/CE  →  CED/NUI
>
> **Las 173 son las sucursales sin NINGUNA entidad cargada** (`filas=0`). Antes contestaba el piso
> quemado `['CC','CE']`; ahora, como ninguna entidad opina, contesta el país — que en Colombia incluye
> PEP. **27 de ellas tienen tráfico** (510 solicitudes), pero sin entidades no se origina nada ahí: el
> listado sale vacío igual. No es una regresión, es el quemado reemplazado por el país en el único
> lugar donde nadie tenía una opinión. Si se prefiere conservador, el cambio es una línea.
>
> La de RD es el arreglo buscado: deja de ofrecer cédula colombiana en República Dominicana.
>
> ⚠ Y una trampa al medir esto: `SUM(lbab.status=1)` sobre un LEFT JOIN sin filas da **NULL**, no 0, así
> que `HAVING activas = 0` **no las encuentra**. Con `NOT EXISTS` aparecen las 173.

> **MEDICIÓN · 2026-08-25 · corriendo** — el flujo sigue cerrando: `motai` llega a **estado 11**, y los
> listados dan 12 (kreditkasa) y 7 (pullman). La API devuelve por país lo que corresponde:
>
>     GET /api/loans/allied/f0548728   Motai        CC/CE/PEP   +57  10  COP  es-CO
>     GET /api/loans/allied/1bfb8cd0   CeluRD Test  CED/NUI     +1   10  DOP  es-DO
>
> El front los lee anidados bajo `country` (`allied-theme.repository.ts`), que es donde la API los pone.

> **DECISIÓN · 2026-08-25 (Miguel)** — **el país de una entidad, con operación encima, no se mueve.**
> Simétrico a lo que ya hacía el comercio, pero importa más: el listado filtra las entidades por el país
> **del comercio**, así que moverle el país a una entidad **la saca del listado de todos los comercios
> del país viejo de un saque** — Credifamilia-addi está en **136 comercios** con **130.167 solicitudes**.
>
> ⚠ Con la salvedad que hace falta ahora: si está parada en un país donde **no** operamos, corregirla
> siempre se puede. Si no, arreglar el default histórico sólo saldría por SQL, que es lo que esto vino a
> sacar. Probado: hoy Credifamilia-addi (país 1) se deja mover; puesta en Colombia, **rechaza** irse a
> Perú. La guarda está **dormida hasta el backfill** y se activa sola.
>
> ⚠ Y el efecto que uno supone NO es el que pasa: cambiarle el país a una entidad **no** mueve los
> documentos de ninguna sucursal — ese filtro usa el país del COMERCIO. Lo que hace es desaparecerla.
>
> Hoy **9 entidades** se podrían mover libremente y **150** ya tienen operación encima.

> **MEDICIÓN · 2026-08-25 · la guarda, POR HTTP** — se probó pegándole a `PUT /entidades/{id}` con la
> sesión real del admin, no contra el validador aislado. Los siete escenarios dan lo esperado:
>
>     HOY (arrastran el país 1, que no opera)
>       Banco de Bogotá (136 comercios) · 1 → Colombia          pasa
>       Banco de Bogotá · 1 → Perú                              pasa   ← el hueco de la ventana
>     DESPUÉS del backfill (ya en su país)
>       Banco de Bogotá (con comercios) · Colombia → Perú       frena
>       Banco de Bogotá · Colombia → Colombia                   pasa   ← editar otros campos
>       Lagobo (sin comercios, CON solicitudes) · Col → Perú    frena
>       AV Villas (sin comercios ni solicitudes) · Col → Perú   pasa
>       AV Villas · Colombia → Afganistán (no opera)            frena  ← el techo de siempre
>
> El script queda en `harness/dev/probar-guarda-pais.sh`. Los datos se restauraron.
>
> ⚠ **Tres trampas del método, que costaron tres vueltas** y por eso el script las lleva escritas:
> 1. **Laravel redirige (302) tanto al guardar como al rechazar** — el código HTTP no distingue nada.
>    Lo único que distingue es **si la fila se movió**. Leer el status daba «todo acepta».
> 2. **curl NO manda cookies de dominio `.localhost` guardadas en un tarro** (`localhost` cuenta como
>    sufijo público), así que con `-c/-b jar` las peticiones salen **anónimas** y da «todo rechaza» —
>    el espejo exacto del error anterior, igual de convincente. Va a mano: `-b "nombre=valor"`.
> 3. **El payload incompleto da 500, no 422**: faltaban `complementary_form` y `status`, y la columna
>    es `NOT NULL`. Sin `Referer` eso se veía como un 302 más.

> **HALLAZGO AJENO · 2026-08-25** — al editar una entidad, `LenderController@update` hace
> `CreditLineByLender::where(...)->first()->update(...)` **sin comprobar que exista**. Si una entidad no
> tiene su línea de crédito, editar cualquier campo revienta. No se disparó en las tres probadas; queda
> anotado junto al crash de `additional_data`.

> **MEDICIÓN · 2026-08-25 · PROD · la causa raíz, y qué puede el backfill** — se descartó la hipótesis
> de que alguien hubiera **duplicado** Colombia: `countries` es la lista ISO completa en orden
> alfabético (1 Afghanistan · 2 Albania · 3 Algeria … 47 Colombia) y **hay una sola Colombia**. Colombia
> está donde le toca.
>
> Son **dos causas que se suman**, y por eso los comercios se salvaron y las entidades no:
>
>     lenders.country_id  int NOT NULL DEFAULT 1     ← quien no diga nada queda en Afganistán
>     allieds.country_id  int NOT NULL DEFAULT 1
>
> …y el Vue de entidades tenía la lista **escrita adentro**: `[{value: 1, title: 'Colombia'}]`, una sola
> opción con el id de Afganistán rotulado Colombia. El formulario del comercio siempre leyó del backend,
> así que decir algo servía. **En prod: 0 comercios en Afganistán · 191 entidades sí.**
>
> **Y el backfill NO es «los que apuntan a 1 pasan a Colombia»**, medido:
>
>     154  inferibles → Colombia            (por el país de sus comercios)
>       1  inferible  → Rep. Dominicana     (SmartPay, que YA está bien declarada)
>      37  sin comercios: no hay de dónde inferir   ← 34 activas, 12 con solicitudes alguna vez
>
> Las 37 necesitan una decisión, no un `UPDATE`. Y **ninguna entidad es ambigua** (cero en dos países),
> que es lo que hace segura la inferencia.
>
> ⚠ Y el backfill debería **quitar el `DEFAULT 1`** de las dos columnas: si no, la próxima fila que se
> cree sin país vuelve a Afganistán y el problema renace. Poner `DEFAULT 47` sería re-quemar Colombia
> en el esquema — justo lo que esto vino a sacar.

> **MEDICIÓN · 2026-08-25 · el backfill CORRIDO en local** — se aplicó y se revirtió con reversa exacta
> (`harness/dev/backfill-pais-local.sh`, que guarda **los ids** que movió: revertir «todo lo que esté en
> 47» se llevaría puestas las que mañana estén bien). Dos cosas salieron de correrlo:
>
> **1. El riesgo de secuencia, medido.** Con el backfill aplicado, lo que ve el **código viejo** —que
> filtra `where('country_id', 1)` a mano en los 5 listados— pasa de **154 entidades a 0**. O sea: si se
> corre antes de que qa y staging tengan P1, esos ambientes dejan de listar. El código nuevo no se
> inmuta: kreditkasa 12, pullman 7, Motai cierra en **estado 11**, idénticos al baseline.
>
> **2. El `UPDATE` en bloque NO es seguro en toda base.** En **prod** sí (verificado: las 154 con
> comercios son todas colombianas), pero en el dump **local** hay una entidad —`smartpay`, id 152—
> cableada al comercio **dominicano** y parada en el país 1. El UPDATE la manda a Colombia y **deja de
> pasar el filtro de su propio comercio**:
>
>     con el backfill    smartpay pais=47  ✗ NO pasa el filtro [1, 60] del comercio dominicano
>     revertido          smartpay pais=1   ✓ pasa
>
> La base compartida de dev/qa/staging **no es la de prod**, así que esto puede estar ahí también.
>
> **El arreglo mantiene lo bueno de la propuesta** —no nombra ninguna entidad, así que esquiva la
> divergencia de ids entre bases— y sólo le agrega una guarda:
>
>     UPDATE lenders SET country_id = 47
>      WHERE country_id = 1
>        AND NOT EXISTS (SELECT 1 FROM lenders_by_allieds la
>                          JOIN allieds a ON a.id = la.allied_id
>                         WHERE la.lender_id = lenders.id AND a.country_id <> 47)
>
> Simulado en local: mueve **157** y **deja 1 en el país 1** para revisión manual — que además sigue
> funcionando, porque el puente `[1, país]` la acepta.

> **MEDICIÓN · 2026-08-25 · el censo de lo que podría romperse** — se grepearon los dos repos buscando
> quién lee el país de una entidad. **Todos comparan contra 60 (Rep. Dominicana), ninguno contra 1 ni
> 47**: `TwilioController` · `NotificationService` (×3) · `PaymentCalculationService` ·
> `HolidayCalendarService` · dos comandos de cron · `LenderController` de application. La forma es
> siempre `=== 60 ? dominicano : colombiano`, así que mover una entidad de 1 a 47 **no cambia nada** en
> ninguno: los dos son «no 60».
>
> ⚠ Y ahí está el hallazgo que importa para Perú: esa forma binaria **trata «no dominicana» como
> colombiana**. Una entidad peruana recibiría festivos colombianos, la lógica colombiana de
> notificaciones y las reglas colombianas del plan de pagos. No lo rompe el backfill — está roto para
> Perú desde antes, y es lo próximo que se va a chocar.
>
> Y una pista que confirma el diagnóstico: en `LenderDatacreditoRulesController` hay un check del país
> **de la entidad** escrito y **comentado** (el del comercio sí corre). Con las entidades en Afganistán
> ese check habría bloqueado la creación de todas las reglas. Después del backfill se puede descomentar.

> **MEDICIÓN · 2026-08-25 · el mapa de ramas, corregido** — se había dicho «qa y staging dejarían de
> listar con el backfill». **Está mal.** Rama por rama de `legacy-backend`:
>
>     develop   sin hardcodes   ← 7f5c2301 ya mergeado el 24-ago
>     staging   3 hardcodes     ← PR #1204 (cherry-pick del mismo commit)
>     qa        3 hardcodes     ← PR #1193
>     main      3 hardcodes     ← espera el despliegue por tag
>
> Y **ninguno de los 3 está en el camino principal del listado**: `getLenders()` no filtra por país en
> esas ramas. Son el **fallback** (`LenderRetrievalService:458/470`), `validatePreApproveLender`
> (`OnboardingService:1782`) y `getActiveLendersByIds` (`Identity`, sin llamadas visibles). Las corridas
> normales no se rompen — se rompe la red de rescate y un camino secundario.
>
> ⚠ Y de los tres, **dos son casi inertes**: `validatePreApproveLender` lo **stubea el controlador con
> `random_int(0,1)`** en `local` y `development` (`OnboardingController:401`), y staging corre con
> `APP_ENV=development` — o sea que ahí ni se llama. Eso explica por qué el harness no lo vio caerse: en
> local **nunca se ejecuta**. El único vivo en staging es el fallback.
>
> El grave de verdad es **`legacy-application`**, que sí tiene el quemado en los 5 listados principales
> — y sólo corre en **dev** y **prod** (no hay qa ni staging de application), así que el PR #80 lo cierra
> entero para dev.

> **MEDICIÓN · 2026-08-25 · PROD · Cuotéalo ya existe, y está en Colombia** — `PRUEBAS_CUOTEALO` (331) y
> `PRUEBAS_CUOTEALO_VEHICULAR` (332), **una sucursal cada uno en Bogotá D.C., 0 solicitudes**. No son
> comercios de Perú: son comercios de prueba colombianos, porque no había otra opción.
>
> Dos cosas que se ven desde acá:
> 1. **Hoy no se podrían pasar a Perú** — `Allied::canChangeCountry()` los bloquea por tener sucursal,
>    aunque tengan **cero** solicitudes. La guarda del comercio es más estricta que la de la entidad
>    (que sí deja corregir un país sin operación). Queda como decisión abierta: si «operación» debería
>    significar *solicitudes* y no *sucursales*.
> 2. **Aunque se pudiera, no habría dónde ponerlos**: Perú tiene **25 zonas y 0 ciudades** (Colombia
>    1.123 · Rep. Dom. 8). Y **0 festivos** (Colombia 53 · Rep. Dom. 24).

> **MEDICIÓN · 2026-08-25 · validado contra las ramas reales, ya mergeadas** — con `origin/staging` y
> `origin/develop` servidos en local, en los dos mundos de datos:
>
>     origin/staging  datos de hoy (país 1)   kreditkasa 12 · pullman 7
>     origin/staging  con el backfill         kreditkasa 12 · pullman 7 · Motai estado 11
>     origin/develop  con el backfill         kreditkasa 12 · pullman 7
>
> Y el **contraste con `origin/qa`**, que todavía no tiene el puente, con el backfill puesto:
>
>     el listado principal          12 · 7      ← NO se rompe
>     lo que ve su filtro quemado   0 entidades ← el fallback y los secundarios quedan secos
>
> Las dos mitades confirmadas de una vez: `getLenders()` no filtra por país en esa rama, así que las
> corridas normales sobreviven; lo que muere es la red de rescate. El backfill local se revirtió.

> **ESTADO · 2026-08-25 · el censo de ramas, tras los merges**
>
>     legacy-backend      develop ✓  staging ✓  qa ⚠ (PR #1193)  main ⚠ (espera tag)
>     legacy-application  develop ⚠ (PR #80)  ·  staging ⚠  ·  main ⚠      ← 4 quemados cada una
>     frontend-monorepo   sin filtro de país en ninguna rama (es front)
>
> ⚠ `legacy-application` **tiene rama `staging`** aunque ningún workflow la despliegue (sólo hay
> `main-dev.yaml` → develop y `main-prod.yaml` → tag). Vale saberlo antes de suponer que arreglar
> develop cubre todo el repo.

> **HALLAZGO · 2026-08-25 · la causa raíz sigue VIVA, y por eso el backfill no quita el default** —
> `AlliedManagementService::storeAllied()` (módulo Partner, expuesto por `POST` de comercios y presente
> en las cuatro ramas, incluida `main`) arma el payload **sin `country_id`** y depende del `DEFAULT 1`.
> De ahí salen los comercios en Afganistán que hay hoy en la base compartida (Asyco, Free Spirit —con 19
> solicitudes— y crédito directo). O sea el bug **no es histórico: sigue produciendo filas**.
>
> Quitar el `DEFAULT 1` sin arreglar antes ese creador cambia un bug silencioso por un **500 en una ruta
> viva**. Y el arreglo no es obvio: el request de ese endpoint **no tiene** campo de país, así que
> agregarlo es tocar un contrato público. Queda como tarea aparte.
>
> ⚠ Los dos `store()` del admin (comercio y entidad, en application) **sí** mandan `country_id`. El
> único creador que no lo hace es ese endpoint del Partner.

> **ESTADO · 2026-08-25 · el backfill está escrito y probado** — `legacy-backend` PR #1205 → `qa`,
> migración `2026_08_25_120000_paises_backfill_del_default_historico.php`. Corrida en local:
>
>     comercios movidos 2 · entidades movidas 157 · entidades sin mover 1
>     ⚠ las que no se movieron atienden comercios de otro país
>
> La que no se movió es la atada al comercio dominicano — la guarda funcionó. Es **idempotente** (la
> segunda corrida mueve `0 · 0`), los listados no se mueven (12 · 7 · Motai a 11) y BCP no se toca.
> El `down()` **no revierte datos** a propósito. Los datos locales quedaron restaurados.

> **MEDICIÓN · 2026-08-25 · el ensayo general en local** — se corrió **la migración de verdad** (la del
> PR #1205, no el script) sobre el código completo de las tres ramas, y se comparó la MISMA tanda de
> **14 comercios en paralelo** antes y después:
>
>     ✓ IDÉNTICO — los 14 dan el mismo listado, ENTIDAD POR ENTIDAD
>
> No «el mismo número»: la misma lista de ids. Y el flujo entero: Motai cierra en **estado 11** y la
> suite `motai-creditopx` pasa sus **4 casos**. El comercio dominicano conserva sus dos entidades,
> porque la que la guarda dejó en el país 1 sigue pasando el puente `[1, 60]`.
>
> **Y el candado se activó solo, que era la promesa.** Abriendo Motai C en el admin después de migrar:
>
>     Pais: Colombia                      (antes: «Afghanistan — sin operación, pendiente de corregir»)
>     puedeCambiarPais: false             «Ya opera con comercios: cambiarle el país la sacaría…»
>     tipos que ofrece: CC · CE · PEP     (antes: deshabilitado, «el país no tiene tipos cargados»)
>
> Local quedó revertido: 158 en el país 1, la migración desmarcada y el archivo fuera del árbol.

> **HALLAZGO AJENO · 2026-08-25** — **el listado de `Creditop` (comercio 24) revienta con HTTP 500**:
> `Attempt to read property "sort" on null` en `LenderProbabilityService`. La causa es de datos y el
> código no la contempla: **Wompi (52) está cableada a su SUCURSAL pero no al COMERCIO**, y ese servicio
> lee el orden de `lenders_by_allieds` sin comprobar que la fila exista. El archivo no está tocado por
> ninguno de los PRs y falla **idéntico antes y después** del backfill — sirvió de control.

> **MEDICIÓN · 2026-08-25 · PROD · qué está mal en República Dominicana** — cuatro cosas, y la más
> grave NO la arregla el backend:
>
> **1. El catálogo del front tiene TRES opciones y `CED` no está entre ellas.**
> `documentTypeOptions` del formulario clásico es `["CC", "CE", "PEP"]`. El filtro cruza lo que manda el
> backend contra esa lista; si no matchea nada cae a `FALLBACK_OPTIONS` = **CC/CE**. O sea que aunque el
> backend ya devuelva `["CED","NUI"]` —verificado en local—, **el cliente dominicano ve CC/CE igual**.
> Los cambios del backend son necesarios pero **no suficientes** para RD.
>
> **2. Lo que la gente usa, medido sobre 571 personas de comercios dominicanos:**
>
>     CED    437   76,5%      ← la cédula dominicana, la que NO se puede elegir
>     CC     115   20,1%
>     PAS      9    1,6%
>     NUI      7    1,2%
>     CI_VE    3    0,5%
>
> Y el patrón de agosto es la firma del bug: **19 CC y CERO CED**.
>
> **3. Los datos declaran documentos colombianos**: 17 filas de sucursal en 11 comercios dicen
> `["CC","CE"]`. El resolvedor ya lo neutraliza (el cruce con el país da vacío y manda el país), pero el
> dato sigue mintiendo.
>
> **4. El catálogo de país que cargué para RD está incompleto**: `CED, NUI` cubre el 77,7%. **Faltan
> `PAS` y `CI_VE`**, que suman 12 personas reales.
>
> ⚠ Y dos datos del país, en prod: **`phone_code` vacío** y **0 ciudades** (tiene 32 zonas). El
> `cell_phone_lenght` dice **11**, que incluye el código de país — la migración lo corrige a 10.
>
> **El orden para arreglar RD**: primero el catálogo del front (si no, nada de lo demás se ve), después
> completar los tipos del país, y el dato de las sucursales al final —o nunca, porque el resolvedor ya
> lo cubre—.

> **HALLAZGO · 2026-08-25 · el formulario dinámico NO usa el país, y eso cambia dónde va el arreglo de
> RD** — sus opciones de documento salen de `data.fields.documentType.options`
> (`dynamic-form/src/ui/components/PersonalInfoForm.tsx`), o sea **del esquema que le manda el
> backend**. Y ese esquema lo sirve **`onboarding-forms-service`** —otro repo, ninguno de los tres que
> tocamos— leyendo **archivos JSON de un bucket de S3** (`dynamic_forms_s3.bucket`), no la base ni la
> tabla `countries`.
>
> Así que hay **DOS formularios con DOS fuentes**, y ninguna es el país:
>
>     clásico    catálogo QUEMADO de 3 (CC/CE/PEP) en el front, recortado por `allowed_document_types`
>     dinámico   JSON en S3, por formulario, servido por onboarding-forms-service
>
> **Consecuencia: esto NO entra en los PRs de países.** Es otro repo y otro mecanismo. Meterlo sería
> pretender que el país gobierna algo que hoy vive en un archivo de S3.
>
> ⚠ Y los 8 comercios dominicanos de prod tienen `new_screens = 1`, o sea que van por el flujo nuevo. Lo
> que queda por confirmar —y no se puede desde acá— es **cuál de los dos formularios** les toca, porque
> de eso depende si el arreglo es el JSON de S3 o el catálogo del front.

## Registro

### 2026-08-25

- **El admin ya puede editar los tipos de documento por entidad**, que era lo que obligaba a tocar SQL.
  Cada entidad de la sucursal tiene su selector y las opciones salen del país del comercio. Y de paso
  salieron **tres bugs**: el guardado que borraba la config, el `fillable` que faltaba y el cast ausente
  en dos modelos. Ver mediciones.


- **Cerrado el frente del teléfono en backend**, dentro del mismo commit consolidado (`d45caa44`): dos
  validaciones dejan de pedir 10 dígitos fijos —el registro y la validación de OTP— y las dos degradan al
  largo de siempre cuando el país no resuelve. Con eso **un cliente peruano ya puede escribir su número
  y validar su código**; el resto del muro son el documento y el buró.


- **CONSOLIDADO como pidió Miguel: una rama y un commit por repo.** Tres PRs, ni uno más:

  | repo | rama | PR | base |
  |---|---|---|---|
  | `legacy-backend` | `feature/pais-configuracion` | **#1193** | `qa` |
  | `legacy-application` | `feature/pais-configuracion` | **#80** | `develop` |
  | `frontend-monorepo` | `feature/telefono-prefijo-del-comercio` | **#879** | `qa` |

  Cerrados y borrados: #1192, #1195 y las ramas sueltas (`otp-sin-bypass-por-lista`,
  `largo-celular-por-pais`, `pais-desde-el-comercio-onto-qa`). El commit de `legacy-backend` junta las
  cuatro partes —listado, catálogo, teléfono y OTP— y el de front junta prefijo y largo.

  Verificado después de consolidar, no antes: cero literales de país, lint ok, y los tres casos del
  harness dan idéntico al baseline (1 · 12 · 9).


- **El teléfono del wizard, aterrizado.** El prefijo se muestra en vez de elegirse, y el largo sale del
  país. Dos ramas listas para PR (front y backend). Ver mediciones.

- **Lo que queda del teléfono, y no entró a propósito**: otros **dos formularios** usan el mismo
  desplegable con las opciones escritas —`ConsumerHubLogin` y el ingreso por **IMEI**—, y **la validación
  de largo del backend** sigue en `digits:10` en unos nueve sitios según el censo. El campo ya no deja
  escribir de más, pero el servidor todavía rechazaría un número de otro largo.


### 2026-08-24

- **Estrategia acordada con Miguel**: **el backfill se posterga** y las entidades se quedan en el país 1
  por ahora. Cuando todo esté integrado se corrige con **un comando** que sirva para la base compartida
  y para producción — y que **infiera en cada una**, porque los ids divergen. Mientras tanto, todo se
  valida en local.

- **Y se validó el estado final entero en local** (backfill + sin el puente): da idéntico al baseline.
  Ver mediciones. El plan cierra antes de tocar nada compartido.


- **Riesgo nuevo detectado antes de tocar nada** (pregunta de Miguel: «¿son los mismos comercios?»):
  los **ids de entidad divergen entre bases**, con 12 casos donde el mismo id es otra entidad. El
  backfill deja de ser «una lista de UPDATEs» y pasa a ser **dos operaciones separadas**, cada una
  calculada contra su propia base. Ver la medición.


- **Todo consolidado en UNA migración** (`2026_08_24_100000_paises_como_configuracion`) y **un commit por
  repo**: `legacy-backend` `75fe0585` (#1193 → `qa`) y `legacy-application` `8665218d` (#80 → `develop`).
  Las tres migraciones anteriores se revirtieron en local y se borraron.

- **Y ya corrió en la base compartida**, con protocolo: credenciales por entorno **sin tocar ningún
  `.env`** (el de `legacy-backend` lo usan los tests — es la trampa de CORE-431), `migrate:status` para
  confirmar contra qué base apuntaba, `--pretend`, SELECT antes, `--path` explícito, SELECT después y una
  corrida del harness para comprobar que no rompió nada.


- **La tarea (b) entró al PR consolidado** (`legacy-application` #80, commit único `8665218d`): el país
  del comercio se puede corregir mientras esté vacío. Ya no queda como tarea aparte.

- **Lo que sigue afuera de este PR, y por qué**: el **backfill** de las 191 entidades —no por tamaño
  sino por orden: sólo es seguro con el código ya desplegado, y en el mismo PR se despliegan juntos—;
  y el **teléfono** del censo (~50 sitios en tres repos), que es otro enunciado y volvería el PR
  irrevisable.


- **CONSOLIDADO (decisión de Miguel): una sola rama y un solo commit por repo, y el paso a paso en la
  descripción del PR.** Quedan **dos PRs**, no cuatro:

  | repo | rama | base | PR | contenido |
  |---|---|---|---|---|
  | `legacy-backend` | `feature/pais-configuracion` | **`qa`** | **#1193** | listado + 3 migraciones |
  | `legacy-application` | `feature/pais-configuracion` | **`develop`** | **#80** | listado + validación + selectores |

  Cerrados #1192 y #79 con nota. **#1191 queda mergeado en `develop` de backend** (P1 solo): no se
  deshace, y no molesta — `develop` y `qa` son ambientes distintos.

- ⚠ **Y el dato que ordena el despliegue: las migraciones NO las corre el deploy.** `main-dev.yaml` y
  `main-qa.yaml` no mencionan `migrate`; van por **`run-migrations.yml`, que es `workflow_dispatch`** —
  manual, con las credenciales de BD tipeadas a mano. Por eso el orden es **migrar primero, mergear
  después**: las migraciones son aditivas y nadie las usa hasta que el código esté, así que correrlas
  antes es seguro. Al revés, `legacy-application` queda con la validación pidiendo una columna que no
  existe y **el alta deja de funcionar**.

- **El squash se verificó corriendo**, no asumiendo: sobre el commit único, los tres casos dan idéntico
  al baseline (celurd 1/1 · kreditkasa 12 y 3 pre-aprobados · godentist 9 y 5).


- **(a) entró en P2, y encontró la causa raíz.** `Country::operating()` es ahora la fuente única de
  «dónde operamos» y la consumen las tres pantallas: alta de entidad, edición de entidad y alta de
  comercio. Commit `133c70dc` en `legacy-application` (`feature/catalogo-de-paises`, local). Con esto
  P2 cierra: la migración crea la columna, las validaciones la exigen y los selectores la ofrecen.

- **(b) queda como tarea aparte**: poder corregir el país de un comercio mientras no tenga sucursales ni
  solicitudes. Es funcionalidad nueva y tiene una decisión de negocio detrás (bajo qué condición, y
  quién puede hacerlo). No bloquea nada.


- **La regla del modelo, enunciada por Miguel y medida contra prod**: un comercio = un país, una entidad
  = un país; marca en varios países = varias filas. Los datos la respaldan (cero entidades multi-país,
  un solo comercio con marca duplicada y es un error). Ver decisión y mediciones.

- **Derivado, y es trabajo nuevo**: como el país **no se puede corregir** después de crear el comercio,
  equivocarse deja una fila huérfana. Dos arreglos que salen de acá y hoy no están en ninguna etapa:
  (a) que el alta **no traiga Colombia por defecto** —el censo señala `LenderCreate.vue:233`, que además
  rotula «Colombia» al id 1, que es Afganistán—, y (b) permitir **corregir el país mientras el comercio
  no tenga sucursales ni solicitudes**, que es exactamente el caso del `allied 336`.


- **Alcance acotado por Miguel (2026-08-24)**: el comercio peruano **no** se corre de punta a punta —
  falta demasiado del censo (teléfono, documento, buró). **Perú entra sólo como país nuevo en el
  catálogo**; la validación se hace con los dos países que sí operan: **SmartPay/CeluRD (RD)** y un
  comercio **colombiano**. Cómo se crea el comercio peruano se ve después.

- **A/B hecho sobre `qa` con esos dos países: sin diferencias.** Ver las mediciones. Y el fallback quedó
  sin ejercitar por una razón que vale registrar: **no se puede vaciar el listado**.


- **Censo terminado, y reordena el trabajo.** Seis PATRONES, no 140 lugares: (P1) el teléfono como
  identidad nacional implícita —~50 sitios y ~120 gemelos, y corrompe identidad aguas abajo: Cognito,
  lookup de usuario, bypass de OTP, PostHog—; (P2) el documento como proxy del país, que además decide
  **si se consulta buró y si se valida identidad**; (P3) el país como `if` contra un id literal, con el
  mundo binario CO/DO; (P4) **el default silencioso hacia Colombia**, el más caro porque *no falla:
  produce un dato colombiano plausible*; (P5) la magnitud del dinero como constante sin moneda adjunta;
  (P6) la configuración ya viaja y cada módulo hornea igual su propio país — el más barato de arreglar.

- **Lo que el censo confirma de nuestro trabajo**: P2 (la validación por `is_operating`) desbloquea el
  `AlliedController.php:86` que el censo señala como bloqueante, y la fila 167 con `phone_code = '+51'`
  resuelve el `OPERAN = ['COL','DOM']` de la migración de agosto que dejaba a Perú en NULL.

- **Y la recomendación #1 del censo coincide con lo que propuso Miguel**: correr un comercio peruano de
  punta a punta en local **antes de repartir un solo ticket**, porque el censo entero es lectura y en
  este dominio eso no alcanza. Preparación: hay que sembrar por SQL, y con `harness-listado` +
  `harness-caso` sobre un comercio `country_id=167` se obtiene el **orden real de los muros y su
  frecuencia** — que ningún grep da.

- **Rama contra `qa` armada**: `legacy-backend` **#1192** (`feature/pais-desde-el-comercio-onto-qa`,
  cherry-pick limpio sobre `qa`, sin literales restantes, lint ok). `legacy-application` se queda en
  `develop` con el PR **#79**, porque ese repo **no tiene rama `qa`**.


- **PR #1191 de `legacy-backend` MERGEADO y DESPLEGADO a dev** (merge 16:53Z, deploy `success` 16:59Z,
  `main-dev.yaml` → ECS `inertia-develop`). Validado ahí mismo: el comercio peruano pasa de ver **0
  entidades a ver 1**, los dos comercios colombianos sin cambios, y los logs limpios.

  **Con esto, `legacy-application` #79 queda habilitado para merge.** Lo único que aún no se ejercitó
  son el **fallback** y el **preaprobado** —dos de los cinco sitios— porque el listado por API no pasa
  por ahí; eso lo ejercita el uso real del equipo contra dev.


- **P1 PUSHEADO y con PR abierto en los dos repos** (2026-08-24). `legacy-backend` **#1191** y
  `legacy-application` **#79**, los dos contra `develop`, `MERGEABLE` y sin conflictos. ⚠ Los dos quedan
  en `BLOCKED` por **`REVIEW_REQUIRED`**: hay que pedir aprobación. Ninguno tiene checks de CI
  configurados, así que la única red es la revisión humana y la evidencia del PR.

  **Orden de merge decidido: `legacy-backend` #1191 PRIMERO.** Dos razones: es el único validado por
  corrida (el A/B se hizo contra él), y tiene **menos tráfico** — con el strangler, `application` es el
  **default** y backend atiende sólo la allowlist. El de más riesgo va segundo y con la validación del
  primero ya hecha.

  **Lo que hay que validar en dev entre uno y otro** (después de que #1191 despliegue):

      E2E_TARGET=dev I_KNOW_THIS_TOUCHES_SHARED_DEV=1 make harness-listado COMERCIO=<uno CO>
      E2E_TARGET=dev I_KNOW_THIS_TOUCHES_SHARED_DEV=1 make harness-listado COMERCIO=<uno DO>
      make harness-loki UREQ=<la que quede> SINCE=1h

  ⚠ `harness-listado` **escribe** (crea una solicitud), de ahí el flag de F-53 a mano. Y ⚠ **`develop`
  del front está congelado**, así que el wizard de dev no sirve para esto: la prueba es por API.


- **P2 hecho y validado en local.** Tres migraciones aditivas en `legacy-backend`
  (`feature/catalogo-de-paises`, `3d9369d9`) y la validación por `is_operating` en `legacy-application`
  (`feature/catalogo-de-paises`, `e9c4d4ce`). **Con esto ya se puede crear el comercio y la entidad
  peruanos** — que era el bloqueo duro.

- **El `.env` de `legacy-application` ya apuntaba a local** (`DB_HOST=127.0.0.1`, schema `creditop`,
  `APP_ENV=local`, `APP_URL=localhost:8000`) y la app **ya está corriendo en `:8000`** con el PHP del
  host. No hubo que tocar nada: se puede probar sin rozar la BD compartida. La auditoría
  (`make env-auditoria RAIZ=…/github`) marca un solo 🔴 en todo el árbol, y es ajeno a esta tarea:
  `legacy-backend/.env.testing` con `DB_USERNAME=root` — la causa raíz de CORE-431.

- **Queda escrito el runbook por ambiente**, arriba, con el orden entre las cuatro ramas y las dos
  trampas medidas: `migrate --path` obligatorio (un `migrate` pelado corre 17 pendientes en local) y
  `migrate:rollback --path` que **no filtra por archivo**.


- **P1 hecho también en `legacy-application`.** Rama **`feature/pais-desde-el-comercio`** (commit
  `6ed5a649`, **local, sin push**) desde `develop` (`640a5c90`). Cuatro archivos, cinco consultas: el
  listado, el preaprobado, el simulador y el fallback. En el simulador el contexto **no** es la solicitud
  sino la sucursal, que viene de un `find()` — se protege la cadena entera (`$alliedBranch?->allied?->`).
  ⚠ Este repo importa más de lo que parece: el strangler tiene a **application como default** en
  producción, con allowlist por comercio hacia legacy.

- **El `Rule::in([47, 60])` NO entró, y por una razón, no por olvido.** Es el alta de comercio y hoy
  impide crear el comercio peruano, pero para arreglarlo bien hace falta saber *en qué países operamos* —
  y esa columna (`countries.is_operating`) la crea **P2**. Cambiarlo a `[47, 60, 167]` sería mover el
  literal de lugar: el mismo error que ya descartamos con el `1 → 47`. **Va en P2, junto con la
  migración.** Corrige lo que decía la entrada anterior («lo metería en el mismo PR que P1»).


- **P1 hecho y validado en `legacy-backend`.** Rama **`feature/pais-desde-el-comercio`** (commit
  `7f5c2301`, **local, sin push**), sacada de `develop` actualizado (`750793bf`). Toca 6 archivos: los 3
  filtros literales, los 2 repositorios gemelos con su interfaz, y **el camino principal de `getLenders`**,
  que no estaba en el plan porque no estaba en el censo. Falta `legacy-application` (5 filtros + el
  `Rule::in([47,60])` del alta de comercio), que va en su propia rama.

- **El A/B funcionó como control, no como trámite**: el criterio 1 (nada cambia) dio verde **también con
  el cambio incompleto**, porque el fallback y el preaprobado no se ejercitan en una corrida normal. Fue
  el criterio 2 —mover la entidad de país— el que mostró que faltaba el camino principal. Sin ese segundo
  test, esto se habría mergeado creyendo que estaba completo.


- **De dónde sale esta tarea.** Salió de una pregunta sobre **moneda por país** en CORE-365: la respuesta
  fue que la moneda viaja en el payload (`country {…, currency, locale}`) pero **nadie la consume** en el
  front. Al tirar del hilo por la entidad peruana que viene, apareció el default 1 / Afganistán y el orden
  correcto para desarmarlo. **CORE-365 se pasó a `✅ Terminada`** el mismo día.

- **Todo lo de arriba es de hoy y está medido**, no heredado: los 8 filtros verificados con `git grep`
  contra `main`, el estado de la columna y del catálogo contra **prod** por SQL de sólo lectura, el radio de
  explosión con el dry-run contra dev, y el `RangeError` de `Intl` corrido en node.

- **Pendiente de decidir:** si esta tarea lleva P1+P2+P3 o se parte. Se resuelve después de adelantar P1.

## Tarea (publicable)

## En una línea
Hacer que el país de cada entidad y cada comercio sea un dato configurable, para poder habilitar Perú sin
publicar una versión nueva del sistema.

## Por qué
Hoy el sistema asume un solo país escrito en el programa, y casi todas las entidades quedaron registradas
con un país por defecto que no corresponde al que operan. Mientras eso siga así, una entidad de otro país
no aparece en los listados aunque esté bien configurada, y el país no se puede administrar: hay que tocar
el programa. La entidad nueva de Perú es el primer caso que lo exige.

## Qué cambia
Las consultas que arman el listado de entidades dejan de asumir un país fijo y pasan a usar el de la
sucursal que atiende al cliente. El alta de comercios deja de aceptar solamente Colombia y República
Dominicana. Y el registro de países queda completo y correcto para Perú (prefijo, longitud de celular,
idioma y moneda), con el resto de países de la región cargados pero **desactivados**, para que no se pueda
dar de alta un comercio en un país donde todavía no operamos.

## Alcance
Entra: el listado de entidades, el alta de comercios y el registro de países. **No** entra el aspecto
visual del formulario (la lista de prefijos telefónicos y el formato de la moneda en pantalla), los tipos
de documento por país, ni el catálogo de ciudades de Perú. Tampoco cambia nada de lo que ya ve un cliente
colombiano o dominicano: el comportamiento actual debe quedar idéntico.

## Dónde probar
Ambiente **dev** (comparte base con staging). Comercios de referencia: uno colombiano (**Dentix Chía**),
uno dominicano (**CeluRD Santo Domingo**) y el comercio peruano una vez creado.

## Cómo validar
1. **Que no se rompió nada**: entrar con un comercio colombiano y con uno dominicano y confirmar que el
   listado de entidades muestra **exactamente las mismas** que antes del cambio.
2. **Que el país nuevo funciona**: dar de alta un comercio de Perú desde el administrador — hoy el
   formulario no lo permite— y confirmar que la entidad peruana aparece en su listado.
3. **Que el registro quedó bien**: verificar que Perú tiene prefijo **+51**, longitud de celular **9**,
   idioma **es-PE** y moneda **PEN**; y que ningún país fuera de Colombia, República Dominicana y Perú
   puede seleccionarse al crear un comercio.

## Criterios de aceptación
- El listado de entidades de un comercio colombiano y de uno dominicano es idéntico antes y después.
- Se puede crear un comercio de Perú desde el administrador.
- Una entidad peruana aparece en el listado de un comercio peruano, y **no** aparece en uno colombiano.
- Ningún país sin operación habilitada puede elegirse al crear un comercio.
- Ninguna entidad activa queda registrada con un país que no corresponde al que opera.

## Dependencias / contraparte
- **Negocio**: definir a qué país corresponden las 28 entidades que hoy no tienen forma de deducirlo (o
  confirmar que están inactivas y se apagan), y qué países de la región se cargan desactivados.
- **Negocio**: confirmar la longitud de celular de República Dominicana (hoy figura 11 y en Colombia 10).
- **Orden obligatorio**: la corrección del registro de entidades sólo puede hacerse **después** de que el
  cambio del listado esté en producción. Al revés, las entidades desaparecen de los listados sin aviso.
