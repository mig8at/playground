---
name: harness-canal-qr
description: Probar el canal QR de CreditOp (comercios Corbeta → Bancolombia BNPL 68 / Consumo 100) en el harness harness. Usala cuando la tarea toque el QR de la caja, Alkosto/K-TRONIX/Alkomprar, el código de compra en punto de venta, los mocks del banco (:8104) o de la API Fondos de Corbeta (:8103), el contrato zod del wizard, o cuando el recorrido visual se caiga con «Error al cargar la información» y el runner por consola esté verde.
---

# Canal QR · Corbeta → Bancolombia

El único canal de **autogestión pura**: el cliente escanea un QR en la caja de un retail Corbeta
(Alkosto 209 / K-TRONIX 210 / Alkomprar 211), hace todo desde su celular y termina con un **código que
presenta en caja** para facturar. Sin asesor y sin Cognito.

## Lo que hay que entender antes de tocar nada

**El estado terminal es 25 «Pendiente de facturación» + código, NUNCA 11.** El desembolso llega después,
por los crons de conciliación → 26 «Facturado». Si esperás 11, vas a leer un éxito como fallo.

**No pasa por `/lenders`, y esa es su diferencia estructural** (no un límite del harness). Entra en
`/bancolombia/self-service/{hash}/solicitar` y **el OTP es el punto de decisión**: resuelve la
pre-aprobación y manda a `/bancolombia/{bnpl|consumo}/start/{encryptCode}` (`otp.tsx:182`) o a
`no-preapproved` (`:121`). No hay marketplace que mostrar → "saltar a lenders" no existe acá.

**Quién decide el producto** (`PreApprovedLenderService::validateBancolombiaPreapprove`): consulta las
DOS compuertas del banco con montos fijos y decide por `match`. BNPL → `validateQuota` (monto 100.000,
lender 68) con `data.validate === true`. Consumo → `validate` (monto 1.000.000, lender 100) con
`data.validate === 'Success'` (`'Pending'` → pendiente; **409 `BP40920507`** → no habilitado, tratado
como sin cupo y **no** como error). Con las dos prendidas sale `PLS003` multiproducto y **arranca siempre
en BNPL** — de ahí el `?multiproduct=true` en la URL. Por eso, para ver Consumo hay que **apagar la
compuerta de BNPL**.

**Los caminos, y lo que cada uno NO ve:**

| | Qué ejercita | Su punto ciego |
|---|---|---|
| `dev/qr-corbeta.ts` | backend + BD: cierra en 25 con código | **los esquemas zod del front** |
| `dev/caminar-qr.ts` | las pantallas: cargan y avanzan | no valida negocio ni que la pantalla esté *bien* |
| `npm run contrato:bancolombia` | el mock vs los zod **reales** del monorepo | no prueba el recorrido |
| **`make harness-sandbox`** | **el gateway REAL del banco**: sobre, 5 headers, firma RS256, `maxLength` | el **negocio**: en el catálogo `Sandbox` el emisor es Microcks |

⚠ **Los tres primeros son NUESTRA lectura del contrato, y por eso pueden coincidir en el error.** Pasó:
el sobre PLANO pasaba 8 tests con `Http::fake` en verde porque comprobaban la misma suposición con la que
se escribió el código, sacada del mismo documento equivocado. **Un mock no puede contradecir la
documentación de la que nació.** `make harness-sandbox` es el único que deja que el banco contradiga —
mandale el sobre plano y contesta `SA400 · Parámetro security requerido`.

## Recetas

```bash
# 1. el flujo por API, sin browser — ¿cierra en 25 con código?
E2E_TARGET=local npx tsx dev/qr-corbeta.ts --producto bnpl      # o consumo
#    banderas: --branch <hash> · --amount <n> · --facturar · --keep

# 2. las pantallas, clickeando solo — ¿qué vistas existen y en qué orden?
E2E_TARGET=local npx tsx dev/caminar-qr.ts --producto consumo
#    --escenario '{"errorCode":"BP20790","errorEn":"retrieve-quota"}' · --headed · --max 24

# 3. el contrato mock ↔ front (16 esquemas, sin browser ni BD)
npm run contrato:bancolombia

# 4. la flota que este canal necesita
bin/mock-bancolombia start && bin/mock-corbeta start
```

