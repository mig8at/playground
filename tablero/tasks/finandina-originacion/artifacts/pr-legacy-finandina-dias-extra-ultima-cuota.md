feat(payment-plan): the lender profile says which installment carries the extra days of interest

## Qué cambia y por qué

El plan del riel de originación delegada cobra el interés de los días que pasan de 30 entre el desembolso y la primera
fecha de pago en **una** cuota. Hoy siempre es la primera: es la regla que Credifamilia confirmó por escrito. Banco
Finandina no liquida así: los T&C de su crédito (numeral 5) dicen que todas las cuotas valen lo mismo y que **la última**
«refleja el total del saldo adeudado por… días reales cobrados». Con la regla de Credifamilia, la primera cuota de
Finandina sale más alta que el resto.

Medido en qa con una solicitud de Banco Finandina (6.036.030 financiados, 1,83 % M.V., 36 cuotas, 11 días de más): la
primera cuota sale 280.561 y las demás 240.414; la diferencia, 40.148, es el interés de esos 11 días.

- `delegated_origination_profiles.extra_days_interest`: `first_installment` (default; Salud y Materiales no cambian) o
  `last_installment`. La migración agrega la columna y pone `last_installment` en el perfil de la entidad con slug
  `banco-finandina`, si existe en esa base. ⚠ En producción Banco Finandina todavía no tiene perfil, así que la
  migración no toca nada ahí: cuando se cargue su perfil hay que darle `extra_days_interest = last_installment`, o
  calculará con la regla de Credifamilia sin que nada lo avise.
- `DelegatedOriginationLenderProfile::extraDaysInterest()` lo lee; un valor desconocido tira, igual que un perfil faltante.
- `PaymentPlanPayloadBuilder` manda `extra_days_interest = last_installment` sólo en ese caso, como hace con el 4x1000:
  el payload de Credifamilia queda idéntico.
- El motor (`PaymentPlanInput`, `CalculationContext`, `ScheduleGenerator`) cobra el interés de los días en la cuota que
  dice el payload. Sin la clave, en la primera, como siempre. El total de intereses y el saldo no cambian.
- La respuesta de continuar la solicitud suma al final `first_installment_interest` y
  `first_installment_extra_days_interest`, para que el detalle de la primera cuota pueda sumar su total (hoy muestra
  capital y seguro y omite los intereses). Los campos de antes no cambian ni de valor ni de lugar.
- Límite conocido: esa respuesta sigue proyectando sólo la primera y la segunda cuota, así que con `last_installment`
  no dice que la última sale más alta. El plan de cuotas completo sí la trae.

## Qué se tocó

- `database/migrations/2026_11_25_160000_add_extra_days_interest_to_delegated_origination_profiles.php`
- `app/Models/DelegatedOriginationProfile.php`
- `app/Services/PaymentPlan/DelegatedOrigination/DelegatedOriginationLenderProfile.php`
- `app/Services/PaymentPlan/DelegatedOrigination/PaymentPlanPayloadBuilder.php`
- `app/Services/PaymentPlan/DelegatedOrigination/DTO/PaymentPlanInput.php`
- `app/Services/PaymentPlan/DelegatedOrigination/Engine/CalculationContext.php`, `ScheduleGenerator.php`, `AmortizationEngine.php`
- `app/Services/PaymentPlan/DelegatedOrigination/ContinueRequest/PaymentPlanContinueRequestService.php`
- Pruebas: `tests/Unit/Services/PaymentPlan/DelegatedOrigination/ExtraDaysInterestOnLastInstallmentTest.php` (nueva),
  `ContinueRequestAdvanceBondTest.php` y `tests/Unit/PaymentPlan/DelegatedOrigination/DelegatedOriginationLenderProfileTest.php`.

## Cómo se comprobó

- Las pruebas unitarias del riel (`tests/Unit/Services/PaymentPlan/DelegatedOrigination` y las de
  `tests/Unit/PaymentPlan/DelegatedOrigination` que no levantan la aplicación): 86 de 86, entre ellas las nuevas: sin la
  clave los días van en la primera; con `last_installment` todas las cuotas valen lo mismo y la última suma exactamente
  el interés que antes iba en la primera, con el mismo total; un valor desconocido es un error.
- El caso visto en qa, recalculado con el motor (5.450.000 al 9 % con IVA y 4x1000 = 6.036.030, 1,83 % M.V., 36
  cuotas, desembolso el 2026-11-25 y día de pago 5): `first_installment` da 280.561 / 240.414 / 240.414 (primera, segunda, última);
  `last_installment` da 240.414 / 240.414 / 280.561.
- ⚠ `DelegatedOriginationLenderProfileTest` (que suma el caso de la migración: Finandina pasa a la última, Salud y
  Materiales quedan en la primera, y un valor desconocido tira) **no se corrió**. Sus perfiles van a un SQLite en
  memoria, pero extiende `Tests\TestCase`, cuyo `setUp` crea las tablas de reglas base en la conexión MySQL por
  defecto (`CreatesBaseRuleTables`), y no había un MySQL local arriba: los 17 casos de la clase salen con
  «Connection refused» antes de llegar al test.
- Falta: aplicar la migración en qa y ver el plan de una solicitud de Banco Finandina con la primera cuota igual a las
  demás.

Va junto con el cambio de la pantalla en frontend-monorepo (Creditop-SAS/frontend-monorepo#1563), que muestra los dos
intereses nuevos.
