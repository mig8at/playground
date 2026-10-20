# Ronda 2026-10-20 · cartera, creditopx, codeudor, formalizacion, documentos

Comparado contra `origin/main`: legacy-backend `406bf8a2`, legacy-application `0c86754d`. Prosa contra el
corpus de hoy (`make canon-export`, revisión `f201706ef5f8`). Diffs de blob viejo → nuevo de cada línea.

50 líneas de la ronda, 33 rutas distintas. En cartera la misma ruta se repite (×n) porque la declaran
varias áreas del tema; el veredicto cubre todas sus áreas.

## Piezas (16) · todas pasan `make canon-write DRY=1`

| pieza | qué hace |
|---|---|
| `cartera-verificado.json` | sube el hash de los 17 archivos de cartera de la ronda |
| `creditopx-verificado.json` | sube 4 |
| `codeudor-verificado.json` | sube 1 |
| `formalizacion-verificado.json` | sube 10 |
| `documentos-verificado.json` | sube 7 (no incluye el borrado `payment_schedule_notes/lender_77`) |
| `cartera-pantalla-publica.json` | **corrección** · «El cliente paga solo en la pantalla pública…» |
| `cartera-minimo-exacto.json` | **corrección** · «Un mínimo ya pagado que quedó en mora se regulariza esa noche» |
| `creditopx-rechazo.json` | **corrección** · «El rechazo desaparece sin mensaje, y no es una falla» |
| `formalizacion-escritorio.json` | **corrección** · «El cierre es hostil al escritorio, a propósito» |
| `documentos-credipullman.json` | **corrección** · «CrediPullman promete en sus documentos…» |
| `documentos-quien-dibuja.json` | **corrección** · «Quién dibuja cada documento…» |
| `documentos-plantilla.json` | **corrección** · «El pagaré usa una plantilla de la entidad o la genérica» |
| `cartera-cuota-inicial.json` | **agregado** · «La cuota inicial queda en el registro de pagos, en línea o en caja, y no es un abono al crédito» |
| `formalizacion-pagare-rotativo.json` | **agregado** · «Un cupo rotativo firma su pagaré una vez, y las compras siguientes reutilizan ese» |
| `formalizacion-netco-configurable.json` | **agregado** · «Una entidad puede firmar por un camino de Netco configurable, que se decide antes que todo» |
| `formalizacion-celular.json` | **agregado** · «En el auto-onboarding de tienda, el cliente puede corregir su celular una vez en la pantalla del código de firma» |

Orden para el lote (las correcciones de documentos enlazan a dos agregados de formalización):
verificados → agregados → correcciones, como en el ensayo.

## Veredicto por línea

### cartera (26 líneas, 17 rutas)

| ruta | × | veredicto | motivo |
|---|---|---|---|
| LA `app/Http/Controllers/Admin/CreditopXPaymentController.php` | 4 | verificado + **corrección** (mínimo exacto) | redondea a 4 decimales el sobrante y lo que queda del mínimo antes de comparar con cero (`CreditopXPaymentController.php:180`, `:925-930`); la prosa decía que el residuo dejaba el crédito en mora. Las demás secciones de sus áreas siguen ciertas |
| LA `app/Models/CreditopXPaymentRegister.php` | 2 | verificado + **agregado** (cuota inicial) | sólo suma las constantes tipo 7 y «Caja comercio» (`CreditopXPaymentRegister.php:18`, `:26`) |
| LA `app/Http/Controllers/Admin/CreditopXRequestHistoryController.php` | 1 | verificado + **agregado** (cuota inicial) | excluye `is_test` de los conteos (`:221`, `:251-265`), saca el tipo 7 de «Dinero Recaudado» (`:400`), el enlace de pago va a la app de pagos (`:1859`); ninguna sección del área 1 lo contradice |
| LA `app/Http/Controllers/Customer/CreditopXRequestHistoryController.php` | 1 | verificado | sólo el enlace de pago, ahora `PaymentsUrl::forCredit` (`:427`); cubierto en la corrección de la pantalla pública |
| LA `app/Console/Kernel.php` | 2 | verificado | agrega `app:reconcile-payment-unlocks` cada 10 min fuera de 00:00-01:00 (`Kernel.php:65`); no es un cierre nocturno: «cinco comandos nocturnos» sigue cierto. Pertenece al tema **imei** (desbloqueo), no se escribe acá |
| LA `app/Http/Controllers/Admin/RevolvingCreditsController.php` | 2 | verificado | excluye utilizaciones de prueba (`:173`, `:444`) y saca el candado de la pantalla; las secciones de rotativo y reportes siguen ciertas |
| LA `app/Services/CreditopX/OriginatedRequestsQuery.php` | 2 | verificado | exclusión `is_test` (`OriginatedRequestsQuery.php:73`, `:124`, `:131`); los filtros que describe la prosa no cambian |
| LA `resources/js/pages/admin/requestsCreditopX/Index.vue` | 1 | verificado | el botón del reporte se apaga sólo durante la petición (`Index.vue:210`); ninguna sección habla del candado |
| LA `resources/js/pages/customer/requestsCreditopX/request-detail/RequestDetail.vue` | 1 | verificado | enlace de pago a la app de pagos y rótulo de cuota inicial (`:385`, `:857`) |
| LA `resources/js/pages/admin/requestsCreditopX/request-detail/RequestDetail.vue` | 1 | verificado | ídem (`:659`, `:1838`); la refinanciación (área 27) no cambia |
| LA `app/Http/Controllers/Customer/WompiController.php` | 1 | verificado + **corrección** (pantalla pública) | las pantallas viejas de pago redirigen a la app de pagos (`WompiController.php:52`, `:57`, `:65`, `:177`); la prosa decía que había una pantalla por sistema |
| LA `app/Exports/CollectionReportExport.php` | 3 | verificado + **agregado** (cuota inicial) | columna «Canal de la cuota inicial» en consumo (`CollectionReportExport.php:389-395`); las secciones de recaudo siguen ciertas |
| LB `Modules/Loans/App/Services/PaymentIntentService.php` | 1 | verificado | rechaza una cuota inicial que iguala o supera el total (`PaymentIntentService.php:450`); no toca el pago al rotativo (área 22). ⚠ Es regla del tema **cuota** («Una cuota inicial que iguala o supera el monto…»): que la mire esa sesión |
| LB `Modules/Loans/App/Services/WompiWebhookService.php` | 1 | verificado + **agregado** (cuota inicial) | el asiento de la cuota inicial en línea pasa a `RecordOnlineInitialFeeService` (`WompiWebhookService.php:338`); el rotativo no cambia |
| LB `app/Actions/Lenders/Wompi.php` | 1 | verificado + **agregado** (cuota inicial) | la consulta de estado también crea el asiento (`Wompi.php:376`) |
| LB `Modules/Loans/App/Services/CreditopXPaymentService.php` | 1 | verificado + **corrección** (mínimo exacto) | mismo redondeo que el viejo (`CreditopXPaymentService.php:530-535`); la sección del gasto de cobranza sigue cierta |
| LB `Modules/Loans/App/Support/PaymentWaterfall.php` | 1 | verificado + **corrección** (mínimo exacto) | redondea el sobrante (`PaymentWaterfall.php:100`, `:168`) |

