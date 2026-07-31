---
id: 15
title: "Bancolombia · el código de compra lo emite el banco (reemplazo de la API Fondos de Corbeta)"
stage: evaluation
created: "2026-07-31T17:13:02-05:00"
context_nodes: [bancolombia, corbeta]
jira: []
jira_title: ""
---

# Reemplazar el emisor del código de compra: Corbeta → Bancolombia

> Origen: handoff de Santiago Villaquiran (2026-07-29) + su revisión (2026-07-31) + el OpenAPI del
> servicio nuevo. **No se ha tocado una línea de los repos reales.**
> Cuando esto se mergee, lo que quede vivo **gradúa** al nodo `bancolombia` y este esfuerzo se archiva.

## 1 · La tarea en una frase

Hoy el PIN que el cliente presenta en la caja de Alkosto lo emite **Corbeta** (su API Fondos). Bancolombia
publicó su propio servicio —*In Store Billing Code · Code Management*— y quiere que el código lo emita
**el banco**, para los dos productos (BNPL 68 y Consumo 100).

Lo que cambia es **quién emite el código**. Lo que NO cambia (y hay que probar que no cambia) es todo lo que
pasa después: el estado 25, la vigencia, la conciliación por crons y el paso a 26 «Facturado».

## 2 · Dónde se toca (un solo punto de entrada, y eso es la buena noticia)

```
POST purchase-code/generate/{user_request_id}      api.php:137
  └─ PurchaseCodeController:33
      └─ PurchaseCodeService::getPurchaseCode      :106 guard · :275-283 · :296-311
          └─ CodeGenerationService                 :21-29 switch por allied_id · :51 convenio · :72 regex del PIN
              └─ app/Actions/Allieds/Corbeta.php   :38 getToken · :58 setOrder · :131 getOrder
```

No hay jobs, ni schedulers, ni webhooks en la emisión: es una petición HTTP síncrona. El reemplazo es
**un proveedor nuevo al lado de `Corbeta.php`** y un `switch` que elija.

## 3 · Lo que está DECIDIDO (verificado contra el código, no supuesto)

| | |
|---|---|
| El guard **habilita** con estado 25 | `PurchaseCodeService.php:106`: pasa sólo si `isCorbetaAllied` **Y** `status==25` **Y** `lender_id ∈ [68,100]`. Está escrito en negativo y se lee al revés (F-82) |
| El estado terminal es **25**, nunca 11 | El desembolso llega después, por conciliación → 26 |
| Los 4 allieds Corbeta son **`ean128`** | Verificado en BD: un código de 20–30 hex es seguro; el riesgo de `ean13` (`^\d{12}$`) no aplica |
| Hoy el PIN se extrae **de texto libre** | Regex `/PIN\s+([a-f0-9]{20,})/i` (`CodeGenerationService.php:72`) sobre la respuesta de `getOrder`. El servicio nuevo devuelve `data.billingCode` como campo → esto **desaparece**, y es una mejora real |
| El `transactionId` ya existe y hoy se escribe | BNPL: `bnpl_transaction_id`, sólo lo escribe `RetrieveQuota`. Consumo: `loan_validate_key`, sólo `redirect-user-validate`. Para el tráfico actual está disponible (F-80) |
| Dos fuentes de verdad para "es Corbeta" | `Setting('corbeta_allieds')` (guard) vs el `switch` hardcodeado (`CodeGenerationService.php:21-29`). **Un allied en el Setting pero no en el switch falla en silencio** con un código interno que no sirve en caja |
| Hay **cero tests** de este camino | Ni un `Http::fake` del host de Corbeta. Sin red de seguridad para detectar la regresión al conmutar |

## 4 · Lo que está BLOQUEADO, y qué desbloquea cada cosa

**Q2 es el bloqueante real, y es de una sola pregunta:** ¿el `billingCode` de Bancolombia es **el mismo PIN**
que Corbeta pone en su orden?

- **Si es el mismo** → se escribe en `user_request_additional_information.data_json->verification_token`
  (donde ya viven 19.692 tokens) y los 4 crons de `application` siguen conciliando sin cambios. **Sin
  migración.**
- **Si es un identificador propio** → escribirlo ahí hace que la ruptura sea **silenciosa**: nada falla
  visiblemente, simplemente nadie pasa a 26 y no se confirma el consumo. Hace falta otra columna o un campo
  extra → **sí implica migración** y toca `application`.

