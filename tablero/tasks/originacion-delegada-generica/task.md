---
id: 109
title: "Originación delegada: riel 4 para cualquier entidad"
stage: evaluation
created: "2026-10-29T17:10:00-05:00"
knowledge: [lender-response-types, credifamilia-origination, credifamilia-financing]
canon: [entidad/context]
jira: [CORE-918]
jira_title: "Originación delegada: riel 4 para cualquier entidad"
ramas: originacion-delegada
---

## Pendientes

- [ ] Antes de prender Materiales (214) en prod: cargar sus 8 `lender_transaction_statuses` (sólo los tiene el 24;
  se cargan con `CredifamiliaConsumoSeeder`, a mano). Termina con las 8 filas del 214 medidas en prod. Lo demás
  quedó el 2026-11-09: alias `credifamilia-materiales` en `main` de pre-approvals-service y desplegado (v0.1.22);
  perfil del 214 (la migración lo había sembrado sobre el 216, Keygo; Laura lo pasó al 214) y sus 6 filas FNG
  (la siembra había dejado 0; Laura las insertó). Medido por Redash, ver la pila.
- [ ] Que el front sondee la preaprobación de Materiales como la de Salud: `fetchLenderPreApproval` sólo hace polling
  con `lender.id === 24`, y un `pending` de Credifamilia vía el alias deja la tarjeta de Materiales en error.
  Termina con una tarjeta de Materiales en qa que espera y resuelve. Depende de: front. **Visto en el front de qa
  (2026-11-03, uReq 504414):** la tarjeta de Materiales mostró «No pudimos consultar esta entidad · Reintentar»,
  mientras pre-approvals contestaba `approved` con el alias al consultarlo directo.
- [ ] Comprobar en prod si el SSR del front llama a `GET customer/requests/{id}` sin user-agent de celular: en qa ese
  pedido sale con `user-agent: node`, `RedirectIdValidationIfDesktop` lo toma por escritorio, responde 403 y puede
  mandarle al cliente el enlace de «continuar en el celular» (una vez por día).
- [ ] Que el comprobante PDF de Materiales use el payload del riel: `VoucherService` lo arma sólo para el 24 y
  `config/documents.php` enruta `voucher-disbursement` al pdf-mapper sólo para el 24; Materiales sale con el Blade
  genérico, sin fianza ni 4x1000. Revisar también `client_code` (busca la transacción del 24).
- [ ] Quitar los `TEMP DEBUG` de `CredifamiliaPreApprovalInputs`: el `base_url` del servicio y hasta 300 caracteres de
  su respuesta vuelven al cliente en `details.reason` de CALCULATION_ERROR por `payment-plan/{slug}/*`.
- [ ] Para una entidad del riel 4 que no sea Credifamilia: los que llaman al armador sin entidad (continuar solicitud,
  cuotas, resumen, comprobante, agenda de autorización, documentos) caen a Salud por `engineLenderIdFor`; una
  entidad sin perfil da 500 y, en la autorización, después del commit (queda en 11 sin radicar ni efectos); con
  firma Netco sin SigningV1 firma el juego de Credifamilia; y necesita clases propias de insumos y formalización.
  Termina cuando el pendiente de «probar una entidad del riel 4 que no es Credifamilia» lo cubre.
- [x] ~~Ligar la tarea a un issue de Jira~~ — CORE-918, creado en el sprint activo (CORE Sprint 21).
- [x] ~~Sacar la foto de antes de Credifamilia Salud (24)~~ — 3 de 3 cierran en 11 con radicación; foto en
  `artifacts/foto-antes.json` (ver «Cómo se comprueba»).
- [ ] Sacar la foto de Credifamilia Materiales: la 216 no existe en la base local. Termina con la entidad
  creada en local, igual a la 214 de prod, y su foto antes del cambio.
- [x] ~~Decidir cómo se generaliza el cálculo del plan~~ — un solo motor; por entidad, el perfil y la fuente
  de insumos (aprobado por Miguel, en la pila).
