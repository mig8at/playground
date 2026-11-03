# Contexto de negocio según Jira

> **Qué es este archivo.** El porqué, el quién y el «hacia dónde» del negocio, sacados de Jira el
> 2026-11-02 (proyectos CORE, CRED, CXCM, LEN, LO, MER, REFCM, CACM, PIP y QC). **No es un tema de la
> biblioteca**: sus afirmaciones son intenciones, decisiones y casos que cuenta Jira, no comportamiento
> comprobado en el código. Lo verificado en `main` está en los temas (`make knowledge-map`); acá se marca
> **[código]** cuando una afirmación ya tiene su tema. Lo demás puede estar viejo: Jira no se actualiza
> solo, y los issues de 2024 describen una empresa anterior.
>
> Mapa técnico: [business-overview](business-overview/rules.md). Reglas por entidad:
> [lender-integrations](lender-integrations/rules.md).

## Quién trabaja en qué

| proyecto | qué es | vigencia |
|---|---|---|
| **CORE** | Loan Origination: el agregador (asesor, autogestión, ecommerce), integraciones de comercios y entidades, y soporte («PARCHEO») | may-2026 → hoy |
| **CRED** | CreditopX: cupo, cartera, pagos, rotativo, app móvil del lado del crédito | jun-2026 → hoy |
| **CXCM** | el tablero anterior de CreditopX (operación de cartera, políticas por comercio, Deceval, ADO, AML, Wompi, Trustonic) | jul-2025 → abr-2026 |
| **LEN** | integración y mantenimiento de entidades; conciliación; mensajería; ISO 27001 | |
| **LO** | plataforma de originación: el estrangulamiento de `application`, microservicios, app móvil, reportería | |
| **MER** | canales y comercios: Shopify, VTEX, Corbeta, ERP Siesa, Trustonic, catálogo de la app, código en tienda | |
| **CACM** | «Agregador» (jul–dic 2025): integración de entidades de terceros al marketplace | cerrado |
| **REFCM** | 316 casos de soporte `CAS-…` (nov-2025 → ene-2026) y el backlog histórico del refactor | cerrado |
| **PIP** | CRM comercial de comercios (2024) | histórico |
| **QC** | QA del refactor comercio por comercio, y fallas automáticas de originación | jun–ago 2026 |

Los proyectos de la app móvil (`TT`) y del backoffice (`BAC`) no son visibles con la cuenta del
playground.

## Comercios y entidades que más pesan

- **Comercios:** Sonría, Dentix y DFS, Mediarte, Odontofamily (salud y odontología); Amoblando
  Pullman / CrediPullman (cajas y ecommerce); Corbeta (Alkosto, K-TRONIX, Alkomprar) con
  Bancolombia; Motai (motos en renting y RTO); Refurbi; Celucambio, Credimovil, MyTech, HTC (celulares
  con bloqueo); Free Spirit; Crédito Directo X; SmartPay (República Dominicana); UMA/Triumph (motos).
- **Entidades:** Welli (cuatro variantes), Meddipay, Prami, Credifamilia, Bancolombia BNPL y Consumo,
  Addi, Sistecrédito, Crédito 365, Brilla, Lagobo, Davivienda, Nequi (cobro de contado), Banco de
  Bogotá, Crediteame (pendiente) y Banco Finandina (en curso, originación delegada).

## Cómo gana CreditOp (vigente a oct-2026)

Fuente: la herramienta `forecast` del playground del equipo (`Creditop-SAS/playground`, `tools/forecast`:
`README.md`, `revenue.js` y las semillas de `seeds/`, leídas en `origin/main` el 2026-11-02). Lleva la regla
del Excel de revenue de Fabi y las planillas «Tarifas .xlsx» cargadas en octubre de 2026. **No está en los
monolitos**: ni el SaaS ni las tasas viven en legacy-backend o application, sino en la base propia de
`forecast`. Lo que no se verificó queda marcado.

El ingreso de un comercio en un mes es la suma de tres componentes:

