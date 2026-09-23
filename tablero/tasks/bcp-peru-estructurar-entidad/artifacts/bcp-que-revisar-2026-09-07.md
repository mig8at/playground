# BCP (Cuotéalo · Perú) — qué hay que revisar del flujo

**Fecha:** 2026-09-07 · **Alcance:** el recorrido del asesor, de la pantalla de celular hasta elegir la
entidad, en sus dos productos (consumo y vehicular).

**Cómo leer cada punto.** Cada uno dice de dónde sale lo que afirma:

| marca | qué significa |
|---|---|
| **MEDIDO** | se recorrió el flujo y se miró el resultado. Los números son de esa corrida. |
| **LEÍDO** | verificado contra el código de `main`, sin ejercitarlo. |
| **PROD** | comprobado contra la base de producción, en sólo lectura. |
| **ABIERTO** | no se pudo determinar; queda como pregunta. |

Y una advertencia sobre el alcance: todo lo MEDIDO se midió **en local**. Nada de esto está confirmado
en un ambiente desplegado, y en el punto 12 se explica por qué eso importa más de lo habitual acá.

---

## 1. El monto a financiar no se guarda en ningún lado: viaja sólo en la dirección

**Qué pasa** — En el vehicular, el monto del crédito **no es** el valor del vehículo: es
`valor − cuota inicial − bono`. El formulario lo calcula bien. Pero ese número **no se persiste**: se
manda en la dirección (`?amount=`) de pantalla en pantalla, y `user_requests.amount` se queda con el
valor del vehículo hasta que se elige la entidad.

**Dónde** — `apps/loan-request-wizard/app/routes/placement-form.tsx` (el `action`, que redirige con
`?amount=<financiado>` y dice explícitamente «NO SE TOCA `user_requests.amount`»);
`apps/loan-request-wizard/app/utils/route-helpers.ts` (`withFunnelSearch`);
`apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx` (el `loader`:
`Number(url.searchParams.get("amount") || 0)`).

**Por qué daña el flujo** — Si el parámetro se pierde, el listado **no cae al monto de la solicitud**:
cae al que resuelva el backend. MEDIDO: vehículo 60.000, inicial 10.000, bono 2.000 → a financiar
**48.000**. En la misma solicitud, la entidad cotiza **48.000 con el parámetro y 180.000 sin él**. Ni
48.000 ni 60.000: un tercer número.

**El peligro** — Se pierde con una recarga sin parámetros, con un enlace pelado, con un «atrás» (punto
2) y con cualquier pantalla que redirija sin arrastrarlo. El cliente ve una cuota calculada sobre un
monto que no pidió, **y nada lo señala**: la pantalla se ve igual. Y el monto que el asesor tenga en la
dirección en el momento de elegir la entidad **es el que queda persistido**. El propio código ya lo
anticipa —«el monto es el caso que duele… ese monto es el que termina persistido al seleccionar la
entidad»—: lo que faltaba era medir que efectivamente pasa.

**A revisar:** que el monto a financiar quede escrito en la solicitud al guardar el formulario, y que
el listado caiga a ese valor cuando el parámetro falte, en vez de a un default.

---

## 2. Volver atrás no devuelve al formulario: rebota hacia adelante y reinyecta el monto viejo

**Qué pasa** — Una vez que el asesor registra el resultado de la preaprobación, el formulario del
vehículo **deja de ser alcanzable**. Pedirlo redirige al paso siguiente — y el redirect reenvía los
parámetros **de la petición**, que en un «atrás» son los de antes del formulario: el valor del
vehículo.

**Dónde** — `apps/loan-request-wizard/app/modules/allied-theme/application/resolve-onboarding-destination.uc.ts`
(la bandera `always_show` sólo se honra mientras la etapa es `onboarding`, así que después del gate el
formulario se saltea por «ya respondido») + el `loader` de `placement-form.tsx`, que redirige con
`withFunnelSearch(destino, url.search)`.

