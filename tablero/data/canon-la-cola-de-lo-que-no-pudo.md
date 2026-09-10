---
id: 78
title: "Canon: la cola de lo que no pudo contestar, y qué de eso se arregla escribiendo"
stage: work
created: "2026-09-10T20:10:00-05:00"
context_nodes: []
jira: []
jira_title: ""
ramas:
---

## Si retomás esto sin contexto, empezá acá

La página `/preguntas` de canon guarda en Postgres lo que se le preguntó y qué no pudo contestar. Al
2026-09-10 hay **112 preguntas** guardadas (desde el 04/09): 37 respaldadas, 5 sin citar y **70 con
reserva**. Esta tarea lee esas 70, las clasifica **por causa** —no por tema— y valida contra
`origin/main` cuáles se arreglan agregando contexto y cuáles no.

⚠ **La conclusión invierte lo que uno esperaría: la mayor parte de la cola NO es corpus faltante.**
De las 70 con reserva, **61 (87%) se pasaron del techo de 14 pasos** y su reserva dice, con estas
palabras, «no llegué a leer el cuerpo». La mediana de pasos es **17**. Escribir más prosa no mueve
ninguna de esas: el agente ya tenía el archivo a mano y se quedó sin turnos.

Y hay una segunda causa que tampoco es corpus: **el muro de declaración**. La herramienta `archivo`
sólo abre lo que algún área declara, así que hay respuestas que existen en el código y el agente no
puede alcanzar. Medido, cruzando lo que las reservas piden contra `content/*/map.json` y contra
`origin/main`:

| clase pedida | veces | declarada en canon | existe en `main` |
|---|---|---|---|
| `CutoffCalendar` | **5** | **0 áreas** | 2 archivos (los dos monolitos, **con test unitario cada uno**) |
| `VoucherController` (Customer) | **5** | 1 área (el otro homónimo) | 2 archivos |
| `LenderCalculator` | 4 | **2 áreas** | 1 |
| `PaymentCalculationService` | 3 | **2 áreas** | 1 |
| `FormulaCalculator` | 2 | 1 área | 1 |
| `RegenerateRequest` | 1 | **0 áreas** | 1 |

Las tres del medio ya están declaradas: **esas cuatro preguntas no las bloqueó el muro, las bloqueó el
techo**. O sea que las dos causas se confunden fácil leyendo las reservas de a una, y separarlas es lo
que dice qué arreglar primero.

## Objetivo

Que la cola de «con reserva» baje por las razones correctas: primero arreglando lo que impide llegar a
una respuesta que ya existe (pasos y permiso), después escribiendo el contexto que de verdad falta, y
sin gastar esfuerzo en lo que canon no tiene por qué contestar.

## Cómo se ataca

**Paso 1 — que leer el cuerpo de algo declarado no cueste tres pasos.** Es la causa del 87%. Hoy el
camino es `buscar` → `codigo` (trae el ESQUEMA con líneas) → `archivo` (trae el rango): tres turnos
para una función. La reserva típica es «tengo su firma y su lugar, no su cuerpo». Candidato medible:
que `codigo` devuelva el CUERPO de la declaración que matchea cuando hay una sola, en vez de su línea.
Se mide gratis con `-atajo` y con el banco, y se valida con dos preguntas nuevas de las que ya
fallaron por esto (`donde se calcula la cuota del listado`, `y si el calculator viene mal, qué ve el
cliente`).

⚠ **Y NO subir el techo de 14 sin medir**: el techo existe porque cada turno reenvía el historial. Lo
que hay que bajar es el costo por respuesta, no el límite.

**Paso 2 — declarar los archivos que la cola pide y nadie declaró.** Son pocos y están identificados:
`CutoffCalendar` (los dos monolitos), `Customer/VoucherController`, `VoucherService`,
`RegenerateRequest`, `VoucherRegenerationController`, `GeneratePaymentVoucher`, y del `otp-service` el
`internal/core/domain` de la ventana del rate limit. Con eso se destraban **10 preguntas** de la cola.
⚠ Declarar no es escribir prosa: es agregar el archivo a un área existente con su objetivo, que es lo
que le da permiso al agente.

**Paso 3 — los HUECOS verificados, en orden de demanda.** Cada uno ya tiene su fuente localizada, así
que esto es escribir, no investigar:

1. **El calendario de cortes y la primera fecha de pago** (5 preguntas: `cutoff_type_id`, Credi Idioma,
   Tedu, «por qué una solicitud de hoy queda con fecha en octubre»). La fuente es `CutoffCalendar` **y
   su test unitario**, que para un algoritmo de calendario es la fuente más barata que existe.
2. **Los vouchers** (4 preguntas): quién genera el automático, quién el manual desde el panel, qué
   valida y qué pasa si falla. Existe `GeneratePaymentVoucher` (job) → o sea que **sí hay camino
   automático**, que es justo lo que la reserva no pudo confirmar.
3. **Wompi** (2 preguntas). Canon tiene Nequi mapeado y Wompi no, y la reserva lo dice. En `main` hay
   `Wompi.php`, `WompiController`, `ReconcileWompiTransactionsCommand` —el comando de limpieza que la
   reserva buscó y no encontró— y dos eventos.
4. **Las tablas de `revenue`** (2 preguntas). ⚠ Validado y el resultado ES la respuesta: `revenue_lenders`,
   `revenue_saas` y `revenue_allieds` **no las escribe ningún repo versionado** (cero coincidencias en
   los 12 clones; el único hit es el diccionario generado de canon). Se escriben fuera del código: eso
   hay que confirmarlo con quien las carga y escribirlo, porque hoy la pregunta se contesta con silencio.
