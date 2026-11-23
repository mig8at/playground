# CREDITOP · índice de knowledge/

Qué tema de `knowledge/` contesta cada pregunta, en el orden en que pasa una solicitud. Este archivo **no explica
reglas**: dice dónde están. Cada entrada es un `tema#ancla` que se lee con `make knowledge-read ID=tema#ancla`
(sin `#ancla`, el tema entero) y una línea con lo que contesta. Lo que dice cada tema está verificado contra `main`
de los repos; este índice no.

Si la pregunta no aparece acá, `make knowledge-search Q='…'`. Si tampoco la encuentra, no está escrita: se investiga
en el código de `main` (los dos monolitos) y se suma a knowledge.

## El mapa en una pantalla

- **Quién es quién** (cliente, comercio y sucursal, asesor, entidad, solicitud) y qué sistema hace qué:
  [business-overview](knowledge/business-overview/rules.md).
- **Los rieles** (`lenders.response_type`): de quién es la política y por dónde se origina.
  [lender-response-types#la-politica-es-lo-que-separa-a-los-rieles](knowledge/lender-response-types/rules.md)

  | riel | política | se origina | ejemplos |
  |---|---|---|---|
  | 0 | la entidad | en su flujo (referido, UTM) | Addi, PayJoy, Sistecrédito |
  | 1 | la entidad, por API | en su flujo | Welli, Meddipay, Prami |
  | 2 | Creditop (motor de perfiles) | en casa, cartera CreditopX | CreditopX, SmartPay |
  | 3 | Creditop | en casa, cupo rotativo | |
  | 4 | la entidad, aplicada por Creditop | en casa, se entrega a la entidad | Credifamilia, Finandina (qa) |

- **El vocabulario de un recorrido** (canal, tramo común, riel, producto, variaciones, desenlace):
  [origination-paths](knowledge/origination-paths/rules.md).

## El recorrido de una solicitud, paso a paso

### 1. Entrada: por dónde llega el cliente

- [origination-paths#canal-por-donde-entra-la-solicitud](knowledge/origination-paths/rules.md): asesor, autogestión, ecommerce, QR.
- [onboarding-origin](knowledge/onboarding-origin/rules.md): quién escribe el canal y el backend del usuario.
- Ecommerce:
  - [ecommerce-store-api](knowledge/ecommerce-store-api/rules.md): enlace de pago, estado y cancelación con el token de sucursal.
  - [ecommerce-context](knowledge/ecommerce-context/rules.md): el pedido sin cookie, sus tres vínculos con la solicitud, el monto.
  - [ecommerce-platform-connectors](knowledge/ecommerce-platform-connectors/rules.md): VTEX (y lo de Shopify).
- Códigos y caja:
  - [client-code-redemption](knowledge/client-code-redemption/rules.md): el código de preaprobado.
  - [purchase-code-lifecycle](knowledge/purchase-code-lifecycle/rules.md): el PIN de compra y la conciliación.
  - [merchant-cashier-transactions](knowledge/merchant-cashier-transactions/rules.md): la API de caja del comercio.
- [creditop-mobile](knowledge/creditop-mobile/rules.md): la app del cliente final.

### 2. OTP y datos personales

- [otp-source-and-bypass#el-otp-de-onboarding](knowledge/otp-source-and-bypass/rules.md), y `#el-bypass-de-qa`.
- [returning-client-personal-info](knowledge/returning-client-personal-info/rules.md): usuario temporal o consolidado, qué se puede corregir.
- [country-context](knowledge/country-context/rules.md): país, documentos, largo del celular.

### 3. Centrales de riesgo, antes del listado (todavía no se decide nada)

- [origination-paths#quien-decide-en-el-tramo-comun-datos-listado-y-preaprobacion](knowledge/origination-paths/rules.md): el resumen de quién decide qué.
- [kyc-pipeline](knowledge/kyc-pipeline/rules.md): cascada en legacy-backend o pipeline de customer-profiling-service, por comercio.
- [kyc-path-and-experian-trigger](knowledge/kyc-path-and-experian-trigger/rules.md): el grafo por sucursal, el dato vigente y **cuándo se consulta Experian** (`#el-disparador-etapa-por-etapa`, `#frecuencia-uno-de-cada-n`).
- [identity-name-validation](knowledge/identity-name-validation/rules.md): Ágil Data, Mareigua y TusDatos comparando nombres.
- [abaco-requirements](knowledge/abaco-requirements/rules.md): ingresos gig (Rappi, Didi) y el salto de buró.
- [lender-credential-sources](knowledge/lender-credential-sources/rules.md): con qué cuenta se consulta cada central.

### 4. El listado de entidades

- [lender-listing](knowledge/lender-listing/rules.md): las puertas del listado y el monto.
  - `#las-reglas-duras-solo-sacan-del-listado-a-algunas-entidades`: las reglas duras sacan a los rieles 2 y 3, no al 4.
- [client-profiling](knowledge/client-profiling/rules.md): la probabilidad de cada entidad (demográfica, matriz, ML) y la aprobación manual.
- [lender-integrations#probabilidad-oculta-por-convenio-o-por-comercio](knowledge/lender-integrations/rules.md).

### 5. La decisión: preaprobación o motor

- **Cualquier riel con tarjeta que espera:** [pre-approvals-service](knowledge/pre-approvals-service/rules.md).
  - `#cada-consulta-vuelve-a-la-entidad-no-hay-cache-de-preaprobaciones`.
  - `#lo-que-hace-el-asistente-con-cada-respuesta-el-estado-de-la-tarjeta`: approved, rejected, processing, policy_blocked…
- **Rieles 2 y 3, el motor de perfiles:**
  - [lender-profile-rules](knowledge/lender-profile-rules/rules.md): gana la primera regla, de la capacidad al cupo, continuidad, lo que niega antes de los perfiles.
  - [creditopx-quota](knowledge/creditopx-quota/rules.md): el cupo mensual por perfil y el mandato.
  - [field-scoring-policy](knowledge/field-scoring-policy/rules.md): la categoría por puntaje cuando ninguna regla aprueba.
  - [creditopx-setup-diagnosis](knowledge/creditopx-setup-diagnosis/rules.md): **por qué una entidad CreditopX no salió, salió sin cupo o no deja autorizar**.
  - [creditopx-revolving-credit](knowledge/creditopx-revolving-credit/rules.md): el riel 3.
- **Riel 1 y entidades integradas:** [lender-integrations](knowledge/lender-integrations/rules.md): Prami, Welli, Meddipay, Sistecrédito, Bancolombia BNPL, Crédito 365, UMA.
- **Riel 4:** [lender-response-types#tipo-4-politica-de-la-entidad-rieles-de-creditop](knowledge/lender-response-types/rules.md).

### 6. Elegir la entidad: oferta, cuota inicial y plan

- [creditopx-offer-calculation](knowledge/creditopx-offer-calculation/rules.md): cupo, cuota inicial, FGA, valor a financiar y plazos de la tarjeta.
  - `#fga-seguro-de-garantia-y-fianza-tres-garantias-que-no-son-lo-mismo`.
- [lender-response-types#el-plan-del-riel-4-una-ruta-por-pantalla-y-un-solo-calculo](knowledge/lender-response-types/rules.md).
- [renting-plans](knowledge/renting-plans/rules.md) y [motai-renting](knowledge/motai-renting/rules.md): renting y RTO.

### 7. Formulario dinámico

- [origination-paths#campos-que-pide-el-formulario-en-cada-comercio](knowledge/origination-paths/rules.md).
- [dynamic-form-schema](knowledge/dynamic-form-schema/rules.md): esquema, caché y respuestas en form-service.
- [country-geography](knowledge/country-geography/rules.md): país, zona y ciudad.

### 8. Validación de identidad (después de elegir una entidad que origina en casa)

- [identity-validation](knowledge/identity-validation/rules.md): qué proveedor y en qué orden.
  - ADO: `#ado-documento-y-selfie-y-la-re-validacion-solo-con-selfie` y `#ado-paso-a-paso-enroll-callback-y-estado`.
  - `#la-validacion-manual-quien-la-escribe-y-que-la-frena`: ⚠ el admin manda un WhatsApp real.
  - `#las-listas-restrictivas-tusdatos-aml-solo-frenan-con-hallazgos-alto`.
- [credifamilia-origination#crosscore-con-jumio-y-los-pasos-de-evidente](knowledge/credifamilia-origination/rules.md).

### 9. Firma, pagaré y equipo

- [origination-paths#la-firma-en-casa-que-documentos-se-muestran-y-se-firman](knowledge/origination-paths/rules.md).
- [signing-document-generation](knowledge/signing-document-generation/rules.md): cómo se hace cada PDF de firma, **Blade o pdf-mapper**, quién elige el motor y de dónde salen los datos.
- [deceval-promissory-note](knowledge/deceval-promissory-note/rules.md): el pagaré desmaterializado.
  - ⚠ `#la-credencial-del-depositante`: la búsqueda puede traer la credencial de otra central.
- [otp-source-and-bypass#el-otp-del-pagare-se-genera-en-el-servicio-de-otp](knowledge/otp-source-and-bypass/rules.md).
- [cosigner-signature](knowledge/cosigner-signature/rules.md): la firma y el cierre del codeudor.
- [device-imei-validation](knowledge/device-imei-validation/rules.md): el IMEI y su desembolso (sin auth ni chequeo de estado).

### 10. Autorización y formalización: el estado 11

- [origination-paths#la-autorizacion-del-otp-de-la-firma-al-estado-11](knowledge/origination-paths/rules.md): guardas, transacción, formalización y efectos.
- [user-request-lifecycle](knowledge/user-request-lifecycle/rules.md): los estados (se leen por nombre), qué cierra una solicitud.
  - `#al-autorizar-se-cancelan-las-solicitudes-hermanas-creditopx`.
  - `#con-originacion-delegada-11-se-confirma-antes-de-radicar`: el riel 4 entrega después del commit.
- [creditopx-payment-application#cuota-inicial](knowledge/creditopx-payment-application/rules.md).

### 11. Después del 11

- [origination-paths#despues-del-11-quien-administra-el-credito](knowledge/origination-paths/rules.md).
- **Cartera CreditopX:**
  - [creditopx-portfolio-servicing](knowledge/creditopx-portfolio-servicing/rules.md): la noche, la causación, la mora y la cobranza, las acciones del admin.
  - [creditopx-payment-application](knowledge/creditopx-payment-application/rules.md): la cascada del pago y Wompi.
  - [creditopx-revolving-credit#pagar-y-liberar](knowledge/creditopx-revolving-credit/rules.md).
- **Cobranza y avisos:** [weekly-collection-reminders](knowledge/weekly-collection-reminders/rules.md) y [whatsapp-campaigns](knowledge/whatsapp-campaigns/rules.md).
- **Equipos IMEI en mora:** [device-locking](knowledge/device-locking/rules.md).

## Por entidad

| entidad | dónde |
|---|---|
| Credifamilia (riel 4) | [credifamilia-origination](knowledge/credifamilia-origination/rules.md) (preaprobación, identidad, radicación SOAP) · [credifamilia-financing](knowledge/credifamilia-financing/rules.md) (fianza y plan) · [origination-paths#el-riel-4-paso-a-paso-que-es-del-riel-y-que-es-de-credifamilia](knowledge/origination-paths/rules.md) |
| Finandina | [finandina-policy](knowledge/finandina-policy/rules.md) (la política en el motor) · [lender-profile-rules#de-la-capacidad-mensual-al-cupo](knowledge/lender-profile-rules/rules.md) (capacidad) |
| SmartPay (República Dominicana, IMEI) | [smartpay](knowledge/smartpay/rules.md) · [device-imei-validation](knowledge/device-imei-validation/rules.md) · [device-locking](knowledge/device-locking/rules.md) |
| Motai (renting y RTO) | [motai-renting](knowledge/motai-renting/rules.md) · [renting-plans](knowledge/renting-plans/rules.md) |
| Pullman | [kyc-path-and-experian-trigger#pullman-y-dfs-un-override-en-el-servicio](knowledge/kyc-path-and-experian-trigger/rules.md) · [creditopx-payment-application#pago-en-caja-de-pullman](knowledge/creditopx-payment-application/rules.md) |
| Welli, Prami, Meddipay, Sistecrédito, Bancolombia BNPL, Crédito 365, UMA | [lender-integrations](knowledge/lender-integrations/rules.md) |

## Configurar y administrar

- **Alta de comercios y convenios:**
  - [merchant-onboarding](knowledge/merchant-onboarding/rules.md): alta y baja de comercios.
  - [merchant-lender-agreement](knowledge/merchant-lender-agreement/rules.md): el convenio comercio–entidad y su habilitación por sucursal.
  - [backoffice-merchants](knowledge/backoffice-merchants/rules.md): el comercio en el backoffice nuevo.
- **Alta de una entidad CreditopX:** [creditopx-setup-diagnosis#alta-plantilla-copias-y-perfiles](knowledge/creditopx-setup-diagnosis/rules.md).
- **Credenciales de entidades y centrales:** [lender-credential-sources](knowledge/lender-credential-sources/rules.md).
- **Personas y permisos:**
  - [user-roles](knowledge/user-roles/rules.md): los perfiles y qué puede cada uno.
  - [advisor-accounts](knowledge/advisor-accounts/rules.md): el asesor, su alta, su baja y el token de su celular.
  - [admin-panel](knowledge/admin-panel/rules.md): el admin de legacy-application.
- **Infraestructura:** [infrastructure-changes](knowledge/infrastructure-changes/rules.md): cómo se propone y aplica un cambio, rutas del API Gateway.

## Fuera de los temas

- **¿Ya nos pasó?** [knowledge/traps/traps.md](knowledge/traps/traps.md): las trampas `F-xx`, se entra por el índice de síntomas.
- **El porqué del negocio, según Jira** (intenciones, no código): [knowledge/business-context.md](knowledge/business-context.md).
- **Qué se quiere y qué se decidió** (cosas dichas, no medidas): [knowledge/meetings/weekly-ct.md](knowledge/meetings/weekly-ct.md).

## Cómo se mantiene

Un tema nuevo, renombrado o con secciones nuevas se suma acá en el mismo commit, en el paso donde ocurre.
`make knowledge-index` comprueba que cada `tema#ancla` de este archivo exista y lista los temas que no aparecen.
