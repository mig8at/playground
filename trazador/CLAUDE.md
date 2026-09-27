# trazador — protocolo (lo que sólo sabe el ambiente donde ya pasó)

**El manual es [`README.md`](README.md)**: los modos, el mapa de 39 pasos, las tres fuentes, la
configuración por stack y las trampas de Grafana. Acá va lo otro: **cuándo se usa, cuándo NO, qué no se
puede afirmar con una traza y dónde va a parar lo que devuelve.** Para cambiar su código —el mapa como
vista, los JSON de etapas, los matchers, las pruebas— cargá la skill **`trazador-map`**.

## Qué contesta esto que ninguna otra herramienta contesta

- **canon** describe el **mecanismo**, y por eso generaliza — pero no sabe nada de tu caso.
- `harness/` **corre un caso que vos sembrás**: contesta *¿qué pasaría si el cliente es así?*
- **el trazador mira lo que YA pasó, en el ambiente donde pasó** — y es el único que llega a `prod`.

| la pregunta | el modo |
|---|---|
| ¿qué le pasó a **esta** solicitud, y dónde se rompió? | `make trazador-ureq UREQ=… TARGET=…` |
| ¿esto pasa **de verdad**, y **cuánto**? | `make trazador-sql TARGET=prod SQL='SELECT …'` |
| ¿qué **vio** el cliente en la pantalla? | `make trazador-posthog UREQ=… TEL=…` |

⚠ **La segunda es la que más rinde y la que menos se usa.** «Esto seguro pasa poco» es una hipótesis, no
un dato. Antes de escribir un número sobre el comportamiento del sistema, medilo: una `SELECT` contra prod
tarda segundos.

## Cuándo NO es esto

- **«¿cómo funciona X?»** → **canon**. Una corrida no es el mecanismo, y leer el mecanismo desde un caso
  es cómo se sacan conclusiones falsas.
- **«¿qué pasaría si…?»** → `harness/`. El trazador sólo ve lo que ocurrió.
- **«¿por qué existe esta regla?»** → `make confluence`. El porqué del negocio no está en los datos.
- **«¿puedo leer los logs?»** → ésa es `trazador-acceso`, la sonda, y **no es la forense**.

## El límite, y no se negocia

**No escribe en ningún ambiente.** Sólo `SELECT` y `GET`, en los cinco targets. El `-sql` tiene guarda,
pero ⚠ **lo que lo garantiza es el motor, no la guarda**: `INTO OUTFILE` pasaba (**F-109**). Si vas a tocar
ese modo, leé el hallazgo antes. **`prod` es SOLO LECTURA, siempre.**

## Dos trampas que ya costaron una medición

- ⚠ **Los defaults son OPUESTOS a los de su vecino**: `trazador-ureq` arranca en `prod` y `harness-loki`
  en `local`. Cambiar de herramienta sin escribir `TARGET=` te cambia de ambiente sin avisar (F-234). Cada
  salida imprime su comando con el target adentro: pegá ese.
- ⚠ **`trazador-acceso` muestra una MUESTRA, no un conteo.** Para contar, la expresión métrica:
  `QUERY='sum(count_over_time({service_name="x", level="error"} [24h]))'`.

## Antes de concluir de una traza

- **Un estado dice DÓNDE está la solicitud, nunca QUÉ completó.** El estado 10 pertenece a
  `disbursement` pero significa «adentro, sin firmar» (F-103); la fila de estado 9 **se escribe al CREAR la
  solicitud** (F-106); y `user_request_records` **no registra todas las transiciones** — los estados 1 y 10
  nunca dejan fila (F-105). Por eso `cierran` y `detienen` están separados en el mapa.
- **El wizard NO manda logs a Loki**: sus logs salen por OTLP hacia PostHog. **La pantalla se INFIERE del
  endpoint que el backend sirvió**, y una pantalla que no llama al backend es invisible.
- **Hay evidencia en la BD que el trazador NO mira**: de las tablas de log de auditoría, sólo
  `deceval_logs` ata al 100 % por `user_request_id` (y ya se lee, junto con `users_category_log`);
  `otp_logs` apenas al ~1 %; `compare_face_logs` y `ocr_logs` **declaran la columna y nunca la escriben**:
  usarlas devolvería vacío siempre y se leería como «no pasó» (F-108).
