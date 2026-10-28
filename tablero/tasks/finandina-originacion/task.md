---
id: 107
title: "Finandina: originación completa en Creditop"
stage: evaluation
created: "2026-10-28T10:38:26-05:00"
knowledge: [lender-listing, field-scoring-policy, creditopx-quota, kyc-pipeline, identity-name-validation, credifamilia-origination]
canon: [perfilamiento/context, creditopx/context, listado/context, documentos/context, entidad/context, formalizacion/context]
jira: [CORE-845]
jira_title: "Finandina: originación completa en Creditop"
---

## Pendientes

- [x] ~~Ligar la tarea a un issue de Jira~~ — CORE-845, creado en el sprint activo (CORE Sprint 21).

### Decisiones de producto (bloquean el diseño)

- [ ] Confirmar qué política está vigente: el PRD (enero) y la política (agosto) no coinciden en monto mínimo
  (1 MM / 3 MM), veces el ingreso (3–16 / 3–10 por riesgo), tope de desembolso (500 MM diario / 2.000 MM mensual)
  y en lo que agrega la de agosto (score 646, FGA por score, tabla de riesgo, CIIU). Termina con la versión
  elegida. Depende de: producto (Maria Fernanda Parra) — la política firmada con Finandina.
- [ ] Aclarar la tabla «veces el ingreso» de la política: tiene dos filas «AA» (la primera con 0 en «>4 SMMLV»),
  y no dice de dónde sale el segmento AA…Z (ningún repo lo conoce). Termina sabiendo qué fila es cuál y qué
  dato del buró da el segmento. Depende de: producto / riesgo de Finandina.
- [ ] Decidir qué significa «autorizada» para Finandina: hoy autorizar deja la solicitud en 11 (desembolsada) al
  firmar, y Finandina desembolsa después. Termina con la decisión: estado intermedio + confirmación del banco, o
  aceptar 11 al firmar. Depende de: producto.
- [ ] Definir cómo se entrega la operación aprobada a Finandina: el flujo de la fase 1 es manual (el analista de
  Finandina descarga del dashboard de Creditop, concilia y crea los préstamos por PQR masiva). Termina con qué
  ve o recibe Finandina (dashboard, archivo, aviso) y con qué datos. Depende de: producto — el acuerdo con Finandina.
- [ ] Confirmar si el aval (FGA) se financia dentro del capital (así lo hace hoy el motor de CreditopX) y quién
  lo cobra. Termina con la respuesta escrita en «Objetivo». Depende de: producto.
- [ ] Confirmar los días de pago: los T&C de Finandina ofrecen los días 5, 10, 15 o 20, y el corte mensual de
  CreditopX ofrece 5, 16 y 28 (un corte nuevo es código en los dos monolitos). Termina con los días elegidos y,
  si no coinciden con un corte existente, con su pendiente técnico. Depende de: producto.
- [ ] Confirmar la actividad económica: la política y el PRD excluyen independientes, pero el mapa de campos
  (versión 27-10) dice «Empleado, independiente y pensionado». Depende de: producto.

### Insumos de Finandina

- [ ] Confirmar qué llaves están entregadas (Experian y Mareigua de Finandina; en Drive hay archivos de
  credenciales de prueba) y cargarlas como credencial de la entidad en un ambiente de prueba. Depende de:
  producto — el traspaso de llaves.
- [ ] Destrabar la certificación de Deceval (CRED-463, bloqueada); termina con un pagaré con Finandina como
  primer beneficiario creado y firmado en certificación. Depende de: Hans — el motivo del bloqueo.
- [ ] Conseguir el diseño (Figma) de las pantallas que nombra el PRD. Depende de: producto.

### Trabajo técnico

- [ ] Configurar la 149 como CreditopX administrada afuera (ver «Cómo se ataca», paso 1) en un ambiente de
  prueba y comprobar con el arnés que aparece en el listado de un comercio de la fase 1 y que la rechaza con un
  cliente fuera de política.
