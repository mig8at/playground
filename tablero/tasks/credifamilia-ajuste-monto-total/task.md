---
id: 97
title: "Credifamilia alcance desarrollo: ajuste monto total"
stage: evaluation
created: "2026-09-28T12:00:00-05:00"
knowledge: [credifamilia-financing]
canon: [credifamilia/context#autorizada-no-es-radicada-el-estado-no-prueba-que-llego-al-proveedor, credifamilia/context#es-un-hibrido-y-esa-palabra-evita-dos-errores, credifamilia/context#el-codigo-de-respuesta-decide-el-estado-de-la-transaccion-de-radicacion-y-un-409-no-es-un-fallo]
jira: [CORE-653]
jira_title: "Credifamilia alcance desarrollo: ajuste monto total"
ramas: fix/CORE-653-credifamilia-monto-total
---

# Credifamilia alcance desarrollo: ajuste monto total

## Pendientes

- [x] Redondeo de `montoTotalCredito`: dos decimales redondeados ($6.343.651,73 en el ejemplo), decidido por Miguel; es lo que ya hace el PR, sin cambios.
- [x] Cuotas y comprobante alineados al 4x1000 sobre el IVA (decisión de Miguel, 2026-09-29), en el mismo PR [#1521](pr:legacy-backend#1521), commit 7f294290.
- [ ] Confirmar con Credifamilia sobre qué base calcula el 4x1000 en su plan de pagos; si no es el IVA, se revierte el commit 7f294290 y el resto del PR queda igual. Pesa más de lo previsto: con fianza Mensual (el 96 % de las radicaciones) la cuota baja unos $60 (2.000.000, 18 %, 24 cuotas: 17.921,40 a 17.861,40).
  Depende de: producto / Credifamilia
- [x] Fianza Mensual: el alcance sólo suma la fianza cuando es Anticipada, así que con Mensual el total es el monto solicitado.
- [x] Decimales en `montoTotalCredito`: el WSDL lo declara `xs:double` y el servicio de pruebas de Credifamilia guardó una transacción con `2428673.60` (200, 2026-09-29). Falta sólo verlo en una radicación real de producción.
- [x] Implementar `montoTotalCredito` en la radicación con la fórmula del alcance y dos decimales — [#1521](pr:legacy-backend#1521), 6 pruebas nuevas, ejemplo del alcance en 6343651.73.
- [x] Correr en local una solicitud con fianza Anticipada hasta la radicación — 3/3 en 11 con CREDIT_COMPLETED y `montoTotalCredito` 2428673.60 para 2.000.000.
- [x] Documentar en `knowledge/credifamilia-financing` la fianza y el total de radicación verificados en `main`, con sus fuentes y los límites de entradas, formatos y respaldos. La publicación en Canon queda independiente y sólo se hace si Miguel la solicita.
- [ ] Conseguir que el QA de Credifamilia apruebe a un cliente (tasa y tipo de fianza), para ver la fórmula nueva de punta a punta en dev; termina cuando la pre-aprobación devuelva `approved`. La lista de clientes de prueba no bastó: ver el artefacto de clientes de prueba.
  Depende de: Credifamilia
- [ ] Escribir la publicable (Dónde probar, Cómo validar) antes de que Miguel la vea.

## Objetivo

Que el `montoTotalCredito` que CreditOp informa a Credifamilia en la radicación (operación SOAP
`transaccionConsumo`, la «orden de desembolso») sea el calculado por CreditOp con la regla del alcance:
**monto solicitado + total fianza** (fianza + IVA + 4x1000) cuando la fianza es anticipada, y que sea el
mismo total que ya muestran el voucher y el plan de cuotas.

## Dónde se toca

El mecanismo vigente está en `legacy-backend` y se explica en
`knowledge/credifamilia-financing/rules.md`, con commits y blobs en `sources.json`.
La búsqueda de radicación SOAP en la ref local de `main` de `application` no encuentra ese camino.

- `app/Actions/Lenders/CredifamiliaConsumo/TransactionRequest.php`: obtiene el total de
  `BondBreakdown`, sobre el monto solicitado convertido a entero; informa dos decimales y
  conserva `final_amount` como respaldo cuando faltan datos de fianza.
- `Modules/Onboarding/App/Services/lenders/CredifamiliaConsumo/CredifamiliaConsumoService.php`:
  transporta porcentaje y tipo de fianza de la preaprobación, además de las tasas.
- `app/Services/PaymentPlan/Credifamilia/ValueObjects/BondBreakdown.php`: fianza + IVA +
  4x1000 sobre el IVA; sólo suma la fianza al capital con `Anticipada`.
- `app/Services/PaymentPlan/Credifamilia/Engine/CalculationContext.php`: reutiliza ese desglose
  para el motor del plan de pagos.
- `app/Services/PaymentPlan/Credifamilia/PaymentPlanSummary/CredifamiliaPaymentPlanSummaryService.php`:
  puede conservar los centavos del monto de la solicitud, a diferencia del SOAP.
- `Modules/Loans/App/Services/DocumentGeneration/Payload/OnboardingPayloadBuilder.php`:
  toma el total del resumen cuando existe; el formateador del comprobante lo convierte a entero.
- Mock local de radicación: `harness/bin/mock-credifamilia` (:8108).

## Cómo se ataca

1. Cerrar con producto / Credifamilia las preguntas abiertas de base y redondeo de los pendientes.
   Lo que calcula el código no sustituye la confirmación del proveedor.
2. Si cambia la fórmula, corregir `BondBreakdown` y comprobar sus consumidores. Conservar la
   semántica de `final_amount`; el SOAP no depende de cambiar esa columna.
3. Comparar las entradas y el total numérico del SOAP, del resumen y del comprobante, incluyendo
   un monto con centavos y la fianza Mensual. La fórmula compartida no garantiza igualdad exacta:
   el SOAP usa entero y dos decimales de salida; el resumen puede usar float; el PDF no imprime centavos.
4. Repetir las pruebas unitarias del ejemplo y la corrida local con el mock según la receta.
   La aceptación en un ambiente y sus impedimentos se conservan en la pila.
5. Revisar el tema local si cambia cualquiera de sus fuentes. Compartir una explicación en
   Canon es una acción separada solicitada por Miguel, no una condición para completar este trabajo.

## Lo que se evaluó y NO se eligió

**Calcular la fórmula del alcance a mano dentro de `TransactionRequest`.** Es lo más corto (el
preaprobado ya está en `buildRequest`), pero duplica el cálculo que ya hace el motor y, con la base
del 4x1000 distinta, deja tres totales para el mismo crédito: el del voucher, el de las cuotas y el del
SOAP. Sólo tendría sentido si se decide que el 4x1000 del motor está bien para las cuotas y mal para el
SOAP, que no tiene sentido de negocio.

**Arreglar `final_amount` al autorizar (`authorizeRequest`) para Credifamilia.** `final_amount` lo leen
muchos lados (cupos de CreditopX, reportes de comercio, `ApprovedConfirmationController`) con la
semántica «valor a financiar sin fondo de garantía». Cambiarlo para un lender cambia qué significa la
columna. Queda descartado salvo que producto pida que la BD también guarde el total con fianza.

## Lo que NO entra

- El resto de los campos pendientes del SOAP (tablas de códigos, `fechaIngreso`, bloque bancario, etc.).
- El truncado de `montoSolicitado` a entero, salvo que la decisión de redondeo lo alcance.
- Cambiar la semántica de `user_requests.final_amount`.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

Lo que se mandó a Credifamilia (prod, sólo lectura), por tipo de fianza:

```sql prod
SELECT l.request->>'$.tipoFianza' tf, COUNT(*) n,
       SUM(CAST(l.request->>'$.montoTotalCredito' AS SIGNED) - CAST(l.request->>'$.montoSolicitado' AS SIGNED) > 1) con_diferencia
FROM user_requests ur
JOIN logs l ON l.user_request_id = ur.id AND l.name = 'credifamilia.consumo.soap_payload'
WHERE ur.lender_id = 24 AND ur.id > 500000
GROUP BY 1
```

(Filtrar por `user_requests` primero: sobre `logs` sola, Redash no termina en 60 s. Desde `make`, el
`$` del JSON path va como `$$`.)

El ejemplo del alcance, para la prueba unitaria: monto 5.223.964 · 18 % → fianza 940.313,52 · IVA
178.659,57 · 4x1000 714,64 (sobre IVA) · total fianza 1.119.687,73 · **total 6.343.651,73**. La comparación histórica con 4x1000
sobre fianza + IVA daba 4.475,89 · **total 6.347.412,98**; no es la fórmula vigente del motor.

Local: el cierre entero de Credifamilia en local (receta en la memoria `credifamilia-flujo-mapa` y la
suite `harness/suites/credifamilia.json`) + `bin/mock-credifamilia start` y
`CREDIFAMILIA_CONSUMO_WSDL` apuntado al mock. Hace falta un preaprobado con `guarantee_type = 2`.

### Contra el SOAP de pruebas de Credifamilia (cómo conectarse y repetirlo)

Sirve para comprobar el formato de lo que se radica sin pasar por el flujo del cliente. **Valida formato y
obligatorios, no la fórmula.** Cada 200 deja una transacción de prueba en el QA de Credifamilia: avisar a Oscar.

- **Endpoint**: `https://pruebas.credifamilia.com.mx/proptech-ws-sec/services/consumoEndPoint?wsdl` (responde 200 sin
  credenciales; el manual V5.3 lista otro host, `cfbolsillo`, no probado). El TLS no pide certificado de cliente:
  la autenticación es WS-Security firmada en el mensaje, así que sin un certificado registrado allá sólo se lee el WSDL.
- **Certificado**: de `temp/keys` sirve `clientQA2026.cert` + `.key` (autofirmado, CN=mejorCDT, vence 2063).
  `credifamilia.cert/.key` es la firma de PDF de Certicámara, vencida el 2026-02-28: el servicio la rechaza
  («No trusted certs found»). El oficial vive cifrado en la BD de dev (`lender_allied_credentials` 926) y pide el
  `APP_KEY` de dev; la guía está en legacy-backend, `docs/credifamilia/README.md`.
- **Cliente**: el `SoapClient` de legacy-backend (firma WSSE) dentro del contenedor `laravel.test`. El script
  `artifacts/credifamilia-qa-soap.sh` copia el certificado al contenedor, manda UN `transaccionConsumo` y lo borra:
  `KEYS=temp/keys NIT=<nit> MONTO_TOTAL=2428673.60 FIANZA=Anticipada artifacts/credifamilia-qa-soap.sh`.
- **El NIT de convenio** (`nitConvenio` = `allieds.nit`) tiene que existir en Credifamilia: si no, 500 «nit no existe»
  ANTES de guardar. Los de dev (Pullman, Dentix) no sirven; los reales salen de prod con la VPN de prod (ver el bloque
  del 2026-09-29): 830108482 fue el que dio 200.
- **Lectura del resultado**: 400 = falta un obligatorio o un formato; 500 «nit no existe» = convenio; 200 = guardó;
  409 = la solicitud ya existe (usar otro `CODE`).
- **Dev no sirve para esto hoy**: la pre-aprobación de Credifamilia falla en el servicio de pre-aprobados (decode
  de `genero`) y la radicación no llega; `qa` y `staging` no tienen el merge todavía.

## Referencias

- Alcance: «Alcance - Ajuste Campo MontoTotal Crédito» (PDF de Credifamilia/producto, en Downloads de Miguel).
- CORE-127 (`datos-erroneos-voucher-credifamilia`): cuando el voucher pasó a salir del motor y se agregó el 4x1000.
- Conocimiento local: `knowledge/credifamilia-financing/rules.md` y sus fuentes verificadas. Canon queda opcional para el contexto de negocio/producto; no se exige sincronizarlo al cerrar.



## Tarea (publicable)

## En una línea
El monto total del crédito que CreditOp informa a Credifamilia al radicar incluye la fianza cuando es anticipada.

## Por qué
Hoy, al radicar, el monto total informado es igual al monto solicitado, aun cuando la fianza es anticipada y por lo tanto se financia dentro del capital. El comprobante que ve el cliente sí muestra el total con fianza, así que la orden de desembolso y el comprobante no coinciden.

## Qué cambia
Al radicar un crédito con fianza anticipada, el monto total informado pasa a ser: monto solicitado + fianza + IVA de la fianza + 4x1000. Con fianza mensual no cambia.

## Alcance
No cambia el formulario, ni las pantallas del cliente, ni el monto solicitado. No cambia cómo se calculan las cuotas, salvo que la definición oficial del 4x1000 obligue a ajustarlo (pendiente de confirmar).

## Dónde probar
Pendiente: se define al terminar el desarrollo.

## Cómo validar
Pendiente.

## Criterios de aceptación
- En una solicitud con fianza anticipada, el monto total informado a Credifamilia es monto solicitado + total fianza, con la regla de redondeo acordada.
- Con el ejemplo del alcance (monto $5.223.964, fianza 18 %) el total coincide con el valor acordado.
- En una solicitud con fianza mensual, el monto total informado es igual al monto solicitado.
- El total informado coincide con el «Total a financiar» del comprobante del cliente.

## Dependencias / contraparte
Confirmación de producto / Credifamilia sobre la base del 4x1000 y la regla de redondeo.