- [x] ~~Abrir `feat/originacion-delegada` desde `qa` actualizado~~ — local en legacy-backend (198387981) y
  frontend-monorepo (96741ec32), sin push; declarada en `ramas:`.
- [x] ~~Generalizar el backend~~ — pasos 1 a 4 en legacy-backend (26fe0cbe6, 05fc86d4a, e6d79b57c,
  c8e1845ea); la foto de después es igual a la de antes en cada paso.
- [ ] Probar una entidad del riel 4 que no es Credifamilia: listar opciones, elegir fecha, simular cuotas y
  autorizar sin formalización. Termina con esos pasos corridos en local. La entidad de prueba es Finandina
  (149), que ya armó #107 en local: `tablero/tasks/finandina-originacion/artifacts/finandina-local-149.sql`, el
  comercio de `harness/merchant-specs/finandina.json` y la suite `harness/suites/finandina.json`, sobre la rama
  local `feat/finandina-originacion-delegada` de legacy-backend (519495056). Ya no espera a #107: falta correr
  la suite con este código y anotar el resultado.
- [x] ~~Correr las migraciones `2026_10_30_120000` y `2026_10_30_120100` en cada ambiente~~ — en prod, batch
  245 (2026-11-10 00:43 UTC), junto con el despliegue de legacy-backend v0.6.46; `delegated_origination_profiles`
  de prod tiene la 24 y la 214 tras la corrección de Laura.
- [x] ~~Cambiar en el asistente la lista de ids por el riel~~ — frontend-monorepo 437048054; build en verde y
  la tarjeta de Credifamilia sigue mostrando el plan del backend.
