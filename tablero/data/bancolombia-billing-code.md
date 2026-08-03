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

## 2ª revisión de Santi (2026-08-03): tres preguntas nuevas y un error de destinatario

**Error de destinatario, y era el nuestro.** «¿Quién crea la orden en Corbeta?» estaba en la lista *para
Santi*, y él no la puede contestar: es una afirmación técnica sobre el sistema del banco. **Va a
Bancolombia, explícita y por escrito**, y no estaba en su lista:

> ¿Ustedes crean la orden en Corbeta (`setOrder`) al recibir `generateBillingCode`, o esperan que la
> sigamos creando nosotros? Si la crean, ¿en qué momento del ciclo?

**Y no es la misma pregunta que «¿el `billingCode` es el mismo PIN?».** Que el código coincida *sugiere*
que hay orden en Corbeta, pero no lo prueba: podrían devolver el PIN sin haber creado nada todavía, o
crearla más adelante. Son dos preguntas y las dos hay que hacerlas. Es la que más riesgo cubre: si
dejamos de llamar a `setOrder` y ellos no la crean, **no hay orden, la factura no cruza, y nadie se
entera hasta la conciliación nocturna**.

**Tres preguntas que faltaban:**

- **A · Credenciales, scope y ambiente** — bloquea *cualquier* prueba. ¿El `Client-Id`/`Client-Secret`/
  certificado ya aprovisionados para lender 68/100 sirven para esta API o hay que aprovisionar nuevos?
  ¿Nuestro client tiene habilitado el scope `BnplSignature-origination:write:user` para las dos
  operaciones? ¿Contra qué catálogo certificamos, si el Sandbox no valida JWT ni mTLS
  (`tlsProfileJWT` vacío) → hace falta Development o Testing.
  ⚠ Urgente por otra vía: es **la misma superficie del SA400 «Header host inválido»** abierto en
  `enableOffers`, con sospecha de **certificado vencido (`notAfter` 2025-06-28)**. Si está vencido,
  esta integración no arranca tampoco.
- **B · ¿El servicio aplica a los DOS productos?** El path base dice `consumer-loan`
  (`/loans/consumer-loan/in-store-billing-code/code-management`), lo cual es raro si también sirve BNPL.
  Santi confirmó «a los dos» de palabra, pero lo tiene que confirmar el banco: **si BNPL necesita otro
  path u otra API, el diseño de resolución del `transactionId` por lender se cae.**
- **C · ¿Cambia la confirmación posterior a la factura?** Hoy `InvoiceProcessConfirm` en `application`
  le confirma el consumo a Bancolombia después de facturar. Si ahora el código lo emiten ellos,
  ¿siguen esperando esa confirmación por el mismo canal, o el servicio nuevo ya se los informa?

**La conciliación es un ÁRBOL DE DECISIÓN, no una decisión.** «No la movemos» es la lectura correcta pero
**condicional**, y darla cerrada hace que se diseñe para el escenario optimista:

| respuesta del banco | conciliación |
|---|---|
| es el mismo PIN **y** ellos crean la orden | los 4 crons siguen sin tocarse · híbrido sano · alcance mínimo |
| es identificador propio **o** no crean la orden | el híbrido **es** el fallo silencioso → entra en alcance sí o sí |

**El 67 % sube `address` a bloqueante, y arrastra una consecuencia nueva.** Con dos tercios de las
sucursales por encima de 20 caracteres, truncar deja de ser un supuesto razonable. Y el número es
argumento para la pregunta: *un campo `required` con `maxLength 20` que rechaza el 67 % de las
direcciones reales de un comercio no parece diseñado para recibir una dirección de punto de venta* — o
el límite es un error del contrato, o el campo espera otra cosa. **Lo que nadie había dicho:** si ellos
crean la orden en Corbeta, ¿qué dirección le pasan? Si truncamos a 20, **la orden en Corbeta queda con la
dirección truncada**, y hoy llega completa. Eso va agregado a la pregunta del `address`.

**Higiene de cifras.** Los conteos de tokens bailan entre informes (19.692 vs 19.709). Es consistente con
el drift de entornos, pero hay que **fijar de qué dump sale cada cifra** antes de que alguna termine en un
documento para el banco.

## La superficie de Corbeta son 3 operaciones, y solo una es 1:1 (verificado 2026-08-03)