No se puede empezar por el camino híbrido sin esta respuesta. Lo que **sí** se puede hacer mientras no
llegue: todo el paso 1 del plan (el proveedor nuevo detrás de un flag, sin conmutar nada).

Las otras tres, en orden de riesgo:

- **¿Quién crea la orden en Corbeta?** Si Bancolombia llama a `setOrder` por detrás y nosotros dejamos de
  llamarlo, bien; hay que confirmar que **no queden dos caminos creando órdenes** para la misma compra.
  Órdenes duplicadas en el aliado son peores que un código faltante.
- **`address` de 20 caracteres: bloqueante, con número.** Ninguna de las dos fuentes cumple —**67 %** de las
  sucursales y **28 %** de las direcciones del cliente lo exceden (F-83). Hay que decidir qué se manda y
  quién trunca, y el spec no dice qué hace el banco con un valor más largo.
- **`departmentCode` (BC4): cerrada en papel, abierta en la práctica.** El spec se contradice solo (mocks
  `01/02/03` contra ciudades `11001/05001/76001`). Si el banco valida contra su propia tabla y espera el
  contador, `substr($cityCode,0,2)` falla.

## 5 · El plan, en pasos que se pueden entregar por separado

1. **Proveedor nuevo, sin conmutar nada.** `app/Actions/Allieds/BancolombiaBillingCode.php` (gemelo de
   `Corbeta.php`) con `generateBillingCode` + `retrieveOrderDetails` + `health`, sus 5 headers y el
   `message-id` como UUID **v4** (ojo: el v1 comentado en `BancolombiaConsumerLoan.php:409` es una bomba si
   alguien lo descomenta, F-84). Config en `config/services.php` al lado del bloque `corbeta`.
2. **Elección por configuración, no por `switch` hardcodeado.** Un `Setting` (mismo patrón que
   `corbeta_allieds`) decide emisor por allied. Con esto la conmutación es reversible sin deploy, y de paso
   **se cierra la doble fuente de verdad** del punto 3.
3. **Bitácora ANTES del POST** en `lender_transactions`. Es lo que permite ejercitar —y sobrevivir— el
   escenario que hoy no se puede: 409 `BP21000` como *recuperación* (POST exitoso en el banco, respuesta
   perdida, reintento). Sin la bitácora previa, ese caso deja la orden huérfana.
4. **Persistencia del código** según la respuesta a Q2 (§4). Si es el mismo PIN: nada nuevo. Si no: campo
   propio + tocar los crons de `application`.
5. **Tests del camino**, que hoy no existen: `Http::fake` del emisor nuevo, el guard (25 / lender / allied),
   el 409 de recuperación, y el caso "ya facturada".
6. **Conmutar un allied** (Alkosto 209 primero) y mirar la conciliación de punta a punta antes de los otros
   tres.

## 6 · Cómo se valida (esto ya está construido y andando)

El harness cubre el camino completo en local, así que la tarea **no arranca a ciegas**:

| Qué | Cómo |
|---|---|
| Los 7 casos del comportamiento ACTUAL | `channel/qr-corbeta-purchase-code.spec.ts` — emisión, idempotencia, ya-facturada, los 3 guards, proveedor caído. Es la **caracterización**: registro del comportamiento observado, no oráculo de corrección |
| El flujo completo por consola | `dev/qr-corbeta.ts --producto bnpl\|consumo` — cierra en 25 con código |
| El recorrido visual de las pantallas | `dev/caminar-qr.ts --producto bnpl\|consumo` |
| El contrato mock ↔ front | `npm run contrato:bancolombia` — 16 esquemas zod reales |
| El emisor caído / errores | `mock-corbeta` con `/_control/fail` · `mock-bancolombia` con `MOCK_BC_FAIL=1` y `/_control/escenario` |

**Lo que falta construir para esta tarea:** un mock del **emisor nuevo** (`/generateBillingCode`,
`/retrieve-order-details`, `/health`) al lado de `mock-corbeta`, y un caso que compare **PIN de Corbeta vs
`billingCode`** para responder Q2 empíricamente el día que haya sandbox con datos reales. Ojo: el sandbox
documentado responde **409 a cualquier dato real** y no ejercita la seguridad (F-81), así que ese sandbox
**no** sirve para responder Q2 — la respuesta tiene que venir del banco o de una prueba en un ambiente real.

