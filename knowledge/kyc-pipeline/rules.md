# Pipeline de KYC por comercio

Cubre cómo se elige, por comercio, entre la cascada de centrales de siempre (dentro de
`legacy-backend`) y el pipeline de `customer-profiling-service` sobre Temporal, y qué cambia en el
wizard según el camino. Describe el código de `main`; qué comercios están encendidos es un dato de
cada base y se mide ahí. `application` no participa: no tiene nada de este pipeline.

## Un setting elige el camino, comercio por comercio

El wizard pregunta `GET /api/v2/onboarding/kyc-flow/{hash de sucursal}` (OnboardingV2,
`ResolveKycFlowService`). El backend resuelve la sucursal a su comercio y busca su id en el setting
`kyc_pipeline_allieds` (`{"allieds":[…]}`): si está responde `OBV23000` (pipeline); si no, o si la
lista está vacía, `OBV23001` (flujo viejo). Los dos con HTTP 200; el camino viaja en el `code`.
Una sucursal inexistente da `OBV23004` (404).

Sin la fila del setting el backend no responde «flujo viejo»: `SettingsService` lanza y sale
`OBV23003` con HTTP 500. El wizard trata cualquier error, y cualquier código distinto de `OBV23000`,
como flujo viejo (`resolveKycFlow` → `unwrapOr("legacy")`). Encender un comercio no pide despliegue,
pero tarda: el backend cachea el setting 60 s y el wizard cachea el veredicto exitoso 5 minutos por
sucursal (`kyc-flow:<hash>`).

dev, qa y staging comparten la base, así que comparten el setting: encender un comercio ahí lo
enciende en los tres. Para saber qué comercios van por el pipeline en un ambiente:
`bin/pg sql --target <t> --query "SELECT value FROM settings WHERE \`key\`='kyc_pipeline_allieds'"`.

## Qué cambia en el wizard según el camino

**Flujo viejo.** El OTP v1 y el guardado v1 de datos personales
(`POST /api/onboarding/loan-application/personal-info/{hash}/{ur}`) corren la cascada dentro de la
misma llamada: AgilData → Mareigua → TusDatos, y Experian según el flujo del comercio, sus validadores
o el disparador. Llenar el formulario compra consultas. Al terminar, el wizard va al destino del
comercio (casi siempre `lenders`).

**Pipeline.** Ninguna de esas dos llamadas consulta centrales:
- el OTP va por `/api/v2/onboarding/otp-auth/validate/{hash}`, que valida el código, crea o retoma la
  solicitud, guarda el empleo por defecto y firma términos; «usuario temporal» (`OBV22005`) y «sin datos
  laborales» (`OBV22006`) son éxitos. Si la sucursal o su comercio están deshabilitados responde
  `OBV22012` (HTTP 403, subcódigo `ALLIED_DISABLED`) antes de crear o retomar la solicitud
  (`ValidateOtpAuthService.php:324`), y el wizard lo muestra como rechazo conocido. Esa guarda corre
  con el OTP ya consumido (`:297`) y no alcanza al OTP del codeudor, que retorna antes (`:314-317`). El wizard salta a
  `kyc-processing?start=1`;
- `personal-info` guarda por `/api/v2/onboarding/personal-info/{hash}/{ur}`, que sólo persiste;
- `kyc-processing` arranca el workflow llamando al servicio directo desde el servidor del wizard
  (`CUSTOMER_PROFILING_API_URL`, `POST /api/v1/loan-requests/{ur}/legacy-kyc-pipeline`, id
  `legacy-kyc-pipeline-{ur}`), consulta su estado y, si el pipeline pide un formulario (laboral o
  corrección de identidad), al volver lo DESPIERTA con `…/{workflowId}/user-data` en vez de arrancar
  otro. Arrancar otro puede volver a comprar un buró.

La corrida que arranca tras el OTP (`kyc-processing?start=1`) puede llegar antes del formulario
personal. Si a la persona le faltan los datos que piden las centrales del grafo que van a correr
(tipo y número de documento, nombre, apellido, fecha de expedición), la corrida no se suspende:
TERMINA en `PENDING_USER_DATA` con el formulario personal y razón `MISSING_DATA`, sin consultar
ninguna central (`workflow.go`, `missingUserFields`). El wizard manda al formulario personal sin
`resume=1`, y al guardarlo arranca una corrida NUEVA (`kycFlagAfterSave` → `start`). Sólo la razón
`IDENTITY_MISMATCH` lleva `resume=1` y despierta la corrida suspendida.

**El auto-onboarding no elige el camino.** Sus dos pantallas usan siempre los repositorios v1: el OTP
(`auto-onboarding/otp.tsx`, `PhoneOtpLegacyRepository`) y el guardado de datos personales
(`auto-onboarding/verifying.tsx`, `PersonalInfoLegacyRepository`). No llaman a `resolveKycFlow`, que es lo
que el formulario normal usa para elegir. Un comercio del setting que además tenga auto-onboarding valida
la identidad por la cascada vieja y no arranca la corrida.

`kyc-processing` está registrada para todos los comercios; a uno que no va por el pipeline lo
devuelve a su destino.

## El servicio recorre un grafo por tipo y país

`customer-profiling-service` corre `LegacyKycPipelineWorkflow` en Temporal. Antes de pedir nada le
pregunta al backend `GET /api/v2/onboarding/kyc-requirements/{ur}`: qué salta v1 (identidad para un
PEP, un comercio que no pide fecha de expedición o un país sin centrales; Experian sólo para PEP) y
el `pipelineType` (`STANDARD` o `CREDITOP_X`) con el país. El grafo sale de su tabla `kyc_pipelines`
por `(pipeline_type, country_code)` activo; la tabla `kyc_pipeline_type_by_partner` fuerza el tipo de
algunos comercios (`PULLMAN`, `DFS`). Sin grafo para ese par, la corrida falla: no cae a `STANDARD`.