`app/Actions/Allieds/Corbeta.php` (legacy) y `app/Actions/Allies/Corbeta.php` (application) son
**idénticos, 184 líneas**, y exponen exactamente tres:

| método | endpoint | quién lo llama | para qué |
|---|---|---|---|
| `authorize()` | `POST /ObtenerToken/getToken` | interno de las otras dos | token |
| `register(...)` | `POST /GenerarOrden/setOrder` | **`CodeGenerationService`** (los dos repos) | crea la orden; de su respuesta se saca el PIN |
| `query($desde,$hasta,$estado)` | `POST /ConsultaOrden/getOrder` | **3 crons de `application`**: `UpdateOrdersFromCorbeta`, `InvoiceProcessCorbeta`, `InvoiceProcessCorbetaBnpl` | conciliar |

**El mapeo al servicio nuevo:**

- `register` → `POST /generateBillingCode`. **1:1, y mejora**: el PIN deja de extraerse con regex sobre
  texto libre y pasa a ser el campo `data.billingCode`.
- `authorize` → **no tiene equivalente y no hace falta**: Bancolombia autentica con Client-Id/secret +
  mTLS + scope, no con un `getToken` propio del aliado.
- `query` → `GET /retrieve-order-details?billingCode`. **Acá NO es 1:1**, y es el hallazgo.

⚠ **La conciliación invierte su patrón, y eso es independiente de si el código es el mismo PIN.** Los
tres crons llaman `query($rango, 3)`: traen **todas las órdenes facturadas del día en UNA llamada** y
después cruzan localmente contra `data_json->verification_token` (`UpdateOrdersFromCorbeta:61`, el match
por `$pin` en `:78`, y el `26` en `:95`). El servicio nuevo contesta **una orden por vez, por código**.
Tres consecuencias:

1. **De 1 llamada por día a N llamadas**, una por solicitud pendiente.
2. **Hay que tener el código ANTES para poder preguntar.** Hoy el cron puede descubrir una orden que no
   conocía; con el servicio nuevo solo puede confirmar códigos que ya tiene.
3. **No se puede filtrar por estado**: `billingStatus` viene por orden, así que el filtro se muda a
   nuestro lado.

**Esto afina el árbol de decisión de §«2ª revisión»**, y en la dirección incómoda: dijimos que la
conciliación entra en alcance solo si el código no es el mismo PIN. Incompleto. Lo que la mantiene
fuera de alcance **no es que el código coincida, es que la orden siga existiendo en Corbeta** —porque el
híbrido consiste en seguir llamando a `query`—. O sea que **las dos preguntas al banco son la misma
pregunta**:

| si Bancolombia… | entonces |
|---|---|
| **crea** la orden en Corbeta | `query` sigue devolviendo la lista → los 3 crons no se tocan → híbrido sano |
| **no la crea** | no hay nada que consultar → los crons no encuentran nada → hay que mudarlos a `retrieve-order-details` **y** absorber el cambio de patrón (N llamadas, código primero, filtro nuestro) |

Detalle para el que lo implemente: la firma de `query` tiene `$status = 2` por defecto, pero **ninguno
de los tres crons usa el default** — los tres pasan **3**. La preocupación por `EstadoOrden=2` (§«revisión
de Santi») es de otro camino, no de estos crons.

## Paso 1 hecho — y el request estaba MAL (2026-08-03)

Rama `feature/bancolombia-billing-code` desde el `main` del 3 de agosto. Dos commits, sin push.

**`app/Actions/Lenders/BancolombiaBillingCode.php`** con `generateBillingCode`, `retrieveOrderDetails` y
`health`, más `services.bancolombia.in-store-billing-code.prefix`. **No conmuta nada**: sigue sin
llamadores.

**Cambio al plan §5.1, para bien: extiende `Bancolombia`, NO es gemelo de `Corbeta.php`.** La clase base
ya trae lo que este servicio necesita y Corbeta no tenía —certificado base64, JWT firmado, y
`getRequestExceptionCode` leyendo `errors[0].code`, justo donde este contrato pone el error—. Al lado de
Corbeta había que reimplementar las tres. Y la credencial es por lender+sucursal
(`LenderAlliedCredential`), como el resto de Bancolombia.

