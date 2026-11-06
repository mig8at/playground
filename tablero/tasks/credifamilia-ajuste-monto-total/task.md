---
id: 97
title: "Credifamilia alcance desarrollo: ajuste monto total"
stage: evaluation
created: "2026-09-28T12:00:00-05:00"
knowledge: [credifamilia-financing]
recorrido: [advisor|self-service, riel-4, credit, +dynamic-form, formalizacion:radicacion]
canon: [credifamilia/context#autorizada-no-es-radicada-el-estado-no-prueba-que-llego-al-proveedor, credifamilia/context#es-un-hibrido-y-esa-palabra-evita-dos-errores, credifamilia/context#el-codigo-de-respuesta-decide-el-estado-de-la-transaccion-de-radicacion-y-un-409-no-es-un-fallo]
jira: [CORE-653, CORE-758]
jira_title: "Credifamilia alcance desarrollo: ajuste monto total"
ramas: fix/CORE-653-credifamilia-monto-total, fix/CORE-653-credifamilia-4x1000-base, fix/CORE-653-credifamilia-4x1000-base-main, feat/CORE-653-escenarios-fianza, fix/trivy-braces-node-options
---

# Credifamilia alcance desarrollo: ajuste monto total

## Pendientes

- [x] Redondeo de `montoTotalCredito`: dos decimales redondeados ($6.347.412,98 en el ejemplo), decidido por Miguel; es lo que ya hace el PR, sin cambios.
- [x] ~~Cuotas y comprobante alineados al 4x1000 sobre el IVA (decisión de Miguel, 2026-09-29, [#1521](pr:legacy-backend#1521))~~ — reemplazado: la base vigente es fianza + IVA (casilla siguiente).
- [x] Confirmar con Credifamilia sobre qué base calcula el 4x1000: **sobre fianza + IVA** (su reclamo de la solicitud 577129, 13-oct, y lo que indicaron después de hablar con Oscar). Contradice el ejemplo del alcance, que lo calcula sobre el IVA solo. Cambio en [#1668](pr:legacy-backend#1668), directo a `qa`.
- [ ] Mock de Credifamilia para qa: [credifamilia-mockery-lamba#11](https://github.com/Creditop-SAS/credifamilia-mockery-lamba/pull/11) (mergeado) agrega el dictado por cédula y escenarios aprobados con la fianza en el formato de producción; su despliegue falló en Trivy por `braces` (CVE-2026-93687, sin versión corregida) y [#12](https://github.com/Creditop-SAS/credifamilia-mockery-lamba/pull/12) lo ignora con vencimiento, como abaco, y agrega el `NODE_OPTIONS` que faker 10 necesita en Lambda. Después falta que infra apunte el servicio de pre-aprobaciones de qa al mock y que se recree `netco_signing_documents` en la base compartida. Termina cuando una solicitud de Credifamilia en qa llegue al plan de pagos con la fianza del mock.
  Depende de: infra
- [x] Mergear [#1670](pr:legacy-backend#1670) a `main`, el mismo cambio de #1668: mergeado el 2026-10-19. `main`, `staging`, `qa` y `develop` calculan el 4x1000 sobre fianza + IVA, y producción lo tiene desde el tag `v0.6.29` (2026-10-22).
- [ ] Confirmar si el total se redondea al entero superior o a dos decimales. El alcance pide las dos cosas en sus criterios de aceptación («dos decimales» y «aproximación al número entero superior»); hoy se informa con dos decimales ($6.347.412,98 en el ejemplo, $6.347.413 si fuera el entero superior). Termina cuando haya una respuesta por escrito y lo que se radica haga lo que ella diga.
  Depende de: producto / Credifamilia — la regla de redondeo del total
- [ ] Confirmar si Credifamilia redondea cada término por separado (fianza, IVA, 4x1000) o sólo el total, como hace el código. El código redondea sólo al final y las pruebas de `main` esperan 6347412.98 para el ejemplo. El centavo de diferencia del PDF del alcance ($6.343.651,72 contra $6.343.651,73) ya no aplica: ese ejemplo usa la base IVA, que se descartó. Termina cuando se sepa la regla y la prueba unitaria del ejemplo la use.
  Depende de: Credifamilia — cómo redondea cada término
- [x] Fianza Mensual: el alcance sólo suma la fianza cuando es Anticipada, así que con Mensual el total es el monto solicitado.
- [x] Decimales en `montoTotalCredito`: el WSDL lo declara `xs:double` y el servicio de pruebas de Credifamilia guardó una transacción con `2428673.60` (200, 2026-09-29). Visto en producción: la solicitud 577129 (2026-10-02) radicó `5315152.17` y Credifamilia contestó 200.
- [x] Implementar `montoTotalCredito` en la radicación con la fórmula del alcance y dos decimales — [#1521](pr:legacy-backend#1521), 6 pruebas nuevas, ejemplo del alcance en 6343651.73.
- [x] Correr en local una solicitud con fianza Anticipada hasta la radicación — 3/3 en 11 con CREDIT_COMPLETED y `montoTotalCredito` 2428673.60 para 2.000.000, con la base IVA de entonces; con la vigente, el esperado es 2430113.60.
- [x] Documentar en `knowledge/credifamilia-financing` la fianza y el total de radicación verificados en `main`, con sus fuentes y los límites de entradas, formatos y respaldos. La publicación en Canon queda independiente y sólo se hace si Miguel la solicita.
- [ ] Conseguir que el QA de Credifamilia apruebe a un cliente (tasa y tipo de fianza), para ver la fórmula nueva de punta a punta en dev; termina cuando la pre-aprobación devuelva `approved`. La lista de clientes de prueba no bastó: ver el artefacto de clientes de prueba.
  Depende de: Credifamilia
- [x] Dictar a canon las piezas de `artifacts/canon-credifamilia-propuesta.md` (4 nuevas y 3 reescrituras): las 7 están en `credifamilia/context` y salen en `make canon-search` (comprobado el 2026-10-02). Las referencias de Canon quedan como contexto opcional; el mecanismo local se revisa en `knowledge/credifamilia-financing`.
- [x] Escribir la publicable (Dónde probar, Cómo validar) antes de que Miguel la vea: escrita el 2026-10-02 y pasa el guard; falta que Miguel la vea antes de publicarla.

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
  4x1000 sobre **fianza + IVA**; sólo suma la fianza al capital con `Anticipada`. En `qa` y `develop`
  la carpeta se llama `DelegatedOrigination` en vez de `Credifamilia`; la fórmula es la misma.
- `app/Services/PaymentPlan/Credifamilia/Engine/CalculationContext.php`: reutiliza ese desglose
  para el motor del plan de pagos.
- `app/Services/PaymentPlan/Credifamilia/PaymentPlanSummary/CredifamiliaPaymentPlanSummaryService.php`:
  puede conservar los centavos del monto de la solicitud, a diferencia del SOAP.
- `Modules/Loans/App/Services/DocumentGeneration/Payload/OnboardingPayloadBuilder.php`:
  toma el total del resumen cuando existe; el formateador del comprobante lo convierte a entero.
- Mock local de radicación: `harness/bin/mock-credifamilia` (:8108).

## Cómo se ataca

1. La base del 4x1000 está cerrada: fianza + IVA, confirmada por Credifamilia y en el código de
   todos los ambientes. Queda abierto el redondeo (pendientes). Lo que calcula el código no sustituye
   la confirmación del proveedor.
2. Si la respuesta del redondeo cambia la fórmula, corregir `BondBreakdown` y comprobar sus
   consumidores. Conservar la semántica de `final_amount`; el SOAP no depende de cambiar esa columna.
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

El ejemplo del alcance, con la fórmula vigente (la de las pruebas de `main`: `BondBreakdownTest` y
`TransactionRequestTest`): monto 5.223.964 · 18 % → fianza 940.313,52 · IVA 178.659,57 · 4x1000 4.475,89
(sobre fianza + IVA) · total fianza 1.123.448,98 · **total 6.347.412,98**. El PDF del alcance calcula el
4x1000 sobre el IVA solo (714,63 truncado · total 6.343.651,72): esa base se descartó.

Otro caso: 2.000.000 · 18 % anticipada → fianza 360.000 · IVA 68.400 · 4x1000 1.713,60 · **total
2.430.113,60**. Con fianza mensual a 24 cuotas, la fianza por cuota es 430.113,60 / 24 = **17.921,40**.

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
  `KEYS=temp/keys NIT=<nit> MONTO_TOTAL=2430113.60 FIANZA=Anticipada artifacts/credifamilia-qa-soap.sh`.
- **El NIT de convenio** (`nitConvenio` = `allieds.nit`) tiene que existir en Credifamilia: si no, 500 «nit no existe»
  ANTES de guardar. Los de dev (Pullman, Dentix) no sirven; los reales salen de prod con la VPN de prod (ver el bloque
  del 2026-09-29): 830108482 fue el que dio 200.
- **Lectura del resultado**: 400 = falta un obligatorio o un formato; 500 «nit no existe» = convenio; 200 = guardó;
  409 = la solicitud ya existe (usar otro `CODE`).
- **Dev no sirve para esto hoy**: la pre-aprobación de Credifamilia falla en el servicio de pre-aprobados (decode
  de `genero`) y la radicación no llega. `qa` y `staging` ya tienen la fórmula, pero tampoco llegan a radicar.

## Referencias

- Alcance: «Alcance - Ajuste Campo MontoTotal Crédito» (PDF de Credifamilia/producto, en Downloads de Miguel).
- CORE-127 (`datos-erroneos-voucher-credifamilia`): cuando el voucher pasó a salir del motor y se agregó el 4x1000.
- Conocimiento local: `knowledge/credifamilia-financing/rules.md` y sus fuentes verificadas. Canon queda opcional para el contexto de negocio/producto; no se exige sincronizarlo al cerrar.

## Tarea (publicable)

## En una línea
El monto total del crédito que CreditOp informa a Credifamilia al radicar incluye la fianza cuando es anticipada.

## Por qué
Antes, al radicar, el monto total informado era igual al monto solicitado, aun cuando la fianza es anticipada y por lo tanto se financia dentro del capital. El comprobante que ve el cliente sí mostraba el total con fianza, así que la orden de desembolso y el comprobante no coincidían.

## Qué cambia
- Con fianza anticipada, el monto total informado pasa a ser: monto solicitado + fianza + IVA de la fianza + 4x1000 calculado sobre la fianza más su IVA, con dos decimales.
- Con fianza mensual, el monto total informado sigue siendo el monto solicitado.
- Las cuotas y el comprobante usan esa misma fórmula del 4x1000, para que los tres digan lo mismo. Es la base que Credifamilia confirmó, así que la fianza de cada cuota queda igual que antes del cambio (por ejemplo, un crédito de $2.000.000 con fianza mensual del 18 % a 24 cuotas lleva $17.921,40 de fianza por cuota).

## Alcance
No cambia el formulario, ni las pantallas del cliente, ni el monto solicitado, ni la fianza de las cuotas. Cambia sólo el monto total que se informa al radicar con fianza anticipada. Queda pendiente de confirmar con Credifamilia si el total se redondea a dos decimales o al entero superior.

## Dónde probar
- **Producción:** el monto total con fianza se informa desde la noche del 1 de octubre de 2026, y con la base del 4x1000 confirmada por Credifamilia desde la versión del 22 de octubre de 2026.
- **Desarrollo y QA:** tienen el cambio, pero hoy no sirven para probar de punta a punta. El ambiente de pruebas de Credifamilia rechaza a todos los clientes de prueba, y en QA además falta configurar el servicio de pagarés (Deceval), así que la solicitud no llega a radicar.
- **Staging:** tiene el cambio, con la misma limitación que desarrollo y QA.

## Cómo validar
1. Con un cliente aprobado por Credifamilia con fianza anticipada, por ejemplo $2.000.000 con fianza del 18 %: el monto total informado en la radicación debe ser $2.430.113,60 (2.000.000 + 360.000 de fianza + 68.400 de IVA + 1.713,60 de 4x1000, que es el 0,4 % de 428.400).
2. Con otro monto, comprobar que el total sea monto + fianza + IVA de la fianza + 4x1000 sobre la fianza más su IVA, con dos decimales.
3. Con fianza mensual, comprobar que el monto total informado sea igual al monto solicitado.
4. Comprobar que Credifamilia responda que guardó la transacción.
5. Comparar con el «Total a financiar» del comprobante del cliente: el comprobante lo muestra sin centavos (para el ejemplo, $2.430.113).
6. Con fianza mensual, comprobar que la fianza de cada cuota sea la de siempre: $17.921,40 en el ejemplo de $2.000.000 a 24 cuotas.

## Cambios en datos
Ninguno: no hay migraciones ni cambios en la base de datos.

## Criterios de aceptación
- En una solicitud con fianza anticipada, el monto total informado a Credifamilia es el monto solicitado más el total de la fianza, con dos decimales.
- Con el monto del ejemplo del alcance ($5.223.964, fianza 18 %) el total es $6.347.412,98. El documento de alcance muestra $6.343.651,72 porque calcula el 4x1000 sobre el IVA solo, una base que Credifamilia corrigió después.
- En una solicitud con fianza mensual, el monto total informado es igual al monto solicitado.
- El total informado coincide con el «Total a financiar» del comprobante del cliente, que lo muestra sin centavos.
- Credifamilia acepta la radicación con el total con decimales.

## Dependencias / contraparte
- Credifamilia: confirmar si el total se redondea a dos decimales o al entero superior, y si cada término se redondea por separado.
- Credifamilia: aprobar a un cliente de prueba en su ambiente de pruebas, para poder validar de punta a punta fuera de producción.
- Infraestructura: configurar el servicio de pagarés (Deceval) en QA.