El grafo `STANDARD` que los tests del servicio fijan como el de producción: AgilData; con datos →
Experian; sin datos o con error → Mareigua; con datos → Experian; sin datos o con error → TusDatos →
compuerta laboral → Experian. Un error técnico sigue la misma arista que «sin datos». La migración
000002 sembró otro orden, con la compuerta laboral antes de TusDatos, así que una base recién migrada
(local, por ejemplo) puede tener ése. Lo vigente es la fila de cada base, no la migración.

La compuerta laboral no mira sólo si la persona declaró empleo e ingreso: le pregunta al backend
`POST /api/v2/onboarding/employment-requirement/{ur}` (`ResolveEmploymentRequirementService`), que
repite lo que v1 hacía antes de pedir el formulario. Primero deriva los campos laborales del resumen
del buró (AgilData/Mareigua); si siguen faltando y el comercio es corbeta (`corbeta_allieds`) o uno de
`KycParityConstants::DEFAULT_EMPLOYMENT_ALLIED_IDS`, escribe el empleo por defecto (1,5 M, «Empleado»,
continuidad 3); y si el comercio tiene `collect_employment_info` apagado no lo exige aunque falte. Es
una lectura que escribe: cada llamada deriva de nuevo los campos del buró. Si la lectura de esa
bandera falla, la trata como encendida; cualquier otro error responde `OBV25003` (500) y la corrida
falla en la compuerta.

Si el formulario hace falta, la corrida publica `PENDING_USER_DATA` con el formulario laboral y razón
`MISSING_DATA` y queda suspendida, sin terminar. La señal del wizard sólo la hace volver a preguntar
al backend; si el backend sigue sin el dato, sigue esperando dentro del mismo plazo. El plazo es de
2 horas (`defaultUserDataTimeout`, ajustable con `pipeline.user_data_timeout`); vencido, la corrida
termina `EXPIRED`.

Al resolver el recorrido llama `POST /api/v2/onboarding/kyc-completion/{ur}`, que aplica lo que v1
hacía dentro del guardado de datos personales: la firma de términos (si la persona ya no es temporal)
y el registro del funnel CreditopX (si la sucursal tiene una entidad CreditopX). Antes de decidir la
firma, si ninguna central consolidó a la persona, la consolida con el nombre que ella tecleó
(`users.full_name` = nombre + apellido, `CompleteKycService.php:158`), como hacía v1 cuando el buró no
concluía; si `first_name` o `surname` siguen siendo el marcador `TEMPORAL USER`, no consolida.

Si aun así la cuenta sigue temporal, la corrida no termina `COMPLETED`: queda `PENDING_USER_DATA` con
el formulario personal y la razón `IDENTITY_MISMATCH` (`workflow.go:178`, `resolvedForTheApplicant`).
Si la completación falla o la corrida es anterior a esa versión, se reporta `COMPLETED` igual.

## Antes de validar algo de identidad o centrales

Primero averiguá por qué camino va el comercio en ESE ambiente: el mismo síntoma tiene causas en
lugares distintos. En el flujo viejo, la consulta está en `OnboardingService::storePersonalInfo`; en el
pipeline, en el grafo y en las actividades del servicio, y el backend sólo guarda y responde.

Un recorrido que llame directo al guardado v1 de datos personales corre la cascada vieja aunque el
comercio esté en `kyc_pipeline_allieds`: lo que decide es qué endpoint se llama, no el setting.

## Cómo termina la corrida y qué ve el wizard

La corrida termina `COMPLETED` si el último resultado es `OK`, `SKIPPED`, `NO_DATA`, `INVALID_DATA` o
`UNAVAILABLE`. Un error técnico en el nodo terminal (por ejemplo, Experian autorizado que falla) hace
fallar el workflow en vez de seguir a entidades sin buró. Las actividades tienen 30 s y 2 intentos, con
backoff de 1 a 20 s; el disparador de Experian, un solo intento.

`kyc-processing` consulta el estado cada 2 s durante los primeros 10 s, cada 5 s hasta los 40 s y luego
cada 10 s, durante 2 minutos como máximo. Un error de red pasajero no corta la espera.
- `PENDING_USER_DATA`: va al formulario laboral o al personal, según el formulario y la razón;
- `COMPLETED`: va al destino del comercio;
- `EXPIRED`: «Se agotó el tiempo de espera», con botón para retomar;
- `IDENTITY_MISMATCH`: «No pudimos confirmar tu identidad», sin reintento. Una corrida nueva vería el
  dato reciente, saltaría el nodo y no volvería a juzgar la identidad;
- `FAILED`, `CANCELED`, `TERMINATED`, o 2 minutos sin desenlace: «No pudimos verificar tu
  información», con reintento.

Esa navegación es la única que ata el listado al desenlace. En `legacy-backend` el único que lee
`kyc_pipeline_allieds` es `ResolveKycFlowService`, y ni el listado de entidades
(`GET /api/onboarding/loan-application/lenders/{ur}`, `ListLenderController`) ni la solicitud
consultan el estado de la corrida ni si la cuenta sigue temporal. Si una solicitud de un comercio en
el pipeline llega al listado sin una corrida `COMPLETED` (por ejemplo, mientras la corrida espera la
corrección de identidad), el backend arma el listado igual, con la cuenta todavía como
`TEMPORAL USER`.