⚠ **EL HALLAZGO: el request NO son 4 campos planos.** `data.required` del spec es
`['security','customer']` —
`data.security.transactionId` y `data.customer.contactInformation.{address,cityCode,departmentCode}`.
Este `.md` y el nodo `bancolombia` lo documentaban plano; ya está corregido en los dos.

**Y esto es lo que hay que aprender de la validación**, porque es reproducible: la primera versión
mandaba el sobre plano y **los 8 tests con `Http::fake` pasaban en verde**. Pasaban porque comprobaban la
misma suposición con la que se escribió el código, tomada del mismo documento equivocado. Un fake no
puede contradecir la documentación de la que nació. El banco habría contestado `SA400` en la primera
prueba real — y el dispatcher del sandbox, que compara el JSON completo por igualdad estricta, nunca
habría matcheado.

Lo encontró un test que **lee el YAML del banco y valida contra él**
(`tests/Unit/Lenders/BancolombiaBillingCodeContractTest.php`): requeridos, anidamiento, longitudes,
headers declarados, el pattern del `message-id`, y que las 3 operaciones implementadas sean las 3 que el
spec declara. Comprobado que no es vacuo: al revertir el sobre a plano falla con «falta
`body.data.security`, requerido por el spec». Se saltea si no encuentra el spec, para no romper CI.

**Lo que el spec confirmó como correcto** (no hace falta volver a preguntarlo): los 5 headers —3
`parameters` requeridos más `Client-Id`/`Client-Secret` como `securitySchemes` en header—, el pattern de
`message-id` es exactamente el UUID v4, el prefijo del `server`, y las respuestas `data.billingCode` y
`data.orderInformation`.

**Estado de las pruebas:** 12 tests propios en verde (99 aserciones). Los 18 fallos de
`tests/Unit/Lenders` son **preexistentes** — verificado corriendo la misma suite en un worktree del
commit anterior: 18 failed / 28 passed antes, 18 failed / 40 passed después. Son un test que espera
`'Negozia'` y recibe `'Creditop'`, y varios que no resuelven el host `mysql`.

**Sigue bloqueado igual:** el mapeo (quién trunca `address` a 20, cómo se deriva `departmentCode`) y la
persistencia del código. Ninguna de las dos la desbloquea el spec — son comportamiento del banco.

## El `address` de 20 caracteres: medido, y la respuesta estaba en los ejemplos del banco (2026-08-03)

Re-verificado contra la BD local, no contra F-83:

| fuente | total | exceden 20 | % | máx |
|---|---|---|---|---|
| sucursales Corbeta (24, 209, 210, 211) | 131 | 82 | **63 %** | 86 |
| todas las sucursales | 1.677 | 1.134 | 68 % | 134 |
| **direcciones de residencia del cliente** (`user_field_values.field_id=44`) | 2.268 | 630 | **28 %** | 90 |

(F-83 decía 67 % de sucursales; para las **de Corbeta**, que son las que importan, es **63 %**. El
promedio de la dirección del cliente es **19 caracteres**: el límite cae justo por debajo del formato
colombiano típico.)

⚠ **TRUNCAR NO DA UNA DIRECCIÓN MÁS CORTA, DA UNA DISTINTA.** Lo que se corta a los 20 es el número de
casa, porque las que exceden lo hacen por 1-4 caracteres:

```
22 → «Carrera 77 b # 64 h» ⟨50⟩       24 → «Carrera 90 Bis # 76» ⟨- 51⟩
22 → «Transversal 79C #85-» ⟨30⟩      22 → «Calle 40 sur # 11 j» ⟨15⟩
```

`Carrera 77 b # 64 h` sin el `50` no es una dirección degradada: es una dirección **que no existe**.

**LA RESPUESTA ESTABA EN EL SPEC.** Los cuatro ejemplos del banco abrevian el tipo de vía:
`Cal 123 # 12-122` (el del schema) · `Calle 45 #12-34` · **`Cra` 7 #45-89** · **`Av` 30 #100-15`**. Por
eso a ellos 20 les alcanza — **esperan la dirección abreviada**, convención colombiana. Nosotros las
guardamos completas.

Medido sobre las 2.268 reales, abreviando el tipo de vía (Carrera→Cra, Transversal→Tv, Calle→Cl, …):

| | exceden 20 |
|---|---|
| crudas | 630 (**27 %**) |
| **abreviadas** | 470 (**20 %**) |

