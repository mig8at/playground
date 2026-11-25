# Convenio comercio–entidad y su habilitación en sucursales

Cubre qué escriben y qué borran las operaciones sobre un convenio (`lenders_by_allieds`) y la
habilitación de entidades en una sucursal (`lenders_by_allied_branches`), en las dos copias: el admin
de `legacy-application` (`Admin/AlliedLenderController`, `Admin/AlliedAlliedBranchController`) y la API
`Partner` de `legacy-backend` (`/api/partners`, `AlliedLenderController`,
`AlliedManagementService`), más la sucursal ecommerce (`EcommerceBranchCreator`). Describe código de `main`, no qué admin usa el equipo ni el estado de
un comercio. El alta y la baja del comercio están en `merchant-onboarding`.

## Crear un convenio

Las dos copias crean o reactivan el convenio con `LendersByAllied::switchOn` por (`lender_id`, `allied_id`): si la fila
existe la actualiza, si no la crea, y en los dos casos la deja con `status = 1`. Las dos escriben comisión, costos
administrativos (porcentaje y fijo), seguro de vida, FGA, IVA, múltiplo de monto máximo, banco, `url_utm`, orden,
autogestión, `hide_probability` y `confirmation_emails`; sólo `legacy-application` escribe además los cálculos de
tesorería (`credit_note_calculation_id`, `starting_value_calculation_id`) y la cuota inicial
(`initial_fee_percentage`). La copia de `Partner` dispara además `LenderCascade::merchant`. Si la entidad es CreditopX
(`response_type = 2`):

- crea una fila de `lender_guarantee_criteria` con variable, condición y valor en `null` (por
  defecto pide pagaré), con clave `lender_id` y sin comercio;
- en `Partner`, el controller da a los usuarios del comercio con perfil 4 o 6 los permisos
  `view creditop x requests` y `view creditop x`;
- en `legacy-application`, fuerza `iva = 19`. La copia de `Partner` guarda el IVA que llegue.

En `legacy-application` los permisos no los toca el controller: los recalcula `LendersByAlliedObserver` con
`CreditopXMerchantAccess`, después del commit, cuando se crea, se borra o cambia de `lender_id`, `allied_id` o `status`
una fila de `lenders_by_allieds` de una entidad tipo 2 o 3 (Credifamilia queda afuera). Lo que corresponde sale de qué
tipos tiene el comercio en convenios activos (`lenders_by_allieds.status = 1`): tipo 2 da `view creditop x`,
`view creditop x requests` y `register creditop x payments` a los perfiles 4, 6 y 7, y los reportes a 6 y 7; tipo 3 da
`register creditop x payments` y, a 6 y 7, los permisos del cupo rotativo. Al perfil 4 se le quita
`register creditop x payments` si su comercio está en el setting `creditop_x_allieds_without_comercial_payments`. Quien
registra pagos recibe además `reduce creditop x installments`, salvo los usuarios de SmartPay. No toca a los usuarios de
prueba (`users.is_test`). Una edición que no cambia `lender_id`, `allied_id` ni `status` no dispara el recálculo.

La fila de `lender_guarantee_criteria` se crea en cada `store` de una entidad CreditopX, aunque el `switchOn` sólo haya
actualizado o reactivado un convenio que ya existía o la entidad ya tenga filas por otro comercio: la entidad acumula
una fila por cada alta, hasta que un `update` o `destroy` de cualquier convenio de esa entidad borra todas sus filas de
`lender_guarantee_criteria` (y `update` recrea una sola si viene `guarantee_fund_request`), en los dos monolitos. Los
que la leen toman `where('lender_id', …)->first()` sin orden (`ConsentService` y `LenderGuaranteeCriteriaRepository` en
`legacy-backend`; `Customer/ConsentController` y `Customer/GuaranteeController` en `legacy-application`), así que con
varias filas no está definido cuál decide la garantía.

`store` no escribe `max_amount`: en un convenio nuevo queda en `null`. Sólo `legacy-application` escribe
`enable_collection` (`$request->enable_collection ?? true`); la copia de `Partner` no lo toca, así
que un convenio nuevo toma el valor por defecto de la columna (`true`) y uno existente conserva el
que tenía.

## Editar un convenio cambia datos de otros comercios

`update` reescribe los términos del convenio y después, en las dos copias:

