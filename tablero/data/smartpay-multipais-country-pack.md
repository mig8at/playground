---
id: 44
title: "El país deja de estar escrito en el código y pasa a ser configuración"
stage: work
created: "2026-08-08T09:00:00-05:00"
context_nodes: [smartpay, entities, actors, dynamic-forms, frontend-monorepo]
jira: []
jira_title: "El país del comercio deja de estar escrito en el código y pasa a ser configuración"
---

ESTADO 2026-08-08: **3 ramas locales, un commit cada una, ninguna pusheada.** Probado contra la copia
local. Se espera que suban los cambios de Motai a `main` antes de abrir los PRs; las ramas ya nacen de
`main` al día, así que sólo hay que rebasar y abrir.

| repo | rama | commit | archivos |
|---|---|---|---|
| `legacy-backend` | `feature/pais-como-dato` | `7933352f` | 9 |
| `legacy-application` | `feature/pais-como-dato` | `c81320b0` | 3 |
| `frontend-monorepo` | `feature/pais-como-dato` | `410976d4` | 5 |

## QUÉ SE HIZO

**1) `legacy-backend` — el país como dato, y la puerta para que viaje**

- `2026_08_08_100000_populate_phone_code_from_dial_code` — llena `countries.phone_code` (la columna que
  el código LEE) desde `dial_code` (la que estaba llena). Sólo COL y DOM; el `+` va incluido porque los
  lectores concatenan sin normalizar. El valor se **deriva**, no se escribe a mano.
- `2026_08_08_110000_seed_dominican_republic_cities` — los 8 municipios del área metropolitana de Santo
  Domingo. `country_cities` tenía 1.123 colombianas y **cero** dominicanas. `code` vacío a propósito
  (en Colombia es el DANE y sus dos usos son colombianos); la provincia se resuelve por NOMBRE, no por id.
- `2026_08_08_120000_add_nationality_to_countries_table` — columna `nationality` + los gentilicios de
  COL y DOM. **Aditiva**: `form-service` lee esta tabla por nombre de columna.
- `OnboardingPayloadBuilder::resolveNationality` — el gentilicio del documento sale de:
  dato del cliente → gentilicio del país del **comercio** → `'COLOMBIANA'`. Antes era el literal fijo.
- `AlliedInfoController::show` — devuelve `country { id, name, iso_code, phone_code, currency, locale }`.
  El país se carga con `loadMissing('allied.country')` en el controlador, no en el repositorio, para no
  cambiarle el costo a los otros llamadores de `findBranchByHash`.
- `app/Console/Commands/AuditBranchCountryCommand` — `paises:auditar-sucursales`, solo lectura, exit 1
  si encuentra algo. **No corrige**: elegir el municipio exige leer la dirección y eso es criterio humano.
- 2 tests (10 casos): la precedencia del gentilicio y la del prefijo.

**2) `legacy-application` — los dos selectores de ciudad**

- `AlliedAlliedBranchController::index` — el listado del selector del **punto de venta**, que es donde
  ocurrió el bug: precargaba las 1.131 ciudades sin filtro. Ahora filtra por el país del comercio.
- `CityController::getCities` — el endpoint del modal de **entidades**, con `allied_id` opcional para no
  romper a un llamador que no lo mande. El id del comodín «TODAS LAS CIUDADES» pasa a constante con
  nombre y ya no se desreferencia sin chequear.
- `AlliedLenderEditModal.vue` — manda el `allied_id`.

**3) `frontend-monorepo` — el país llega a las pantallas**

- `allied-theme/types` + `allied-theme.repository` — el tema del comercio transporta `country`, tipado y
  validado. Se descarta ENTERO si le falta prefijo, idioma o moneda: uno a medio configurar es peor que
  ninguno.
- `PhoneForm` + `dynamic/request-phone` — el prefijo preseleccionado sale del país del comercio. Arrancaba
  en `+1` fijo, y ese formulario lo usa **Credifamilia** (lender 24, `form_type` 6, **colombiano**).
- `additional-info-form` — la lista de departamentos y ciudades sale del país del comercio. Tenía Colombia
  fija con un TODO del autor pidiendo exactamente esto.

## LO QUE NO ENTRÓ, Y POR QUÉ

- **La corrección de los 13 puntos de venta dominicanos.** Es el daño que ya está en producción y **no es
  código**: 4 de las 13 direcciones traen el municipio inequívoco, 2 no tienen dirección usable («Tienda
  1», «Tienda 2») y el resto son ambiguas — la Autopista Duarte cruza varios municipios. Hay que
  preguntarle a los comercios. El comando ya imprime la dirección de cada uno para eso.
- **El registro de países mal cargado.** La fila `countries.id = 1` se llama «Afghanistan» y tiene moneda
  e idioma de Colombia; a ella apuntan **186 entidades y 364.527 usuarios**. Hoy es inocuo porque el
  camino vivo resuelve por comercio, que apunta a la fila correcta. **Tarea aparte por ser destructiva**,
  y en el mismo cambio tienen que ir las 8 consultas con id de país fijo o el listado de crédito queda
  vacío.
- **Consolidar la resolución del país en el backend.** Las 4 copias de `currency_format` y las 4 de la
  heurística `$isDoLogic` siguen repartidas. Nada se comporta mal hoy por eso: es orden.
- **El valor por omisión del formateador de plata del front.** De 28 llamadas, 21 no pasan el idioma y
  caen a Colombia en silencio. Quitarlo obliga a tocar esas 21 — merece su propio PR.
- **La semántica de `cell_phone_lenght`.** Dice 10 para Colombia y 11 para RD, y los dos móviles
  nacionales son de 10 dígitos. Sin definir eso, no se puede validar largos con esa columna, así que **no
  se expone al front**.