Y en el `.env` del **backend** (eso no lo hace el harness):
`BANCOLOMBIA_HOST` + `BANCOLOMBIA_AUTH_HOST` → `http://host.docker.internal:8104` ·
`CORBETA_HOST` → `http://host.docker.internal:8103`.

## El mapa de pantallas (verificado caminándolo)

**BNPL, 9 pasos → estado 25 + código:** `solicitar` → `{tel}/otp` → `bnpl/start/{code}` → *banco* →
`bnpl/loan-info` → `bnpl/loan-summary` → `bnpl/signature` → *banco otra vez* → `bnpl/processing` →
`purchase-code`.

**Consumo, 10 pasos.** Mismo esqueleto y **dos pantallas propias** que BNPL no tiene, así que "es lo
mismo con otro convenio" es **falso**: `consumo/loan-summary-review` y `consumo/personal-info`.

- **`processing` no tiene botón: es pantalla de espera.** POSTea la originación y navega sola. Un
  caminador que busque el botón primario se rinde ahí y parece un muro cuando ya está cerrando.
- **`bnpl/business-error` es exclusiva de ecommerce**: solo se navega desde `bnpl/redirect.tsx:91`
  dentro de la rama `isEcommerceFlow`. En autogestión un error de negocio del banco **cancela la
  solicitud (estado 8)** y la pantalla igual dice «intenta de nuevo» (F-91).

## Las tres cosas que hacen fallar el canal, y su causa

### 1 · El front valida con zod lo que el banco devuelve (F-88)

Los controllers hacen **passthrough** del `data` del banco, así que las claves del proveedor las termina
validando el módulo del wizard
(`modules/loan-request-wizard/bancolombia-origination/src/domain/schemas/origination/{bnpl,loan}/*-api.schema.ts`).
Si no cumplen: `success:false` y la pantalla dice solo **«Error al cargar la información»**, sin nombrar
el campo. El backend es más laxo (le basta que la clave exista) → **el runner por consola puede estar
verde con el recorrido visual roto.** Antes de culpar al backend: `npm run contrato:bancolombia`.

Trampas del contrato que ya costaron tiempo:

- `accounts[].id` es **`z.number()`** en el listado y **`z.string()`** en `select_account`. Gana el más
  estricto de cada lado.
- Los `type` de Consumo son **enums cerrados**: `TASA_FIJA` (no `FIJA`), `SEGURO_DE_VIDA` (no `VIDA`).
- Un **opcional presente y a medias** rompe más que ausente: `terms.security` sin `customerValidateKey`.
- El controller manda `'simulation' => $data` **completo**, no `data.simulation`
  (`BancolombiaLoanController.php:1297`). Con las claves un nivel más abajo la pantalla **no avanza y no
  muestra ningún error**: el POST responde 200 y el zod falla en silencio.
- `simulation.installmentDatas` **son las TARJETAS DE COBERTURA**, no un plan de cuotas: con
  `SEGURO_DE_DESEMPLEO` entre sus `insurances` la tarjeta es «Plus», si no «Básica»
  (`coverage-plan.mapper.ts`). Mandar 12 pinta 12 idénticas; el schema del front acota a **2**.
- La última pantalla depende de dos campos que arma el **backend**, no el banco:
  `codeImageUrl` (= `purchase_codes.barcode_url`) y `showBarCode`. En local la URL es un string de
  `local-mock.s3…`: la **imagen** no carga pero la vista renderiza.
- ⚠ **En los ÉXITOS no va la clave `errors`, ni vacía.** El controller decide con
  `isset($quotaResponse['errors'])`: un `"errors": []` **está set** → se lee como error (`BNPL001`) con
  la respuesta feliz en la mano. Es una trampa latente de la integración real, no solo del mock.

### 2 · El regreso del banco: UNA sola URL, y es un despachador (F-86, F-89)

