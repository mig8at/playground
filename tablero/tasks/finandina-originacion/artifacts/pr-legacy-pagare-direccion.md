fix(promissory-note): the promissory note shows the debtor's address

## Qué cambia y por qué

El pie del pagaré genérico (los datos del deudor, justo antes de la carta de instrucciones) imprime «Dirección:» sin
nada después. Visto en qa con el pagaré de Banco Finandina: «Identificación: …», «Dirección:» vacía, «Rol en que firma:
DEUDOR». La carta de instrucciones no tiene renglón de dirección y no cambia. El renglón está escrito vacío en
la plantilla (`Dirección: <strong></strong>`) y ningún dato llega a él.

La dirección ya se pide: es la de residencia del formulario (campos 186, 175 o 44, el primero con valor). La vinculación
la usa (`OnboardingPayloadBuilder::RESIDENCE_ADDRESS_FIELD_IDS`) y el girador de Deceval también
(`DecevalGiradorFields`). En qa, las solicitudes de Banco Finandina 505285, 505316 y 505322 la tienen guardada.

- Las plantillas `creditopxpdf/lenders/default`, `creditopxpdf/pdf` y `creditopxpdf/lenders/lender_164` muestran
  `{{ $address ?? '' }}`. Con el respaldo vacío, un camino que no mande la dirección deja el renglón como estaba, en vez
  de romper el render con «Undefined variable».
- Las entidades con catálogo de firma (Banco Finandina) ya tenían `address` en su payload
  (`FinandinaPayloadBuilder` parte de `OnboardingPayloadBuilder`): sólo faltaba la plantilla.
- Las entidades sin catálogo arman el pagaré (la vista previa y el firmado) con `calculateAmounts` más
  `getUserContractDetails`. La dirección va en `getUserContractDetails`, con la misma regla (la más reciente de cada
  campo, en ese orden), y NO en `calculateAmounts`: ese arreglo también sale en la respuesta de
  `CreditopXAcceptanceController` y se escribe entero en el log del camino IMEI de `LoanAuthorizationService`, y la
  dirección no tiene por qué llegar ahí. `getUserContractDetails` ya traía `user_address` (sólo el campo 175, para las
  plantillas de contrato); queda igual.

Cambia el pagaré de todas las entidades que usan esas plantillas, no sólo el de Banco Finandina. Las otras plantillas
que leen `$address` (las de Alta) ya la usaban como dirección de residencia del cliente.

## Qué se tocó

- `Modules/Loans/App/Services/PromissoryNoteService.php`: `address` en `getUserContractDetails` y `residenceAddress()`.
- `resources/views/creditopxpdf/lenders/default.blade.php`, `resources/views/creditopxpdf/pdf.blade.php`,
  `resources/views/creditopxpdf/lenders/lender_164.blade.php`: el renglón de la dirección (y en la 164 sale el
  comentario que decía que no existía la variable).

## Cómo se comprobó

- Las tres plantillas compilan con el compilador de Blade a PHP válido, con `$address ?? ''` en el renglón.
- No se renderizó un pagaré completo ni se corrieron pruebas: no había un MySQL local disponible. Ninguna prueba del
  repo fija ese renglón.
- Falta verlo en qa: firmar una solicitud de Banco Finandina y una de una entidad sin catálogo, y revisar la dirección en
  el pagaré y en la carta de instrucciones.
