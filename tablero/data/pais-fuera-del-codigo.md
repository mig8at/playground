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

Esta tarea nace del cierre de **CORE-365** (internacionalización del onboarding), que quedó
`✅ Terminada` el 2026-08-24: lo que se mergeó ahí —el prefijo de celular por país y el árbol de ciudades—
está desplegado. Lo que sigue vivo es su **diagnóstico**, y hasta que gradúe a un nodo de `context/` la
fuente es `git show <sha>:tablero/data/internacionalizacion-onboarding.md`.

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

## Registro

### 2026-08-24

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
