---
id: 107
title: "Finandina: originación completa en Creditop"
stage: evaluation
created: "2026-10-28T10:38:26-05:00"
knowledge: [lender-listing, field-scoring-policy, kyc-pipeline, identity-name-validation]
canon: [credifamilia/context, perfilamiento/context, listado/context, documentos/context, entidad/context]
jira: [CORE-845]
jira_title: "Finandina: originación completa en Creditop"
---

## Pendientes

- [x] ~~Ligar la tarea a un issue de Jira~~ — CORE-845, creado en el sprint activo (CORE Sprint 21).
- [ ] Confirmar qué política está vigente: el PRD de enero y la política de agosto no coinciden (monto mínimo,
  veces el ingreso, tope diario contra tope mensual, punto de corte del score); termina con la versión elegida
  escrita en «Objetivo». Depende de: producto (Maria Fernanda Parra) — la política acordada con Finandina.
- [ ] Decidir cómo se modela la entidad: hoy la 149 existe en prod y en local como `response_type = 1`
  (externa) y sin reglas, pero el PRD pide que Creditop decida con la política de Finandina; termina con el
  tipo de respuesta y el motor elegidos y su motivo en la pila.
- [ ] Mapear cada regla de la política a un mecanismo existente o a uno nuevo (reglas de entidad, reglas de
  buró, categorías, capacidad de pago, topes); termina con la tabla regla → mecanismo → archivo en «Dónde se
  toca», verificada en los dos monolitos.
- [ ] Confirmar qué llaves están entregadas (Experian y Mareigua de Finandina) y en qué ambiente; termina con
  cada llave cargada como credencial de la entidad en un ambiente de prueba. Depende de: producto — el
  traspaso de llaves.
- [ ] Destrabar la certificación de Deceval (CRED-463, bloqueada); termina con un pagaré de Finandina creado
  y firmado en el ambiente de certificación. Depende de: Hans — el motivo del bloqueo.
- [ ] Definir el envío de la operación aprobada a Finandina (HU 13): el flujo de la fase 1 lo muestra manual
  (descarga semanal y carga masiva); termina con la decisión de si la fase 1 es manual o por integración, y
  con qué datos. Depende de: producto — el acuerdo con Finandina.
- [ ] Resolver las observaciones abiertas del mapa de campos de los documentos (las dos preguntas PEP con un
  solo marcador, campos PEP sin marcador, sin segundo nombre, monto del aval sin campo); termina con la
  plantilla corregida o cada observación descartada.
- [ ] Conseguir el diseño (Figma) de las pantallas que nombra el PRD; termina con el enlace en «Referencias».
  Depende de: producto — el diseño.

## Objetivo

Que Banco Finandina se ofrezca como entidad de libre inversión en los comercios elegidos con originación
completa en Creditop: Creditop valida identidad y riesgo con las llaves de Finandina, aplica su política,
calcula la capacidad de pago, decide, muestra las condiciones, hace firmar los documentos y entrega la
operación aprobada a Finandina, que desembolsa y administra cartera y recaudo.

La política vigente todavía no está elegida (ver Pendientes). Lo común a las dos versiones: persona natural
con cédula, 21 a 64 años, empleado o pensionado (sin independientes), ingresos desde 1 SMMLV, empleado con 6
meses de antigüedad confirmados por Mareigua, ciudad dentro de la cobertura de Finandina, monto máximo 15 MM,
plazo 6 a 36 meses, máximo 5 MM sin experiencia crediticia, no más de 2 créditos por Creditop al mes por
cliente, y un tope de desembolsos de Creditop.

## Dónde se toca

Lo que existe hoy (medido en prod y en local el 2026-10-28, y buscado en `main`):

- La entidad 149 «Banco Finandina» (`banco-finandina`) existe en prod y en local: `response_type = 1`,
  `product = credit`, corte mensual, sin reglas, sin reglas de buró, sin ciudades, sin perfiles y sin
  asignación a comercios. En local su línea de crédito dice 1–20 MM y 3–60 meses.
- «finandina» no aparece en el código de ningún repo indexado: no hay plantillas, payload ni lógica propia.
- Mecanismos genéricos que podrían servir (por verificar uno por uno):
  - reglas de entidad (`lender_rules`: edad, ocupación, ingresos) — `Modules/Onboarding/App/Services/lenders/LenderValidationService.php`
    en legacy-backend y `app/Services/lenders/LenderValidationService.php` en legacy-application. Con
    `response_type = 1` fallar las reglas NO saca a la entidad del listado (`knowledge/lender-listing`).
  - score de buró con `allow_0_score` — `Modules/Loans/App/Services/DatacreditoRuleEvaluator.php`, que hoy
    sólo usan el cupo de CreditopX y el rotativo.
  - categorías y capacidad de pago — `Modules/Loans/App/Services/LenderUserCategoryService.php`; su capacidad
    es (ingreso − gasto) / ingreso, no la fórmula de Finandina.
  - `cities_by_lender` existe como tabla pero ningún código la lee.
  - identidad con ADO y la cascada de ingresos (Ágil Data, Mareigua) — `knowledge/kyc-pipeline` e
    `knowledge/identity-name-validation`.
  - pagaré en Deceval (genérico, con `promissory_type_id`).
- No hay nada para: veces el ingreso por nivel de riesgo, aval FGA según score, capacidad de pago con gastos
  y descuentos de ley por SMMLV, riesgo del empleador de Mareigua, topes de desembolso de Creditop.

## Cómo se ataca

1. Cerrar las decisiones de producto (política vigente, modelo de la entidad, envío a Finandina).
2. Mapear regla por regla contra `main` en los dos monolitos y separar lo que es configuración de lo que es
   código nuevo.
3. Configurar en un ambiente de prueba lo que ya existe (entidad, comercios, línea de crédito, reglas,
   credenciales) y probar el caso con el arnés.
4. Construir lo que falta, en el orden en que bloquea el flujo: elegibilidad y monto, capacidad de pago,
   documentos y pagaré, envío a Finandina, topes.

## Lo que se evaluó y NO se eligió

Nada todavía.

## Lo que NO entra

- La administración de cartera, el recaudo y la cobranza: son de Finandina.
- La compra de cartera y los retanqueos (fuera de la política).

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

Pendiente: se arma cuando la entidad esté configurada en un ambiente de prueba.

## Referencias

- PRD de la integración (Google Doc «PRD – Integración Banco Finandina», id `1utJdnxfmL8Zre7ihll6Zvq9VraA57JDQpopGYybgUb0`).
- Carpeta de Drive «Finandina» (id `17AcO2PoM2U_5MCzpFtvA9bJDbbTwc0th`): «Politicas Creditop.pdf» (política de
  agosto), el flujo de la fase 1 (`image.png`) y «Documentos formalización de crédito» con el formulario de
  vinculación, los T&C y el mapa de campos (versión del 2026-10-27). ⚠ La carpeta tiene tres archivos con
  credenciales: no se copian a la tarea.
- Slack: canal `#finandina` y el hilo del PRD en `#producto-tech`.
- Jira: CORE-845 (la tarea); relacionados: LO-197 (épica «Finandina»), CXCM-533, CXCM-521 (políticas de entidades especiales), CRED-463 (certificación de
  Deceval).
- Guía de integración de entidades en Confluence: «Integración originación en línea».

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
