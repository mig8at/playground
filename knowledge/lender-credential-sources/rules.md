# De dónde sale cada credencial de una entidad

Describe cómo legacy-backend y legacy-application encuentran, en `main`, la credencial con la
que se habla con una entidad (lender) o con una central (Deceval, Experian, ADO): qué tabla, en qué orden de
búsqueda y qué campos lee cada integración; y cómo se genera el token de una tienda ecommerce. Sólo nombra campos y tablas; no certifica qué filas existen en
un ambiente, ni que una credencial esté vigente, ni los pasos manuales de renovación de certificados.

## Dos tablas y dos formas de buscar

Hay dos modelos con el mismo patrón: una columna `credential` con cast `encrypted:collection` (JSON cifrado con la llave
de la app) y oculta al serializar. `LenderAlliedCredential` (`lender_allied_credentials`) cuelga de un lender y, por morph
`allied_type`/`allied_id`, de un comercio (`Allied`) o de una sucursal (`AlliedBranch`); la clave única es lender + tipo +
id. `RiskCentralCredential` (`risk_central_credentials`) cuelga de una central (`risk_central_id`) y, por morph
`credentialable`, de un `Lender`, un `Allied` o un `AlliedBranch`; la clave única es central + tipo + id, y tiene
borrado lógico. Las integraciones de entidades (Bancolombia, Banco de Bogotá, Credifamilia, Sistecrédito, Wompi, Approbe…)
leen la primera; Deceval y Experian la segunda en los dos monolitos, por `RiskCentralCredential::findForUserRequest`. ADO y
Mareigua la leen sólo en legacy-backend: el `AdoController` de legacy-application arma la llamada directamente desde
`config('services.ado.*')`.

Mareigua no usa `findForUserRequest` sino `RiskCentralCredential::forBranchLenders`: como su consulta del
onboarding sale antes de que el cliente elija entidad, recorre las entidades de la sucursal (asociaciones
`lenders_by_allied_branches` con `status = 1` y entidad activa) y toma las credenciales de la central colgadas de esos
`Lender`. Devuelve todas, en orden fijo (id de la entidad y luego id de la credencial), y `Mareigua::getCredentials` usa
la primera; si ninguna entidad de la sucursal tiene credencial, cae a `config('services.mareigua.*')`. No mira las filas
de comercio ni de sucursal. En legacy-backend, `Experian::getCredentials` también usa `forBranchLenders`, pero sólo
después de `findForUserRequest` (la entidad pedida y luego el comercio o la sucursal) y sólo si no se pidió entidad
(`$lender_id === null`, la consulta del onboarding); si tampoco encuentra, cae a
`config('services.experian.<central>.*')`. Una consulta para una entidad concreta sin cuenta propia sigue con la de
config. Las dos búsquedas resuelven la central con `centralOf`, que usa tal cual el modelo `RiskCentral` recibido (o lo
busca por id) en vez de pasárselo a `RiskCentral::find`.

`LenderAlliedCredential` no es idéntico en los dos monolitos. En ambos un scope global `credencialVigente`
(`SIN_APAGADAS`, `status = 1`) deja fuera las credenciales apagadas; `legacy-application` sobrescribe además
`resolveRouteBinding` con `withoutGlobalScope(self::SIN_APAGADAS)` para que las rutas de administración puedan abrir
también las desactivadas.

## Credencial de entidad: sucursal primero, comercio después

`LenderAlliedCredential::findOrFailByLenderAndAlly(lender, sucursal)` busca la fila del lender colgada de esa sucursal;
si no existe, la del lender colgada del comercio de la sucursal; si tampoco, falla con `firstOrFail`. En ambos monolitos
el modelo aplica el scope global `credencialVigente` (`SIN_APAGADAS`), que filtra `status = 1`: una credencial apagada
queda excluida igual que una inexistente y provoca `ModelNotFoundException`, no un error de la entidad. Es determinista:
la sucursal siempre gana.