## CÓMO SE PROBÓ (local)

- 10 tests unitarios en verde.
- `paises:auditar-sucursales` encontró el caso local, se corrigió el dato, y ahora da limpio.
- El endpoint por HTTP: comercio dominicano → `+1 · DOP · es-DO`; colombiano → `+57 · COP · es-CO`.
- La nacionalidad, con solicitudes reales del volcado: comercio colombiano sigue en `COLOMBIANA`,
  dominicano pasa a `DOMINICANA`.
- El selector de ciudad, con sesión real en el admin levantado en local: comercio dominicano pasó de
  1.131 ciudades a 9 (8 municipios + el comodín); el colombiano conserva 1.122 y sigue teniendo MEDELLÍN.
  Buscar «medel» con un comercio dominicano ahora no devuelve nada.
- Flujo completo por API (`sweep`): comercio colombiano lista sus 9 entidades y el dominicano cierra 11
  de 12 pasos. El paso 12 falla por el hardcode de SmartPay (ver abajo), no por esto.

## GOTCHAS QUE COSTARON TIEMPO

- ⚠ **La copia local está desincronizada con `main` en las dos direcciones.** Le falta `allied_modes`
  (la borró una migración que se mergeó a `qa`, y `main` todavía la consulta en 16 archivos) y le
  faltaban tres columnas de `otps`. Sin eso el wizard local muere y la firma da 500. El registro de
  migraciones del volcado tampoco vino: `migrate` dice «pendiente» sobre tablas que ya existen.
- ⚠ **El flujo de SmartPay no se puede cerrar en local, y no es por este cambio.** `isSmartPay()` exige
  que el prestamista sea el **160**; en local es el **152**, así que el desembolso se va por la rama
  estándar y muere en un null. Llamando al servicio directamente funciona. Es el hardcode ya registrado
  desde julio (F-21/F-32), y es de CANAL, no de país — las dos tareas son independientes.
- ⚠ **`develop` no sirve como base para el frontend**: está a mitad de sacar `@creditop/form-engine`, y
  con `node_modules` instalado para `main` el wizard compila varios minutos y después muere. Las tres
  ramas nacen de `main`.
- ⚠ **`iso_code` trae el código de TRES letras** (COL/DOM). La columna del backend se llama `iso_code_2`
  pero guarda el de tres, y la de tres está vacía.

## Tarea (publicable)

## En una línea
El país del comercio pasa a ser configuración que el sistema consulta, en vez de estar escrito dentro del
programa como «Colombia».

## Por qué
Llevamos cinco meses originando crédito en República Dominicana con el país escrito en el código, y eso ya
produce datos incorrectos: los puntos de venta dominicanos quedaron registrados en una ciudad de Colombia
que se llama igual, los mensajes salen con el prefijo telefónico colombiano y los contratos dominicanos
dicen «COLOMBIANA». No falta funcionalidad: falta que el país sea un dato que el sistema consulte.

## Qué cambia
- El **prefijo telefónico** sale del país del comercio. El dato ya existía, pero estaba guardado en una
  columna que el sistema no lee.
- Se cargan las **ciudades de República Dominicana**. No había ninguna, y por eso el selector sólo podía
  ofrecer ciudades colombianas.
- El **selector de ciudad del admin** sólo ofrece ciudades del país del comercio. Si el comercio es
  dominicano, la ciudad colombiana ya no aparece.
- Los **documentos** toman la nacionalidad del país del comercio cuando no está el dato del cliente, en
  vez de decir siempre «COLOMBIANA».
- El **país viaja al flujo de solicitud**: la pantalla del teléfono y la de datos complementarios lo usan
  en vez de asumir Colombia.
- Se agrega una **revisión** que lista los puntos de venta cuya ciudad está en otro país que su comercio.

## Alcance
- Aplica a los comercios de República Dominicana y a los de Colombia por igual: cada uno recibe su país.
- **Colombia no cambia.** Antes obtenía «+57» por omisión y ahora lo obtiene del dato: es el mismo valor.
- **No** corrige los puntos de venta ya mal registrados: eso necesita confirmar la dirección con cada
  comercio.
- **No** valida el largo del número de celular: ese dato está definido de forma ambigua entre los dos
  países y se decide aparte.
- Si el país no se puede determinar, todo se comporta como antes: ninguna pantalla queda bloqueada.

## Dónde probar
- Ambiente de pruebas · un comercio de República Dominicana y uno de Colombia.
- **Precondición:** el comercio dominicano debe tener el país configurado y al menos un punto de venta.

## Cómo validar
1. **Admin, comercio dominicano** → editar un punto de venta → el selector de ciudad sólo ofrece
   municipios dominicanos. Buscar una ciudad colombiana no devuelve nada.
2. **Admin, comercio colombiano** → el selector sigue ofreciendo las ciudades de siempre (regresión).
3. **Solicitud en comercio dominicano** → el documento generado dice «DOMINICANA».
4. **Solicitud en comercio colombiano** → el documento sigue diciendo «COLOMBIANA» (regresión).
5. **Revisión** → correr `paises:auditar-sucursales`: lista los puntos de venta mal registrados y no
   modifica nada.

## Criterios de aceptación
- Un comercio dominicano no puede quedar con una ciudad de otro país desde el admin.
- Un comercio colombiano se comporta exactamente igual que antes en las cuatro pantallas tocadas.
- El documento de una solicitud dominicana no dice «COLOMBIANA».
- Si el país de un comercio no está configurado, el flujo sigue funcionando con el comportamiento actual.