El recorrido sale al banco **dos veces** (autenticación al empezar, clave dinámica al firmar) y vuelve a
**`/bancolombia/{bnpl|consumo}/redirect?code=…`** (`routes.ts:190` y `:220`). Su `clientLoader` lee la
sesión del cliente y decide: `step==='session'` → `loan-info`, `step==='dynamic_key'` → `processing`
(ecommerce → `payment-success`). Que ese despachador exista **es la evidencia de que el banco vuelve
siempre al mismo sitio**. Apuntar el retorno a `loan-info` funciona en el primer salto y **deja el
segundo colgado**.

El harness le **registra** el destino al mock: `POST :8104/_control/retorno {url}`, en cuanto ve la URL
`/bancolombia/{tipo}/start/{encryptCode}`.

⚠ **No vuelvas a intentarlo con `document.referrer`.** El wizard (:5174) y el mock (:8104) son orígenes
distintos y la política default del browser (`strict-origin-when-cross-origin`) recorta el referrer a
`http://localhost:5174/` **sin path**. Llega **truncado, no vacío**, así que ningún guard salta: la
transformación no encontraba `/start/`, el destino quedaba en `/`, y **`/` → `/merchant` → `/login`** —
el cliente terminaba en el login de **asesor** en un canal autoasistido.

**Cada producto manda a SU página de banco y el mock sirve las dos:** BNPL devuelve `data.url` →
`/_login-simulado`; Consumo devuelve `data.security.urlAuthenticate` → `/_autenticacion`. Servir una sola
dejaba a la otra en el catch-all y el cliente veía **`{"data":{"status":"OK"}}` crudo**.

⚠ **`urlAuthenticate`, no `urlDynamicKey`**: el front lee `payload.data.security.urlAuthenticate`
(`login-redirect.uc.ts:19`). Con la otra clave el `url` llega **undefined** y
`/bancolombia/consumo/start/{code}` explota con `Cannot read properties of undefined (reading 'value')`
mostrando el banner genérico «hubo un problema con el proceso», que no menciona ningún campo.

⚠ **Al editar el HTML de esa página: vive dentro de un template literal del server.** Un backtick en un
comentario del `<script>` lo termina y el mock no arranca (`missing ) after argument list`). Ya pasó.

### 3 · Los formularios: SSR + react-hook-form + Radix

**El harness AUTORRELLENA y no clickea.** `autorrellenarQr()` (`pkg/qr-steps.ts`) se engancha a **cada
navegación** en los dos modos y llena lo que reconozca. **Nunca aprieta Continuar** — si lo hiciera, el
camino visual dejaría de ser visual. Va por navegación y no como secuencia fija porque el recorrido tiene
**7 formularios** y su orden depende del producto que resuelva el OTP.

Cinco trampas, las cinco cazadas corriendo y resueltas en `pkg/qr-steps.ts` — **si tocás ese archivo, no
las deshagas**:

1. **Esperá la HIDRATACIÓN antes de escribir.** La pantalla llega por SSR y react-hook-form toma el
   control al hidratar: si llenás antes, React monta con sus defaults vacíos, el form queda inválido y
   **el botón nunca se habilita, sin un solo mensaje de error**. Es el síntoma más engañoso posible:
   parece un selector roto. Y `waitFor({state:'visible'})` **no sirve** como señal — los campos vienen
   en el HTML del SSR. La sonda real es el **toggle de un checkbox**: que un click cambie `data-state`
   a `checked` solo pasa si el JS ya está atado.
2. **El input VISIBLE no siempre tiene `name`.** Al revés de lo intuitivo: react-hook-form lo controla
   por `Controller` y el atributo queda solo en el `<input type=hidden name=X>` espejo. Verificado en el
   registro: `[name=phoneNumber]` matchea **solo** el hidden y llenarlo no cambia nada en pantalla. Por
   eso cada campo se busca **primero por etiqueta**. Y por eso el helper **devuelve qué llenó**: un
   campo que no está en esa lista es un campo que no encontró.
