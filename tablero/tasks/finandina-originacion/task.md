---
id: 107
title: "Finandina: originación completa en Creditop"
stage: evaluation
created: "2026-10-28T10:38:26-05:00"
knowledge: [lender-response-types, lender-credential-sources, lender-listing, field-scoring-policy, creditopx-quota, kyc-pipeline, identity-name-validation, credifamilia-origination]
canon: [perfilamiento/context, creditopx/context, listado/context, documentos/context, entidad/context, formalizacion/context]
jira: [CORE-845]
jira_title: "Finandina: originación completa en Creditop"
ramas: legacy-backend:finandina-originacion
---

## Pendientes

El plan va por fases, y cada requisito está trazado a su documento en
`artifacts/finandina-matriz-requisitos.md`. Las fases 1 y 2 se pueden hacer sin esperar a producto; la 3 en
adelante depende de las respuestas de la fase 0.

### Hecho

- [x] ~~Ligar la tarea a un issue de Jira~~ — CORE-845 (CORE Sprint 21).
- [x] ~~Generalizar el riel 4~~ — CORE-918 (#109), en qa desde el 2026-11-03.
- [x] ~~Sacar del riel 4 los textos que dicen Credifamilia~~ — CORE-918 (legacy-backend 9081bb7fb).
- [x] ~~Armar Finandina en local como entidad del riel 4~~ — comercio «Finandina Pruebas»
  (`harness/merchant-specs/finandina.json`) y la 149 con `artifacts/finandina-local-149.sql`.
- [x] ~~Llegar a 11 sin formalización en local~~ — fuente de insumos `lender_configuration` y plan por la entidad
  de la solicitud (legacy-backend 519495056, rama local `feat/finandina-originacion-delegada`). Suite
  `harness/suites/finandina.json` 3 de 3; Salud y Materiales siguen 3 de 3 con radicación.
- [x] ~~Releer los documentos requisito por requisito~~ — PRD, diagrama, política, formulario, T&C, mapa de
  campos y notas: `artifacts/finandina-matriz-requisitos.md`, y el resumen con la comparación con Credifamilia
  y el plan en `artifacts/finandina-analisis-documentos.html`.

### Fase 0 · Decisiones de producto (bloquean las fases 3 a 5)

- [ ] Mandar la ronda 1 de preguntas (las que bloquean empezar): qué documento manda (PRD de enero o política
  de agosto), cómo se compara la capacidad de pago con la cuota, de dónde salen las letras de riesgo AA…Z, y con
  qué cuenta se consulta el buró (si es la de Finandina, el certificado de cliente de Experian). Termina con las
  cuatro respondidas por escrito en «Objetivo». El mensaje está redactado y sin enviar en
  `artifacts/finandina-ronda-1-mensaje.md`. Depende de: producto (Maria Fernanda Parra) y Finandina.
- [ ] Después, la ronda 2 (desembolso, entrega de la operación, FGA, seguros y costos, Deceval y diseño) y la
  ronda 3 (independientes, experiencia, cobertura, Mareigua, identidad, límites y arranque), que arranca con
  los supuestos escritos en el análisis publicado. Depende de: producto.
- [ ] Decidir qué significa «autorizada» para Finandina y cómo se le entrega la operación: el diagrama habla de
  aviso automático, dashboard semanal y PQR masiva. Termina con el estado final y el canal. Depende de:
  producto — el acuerdo con Finandina.
- [ ] Conseguir el diseño de las pantallas (el PRD pide «UX alineado con Figma» y no lo enlaza). Depende de:
  producto.

### Fase 1 · Decisión de crédito en el motor (sin esperar a producto, con valores provisionales)

- [ ] Conectar la preaprobación de la 149 al motor de cupo: la clave de Finandina hacia `creditop_x` en
  pre-approvals-service (en local, el alias en el mock) y la fuente de insumos tomando el cupo del cliente en vez
  del tope de la línea. ⚠ Falta decidir qué campo es «el cupo del cliente». **No es
  `users_category_log.current_available_amount`**: esa es la bolsa mensual del perfil, no el cupo de la persona
  (`knowledge/creditopx-quota`). Los candidatos son el `max_amount` de la categoría o lo que devuelve
  `available-quota`; se elige antes de escribir la clase. Termina con un caso aprobado con cupo menor que
  15 MM y uno rechazado, en local.
- [ ] Decidir sobre qué score se aplica el corte 646. La política pide Experian Advance 1.1, y el motor
  (`DatacreditoRuleEvaluator`) evalúa el promedio de los modelos del HDC+ (`Experian.php:547`). Con el corte
  sobre ese promedio se aprueba o rechaza con otro número. Termina con la decisión escrita y, si es leer el
  Advance 1.1, con su pendiente de código.
  Depende de: producto / Finandina — si el promedio es aceptable o se lee el Advance 1.1.
- [ ] Cargar en las categorías del motor lo que ya existe como criterio: edad 21–64, ocupación empleado o
  pensionado, ingreso ≥ 1 SMMLV, antigüedad 6 meses, experiencia de 12 meses, y score 646 con score 0. Termina
  con un caso fuera de política por cada criterio rechazado por la preaprobación (las reglas del listado no
  rechazan en el riel 4).
- [ ] Hacer configurable cuántas fechas de pago se ofrecen (`DATES_TO_RETURN = 2` en
  `PaymentPlanDatesService`), para que Finandina muestre 5, 10, 15 y 20 sin cambiar Credifamilia. Termina con
  las cuatro fechas en la 149 y las dos de siempre en Salud.
- [ ] Revisar con la 149 los huecos de CORE-918 fuera del plan: pagaré y documentos de Credifamilia por
  `CredifamiliaLenders::engineLenderIdFor`, 500 sin perfil, y firma Netco sin SigningV1. Termina con cada uno
  corregido o descartado.

### Fase 2 · Política que no existe (diseño técnico ya, valores cuando responda producto)

- [ ] Capacidad de pago de Finandina: gastos (Tabla 1) y descuentos de ley (Tabla 2) por SMMLV, cuota real y
  potencial por tipo de cartera (Tabla 3, con SBG y la regla del 50 %), tasa de modelación configurable y
  componentes persistidos para auditoría. Termina con el cálculo de un caso conocido igual al de una planilla.
- [ ] Veces el ingreso por segmento de riesgo y SMMLV. Depende de: fase 0 (origen del segmento y la fila AA).
- [ ] Cobertura por código DANE con las 99 zonas de la Tabla 5 (normalizadas a 5 dígitos, Bosa corregida), y la
  captura de la ciudad de residencia. Termina con un caso fuera de zona rechazado.
- [ ] Riesgo del empleador de Mareigua (alto y «document» rechazan) y experiencia por monto (≥ 3 MM, 48 meses;
  sin experiencia, tope 5 MM). Depende de: fase 0 para los estados no concluyentes y la regla de experiencia.
- [ ] Límites: 2 créditos al mes por cliente y tope de desembolsos por entidad. Depende de: fase 0 (alcance y
  ventana).
- [ ] FGA por score (5 % con ≥ 856, 9 % el resto) y si el IVA va dentro del porcentaje. Depende de: fase 0.

### Fase 3 · Documentos, firma y pagaré

- [ ] Agregar al formulario dinámico de la 149 dirección, ciudad, departamento, PEP A y PEP B, y, si responde
  «Sí», la entidad y las fechas.
- [ ] Plantillas del formulario de vinculación (24 marcadores) y de los T&C (15), con los montos en letras y las
  observaciones del mapa resueltas (PEP con marcadores propios, monto del aval en el formulario, segundo nombre,
  fecha y ciudad de firma). Termina con los tres documentos generados para una solicitud local con todos los
  datos llenos. Depende de: fase 0 (Protección Financiera, libranza, desembolso, versión final de los T&C).
- [ ] Pagaré en Deceval con la credencial real de Finandina y la certificación. Depende de: Hans — CRED-463.

### Fase 4 · Entrega a Finandina y después del 11

- [ ] Clase de formalización de Finandina: el aviso o payload con confirmación de recepción y manejo de errores.
  Depende de: fase 0 (canal y estado).
- [ ] La vista o export para el analista de Finandina (préstamos de la semana, valor a girar) y la vista del
  comercio en el admin. Depende de: fase 0.
- [ ] Pantalla final y mensaje de rechazo. Depende de: diseño.

### Fase 5 · Credenciales y salida a qa

- [x] Consultar Mareigua en el onboarding con la cuenta de una entidad de la sucursal (lo pidió Oscar el
  2026-11-12): si alguna entidad activa de la sucursal tiene credencial de Mareigua, **la primera por id**
  (como `DocumentTypesService::resolver` junta los tipos de documento); si ninguna, la de config. Guarda el
  `credential_id` en el request, como ADO, y deja en el log la sucursal, las entidades con cuenta y la elegida.
  Probado de punta a punta en local. Fuera: mobile (su comando no trae sucursal), application y el Experian HC2.
- [ ] Decidir si el comercio puede elegir qué entidad paga la consulta (o usar la de Creditop teniendo
  entidades con cuenta). Por ahora no: decisión de Miguel del 2026-11-12. Depende de: Miguel y Oscar.
- [x] Decidir si una consulta de Mareigua del último mes hecha con la cuenta de Creditop se reutiliza en una
  sucursal de Finandina: sí, se usa la guardada (Oscar, 2026-11-12). La cuenta de la entidad sólo se usa cuando
  hay que consultar: sin dato o con más de un mes.
- [ ] Confirmar CUÁNDO se consulta con las llaves de Finandina: el PRD («10. Flujo funcional») y el diagrama la
  ponen después de que el cliente elige Finandina, y el código la hace antes, en toda sucursal donde está
  asignada (lo hablado con Finandina, sin escrito). Termina con la respuesta por escrito. Depende de: producto o
  Finandina.
- [ ] Revisar el consentimiento del onboarding en las sucursales donde la consulta sale con la cuenta de
  Finandina, antes de elegir entidad: el formulario la pone como responsable de los datos (PRD-72). Depende de:
  producto.
- [ ] Que la consulta nueva de Experian lea la credencial que elige el resolvedor (RKV2TD024). Para Finandina
  además hace falta el cliente HC2 (siguiente casilla).
- [ ] Integrar la consulta de Experian de Finandina: sus llaves de prueba son del servicio SOAP HC2
  (`DHServicePlus`, `consultarHC2`, producto 64, usuario = NIT y clave corta), que ningún repo implementa; el
  Experian de Creditop es el REST con OAuth. Termina con una consulta HC2 en el ambiente demo de Experian
  desde local y su respuesta convertida a lo que lee el motor. Depende de: Finandina — el certificado de cliente
  (el servidor demo exige TLS mutuo), su clave y si hay que autorizar la IP de salida; y la decisión de las cuentas.
- [ ] Cargar las llaves desde el admin en la base compartida: las de prueba (Experian HC2 y Mareigua «Validador
  I/E») están en `connectors/.env.finandina`, sin versionar, y se siguen usando las que entregó Finandina; las
  de Deceval todavía no llegaron. Depende de: producto — las de Deceval.
- [ ] Avisar al equipo de `POST /api/onboarding/credentials/get-by-lender`: devuelve credenciales descifradas
  sin autenticación; lo agregó Santiago (2025-12-15) y lo usa pre-approvals-service por la red interna. Termina
  con la exposición confirmada o descartada, o con el endpoint protegido.
- [ ] Un PR por repo contra `qa` con todo lo de la tarea, la 149 configurada en la base compartida para un
  comercio de prueba, y la validación de Duncan. Termina con la suite verde en qa.
- [ ] Definir quién monitorea que el motor sea «espejo» de la política, y con qué reporte. Depende de: producto.

## Objetivo

Que Banco Finandina se ofrezca como crédito de libre inversión en los comercios de la fase 1 con originación
completa en Creditop: Creditop valida identidad y riesgo con las llaves de Finandina, aplica su política,
calcula la capacidad de pago, decide, muestra las condiciones, hace firmar los documentos y le entrega la
operación aprobada a Finandina, que desembolsa y administra cartera, recaudo y cobranza. Las políticas deben
quedar «espejo» de las de Finandina, con monitoreo.

### La política, regla por regla (agosto 2026; entre paréntesis lo que difiere en el PRD de enero)

- **Perfil:** persona natural con cédula; 21 a 64 años; empleados (CIIU 0010) y pensionados (CIIU 0020), sin
  independientes; ingresos desde 1 SMMLV; empleados con 6 meses de antigüedad (confirmada por Mareigua),
  pensionados sin mínimo.
- **Cobertura:** sólo los municipios de la «Tabla 5: zonas financiables» (unos 100, con código DANE: área
  metropolitana de Medellín, Bogotá y Sabana, Boyacá, Caldas, Cauca, Huila, Meta, Nariño, Eje Cafetero,
  Santander, Tolima y Valle).
- **Experiencia crediticia:** carteras de más de 12 meses en entidades vigiladas con al menos una obligación de
  3 MM, o deudas vigentes o canceladas hace ≤ 48 meses por ≥ 3 MM. Sin experiencia: máximo 5 MM.
- **Score:** Experian Advance 1.1 con corte 646 (antes 756); también se aceptan clientes con score 0. (El PRD
  no trae score.)
- **Mareigua** (PRD): se usa el riesgo del empleador; se aceptan riesgo bajo y medio, se rechazan alto y
  «document».
- **Producto:** monto 3–15 MM (PRD: 1–15 MM); plazo 6–36 meses; tasa que se actualiza cada mes; ticket
  promedio 5 MM; seguro de vida 1.660 por millón desembolsado; aval FGA 5 % con Advance ≥ 856 y 9 % para el
  resto.
- **Monto según riesgo:** de 3 a 10 veces el ingreso (PRD: 3 a 16), sin pasar el máximo, según el segmento de
  riesgo y el ingreso en SMMLV:

  | riesgo | 1–1,5 | 1,5–2 | 2–4 | >4 |
  |---|---|---|---|---|
  | AA (1.ª fila) | 7 | 8 | 10 | 0 |
  | AA (2.ª fila) | 7 | 8 | 10 | 10 |
  | B, C | 5 | 6 | 8 | 8 |
  | S | 4 | 5 | 7 | 8 |
  | Y | 3 | 4 | 6 | 7 |
  | YG, YZ, Z | 0 | 0 | 0 | 0 |

- **Límites:** no más de 2 créditos por Creditop al mes por cliente; tope de desembolsos de Creditop de
  2.000 MM al mes (PRD: 500 MM al día). PRD además: sin compra de cartera ni retanqueos; no clientes con 2
  obligaciones activas de libre inversión con Finandina; si ya tiene una, mínimo 3 cuotas pagas.
- **Capacidad de pago** = ingresos (Mareigua o SOI) − gastos personales − descuentos de ley − cuotas
  financieras, con la tasa de modelación del mes (PRD: 1,79 %), configurable y auditable:
  - gastos personales por ingreso en SMMLV: < 1: 0 %; 1–3: 65 %; 3–4: 60 %; 4–5: 55 %; 5–6: 45 %; 6–10: 40 %;
    ≥ 10: 30 %;
  - descuentos de ley: 8 % con ingreso < 4 SMMLV, 9 % desde 4 (igual para empleado y pensionado);
  - cuotas financieras = máximo entre la cuota real y la potencial de cada obligación del buró («Tabla 3»):
    - **reales:** por tipo de cartera (TDC, CBR, CAU, CAB, COF, CFE, COC, CCL, CCF, CBM, CSA, LBZ, EDU, SFI,
      CON, MCR) se toma la cuota si es menor que el saldo, y el saldo si no; en cooperativas y vivienda (CAC,
      CAV) se suma el 50 % de la cuota o del saldo con la misma regla;
    - **potenciales:** igual, salvo tarjetas de crédito y cartera rotativa (TDC, CBR), que valen
      cupo × 0,022 + cupo / 24, y sobregiros (SBG), que toman el saldo si supera el cupo inicial y si no el cupo.
- **Identidad:** ADO (biometría de rostro, huella e iris, listas restrictivas y prevención de fraude).
- **Pagaré:** digital, con Banco Finandina como beneficiario, generado y custodiado en Deceval, válido por la
  Ley 527 para ser ejecutable.

### El flujo de la fase 1 (diagrama del Drive)

Cliente → app del aliado con los filtros (empleados, +21 años, +1 SMMLV, zonas) → ¿financia Finandina? →
acepta T&C → Mareigua + Experian con las llaves de Finandina y capacidad de pago → ¿aprobado? → validación de
identidad (biometría de Creditop, OTP y listas) → firma de formulario de vinculación, T&C y pagaré → Deceval
genera y custodia el pagaré de Finandina → desembolso en línea al comercio por Creditop → aviso automático a
Finandina → proceso manual de Finandina: su analista descarga del dashboard de Creditop los préstamos de la
semana, concilia el valor a pagar, envía el listado por PQR, y operaciones crea el préstamo, el seguro y hace
el giro al aliado.

### Los documentos que se firman

- **Formulario de vinculación** (Finandina, canal Creditop): datos personales, condiciones del crédito, modo de
  pago «pago en línea» con intermediario Creditop y subcomercio, débito automático, preguntas PEP, autorización
  de datos (Finandina responsable, Creditop encargado; ADO para biometría; Experian y PILA), origen de fondos,
  firma electrónica y pagaré desmaterializado en Deceval, canales de comunicación y pagos.
- **T&C del crédito de libre inversión:** tasa fija N.M.V. y E.A., mora máxima legal, cuota, aval (financiado,
  no se devuelve en prepago ni retracto), aplazamiento de hasta 3 cuotas al año desde el mes 6, libranza
  (Ley 1527), seguro de vida y Protección Financiera opcional, días de pago 5, 10, 15 o 20, medios de
  desembolso. El documento numera dos veces el «8».
- **Mapa de campos** (`Campos_dinamicos_documentos_formalizacion.xlsx`, versión 27-10): 24 marcadores del
  formulario y 15 de los T&C, con su cruce. Pide agregar al formulario dinámico dirección, ciudad y
  departamento de residencia, empleador y las dos preguntas PEP; actividad económica de los códigos de
  Finandina; validar la razón social con Mareigua y Ágil Data; la Protección Financiera va fija en «N/A».

## Dónde se toca

### Modelo de la entidad: tipo 4

El riel lo define de quién es la política (`knowledge/lender-response-types`):
con los tipos 2 y 3 Creditop define cómo se presta; con 0, 1 y 4 la entidad lo dice. Finandina nos entrega su
política para que la apliquemos, la firma va por nuestros rieles y la cartera es suya: **tipo 4**.

La 149 hoy es `response_type = 1`, `product = credit`, sin `promissory_type_id` para Finandina, sin reglas ni
comercios (prod y local). Lo que el tipo 4 trae y lo que le falta (legacy-backend `origin/main` 174120193):

- **Decisión:** el asistente pide la preaprobación por el `slug` (`banco-finandina`), que pre-approvals-service
  no conoce. El motor de cupo (`CreditopXQuotaController`) acepta un tipo 4, así que la clave de Finandina
  puede apuntar al adaptador `creditop_x` y decidir con la política cargada en categorías y reglas.
- **Listado:** las reglas duras no sacan a un tipo 4 (`LenderValidationService::dropsWhenRulesFail`): queda con
  «Probabilidad muy baja». La política tiene que expresarse en la preaprobación.
- **Plan de pago (resuelto por CORE-918, en qa):** opciones, fechas, cuotas, resumen y comprobante van por
  `payment-plan/{slug}/…` y leen el perfil de la entidad en `delegated_origination_profiles` (días de pago,
  origen de la fianza, 4x1000, fuente de insumos, formalización). Sumar Finandina es una fila de perfil y una
  clase de insumos; la entidad tiene que tener slug propio, porque `findBySlug` toma la primera.
- **Formalización al autorizar:** `LoanAuthorizationService` usa la clase que nombra el perfil (registro
  `DelegatedOriginationFormalizations`). Sin formalización la solicitud llega a 11 sin radicar y lo deja en el
  log: Finandina puede llegar a 11 antes de que exista su entrega, que será su clase de formalización.
- **Credencial:** los tipos 1 y 4 exigen credencial propia en el punto de venta (`LenderIntegrationRules`).
- `application` no tiene ramas del tipo 4: el piloto lo atiende el backend modular.

Cadena del cupo en legacy-backend (`Modules/Loans/App/Http/Controllers/Customer/CreditopXQuotaController.php`):
crédito activo (`ActiveCreditRuleEvaluator`) → `lender_rules` (`LenderRuleEvaluator`) → buró
(`DatacreditoRuleEvaluator`, score con `allow_0_score`) → categoría (`LenderUserCategoryService`). Sin
categoría no aparece y autorizar da 422; al autorizar se carga el cupo mensual del perfil (`knowledge/creditopx-quota`).

### Regla → mecanismo (legacy-backend `origin/main` c03edaff, application 24dc86eb)

| regla | veredicto | dónde |
|---|---|---|
| cédula | config | tipos de documento de la sucursal (`lenders_by_allied_branches.document_types`) |
| edad 21–64 | config | `lender_users_category_rules.min_age/max_age` (`LenderUserCategoryService.php:590`) |
| empleado o pensionado | config | criterio `occupation` sobre el campo 29 (`:573`); CIIU sólo existe en la radicación de Credifamilia |
| ingreso ≥ 1 SMMLV | config en LB, roto en APP | `monthly_income` en pesos (`:595`, hay que actualizarlo cada año); APP compara una columna `min_income` que no existe y siempre pasa |
| ingreso confirmado por Mareigua | parcial | `MonthlyIncomeResolver`: Ágil Data → Mareigua → Quanto, y cae al declarado; no se puede exigir sólo Mareigua |
| antigüedad 6 meses | parcial | `employment_continuity` (`:601`), sale de Ágil Data o Mareigua: si responde Ágil Data no se mira Mareigua |
| riesgo del empleador (Mareigua) | nuevo | viene en la respuesta (`nivel_riesgo`) y ningún código lo lee |
| cobertura por municipio | nuevo | `cities_by_lender` existe y nadie la lee; la ciudad se guarda por nombre y casi no se captura; `country_cities.code` tiene el DANE |
| experiencia > 12 meses | config | `financial_history_length` (`:699`) o `time_finance_sector` |
| obligación ≥ 3 MM / deudas ≤ 48 meses | nuevo | `min_vigent_obligations` cuenta obligaciones, no monto |
| sin experiencia máx. 5 MM | parcial | categoría aparte con `max_amount`; no hay criterio «sin experiencia» |
| score 646 y score 0 | parcial | `lender_datacredito_rules.score` + `allow_0_score` (`DatacreditoRuleEvaluator.php:86`). ⚠ el score es el PROMEDIO de los modelos del HDC+ (`Experian.php:547`), no el Advance 1.1 filtrado |
| veces el ingreso por riesgo | nuevo | segmentos AA…Z no existen; `available_amount_multiplier` multiplica la capacidad, no el ingreso, y no tiene piso |
| capacidad de pago | parcial | `life_percentage` plano por categoría (`:1374`); las cuotas son las de Experian con el ajuste de CreditopX (descuenta el 70 % de tarjetas, `:1296`); no existe cuota potencial |
| tasa de modelación | parcial | el cupo usa `creditLines->rate` (`:1367`); la de la categoría sólo cambia la tasa mostrada |
| auditable | parcial | `users_category_log` guarda el cupo y los criterios, no los componentes del cálculo |
| monto, plazo, tasa | config | `credit_line_by_lenders` y `max_amount`/`max_fee_number` de la categoría |
| seguro 1.660 por millón | config | `lenders_by_allied.insurance_percentage_per_million`, por comercio |
| FGA 5 % / 9 % por score | config (combinatorio) | `lender_users_categories.FGA` con una regla `min_score=856` primero; multiplica las categorías con la tabla de riesgo; hoy entra al capital |
| 2 créditos al mes por cliente | nuevo | no existe; `ActiveCreditRepository` sólo cuenta CreditopX (`l.response_type = 2`, `creditop_x_requests_history.status = 1`): un crédito de Finandina por el riel 4 no entra, termine donde termine (las solicitudes llegan a 11, ver la receta) |
| tope de desembolsos (mes o día) | nuevo | el cupo mensual es por perfil, no por entidad; no hay tope diario |
| obligaciones con Finandina | externo | sólo Finandina lo sabe con certeza; el HDC+ trae la entidad de cada obligación pero ningún criterio la filtra |
| identidad ADO | config | `lender_identity_validation_types` de la entidad; `requires_restrictive_list_check` no lo lee nadie |
| pagaré Deceval a Finandina | config + externo | credencial de tipo entidad en `risk_central_credentials` (`DecevalSoap.php:251,441`), como Credifamilia y DFS |
| formulario y T&C | config + plantillas | filas en `lender_signing_documents` con generador blade (como Alta Fleet) y plantillas nuevas |
| entrega a Finandina | nuevo | al autorizar sólo se le avisa al cliente (`NotificationService.php:129`) |

### Credenciales de la entidad (legacy-backend `origin/main` 69920f580)

Detalle de tablas y orden de búsqueda en `knowledge/lender-credential-sources`. Lo que cambia para Finandina:

| central | ¿acepta una cuenta por entidad? | dónde |
|---|---|---|
| Experian, consulta vieja | sí: busca primero la fila de la entidad en `risk_central_credentials` y cae a comercio, sucursal y config | `app/Actions/RiskCentrals/Experian.php:73`; sólo una ruta la llama con entidad (`DatacreditoQueryByAlliedController.php:472`) |
| Experian, pipeline nuevo (Acierta) | no: lee sólo config | `Modules/RiskV2/App/Http/Clients/ExperianAciertaClient.php:136`, deuda `RKV2TD024` |
| Mareigua | no: una sola cuenta, global, en los dos clientes | `config/services.php:289`, `app/Actions/RiskCentrals/Mareigua.php:192`, `Modules/RiskV2/App/Http/Clients/MareiguaClient.php:206` |
| Deceval | sí, sólo en legacy-backend; si falta, cae a comercio o sucursal | `RiskCentralCredential.php:82`, `Modules/Loans/App/Actions/DecevalSoap.php:55` |
| ADO | sí: la entidad primero, luego config | `app/Actions/RiskCentrals/Ado.php:47` |
| la propia entidad (API) | sí, por sucursal o comercio, en `lender_allied_credentials` | `LenderAlliedCredential::findOrFailByLenderAndAlly` |

- Además, los datos del buró se guardan por cliente y el pipeline no vuelve a consultar si ya hay un dato
  vigente (`CheckExperianTriggerService.php:361`). Una consulta con la llave de Finandina tiene que pedirse
  aparte, aunque el cliente ya tenga la de Creditop.
- En prod hay precedentes de credencial colgada de una entidad: ADO (CreditopX 37, Motai X 62, SmartPay 160),
  Deceval (Credifamilia 24, DFS 181) y un Experian de Credifamilia, hoy borrado.
- **Cómo se cargan hoy:** desde el admin de legacy-application (`credenciales` para la entidad,
  `risk-central/credenciales` para las centrales), que cifra el JSON. Las listas de llaves son sólo sugerencia,
  y no traen Deceval ni Mareigua. El backoffice de legacy-backend (`PUT {lender}/config/credentials`) sólo
  escribe las de Wompi. No hay vencimiento en ninguna tabla.

### Trampas para tener en cuenta

- Deceval en legacy-backend busca la credencial de la entidad y, si falta, cae a la del comercio o la sucursal
  (`RiskCentralCredential.php:86-108`): un pagaré podría salir a nombre de otro emisor sin error. application
  no usa la credencial de la entidad (`app/Actions/DecevalSoap.php:56`).
- Con el tipo 4, fallar `lender_rules` no la saca del listado: sólo la preaprobación la rechaza.
- Por la cascada de KYC, Mareigua sólo se consulta si Ágil Data no trae datos: para esos clientes no hay
  ingreso, antigüedad ni riesgo del empleador de Mareigua.
- La antigüedad en el sector es «<» en el cupo y «<=» en el listado; el criterio de género excluye si la regla
  no lista todos los valores.
- Cargar tabla de riesgo × ingreso × FGA en categorías multiplica las filas, y el cupo mensual se reparte por
  fila, no por entidad.

## Cómo se ataca

1. **Armar Finandina en local, sobre el riel ya generalizado (CORE-918):** la 149 con `response_type = 4`,
   `promissory_type_id = 2` y slug propio; su perfil en `delegated_origination_profiles`; línea de crédito,
   categorías con edad, ocupación, ingreso, antigüedad, experiencia y FGA; regla de buró con score y
   `allow_0_score`; seguro por comercio; identidad ADO; un comercio de prueba con la 149 asignada y credencial.
   Se empieza en local y no en la base compartida para no mostrar la 149 a nadie antes de tiempo.
2. **Su fuente de insumos y la decisión:** la clase de insumos de Finandina sobre el motor de cupo, y la clave
   de Finandina en pre-approvals-service hacia ese motor. Probar con el arnés un caso dentro y otro fuera de
   política, y llegar a 11 sin formalización.
3. **Cerrar las decisiones de producto** (política vigente, estado al autorizar, entrega a Finandina, FGA, días
   de pago, con qué cuenta se consulta el buró).
4. **Credenciales:** las llaves llegan por un canal seguro y se cargan desde el admin como credencial de la 149
   (Deceval y ADO ya la leen). Si la consulta va con la cuenta de Finandina, Experian del pipeline nuevo y
   Mareigua necesitan leer la credencial de la entidad.
5. **Formalización de Finandina:** su clase de formalización (la entrega de la operación), el pagaré con su
   credencial de Deceval, y el formulario y los T&C.
6. **Construir la política que falta:** capacidad de pago de Finandina (gastos y ley por SMMLV, cuota potencial,
   tasa de modelación) con los componentes persistidos; veces el ingreso por segmento; experiencia por monto;
   riesgo del empleador; cobertura por DANE; límite de 2 al mes; tope de desembolsos por entidad.

## Lo que se evaluó y NO se eligió

- **`response_type = 2` con `externally_serviced = 1`** (lo que se propuso el 28-10): decide sin código nuevo,
  pero es el riel de la política de Creditop con cartera de otro (DENTIX, DFS, Alta Fleet). Finandina dicta su
  política y origina con su nombre; además no hay dónde enchufar la entrega de la operación, y autorizar cancela
  las otras solicitudes pendientes del cliente. El criterio lo corrigieron Laura y Joel.
- **`response_type = 1` (externa):** Finandina no tiene una API que decida ni firma en su propio flujo.
- **Que la entidad cargue sus llaves en un portal propio** (extender el backoffice, que hoy sólo escribe las de
  Wompi): evita que alguien de Creditop las vea, pero no hay portal de entidades en uso ni una segunda entidad
  que lo pida. Para la fase 1 alcanza con el admin y un canal seguro; se reconsidera si las entidades del riel
  4 se multiplican.
- **Guardar las llaves en un gestor de secretos y sólo la referencia en la base:** ninguna integración lee de
  ahí, y las dos tablas de credenciales ya cifran con la llave de la app.
- **La guía de Confluence «Integración originación en línea»:** describe el modelo externo (la entidad crea la
  orden, le manda un enlace al cliente y avisa por webhook). No es el modelo de Finandina.

## Lo que NO entra

- Cartera, recaudo y cobranza: son de Finandina.
- Compra de cartera y retanqueos.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

**En local (verificado el 2026-11-03).** Se arma con:

    make harness-merchant MERCHANT=finandina
    docker exec -i legacy-backend-mysql-1 sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" creditop' < tablero/tasks/finandina-originacion/artifacts/finandina-local-149.sql

más la credencial de entidad y la de Deceval de prueba (cifradas, por tinker: ver la cabecera del SQL y la pila).
Se comprueba con:

    make harness-suite SUITE=harness/suites/finandina.json CLOSE=1 LAMBDA=1 TARGET=local
    curl -s localhost/api/onboarding/payment-plan/banco-finandina/payment-plan-summary/<uReq>

Lo que tiene que dar: 3 de 3 en 11 sin radicación; en el resumen, tasa 1,79 % N.M., FGA 0,09 con IVA, 4x1000 en
0, seguro de 1.660 por millón y día de pago 5. Salud (`credifamilia.json`) y Materiales
(`credifamilia-materiales.json`) siguen cerrando con radicación.

Falta: un caso fuera de política (necesita la preaprobación por el motor de cupo) y un ambiente compartido.

## Referencias

- Análisis de los documentos, Credifamilia frente a Finandina y plan de acción:
  `artifacts/finandina-analisis-documentos.html`, publicado en https://claude.ai/artifact/9o1MPrSEKsN9vTU7DKiT5L
  (privado). La traza línea a línea: `artifacts/finandina-matriz-requisitos.md`.
- PRD «PRD – Integración Banco Finandina» (Google Doc `1utJdnxfmL8Zre7ihll6Zvq9VraA57JDQpopGYybgUb0`).
- Carpeta de Drive «Finandina» (`17AcO2PoM2U_5MCzpFtvA9bJDbbTwc0th`): «Politicas Creditop.pdf» (la Tabla 3 es
  una imagen en la página 4), `image.png` (el flujo), y «Documentos formalización de crédito» con el formulario,
  los T&C y el mapa de campos (`1WOLprjW9qvsqHhDy1Ah555Pyff7Y5oKa`, 27-10; hay otra versión del 23-10 en la
  raíz). ⚠ `Archivos_credenciales`, `Credenciales de pruebas Experian.docx` y `Mareigua.png` tienen
  credenciales: no se copian.
- Slack: `#finandina` (pendientes de llaves, CONFE y Deceval, enero–febrero) y el hilo del PRD en `#producto-tech`.
- Jira: CORE-845 (la tarea); relacionados: CXCM-533, CXCM-521 (políticas de entidades especiales), CRED-463
  (certificación de Deceval).
- Conocimiento: `knowledge/lender-response-types`, `lender-listing`, `field-scoring-policy`, `creditopx-quota`, `kyc-pipeline`,
  `identity-name-validation`; en canon, `perfilamiento/context` y `creditopx/context`.

## Tarea (publicable)

## En una línea
Ofrecer el crédito de libre inversión de Banco Finandina en los comercios aliados, con toda la originación hecha por Creditop bajo la política de Finandina.

## Por qué
Finandina financia tickets altos que hoy no tienen una opción de libre inversión en el agregador. Para que salga, Creditop tiene que validar, decidir y formalizar el crédito con las reglas y las llaves de Finandina, y entregarle la operación para que desembolse.

## Qué cambia
- Finandina aparece como opción de financiamiento en los comercios habilitados.
- La decisión aplica la política de Finandina: edad, ocupación, ingresos, antigüedad, experiencia crediticia, capacidad de pago y montos.
- El cliente firma el formulario de vinculación, los términos y condiciones y el pagaré a favor de Finandina.
- La operación aprobada se entrega a Finandina para el desembolso.

## Alcance
No incluye cartera, recaudo ni cobranza, que siguen en Finandina, ni compra de cartera o retanqueos.

## Dónde probar
Por definir cuando la entidad esté configurada en un ambiente de prueba.

## Cómo validar
Por definir.

## Criterios de aceptación
- Un cliente que cumple la política ve la oferta de Finandina con monto, plazo y cuota dentro de los límites.
- Un cliente que no la cumple no recibe oferta de Finandina.
- Los documentos firmados salen con los datos del cliente y del crédito completos.

## Dependencias / contraparte
Política vigente y llaves de Experian y Mareigua (producto y Finandina), certificación de Deceval, y el acuerdo de cómo se entrega la operación aprobada.