| componente | quién paga | cómo se calcula |
|---|---|---|
| **SaaS** | el comercio | una cuota mensual fija; si hay un pago registrado del mes, vale ése |
| **comisión del agregador** | la entidad que prestó (rt 0, 1 y 4: Welli, Addi, Meddipay, Credifamilia…) | `max(0, desembolsado − base mínima) × tasa`, por pareja comercio–entidad, cada mes |
| **comisión de CreditopX** | el comercio, que pone el capital (rt 2 y 3) | lo desembolsado con sus entidades CreditopX × la tasa CTX del comercio |

- **La tasa es por pareja comercio–entidad.** Sin tasa propia se usa la general del comercio (CTX o
  agregador); sin ninguna, ese monto no deja ingreso y la herramienta lo marca «sin tasa».
- **La base mínima** existe en pocos acuerdos del agregador: la comisión se cobra sólo sobre lo que pase de
  esa base, cada mes. El ejemplo de la planilla: Dentix con Welli.
- **Mucho volumen no es mucho ingreso.** En la planilla del agregador de oct-2026, 38 de 65 parejas tienen
  tasa 0 % (acuerdos sin comisión, no tasas que falten); las demás van de 0,5 % a 5 %, casi todas en 1 % o
  1,5 %. Las tasas CTX por comercio van de 0 % a 6 %, casi todas en 1 % o 3 % (Motai, 6 %).
- **Las metas de los KAM son de MONTO desembolsado** (agregador y CTX por separado) y de revenue (SaaS +
  agregador + CTX). Sin meta puesta, la de partida es el promedio real de los 3 meses cerrados anteriores.
- **Un desembolso se cuenta por `user_requests.disbursed_at`**, nunca por el estado 11, y los montos no se suman
  entre países.
- ⚠ **Sin confirmar:** `lenders_by_allieds.comission_percentage`, la comisión que guarda el back-office por
  comercio–entidad, **no** entra en el cálculo. No se sabe si es la que gana CreditOp, y donde coincide con
  la planilla, difiere (Welli con Sonría: 9 % frente a 1 %). La lista de entidades CTX (`response_type` 2 y
  3) también está pendiente de confirmar con comercial.

### Lo que agrega el Excel de revenue del Q4

Fuente: «Forecast_Rev_4Q_Resumen Rev JT FG» (Excel de comercial que compartió Miguel el 2026-11-02; hojas
Resumen, PIPELINE AJUSTADO 2026 y Forecast Actuales 4Q). Es una **proyección** para oct–dic de 2026, no lo cobrado.

- **Hay más líneas de ingreso que las tres de `forecast`.** El MRR del Resumen suma, además de SaaS, CTX y la
  comisión del agregador: **App** (la que más crece en la proyección: de ~16 a ~70 millones al mes), **intereses
  de créditos**, **gastos de cobranza**, **IC** y **facturación de recaudo y dispersión**. Las últimas cuatro van
  como montos fijos por mes, sin fórmula. Con todo, el MRR proyectado pasa de ~178 a ~310 millones de pesos
  (ARR de ~USD 1,1 M en diciembre, a TRM 3.300). ⚠ Qué es «IC» y qué cobra la App no lo dice el Excel.