3. **Verificá que el valor QUEDÓ, no que el `fill()` no tiró.** Si la hidratación llega después, React lo
   pisa. El autorrelleno re-lee, reintenta una vez y si tampoco queda marca `⚠no quedó` en el log.
4. **Los checkboxes NO están dentro del `<form>`** (`closest('form')` da null) y hay un tercer
   `role=checkbox` que es un `<input>` del overlay de React Router devtools. El selector exacto es
   **`button[role="checkbox"]`** (Radix los renderiza como BUTTON). Sus ids son generados
   (`_R_1j4j5_-form-item`): no sirven.
5. **Los selects de `consumo/loan-summary` son Radix, no `<select>`** (`TermSelector`/`DaySelector`):
   trigger `button[role=combobox]` y opciones en un **portal** (`[role=option]`). Vacíos, el form no
   valida y Continuar nunca se habilita **sin ningún mensaje**.

Y dos más, del harness y no del producto:

- **El botón de envío nace `disabled`.** Clickearlo antes tira timeout y se lee como selector mal escrito.
- **Elegir el botón NO es `.first()` con `filter({hasNot:'[disabled]'})`**: ese filtro pregunta por un
  *descendiente* deshabilitado, no por el botón. Devolvía botones muertos y el click moría por timeout
  con el nombre ya leído — parecía un muro de la pantalla siendo un bug del harness. Se recorren los
  candidatos y se toma el primero **visible y habilitado**.
- **Las pantallas `bancolombia/*` no tienen un solo `data-testid`** (verificado: `git grep 'data-testid'
  modules/loan-request-wizard/bancolombia-origination` no devuelve nada). Por eso se selecciona por **rol
  y etiqueta accesible**, con el string exacto y la ruta del componente en cada selector: si cambia un
  copy se rompe, y así se sabe dónde mirar. La deuda real es agregar testids a ese módulo — es un
  habilitador del harness, no un cambio de producto.

## Los mocks del canal

### `mock-bancolombia` (:8104) — los dos productos

Perillas por `POST /_control/escenario`:

| Perilla | Para qué |
|---|---|
| `producto` | `ambos` (default) · `bnpl` · `consumo` · `pendiente` · `ninguno` → decide qué resuelve el OTP |
| `hasQuota` · `balance` | cupo del cliente |
| `bnplStatus` · `consumoStatus` | las cadenas mágicas que **sellan el estado 25** |
| `errorCode` + **`errorEn`** | forzar un error del banco **en un paso puntual** |

⚠ **Una falla GLOBAL no sirve para ver pantallas de error** (F-90). `MOCK_BC_FAIL=1` y un `errorCode` sin
`errorEn` rompen la **compuerta de pre-aprobación** —lo primero que llama al banco— y todo termina en
`no-preapproved`, nunca en la pantalla de error. Para un paso concreto:
`--escenario '{"errorCode":"BP20790","errorEn":"retrieve-quota"}'`.

Otros controles: `POST /_control/retorno {url}` (a dónde vuelve el cliente) · `/_control/reset` ·
`GET /` (estado + escenario + últimas llamadas + la huella `codigo` del server.mjs).

### `mock-corbeta` (:8103) — la API Fondos, que es lo que se va a reemplazar

Reproduce **la sutileza que el reemplazo Corbeta→Bancolombia va a cambiar**: `validateCurrentOrder()` no
evalúa el estado de la orden — pide las de ayer→mañana con `EstadoOrden=2` y solo busca el PIN en la
lista. O sea **"si ya facturó, no mostrar" sale del FILTRO, no de una regla escrita.**
`POST /_control/facturar {pin}` mueve la orden a estado 3 y el código deja de mostrarse: ese es el caso
que la suite de caracterización congela. Contexto completo: nodo `bancolombia` de `context` + F-79..F-82.

## Datos del canal que hacen falta para que llegue al final

- **La sucursal necesita los DOS lenders de Bancolombia (68 y 100) habilitados.** Sin eso el OTP resuelve
  `no_preapproved` y el flujo muere antes de empezar. `corbetaBranch()` solo devuelve sucursales que
  cumplen (default la **946**, Alkosto Bogotá: la de las 4 solicitudes reales que llegaron al estado 25
  en marzo de 2026) y el spec avisa si el hash del panel no es una de ellas.
