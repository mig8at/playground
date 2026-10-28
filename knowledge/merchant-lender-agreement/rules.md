# Convenio comercio–entidad y su habilitación en sucursales

Cubre qué escriben y qué borran las operaciones sobre un convenio (`lenders_by_allieds`) y la
habilitación de entidades en una sucursal (`lenders_by_allied_branches`), en las dos copias: el admin
de `application` (`Admin/AlliedLenderController`, `Admin/AlliedAlliedBranchController`) y la API
`Partner` de `legacy-backend` (`/api/partners`, `AlliedLenderController`,
`AlliedManagementService`). Describe código de `main`, no qué admin usa el equipo ni el estado de
un comercio. El alta y la baja del comercio están en `merchant-onboarding`.

## Crear un convenio

Las dos copias hacen `updateOrCreate` por (`lender_id`, `allied_id`) con los términos del request:
comisión, costos administrativos (porcentaje y fijo), seguro de vida, FGA, IVA, cuota inicial,
banco, cálculos de tesorería, `url_utm`, orden y autogestión. Si la entidad es CreditopX
(`response_type = 2`):

- crea una fila de `lender_guarantee_criteria` con variable, condición y valor en `null` (por
  defecto pide pagaré), con clave `lender_id` y sin comercio;
- da a los usuarios del comercio con perfil 4 o 6 los permisos `view creditop x requests` y
  `view creditop x`; `application` agrega `register creditop x payments`;
- en `application`, fuerza `iva = 19`. La copia de `Partner` guarda el IVA que llegue.

## Editar un convenio cambia datos de otros comercios

`update` reescribe los términos del convenio y después, en las dos copias:

- borra **todas** las filas de `lender_guarantee_criteria` con ese `lender_id` y, si el request pide
  fondo de garantía y la entidad es CreditopX, crea una nueva;
- borra **todas** las filas de `payment_methods_by_lender` con ese `lender_id` y, si llega una URL de
  medio de pago y la entidad es CreditopX, crea una.

Ninguna de las dos tablas tiene columna de comercio (sus migraciones sólo llevan `lender_id`), así
que son datos de la entidad que se editan desde el convenio: editar el convenio de un comercio
reemplaza (o elimina) el criterio de garantía y el medio de pago de esa entidad para todos los
comercios. Sólo `application` sincroniza además el subsidio de intereses del comercio
(`syncCreditopSubsidy`): abre una vigencia nueva del programa con alcance de comercio si cambió
algo y la cierra al apagarlo; los créditos ya originados conservan el programa con el que nacieron.
En `application`, editar también fuerza `iva = 19` para CreditopX.

## Quitar un convenio

`destroy`, igual en las dos copias y sin transacción:

1. borra las habilitaciones de esa entidad en **todas las sucursales del comercio**
   (`lenders_by_allied_branches`);
2. borra el convenio;
3. borra todas las filas de `lender_guarantee_criteria` de la entidad, otra vez sin filtrar por
   comercio;
4. si la entidad es CreditopX, revoca los permisos de CreditopX a los perfiles 4 y 6 del comercio,
   aunque el comercio tenga otro convenio CreditopX.

No toca `payment_methods_by_lender`. Como no hay transacción, un fallo a mitad deja los pasos
anteriores aplicados.

## Habilitar entidades al guardar la sucursal

`AlliedAlliedBranchController::update` (`application`) y `AlliedManagementService::updateAlliedBranch`
(`Partner`) toman sólo las entidades marcadas activas, borran todas las filas de
`lenders_by_allied_branches` de la sucursal y las recrean dentro de una transacción. Por cada
entidad leen `url_utm` del convenio con `->first()->url_utm`: si el comercio no tiene convenio con
esa entidad, la lectura sobre `null` rompe el guardado y la transacción se revierte. Es el único
lugar donde «sin convenio no hay habilitación» se cumple, y lo hace por ese efecto lateral. El
`url_utm` de la sucursal se guarda en `null` cuando coincide con el del convenio.

Diferencia entre copias: `application` conserva el `document_types` que cada entidad tenía en la
sucursal (o toma el de la entidad si es nueva); `Partner` recrea las filas sin `document_types`.

Por cada entidad habilitada, las dos copias llaman a `addNewRule` y `addNewLenderRule`, que copian
las reglas de datacrédito y las reglas duras a la sucursal.
