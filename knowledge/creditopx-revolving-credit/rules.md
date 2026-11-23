# Cupo rotativo CreditopX: otorgar, comprar, pagar y liberar

En el riel 3 (`response_type = 3`) no se aprueba un crédito sino un **cupo**: un tope que el cliente usa en varias
compras y que se libera al pagar. Este tema junta el ciclo del cupo; la cartera de cada compra, los pagos y el pagaré
tienen sus temas, enlazados donde corresponde. Describe `legacy-backend` y `legacy-application` en `main`.

## Un cupo y sus compras

El cupo es una fila por cliente y entidad en `creditop_x_revolving_credits`: `approved_limit` (lo aprobado),
`used_limit` (lo usado), la cuota, el pago mínimo, las fechas de pago y de corte, el plazo mínimo, la cuota inicial, el
FGA y el estado. Lo disponible es `approved_limit − used_limit`.

Cada compra es una **utilización**: un crédito con su propia cadena en `creditop_x_requests_history`, atado al cupo por
`revolving_credit_id`. Las utilizaciones activas son la fuente de verdad del cupo; los campos de la cabecera se derivan
de ellas (ver la consolidación nocturna).

## El otorgamiento: se calcula una vez

El motor de cupo (`/available-quota`) desvía el tipo 3 a `RevolvingCreditsService::getRevolvingCreditConditions`:

1. Si el cliente ya tiene un cupo aprobado (`approved_limit > 0`), devuelve lo disponible y no vuelve a evaluar.
2. Si es nuevo, corre primero la política dura de la entidad, como el consumo.
3. Lee Ágil Data, Mareigua y Experian. El ingreso declarado sólo cuenta si la entidad lo permite
   (`creditop_x_revolving_lender_settings`). Sin fuente de ingreso o sin score de Experian no hay cupo.
4. Calcula (`RevolvingCreditConditionsCalculator`, la traducción a PHP del procedimiento `SP_CreditopX_Revolving_Credit`):
   - **ingreso:** el promedio de 3 meses de Ágil Data, reemplazado por el de Mareigua si lo trae;
   - **capacidad:** ingreso − gasto fijo (un % por reglas de la entidad) − cuotas de Experian − cuotas con CreditopX,
     con piso en 0;
   - **cupo:** capacidad × multiplicador de riesgo (por rangos sobre variables del cliente), topado por
     `lenders.max_rev_credit` y truncado a decenas de mil;
   - **plazo mínimo, cuota inicial y FGA:** el plazo sale del tope sobre la capacidad; la cuota inicial y el FGA, de la
     fila de la entidad para el tramo del multiplicador.
5. Guarda el cupo y su historia, y registra cada cálculo con sus reglas (`creditop_x_revolving_credit_calculation_logs`).
   Una capacidad que no alcanza da cupo 0: rechazo.

En el listado, una entidad rotativa que no cumple las reglas duras se oculta, salvo que el cliente ya tenga un cupo
aprobado con ella: las reglas sólo frenan cupos nuevos ([el listado](knowledge:lender-listing)).

## Cada compra: la fecha y el plazo los pone el cupo

Con una línea activa, la compra reusa el pagaré maestro ([el pagaré](knowledge:deceval-promissory-note)). La cuota
inicial se mide contra lo disponible.

- **La fecha de pago** (`RevolvingPaymentDatePolicy`): la primera compra elige entre las fechas que la entidad permite,
  con el primer corte a 21 días o más. Con compras activas, la nueva toma el corte del cupo que quede a 10 días o más
  (`MIN_DAYS_TO_CUTOFF`) y no se elige. Si no lo alcanza, **todas** las compras pasan al corte siguiente (un
  aplazamiento); una cuota ya facturada no se mueve. Con 2 aplazamientos seguidos (`MAX_CONSECUTIVE_DEFERRALS`) el cupo
  no compra hasta que se pague la cuota aplazada.
- **El plazo** (`RevolvingTermPolicy`): al originar, el saldo de cada compra anterior se re-amortiza al plazo de la
  nueva, así que la nueva no puede ofrecer menos de lo que le falta a la que más tarde termina. Si eso supera el máximo
  que se ofrece, se ofrece el máximo.
- **Al autorizar** (`CreditopXRequestHistoryService::createFirstRegister`) se bloquean la cabecera del cupo y sus
  utilizaciones activas: si cambiaron desde la lectura, 409; si lo disponible no cubre `final_amount`, 422; si cuadra, la
  compra suma a `used_limit`.

## Pagar y liberar

El cliente paga la cuota del cupo, y el pago se reparte entre sus compras
(`CreditopXRevolvingCreditPaymentController`, con la cabecera bloqueada para que dos pagos del mismo cupo vayan en
fila): primero cubre el mínimo de cada utilización con lo aplicado; lo que sobra se reparte en proporción a la cuota de
cada una (en partes iguales si ninguna tiene cuota), y la última se lleva el residuo de redondeo. El cupo se libera
por el capital aplicado, acotado para que ningún campo quede negativo. La imputación dentro de cada compra es la del
pago de consumo ([el pago](knowledge:creditopx-payment-application)).

Cada noche, a las 04:00, `app:update-creditop-x-revolving-credits-command` de `legacy-application` (lo lanza
loan-servicing: [la cartera](knowledge:creditopx-portfolio-servicing)) consolida cada cupo: vuelve a derivar `used_limit`,
la cuota y las fechas de las utilizaciones activas, pasa a mora (e inactivo) el cupo vencido o lo devuelve a al día, y
mantiene o quita el bloqueo de gestión. Entra todo cupo con utilizaciones activas, en mora o bloqueado, porque
`used_limit` era un acumulador sin piso que se desviaba. `creditopx:auditar-rotativos` mide esa deriva sin escribir.

## Gestionar el cupo entero

Las acciones del admin no se aplican a una utilización suelta: se hacen sobre el cupo, desde su vista. Refinanciar el
cupo (`RefinanceRevolvingCredit`) pasa cada compra vigente por la refinanciación, con el mismo plazo y la misma primera
cuota. Refinanciar o condonar capital deja el cupo **bloqueado para comprar** mientras le quede alguna utilización de
antes del bloqueo; la consolidación nocturna lo mantiene y lo quita cuando se salda.
