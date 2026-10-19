---
id: 100
title: "Incidencias"
clase: proyecto
stage: evaluation
created: "2026-10-09T15:30:00-05:00"
knowledge: []
canon: [kyc/context, ecommerce/context, cartera/context, creditopx/context, formalizacion/context]
jira: []
jira_title: ""
ramas: fix/cuota-inicial-no-supera-el-total
---

## Pendientes

Cada casilla es un defecto de los sistemas de CreditOp encontrado al verificar `main`. Se cierra cuando
se reproduce (o se descarta con evidencia) y, si es real, cuando tiene su tarea con Jira o su PR.
Salvo donde se dice «corrido», salen de LEER el código: falta reproducirlos.

### Alta — el cliente o el dinero se ven afectados

- [x] ~~Abrir los PRs del tope de la cuota inicial~~ — [legacy-backend#1643](https://github.com/Creditop-SAS/legacy-backend/pull/1643)
  y [frontend-monorepo#1169](https://github.com/Creditop-SAS/frontend-monorepo/pull/1169), contra `qa`: la pantalla dejaba
  pagar una cuota inicial mayor que la compra y el backend la cobraba; la solicitud recién se frenaba al firmar.
- [ ] Probar en `qa` el tope de la cuota inicial cuando se mergeen #1643 y #1169. Termina con una compra donde una
  cuota inicial mayor que el total se rechaza en la pantalla y, por API, con `AMOUNT_ABOVE_TOTAL`.
- [ ] Reproducir que, en el sistema nuevo, los estados 8, 9 y 16 de ADO (documento alterado, documento
  falso, persona en listas de control) terminan en error de servidor en vez de en un rechazo. Termina
  cuando un caso con ADO dictado a cada estado muestra qué responde la consulta de estado y qué pantalla
  ve el cliente. Origen: `match` sin `default` y `catch (\Exception)` que no atrapa `UnhandledMatchError`.
- [x] ~~Reproducir que fuera de la tienda se firma el pagaré sin la cuota inicial pagada~~ — descartado corriendo
  (2026-10-13): fuera de la tienda el asistente NUNCA manda a la pasarela, porque sólo va a la cuota inicial cuando el
  backend contesta «cuota inicial pendiente», y eso sólo pasa con orden de tienda. No hay pago que saltarse.
- [ ] Decidir con producto quién registra la cuota inicial fuera de la tienda. Corrido en local (asesor y autogestión,
  CrediPullman «Segunda oportunidad», 25 %): el crédito sale por el 75 % (`final_amount` 1.500.000 de 2.000.000) pero
  `initial_fee` queda en 0 y nada pide ni anota el cobro de esos 500.000. Termina con la decisión: ¿lo cobra el
  comercio por fuera (y alguien lo registra), o la compuerta de pago debe aplicar a todos los canales?
- [ ] Reproducir que, al pasarse del tope de ADO (5 validaciones por persona en 24 horas), el asistente
  manda a «solicitud cancelada» y cancela la solicitud del titular sin decir por qué ni dejar un código
  que distinga el tope. Termina con el caso corrido y la decisión de cómo mostrarlo.
- [x] ~~Confirmar que, si al autorizar ningún perfil aplica, el sistema viejo autoriza el crédito CreditopX sin cargarle
  cupo mensual~~ — confirmado en el código de los dos monolitos y medido en prod (2026-10-13): el viejo lo deja pasar a
  propósito con un aviso en el log; el nuevo rechaza con 422. El camino viejo está vivo (338 créditos en 60 días, 31 en
  octubre), pero el aviso no apareció en los logs de prod en 16 días.
- [ ] Decidir si el sistema viejo debe rechazar como el nuevo cuando ningún perfil aplica al autorizar, o si el nuevo
  debe dejar pasar como el viejo: hoy el mismo caso da resultados distintos según por cuál firma el cliente. Baja
  frecuencia (el listado ya filtra por categoría; sólo pasa si la política cambia entre el listado y la firma).

- [ ] Decidir qué pasa en el flujo nuevo (pipeline de KYC v2) cuando caen Ágil Data, Mareigua y TusDatos: ninguna
  confirma la identidad, el cliente queda temporal, el pipeline pide los datos laborales y el endpoint los rechaza con
  ONB002 («temporal user found»), así que la solicitud espera hasta vencer. CORRIDO en local (2026-10-19, caso 19 de
  `make harness-pipeline-run`). En el flujo viejo, según el código, se guarda el nombre escrito y sigue. Termina con la
  decisión y su tarea. Origen: `OnboardingController::storeLaboralInfoOrchestrator` rechaza temporales.

### Media — comportamiento distinto al esperado

- [ ] Corregir el `redirect-url` del cobro de cuota inicial, quemado a la ruta de ecommerce aunque la solicitud sea
  del asesor. CONFIRMADO (2026-10-13): en local el canal del asesor llega al cobro viejo (`initial-fee-payment`) con
  una entidad que no es CreditopX y cuota inicial tecleada en el listado (Pullman + Sistecrédito, 467337), y
  `InitialFeePaymentService` arma la vuelta como `ecommerce/<hash>/<solicitud>/down-payment-validation/<tx>` sin
  mirar el canal. Termina cuando la vuelta de la pasarela de un cobro del asesor cae en su flujo.
- [ ] Decidir qué ve el comprador cuando la sucursal no tiene credencial de pasarela. Corrido en local (2026-10-13): el
  backend ya NO contesta 500 —desde el 2026-09-09 rechaza con 422 `LENDER_CONFIGURATION_NOT_FOUND` antes de crear nada,
  y el preview manda `payment_enabled`—, pero la pantalla de cuota inicial no usa ese dato y muestra el error genérico
  «No pudimos iniciar tu pago. Intenta de nuevo.», que invita a reintentar algo que nunca va a funcionar.
- [ ] Revisar la elección de credencial de Deceval: crear y firmar el pagaré eligen la credencial cada uno
  por su cuenta y al azar (`inRandomOrder`) cuando califican varias, así que la firma puede usar otra que la
  que creó el pagaré. Termina sabiendo si Deceval lo rechaza y cuántos comercios tienen más de una.
- [ ] Corregir el resumen de una refinanciación, que cuenta dos veces los gastos de cobranza (como concepto
  propio y dentro del descuadre, porque el total ya los incluye). Lo que se escribe en el crédito sale bien;
  lo que se ve en la simulación y en la bitácora, no.
- [ ] Decidir si la regla `NonOverlappingCollectionChargeRange` se usa: existe, nada la invoca, y los tramos
  de cobranza no tienen pantalla, así que dos tramos traslapados se cobrarían los dos.
- [ ] Revisar que la refinanciación calcula la primera fecha con lógica mensual aun en créditos semanales o
  quincenales. Termina con la decisión de si debe usar el calendario de cortes de la entidad.
- [ ] Revisar los avisos de CreditopX que quedan pendientes: ya no hay tarea programada que los reintente,
  y sólo salen si otra petición toca a la misma persona o alguien llama la ruta interna. Termina con la
  decisión de quién los recupera (Entitlement por Temporal, según su repo) y la guía actualizada.
- [ ] Sacar del front la llamada a las rutas de cambio de celular de la firma, que se revirtieron del
  backend junto con el auto-onboarding de ecommerce: hoy cada carga de la pantalla del código pide una ruta
  que no existe (la pantalla lo tolera y no ofrece el cambio).

### Baja — documentación y comentarios que dicen lo contrario del código

- [ ] Corregir el comentario de `ValidateInitialFeePaid` («fuera de ecommerce la cuota inicial nunca pasa
  por la pasarela»): el front nuevo y la autogestión del viejo sí la cobran por la pasarela.
- [ ] Corregir el comentario de `RefinanceCredit` que dice que el total no incluye la cobranza (sí la
  incluye desde que el proceso nocturno la suma al total).
- [ ] Actualizar la guía y la configuración del outbox de CreditopX, que describen una entrega cada minuto
  que ya no existe.
- [ ] Corregir el comentario de `LenderRetrievalService` (legacy-backend, cerca de la línea 62), que dice que
  el motor suma lo colocado en memoria.
- [ ] Corregir el comentario de `AbacoConsultStateResolver` («vale 1 mes»): el código usa 7 días por defecto.

### Seguridad — decidir con el equipo

- [ ] Decidir cómo frenar el abuso del pre-registro de comercios: el token de servicio viaja en la página y
  el único límite es por correo, así que un programa que cambie el correo en cada envío no tiene freno.
  Termina con la decisión (captcha, límite por origen detrás del gateway u otro).
- [ ] Encender el interruptor que exige el identificador firmado en la vista previa del pago: apagado por
  omisión, el número de solicitud (consecutivo) sigue devolviendo el nombre completo del titular.

### Seguridad — el admin de legacy-application (salen de LEER `main` 05e6ad4d; mapa en `knowledge/admin-panel`)

- [ ] Poner chequeo de permiso a las acciones del admin que ESCRIBEN y hoy sólo exigen estar logueado: la baja de
  Usuarios (`UserController::disableUser`, además por GET) y la de usuarios comerciales, desactivar una entidad
  (`LenderController::destroy`), borrar credenciales de integración (`CredentialsController::destroy`, borrado real),
  las reglas y la frecuencia de Datacrédito, el disparador del punto de venta (`updateTrigger`), cambiar el estado de
  una solicitud al gestionarla (`UserRequestController::update`), la validación manual (`/validacion-manual`, pasa a
  10 o a 6) y los envíos de mensajes de marketing. Termina cuando cada una tiene su FormRequest o policy con el
  permiso que ya usa el menú, o se descarta con el motivo.
- [ ] Cerrar el alcance de las lecturas y acciones por id en la URL: el detalle de un crédito CreditopX y el
  bloqueo, desbloqueo y PIN del celular financiado (`deviceManagement`, `devicePinUnlock`), los documentos de
  identidad de un usuario (`getUserDocument`), su formulario y sus solicitudes. Termina cuando un rol de comercio no
  puede abrirlas para un cliente de otro comercio.
- [ ] Revisar las listas que no filtran por rol: Usuarios (sólo recorta a Entidad Comercio), Links de pago (sólo al
  perfil 6) y Revisión de perfilamiento. Termina con la decisión de qué ve cada rol.
- [ ] Sacar las rutas de desarrollo del admin o protegerlas: `/test-perfilamiento`, `/create-profiling` (termina en
  `dd()` y sube el límite de memoria) y `/pruebas-modelo`, las tres sin chequeo. Termina cuando no responden en un
  ambiente desplegado.

### Admin — comportamiento distinto al esperado

- [ ] Alinear los permisos del menú con los del backend: «Usuarios» se muestra con `view list of users` y su listado
  exige `view users`; Reportes y las vistas de CreditopX tienen el mismo desfase. Termina con una lista de los pares
  y la decisión de cuál manda.
- [ ] Corregir el filtro de Autorizaciones para Admin comercio: compara `allied_branch_id` con una colección
  (`where` en vez de `whereIn`, `AuthorizationController` ~28). Termina reproducido o descartado con un Admin comercio
  de varias sucursales.
- [ ] Sacar el `dd($exception)` de `PaymentLinkController::store` (~86): si falla el alta, el admin muestra el volcado
  de la excepción en vez de un error. Termina cuando un fallo forzado muestra un mensaje.

## Objetivo

Que ningún defecto encontrado al verificar el código se pierda en una conversación. Este contenedor junta
los que salen al recontextualizar el corpus del equipo o al contestar una pregunta, con la evidencia para
reproducirlos, hasta que cada uno pase a su propia tarea con Jira o se descarte.

## Dónde se toca

| defecto | repo | dónde |
|---|---|---|
| ADO 8/9/16 → error de servidor | legacy-backend | `Modules/Identity/App/Services/AdoService.php` (`mapAdoState`, ~202-219; catch en ~121) y `ValidationStatusService.php` (~217) |
| tope de ADO cancela sin motivo | frontend-monorepo · legacy-backend | `identity-validation.repository.ts` (~286-292), `identity-validation-instructions.tsx` (~240-242), `retry-validation.tsx` (~65), `request-canceled.tsx` (~47-54); `app/Http/Middleware/ValidateRiskCentralAttempts.php` |
| firma sin cuota inicial fuera de tienda | legacy-backend · frontend-monorepo | `Modules/Loans/App/Http/Middleware/ValidateInitialFeePaid.php` (~82-86); `available-lenders.tsx` (~711) |
| `redirect-url` y 500 del cobro | legacy-backend | `Modules/Loans/App/Services/InitialFeePaymentService.php` (~294 credencial, ~327 redirect) |
| autorizar sin cargar cupo | legacy-application | `CreditopXRequestHistoryController` / servicio de autorización (~1104-1115) |
| credencial de Deceval al azar | legacy-backend · legacy-application | `app/Models/RiskCentralCredential.php` (~82-107); `Modules/Loans/App/Actions/DecevalSoap.php` (~55-59 y ~162-166) |
| refinanciación (doble conteo, fecha mensual) | legacy-application | `app/Actions/CreditopX/RefinanceCredit.php` (~57-79, ~273-290) |
| tramos de cobranza | legacy-application | `LenderCollectionChargeService.php`; la regla `NonOverlappingCollectionChargeRange` |
| avisos pendientes de CreditopX | legacy-backend · legacy-application | `CreditopXEventPublisher.php`, `CreditopXDeliveryWake.php`, `app/Console/Kernel.php`; `docs/creditopx-event-outbox.md`, `config/creditop_x_events.php` |
| cambio de celular en la firma | frontend-monorepo | `promissory-note.repository.ts` (~190-240), `otp-validation.tsx` (~100-130) |
| pre-registro de comercios | legacy-backend · frontend-monorepo | `EnsureAlliedPreRegistrationToken.php`, `Modules/AlliedV1/App/Providers/RouteServiceProvider.php`; `apps/landing/src/lib/merchant-signup-form.ts` |
| vista previa del pago | legacy-backend | `Modules/Loans/routes/api.php` (~179), `WompiPaymentController.php` (~82-103), `config/services.php` (~352) |

Las líneas son de `origin/main` del 2026-10-09 (legacy-backend `7d0be305`, legacy-application `d0a3a430`,
frontend-monorepo `33941936`): se mueven, así que se ubican por el nombre.

## Cómo se ataca

1. Reproducir antes de abrir nada: `make harness-case` con el caso que corresponda, contra `local`
   (`TARGET=local` explícito), y dictando la central de riesgo por cédula cuando el defecto depende de ADO.
2. Si se reproduce: tarea propia con Jira (`make jira-create`), y la casilla de acá se marca con el issue.
3. Si no se reproduce: la casilla se marca con la corrida que lo descarta, y la regla correcta va al
   conocimiento local si hace falta.

## Lo que NO entra

- Las mejoras de las herramientas del playground: van a su contenedor (`canon`, `harness`, `tablero`…).
- Lo que ya tiene tarea con Jira: se enlaza, no se duplica.
- La prosa del corpus del equipo: lo que ya quedó corregido en canon no es una incidencia.

## Referencias

- [ADO: tope por persona](canon:kyc/context#el-tope-de-ado-cuenta-validaciones-iniciadas-por-persona-en-24-horas-no-por-solicitud) ·
  [ADO: estados](canon:kyc/context#el-estado-de-ado-decide-el-desenlace-y-los-dos-sistemas-no-leen-el-mismo-catalogo)
- [Cuota inicial y compuerta de la firma](canon:ecommerce/context#en-tienda-la-cuota-inicial-la-cobra-la-pasarela-y-la-firma-espera-a-que-se-pague)
- [Refinanciación](canon:cartera/context#la-refinanciacion-condona-todo-lo-que-no-es-capital) ·
  [Cobranza por tramo](canon:cartera/context#el-gasto-de-cobranza-se-cobra-al-entrar-a-cada-tramo-de-mora)
- [Cupo mensual](canon:creditopx/context#un-perfil-sin-cupo-del-mes-rechaza-y-el-motor-no-pasa-al-siguiente-perfil) ·
  [Avisos de CreditopX](canon:creditopx/context#los-avisos-de-creditopx-salen-al-terminar-la-peticion-en-orden-por-persona)
- [Emisor del pagaré](canon:formalizacion/context#el-pagare-queda-a-nombre-del-emisor-de-la-credencial-con-que-se-firma)