### creditopx (5 líneas, 4 rutas)

| ruta | × | veredicto | motivo |
|---|---|---|---|
| LB `Modules/Loans/App/Http/Controllers/Customer/CreditopXQuotaController.php` | 1 | verificado + **corrección** (rechazo) | el rotativo devuelve el motivo de la política dura (`CreditopXQuotaController.php:968`); «crédito activo bloquea» y «perfil sin cupo» siguen ciertas |
| LB `Modules/Onboarding/App/Services/lenders/LenderValidationService.php` | 1 | **corrección** (rechazo) + verificado | ahora también sale del listado el rotativo que falla reglas duras, salvo cupo aprobado (`LenderValidationService.php:35`, `:432-433`; política en `RevolvingCreditsService.php:452`). El viejo sólo saca tipo 2 (LA `app/Services/lenders/LenderValidationService.php:376`) |
| LA `app/Http/Controllers/Admin/CreditopXRequestHistoryController.php` | 2 | verificado | ver cartera; el cupo mensual del perfil (áreas 7 y 8) no cambia |
| LB `Modules/Loans/App/Services/CreditopXRequestHistoryService.php` | 1 | verificado | la guarda de idempotencia de la CREACIÓN corta sólo con cadena viva (`CreditopXRequestHistoryService.php:363`); no toca el cupo mensual |

### codeudor (1 línea)

| ruta | veredicto | motivo |
|---|---|---|
| LB `Modules/Loans/App/Services/DocumentSigningService.php` | verificado | agrega el camino Netco configurable antes del catálogo (`:112`); la re-evaluación del codeudor al autorizar sigue en `LoanAuthorizationService.php:123-125` y en el catálogo (`DocumentSigningService.php:147`). Que Netco configurable no tenga variante con codeudor va en el agregado de formalización |

### formalizacion (10 líneas)

