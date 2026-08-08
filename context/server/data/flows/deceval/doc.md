# Deceval · la firma digital del pagaré

> **verificado contra `main` + producción** el **2026-08-07**. El código se leyó en `main` de
> `legacy-backend` y `legacy-application`; la semántica de negocio viene de Confluence
> (*Integración Deceval: Firma Digital de Pagarés en Creditop para Lenders*, v1, 2026-07-29) y **cada
> afirmación de ese documento se contrastó contra el código** — lo que no está en `main` se marca abajo.

## Qué es

El **pagaré** es el título valor que respalda el crédito: el documento legal que permite cobrarlo
judicialmente. **Deceval** (de la Bolsa de Valores de Colombia) es el depósito centralizado que custodia
esos títulos en formato digital, con la misma validez legal que el papel. CreditOp se conecta para que el
cliente firme con un **OTP**, sin papel y sin presencialidad.

Tres palabras que hay que tener claras porque el SOAP las usa todo el tiempo:

- **Girador** — la persona que firma. Nuestro cliente.
- **Depositante** — la cuenta del **lender** ante Deceval. Cada uno tiene su propio código, sus
  credenciales y su configuración.
- **Pagaré** — el título. Se crea a nombre del depositante, no de CreditOp.

Es una **capacidad de la plataforma, no un desarrollo por lender**: se habilita configurando, no
programando. En producción hoy: **Credifamilia y Dentix**.

## Antes de concluir

- ⚠ **`SDL.DA.0439` (identidad no coincide) no tiene arreglo desde la integración, y bloquea el crédito
  al final del embudo.** El registro de giradores de Deceval **es nacional y compartido entre todas las
  entidades**: si la cédula del cliente fue registrada años atrás por otra financiera con los nombres
  escritos distinto (un segundo nombre de más, un typo histórico), Deceval lo rechaza como conflicto de
  identidad. Devuelve `cuentaGirador = 0`, y un pagaré con cuenta 0 revienta después con `SDL.DA.0388`.
  **No hay operación de consulta de girador en el WSDL**, así que no se puede detectar antes de
  intentar. Cambios de correo, dirección o teléfono **no** disparan esto (se actualizan solos), ni las
  mayúsculas ni los espacios: sólo nombres genuinamente distintos.
  ⚠ Y notar la asimetría con **F-121**: *Deceval* detecta que el documento y el nombre no concuerdan;
  *nosotros* no tenemos con qué.
- ⚠ **La dirección del girador se imprime en el pagaré como domicilio de notificación legal.** No es
  metadata: la cláusula la pacta como dirección válida para avisos en un cobro judicial. Si el
  depositante de un lender la exige, el onboarding de ese lender **tiene que capturar la real** — un
  pagaré con dirección de configuración es un riesgo legal, y el propio documento lo deja como
  «validación con legal pendiente».
- ⚠ **El OTP lo valida CreditOp, no Deceval.** La clave de firma que se manda es el OTP propio, y
  Deceval **no la verifica**: queda como evidencia registrada. Autenticar al firmante es responsabilidad
  del depositante — o sea nuestra. Verificado contra el sandbox de certificación.
- **Las credenciales son por ambiente.** Un password de producción en certificación da
  `wsse:FailedAuthentication` — que se lee como «la firma está mal» y no lo está. Y el sandbox
  **valida menos que producción** (por ejemplo no verifica la clave de firma): la paridad no está
  garantizada, así que «pasó en certificación» no es «pasa en prod».
- **El número del pagaré sale del id de la fila**, no de un contador propio:
  `{promissory_note.id}-{id en 6 dígitos}` (`:67`). Borrar y recrear la fila cambia el número del título
  ante Deceval.
- ⚠ **El guard de `createGirador` está bien en `legacy-backend` y ROTO en `legacy-application`**, que
  sigue sirviendo el flujo. Ver **F-122** — es la diferencia entre `||` y `&&`.

## El flujo, y dónde está en el embudo

```
Solicitud → Aprobación → Documentos → [OTP] → FIRMA DEL PAGARÉ → Desembolso
                                                     ▲
                                            acá interviene Deceval
```