- borra **todas** las filas de `lender_guarantee_criteria` con ese `lender_id` y, si el request pide
  fondo de garantía y la entidad es CreditopX, crea una nueva;
- borra **todas** las filas de `payment_methods_by_lender` con ese `lender_id` y, si llega una URL de
  medio de pago y la entidad es CreditopX, crea una.

Ninguna de las dos tablas tiene columna de comercio (sus migraciones sólo llevan `lender_id`), así
que son datos de la entidad que se editan desde el convenio: editar el convenio de un comercio
reemplaza (o elimina) el criterio de garantía y el medio de pago de esa entidad para todos los
comercios. Sólo `legacy-application` sincroniza además el subsidio de intereses del comercio
(`syncCreditopSubsidy`): abre una vigencia nueva del programa con alcance de comercio si cambió
algo y la cierra al apagarlo; los créditos ya originados conservan el programa con el que nacieron.
En `legacy-application`, editar también fuerza `iva = 19` para CreditopX.

Las dos copias escriben `max_amount => (int) $request->max_amount`, y el `UpdateRequest` (el mismo
en los dos repos) no valida ese campo: si el request no lo trae, el tope del convenio queda en `0`.
El listado de entidades (`LenderRetrievalService`, en los dos monolitos) reemplaza el tope de la
línea de crédito por el del convenio sólo si `max_amount != null`; en PHP `0 != null` es falso, así
que un `0` equivale a «sin tope propio» y manda el de la línea. Sólo `legacy-application` reescribe
`enable_collection` al editar (`?? true`: un request sin el campo lo vuelve a encender); `Partner` lo
deja como estaba.

## Quitar un convenio

`destroy`, sin transacción en las dos copias, hace los mismos pasos salvo en el apagado y los permisos:

1. en `legacy-application`, apaga las habilitaciones de esa entidad en **todas las sucursales del
   comercio** (`LendersByAlliedBranch::switchOffLenderForAllied`) y luego apaga el convenio
   (`LendersByAllied::switchOff`); en `Partner`, hace ambas cosas con `LenderCascade::merchant`;
2. en ambas copias borra todas las filas de `lender_guarantee_criteria` de la entidad, otra vez sin
   filtrar por comercio;
3. en `Partner`, si la entidad es de `response_type` 2, revoca a los perfiles 4 y 6 del comercio
   `view creditop x requests` y `view creditop x`, aunque el comercio tenga otro convenio CreditopX;
   con un rotativo (tipo 3) no revoca nada. En `legacy-application`, el cambio de `status` dispara el
   `LendersByAlliedObserver` de la sección «Crear un convenio», que revoca sólo lo que el comercio ya
   no justifica con los convenios activos que le quedan.

No toca `payment_methods_by_lender`. Como no hay transacción, un fallo a mitad deja los pasos
anteriores aplicados.

## Habilitar entidades al guardar la sucursal

`AlliedAlliedBranchController::update` (`legacy-application`) y `AlliedManagementService::updateAlliedBranch`
(`Partner`) toman sólo las entidades marcadas activas, apagan todas las filas de
`lenders_by_allied_branches` de la sucursal (`LendersByAlliedBranch::switchOffBranch`) y encienden
(`switchOn`) las seleccionadas dentro de una transacción. Por cada entidad leen `url_utm` del convenio
con `->first()->url_utm`: si el comercio no tiene convenio con esa entidad, la lectura sobre `null`
rompe el guardado y la transacción se revierte. Es el único lugar donde «sin convenio no hay
habilitación» se cumple, y lo hace por ese efecto lateral; al crear una sucursal ecommerce no se cumple
(sección siguiente). El `url_utm` de la sucursal se guarda en `null` cuando coincide con el del
convenio.

Diferencia entre copias: `legacy-application` conserva el `document_types` que cada entidad tenía en la
sucursal (o toma el de la entidad si es nueva); `Partner` enciende las filas sin escribir `document_types`.

Por cada entidad habilitada, las dos copias llaman a `addNewRule` y `addNewLenderRule`, que copian
las reglas de datacrédito y las reglas duras a la sucursal.

## Habilitar entidades al crear una sucursal ecommerce

