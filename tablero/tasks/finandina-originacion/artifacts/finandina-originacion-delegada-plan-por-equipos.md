# Banco Finandina sobre la originación delegada: cómo se atacó y cómo se reparte

> **Para:** Oscar · **De:** Miguel Ochoa (Loan Origination) · **Fecha:** 2026-11-03
> **Jira:** CORE-845 (Finandina) · CORE-918 (generalización del riel 4)
> **PRs:** [legacy-backend#1815](https://github.com/Creditop-SAS/legacy-backend/pull/1815) ·
> [frontend-monorepo#1314](https://github.com/Creditop-SAS/frontend-monorepo/pull/1314) (rama `feat/originacion-delegada`, contra `qa`)
>
> Está escrito para que lo revise una persona o un agente. Cada afirmación técnica lleva la ruta y la rama donde
> se comprueba, y la sección 9 lista qué verificar y cómo. Lo que **no** está comprobado se dice.

---

## 1. Resumen

- **Finandina es del tipo 4, no del 2.** El tipo de una entidad (`lenders.response_type`) dice **de quién es
  la política de crédito**. En el 2 y el 3, Creditop define cómo se presta (CreditopX). En el 4, la entidad
  nos dice cómo presta y Creditop origina por ella: decide con su política, firma por nuestros rieles y le
  entrega la operación. Finandina dicta su política, origina con su nombre y desembolsa. Es tipo 4.
- **El tipo 4 sólo servía para Credifamilia.** Se entraba por el tipo, pero todo lo de adentro estaba atado
  a los ids de Credifamilia: opciones, cuotas, fechas (días 2 y 16), resumen, comprobante y radicación. Al
  autorizar, cualquier otra entidad del tipo 4 recibía la radicación de Credifamilia y terminaba en un 422.
- **Primero se generalizó el riel (CORE-918, ya en PR), después va Finandina (CORE-845).** Después del
  refactor, sumar Finandina es **una fila de configuración más dos clases**: de dónde salen sus insumos y
  cómo se le entrega la operación. No hay que duplicar el riel.
- **Cómo se reparte:** el corte es el **listado de entidades**. **Core** lleva a Finandina hasta el listado
  con una oferta preaprobada. **CreditopX** la lleva desde que el cliente la elige hasta el estado 11. El
  contrato entre los dos equipos es **qué devuelve la preaprobación** (sección 6.3).

---

## 2. El criterio de los rieles (lo que se acordó con Laura y Joel)

| `response_type` | Nombre | ¿De quién es la política? | Quién origina | Ejemplos |
|---|---|---|---|---|
| 0 | Redirección | de la entidad | la entidad, en su sitio | Addi, Sistecrédito |
| 1 | Integrada | de la entidad | la entidad, por su API | Welli, Meddipay |
| 2 | CreditopX consumo | **de Creditop** | Creditop | |
| 3 | CreditopX rotativo | **de Creditop** | Creditop | |
| 4 | **Originación delegada** | **de la entidad** | **Creditop, por la entidad** | Credifamilia y ahora Finandina |

- `externally_serviced` es **otro eje**: quién cobra la cartera. No cambia de quién es la política. Un tipo 2
  con cartera de otro (DENTIX, DFS, Alta Fleet) sigue usando la política de Creditop.
- El criterio está documentado en el conocimiento del equipo: en canon, `entidad/context#el-eje-que-decide-todo-es-el-tipo-de-respuesta`.

---

## 3. Cómo se atacó la tarea

1. **Primera propuesta (28-10): tipo 2 con `externally_serviced = 1`.** Permitía decidir sin código nuevo.
   **Se descartó:** el tipo 2 aplica la política de Creditop, y Finandina dicta la suya. Además ese riel no
   tiene dónde entregarle la operación a la entidad, y al autorizar cancela las otras solicitudes
   pendientes del cliente. Laura y Joel corrigieron el criterio (sección 2).
2. **El tipo 1 tampoco sirve:** Finandina no tiene una API que decida, y la firma no ocurre en su propio flujo.
3. **Se midió el tipo 4 en el código.** Las puertas ya preguntaban por el tipo:
   - `LoanAuthorizationService`
   - `PaymentDateService`
   - `ExternallyManagedPaymentScheduleService`
   - `ContinueUserFlowController`

   Pero **todo lo de adentro filtraba por los ids de Credifamilia**:
   - `CredifamiliaLenders::lenderIds()`
   - `CredifamiliaLenderProfile`, que fallaba con cualquier otro id
   - las rutas `payment-plan/credifamilia/*`
   - en el front, la lista `DYNAMIC_PAYMENT_PLAN_LENDER_IDS`
   - al autorizar, la radicación SOAP de Credifamilia para todo tipo 4

   **Conclusión:** Finandina en el tipo 4 sin refactor **no completa el plan de pago y falla al autorizar**.
4. **Se decidió separar el refactor en su propia tarea (CORE-918).** Hacerlo dentro de Finandina habría
   mezclado en un solo PR el cambio del riel con la configuración de una entidad nueva. Además, no se podría
   probar que Credifamilia, que está en producción, quedaba igual antes de sumar otra entidad. Copiar las
   piezas de Credifamilia para Finandina se descartó porque deja dos implementaciones que divergen.
5. **Refactor por pasos, probando cada uno.** Antes de tocar nada se tomó una foto de Credifamilia Salud de
   punta a punta: los seis endpoints del plan de pago, los documentos firmados, el pagaré y la radicación.
   Después de cada paso se comparó con esa foto, y en todos los pasos salió **idéntica**.

---

## 4. El PR: «Originación delegada» (CORE-918)

### Qué problema resuelve

El riel 4 se activaba por el tipo de la entidad, pero cada paso estaba atado a Credifamilia. Una segunda
entidad del riel no podía usarlo sin duplicarlo.

### Qué cambia (legacy-backend #1815)

| Commit | Cambio |
|---|---|
| `26fe0cbe6` | **Rutas por slug.** Las rutas pasan a `payment-plan/{lender_slug}/…` (continuar, fechas, cuotas, opciones, resumen, comprobante). La entidad se resuelve con `DelegatedOriginationLenders::findBySlug`: debe existir y ser del tipo 4. Si no, responde el código de error `CP011`. Las rutas de Credifamilia siguen funcionando. |
| `05fc86d4a` | **El perfil pasa a una tabla:** `delegated_origination_profiles`, una fila por entidad (ver abajo). Dos migraciones: crear la tabla y sembrar Credifamilia Salud y Materiales. |
| `e6d79b57c` | **Fuentes de insumos.** La tasa, el seguro, el monto máximo y la fianza salen de la fuente que nombra el perfil (interfaz `DelegatedOriginationInputs`, registro `DelegatedOriginationInputsSources`). Credifamilia usa `CredifamiliaPreApprovalInputs`, que lee su preaprobación. |
| `c8e1845ea` | **Formalización por registro.** Al autorizar, `LoanAuthorizationService` usa la formalización que nombra el perfil (interfaz `DelegatedOriginationFormalization`, registro `DelegatedOriginationFormalizations`). **Si el perfil no tiene formalización, no radica y lo deja en el log**: ya no le aplica a otra entidad el paquete de Credifamilia, que era lo que daba el 422. |
| `ce45c5d72` | **Renombre:** la carpeta `app/Services/PaymentPlan/Credifamilia/` pasa a `app/Services/PaymentPlan/DelegatedOrigination/`. Lo propio de Credifamilia (su preaprobación, su radicación SOAP) queda en su lugar. |
| `9081bb7fb` | **Limpieza:** una sola constante, `DelegatedOriginationLenders::RESPONSE_TYPE = 4`. Las pruebas pasan a la carpeta del riel, y los textos del riel (opciones, comprobante) usan el nombre de la entidad en vez de «Credifamilia». |

**La tabla `delegated_origination_profiles`.** Es lo que cambia entre entidades **sin escribir código**:

| Columna | Qué decide | Credifamilia Salud (24) | Credifamilia Materiales (214 en prod, 216 en el resto) |
|---|---|---|---|
| `bond_percentage_source` | de dónde sale el % de fianza: `pre_approval` o `fng_table` | `pre_approval` | `fng_table` |
| `forced_bond_type` | tipo de fianza fijo, si lo hay | — | `Anticipada` |
| `applies_four_per_thousand` | si cobra 4x1000 | `true` | `false` (Santi lo pasa a `true`; ver sección 8) |
| `payment_days` (JSON) | los días de pago que se ofrecen | `[2, 16]` | `[2, 16]` |
| `inputs_source` | clave de la fuente de insumos | `credifamilia_pre_approval` | `credifamilia_pre_approval` |
| `formalization` | clave de la entrega al autorizar | `credifamilia_radication` | `credifamilia_radication` |

> Valores tomados de la migración `2026_10_30_120100_seed_delegated_origination_profiles_for_credifamilia`.

### Qué cambia (frontend-monorepo #1314)

`supportsDynamicPaymentPlan(responseType)` decide quién calcula la cuota en el backend preguntando por el
riel (`=== LENDER_RESPONSE_TYPE.DELEGATED_ORIGINATION`, que vale 4). Antes usaba la lista fija de ids de
Credifamilia, y además `LenderResponseType` no incluía el 4.

### Cómo se validó

- **Foto de antes y después de Credifamilia Salud, de punta a punta (en local).** Tres casos llegan al
  estado 11 con radicación. Los seis endpoints del plan de pago, los documentos, el pagaré y la radicación
  salen **idénticos** antes y después de cada commit. En la tarjeta, la cuota da los mismos valores
  ($433.652 a 6 meses y $128.323 a 24).
- **Pruebas del área en legacy-backend:**
  - las del riel pasan;
  - algunas fallas vienen de antes del cambio y salen igual en `qa`: 7 de la radicación SOAP, más las de
    `PaymentDateServiceTest` y `OnboardingPayloadBuilderTest`. No las introduce este PR.
- **Front:** `build` y `tsc` en verde. Vitest falla en local también sobre `qa` limpio
  (`__vite_ssr_exportName__`), así que es un problema previo del entorno y no de este cambio.
- **No validado todavía:**
  - un recorrido con una entidad del tipo 4 que no sea Credifamilia (la primera va a ser Finandina en qa);
  - el PR en `qa` con QA (Duncan).

### Despliegue

1. **Correr las dos migraciones del perfil antes del código**, en cada ambiente. Mergear no las aplica. Sin
   la siembra, Credifamilia no calcula su plan de pago. En dev, qa y staging basta correrlas una vez porque
   comparten la base. En prod se corren aparte.
2. Mergear primero el PR de Santi (sección 8), después #1815 y #1314.
3. Validar en `qa` con Credifamilia Salud y Materiales.

### Qué NO cambia

La integración propia de Credifamilia: radicación SOAP, CrossCore, Evidente, Jumio, el reporte de
bonificación, su adaptador en pre-approvals-service y el disparo de Experian.

### Lo que sigue atado a Credifamilia y queda fuera de este PR

Ninguno de estos puntos bloquea el riel. Están anotados para el reparto de la sección 6.

- `frontend-monorepo` `apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx:271`: en
  la preaprobación, sólo Credifamilia no se cancela con la señal de la petición, porque su llamada es larga.
  Esto es **del listado**.
- `frontend-monorepo` `modules/loan-request-wizard/lenders-marketplace/src/lib/domain/entities/lender-transaction-status.entity.ts:64`:
  la forma de leer el estado de la transacción tiene un caso propio para Credifamilia.
- `legacy-backend` `Modules/Onboarding/App/Services/lenders/PreApprovedLenderService.php:309-319`: el registro
  de Credifamilia en la preaprobación. Es propio de su integración.

---

## 5. Cómo encaja Finandina después del refactor

**Sin el refactor**, Finandina en el tipo 4 no completaba el plan de pago y le daba 422 al autorizar.
**Con el refactor**, entra así:

| Pieza del riel | Cómo la resuelve Finandina | ¿Código nuevo? |
|---|---|---|
| Pertenecer al riel | lender 149 con `response_type = 4` | no, es configuración |
| Rutas del plan de pago | `payment-plan/{slug-de-finandina}/…` funcionan solas | no |
| Días de pago | `payment_days = [5, 10, 15, 20]` (los de sus T&C; **falta confirmarlo con producto**) | no, es una fila |
| Fianza (aval FGA) | `bond_percentage_source = pre_approval`. El 5 % o el 9 % según el score lo da la preaprobación | no, es una fila |
| 4x1000 | `applies_four_per_thousand`, según su política | no, es una fila |
| Insumos (tasa, seguro de vida, monto máximo, % de fianza) | **una clase nueva** que implementa `DelegatedOriginationInputs` y lee la preaprobación de Finandina, registrada con su clave en `DelegatedOriginationInputsSources` | **sí, una clase** |
| Firma (formulario de vinculación, T&C, pagaré) | ya era configurable por entidad. `PromissoryNoteController::show` prueba SigningV1 (`netco_lender_settings`) y después el catálogo `lender_signing_documents`. Para el pagaré en Deceval con Finandina como beneficiaria: `promissory_type_id = 2` y la credencial de Finandina | no, es configuración, más las plantillas de los documentos |
| Entrega al autorizar | **una clase nueva** que implementa `DelegatedOriginationFormalization`, registrada con su clave en `DelegatedOriginationFormalizations` | **sí, una clase**, según cómo se acuerde la entrega |
| Textos (opciones, comprobante) | salen con el nombre de la entidad | no |

**Un punto que destraba la fase 1.** En la fase 1 la entrega es manual: el analista de Finandina descarga
las operaciones del dashboard de Creditop y crea los préstamos por PQR. En ese caso el perfil puede salir
con `formalization = null`. La autorización no radica nada, lo deja en el log y no falla. Así **Finandina
puede llegar al estado 11 sin esperar la integración de la entrega**, y la clase de formalización entra
cuando haya un canal automático. Esto **lo tiene que aceptar producto**: depende de qué significa
«autorizada» para Finandina (sección 7).

---

## 6. Reparto entre equipos

**El corte es el listado de entidades.**

- **Core:** hasta que el cliente ve a Finandina en el listado con una oferta preaprobada, o no la ve porque
  no cumple.
- **CreditopX:** desde que el cliente elige a Finandina hasta el estado 11, con la operación entregada.

```
Cliente ─▶ entrada del comercio ─▶ KYC / identidad ─▶ buró (Experian, Mareigua) ─▶ LISTADO + preaprobación ─┃─▶ elige Finandina ─▶ plan de pago ─▶ firma ─▶ autorización (11) ─▶ entrega a Finandina
└────────────────────────────── CORE ──────────────────────────────────────────────────────────────────────┘ └──────────────────────────────── CREDITOPX ──────────────────────────────────────┘
```

### 6.1 Core: hasta el listado

| # | Trabajo | Depende de |
|---|---|---|
| C1 | Configurar la 149 como tipo 4 y asignarla a los comercios de la fase 1 | — |
| C2 | Filtros de visibilidad del listado: edad 21–64, empleado o pensionado, ingreso ≥ 1 SMMLV, municipios de la tabla de zonas (por DANE) | decidir si los independientes entran (la política dice que no; el mapa de campos dice que sí) |
| C3 | Consultar Experian y Mareigua **con las llaves de Finandina**: credencial propia de la entidad, y riesgo del empleador de Mareigua | la entrega de las llaves |
| C4 | Identidad ADO (biometría, listas y fraude) en el camino de Finandina | — |
| C5 | Llamar a la preaprobación con la clave `banco-finandina` en pre-approvals-service y mostrar la oferta o el rechazo en el listado | que la clave exista (6.3) |
| C6 | En el front, revisar el trato especial de la preaprobación de Credifamilia (`available-lenders.tsx:271`) por si la preaprobación de Finandina también es lenta | que se mida su latencia |

### 6.2 CreditopX: del listado al 11

| # | Trabajo | Depende de |
|---|---|---|
| X1 | La fila de Finandina en `delegated_origination_profiles`: días de pago, origen de la fianza y 4x1000 | días de pago y FGA (producto) |
| X2 | La fuente de insumos de Finandina: la clase que convierte su preaprobación en el vocabulario del motor (`annual_effective_rate`, `life_insurance_percentage`, `max_amount`, `guarantee_percentage`, `guarantee_type`) | el contrato 6.3 |
| X3 | Plan de pago: opciones, fechas, cuotas, resumen y comprobante. **Ya funciona por el riel**: queda configurar y validar en qa | X1 y X2 |
| X4 | Firma: formulario de vinculación, T&C y pagaré en Deceval con Finandina como beneficiaria | las plantillas corregidas (observaciones del mapa de campos), la certificación de Deceval (CRED-463) |
| X5 | Autorización y entrega: `formalization = null` en la fase 1 (manual), o la clase de entrega si hay canal | la decisión de qué es «autorizada» y cómo se entrega |
| X6 | Lo que Finandina ve después: el dashboard o archivo de operaciones de la semana | el acuerdo con Finandina |

### 6.3 El contrato entre los dos equipos: la preaprobación

La política de Finandina (capacidad de pago, veces el ingreso por segmento, experiencia por monto, score
646, FGA) se decide **en la preaprobación**. Esa preaprobación corre en el listado, pero lo propuesto es
que la ejecute **el motor de cupo de CreditopX**: el adaptador `creditop_x` en pre-approvals-service, con la
clave `banco-finandina`.

- **Lo que hay que acordar:** la respuesta aprobada debe traer en `transaction_data` la tasa, el seguro de
  vida, el monto máximo, y el % y el tipo de fianza. Eso es lo que lee la fuente de insumos (X2).
- **Con esto, Core sólo llama y muestra, y CreditopX es dueño de la política y del cálculo.** Es la misma
  frontera que ya tiene Credifamilia: su preaprobación llena `transaction_data` y el riel la lee con
  `CredifamiliaPreApprovalInputs`.

> **Decisión para Oscar.** ¿La política de Finandina dentro del motor de cupo la lleva CreditopX, por ser su
> motor, o Core, porque se ejecuta antes del listado? La propuesta es que la lleve **CreditopX**. Core
> entrega los datos (C3 y C4) y la llamada (C5). Así la política y el plan de pago quedan en el mismo equipo.

### 6.4 Orden sugerido

1. **CORE-918 a qa:** migraciones y luego los PRs. Validar Credifamilia con QA.
2. **En paralelo:**
   - Core arranca C1–C4;
   - CreditopX define el contrato 6.3 y arranca X1–X2 con una preaprobación simulada.
3. **Integración en qa:** un caso **dentro** de la política y otro **fuera**. El de dentro llega al 11; el de
   fuera no recibe oferta.
4. **Firma y entrega** (X4–X6), a medida que se destraben Deceval y las decisiones de producto.

---

## 7. Decisiones abiertas (bloquean partes del diseño)

| Decisión | Afecta a | Dueño |
|---|---|---|
| Qué política rige: la de agosto o la del PRD de enero (monto mínimo, veces el ingreso, topes, score) | 6.3 | producto, con Finandina |
| De qué dato del buró sale el segmento de riesgo AA…Z, y la fila «AA» duplicada en la tabla | 6.3 | riesgo de Finandina |
| Qué significa «autorizada»: estado 11 al firmar, o un estado intermedio hasta que Finandina confirme | X5 | producto |
| Cómo se entrega la operación: el dashboard manual de la fase 1 o un canal automático | X5, X6 | producto, con Finandina |
| Si el FGA se financia dentro del capital y quién lo cobra | X1, X2 | producto |
| Días de pago: 5, 10, 15 o 20 | X1 | producto |
| Si los independientes entran o no | C2 | producto |
| Entrega de las llaves de Experian y Mareigua | C3 | producto, con Finandina |
| Certificación de Deceval (CRED-463, bloqueada) | X4 | Hans |

---

## 8. Relación con la rama de Santi (`feature/credifamilia-materiales`)

- **Front:** ya está en `qa` y en nuestra rama. Nuestro chequeo por riel lo reemplaza.
- **Backend:** tiene dos commits sin PR.
  - Agregar el proveedor y la fianza a los documentos: entra limpio.
  - Materiales cobra 4x1000: choca con el perfil en tabla y se resuelve poniendo
    `applies_four_per_thousand = true` en la siembra de Materiales.
- **Validado:** los 3 casos oficiales de Credifamilia pasan sobre nuestra rama.
- **Plan:** abre su PR **contra `feat/originacion-delegada`** y entra antes de correr las migraciones en qa.
- **Si la siembra ya corrió**, hace falta una migración que actualice Materiales: editar la siembra ya no
  alcanza.
- La guía completa está en la tarea CORE-918.

---

## 9. Para validar este documento (lista para un agente)

Todo contra la rama `feat/originacion-delegada` de cada repo, salvo que se diga otra cosa.

1. **Criterio de los rieles:** en `qa`/`main`, las puertas del tipo 4 preguntan por el tipo y no por ids:
   - `Modules/Loans/App/Services/LoanAuthorizationService.php`
   - `PaymentDateService.php`
   - `PaymentSchedule/ExternallyManagedPaymentScheduleService.php`
   - `Customer/ContinueUserFlowController.php`
2. **El problema original:** en `origin/qa`, el riel filtraba por `CredifamiliaLenders::lenderIds()`
   (`app/Services/PaymentPlan/Credifamilia/`), y la autorización radicaba con
   `CredifamiliaFormalizationService` para cualquier tipo 4.
3. **La solución:** en la rama,
   - `app/Services/PaymentPlan/DelegatedOrigination/` existe y no filtra por ids;
   - `DelegatedOriginationLenders::findBySlug` exige el tipo 4;
   - `DelegatedOriginationLenderProfile::forLender` lee la tabla;
   - los dos registros (`…InputsSources`, `…Formalizations`) resuelven por clave.
4. **Formalización nula no falla:** en `LoanAuthorizationService::formalizeExternalManagedIfApplicable`,
   con `formalization() === null`, se escribe un log y se retorna sin excepción.
5. **Front:** `supportsDynamicPaymentPlan` compara con `LENDER_RESPONSE_TYPE.DELEGATED_ORIGINATION` y ya
   no usa `DYNAMIC_PAYMENT_PLAN_LENDER_IDS`.
6. **Nada de Finandina en el código todavía:** `git grep -i finandina origin/qa` en legacy-backend no
   devuelve nada. Todo lo de las secciones 5 y 6 está por construir.
7. **Lo que no está comprobado y no hay que dar por hecho:**
   - que la preaprobación de `creditop_x` devuelva hoy esos campos en `transaction_data`;
   - los días de pago de Finandina;
   - un recorrido completo con una entidad del tipo 4 distinta de Credifamilia.