La excepción es la selección de la entidad en el onboarding (`UserRequestService` en legacy-backend,
`UserRequestController` en legacy-application): ahí la falta de fila se atrapa, la credencial queda en null y la selección
sigue sin llamar al `register()` de la entidad. La URL que recibe el cliente depende del tipo de respuesta y difiere
entre monolitos: en legacy-backend, la UTM para 0 y 1 y la de confirmación en plataforma para 2 a 4; en
legacy-application, la UTM para 0 y 1 y, para 2 y 3, la continuación del flujo sólo si la solicitud es de autogestión.
legacy-backend deja además una fila en `logs` con la descripción «Credencial de lender ausente - no se consumió la
integración»; legacy-application no deja rastro.

En legacy-backend, para 2 a 4 sin credencial la selección marca además `standBy = true` y guarda esa URL de confirmación
aparte (`$inPlatformContinueUrl`), porque otras ramas pisan `$url` más abajo. Esa URL sólo se entrega como
`continueUrl` (el front lleva al cliente directo a la confirmación) si `LenderTabBehaviorResolver::continuesInPlace` dice
que el que está frente a la pantalla es el cliente (`OnboardingOrigin::isCustomerPresent()`: autogestión o tienda, no
asesor) y no se mostró un modal; en ese caso tampoco sale el WhatsApp de autogestión de la entidad. Con asesor sale el
aviso de siempre y no hay `continueUrl`. Así una entidad del riel 4 sin credencial —el caso de una entidad que no habla
con la suya por credencial propia— llega a la confirmación en plataforma sin fallar.

## Credencial de central: la entidad primero, sólo en legacy-backend