- [ ] Resolver las observaciones del mapa de campos de los documentos: las dos preguntas PEP comparten el
  marcador `[SI/NO]`; si responde «Sí» no hay marcador para entidad y fechas; no hay segundo nombre; el aval no
  tiene monto. Termina con la plantilla corregida o cada observación descartada.

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

### Modelo de la entidad

La 149 hoy es `response_type = 1` (externa), `product = credit`, `promissory_type_id` sin definir para
Finandina, sin reglas ni comercios (prod y local). Con `response_type = 1` no hay quién decida:

- el asistente manda el slug (`banco-finandina`) como producto a pre-approvals-service, que sólo conoce las
  claves de su `factory.go` (Bancolombia, Sistecrédito, Meddipay, CreditopX, Welli, Prami, Credifamilia, BCP,
  Crédito365, Flamingo): habría que escribir un adaptador, y Finandina no tiene API de decisión;
- fallar `lender_rules` o categorías no la saca del listado (`knowledge/lender-listing`).

Con `response_type = 2` decide el motor de CreditopX, y `lenders.externally_serviced = 1` deja la cartera
afuera: el crédito nace en estado 8 «administrado externamente», sin pagos, cambios ni recordatorios en
Creditop. Precedente en prod: DENTIX (139), Credi ASYCO (155), DFS Ortodoncia (181) y Alta Fleet (199). El
`response_type = 4` (Credifamilia) no sirve de molde: decide afuera y su radicación está atada a sus ids.

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
| score 646 y score 0 | parcial | `lender_datacredito_rules.score` + `allow_0_score` (`DatacreditoRuleEvaluator.php:86`). ⚠ el score es el PROMEDIO de los modelos del HDC+ (`Experian.php:545`), no el Advance 1.1 filtrado |
| veces el ingreso por riesgo | nuevo | segmentos AA…Z no existen; `available_amount_multiplier` multiplica la capacidad, no el ingreso, y no tiene piso |
| capacidad de pago | parcial | `life_percentage` plano por categoría (`:1374`); las cuotas son las de Experian con el ajuste de CreditopX (descuenta el 70 % de tarjetas, `:1296`); no existe cuota potencial |
| tasa de modelación | parcial | el cupo usa `creditLines->rate` (`:1367`); la de la categoría sólo cambia la tasa mostrada |
| auditable | parcial | `users_category_log` guarda el cupo y los criterios, no los componentes del cálculo |
| monto, plazo, tasa | config | `credit_line_by_lenders` y `max_amount`/`max_fee_number` de la categoría |
| seguro 1.660 por millón | config | `lenders_by_allied.insurance_percentage_per_million`, por comercio |
| FGA 5 % / 9 % por score | config (combinatorio) | `lender_users_categories.FGA` con una regla `min_score=856` primero; multiplica las categorías con la tabla de riesgo; hoy entra al capital |
| 2 créditos al mes por cliente | nuevo | no existe; `ActiveCreditRepository` sólo mira créditos en estado 1 y los de Finandina quedarían en 8 |
| tope de desembolsos (mes o día) | nuevo | el cupo mensual es por perfil, no por entidad; no hay tope diario |
| obligaciones con Finandina | externo | sólo Finandina lo sabe con certeza; el HDC+ trae la entidad de cada obligación pero ningún criterio la filtra |
| identidad ADO | config | `lender_identity_validation_types` de la entidad; `requires_restrictive_list_check` no lo lee nadie |
| pagaré Deceval a Finandina | config + externo | credencial de tipo entidad en `risk_central_credentials` (`DecevalSoap.php:251,441`), como Credifamilia y DFS |
| formulario y T&C | config + plantillas | filas en `lender_signing_documents` con generador blade (como Alta Fleet) y plantillas nuevas |
| entrega a Finandina | nuevo | al autorizar sólo se le avisa al cliente (`NotificationService.php:129`) |

### Trampas para tener en cuenta

- Deceval en legacy-backend busca la credencial de la entidad y, si falta, cae a la del comercio o la sucursal
  (`RiskCentralCredential.php:86-108`): un pagaré podría salir a nombre de otro emisor sin error. application
  no usa la credencial de la entidad (`app/Actions/DecevalSoap.php:56`).