Salva 160 direcciones —una de cada cuatro de las que sobraban— y **salva exactamente las que perdían el
número de casa**: `Carrera 77 b # 64 h 50` → `Cra 77 b # 64 h 50` (18). Lo que sigue sin entrar ya no es
la vía: es **detalle secundario** — torre, apartamento, conjunto, barrio:

```
28  Cl 77b 129 11 torre 6 ap 704
51  Conjunto villa emaus casa 11b bosques de rosablanca
```

**DECISIÓN DE DISEÑO (la de Miguel, y se sostiene): nunca truncar a ciegas.** Se normaliza como hace el
banco y, si aun así no entra, **no se manda una dirección falsa**: el Action falla con un error local
claro. «Que Bancolombia se encargue» hecho bien no es mandar 35 caracteres y esperar —el `maxLength` de
un campo `required` detrás de APIC puede rechazarse en el gateway con `SA400`, antes de que el negocio
del banco lo vea—, es **no corromper el dato y volver el 20 % un número visible y contable** en vez de
470 direcciones equivocadas en producción.

**Lo que hay que preguntarle al banco, ahora con evidencia:**

> Sus ejemplos abrevian el tipo de vía (`Cal`, `Cra`, `Av`): ¿es eso lo que esperan en `address`?
> Incluso abreviando, el **20 %** de las direcciones de residencia reales de nuestros clientes excede 20
> caracteres, y lo que sobra es torre/apartamento/conjunto. Dos cosas: **(a)** ¿para qué se usa el campo
> —se imprime, se compara, viaja a la orden que ustedes crean en Corbeta?— y **(b)** si la dirección
> completa no entra, ¿prefieren recibirla sin el detalle secundario, o el `maxLength: 20` es un error del
> contrato?

Y sigue en pie lo que señaló Santi: si el banco crea la orden en Corbeta con esta dirección, hoy Corbeta
la recibe **completa** — cualquier recorte es un cambio de comportamiento para el aliado, no sólo para
nosotros.

## Paso 2 hecho: el emisor se elige por Setting (2026-08-03)

Rama `feature/bancolombia-billing-code`, **un solo commit** (`bf7f8492`), PR abierto sin mergear.
7 archivos, +1.022 líneas.

**Mergeable sin conmutar a nadie.** El Setting nuevo nace vacío → los 4 comercios Corbeta siguen
exactamente por donde iban, y hay un test que lo fija como garantía.

**La doble fuente de verdad quedó cerrada.** `CodeGenerationService` tenía 24/209/210/211 **quemados** en
un `switch` mientras el guard leía `Setting('corbeta_allieds')`. Un comercio agregado al Setting pero no
al switch pasaba el guard y salía por `generateInternally` — código interno que no sirve en caja, **sin
ningún error**. Ahora las dos preguntas leen el mismo Setting, y un segundo
(`bancolombia_billing_code_allieds`) decide quién ya emite con el banco: reversible sin deploy y por
comercio, para conmutar Alkosto primero.

**El `address` quedó como se decidió:** se abrevia el tipo de vía —como los ejemplos del banco— y si aun
así excede 20, **falla explícito** en vez de mandar una dirección falsa.

**19 tests, 119 aserciones**, en tres archivos: el contrato contra el OpenAPI real, la integración
(headers, UUID v4, 409 de recuperación, secreto redactado) y el ruteo del emisor.

**De paso:** se borró un import colgado en `PurchaseCodeController` que apuntaba a
`App\Services\CodeGenerationService`, clase que **no existe en legacy-backend** (resto de la migración
desde `application`). Inocuo hoy porque nadie la usaba; un fatal el día que alguien escribiera
`new CodeGenerationService()` ahí.

### Lo que falta para que esto sirva de verdad

| paso | estado |
|---|---|
| 3 · bitácora en `lender_transactions` ANTES del POST | pendiente — habilita ejercitar el 409 como recuperación |
| **4 · persistencia del código** | **BLOQUEADO** por el banco: ¿el `billingCode` es el mismo PIN? |
| 6 · conmutar Alkosto (209) y mirar la conciliación | después del 4 |

Y `departmentCode` arranca con la misma fuente que Corbeta hoy (`city->zone->code`), con la duda BC4
anotada en el código: el spec se contradice solo (mocks `01/02/03` contra ciudades `11001/05001/76001`).