**Por qué daña el flujo** — MEDIDO: pedir `formulario/pre?amount=60000` (la dirección que el navegador
tiene guardada en su historial) responde `→ formulario/post?amount=60000`. O sea: el asesor no puede
corregir el vehículo **y además** el rebote pisa los 48.000 con los 60.000. Los dos efectos son del
mismo movimiento.

**El peligro** — Es el escenario más probable de todos: el asesor se equivocó en la cuota inicial o en
el bono, aprieta atrás para arreglarlo, el sistema lo devuelve hacia adelante sin dejarlo tocar nada, y
a partir de ahí cotiza mal. La intención del diseño era la contraria: el comentario de la bandera dice
que en el flujo de vehículo «los datos son variables hasta que se elige entidad, así que el asesor
tiene que poder retomar la solicitud y cambiarlos».

**A revisar:** que el formulario del vehículo siga siendo editable después del gate (y que cambiarlo
invalide la simulación anterior, ver punto 9), y que un redirect nunca reenvíe un monto que no calculó.

---

## 3. El registro del resultado se puede volver a apretar, y «Rechazado» mata una solicitud que ya siguió

**Qué pasa** — La pantalla donde el asesor marca si el cliente tenía oferta preaprobada **no mira en
qué etapa está** cuando se carga. Se puede volver a ella con el botón de atrás en cualquier momento
posterior, y los dos botones siguen vivos.

**Dónde** — `apps/loan-request-wizard/app/routes/entidad/resultado.tsx` (el `loader` sólo precalienta
una consulta; no valida etapa) y `apps/loan-request-wizard/app/routes/entidad/simulador.tsx` (igual).
Del lado backend, `app/Http/Controllers/Api/AlternateFlowRejectionController.php`.

**Por qué daña el flujo** — MEDIDO: solicitud marcada «Aprobado» → estado **9** y el flujo sigue al
formulario siguiente. Se vuelve al gate con el atrás, se marca «Rechazado» → estado **6 (Negada)** y a
la pantalla de retorno, que es terminal. El backend sólo protege el estado 11 (autorizada) y el 6 (ya
negada); todo lo demás se sobreescribe.

**El peligro** — Un clic en la pantalla equivocada mata una solicitud viva, y no hay camino de vuelta
desde ahí: hay que abrir otra y volver a pedirle todo al cliente. Con dos botones del mismo tamaño,
uno al lado del otro, y una pantalla a la que se llega apretando atrás dos veces, es cuestión de
tiempo.

**A revisar:** guarda de etapa en el `loader` de las dos pantallas; y que una decisión ya tomada se
muestre como tomada en vez de volver a preguntarla.

---

## 4. La decisión del gate vive en la cookie del navegador, no en la solicitud

**Qué pasa** — Que el asesor ya pasó por el simulador y registró el resultado se anota en la **sesión
del navegador**, firmada. No hay ninguna columna en la solicitud que lo diga.

**Dónde** —
`apps/loan-request-wizard/app/modules/form-placements/infrastructure/alternate-flow-session-marker.server.ts`
(el archivo lo declara como limitación conocida).

**Por qué daña el flujo** — MEDIDO: con una sesión nueva sobre la misma solicitud, pedir el formulario
posterior devuelve al formulario del vehículo. El asesor que cambia de equipo, que limpia cookies, que
atiende desde otra sucursal o al que se le venció la sesión **repite el tramo entero**, incluida la
simulación.

**El peligro** — Falla hacia el lado seguro (repetir, no saltear), pero combinado con el punto 2 el
regreso también arrastra el monto viejo. Y hay un daño de negocio aparte: **la decisión no queda
registrada en ningún lado nuestro**. Si el microservicio de preaprobados no la recibió (punto 5), no
existe.

**A revisar:** persistir la decisión en la solicitud. Cierra esto y ayuda con el punto 3.

---

## 5. La decisión del asesor se registra «lo mejor que se pueda»: si falla, se pierde en silencio

