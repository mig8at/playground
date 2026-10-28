# De dónde sale cada credencial de una entidad

Describe cómo legacy-backend y application (legacy-application) encuentran, en `main`, la credencial con la
que se habla con una entidad (lender) o con una central (Deceval, Experian, ADO): qué tabla, en qué orden de
búsqueda y qué campos lee cada integración. Sólo nombra campos y tablas; no certifica qué filas existen en
un ambiente, ni que una credencial esté vigente, ni los pasos manuales de renovación de certificados.

## Dos tablas y dos formas de buscar

Hay dos modelos con el mismo patrón: una columna `credential` con cast `encrypted:collection` (JSON cifrado
con la llave de la app) y oculta al serializar. `LenderAlliedCredential` (`lender_allied_credentials`) cuelga
de un lender y, por morph `allied_type`/`allied_id`, de un comercio (`Allied`) o de una sucursal
(`AlliedBranch`); la clave única es lender + tipo + id. `RiskCentralCredential` (`risk_central_credentials`)
cuelga de una central (`risk_central_id`) y, por morph `credentialable`, de un `Lender`, un `Allied` o un
`AlliedBranch`; la clave única es central + tipo + id, y tiene borrado lógico. Las integraciones de entidades
(Bancolombia, Banco de Bogotá, Credifamilia, Sistecrédito, Wompi, Approbe…) leen la primera; Deceval, Experian
y ADO leen la segunda. El modelo `LenderAlliedCredential` es idéntico en los dos monolitos.

## Credencial de entidad: sucursal primero, comercio después

`LenderAlliedCredential::findOrFailByLenderAndAlly(lender, sucursal)` busca la fila del lender colgada de esa
sucursal; si no existe, la del lender colgada del comercio de la sucursal; si tampoco, falla con
`firstOrFail`. Es determinista: la sucursal siempre gana. Una entidad sin fila ni para la sucursal ni para su
comercio corta la integración con un `ModelNotFoundException`, no con un error de la entidad.

## Credencial de central: la entidad primero, sólo en legacy-backend

`RiskCentralCredential::findForUserRequest(central, solicitud, lender_id)` difiere entre los monolitos.
En legacy-backend, si llega `lender_id`, busca primero una fila de esa central colgada del `Lender`; si no
la hay, cae a las filas colgadas del comercio o de la sucursal de la solicitud. En application, si llega
`lender_id` busca sólo la del `Lender` y devuelve null si falta, sin caer al comercio; y el Deceval de
application llama con `lender_id` en null, así que allí la credencial de la entidad nunca se usa y sólo
cuentan comercio y sucursal. Las dos consultas usan `inRandomOrder()`: por la clave única, la búsqueda por
lender devuelve a lo sumo una fila, pero si el comercio y la sucursal tienen cada uno su fila, cuál sale es
al azar. Experian y ADO, cuando no encuentran fila, arman una credencial en memoria desde
`config('services.experian.<producto>.*')` o `config('services.ado.*')`; Deceval no tiene ese respaldo.

## Quién usa certificado y cómo lo lee

Los certificados viven como texto PEM dentro del mismo JSON cifrado. Bancolombia los usa en memoria con
openssl: `bancolombia_cert`, `bancolombia_privkey` y `bancolombia_shared_key`. Banco de Bogotá (y su variante
CeroPay) escribe `banco_de_bogota_pem` y `banco_de_bogota_key` a archivos temporales para mTLS, con
`banco_de_bogota_pem_passphrase`, y los borra al terminar. Credifamilia REST hace lo mismo con
`credifamilia_cert` y `credifamilia_key`. Credifamilia Consumo (SOAP) también lee `credifamilia_cert`,
`credifamilia_key` y `credifamilia_password`; el comando `credifamilia-consumo:seed-credentials` escribe en
cambio `credifamilia_consumo_cert`, `credifamilia_consumo_key` y `credifamilia_consumo_cert_password`, que
ningún código de `main` lee. Además, al armar el cliente SOAP, la acción manda al log del tracer el campo
de contraseña. Deceval escribe `deceval_cert` y `deceval_key` a temporales para firmar el XML. AgilData
no usa certificado de cliente: descarga de S3 `risk_centrals/agildata/cert.cer` a `storage/app/ca/cert.cer`
la primera vez y lo usa como CA para verificar el TLS, y no lo vuelve a bajar mientras el archivo exista.

## Ningún código mira el vencimiento

Ninguna de las dos tablas tiene columnas de vigencia, y ninguna integración revisa la fecha del
certificado antes de usarlo: uno vencido se descubre cuando la entidad rechaza la llamada. En
`RiskCentralCredentialRepository` existen `rotateCredentials` y `getExpiringCredentials`, que consultan
`is_active`, `expires_at` y columnas `username`/`password`/`api_key` que la tabla no tiene; nadie las llama.

## Sistecrédito: tres llaves y la marca POS

Sistecrédito usa `sistecredito_subscription_key` (va en `Ocp-Apim-Subscription-Key`),
`sistecredito_application_key` y `sistecredito_application_token`. La presencia de `sistecredito_pos` (su
valor no importa) elige la integración: con ella, consultar cupo, calcular cuota, registrar y validar van
por `SistecreditoPos`, que manda `sistecredito_application_key` como `storeId`; sin ella, registrar va por
`SistecreditoPay`, que manda las tres llaves como encabezados, y consultar, cuota y validar responden 400
`NoPOS`. La misma presencia decide si el onboarding pide el OTP de la entidad (`validateLenderOtp`).

## Lo que ofrecen los formularios de administración

El alta de credenciales de entidad del admin (`CredentialsController::CREDENTIAL_LIST`) sugiere llaves de
Payvalida, Sistecrédito, Banco de Bogotá, Approbe y Bancolombia; el de centrales
(`RiskCentralCredentialController::CREDENTIAL_LIST`), las de Experian y ADO. Ninguna lista incluye las de
Credifamilia, Wompi ni Deceval. Las listas son sólo sugerencia: la validación de los dos altas acepta cualquier título no repetido.