⚠ **Está al final del embudo**, y eso define la gravedad de cualquier falla: un error acá le pasa al
cliente **después** de haber completado todo el proceso y validado su OTP. No hay reintento barato.

Detrás, cuatro operaciones SOAP encadenadas:

1. **`createGirador`** — da de alta al cliente ante Deceval. Es un **upsert por identidad**: si ya
   existía —incluso registrado por otra financiera— actualiza y sigue.
2. **`createPagare`** — crea el título con las condiciones del crédito, a nombre del depositante.
3. **`consultPagare`** — trae el PDF en estado «listo para firmar», que se le muestra al cliente.
4. **`signPagare`** — el cliente ingresa el OTP y el título queda firmado y registrado. **Recién ahí se
   desembolsa.**

## Cómo se habilita para un lender (tres piezas, ninguna es código)

1. **Método de firma** — `lenders.promissory_type_id` → `promissory_types.name`. Si vale `deceval`, la
   factory rutea a esta integración; si vale `ownership`, al pagaré tradicional. **Un valor desconocido
   revienta con `UnknownPromissoryTypeException`** — no cae a un default silencioso, que es lo correcto.
2. **Credenciales del depositante** — viven en `risk_central_credentials` (Deceval es una «central» más,
   `risk_central_id = 7`) y se resuelven con `RiskCentralCredential::findForUserRequest`, en **cascada
   lender → allied**. El payload trae `deceval_username`/`password`/`depositante`/`nit_emisor`/
   `clase_documento` + certificado y llave. Sin eso Deceval rechaza cualquier operación.
3. **Parametrización del lado de Deceval** — y esta es la que sorprende: **cada depositante define qué
   datos del girador son obligatorios**, y dos lenders pueden exigir conjuntos distintos. Se descubre en
   certificación, no en el código, y **determina qué campos tiene que capturar el onboarding de ese
   lender**.

## Dónde mirar

- **El ruteo** — `Modules/Loans/App/Services/PromissoryNote/PromissoryNoteSigningFactory.php:11 create`:
  `:13` lee `lender->promissoryType->name`, `:16` mapea `deceval`, `:18` lanza si es desconocido. Es la
  única bifurcación entre Deceval y el pagaré tradicional.
- **La orquestación** — `DecevalPromissoryNoteService.php:14 generatePromissoryNote`
  (`:36` `firstOrCreate` de `promissory_notes` por solicitud · `:67` **el número del pagaré se deriva del
  id de la fila**: `{id}-{id en 6 dígitos}` · `:81` sube el PDF a S3) y
  `:119 signPromissoryNote` (`:154` sube el PDF **firmado**). `:187 shouldRequestPromissoryNote` decide
  si hace falta pedirlo.
- **El cliente SOAP** — `Modules/Loans/App/Actions/DecevalSoap.php`, una función estática por operación:
  `:239 createGirador` · `:378 createPagare` · `:528 consultPagare` · `:661 signPagare`. La auditoría se
  escribe en `:801 DecevalLog::create`.
- **WS-Security** — `Modules/Loans/App/Actions/Concerns/Soap.php`: `:55 timestamp` ·
  `:74 usernameToken` (**PasswordDigest**, `:97`) · `:109 binarySecurityToken` (la firma `ds:Signature`
  con el certificado, `:131`). Si algo falla acá el error es un `soap:Fault wsse:*` y **nunca llegó al
  servicio de negocio** — ver la tabla de capas abajo.
- **Las dos tablas** — `app/Models/DecevalLog.php` (`deceval_logs`) y `app/Models/PromissoryNote.php`.
  Qué buscar en cada una, en la sección siguiente.
- **El gemelo viejo** — `application/app/Actions/DecevalSoap.php` y
  `application/app/Services/PromissoryNote/DecevalPromissoryNoteService.php`, con sus rutas vivas en
  `routes/customer.php`. **No es código muerto** y tiene una diferencia que importa: ver Gotchas y F-122.

## Reconstruir un caso: las dos tablas

Todo se reconstruye desde el **`user_request_id`**, y eso es raro y valioso — es de las pocas tablas de
log del esquema que sí lo escriben (comparar con F-108).

**`deceval_logs`** es el primer lugar donde mirar: una fila por operación, con el **XML enviado y
recibido completo**.