**Qué pasa** — Las dos escrituras que dispara el gate —registrar la decisión en el microservicio de
preaprobados y cerrar la solicitud cuando se rechaza— están escritas para **no fallar nunca**: si algo
sale mal, se captura y el flujo sigue.

**Dónde** — `entidad/resultado.tsx`, funciones `registerLenderDecision` y `closeRejectedRequest` (las
dos dicen «NUNCA LANZA»).

**Por qué daña el flujo** — Es una decisión de diseño defendible —no dejar al asesor trabado por un
servicio caído— pero el costo es que **la pantalla avanza igual**. Si el registro no llegó, el
preaprobado no existe, y la pantalla de entidades no muestra nada: el asesor ve un listado vacío sin
ninguna pista de por qué.

**El peligro** — El error queda sólo en el monitoreo, no en la pantalla ni en la solicitud. Nadie se
entera hasta que un comercio reclama. Y en el caso del rechazo, la solicitud puede quedar **abierta**
aunque el asesor la haya rechazado.

**A revisar:** al menos, que el desenlace de esas dos escrituras quede en la solicitud, para poder
distinguir «no se registró» de «se registró y no aprobaron».

---

## 6. Los ids de las entidades de BCP están quemados, y el de producción no es el que dice el código

**Qué pasa** — Hay tres lugares con ids de entidad de BCP y **no coinciden con producción**:

- El front manda la decisión contra una lista quemada de tres pares:
  `bcp_consumo/206`, `bcp_vehicular/207`, `bcp_consumo/198`.
- El backend resuelve el lender de un rechazo con `Bcp::LENDER_ID = 206` para consumo, y con
  configuración (`services.cuotealo.vehicular_lender_id`, 207 por defecto) sólo para el vehicular.

**PROD** — En producción existe **una sola** entidad de BCP: **id 198, `bcp consumo`**. **206 y 207 no
existen.**

**Dónde** — `entidad/resultado.tsx`, constante `BCP_LENDING_PRODUCTS`;
`app/Actions/Lenders/Bcp/Bcp.php` (`const LENDER_ID = 206`);
`app/Http/Controllers/Api/AlternateFlowRejectionController.php` (`resolveLenderId`);
`config/services.php`, bloque `cuotealo`.

**Por qué daña el flujo** — Dos consecuencias distintas:

1. **Cada decisión en producción dispara dos registros que fallan** (206 y 207 no existen allá). Se
   juntan y se mandan al monitoreo — ruido permanente que enseña a ignorar esa alerta.
2. **Un rechazo de consumo en producción estampa `lender_id = 206`**, una entidad que no existe. El
   comentario del propio controlador dice que «marcar un lender inexistente rompe cualquier reporte
   que haga join contra `lenders`» — y eso es exactamente lo que pasa por el camino de consumo, porque
   el resguardo que escribieron protege sólo al vehicular.

**El peligro** — La asimetría es deliberada y está documentada («configurable y no quemada como la de
consumo (206): los ids difieren por ambiente»), o sea que quien la escribió sabía que los ids difieren
y dejó uno quemado igual. El día que el vehicular exista en producción con otro id, el registro se
escribe bajo un producto que la pantalla nunca consulta y el listado sale vacío: **ya pasó una vez**,
y está anotado en el propio archivo del front.

**A revisar:** los dos ids por configuración, en un solo lado, y que la lista del front salga de la
respuesta del backend en vez de estar quemada.

---

## 7. Se puede abrir la solicitud de otro cliente cambiando el número en la dirección

**Qué pasa** — El número de solicitud viaja en la dirección y **es secuencial**. La comprobación de que
esa solicitud es de quien la está pidiendo existe, pero **está apagada salvo que una variable de
entorno la prenda**, y sólo cubre una de las tres pantallas de formulario.

**Dónde** — `apps/loan-request-wizard/app/utils/loan-request-ownership.server.ts`
(`isOwnershipEnforced()` exige `LOAN_REQUEST_OWNERSHIP_ENFORCED === "true"`); se usa en
`placement-form.tsx`, que además deja escrito que `additional-info-form.tsx` y `dynamic-form.tsx`
**tienen el mismo hueco y no se cerró**.

