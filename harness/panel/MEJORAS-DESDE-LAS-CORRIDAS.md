# Panel: mejoras que salen de haber corrido las cinco familias

> Escrito el **2026-08-24**, después de cerrar rt=0/1/2/4 de punta a punta en local y de los doce
> hallazgos F-163…F-174. **La regla que ordena esta lista es la de Miguel: el panel CORRE flujos
> (inyecta + bypass) y nada más; validar negocio va aparte, por CLI.** Cada propuesta dice por qué
> cae del lado de «correr». Al final están las dos cosas que NO se proponen, a propósito.
>
> Orden: por cuántas corridas arruinadas se ahorra, no por costo.

---

## 1. Semáforo de dependencias ANTES del botón «Lanzar»

**El problema medido:** a Credifamilia la separan del estado 11 **seis externos**, y cuando falta uno
la solicitud muere en estado 28 con un mensaje que culpa al proveedor, no al mock ausente (**F-165**).
El runner de consola ya tiene ese prevuelo; el panel lanza a ciegas. Y tres de los mocks
(`mock-pdf-mapper`, `mock-deceval`, `mock-netco`, más `mock-credifamilia` y MinIO) **no los levanta
nadie** — `bin/asesor` sólo arranca los seis básicos.

**Qué agregaría:** una tira de puntos verdes/rojos sobre el botón de lanzar — un `GET /` a cada mock
(:8095…:8108), MinIO (:9000) y, si el flujo lo va a necesitar, `legacy-application` (:8000). Rojo =
tooltip con el comando exacto (`bin/mock-deceval start`). Opcional: botón «levantar lo que falta»,
que es plumbing, no validación.

**Por qué es «correr»:** es el estado del ambiente, no del negocio. Una corrida lanzada sin sus mocks
no es una corrida: es media hora de diagnóstico de un error que no existe.

---

## 2. El desenlace por FAMILIA en la tira de estado — y la radicación al lado del 11

**El problema medido:** «llegó a 11» no es el final para todas las familias, y para dos de ellas ni
siquiera es la vara correcta:

| familia | desenlace real |
|---|---|
| rt=2 | 11 |
| rt=4 | 11 **+ radicación** (`lender_transactions`: sólo `CREDIT_COMPLETED` es «el lender lo recibió») |
| rt=0 / rt=1 | **3** — esperando el webhook de la entidad |
| Bancolombia QR | **25** + código de compra |
| rt=3 | hoy revienta en 10 (F-169) |

Lo caro es **F-168**: la radicación falla **sin mover el estado y sin cambiar el HTTP** — el panel hoy
mostraría «Autorizada ✓» con el crédito jamás enviado al lender.

**Qué agregaría:** que la tira de estado sepa la familia del lender elegido y muestre su terminal
propio. Para rt=4, un chip al lado del 11 con el estado de `lender_transactions`. Para rt=0/1, «3 —
esperando a la entidad» en vez de un final ambiguo.

**Por qué es «correr»:** no juzga nada — muestra **dónde quedó de verdad** la corrida. El juicio
(¿debía radicar?) sigue en la CLI.

---

## 3. Botón «la entidad responde» (rt=0 y rt=1)

**El problema medido:** para la familia con más volumen (rt=0: 46 % de las solicitudes de prod) y
para rt=1, el flujo del panel termina en un estado 3 que no va a moverse nunca — la vuelta llega por
webhook a `legacy-application`, y en local eso **ya funciona** (verificado: `fulfilled`→11,
`dismissed`→8, `rejected`→6, `pendiente_desembolso`→28; **F-170/F-171**).

**Qué agregaría:** al terminar una corrida rt=0/1, un control con los estados que la entidad puede
responder y un botón que dispara **el webhook real** (el receptor es `legacy-application`; lo único
simulado es la entidad que llama — igual que el runner de consola con `@webhook=`). Con dos trampas ya
resueltas que el panel hereda gratis: el subdominio `api.localhost` y el token.

**Por qué es «correr»:** es la definición exacta de inyectar+bypass — completa el flujo que el panel
mismo lanzó. Sin esto, el panel sólo puede correr media familia.

---

## 4. Marcar en el selector las entidades que van a reventar ANTES de lanzar

**El problema medido:** tres configuraciones que hacen fallar la corrida con la entidad ya elegida y
el cliente ya con todo completado — y ninguna se ve al elegir:

- rt=2 **sin categorías** → 500 al autorizar (**F-172** — y en prod hay 6 así, activas)
- rt=3 con cliente **sin cupo previo** → 500 generando documentos (**F-169**)
- entidades **muertas** que igual listan — «Bancolombia (No activo)» tiene 0 solicitudes en 90 días y
  el sufijo delator **sólo existe en prod** (**F-173**), así que hay que marcarla por señal medida, no
  por nombre

**Qué agregaría:** un badge en la tarjeta del lender (el panel ya muestra el chip de rt): «⚠ sin
categorías: revienta al autorizar» · «⚠ rt=3: pide cupo previo» · «⚠ sin tráfico en prod». Tres
consultas baratas a la BD local al cargar el comercio.

**Por qué es «correr»:** evita lanzar una corrida cuyo final ya se sabe. No opina sobre si la
configuración es correcta — eso es la tarea 66 y las CLI.

---

## 5. Los PLAZOS que la entidad ofrece, visibles al elegir

**El problema medido:** cada entidad ofrece un juego cerrado (Credifamilia 6/12/18/24 · CrediPullman
1/3/6 · Motai 6/12/24/36 · Sufi 3/6) y pedir uno fuera corta con un `CP050` que **no nombra las
cuotas** — mientras el backend, por el hueco de **F-167**, acepta cualquiera si se lo fuerza. El
default histórico del runner (4) no lo ofrece **ninguna** de las probadas.

**Qué agregaría:** chips con los plazos reales del lender elegido (salen de `simulate-payment-schedule`
o de la config), y el elegido viaja a la corrida.

**Por qué es «correr»:** configura la corrida con valores que existen. El hueco de validación del
backend queda donde está: en el hallazgo y su tarea.

---

## 6. «Abrí lo que produjo la corrida»: los documentos, ahora que existen

**El problema medido:** hasta F-174, cada PDF «subido» fallaba en silencio y su URL daba 404 — no se
podía abrir nada. Con MinIO ya quedan de verdad (cabecera `%PDF-`, consola en :9001).

**Qué agregaría:** al cerrar una corrida, la lista de documentos producidos como links (la URL ya
queda en la base y ahora resuelve). Un clic para ver el pagaré que esa corrida generó — que además es
la única forma de notar a ojo un bug de plantilla (F-150), justo lo que ninguna aserción cubre.

**Por qué es «correr»:** es enseñar el artefacto de la corrida. Mirarlo y juzgarlo es humano.

---

## Lo que NO se propone, a propósito

- **Aserciones o veredictos de negocio en el panel** («esperaba radicación», «no debía listar») — eso
  es `harness-caso`/`harness-suite`, y la regla existe justamente para que el panel no se convierta en
  un segundo runner. Ya se intentó meter el modo rápido acá y se revirtió.
- **Corridas en paralelo desde el panel.** El paralelismo es para barrer; el panel es para MIRAR una
  corrida. Además el paralelo destapa F-166 (deadlock rt=4) y la lentitud de dompdf bajo concurrencia —
  ruido para un humano mirando una pantalla.