`RiskCentralCredential::findForUserRequest(central, solicitud, lender_id)` difiere entre los monolitos. En
legacy-backend, si llega `lender_id`, busca primero una fila de esa central colgada del `Lender`; si no la hay, cae a las
filas colgadas del comercio o de la sucursal de la solicitud. En legacy-application, si llega `lender_id` busca sólo la
del `Lender` y devuelve null si falta, sin caer al comercio; y el Deceval de legacy-application llama con `lender_id` en
null, así que allí la credencial de la entidad nunca se usa y sólo cuentan comercio y sucursal. Las dos consultas usan
`inRandomOrder()`: por la clave única, la búsqueda por lender devuelve a lo sumo una fila, pero si el comercio y la
sucursal tienen cada uno su fila, cuál sale es al azar (el efecto sobre el pagaré está en
[deceval-promissory-note](../deceval-promissory-note/rules.md#la-credencial-del-depositante)).

En legacy-backend, cuando `Experian::getCredentials` no encuentra credencial en `findForUserRequest` y la consulta es
del onboarding sin entidad pedida (`$lender_id === null`), toma la primera de `RiskCentralCredential::forBranchLenders`:
las credenciales de esa central colgadas de las entidades activas asignadas a la sucursal
(`LendersByAlliedBranch.status = 1` y `lenders.status = 1`), en orden fijo por id de la entidad y luego por id de la
credencial. Si tampoco hay (o si se pidió una entidad concreta), arma una credencial en memoria desde
`config('services.experian.<producto>.*')`. ADO, sin fila, cae directo a `config('services.ado.*')`; Deceval no tiene
ese respaldo.

Mareigua en legacy-backend no usa `findForUserRequest`: `Mareigua::getCredentials($userRequest)` llama directo a
`RiskCentralCredential::forBranchLenders(central, allied_branch_id)` y usa la primera credencial devuelta. Se mira la
sucursal y no la entidad de la solicitud porque la consulta del onboarding sale antes de que el cliente elija entidad. Si
ninguna entidad de la sucursal tiene credencial, o no hay solicitud, arma una en memoria desde
`config('services.mareigua.*')`. `MareiguaService::validateUserMareiguaV2` pasa la solicitud (`UserRequest::find`) para que
esa elección ocurra. Las llaves de la credencial son `mareigua_username` y `mareigua_password`.

En ADO de legacy-backend, el enroll crea la transacción con `Ado::enrollCredentialsFor`: en el camino IMEI
(`UserRequest::isImeiPath`) hace la búsqueda con el `lender_id` de la solicitud; fuera de él usa config. Guarda en el
`request` del registro de `risk_central_user_data` el `credential_id` con que la creó (null si salió de config). La
consulta de estado y la descarga de imágenes de ese registro (`Ado::credentialsFor`) usan esa misma credencial, aunque
esté borrada lógicamente, y vuelven a config si el id es null o ya no existe, para no consultar un proyecto de ADO
distinto del de la transacción. Los registros sin esa clave se resuelven con la búsqueda normal.

## Quién usa certificado y cómo lo lee

Los certificados viven como texto PEM dentro del mismo JSON cifrado. Bancolombia los usa en memoria con
openssl: `bancolombia_cert`, `bancolombia_privkey` y `bancolombia_shared_key`. Banco de Bogotá (y su variante
CeroPay) escribe `banco_de_bogota_pem` y `banco_de_bogota_key` a archivos temporales para mTLS, con
`banco_de_bogota_pem_passphrase`, y los borra al terminar. Credifamilia REST hace lo mismo con
`credifamilia_cert` y `credifamilia_key`. Credifamilia Consumo (SOAP) también lee `credifamilia_cert`,
`credifamilia_key` (a temporales que borra al terminar) y usa `credifamilia_password` como contraseña del
certificado: es el mismo campo que REST manda como contraseña de usuario en su OAuth. El comando
`credifamilia-consumo:seed-credentials` (`SeedCredifamiliaConsumoCredentialCommand`), que agrega la
credencial SOAP a las filas existentes de Credifamilia, escribe en cambio `credifamilia_consumo_cert`,
`credifamilia_consumo_key` y `credifamilia_consumo_cert_password`, que ningún código de `main` lee: sembrar
con él no cambia lo que usa la acción.

`CredifamiliaConsumo::makeClient`, que corre en cada `register()` y en cada `submitDocument()`, manda al log
del tracer (`TracerService`) el valor de `credifamilia_password` en la clave `certPassword`, junto con las
rutas de los temporales. El resto del archivo evita a propósito registrar `$credential->credential` y sólo
loguea ids de la fila. Deceval escribe `deceval_cert` y `deceval_key` a temporales para firmar el XML y los
borra al terminar. AgilData
no usa certificado de cliente: descarga de S3 `risk_centrals/agildata/cert.cer` a `storage/app/ca/cert.cer`
la primera vez y lo usa como CA para verificar el TLS, y no lo vuelve a bajar mientras el archivo exista.

## Ninguna integración mira el vencimiento

Ninguna de las dos tablas tiene columnas de vigencia, y ninguna integración revisa la fecha del
certificado antes de usarlo: uno vencido se descubre cuando la entidad rechaza la llamada. En
`RiskCentralCredentialRepository` (`Modules/Credentials/App/Repositories`) existen `rotateCredentials` y
`getExpiringCredentials`, que consultan `is_active`, `expires_at` y columnas `username`/`password`/`api_key`
que la tabla no tiene; sólo las declara `RiskCentralCredentialRepositoryInterface` y nadie las llama.

El vencimiento sí se mira en legacy-backend, fuera del camino de la originación y sólo sobre
`lender_allied_credentials`, leyendo el PEM con `openssl_x509_parse` en `CertificateVerdict`
(`Modules/Credentials/App/Domain`): `broken` si no es un certificado, si la llave privada del par no
empareja o si ya venció; `expiring-soon` si vence dentro de `WARNING_DAYS` (30 días); `healthy` si no.
Los campos se reconocen por sufijo (`_cert`/`_pem` para el certificado, `_key`/`_privkey` para la llave).
Lo usan tres lugares, ninguno bloquea una llamada a la entidad:

- al guardar una credencial desde el backoffice, `CredentialValueCheck::warnings` devuelve como `warnings`
  el certificado vencido, el que vence pronto o el par que no empareja, pero el guardado sigue;
  `CredentialValueCheck::rejections` sólo rechaza lo que openssl no puede leer o un campo `_cert`/`_pem`
  sin PEM, nunca por vencido;
- `IntegrationHealthService`, detrás de `GET integrations/health` y `integrations/health/detail` del
  backoffice, recorre las credenciales de entidad y las ordena por estado, por defecto sólo las de pares
  entidad–sucursal habilitados;
- el comando `credentials:audit-certificates` (sólo lectura, `--dias`, `--solo-problemas`) lista la
  vigencia de los certificados guardados; no está agendado.

`risk_central_credentials` no pasa por ninguno de los tres. En legacy-application nada lee la fecha del
certificado.

## Sistecrédito: tres llaves y la marca POS

Sistecrédito usa `sistecredito_subscription_key` (va en `Ocp-Apim-Subscription-Key`),
`sistecredito_application_key` y `sistecredito_application_token`. La presencia de `sistecredito_pos` (su
valor no importa) elige la integración: con ella, consultar cupo, calcular cuota (que llama al mismo
`consult` de POS), registrar y validar van por `SistecreditoPos`, que manda `sistecredito_application_key` como `storeId`; sin ella, registrar va por
`SistecreditoPay`, que manda las tres llaves como encabezados, y consultar, cuota y validar responden 400
`NoPOS`. La fachada `Sistecredito` es idéntica en los dos monolitos. La misma presencia decide si el onboarding pide el OTP de la entidad (`validateLenderOtp`).

## Lo que ofrecen los formularios de administración

En legacy-backend, el alta de credenciales de entidad del admin (`CredentialsController::CREDENTIAL_LIST`) sugiere llaves de
Payvalida, Sistecrédito, Banco de Bogotá, Approbe y Bancolombia; el de centrales
(`RiskCentralCredentialController::CREDENTIAL_LIST`), las de Experian y ADO. Ninguna lista incluye las de
Credifamilia, Wompi ni Deceval. Las listas son sólo sugerencia: la validación de los dos altas acepta cualquier título no repetido.

## El token de una tienda ecommerce

Una sucursal ecommerce no usa estas tablas para autenticar a la tienda: tiene una fila en `allied_ecommerce_credentials`
cuyo campo `credential` es el token que la tienda presenta. Se genera al crear la sucursal, en legacy-backend
(`AlliedManagementService::storeEcommerceCredential` y, desde el backoffice, `Modules/Backoffice` `EcommerceBranchCreator::create`)
y en legacy-application (`EcommerceBranchCreator::create`), como `bin2hex($allied->id . $branch->hash . date('Y-m-d'))`:
es la codificación hexadecimal, reversible, del id del comercio, el hash de la sucursal y la fecha de creación; no
lleva ningún componente aleatorio. El hash de la sucursal, si no se pasa uno, es `hash('crc32', date('Y-m-d H:i:s'))`
del momento de creación, y viaja como `partner_id` en rutas públicas del onboarding (`commerce/type/{partner_id}`,
`ecommerce-request/create/{partner_id}`). A diferencia de `customer_key`, `customer_secret` y `headers`, el token no
está cifrado ni oculto al serializar. En el código revisado sólo se escribe al crear la sucursal: no se rota. La
validación (`findValidCredential` en legacy-backend; los controladores VTEX y WooCommerce en legacy-application)
compara por igualdad la sucursal y el token.

Al crear esa sucursal, las entidades que se le activan (`LendersByAlliedBranch::switchOn` y la copia de reglas) salen
de `LenderAlliedCredential` vigente (`status = 1`, por el scope global `credencialVigente` que los dos monolitos
declaran igual). El filtro de tipo difiere: `AlliedManagementService::storeEcommerceCredential` filtra
`where('allied_type', Allied::class)` y toma `->distinct()->get(['lender_id'])`, mientras que los dos
`EcommerceBranchCreator::create` (el del backoffice de legacy-backend y el de legacy-application) consultan sólo por
`allied_id` sin filtrar `allied_type`, así que cuentan toda fila activa cuyo `allied_id` coincida con el id del
comercio, sea de comercio o de una sucursal con ese mismo número.