5. **La comisión de CreditopX** (1 pregunta, y es la peor clase): `comission_percentage` da **0** para
   la entidad Creditop X y **la prosa del canon dice que CreditOp gana comisión por recaudo**. Es una
   contradicción, no un hueco: se resuelve mirando `creditop_x_lender_collection_charges` y corrigiendo
   el texto o el dato.
6. **El estado 5 «Desembolsada»**: todo lo leído sella en 11. Hay que decidir si es estado muerto y
   escribirlo, o encontrar el flujo que lo usa. Se comprueba con una consulta de sólo lectura contra
   prod.
7. **`match_code` en `legacy-application`** (2 preguntas, de hoy). ⚠ Acá canon **buscó en el archivo
   equivocado**: la reserva dice que `app/Actions/RiskCentrals/Tusdatos.php` (802 líneas) no tiene el
   término, y el término sí está en `app/Http/Controllers/Customer/TusDatosController.php`. La
   respuesta existe.
8. **El flujo pantalla por pantalla de CreditopX** (3 preguntas). Canon tiene las ETAPAS de negocio y
   no las pantallas. Decidir si eso entra: son rutas del front, envejecen distinto que el mecanismo.
9. **`ICV+30`** (1 pregunta). Validado: **no está en el código** de ninguno de los dos monolitos. Es un
   término de reporte/negocio → Confluence o Redash, no el corpus. Si se escribe, va con su fuente.

**Paso 4 — lo que NO es de canon, dicho para no volver a intentarlo.** 11 de las 70: 7 son casos
puntuales de un cliente (van a CrediBot), 2 preguntas incompletas de un chat cortado, 1 fuera del
dominio (fútbol) y 1 del lado de un proveedor externo. La cola es más chica de lo que su número dice, y
**el 55-63% de «con reserva» no es «canon falla»**.

## Lo que se evaluó y NO se eligió

- **Subir el techo de pasos.** Es el arreglo aparente del 87% y es el equivocado: cada turno reenvía el
  historial entero, así que subirlo multiplica el costo sin garantizar que llegue. Primero abaratar el
  camino.
- **Agregar las vecinas al `buscar` del modelo.** Está medido que el modelo casi no llama a `buscar`
  —va derecho con `leer`— y que el glosario, que era el 21% de sus bytes, se recortó por peso.
- **Escribir prosa para las cuatro de `LenderCalculator`/`PaymentCalculationService`.** Ya están
  declaradas: el problema no es que falte texto.

## Riesgos

- ⚠ **Prosa nueva compite con todo el corpus.** Cada tanda de secciones puede tumbar el banco
  (115/115 es compuerta de build, no métrica). El umbral medido está cerca de **500 palabras por nodo
  por tanda**.
- **Declarar archivos mueve la deriva**: un archivo declarado entra a la ronda y puede marcar viejo un
  nodo que estaba al día. Es el precio correcto, pero hay que esperarlo.
- **La cola crece sola**: 21 preguntas nuevas entre el 09 y el 10 de septiembre. Medir el efecto contra
  el porcentaje, no contra el conteo.

## Cómo se comprueba

Que el porcentaje de «con reserva» baje **descontando** las cuatro clases que no son de canon (caso
puntual, incompleta, fuera de dominio, proveedor externo). Hoy la línea base es **70 de 112 (63%)**, o
**59 de 101 (58%)** descontando. Y cada paso se valida con **dos preguntas nuevas y distintas**, nunca
del banco — y para los pasos 1 y 2, con preguntas **que ya están en esta cola**, que es la única
validación que prueba que la cola baja.

## Registro

### 2026-09-10

- **Leída la cola entera desde Postgres (70 con reserva de 112) y clasificada por causa.** Lo que
  cambió el plan: **87% se pasó del techo de 14 pasos** con reserva «no llegué a leer el cuerpo», así
  que la causa dominante no es corpus faltante.
- **Validado contra `origin/main`, no supuesto:** existen `CutoffCalendar` (×2, con test),
  `VoucherService`, `Customer/VoucherController`, `RegenerateRequest`, `VoucherRegenerationController`,
  `GeneratePaymentVoucher`, `Wompi.php` + `ReconcileWompiTransactionsCommand`, y el `otp-service` con
  su tabla `otp_rate_limits` en DynamoDB. Todas las respuestas están; lo que falta es alcance.
- ⚠ **Un defecto de herramienta que se descubrió acá:** la pregunta «cuántas solicitudes llegaron al
  estado 11 en 30 días» falló diciendo que `user_requests` **no tiene columnas de fecha**, y sí las
  tiene (`created_at`, `updated_at`). El motivo: pedir una tabla por nombre devuelve la FILA DEL
  CATÁLOGO —«32 columnas» y un puntero `leer`—, no las columnas. La herramienta contesta una pregunta
  distinta de la que se le hizo, y la respuesta estaba a un salto. Mismo patrón que el esquema de
  `codigo` con cero coincidencias.
- **Dos hallazgos que son la respuesta, no el hueco:** nadie escribe las tablas `revenue_*` en código
  versionado, e `ICV+30` no aparece en ninguno de los dos monolitos.
- **Y una contradicción del propio canon:** `comission_percentage` = 0 para Creditop X contra la prosa
  que dice que gana comisión por recaudo.

## Tarea (publicable)

## En una línea

No aplica: tarea interna de curación del corpus técnico.