- **Gastos de cobranza e intereses** son de la cartera CreditopX. El cargo de cobranza existe en el código: un
  monto fijo por tramo de días de mora, configurado por entidad y causado en la noche (ver
  [creditopx-portfolio-servicing](creditopx-portfolio-servicing/rules.md#gasto-de-cobranza-por-días-de-mora)).
  ⚠ Como en CreditopX el capital es del comercio, no está claro qué parte de esos cobros e intereses queda para
  CreditOp: el Excel sólo pone un monto fijo por mes.
- **Cómo proyecta la comisión del agregador:** `desembolsos del agregador × share TX × ~1,2 %`. El «share TX» es la
  parte del volumen del comercio que va por entidades que pagan comisión (Sonría: 35 %), y el 1,2 % es una
  comisión promedio de las entidades (1,5 % en el pipeline de comercios nuevos). `forecast` lo reemplazó por la
  tasa real de cada pareja comercio–entidad.
- **Comercios nuevos (pipeline):** cada uno lleva un potencial de desembolsos de agregador y de CTX, y entra con
  una rampa de **5 % → 40 % → 80 %** de ese potencial en sus tres primeros meses. En la proyección del Q4, los
  comercios existentes ponen la mayor parte de los desembolsos; los nuevos crecen hasta ~1/3 en diciembre.
- Cada comercio tiene una **calificación** comercial (Power customer, Potencial, …) y un KAM.

## Modelo comercial (2024, sin confirmar vigencia)

Del CRM de 2024 (PIP); conviene contrastarlo con Confluence o comercial antes de usarlo:

- SaaS por punto de venta más fee transaccional: plan básico de 99.000–150.000 por punto al mes,
  paquetes de 50 perfilaciones y 3.000 + IVA por consulta adicional; «plan pro» con +1 % sobre lo
  financiado; CreditopX con 5 % más un fijo; cadenas grandes sin fijo y 1,8–2,5 %.
- Etapas del comercio: Prospecto → Reunión → Propuesta → Documentos → Firma → Capacitación →
  Bienvenida → **Operación** (o Churn, Retoma futura, Descartado).
- Objeciones típicas: no quieren costo fijo por punto, el desembolso lento de algunas entidades
  (más de 8 días pesa más que la comisión), papeleo; la competencia citada es Addi (4–6,5 %), Brilla,
  Sufi y Welli (5 %).
- Shopify aprobó a CreditOp como Payments App con revenue share de 0,5 % del GMV (CACM-157).

## Decisiones de producto que explican el código

- **Confirmación de cupo** (`flow_id` 2): cada consulta al buró cuesta y un cupo confirmado afuera no
  aporta; se salta Experian y el listado se acota a entidades sin integración (CORE-293, CORE-236).
- **Vigencia y foto por entidad**: Meddipay manda un WhatsApp de «cupo aprobado» en cada consulta,
  así que reconsultar molesta al cliente (CORE-242, CORE-304 a 307).
- **Welli Risk se etiqueta y confirma**: un cliente se mostró como Welli y desembolsó como Welli Risk,
  con costos que nadie asumió (CORE-83).
- **El historial de perfilamiento guarda lo que vio el asesor**, por solicitud (CORE-183, CORE-67).
- **El comercio no autoriza a mano un crédito de riel 2 a 4**: dejaba créditos CreditopX sin
  pagaré, plan ni IMEI (CORE-505). **[código]** `user-request-lifecycle`.
- **La cuota inicial sólo bloquea el pagaré en ecommerce**: en presencial la cobra el comercio en caja
  y no pasa por la pasarela; bloquear frenaría a casi todos los clientes legítimos (CRED-365).
- **Pedir más del cupo no rechaza: el excedente es cuota inicial**; es la duda número uno de los
  comercios en soporte (REFCM-444, 350, 480). **[código]** `creditopx-offer-calculation`.
- **Umbral de colilla por entidad**, y al borrarla la fecha avanza según la periodicidad, no un mes
  fijo (CRED-239, CRED-402). **[código]** `creditopx-portfolio-servicing`.
- **Tasa M.V. fijada por perfil** para que no cambie con la tasa de usura (CXCM-644).
- **Interés de mora sólo sobre el capital del pago mínimo** (CXCM-292, CXCM-496 a 498).
- **El checkout ecommerce salió de la plataforma vieja** porque convertía 1,9 % contra 18,7 % del
  flujo nuevo (CORE-30).
- **Las líneas de WhatsApp de cobranza y de OTP se separaron** para que un bloqueo de cobranza no
  tumbe el OTP (LEN-170, LEN-209).
- **Atribución al asesor**: una solicitud sin `corporate_user_id` no paga comisión; ecommerce y la
  app no tienen asesor por diseño (CORE-844, CORE-846).
- **Premium de la app «ante la duda, otorgar»**: un mes regalado cuesta poco y bloquear cuesta el
  cliente (CORE-533).

## Lo que más se rompe (soporte, REFCM nov-2025 → ene-2026)

| tipo | casos aprox. | qué hay detrás |
|---|---|---|
| identidad (ADO, AML, fotos) | 60 | selfie que no coincide o ADO colgado; agotar intentos con sospecha de fraude no se rehabilita; un hallazgo de AML cancela |
| datos duplicados o mal escritos | 45 | usuarios temporales que quedaron en el OTP; se corrigen en el admin o se borra el temporal sin créditos |
| «la entidad no aparece» / cuota inicial / plazo | 44 | casi siempre por diseño: excedente como cuota inicial, plazo de la política, score o sobreendeudamiento |
| pagos, mora y cartera CreditopX | 41 | el cliente no entiende el capital (financiado + costo administrativo + FGA + IVA del FGA); jobs de pago que no corrieron |
| buró no consultado | 26 | apellidos compuestos o con tilde, cédula mal digitada |
| OTP / SMS | 26 | Twilio no entrega; el OTP de Sistecrédito lo manda Sistecrédito |
| entidad caída o estado sin sincronizar | ~30 | Welli 403 = ya hay una solicitud en curso allá; webhooks no consumidos |

La solución más repetida es **retomar la solicitud desde el link de WhatsApp**.

## En curso: lo que va a cambiar

- **Banco Finandina** (CORE-845, CRED-519): libre inversión de ticket alto por originación delegada,
  con su política en el motor (perfiles por letra y ocupación, FGA de 5 o 9 %, topes por mes y por
  cliente, 98 ciudades) y la cartera en Finandina; CORE-918 generaliza el riel 4.
- **Mora operativa** (CRED-462): mora real menos N días (3, parametrizable) para disparar cobranza.
- **Capacidades por entidad en vez de `isSmartPay()`** (CRED-238) y AML configurable por entidad: la
  columna `requires_restrictive_list_check` existe y nadie la lee.
- **No permitir utilizaciones de un rotativo en mora** (CRED-440); **corte quincenal** con un solo
  cambio de fecha (CRED-523 a 529).
- **Ajuste ×1000 de la cuota CreditopX en el buró** que infla la capacidad de los recurrentes
  (CRED-412, espera a Riesgo).
- **App**: prioridad de entidades propia y exclusión de las entidades sin integración (LEN-324,
  LEN-325); en tienda, mostrar sólo la entidad que el cliente eligió en la app (LEN-318).
- **Webhooks de entidades unificados** (CORE-590) y quitar los ids quemados de SmartPay
  (CORE-560, CRED-325).

## Defectos que Jira da por abiertos

CRED-447 (capital vencido facturado dos veces, con tope en `main` y backfill pendiente), CRED-448 y
CRED-398 (la reducción de cuota no recalcula o usa la tasa equivocada), CRED-449 (cuota facturada dos
veces al realinear el corte), CRED-301 (plan del rotativo en $0), CRED-166 (IVA del FGA fijo en el
pagaré aunque el convenio diga 0 %), CORE-589 (criterio de «solicitud ecommerce» distinto entre
monolitos), LEN-340 (nombres compuestos que Datacrédito no encuentra), LO-138 (borrar la cuenta de la
app y volver a registrarse salta la vigencia de 30 días de Experian).

## Glosario

- **Agregador / marketplace:** la pantalla donde el asesor compara entidades.
- **Originaciones / pantallas nuevas:** el asistente nuevo, frente a «application», el viejo.
- **Riel:** el `response_type` de una entidad (ver `lender-response-types`).
- **Confirmación de cupo / aprobación previa:** el asesor declara un cupo externo y se salta el buró.
- **BNPL / Consumo:** los dos productos de Bancolombia en Corbeta.
- **Welli Risk:** el perfil de Welli con costos más altos.
- **Fianza anticipada / mensualizada:** las dos formas de cobrar la garantía de Credifamilia;
  **4x1000** es el GMF que se le suma.
- **Prefiltro:** corte de score antes de enviar a una entidad.
- **Colilla:** saldo residual que se condona en el corte.
- **Voucher:** el comprobante de desembolso.
- **Gestionar:** retomar o cambiar el estado de una solicitud desde el panel del comercio.
- **Perfil 4 / 6 / 7:** Comercial (asesor) / Admin comercio / Superadmin comercio.
- **Tenant (Trustonic):** la cuenta de bloqueo de equipos de un comercio.
- **CORBxxx:** códigos de error del checkout ecommerce de Corbeta.
- **Salida de un comercio:** el comercio deja de operar.