- **Las funciones SQL no loguean**: las rutinas de MySQL que calculan ingreso, ocupación o los features del
  ML muestran la entrada y la salida, nunca el medio.
- **Un rechazo de cupo ROTATIVO (rt=3) es invisible**: el corte `multiplier <= 3` retorna antes de escribir
  nada, así que la etapa sale `sin-evidencia` y el «¿por qué 0?» queda sin contestar (F-115). Se arregla
  en el producto, no acá.
- **`risk_central_user_data` se cruza por `user_id`**: un cliente con varias solicitudes en la ventana
  contamina la traza. Se avisa en los warnings, pero las filas cuentan en los totales.
- **Sólo ~13 % de las líneas de log dice a qué solicitud pertenece**, con tres nombres distintos
  (`context_user_request_id`, `context_userRequestId`, `context_request_id`; F-102). El resto se ubica por
  herencia de span, y el pie de la traza lo declara.
- **`LOKI_ENV` no es igual en los dos stacks**: prod es `production`; dev/qa usa
  `development|local|testing` y **no tiene `qa`**: filtrar por `environment=qa` da cero con los logs ahí.
- **Dev y qa se separan por `service_name`** (dev → `legacy-backend`, qa → `CreditopDev`), y
  `LOKI_SERVICE` **avisa, no filtra**: una solicitud pasa por los dos backends, y la traza cierra con el
  reparto (`splitByBackend`). Lo pone un secreto del despliegue: puede cambiar sin commit (README §«El
  ambiente es el STACK»).
- **Las etiquetas en español del trazador NO son los strings del log** («Regla de categoría rechazada» ≠
  `CATEGORY_RULE_REJECTED`): buscar en Loki por la etiqueta no devuelve nada.
- **Credifamilia se decide por `id == 24`**, por identidad y no por configuración: miente el día que
  cambie de id.

## Fronteras: qué NO contesta, y quién sí

- **Qué significa cada tabla o columna**, **con qué string se busca cada decisión** (`CATEGORY_*`,
  `QUOTA_CHECK_REJECTED`, `REVOLVING_CREDIT_*`, `STAGE 0…4`) y **por qué el sistema se comporta así** →
  canon, en el tema dueño de esa decisión.
- **Los hallazgos** que el trazador ayudó a encontrar → las trampas del sistema (`tablero/data/traps/`).
- **Ejercitar un flujo** → `harness`. El trazador LEE lo que ya pasó; el harness lo PROVOCA.

## Qué deja esto en la tarea

Lo que devuelve **no se resume a mano**. Con `BLOQUE=<id|slug>` (`trazador-ureq` · `-buscar` · `-sql`) se
agrega solo como bloque a la pila de la tarea, con el comando exacto y lo que dio (`via: trazador`):

    make trazador-sql TARGET=prod SQL='SELECT …' BLOQUE=<tarea>

La receta para volver a comprobarlo va a «Cómo se comprueba» del documento. `MD=1` da la anotación para
un documento que no es una tarea (un `CLAUDE.md`, una trampa). **Va con el comando** porque una medición
sin comando no se puede volver a tomar ni desmentir, y el validador de la pila lo exige: la caja
` ```trazador ` o ` ```sql prod ` con su ambiente, y debajo su `Resultado:`.

Si lo medido resultó ser del SISTEMA —una trampa reproducible, con causa raíz—, gradúa a
`tablero/data/traps/doc.md`.

⚠ **A Jira va la medición, no la herramienta**: *«se consultó producción: el 12 % de las solicitudes…»*,
nunca el `make trazador-sql`. El guard del tablero frena la palabra `trazador`.

## Lo que NO está verificado

- `-validar` no corre desde el 2026-08-06: el corpus de líneas crudas se perdió; regenerarlo implica decidir
  si líneas de producción entran al repo.
- Los 12 matchers `soloEnCodigo` del tramo identity (OCR/Rekognition/ADO) no fueron alcanzados por ninguna
  traza medida.