- Con `response_type = 2` el listado la muestra como «Probabilidad alta», y autorizarla cancela las otras
  solicitudes pendientes del cliente (`LoanAuthorizationService.php:228`).
- Por la cascada de KYC, Mareigua sólo se consulta si Ágil Data no trae datos: para esos clientes no hay
  ingreso, antigüedad ni riesgo del empleador de Mareigua.
- La antigüedad en el sector es «<» en el cupo y «<=» en el listado; el criterio de género excluye si la regla
  no lista todos los valores.
- Cargar tabla de riesgo × ingreso × FGA en categorías multiplica las filas, y el cupo mensual se reparte por
  fila, no por entidad.

## Cómo se ataca

1. **Configurar lo que ya existe** en un ambiente de prueba: 149 con `response_type = 2`,
   `externally_serviced = 1`, `promissory_type_id = 2`; línea de crédito (monto, plazo, tasa), categorías con
   edad, ocupación, ingreso, antigüedad, experiencia y FGA; regla de buró con score y `allow_0_score`; seguro
   por comercio; identidad ADO; asignación a los comercios de la fase 1. Probar con el arnés.
2. **Cerrar las decisiones de producto** (política vigente, estado al autorizar, entrega a Finandina, FGA).
3. **Construir lo que bloquea el flujo:** estado intermedio y confirmación de desembolso; entrega de la
   operación a Finandina; pagaré con la credencial de Finandina; documentos (catálogo y plantillas).
4. **Construir la política que falta:** capacidad de pago de Finandina (gastos y ley por SMMLV, cuota potencial,
   tasa de modelación) con los componentes persistidos; veces el ingreso por segmento; experiencia por monto;
   riesgo del empleador; cobertura por DANE; límite de 2 al mes; tope de desembolsos por entidad.

## Lo que se evaluó y NO se eligió

- **`response_type = 1` (externa):** Finandina no tiene una API que decida, pre-approvals-service no la conoce y
  las reglas no la sacan del listado. No sirve para que Creditop decida.
- **`response_type = 4` (como Credifamilia):** el proveedor decide en la preaprobación y la radicación SOAP está
  atada a los ids de Credifamilia. Sólo se reutiliza el patrón de formalizar después de autorizar.
- **La guía de Confluence «Integración originación en línea»:** describe el modelo externo (la entidad crea la
  orden, le manda un enlace al cliente y avisa por webhook). No es el modelo de Finandina.

## Lo que NO entra

- Cartera, recaudo y cobranza: son de Finandina.
- Compra de cartera y retanqueos.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

Pendiente: se arma cuando la 149 esté configurada en un ambiente de prueba (caso dentro y fuera de política
con el arnés, y el cupo que da el motor).

## Referencias

- PRD «PRD – Integración Banco Finandina» (Google Doc `1utJdnxfmL8Zre7ihll6Zvq9VraA57JDQpopGYybgUb0`).
- Carpeta de Drive «Finandina» (`17AcO2PoM2U_5MCzpFtvA9bJDbbTwc0th`): «Politicas Creditop.pdf» (la Tabla 3 es
  una imagen en la página 4), `image.png` (el flujo), y «Documentos formalización de crédito» con el formulario,
  los T&C y el mapa de campos (`1WOLprjW9qvsqHhDy1Ah555Pyff7Y5oKa`, 27-10; hay otra versión del 23-10 en la
  raíz). ⚠ `Archivos_credenciales`, `Credenciales de pruebas Experian.docx` y `Mareigua.png` tienen
  credenciales: no se copian.
- Slack: `#finandina` (pendientes de llaves, CONFE y Deceval, enero–febrero) y el hilo del PRD en `#producto-tech`.
- Jira: CORE-845 (la tarea); relacionados: CXCM-533, CXCM-521 (políticas de entidades especiales), CRED-463
  (certificación de Deceval).
- Conocimiento: `knowledge/lender-listing`, `field-scoring-policy`, `creditopx-quota`, `kyc-pipeline`,
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