**Por qué daña el flujo** — El `loader` del formulario devuelve las respuestas guardadas de esa
solicitud como valores iniciales de los campos. Cambiar un dígito muestra los datos del cliente
anterior.

**El peligro** — Datos personales de terceros, con sólo editar la barra de direcciones. El apagado era
temporal y con una razón buena (no rechazar a quien validó el OTP antes del despliegue); lo que hay que
revisar es **si sigue apagado hoy en cada ambiente**, y las otras dos pantallas.

---

## 8. El endpoint que niega una solicitud no pide autenticación

**Qué pasa** — La ruta que marca una solicitud como negada acepta un POST con el número de solicitud y
sin credenciales. Está pensada como llamada interna entre servicios.

**Dónde** — `Modules/Onboarding/routes/webhooks.php`, ruta
`api/onboarding/loan-application/{userRequestId}/alternate-flow-rejected` («backend->backend por red
interna, sin Cognito»).

**Por qué daña el flujo** — Su protección es la topología de red, no un secreto. En el mismo archivo, la
ruta vecina lleva un aviso explícito —«NO PUBLICAR esta ruta. Si alguna vez se expone, hace falta un
secreto compartido»— **y ésta no lo lleva**, aunque es más peligrosa: la vecina recibe un dato, ésta
cambia el estado de una solicitud.

**El peligro** — Si alguna vez queda alcanzable desde afuera, con números secuenciales se pueden negar
solicitudes en masa. Hoy no está publicada; el punto a revisar es que **nada lo garantice más que la
configuración de red**.

---

## 9. Nada obliga a que la decisión registrada corresponda a lo que se simuló

**Qué pasa** — El simulador es un marco embebido de BCP: **no nos devuelve nada**. Por eso la decisión
la reporta el asesor a mano. Pero si el vehículo cambia después de simular, la simulación anterior deja
de valer y **no hay nada que lo detecte**.

**Dónde** — `entidad/simulador.tsx` (el botón de continuar es una navegación del cliente, sin acción de
servidor) y `alternate-flow-session-marker.server.ts` (la marca se limpia **al retomar** la solicitud,
desde la validación del OTP — no cuando se edita el formulario dentro de la misma sesión).

**Por qué daña el flujo** — El caso está previsto para el retomar y no para la edición: el comentario
dice «si el asesor puede cambiar el vehículo, la simulación hecha con el vehículo anterior ya no vale».
Hoy eso sólo se honra si el cliente vuelve a entrar por el OTP.

**El peligro** — Una decisión de preaprobación registrada sobre un vehículo que ya no es el de la
solicitud. Es dato autoreportado, así que ninguna validación lo va a contradecir después.

---

## 10. El simulador falla mudo: cuando no carga, se ve igual que cuando carga bien

**Qué pasa** — El marco embebido puede quedar en blanco por tres razones distintas —el punto de venta
no es vehicular, falta configuración en el ambiente, o el catálogo no respondió— y **las tres se ven
igual**. Además, si el prellenado falla, la pantalla degrada a la dirección pelada del simulador, que
también se ve igual.

**Dónde** — `entidad/simulador.tsx`. Hoy el único diagnóstico es un `console.log` en el navegador del
asesor, puesto justamente porque el fallo es mudo.

**Por qué daña el flujo** — El botón «Completar datos y continuar» está disponible **igual**, cargue o
no cargue el marco. Se puede pasar el paso sin haber simulado nada, y después registrar «Aprobado».

**El peligro** — Y hay dos bloqueos de la contraparte que hacen esto muy probable: el host de
desarrollo responde `X-Frame-Options: SAMEORIGIN` (el navegador se niega a mostrarlo) y el de producción
está detrás de un cortafuegos que **sólo acepta direcciones IP de Perú**. Mientras BCP no autorice
nuestro origen, la pantalla central del flujo está vacía y el flujo sigue igual.

