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

`kyc-processing` está registrada para todos los comercios; a uno que no va por el pipeline lo
devuelve a su destino.

## El servicio recorre un grafo por tipo y país

`customer-profiling-service` corre `LegacyKycPipelineWorkflow` en Temporal. Antes de pedir nada le
pregunta al backend `GET /api/v2/onboarding/kyc-requirements/{ur}`: qué salta v1 (identidad para un
PEP, un comercio que no pide fecha de expedición o un país sin centrales; Experian sólo para PEP) y
el `pipelineType` (`STANDARD` o `CREDITOP_X`) con el país. El grafo sale de su tabla `kyc_pipelines`
por `(pipeline_type, country_code)` activo; la tabla `kyc_pipeline_type_by_partner` fuerza el tipo de
algunos comercios (`PULLMAN`, `DFS`). Sin grafo para ese par, la corrida falla: no cae a `STANDARD`.

El grafo `STANDARD` de la migración 000002: AgilData; con datos → Experian; sin datos o con error →
Mareigua; con datos → Experian; sin datos → compuerta laboral (si la persona no declaró empleo e
ingreso, la corrida espera ese formulario) → TusDatos → Experian. Un error técnico sigue la misma
arista que «sin datos». Lo vigente es la fila de cada base, no la migración.

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