- [x] ~~Abrir un PR por repo contra `qa`~~ — legacy-backend#1815 y frontend-monorepo#1314.
- [x] ~~Conseguir la revisión de los dos PRs y llevarlos a producción~~ — #1815 y #1314 mergeados a `qa` el
  2026-11-03; en `main` y desplegados el 2026-11-09: legacy-backend v0.6.46 (PR #1894) y frontend-monorepo
  v1.11.7 (PR #1374), los dos despliegues en success.
- [ ] Ver a Credifamilia Salud (24) con tráfico real después del despliegue: solicitudes que pasan por el plan de
  pago sin `CALCULATION_ERROR` ni errores de perfil en Loki prod. Termina con la medición de un día hábil. Joel
  lo valida también por la pantalla.
- [ ] Avisarle a Laura del renombre de `PaymentPlan/Credifamilia` → `PaymentPlan/DelegatedOrigination` antes de
  mergear: sus ramas abiertas sobre esos archivos van a tener conflictos. Termina con el aviso dado.
- [ ] Al llegar a `main`, actualizar las fuentes de `knowledge/lender-response-types` a las rutas nuevas y correr
  `make knowledge-check`.

## Objetivo

Que la originación delegada (riel 4, `response_type = 4`) sirva para cualquier entidad que delega en
Creditop originar con su política, y no sólo para Credifamilia. Lo que es del riel (opciones de crédito,
plan de cuotas, fechas de pago, continuar la solicitud, resumen, comprobante, firma, documentos de
legalización y cierre ante la entidad) se resuelve por la configuración de la entidad y no por sus ids. Lo
que es de la integración de Credifamilia se queda como está. Credifamilia tiene que comportarse igual que
antes: es el primer usuario del riel y está en producción. Habilita a Finandina (#107).

Lo que todavía sigue atado al 24 (el comprobante de Materiales, el sondeo de la preaprobación en el front, el
armador llamado sin entidad, la firma sin `SigningV1` y la formalización) está en Pendientes: **es parte de esta
tarea, no deuda aceptada**, y el objetivo no se cumple hasta cerrarlo.

## Dónde se toca

Inventario en `origin/main` de legacy-backend 174120193 (detalle en la pila y en
`knowledge/lender-response-types`).

**legacy-backend: las puertas ya van por tipo**
- `Modules/Loans/App/Services/LoanAuthorizationService.php:402`
- `Modules/Loans/App/Services/PaymentDateService.php:58`
- `Modules/Loans/App/Services/PaymentSchedule/ExternallyManagedPaymentScheduleService.php:120`
- `Modules/Loans/App/Http/Controllers/Customer/ContinueUserFlowController.php:226`

**legacy-backend: lo de adentro, atado a Credifamilia**
- Ids: `app/Services/PaymentPlan/Credifamilia/Constants/CredifamiliaLenders.php`, que filtran los servicios de
  `ContinueRequest`, `InstallmentPlan`, `LoanOptions`, `PaymentDates` (días 2 y 16), `PaymentPlanSummary` y
  `Voucher`.
- Cálculo: `Lender/CredifamiliaLenderProfile.php`, que tira error si el id no es de Credifamilia,
  `Engine/CredifamiliaAmortizationEngine.php` y `CredifamiliaPayloadBuilder.php` (`engineLenderIdFor`).
- Rutas: `Modules/Onboarding/routes/api.php:285-303` (`payment-plan/credifamilia/*`).
- Firma: con `SigningV1` ya es configurable por entidad, y ese camino no se toca. El hueco es el segundo paso:
  una entidad sin `SigningV1` cae al juego fijo de Credifamilia (pendiente). `PromissoryNoteController::show` prueba primero el camino
  de `SigningV1` (`netco_lender_settings.enabled`), después el juego fijo de Credifamilia
  (`CredifamiliaDocumentsBuilder`, sólo sus ids) y después el catálogo `lender_signing_documents`. En prod la 24
  firma por `SigningV1`.
- Formalización: `app/Services/Pdf/CredifamiliaFormalizationService.php` y
  `CredifamiliaLegalizationDocumentService.php`. El cierre ya es por entidad: `LenderServiceFactory`, con el
  tag `lender.services`.
- Nombres: `Modules/Backoffice/App/Support/LenderIntegrationRules.php:32` (`RESPONSE_TYPE_CREDIFAMILIA`).

**frontend-monorepo**
- `modules/loan-request-wizard/lenders-marketplace/src/lib/domain/constants/lender.constants.ts:1-14`:
  `DYNAMIC_PAYMENT_PLAN_LENDER_IDS`, con un TODO que pide una señal del payload.
- `apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx:272`: trato especial a
  `CREDIFAMILIA_LENDER_ID` en la preaprobación.
- `modules/loan-request-wizard/lenders-marketplace/src/lib/infrastructure/repositories/payment-plan.repository.ts`:
  ya llama `payment-plan/{slug}/…`.

## Cómo se ataca

1. **Foto de antes**, en local con el arnés: Credifamilia Salud y Materiales de punta a punta.
2. **Backend:**
   - las entidades del riel se buscan por tipo y no por `CredifamiliaLenders::lenderIds()`;
   - el perfil (fianza, plazos, días de pago) sale de la configuración de la entidad;
   - el cálculo del plan se resuelve por entidad;
   - las rutas pasan a `payment-plan/{slug}/…`, manteniendo las de Credifamilia mientras el front no cambie;
   - la firma y los documentos de legalización salen de la configuración de la entidad: la firma por
     `SigningV1` ya lo hace; falta que una entidad sin `SigningV1` no caiga al juego de Credifamilia, y que la
     formalización tenga clases por entidad (pendientes);
   - la constante pasa a llamarse «originación delegada».
3. **Front:** la señal del backend reemplaza la lista de ids.
4. **Foto de después** igual a la de antes, y una entidad de prueba del riel 4 que no es Credifamilia
   recorre opciones, fecha y cuotas.

## Lo que se evaluó y NO se eligió

- **Hacerlo dentro de la tarea de Finandina (#107):** un solo PR por repo mezclaría el refactor del riel con
  la configuración y el cierre de Finandina, y no se podría probar que Credifamilia sigue igual antes de
  sumar otra entidad.
- **Copiar las piezas de Credifamilia para Finandina:** duplica el riel y deja dos implementaciones que se
  separan con el tiempo.

## Lo que NO entra

- La integración de Credifamilia: radicación SOAP, CrossCore, Evidente, Jumio, el reporte de bonificación,
  su adaptador en pre-approvals-service y el disparo de Experian para la 24.
- Lo propio de Finandina: su configuración, su clave en pre-approvals-service y su servicio de cierre (#107).

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

En local, con legacy-backend en `feat/originacion-delegada`, la base migrada y los mocks de Credifamilia arriba
(:8100 pdf-mapper, :8106 Deceval, :8107 Netco, :8108 radicación) más el de centrales (:8105):

1. Cerrar casos de Credifamilia Salud en serie (sin `PAR=1`, que reproduce el deadlock de la firma):

       E2E_TARGET=local make harness-suite SUITE=harness/suites/credifamilia.json CLOSE=1 LAMBDA=1 TARGET=local

   Imprime el `uReq` de cada caso.
2. Sacar la foto de esas solicitudes: los seis endpoints del plan de pago (continuar, fechas, cuotas,
   opciones, resumen, comprobante), los documentos firmados, el pagaré y la radicación, sin los campos que
   cambian en cada corrida:

       python3 tablero/tasks/originacion-delegada-generica/artifacts/foto.py credifamilia <uReq…> > foto-despues.json

3. Comparar con `diff` contra `artifacts/foto-antes.json`, el mismo día: las fechas de pago dependen de hoy.
   Después del cambio de rutas, el `slug` del paso 2 pasa a ser el de la entidad.

Dos migraciones de vistas de reportes (`2026_10_22_210000`, `2026_10_23_120000`) no corren en la base
local porque la vista del dump es distinta a la esperada. No tocan el riel 4.

## Referencias

- Tarea #107 (Finandina), que depende de esta.
- `knowledge/lender-response-types`; canon `entidad/context#el-eje-que-decide-todo-es-el-tipo-de-respuesta`.


## Tarea (publicable)

## En una línea
Que la originación delegada (riel 4) sirva para cualquier entidad que nos delega originar con su política, y no sólo para Credifamilia.

## Por qué
Hoy el riel 4 se activa por el tipo de la entidad, pero cada paso de adentro (opciones de crédito, plan de cuotas, fechas de pago, resumen, comprobante, firma y documentos de legalización) está atado a Credifamilia. Una segunda entidad de ese riel, como Banco Finandina, no puede usarlo sin duplicarlo.

## Qué cambia
- Los pasos del riel se resuelven por la configuración de la entidad, no por su identificador.
- El cálculo del plan de cuotas puede ser distinto por entidad.
- La firma y los documentos de legalización salen de la configuración de la entidad.
- El asistente deja de decidir por una lista fija de entidades quién calcula la cuota.

## Alcance
No cambia la integración propia de Credifamilia (radicación, validación de identidad, reportes) ni incluye la configuración de Finandina, que va en su propia tarea.

## Dónde probar
En local primero; después en qa, con Credifamilia Salud y Materiales.

## Cómo validar
- Recorrer Credifamilia Salud y Materiales de punta a punta antes y después del cambio, y comparar opciones de crédito, fechas de pago, cuotas, documentos firmados y formalización: tienen que ser iguales.
- Recorrer una entidad de prueba del riel 4 que no sea Credifamilia y comprobar que muestra opciones, deja elegir fecha y simula las cuotas con su configuración.

## Cambios en datos
Una tabla nueva con la configuración de cada entidad de este riel, y una carga inicial con los valores de Credifamilia Salud y Materiales. Tiene que aplicarse en cada ambiente antes o junto con el despliegue del código: sin esa carga, Credifamilia no calcula su plan de pago.

## Criterios de aceptación
- Credifamilia Salud y Materiales se comportan igual que antes en todo el recorrido.
- Una entidad nueva del riel 4 recorre opciones, fecha de pago y plan de cuotas sin código propio de Credifamilia.
- Ningún paso del riel depende de los identificadores de Credifamilia.

## Dependencias / contraparte
Ninguna externa. Habilita la integración de Banco Finandina.