## 7 · Riesgos que hay que nombrar en la tarea (no son detalles)

- **La ruptura silenciosa de la conciliación** (Q2). Es el único riesgo que no avisa: no hay error, sólo
  solicitudes que nunca llegan a 26.
- **Cero timeouts** en toda la integración Bancolombia: default de Guzzle, llamadas **síncronas en el
  request del usuario**. El emisor nuevo hereda eso si no se le pone timeout explícito.
- **`getRequestExceptionCode()` accede por índice directo** (`['errors'][0]['code']`, triplicado): una
  respuesta de error sin `errors` **lanza dentro del propio manejador de errores**.
- **La vigencia (24 h, corte 21:30) "no se toca" es una intención, no una verificación**: hay que comprobar
  que no se apoye en el mismo efecto colateral del filtro `EstadoOrden=2` que sostiene a
  `validateCurrentOrder`.
- **HTTP 400 en `Allieds/Corbeta::register()` → variable indefinida**: sin seed de `LenderErrorCode`,
  `handleException` retorna `void` y `register()` devuelve una variable nunca asignada → `Error` de PHP 8,
  que **no es `Exception`** y ningún catch de la cadena atrapa.

## 8 · Lo que NO entra en esta tarea

Cambiar la decisión de crédito, el marketplace, la vigencia del código, los crons de conciliación de
`application` (salvo que Q2 obligue), y el canal ecommerce (que hoy resuelve con `validate-preapproved` y
**no** garantiza el `transactionId`, F-80).

## Lo que la revisión de Santi dejó firme (2026-07-31)
Tras la ida y vuelta sobre el handoff, esto es lo que hay que tener presente antes de tocar código —
son restricciones del diseño, no opiniones:

- **La decisión de mayor riesgo es una sola: ¿el `billingCode` de Bancolombia es el MISMO PIN que Corbeta
  pone en su orden?** De eso dependen dos cosas que parecían separadas: (a) si el `billingCode` puede ir en
  `verification_token` —la columna que los 4 crons de `application` cruzan contra la factura— y (b) si el
  híbrido "emisión por Bancolombia, conciliación por Corbeta" es viable. **Si el identificador es propio y
  distinto, escribirlo en esa columna es exactamente lo que hace que la ruptura sea SILENCIOSA**: no falla
  nada visible, simplemente nadie pasa a estado 26 y no se confirma el consumo. En ese caso hace falta otra
  columna o un campo extra → y eso sí implica migración.
- **Hay una pregunta previa: ¿quién crea la orden en Corbeta?** Si Bancolombia llama a `setOrder` por
  detrás y nosotros dejamos de llamarlo, bien; hay que confirmar que **no queden dos caminos creando
  órdenes** para la misma compra. Órdenes duplicadas en el aliado son peores que un código faltante.
- **"No se toca la vigencia" es una intención, no una verificación.** La lógica de 24 h con corte 21:30
  hay que comprobar que no se apoye en el mismo efecto colateral del filtro `EstadoOrden=2` que sostiene a
  `validateCurrentOrder` (§3.3): si se apoya, sí queda afectada por el cambio.
- **Caracterizar el camino actual sigue valiendo aunque el canal esté detenido** (§F-79), pero como
  *registro del comportamiento observado*, no como oráculo de corrección. Los dos casos de referencia
  (uReq 359914 y 359917) son de **marzo**, del período en que la emisión sí funcionaba, así que son válidos.
- **BC4 (`departmentCode`) está cerrada documentalmente pero abierta operativamente.** Que el spec se
  contradiga solo (mocks `01/02/03` contra ciudades `11001/05001/76001`) no dice qué espera el banco en
  producción: si valida contra su propia tabla y espera el contador, `substr($cityCode,0,2)` falla.
- **El `address` de 20 caracteres es bloqueante, con número**: ninguna de las dos fuentes lo cumple —
  67 % de las sucursales y 28 % de las direcciones de residencia del cliente lo exceden. Ver **F-83**.
- **Falta un escenario de prueba, no sólo un código de error:** el 409 `BP21000` como *recuperación* —
  POST exitoso en el banco, respuesta perdida, reintento → 409 y sin forma de recuperar el código. Con la
  bitácora en `lender_transactions` escrita ANTES del POST se puede ejercitar.
