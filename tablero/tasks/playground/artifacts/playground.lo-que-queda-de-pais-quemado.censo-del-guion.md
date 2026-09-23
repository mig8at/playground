# Censo del `-`: dónde se lee el tipo de documento, y qué rompe

> Anexo de la tarea **#68**, hermano de `lo-que-queda-de-pais-quemado.arreglo-guion-bancolombia.md`.
> Datos crudos en `lo-que-queda-de-pais-quemado.censo-del-guion.json` (204 sitios).
> Rutas y líneas contra **`origin/main`**, comprobadas el 2026-09-10.

## ⚠ Estado: barrido COMPLETO, verificación CORTADA

Se cortaron los dos barridos a pedido de Miguel (demasiados agentes). Qué quedó y qué no:

| | estado |
|---|---|
| barrido, 12 ángulos (6 repos, 457 archivos) | **completo** — los 12 volvieron |
| 293 hallazgos crudos → 204 sitios únicos | **completo** |
| ¿existe el archivo y la línea dice lo que dice? | **62/62 comprobados a mano** contra `origin/main` |
| ¿es ALCANZABLE con `-`? (la fase adversarial) | ⛔ **NO corrió** — salvo lo que verifiqué a mano, abajo |
| barrido de formularios dinámicos | parcial: 9 veredictos de 21 |

**Cómo leer esto:** lo marcado ✔ lo verifiqué yo leyendo el código. El resto es **candidato sin
verificar**: el archivo y la línea son buenos, pero *que el `-` llegue ahí* no está comprobado. Esa
distinción es la que decide si algo entra al PR, así que no la borres al usar la tabla.

## Los números

    293 hallazgos crudos  →  204 sitios únicos  →  62 peligrosos Y presuntamente alcanzables

    por clase (204):  outbound-payload 72 · data-quality 39 · write 22 · harmless 21
                      crash 16 · lookup-miss 15 · wrong-branch 12 · validation 7

    por repo (293):   legacy-backend 197 · legacy-application 63 · frontend-monorepo 14
                      customer-profiling-service 9 · pre-approvals-service 8 · creditop_mobile 2

## Lo que cambia la conclusión de ayer

Ayer el diagnóstico era «rompe Bancolombia». **El alcance es mucho más ancho**, y por dos caminos que
ninguna búsqueda por `document_type ==` encontraría.

### ✔ 1 · El `-` entra al `pre-approvals-service` y se reparte a CINCO entidades

`internal/infra/services/applicant_service.go:179` trae el usuario del legacy
(`GET {user_service}/user/{id}`) y copia `document_type` **tal cual** a `domain.Applicant.DocumentType`:
sin lista blanca, sin normalizar, sin rechazar.

Y el dato que lo cierra: **la API pública de ese servicio nunca acepta el tipo del caller**
(`git grep -ciE ocument origin/main -- internal/infra/handlers internal/openapi` da **cero**). O sea que
ahí el tipo viene **siempre** de la BD, nunca del formulario. Entonces lo que hace cada cliente:

| entidad | línea | qué hace con `-` |
|---|---|---|
| **Welli** | `welli/client.go:197` | ⚠ **lo convierte en `CC`** — ver abajo |
| Meddipay | `meddipay/client.go:124` | manda `"type": "-"` crudo |
| Sistecredito | `sistecredito/client.go:53,61` | manda `typeDocument=-` crudo (¡en el query string!) |
| Flamingo | `flamingo/client.go:111` | manda `"document_type": "-"` crudo |
| Credifamilia | `credifamilia/client.go:193` | ✔ **guarda bien**: `docType, ok := …; if !ok { return apiInvalidDocumentType(…) }` — y tiene test (`TestCredifamiliaClient_CallAPI_UnsupportedDocumentType`) |

### ✔ 2 · El peor sitio del censo: Welli recibe «colombiano» inventado

`pre-approvals-service/internal/infra/lending_products/welli/client.go:197`:

```go
docType := documentTypeMap[a.DocumentType]
if docType == 0 {
    docType = 1          // 1 == CC
}
```

Con `-` el mapa falla, Go devuelve el cero, y el `if` lo **asciende a cédula de ciudadanía**. No hay
excepción, no hay log, no hay error: se le **afirma a Welli que la persona es colombiana**.

Es literalmente la falsedad que la tarea #68 vino a borrar de `users` («`CC` no es un valor por defecto,
es afirmar «colombiano» sobre alguien de quien no se sabe nada»), reintroducida como fallback en un
microservicio en Go. Y es invisible a cualquier auditoría del legacy.

### ✔ 3 · La clase «crash» son DOS cosas distintas, y sólo una es un bug

No todo lo que revienta con `-` está mal escrito. Mirando las cuatro:

| sitio | qué hace | veredicto |
|---|---|---|
| `legacy-backend/app/Actions/Lenders/Credifamilia.php:207` | `match ($user->document_type) { 'CC' => 1, default => throw new \DomainException(...) }` | ✔ **falla FUERTE y a propósito** |
| `legacy-backend/…/Welli/DTO/WelliRegistrationData.php:53` | `$map[$type] ?? null` y después `throw new InvalidArgumentException('Invalid document type: -')` | ✔ **falla FUERTE, con el valor en el mensaje** |
| **`legacy-application/app/Actions/Lenders/Welli.php:90`** | `self::DOCUMENT_TYPES[$user->document_type]` — **sin `??`, sin guarda** | ⚠ **«Undefined array key '-'»** |
| `legacy-application/app/Actions/Allies/Corbeta.php:82` | igual, sin guarda | ⚠ y ojo: en este gemelo la carpeta es **`Allies`**, en legacy-backend es **`Allieds`** |