Dar de alta la credencial ecommerce de un comercio crea una sucursal aparte con su credencial
(`EcommerceBranchCreator::create` en `legacy-application`, que usan
`AlliedEcommerceCredentialsController::store` y la provisión del asesor de prueba;
`AlliedManagementService::storeEcommerceCredential` en `Partner`). Dentro de la misma transacción
habilita las entidades que el comercio tiene en `lender_allied_credentials`, no las de
`lenders_by_allieds`: por cada credencial llama a `addNewRule` y `addNewLenderRule` y enciende la
relación en `lenders_by_allied_branches` con `LendersByAlliedBranch::switchOn` sin `url_utm`. No
lee el convenio, así que si el comercio tiene credencial con una entidad sin convenio, la sucursal
ecommerce la habilita igual, con reglas y sin términos comerciales. Qué hace el listado
con esa habilitación no está cubierto acá.

Diferencias entre copias: `Partner` filtra `lender_allied_credentials` por
`allied_type = Allied::class` con `distinct`, enciende la relación sin `document_types` (pasando
`allied_id` y `SetAuditDbContext::SOURCE_ADMIN_BRANCH`) y su `addNewLenderRule`
(`Partner\LenderRulesController`) copia la plantilla de la entidad dentro de la transacción;
`legacy-application` consulta sólo por `allied_id` sin filtrar `allied_type` (al ser una tabla
polimórfica, incluye credenciales de sucursales cuyo id coincida con el del comercio), guarda el
`document_types` de la entidad y su `addNewLenderRule` no copia: después del commit le pide a
`legacy-backend` que siembre la sucursal con la regla del comercio o, si no tiene, la de la entidad,
y si esa llamada falla la sucursal queda creada sin reglas duras.

## Apagar una habilitación es `status = 0`, y casi todos los lectores lo filtran

`lenders_by_allieds` y `lenders_by_allied_branches` tienen una columna `status` (booleana, por defecto
`true`). Los dos admins no borran la fila para quitar una entidad: la apagan con `status = 0` y la
reactivan con `switchOn`. En `legacy-application`, `AlliedLenderController::destroy` llama a
`LendersByAlliedBranch::switchOffLenderForAllied` y `LendersByAllied::switchOff`, y
`AlliedAlliedBranchController` usa `LendersByAlliedBranch::switchOffBranch`; en `legacy-backend`,
`Modules/Partner` apaga el convenio con `LenderCascade::merchant` (`AlliedLenderController::destroy`,
`AlliedLenderRepository::switchOff`) y la sucursal con `LendersByAlliedBranch::switchOffBranch`
(`AlliedManagementService`).

Los lectores principales filtran `status = 1`:

- el listado de entidades de `legacy-application` (`LenderRetrievalService`, también su camino de
  respaldo, en la sucursal y en el convenio) y los de `legacy-backend` (`Modules/Onboarding`
  `LenderRetrievalService`, y `LenderListingService` mediante `BranchLenderUniverse` y
  `LendersByAllied::where('status', 1)`);
- los permisos CreditopX de `legacy-application` (`CreditopXMerchantAccess::lenderTypesByAllied`, más
  `CreditopXPrincipalPaymentType::isSmartPayUser`) filtran `lenders_by_allieds.status = 1`, y
  `LendersByAlliedObserver` recalcula cuando cambia `status`;
- en `legacy-application`, `AlliedLenderController::index`, el simulador (`Customer/SimulatorController`,
  `index` e `indexV2`) y el `is_active` de las entidades de una sucursal en el admin; en `legacy-backend`,
  el mismo `is_active` de `Modules/Partner` (`AlliedManagementService`), `BackDoorService` y
  `BackDoorUserService` (`Modules/Onboarding`) y `getActiveByAlliedBranchId` del repositorio de
  `LenderV1`;
- el diagnóstico del backoffice (`Modules/Backoffice`, `ApplicationsService::apagadaEntities`) muestra
  como «apagada» la fila de sucursal con `status = 0` y la da por no evaluada, lo que coincide con cómo
  se apaga y con los listados que filtran.

No todos filtran: `Modules/Partner` `AlliedLenderController::index` lista todos los convenios del
comercio, apagados incluidos, y el repositorio de `LenderV1` que usa `OnboardingV2` para saber si la
sucursal tiene una entidad de cierto `response_type` (`hasLenderWithResponseType`) o alguna de una lista
(`hasAnyLender`) toma todas las filas de la sucursal sin mirar `status`.