| ruta | veredicto | motivo |
|---|---|---|
| LB `Modules/Loans/App/Http/Controllers/Customer/PromissoryNoteController.php` | verificado + **agregado** (Netco configurable) | camino SigningV1 en la vista previa (`PromissoryNoteController.php:121`); las secciones del área 1 siguen ciertas |
| LB `Modules/Loans/App/Http/Controllers/Customer/ValidateOtpPromissoryNoteController.php` | verificado + **agregado** (celular) | corrección del celular en la pantalla del código (`:275`, `:286`; reglas en `PromissoryNotePhoneChangeService.php`, aplicada en `OtpValidationService.php:72`) |
| LB `Modules/Loans/App/Services/DocumentSigningService.php` | verificado + **agregado** (Netco configurable) | ver codeudor |
| LB `Modules/Loans/App/Services/LoanAuthorizationService.php` | verificado + **agregado** (cuota inicial, en cartera) | registra la cuota inicial de caja en los tres cierres (`LoanAuthorizationService.php:215`, `:329`, `:479`); «el estado final no prueba todo» sigue cierta |
| LB `Modules/Loans/App/Services/PromissoryNote/DecevalPromissoryNoteService.php` | verificado + **agregado** (pagaré rotativo) | reutiliza el pagaré firmado del cupo activo (`:42`, `:162`, `:258`) y filtra el cupo activo (`:37`); emisor y método de firma no cambian |
| LB `Modules/Loans/routes/api.php` | verificado + **corrección** (escritorio) + **agregado** (celular) | ruta `continue-qr.svg` fuera de la guarda (`api.php:112`) y rutas de cambio de celular |
| LB `app/Http/Middleware/RedirectIdValidationIfDesktop.php` | **corrección** (escritorio) + verificado | el QR ya no se sube a S3: el 403 trae la dirección de un SVG que dibuja `ContinueQrController` (`RedirectIdValidationIfDesktop.php:45-54`) |
| LA `app/Http/Controllers/Admin/CreditopXRequestHistoryController.php` | verificado | ver cartera; la primera fecha de pago no cambia |
| LB `Modules/Loans/App/Services/CreditopXRequestHistoryService.php` | verificado | ver creditopx |
| LB `Modules/Loans/App/Services/PromissoryNote/TraditionalPromissoryNoteService.php` | verificado + **agregado** (pagaré rotativo) | reutiliza el pagaré del cupo (`:23`, `:54`, `:102`); la elección del método sigue igual |

### documentos (8 líneas)

| ruta | veredicto | motivo |
|---|---|---|
| LB `Modules/Loans/App/Http/Controllers/Customer/PromissoryNoteController.php` | verificado | número del pagaré, slug y cascada no cambian; el camino Netco se enlaza desde la corrección de «Quién dibuja» |
| LB `config/documents.php` | **corrección** (quién dibuja) + verificado | nuevo tipo `pagare-revolving` fijo en clásico, sin variable de ambiente (`documents.php:39`) |
| LB `Modules/Loans/App/Services/DocumentGeneration/BladePdfGenerator.php` | **corrección** (plantilla) + verificado | el pagaré rotativo cae a `lenders.revolving` y no a la genérica (`BladePdfGenerator.php:16`, `:36`) |
| LB `resources/views/creditopxpdf/lenders/lender_77.blade.php` | **corrección** (CrediPullman) + verificado | main quitó la cláusula de condonación (commit `6797c19c`, «The promotion has ended») |
| LB `resources/views/creditopxpdf/lenders/payment_schedule_notes/lender_77.blade.php` | **canon-patch** | hash vacío: borrado en `6797c19c` junto con su gancho en `paymentschedule.blade.php`. Hay que sacarlo de `documentos/context` área 4 |
| LB `Modules/Loans/App/Services/CreditopXRequestHistoryService.php` | verificado | ver creditopx; el plan del rotativo (área 5) no cambia |
| LB `Modules/Loans/App/Services/PromissoryNoteService.php` | **corrección** (plantilla, quién dibuja) + verificado | el pagaré rotativo usa el tipo propio, imprime el número de contrato (id del cupo con 6 dígitos) y no se emite sin cupo activo (`PromissoryNoteService.php:410`, `:551`, `:602`) |
| LB `Modules/Loans/App/Services/LoanAuthorizationService.php` | verificado | el comprobante no cambia; la cuota inicial de caja va a cartera |

## Pendiente fuera de piezas

- **canon-patch**: `documentos/context` área 4 declara
  `legacy-backend:resources/views/creditopxpdf/lenders/payment_schedule_notes/lender_77.blade.php`, borrado en main.
  Leyendo `tools/canon/internal/api/draft.go` (~657), un `verificado` que nombra un archivo declarado y ausente de
  main lo **retira**; no lo usé porque la consigna era canon-patch.
- **Tablas**: `netco_lender_settings` y `netco_lender_credentials` existen en main (migraciones `2026_10_07…`,
  `2026_10_08…`) pero canon las rechaza: «no existen en el esquema de producción». La pieza de Netco va sin `tablas`.
- **Para otras sesiones**: el cambio de `PaymentIntentService.php:450` (cuota inicial ≥ total) es del tema
  **cuota**; el barrido `app:reconcile-payment-unlocks` es del tema **imei**; la exclusión de solicitudes de
  prueba (`is_test`, CRED-367) en los tableros puede tocar **datos/backoffice**. No escribí piezas para eso.

## Lint · `make canon-write DRY=1`

Primer ensayo: frenó en `formalizacion-netco-configurable` por las tablas de arriba. Sin `tablas`, el segundo
recorrió las 16 piezas sin errores y abandonó el borrador:

- los 5 `verificado`: «subió el hash de lo releído» (releería 17 · 4 · 1 · 10 · 7 archivos);
- 4 agregados: «agregó la sección al final»; 7 correcciones: «reemplazó la sección»;
- las 11 con prosa traen `ya_vigilados_nota`: los archivos que ya declara un área enlazan la sección a esa área
  sin subirle el hash (por eso van también los `verificado`).

El ensayo no cierra el borrador, así que no pasó el lint del corpus entero (enlaces entre secciones nuevas):
eso se ve recién en el ensayo del lote completo de la sesión coordinadora.