**A revisar:** que la pantalla diga que el simulador no cargó, y que no se pueda registrar un resultado
sobre un simulador que nunca se mostró.

---

## 11. La solicitud no radica si faltan diez filas de catálogo, y el nombre de esas filas cambia por producto

**Qué pasa** — Cada producto escribe su propio juego de estados locales, y **los nombres no son los
mismos**: consumo usa `BCP_PENDING`, `BCP_APPROVED`… y el vehicular `BCP_VEHICULAR_PENDING`,
`BCP_VEHICULAR_APPROVED`… Son cinco por producto, diez en total, y tienen que existir en cada ambiente.

**Dónde** — `app/Actions/Lenders/Bcp/Bcp.php` y `app/Actions/Lenders/Bcp/BcpVehicular.php`
(`resolveStatusId`), contra `lender_transaction_statuses`.

**Por qué daña el flujo** — Si falta la fila que toca, `resolveStatusId` falla y **la solicitud no
radica**. El propio archivo lo advierte.

**El peligro** — Es un prerrequisito de despliegue que no vive en una migración sino en datos, con dos
juegos de nombres para el mismo proveedor. Un ambiente al que le siembran los cinco de consumo y no los
del vehicular tiene el producto listando y sin poder radicar.

**A revisar:** que las diez filas estén sembradas en cada ambiente donde el producto se ofrece, y si
hace falta que sean dos juegos de nombres.

---

## 12. Lo que todavía no está probado, y por qué importa acá más que en otros flujos

- **Nada de esto está confirmado en un ambiente desplegado.** Todo lo MEDIDO es local.
- **La pantalla del simulador no se pudo ejercitar de verdad** por los dos bloqueos de la contraparte
  (marco no autorizado, cortafuegos por país). O sea que el corazón del flujo —lo que el cliente ve
  cuando decide— **no lo vio nadie funcionando**.
- **El vehicular no existe en producción.** Todo lo que se afirme de él es de desarrollo.

---

## Lo que YA está corregido (para no volver a abrirlo)

- **El campo «Monto a financiar» ya se calcula.** Era visible, obligatorio y no editable, y hasta el
  2026-09-03 nadie llenaba su valor: la pantalla pedía un dato que no se podía dar. El cálculo
  (valor − cuota inicial − bono) entró a `main` ese día y está enganchado al render del formulario.
  **A confirmar en el navegador**, porque es comportamiento del cliente.
- **La configuración duplicada de Cuotéalo.** Hubo dos bloques `'cuotealo'` en `config/services.php`, y
  en PHP el segundo gana: la clave de cancelación quedaba descartada y la dirección de vuelta se armaba
  con un segmento vacío. Hoy hay **un solo bloque**, con las dos claves adentro.
- **El formulario ya no se precarga con el vehículo de la solicitud anterior.** Se llenaba solo con los
  datos del cliente de otra solicitud —marca, modelo, año, valor— y se podía continuar sin revisar
  nada. Hoy sólo se precarga el valor del vehículo, y desde el monto de **esta** solicitud.

---

## Preguntas abiertas

1. **¿De dónde sale el monto que usa el listado cuando falta el parámetro?** MEDIDO da 180.000 sobre un
   vehículo de 60.000; no es el monto de la solicitud ni el financiado. Hay que rastrear qué default
   aplica el backend cuando recibe monto cero.
2. **¿`LOAN_REQUEST_OWNERSHIP_ENFORCED` está prendida hoy en cada ambiente?** El código sólo dice que
   por defecto está apagada.
3. **¿La entidad de consumo de producción (198) está cableada al comercio piloto?** Existe y está
   activa; no se revisó su cableado ni sus reglas.
4. **¿Cuándo autoriza BCP el marco embebido y la dirección IP?** Mientras eso no pase, los puntos 9 y
   10 no se pueden cerrar, y el flujo no se puede probar de punta a punta contra la contraparte real.