| columna | contenido |
|---|---|
| `user_id`, `user_request_id` | el caso |
| `name`, `description` | la etapa legible («DecevalSoap Creating Girador SOAP», «PDF Obtained») |
| `method` | la operación: `createGirador` · `createPagare` · `consultPagare` · `signPagare` |
| `request`, `response` | JSON con `soap_request_xml` / `soap_response_xml` |

```sql
SELECT id, name, method, created_at FROM deceval_logs WHERE user_request_id = ? ORDER BY id;
```

⚠ **El log es best-effort**: se escribe dentro de un try/catch que nunca rompe la firma. Que falte una
fila **no prueba que la operación no corrió** — es exactamente la regla de oro del trazador, y acá vale
literal. Cruzar con `promissory_notes`.

**`promissory_notes`** es el estado del título. La columna que decide:
**`deceval_promissory_note_id` en NULL significa que la creación nunca completó.** `deceval_response_data`
trae la respuesta entera (cuenta del girador, id interno, nombre del PDF); `signing_method` dice
`deceval` vs `traditional`/`netco`; `otp_id` es el OTP con el que se firmó.

Otros puntos: el PDF en S3 (`front-web/users/documents/{celular}/promissory_note/`, sin firmar y
firmado), y los datos de residencia en `user_field_values` (**field 44** dirección · **185/93** ciudad ·
**184/92** departamento).

**Receta de un caso fallido**: (1) `deceval_logs` por `user_request_id` → última operación registrada;
(2) leer el `soap_response_xml` y buscar **`codigoError` y `mensajeRespuesta`** — el detalle accionable
está ahí, la `<descripcion>` es genérica; (3) cruzar con la tabla de capas; (4) `promissory_notes` para
saber en qué estado quedó el título.

## Las cuatro capas de error (mirar en este orden)

| capa | señal | significado |
|---|---|---|
| transporte | excepción HTTP / HTML 5xx | host caído, TLS, gateway |
| seguridad (WSS4J) | `soap:Fault wsse:*` | firma o credencial — **nunca llegó al servicio** |
| negocio | respuesta con `exitoso=false` + `codigoError` (`SDL.*`) | rechazo del servicio |
| detalle | `<mensajeRespuesta>` por ítem | **el error accionable** |

## ⏳ Lo que el documento describe y NO está en `main`

> ⏳ **PENDIENTE DE MERGE** — verificado el 2026-08-07 con el clon al día (fetch del mismo día) y
> buscando en `main`, en **todas las ramas remotas** y en el working tree: **no está en ninguna parte de
> este clon**. Es trabajo en curso sin pushear (CRED-69, «merge blockers pendientes» del council del
> 2026-07-28). Al mergear: re-verificar y **borrar esta marca**.
>
> - **Los códigos `LNDV002`…`LNDV005`.** El enum de `main`
>   (`Exceptions/DecevalErrorCode.php:9`) tiene **sólo `LNDV001`** (error de integración, HTTP 502). La
>   tabla de cinco códigos del documento —con el mapeo por patrón de texto y
>   `DecevalGiradorRejectedException`— describe la rama, no producción. Hoy un rechazo del girador sale
>   como `ValidationException` con la `<descripcion>` genérica de Deceval.
> - **`DecevalGiradorOptionsBuilder`** — los campos extendidos del girador (dirección, DANE de
>   ciudad/departamento de expedición y domicilio, país de nacionalidad) que exige el depositante de
>   **Alta** (lender 181, depositante 1283), gateado por `DECEVAL_GIRADOR_LENDERS`.
> - **El smoke test `deceval:test-soap`** (`TestDecevalSoapCommand`).
>
> Lo que SÍ está en `main` es el núcleo: `DecevalSoap`, el trait `Soap`,
> `DecevalPromissoryNoteService`, la factory y `LNDV001`.

## Lo que NO está verificado
- La incidencia real de `SDL.DA.0439` y qué depositante operó cada caso: se contesta contando en `deceval_logs` y reconstruyendo la cascada — no queda escrito en `promissory_notes`.
- ¿Los créditos rotativos firman igual? `promissory_notes.creditop_x_revolving_credit_id` existe y hay una rama `feature/CRED-121-deceval-rotativo` sin mergear, no leída.