Los dos primeros **no hay que parchearlos**: hacen lo correcto (se niegan a inventar). Lo que hay que
arreglar es que les llegue el `-`. Los dos últimos sí necesitan guarda.

### ✔ 4 · `findByDocumentAndType`: el arreglo se aplicó en 2 de 9 sitios

La tarea #68 cambió dos guards a `findByDocument($doc)` con el argumento correcto —
`users.document_number` es UNIQUE, así que el número ya identifica a la persona y filtrar además por
tipo sólo puede dejar de encontrarla. Medido hoy:

    findByDocument         →  2  (RegisterCellPhoneService:329, :519)   ← los que #68 arregló
    findByDocumentAndType  →  7  (siguen filtrando por tipo)

Los 7 que quedaron:

- `Modules/Onboarding/App/Http/Controllers/CorbetaCheckoutController.php:998` y `:1382` ← el canal QR, donde nacen las 184 fichas incoherentes
- `Modules/Onboarding/App/Services/DynamicFormsService.php:487` y `:875` ← los del formulario dinámico
- `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:670`
- `Modules/Onboarding/App/Services/MobileOnboardingService.php:726`
- `Modules/OnboardingV2/App/Services/StorePersonalInfoService.php:427`

⚠ **Y el cambio NO es mecánico.** Para un guard de duplicados, quitar el filtro es correcto (pasa de
fallar abierto a fallar cerrado). Pero si un sitio usa la búsqueda para *resolver a qué usuario aplicar
algo* en vez de *detectar un choque*, quitarlo le hace encontrar a la persona equivocada. Hay que
clasificar los 7 uno por uno — eso es justo lo que la fase cortada iba a hacer.

## Los «formularios dinámicos» son TRES cosas

| | qué es | veredicto |
|---|---|---|
| `form-service` (Go, de José) | backend del form **G2** (`additional-info`) | ✔ **limpio**: su prefill sale de `user_field_values` (EAV) y nunca lee `users.document_type` (`internal/core/domain/supplementary_info/user_info.go`). Y en prod la tabla `fields` **no tiene** campo de tipo de documento: los 23 que matchean son `file` (uploads de cédula, PEP, datacrédito) y los «Tipo de…» son de inmueble, persona, vivienda, contrato, calle y contribuyente |
| `Modules/Onboarding/App/Services/DynamicFormsService.php` | el form dinámico del **legacy** | ⚠ dos de los 7 lookups. El tipo sale del **payload** (`NUI`/`CIE` — RD) y busca por número **y** tipo: si el dueño está guardado con `-`, el guard de identidad duplicada dice «no hay conflicto» y **falla abierto** |
| repo `dynamic-form` | prototipo (usuario quemado, base en memoria) | sin verificar — quedó en la fase cortada |
| `onboarding-forms-service` | el de RD | censo dio cero; **el cero no está verificado** (puede ser falso negativo si el tipo viaja con otro nombre) |

## Candidatos SIN verificar — los 62, para triar

Están todos en el `.json`. Existencia y snippet comprobados; **alcanzabilidad no**. Los que más
sorprenden y por eso más merecen verificarse antes de tocarlos:

- **centrales de riesgo** con `_reach: si`: `app/Actions/RiskCentrals/Mareigua.php:101`,
  `app/Actions/RiskCentrals/Agildata.php:90` (legacy-backend) y `Agildata.php:93,:180`,
  `Mareigua.php:61` (legacy-application). Si de verdad corren antes del formulario, el `-` viaja al buró.
- **`customer-profiling-service`**: `internal/core/workflows/legacykycpipeline/providers.go:107,:119,:127`
  y `internal/infra/grpc/kyc_gateway_client.go:88` — el tipo saldría hacia el KYC por gRPC.
- **entidades del legacy** que mandan el tipo crudo: `BancoDeBogotaCeroPay`, `Meddipay`,
  `SistecreditoPos` (los dos gemelos), `Modules/Partner/App/Services/UserFinancialDataService.php:36`,
  `UserRequestManagementService.php:536`, `Modules/LegalV1/…/SignAndSendTermsAndConditionsService.php:207`.
- **`wrong-branch`** (no se caen, deciden mal en silencio): `TusDatosService.php:51`,
  `DatacreditoRuleEvaluator.php:21`, `LenderUserCategoryService.php:402`,
  `LenderValidationService.php:370`, `CheckExperianTriggerService.php:588`,
  `EvidenteFlowService.php:948`. Para cada uno la pregunta es si el `else` es benigno o cambia una
  decisión de negocio.
- **autogestión**: `legacy-application/app/Http/Controllers/Api/SelfManagerController.php:263` y
  `…/SelfManager/FinalizePurchaseQrController.php:131` — el mismo canal del incidente.

## Lo que falta hacer

1. **Triar los 62 por alcanzabilidad.** Es la pregunta «¿corre antes del paso de datos personales, o
   sobre una ficha que nunca lo completó?». Sin eso, la mitad de la lista es ruido: 146 de los 293
   crudos venían marcados `no`.
2. **Clasificar los 7 `findByDocumentAndType`**: guard de choque (quitar el filtro) vs resolución de
   usuario (no quitarlo).
3. **Decidir el arreglo de `welli/client.go:197`** — el `if docType == 0 { docType = 1 }` es una
   decisión de producto, no un bug de tipeo: hay que elegir entre fallar (como Credifamilia) o resolver
   por país.
4. Cerrar los dos negativos que quedaron a medias: el prototipo `dynamic-form` y
   `onboarding-forms-service`.

## Corrección a lo de ayer

**`F-192` ya está tomado** (el botón de la fecha de pago). El finding del `-` sería **F-195**.