- **El `encryptCode` de las rutas `/bancolombia/…/{code}` NO es cifrado:** es
  `base36((user_request_id << 32) | hexdec(branch.hash))`, fórmula del propio backend
  (`PurchaseCodeService::sendPurchaseCodeSms`). O sea **el harness puede mintear el código de cualquier
  solicitud que siembre** y saltar directo a la pantalla que quiera, `purchase-code` incluida
  (`bancolombiaEncryptCode` en `pkg/qr.ts`). Ojo con el techo: del lado PHP `base_convert` va por float,
  así que arriba de `user_request_id ≈ 2^21` (2.097.152) el link del SMS y el decoder del front dejarían
  de coincidir. Hoy los ids van por ~400.000.
- **El registro valida unicidad teléfono↔documento.** Si el teléfono de bypass quedó con el usuario de
  otra corrida, responde «El número de celular ya se encuentra registrado con otra cédula» en
  `documentNumberError` y **no avanza**. Scrubbeá antes, con `E2E_TARGET=local` EXPLÍCITO en el env del
  hijo (F-53).
- **El OTP en local lo valida un driver FAKE que IGNORA el código tecleado** — solo exige que exista un
  OTP previo. Si ves `NO_PREVIOUS_OTP`, el problema no es el código: es que el paso de *generación* no
  corrió.
- **El canal QR TERMINA en su propia rama del spec** (`holdOpen` + `return`). Lo que sigue es la
  secuencia del TRONCO y no aplica: cuando corría, su paso de OTP tipeaba el código **encima** del que
  ya había puesto el autorrelleno y la pantalla contestaba «verifica el código e inténtalo de nuevo»;
  después esperaba `/personal-info|lenders`, que en este recorrido no existen. Excluir solo la rama
  manual **no alcanza**: la guiada está después y se ejecuta igual.

## Gate del panel

**Comercio Corbeta → solo QR.** En la caja de Alkosto el cliente entra escaneando: no hay asesor ni
carrito, y el panel corre el recorrido de PRODUCCIÓN. La regla la decide el **servidor**
(`/api/canales?slug=`) leyendo el **mismo `Setting('corbeta_allieds')`** que usa el producto, no una lista
`[24,209,210,211]` a mano.

⚠ **Cuidá el motivo si reescribís el tooltip:** asesor en Corbeta **no está roto** (F-85). Al elegir
Bancolombia devuelve un handoff al celular del cliente (`explicacion-de-flujo` + modal de WhatsApp,
estado 1→3) y aterriza en las mismas pantallas del QR. Se apaga por **no ser el camino de producción**.
El gate es una baranda del panel: por CLI (`bin/asesor <comercio>`) el canal sigue disponible y es la
forma de ejercitar ese handoff. Y **no** reuses la inferencia "el marketplace no lista para Corbeta":
es falsa, `lenders-v2` da 404 igual en un comercio no-Corbeta.

**Los arranques («saltar a») también se gatean:** en `qr` no aplican ni Inicio ni Lenders — recorrido
propio, y el consumidor del salto matchea URLs `/(merchant|ecommerce)/…` que acá nunca ocurren.

La tarjeta **Alkosto** es la del canal: retail Corbeta con solo 68/100 habilitados, el único que ejercita
la venta que cierra en CAJA. Los otros tres están en `.flows.json` por nombre (`k-tronix`, `alkomprar`,
`creditop` — este último es la cuenta propia de la casa: está en el gate pero **no** es retail Corbeta).

## Suites de caracterización de este canal

- `channel/qr-corbeta-purchase-code.spec.ts` — **7 casos**: emisión, idempotencia, ya-facturada, los 3
  guards, proveedor caído. Es el registro del comportamiento **observado**, no un oráculo de corrección.
- `channel/qr-corbeta-pantallas.spec.ts` — 3 casos, incluido el contrato del autorrelleno.
