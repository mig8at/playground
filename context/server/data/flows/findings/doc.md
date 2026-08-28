# Findings · registro vivo de trampas del sistema

> **estado:** abierto, se agrega al final · Bitácora de cosas que **costaron tiempo descubrir**:
> síntoma → causa raíz verificada → evidencia → arreglo → estado. **Antes de depurar un muro, buscá
> tu síntoma en el índice de abajo** — buena parte de lo que parece un bug del producto ya está acá.

## Protocolo

- **El `F-xx` es un identificador PÚBLICO** (lo citan `harness/`, `trazador/`, `tablero/` y varios
  `map.json`): no se renumera, no se muda de archivo, y el ancla `### F-xx` no desaparece nunca.
- Entrada nueva = `### F-NN` correlativo al FINAL del archivo, con los 5 campos, **techo ~30 líneas**,
  sin «Actualización <fecha>» dentro del cuerpo (si el hecho cambió, se reescribe el hecho) — y su
  fila en los DOS índices de abajo. La causa raíz va **verificada** o marcada `hipótesis, sin confirmar`;
  si el síntoma engaña, decilo en el título.
- **Al graduar el hecho a un nodo, el cuerpo se colapsa a stub ese mismo día** (título + tesis +
  `→ nodo dueño`). La crónica queda en git y, si era un incidente cerrado, en `cerrados.md` (frío,
  greppeable — la regla automatizable: «resuelto + cero citas externas ⇒ frío»).
- Las viejas secciones A–O eran historia, no temas — se retiraron; **los índices son la única puerta**.

## Índice · ¿con qué síntoma llegás?

Nadie lee este archivo entero: entrá por acá, saltá al `F-xx` y leé solo eso. (Los números no van en
orden de archivo — el ancla `### F-xx` es la única dirección.)

| Si tu síntoma es… | Mirá |
|---|---|
| **«¿este comercio es Corbeta?» / entra por una puerta y no por otra** | F-125 |
| **«reversar un pago tira 500»** | F-126 |
| **«se le cambió sola la config de una entidad»** | F-127 |
| **«al comercio no le cuadra lo que recibe»** | F-128 |
| **«la comisión del reporte salió en cero»** | F-129 |
| **«un reporte por país trae datos absurdos»** | F-130 · F-131 |
| **«se guardó el nombre mal / con un solo apellido, y nada avisó»** | **F-132** · F-133 |
| **«Deceval rechaza por identidad» / el pagaré dice otra persona** | **F-133** · F-121 · F-122 |
| **«desplegué y el log no aparece en Grafana» / «esto no está desplegado»** | **F-134** |
| **«me llegó el SMS pero dice que no hay OTP» / `NO_PREVIOUS_OTP` en staging** | **F-135** |
| **«está autorizada pero no puedo sacar el voucher»** | **F-136** |
| **«sembré las credenciales y el SOAP sigue sin encontrarlas»** | **F-137** |
| **«le salen menos cuotas de las parametrizadas»** | F-110 · **F-147** |
| **«no le puedo cambiar el plazo y el crédito sí admite cambios»** | **F-147** |
| **«elige una fecha de pago y el cambio la rechaza»** | **F-148** |
| **«le aprobaron cupo a alguien que no debía»** | F-112 |
| **«no sale la opción de una entidad, sin error»** | F-113 |
| **«esto anda en local y no en dev/qa» / «probé contra el ambiente equivocado»** | F-06 · F-18 · F-61 · F-62 · F-65 · F-73 · F-74 · F-76 · F-77 · F-95 |
| **«parece un bug del producto» (y es una env faltante)** | F-04 · F-05 · F-23 · F-70 · F-98 · F-99 · F-104 |
| **«la pantalla no avanza y no hay ningún error»** | F-01 · F-02 · F-03 · F-58 · F-88 · F-91 · F-92 |
| **«¿en qué repo vive esto? / no está en el monolito»** | **F-123** |
| **«el dato parece corrupto / hay que normalizarlo»** | **F-124** |
| **«¿qué significa de verdad esta tabla/columna?»** | F-19 · F-24 · F-93 · F-96 · F-97 · F-100 · F-101 · F-103 · F-105 · F-106 |
| **«los logs no me dicen de qué solicitud son»** | F-20 · F-98 · F-99 · F-102 |
| **«no le aparece ninguna entidad en el listado»** | F-04 · F-34 · F-56 · F-75 · F-78 |
| **«¿qué integra de verdad este comercio / esta entidad?»** | F-25 · F-26 · F-27 · F-28 · F-34 · F-35 · F-37 |
| **«el buró: ¿se consultó para ESTA solicitud?»** | F-101 · F-107 |
| **«¿hay evidencia en la BD que el trazador no mira?»** | F-108 |
| **«¿esta herramienta es de verdad solo-lectura?»** | F-109 |
| **«el crédito no cierra en local»** | F-07 · F-08 · F-09 · F-10 · F-11 · F-12 · F-13 · F-29 · F-30 · F-31 · F-36 |
| **«falló la validación de identidad / se canceló solo»** | F-10 · F-55 · F-60 · F-62 · F-63 |
| **«firma, pagaré, OTP de firma»** | F-02 · F-11 · F-12 · F-30 · F-32 · F-36 · F-37 · F-58 · **F-121** |
| **«el pagaré dice una persona y la BD dice otra»** | **F-121** |
| **«el webhook del lender no llegó (¿o sí?)»** | F-94 · F-100 · F-111 |
| **«el agregador aprobó / el cliente firmó, y sigue en Seleccionó entidad»** | F-111 · F-94 |
| **«el perfilador / el orden del listado / el cupo»** | F-04 · F-93 · F-104 |
| **«¿por qué a este cliente no le salió esta entidad?»** | **F-118** · F-112 · F-115 |
| **«una entidad dejó de salir de un día para otro, sin deploy»** | **F-119** |
| **«el motor decidió sin evaluar las reglas»** | **F-120** |
| **Canal Corbeta y código de compra en caja** | F-79 · F-80 · F-81 · F-82 · F-83 · F-84 · F-85 · F-86 · F-87 · F-88 · F-89 · F-90 · F-91 · F-92 |
| **Bancolombia (BNPL / Consumo)** | F-05 · F-54 · F-83 · F-84 · F-89 · F-90 · F-91 · F-92 |
| **Motai · Ábaco · renting** | F-46 · F-47 · F-48 · F-49 · F-50 · F-51 · F-68 · F-69 |
| **SmartPay · IMEI** | F-21 · F-22 · F-23 · F-24 · F-32 |
| **Ecommerce** | F-40 · F-54 |
| **Flujo dinámico (RD)** | F-41 · F-42 · F-43 · F-44 · F-45 |
| **Rotativo (rt=3) y servicing** | F-38 · F-39 · F-114 · F-115 · F-116 · F-117 |
| **«el rotativo le dio cupo 0 y no sé por qué»** | F-115 · F-117 |
| **«lo que vio en pantalla no es lo que quedó guardado»** | F-114 |
| **«el mismo cálculo está hecho dos veces y no coinciden»** | F-71 · F-114 · **F-122** |
| **«el pagaré no se firma / Deceval lo rechaza»** | **F-122** · F-121 |
| **Tasas, fianza y cálculo** | F-71 · F-72 |
| **«el harness hace algo raro» (la herramienta, no el producto)** | F-14 · F-15 · F-16 · F-17 · F-33 · F-52 · F-53 · F-57 · F-59 · F-64 · F-66 · F-67 · F-87 · F-90 |
| **«cambio la entidad de una solicitud y tira 500»** | F-138 |
| **«dicto una respuesta al mock y sigue contestando lo mismo»** | F-139 |
| **«al comercio le faltan entidades en el listado, sin mensaje»** | F-140 |
| **«por API no se dispara la pre-aprobación»** | F-141 |
| **«el comercio no ofrece NINGUNA entidad»** | F-142 |
| **«el comercio no ofrece ninguna entidad, y una está sólo en la sucursal»** | F-143 |
| **«le dicté un rechazo al mock y la solicitud pasó igual»** | F-144 |
| **«cambié el nombre que devuelve la central y no rechaza»** | F-145 |
| **«el mock acepta lo que le dicto pero contesta otra cosa»** | F-149 |
| **«el documento no se genera y el render se queja de una variable»** | F-150 |
| **«la firma del codeudor devuelve 500 y todo lo anterior anduvo»** | F-151 |
| **«firmó un contrato que no es el del producto que compró»** | F-152 |
| **«el cliente firmó documentos que se contradicen entre sí»** | **F-154** · F-152 |
| **«no se generó ningún documento y no hay error»** | F-152 |
| **«dice que no tiene cupo pero el error es una clave que falta»** | F-153 |
| **«el canal SmartPay no se puede probar entero fuera de producción»** | F-155 |
| **«el equipo está en mora y no se bloqueó»** | F-156 |
| **«se desembolsó sin garantía / sin IMEI»** | **F-157** |
| **«dicté el buró para cumplir la regla y la entidad sigue sin salir»** | **F-158** |
| **«el perfilamiento no excluye nada» / «las reglas de datacrédito no aplican»** | F-159 |
| **«no cumple la regla X y por eso no sale»** (probado en local) | **F-160** |
| **«la regla de esta entidad está mal configurada»** | **F-162** |
| **«Undefined array key "deceval_username"»** (o cualquier `deceval_*`) | **F-163** |
| **«el mock contesta pero el backend dice que no hubo respuesta»** | **F-164** |
| **«el pagaré se firmó y el log dice que no fue exitoso»** | **F-164** |
| **«Credifamilia queda trabada en estado 28»** | **F-165** · F-163 · F-164 |
| **«resuelvo un proveedor y aparece otro muro distinto»** | **F-165** |
| **«There is no active transaction» al autorizar** | **F-166** |
| **«falló el S3 después de firmar»** (`s3_put_failed_after_sign`) | **F-166** |
| **«en serie pasa y en paralelo no»** | **F-166** |
| **«el crédito quedó con un plazo que no ofrecemos»** | **F-167** |
| **«se valida un campo y se usa otro»** | **F-167** |
| **«llegó a estado 11 pero el lender no lo tiene»** | **F-168** |
| **«el runner dice que cerró y el crédito no se radicó»** | **F-168** |
| **«Attempt to read property "fga" on null»** | **F-169** |
| **«el rotativo falla generando documentos»** | **F-169** |
| **«¿cómo avisa una entidad rt=1 el resultado?»** | **F-170** |
| **«el webhook devuelve Unauthorized con el token correcto»** | **F-170** |
| **«no puedo cerrar un rt=1 en pruebas»** | **F-170** |
| **«el código de compra se reutilizó y no se bloqueó»** | **F-171** |
| **«Undefined variable $transaction»** | **F-171** |
| **«el webhook de rt=0 da 404 y el pedido existe»** | **F-171** |
| **«Attempt to assign property "already_used_loan" on null»** | **F-172** |
| **«firmó todo y el último paso dio 500»** | **F-172** · F-166 |
| **«esta entidad rt=2 nunca cierra y las otras sí»** | **F-172** |
| **«probé Bancolombia y no cerró»** | **F-173** |
| **«la entidad lista en local y no existe en prod»** | **F-173** |
| **«el documento figura firmado y la URL da 404»** | **F-174** |
| **«no puedo abrir el PDF que produjo una corrida»** | **F-174** |
| **«instrumenté el servicio y no imprime nada»** | **F-161** |
| **«esta entidad no sale del listado y ninguna regla lo explica»** | **F-161** · F-113 |
| **«en el wizard sí aparece pero por API no»** (o al revés) | **F-161** |
| **«esta entidad nunca aparece en pruebas»** | F-158 · F-140 |
| **«hay muchísimas filas de un estado y no cuadra con los equipos»** | F-156 |
| **«salta el AML / no salta el AML y debería»** | F-155 |
| **«lo arreglé y por el otro camino sigue distinto» / «ese flujo ya no se usa»** | F-146 |

Un `F-xx` puede estar en varias filas a propósito: se entra por el síntoma, y el mismo hallazgo se ve
distinto según con qué pregunta llegues.

---

## Índice · los F-xx de una línea

| F | qué | estado |
|---|---|---|
| F-01 | El loader SSR esconde los 5xx del backend | TRAMPA |
| F-02 | "Firmar" rebota a los documentos sin ningún mensaje | TRAMPA |
| F-03 | Un `.catch(() => {})` convirtió una corrida rota en "1 passed" | cerrado |
| F-04 | `/lenders` da 500 en todo local (H2O sin host) | TRAMPA |
| F-05 | Elegir Bancolombia falla — y no era Bancolombia | TRAMPA |
| F-06 | `localhost` desde el backend NO es tu máquina | TRAMPA |
| F-07 | La pre-aprobación y el cupo de las tarjetas son inventados | TRAMPA |
| F-08 | Qué es REAL en un cierre CreditopX local | TRAMPA |
| F-09 | Con `standBy` NO hay pago por pasarela, y está bien | TRAMPA |
| F-10 | Captura de identidad (ADO) | TRAMPA |
| F-11 | Los PDFs del cierre no cargan | TRAMPA |
| F-12 | El OTP de la firma sale por Twilio | TRAMPA |
| F-13 | Wompi (cuota inicial) | cerrado |
| F-14 | El harness arrastraba al usuario de vuelta al listado | cerrado |
| F-15 | La ventana B era una caja negra | cerrado |
| F-16 | Un selector CSS pisaba el handler de otro botón | cerrado |
| F-17 | La CSP de la página de login rompe tus pruebas de fetch | TRAMPA |
| F-18 | `E2E_TARGET` default es `dev`, no `local` | TRAMPA |
| F-19 | La tabla de credenciales es POLIMÓRFICA | TRAMPA |
| F-20 | El `laravel.log` local está tapado de ruido | TRAMPA |
| F-21 | La originación distintiva de SmartPay no se dispara fuera de prod — **superado por F-155** | VIEJO |
| F-22 | CeluRD es el comercio del canal, y es RD (no Colombia) | TRAMPA |
| F-23 | El escaneo de IMEI no funciona en local (MDM con host falso) | TRAMPA |
| F-24 | `requires_imei` nunca se guarda (mass assignment silencioso) | TRAMPA |
| F-25 | La mayoría de las entidades NO llama a nadie — no necesitan mock | TRAMPA |
| F-26 | Dos fallos que NO se arreglan mockeando | TRAMPA |
| F-27 | `new URL('//ruta', base)` no es la ruta que creés | TRAMPA |
| F-28 | Matriz de conductas por comercio × entidad (relevada, no supuesta) | TRAMPA |
| F-29 | Receta del cierre rt=2 100% por API (sin navegador) | TRAMPA |
| F-30 | DENTIX no cierra en local: su pagaré es Deceval (SOAP) | stale |
| F-31 | Credifamilia rt=4: la cadena real de bloqueos (no era el SOAP) | → credifamilia |
| F-32 | La regla de `promissory_type` tiene una excepción: el path IMEI difiere el desembolso | → harness |
| F-33 | zsh no hace word-splitting (trampa al verificar) | TRAMPA |
| F-34 | La conducta la decide la CREDENCIAL del par (comercio, entidad) — no la entidad | → creditop |
| F-35 | Matriz completa: 24 comercios barridos | TRAMPA |
| F-36 | El muro de Deceval NO es el host: son credenciales criptográficas (y por eso NO se mockea) | → harness |
| F-37 | Netco solo lo usa Credifamilia — DENTIX no lo necesita | → credifamilia |
| F-38 | Rotativo (rt=3) SÍ existe y se distingue — pero no cierra por config del comercio | cerrado |
| F-39 | Servicing (cobranza por hardware): VERIFICADO end-to-end en local | TRAMPA |
| F-40 | Ecommerce: NO es ejercitable — la ruta de checkout ya no existe en el wizard | stale |
| F-41 | "Formulario no encontrado" = el flujo DINÁMICO sin su schema | → form-service |
| F-42 | Varios "servicios externos" existen como repo local | stale |
| F-43 | El formulario dinámico carga pero no deja avanzar: dos causas distintas | TRAMPA |
| F-44 | El flujo dinámico usa OTRA taxonomía de documentos (no CC/CE/PEP) | TRAMPA |
| F-45 | Flujo dinámico completo: los 5 pasos y qué exige cada uno | TRAMPA |
| F-46 | Elegir lender BORRA el asesor de la solicitud (y eso rompe Ábaco) | TRAMPA |
| F-47 | Ábaco: la mitad ya estaba mockeada en el código | TRAMPA |
| F-48 | Renting en v2: el discriminador es `product`, y estaba roto | stale |
| F-49 | Dónde vive el paso de Ábaco en el front (y por qué el harness se lo comía) | TRAMPA |
| F-50 | Renting cancelada después de Ábaco: una fila faltante que el front convierte en cancelación | TRAMPA |
| F-51 | El formulario de referencias del Figma: el mecanismo existe, la posición y los campos no | cerrado |
| F-52 | El scrub del harness borra la corrida anterior y deja el historial huérfano | TRAMPA |
| F-53 | La guarda de "estás tocando dev compartido" viene desarmada de fábrica | stale |
| F-54 | La entrada por ecommerce existe y funciona — pero hoy solo resuelve Bancolombia | TRAMPA |
| F-55 | El ruteo de validación de identidad tiene tres agujeros que CANCELAN el crédito | TRAMPA |
| F-56 | Cuatro de las cinco salidas de `/lenders` dan 404 fuera de `/merchant` | stale |
| F-57 | Rescate antes de borrar `backend-e2e` y `backend-mcp` | stale |
| F-58 | Un rechazo de la firma de flujo llega como HTTP 200 y el front lo toma como éxito | → kyc |
| F-59 | `bin/asesor` moría mudo en el paso `frontend` porque un `grep` sin match mata al script | stale |
| F-60 | Sonría no sirve para probar la omisión de Experian: el throttle corta antes que el flujo | cerrado |
| F-61 | Staging falla el login del asesor porque es OTRO pool de Cognito sobre la MISMA base | TRAMPA |
| F-62 | En dev/staging está desplegada solo LA MITAD de la omisión de Experian: aparece el selector, per… | cerrado |
| F-63 | `RKV24027` (dato vigente) corta ANTES que la omisión por flujo — y se lee como si la omisión fal… | TRAMPA |
| F-64 | El "Recorrido del wizard" cambiaba de forma según el ambiente — y contra dev salía vacío por un … | cerrado |
| F-65 | El sembrado headless registraba al cliente en el backend LOCAL aunque el target fuera dev | cerrado |
| F-66 | El salto headless a `/lenders` "rebotaba" en staging — no era el front ni el estado, era una car… | cerrado |
| F-67 | El salto a `/lenders` se colgaba 90s en staging — no era la inserción del sintético, era `domcon… | cerrado |
| F-68 | El guiado AUTO de Motai renting/rto nunca pasaba por Ábaco — lo salteaba el driver del harness, … | cerrado |
| F-69 | "Advisor validation error" en el `/continue` del asesor para lenders None-identity + Ábaco — un … | cerrado |
| F-70 | La pantalla del asesor (`financial-profile`) muere con `fetch failed` en local — falta el MS fin… | cerrado |
| F-71 | En CreditOp conviven DOS convenciones de tasa — nominal (el canon) y efectiva (Credifamilia) — y… | → creditopx |
| F-72 | Tres divergencias entre la calculadora de negocio y el código: el IVA cableado, el 4×1000 que no… | TRAMPA |
| F-73 | El backend de `qa` es OTRO servicio del mismo cluster — probar contra `dev` mide la rama equivoc… | TRAMPA |
| F-74 | El sweep resolvía el backend por su cuenta: contra `dev` registraba en LOCAL y dejaba la solicit… | cerrado |
| F-75 | El marketplace sale VACÍO si el lender que ofrece la sucursal no tiene `group_rules` propias | → motai |
| F-76 | El backfill de una migración NO cubre las filas futuras: Motai perdió el PEP en dev/qa sin que n… | cerrado |
| F-77 | Mergear a `qa` NO aplica migraciones: el deploy solo actualiza el servicio ECS | TRAMPA |
| F-78 | El badge del marketplace lo decide PREAPROBADOS, que le pregunta a OTRO backend — un fix de cupo… | → ms-preapprovals |
| F-79 | El canal del código de compra está APAGADO desde enero de 2026 — si no ves códigos, no es tu bug | TRAMPA |
| F-80 | `bnpl_transaction_id` "ausente en el 100 %" es un artefacto de medir sobre el histórico — hoy SÍ… | → bancolombia |
| F-81 | El sandbox del *In Store Billing Code* responde 409 a cualquier dato real, y no ejercita la segu… | → bancolombia |
| F-82 | El guard del código de compra está escrito en NEGATIVO y se lee al revés | → bancolombia |
| F-83 | El límite de 20 caracteres del `address` de Bancolombia no lo cumple ninguna de las dos fuentes | TRAMPA |
| F-84 | El `Message-Id` fijo de no-producción SÍ es un UUID v4 válido (y el que no lo es está comentado) | → bancolombia |
| F-85 | Por el canal ASESOR un comercio Corbeta no cierra ahí: entrega el crédito al celular del cliente | → bancolombia |
| F-86 | El regreso de una pantalla externa no se puede deducir del `document.referrer`: cross-origin el … | TRAMPA |
| F-87 | `bin/mock-* start` reusaba el proceso viejo: editabas el mock y seguía sirviendo la versión ante… | cerrado |
| F-88 | El front valida cada respuesta del banco con zod, y el runner por consola no lo veía: dos verdes… | → bancolombia |
| F-89 | El regreso del banco tiene UNA sola URL y es un despachador: `/bancolombia/{tipo}/redirect` | TRAMPA |
| F-90 | Las perillas de falla del mock eran GLOBALES: cualquier error terminaba en `no-preapproved`, no … | → bancolombia |
| F-91 | Un error de NEGOCIO del banco cancela la solicitud y le dice al cliente «intenta de nuevo» — y `… | → bancolombia |
| F-92 | Un 401 del gateway de Bancolombia no trae `errors` → revienta DENTRO del manejador de errores | TRAMPA |
| F-93 | `displayed_lenders` no es una tabla: es una columna JSON de `profiling_reviews` | → profiling |
| F-94 | El webhook `lender-result` no deja huella de recepción: «no llegó» y «llegó y falló» se ven igual | → aggregator |
| F-95 | El `response_type` de un lender cambia según el ambiente: verificarlo contra local miente | → entities |
| F-96 | `user_request_records` repite estados y no es cronológico: «la última fila» puede ser anterior a… | TRAMPA |
| F-97 | La BD guarda el documento FINAL, los logs guardan todos los intentos: buscar por cédula puede no… | → kyc |
| F-98 | Sin `GRAFANA_TEMPO_ENDPOINT` los logs no llevan `trace_id` — y el span lo abre un middleware con… | TRAMPA |
| F-99 | `LOG_CHANNEL=stack` en local puede romper el request: el canal incluye `dynamodb` con `ignore_ex… | TRAMPA |
| F-100 | `profiling_reviews.disbursed_lender` tiene TRES escritores: verlo lleno no prueba que llegó un w… | → formalization |
| F-101 | `risk_centrals` mezcla dos momentos del flujo: leerla como «la lista de burós» pone ADO en la et… | → kyc |
| F-102 | Sólo el 13 % de las líneas de log dice a qué solicitud pertenece, y lo dice con tres nombres dis… | → architecture |
| F-103 | Una solicitud TRABADA no está «rota» en la BD: sigue en curso, y el estado 10 no significa que e… | → creditop |
| F-104 | El perfilador ML nuevo NUNCA corre en producción (falta la env), y el viejo lleva caído desde el… | → profiling |
| F-105 | `user_request_records` NO registra todas las transiciones: los estados 1 y 10 nunca dejan fila | → creditop |
| F-106 | La fila de estado 9 en `user_request_records` se escribe al CREAR la solicitud: no prueba que el… | → creditop |
| F-107 | El vínculo buró↔solicitud NO es un hecho: lo calcula un stored procedure POR FECHA, y sólo cuand… | → db-routines |
| F-108 | Hay 14 tablas de LOG en la BD que ninguna herramienta lee — pero sólo 2 sirven para atar a una s… | → db-routines |
| F-109 | El «solo lectura» del `-sql` del trazador dependía del motor, no de su guarda: `INTO OUTFILE` pa… | → trazador |
| F-110 | El rotativo (rt=3) NO usa categorías: calcula un PLAZO MÍNIMO y por eso «desaparecen» las cuotas… | TRAMPA |
| F-111 | El webhook de Prami ata SÓLO por `order_id` y con `firstOrFail()`: si no matchea, la solicitud s… | TRAMPA |
| F-112 | La compuerta de capacidad de endeudamiento NO mira los gastos que declara el cliente, y viene AP… | → profiling |
| F-113 | Credifamilia devuelve «APROBADO» con datos VACÍOS cuando la entrada es inválida, y nuestro códig… | → credifamilia |
| F-114 | El cupo rotativo se calcula DOS veces con motores distintos: el que se muestra no es el que se o… | → db-routines |
| F-115 | Un rechazo de cupo rotativo no deja NINGÚN rastro: ni log, ni fila, ni estado | → rotativo |
| F-116 | `ctop_debt` descarta las cuotas de los créditos CreditopX por precedencia de `??` en PHP | → rotativo |
| F-117 | Sin fuente de continuidad laboral, el rotativo castiga con 0 puntos — peor que el peor cliente | → rotativo |
| F-118 | `category_rules_acceptance`: una clave AUSENTE no es un criterio que pasó, y la misma regla tien… | → profiling |
| F-119 | `loan_limit` es un cupo «mensual» que nunca se reinicia: la categoría desaparece sola y sin aviso | → profiling |
| F-120 | Un documento CE en el lender 84 SALTA todo el motor de reglas y recibe una categoría fija | → hardcodes-entidades |
| F-121 | El pagaré es un PDF congelado y el cliente es una referencia viva: pueden decir personas distint… | → deceval |
| F-122 | El mismo guard de Deceval usa `||` en un repo y `&&` en el otro: en `legacy-application` NUNCA d… | → deceval |
| F-123 | El árbol describía 5 repos mientras producción corría 14 servicios | → microservicios |
| F-124 | El teléfono con prefijo NO estaba corrupto: E.164 es lo correcto. La hipótesis de «acumula prefi… | cerrado |
| F-125 | «¿Este comercio es Corbeta?» tiene CUATRO respuestas distintas — no cites una lista única | TRAMPA |
| F-126 | Reversar un pago RETENIDO revienta: el código busca «PAGO REVERSADO» y la fila se llama «REVERSADO» | TRAMPA |
| F-127 | La calculadora «por comercio» escribe dos tablas GLOBALES del lender: se pisan entre comercios y a rt≠2 se las borra | TRAMPA |
| F-128 | «Lo que recibe el comercio» se calcula con dos bases distintas según la pantalla (38 % difieren) | TRAMPA |
| F-129 | La única comisión que el código calcula es una tabla de 40 tramos hardcodeada en un export, y da 0 fuera de rango | TRAMPA |
| F-130 | `countries.iso_code_2` guarda el código de TRES letras y `iso_code_3` está vacío | TRAMPA |
| F-131 | La fila `countries.id=1` es «Afghanistan» y es el DEFAULT: 155 entidades y 215.844 usuarios apuntan ahí | TRAMPA |
| F-132 | Un «no coincide» en el SEGUNDO nombre/apellido se descartaba como campo no enviado (`0 == null`) | TRAMPA |
| F-133 | Con un solo apellido, el pagaré de Deceval lo registra dos veces (`Str::after` sin separador) | TRAMPA |
| F-134 | Una línea ausente en Loki no prueba que el código no corrió: sólo `TracerService` fija el canal | TRAMPA |
| F-135 | El OTP real de staging no se puede validar: el SMS sale, el código no vuelve de la caché y no queda fila | TRAMPA |
| F-136 | En un lender con path IMEI que no sea el 160, el voucher no lo genera nadie: se difiere a una rama que exige ese id | TRAMPA |
| F-137 | El comando que siembra las credenciales del SOAP de Credifamilia escribe tres claves que el Action no lee nunca | TRAMPA |
| F-138 | `update-user-request` no valida `lender_id`: entidad ajena → null, regla inventada → 500 | TRAMPA |
| F-139 | En local hay TRES simuladores de centrales apilados y gana el de más arriba | TRAMPA |
| F-140 | Una entidad rt=1 sin su integración mockeada DESAPARECE del listado en silencio | TRAMPA |
| F-141 | La pre-aprobación de rt≠0 la dispara el FRONT: por API no se ejercita | TRAMPA |
| F-142 | Una entidad con host nulo tira el listado ENTERO del comercio | TRAMPA |
| F-143 | Una entidad cableada a la sucursal pero no al comercio tira el listado entero | TRAMPA |
| F-144 | El `status` de TusDatos tiene que ser `success` o el rechazo se lee como inconcluyente | TRAMPA |
| F-145 | Con CC, TusDatos no compara el nombre: el veto sale del `match_code` | TRAMPA |
| F-146 | El límite de intentos está INVERTIDO entre los dos monolitos, y el viejo no veta | ABIERTO |
| F-147 | Una categoría sin tope de cuotas = «tope cero»: al mejor cliente no se le cambia el plazo | ABIERTO |
| F-148 | El menú de fechas de un crédito vencido ofrece sólo fechas que el guardado rechaza | develop |
| F-149 | El lambda de mocks dejó de honrar lo dictado: acepta el POST y sirve datos aleatorios | TRAMPA |
| F-150 | El builder de documentos del Rent to Own se elige por id quemado, no por slug | ABIERTO |
| F-151 | `OTP_SERVICE_HOST` no está en ningún `.env.example`: la firma del codeudor cae con un 500 | ABIERTO |
| F-152 | El Rent to Own no tiene documentos sin codeudor: firma el contrato equivocado, o ninguno | ABIERTO |
| F-153 | Una regla con tarjetas revienta leyendo el buró; el mismo archivo sí se protege en otros 3 puntos | ABIERTO |
| F-154 | El rastro del documento firmado apunta a la fila equivocada: la busca de nuevo, sin la rama | ABIERTO |
| F-155 | Quién es SmartPay se decide en 4 lugares y fuera de prod no coinciden (supera a F-21) | ABIERTO |
| F-156 | Un lock fallido se reintenta sin tope y escribe una fila por intento: 28 equipos sin bloquear | ABIERTO |
| F-157 | `path = IMEI` no es el canal: 4 entidades lo tienen y desembolsan sin inscribir el equipo | ABIERTO |
| F-158 | Escribir el ingreso de Experian pisa la ocupación con «Empleado» quemado | ABIERTO |
| F-159 | El perfilamiento lee `Experian - Acierta` y el flujo sintético escribe `Acierta+Quanto` | ABIERTO |
| F-160 | Las reglas del dump local difieren de producción: se depura contra umbrales inexistentes | VIGENTE |
| F-161 | Hay DOS listados (`lenders` y `lenders-v2`) con clases distintas: v1 devuelve menos | ABIERTO |
| F-162 | Las reglas de grupo clasifican, no excluyen: 1.923 créditos las violan y se otorgaron | VIGENTE |

---

### F-01 · El loader SSR esconde los 5xx del backend

**Síntoma:** `/lenders` muestra "Error al obtener las opciones de financiamiento" y el log del harness no reporta nada; parece que el salto a lenders "no funcionó".
**Causa raíz:** el loader de `/lenders` corre en el **servidor** (SSR de react-router). Un 500 del backend nunca llega al browser como status 5xx — llega como HTML del error boundary. Los listeners de `page.on('response')` no lo ven.
**Evidencia:** el 500 solo aparece pegándole directo al endpoint: `curl .../api/onboarding/loan-application/lenders-v2/<ur>`.
**Arreglo:** `preflightLenders()` en `guided.spec.ts` consulta el endpoint **antes** de navegar e imprime el `message` del backend.
**Estado:** resuelto.

### F-02 · "Firmar" rebota a los documentos sin ningún mensaje

**Síntoma:** en `sign-documents` apretás Firmar y volvés a la misma pantalla, sin error. Repetible infinitas veces.
**Causa raíz:** el action de `sign-documents.tsx` envía el OTP del pagaré y, si falla, cae en un `catch` que solo reporta la excepción y **devuelve `undefined`** → sin `redirectTo` → el componente no navega. El error es invisible por diseño.
**Evidencia:** `laravel.ERROR: Failed to send OTP {"error":"[HTTP 401] Unable to create record: Authenticate"}` (Twilio).
**Arreglo:** ver F-12 (el bypass de OTP).
**Estado:** resuelto — pero **el patrón sigue vivo**: cualquier fallo dentro de ese action se ve como "no pasa nada".

### F-03 · Un `.catch(() => {})` convirtió una corrida rota en "1 passed"
> **Incidente cerrado** (resuelto en el spec). Crónica completa: `cerrados.md`.

### F-04 · `/lenders` da 500 en todo local (H2O sin host)

**Síntoma:** ninguna solicitud puede listar entidades.
**Causa raíz:** falta `H2O_API_HOST` → `config()` da `null` → `->baseUrl(null)` → **TypeError**. No lo atrapa ningún `catch (Exception)` del profiler (`TypeError` extiende `Error`, no `Exception`) ni `profileWithFallback`, que **no tiene try/catch**. El fallback a matrices internas, que existe justamente para esto, nunca corre.
**Evidencia:** `PendingRequest::baseUrl(): Argument #1 ($url) must be of type string, null given` en `ProfilerMLController:96`.
**Arreglo:** `H2O_API_HOST=http://127.0.0.1:9` → falla rápido con `ConnectionException` (que **sí** extiende `Exception`) → cae al fallback. Restaura el comportamiento que antes daba el corto-circuito `return 404`, hoy ausente en `main`.
**Estado:** resuelto en local + `preflightLenders()` sugiere el fix si detecta la firma del error.

### F-05 · Elegir Bancolombia falla — y no era Bancolombia

**Síntoma:** "No pudimos procesar tu solicitud · código `<uReq>-63`".
**Causa raíz:** el lender #8 tiene en BD `action = App\Actions\Lenders\Payvalida` (el proveedor de **recaudo**). Sin `PAYVALIDA_HOST`, el template `{+host}/api/v3/porders` se resuelve **sin host**. La solicitud nunca salía hacia el banco.
**Evidencia:** `cURL error 3: URL rejected: No host part in the URL for /api/v3/porders`.
**Arreglo:** `mock-payvalida` (:8097) + `PAYVALIDA_HOST=http://host.docker.internal:8097`.
**Estado:** resuelto.

### F-06 · `localhost` desde el backend NO es tu máquina

**Síntoma:** el mock está arriba y responde por curl, pero el backend no lo alcanza.
**Causa raíz:** legacy-backend corre en Docker: `localhost` es el contenedor.
**Evidencia:** `docker compose exec laravel.test curl localhost:8097` → **HTTP 000**; `host.docker.internal:8097` → **HTTP 200**.
**Arreglo:** usar `host.docker.internal` en las env que apuntan a mocks del harness.
**Estado:** resuelto. **Ojo:** el truco inverso también aplica — para que algo falle *rápido* a propósito (F-04), `127.0.0.1:<puerto cerrado>` es ideal.

---

### F-73 · El backend de `qa` es OTRO servicio del mismo cluster — probar contra `dev` mide la rama equivocada

**Síntoma:** Ábaco responde `MOTV1000` ("no requiere") contra el ambiente remoto para Motai Renting #158, con la tabla `lender_requirements` correctamente sembrada (`abaco_is_enabled=1`) y el código mergeado en `qa`. Se lee como "el feature está roto" o "falta el deploy".
**Causa raíz verificada — dos servicios distintos, nombre del cluster engañoso.** En el cluster `inertia-develop` conviven **`legacy-backend`** (sirve la rama **`develop`**, workflow `main-dev.yaml`) y **`legacy-backend-qa`** (sirve **`qa`**, `main-qa.yaml` con `on: push: branches: [qa]`). El `.env.staging` del harness apuntaba su API a `legacy-backend.inertia-develop`, o sea **front desplegado de qa + backend de develop**. Y como la **BD sí es compartida** entre ambos, los datos se ven desde los dos y todo *parece* consistente: lo único que cambia es **qué código responde**. `develop` todavía decide Ábaco por los modos deprecados (`$isAbacoRequired = $this->isAbacoRequired($alliedMode->config)`) → sin modo activo (nadie los escribe desde junio) → `false` → `MOTV1000`.
**Evidencia:** mismo request a los dos hosts → `legacy-backend.inertia-develop` sin `allowed_document_types` (no tiene motai-v2), `legacy-backend-qa.inertia-develop` **con** el campo; las rutas del merge de Ábaco dan **404** en el primero y **405** (existe) en el segundo; ningún commit de `qa` es ancestro de `origin/develop` (14 vs 12 commits divergidos). Con el host de qa: `MOTV1001` + cadena completa.
**Arreglo:** `.env.staging` → `E2E_API_BASE_URL=http://legacy-backend-qa.inertia-develop/api` (la BD queda igual: es compartida a propósito). Documentado en `.env.staging.example`, en el `CLAUDE.md` de playground (decía "staging comparte BD/API con dev" — comparte BD, **no** API) y en la tabla de targets del `CLAUDE.md` de `harness`.
**Estado: resuelto y verificado.** Truco para saber qué rama tenés enfrente sin adivinar: `GET /api/loans/allied/{hash}` trae `allowed_document_types` **solo** con motai-v2, o sea solo en `qa`. **Lección:** cuando un feature "no funciona" en un ambiente remoto, lo primero es probar que ese host sirve la rama que creés — un dato en la BD compartida no dice nada del código desplegado.

---

### F-76 · El backfill de una migración NO cubre las filas futuras: Motai perdió el PEP en dev/qa sin que nadie tocara nada
> **Incidente cerrado** (desbloqueado (la causa de fondo quedó anotada en el cuerpo frío)). Crónica completa: `cerrados.md`.

### F-77 · Mergear a `qa` NO aplica migraciones: el deploy solo actualiza el servicio ECS

**Síntoma:** el PR está mergeado en `qa`, el deploy salió verde, el código nuevo responde… y el comportamiento que **depende de una migración** sigue como antes. Se lee como "la migración falló" o "el backfill no hizo nada".

**Causa raíz verificada — el workflow de deploy no corre `artisan migrate`.** `.github/workflows/main-qa.yaml` (y su gemelo de dev) solo delega en `Creditop-SAS/config-ci/.github/workflows/deploy-ecs-service.yaml`: construye la imagen y actualiza el servicio. Las migraciones viven en un workflow **aparte y manual**, `.github/workflows/run-migrations.yml`, que es `workflow_dispatch` y **pide a mano** imagen + host + usuario + base + password. Nadie lo dispara solo.

**Evidencia:** en la BD compartida dev/qa, la tabla `migrations` tiene las tres de `lender_requirements` (batches 188, 190, 191) pero **ninguna** de las dos que mergeé en el PR #1028 (`2026_07_28_100000_backfill_abaco_is_enabled_from_lender_product`, `2026_07_28_110000_drop_allied_modes_and_user_request_modes_tables`). Consecuencia concreta: `allied_modes` y `user_request_modes` **siguen existiendo** en dev/qa, y el backfill nunca corrió — que Ábaco siguiera pidiéndose fue **suerte**: la fila de `lender_requirements` del 158 ya existía desde el 2026-07-14 (la puso el trabajo de Fercho), no el backfill.

**Ojo con el workflow manual.** Leyendo `run-migrations.yml` tiene dos problemas de forma (no lo ejecuté, es lectura): usa `inputs.aws_key_id`, `inputs.aws_secret_access_key`, `inputs.aws_region` y `inputs.aws_bucket`, que **no están declarados** en `on.workflow_dispatch.inputs`; y al `docker run` le faltan las barras de continuación después de `--env AWS_ACCESS_KEY_ID=…`, así que el comando se corta antes de `php artisan migrate`. Tal como está, es probable que ni corra.

**Arreglo / procedimiento:** después de mergear algo con migraciones a `dev`/`qa`, **disparar `run-migrations` a mano** (o pedirlo a quien tenga los secretos) y **verificar en la tabla `migrations`** que la fila apareció. No dar por aplicada una migración porque el deploy salió verde. Emparejar con [F-73] (el backend de `qa` es otro servicio) y [F-76] (un backfill no cubre filas futuras): las tres son formas distintas de creer que un cambio está en un ambiente cuando no está.

---

### F-07 · La pre-aprobación y el cupo de las tarjetas son inventados

**Síntoma:** una tarjeta dice "Pre aprobado · Cupo disponible $25.000.000 · 1,88% M.V".
**Causa raíz:** sale de `mock-preapprovals` (`MOCK_PA_CUPO=25000000`, `MOCK_PA_RATE=0.0188`), no de la lógica real.
**Evidencia:** el crédito quedó con **tasa 1,82**, no 1,88 → los términos finales sí los calcula el backend; la *decisión* de mostrarlo pre-aprobado, no.
**Arreglo:** `E2E_REAL_PREAPPROVALS=1` apunta al MS real (más lento, necesita VPN).
**Estado:** por diseño. **Implicancia:** el harness sirve para probar **el cierre**, no **la decisión de qué se ofrece**.

### F-08 · Qué es REAL en un cierre CreditopX local

Auditado contra la BD tras cerrar un crédito completo:

| Real | Simulado / ausente |
|---|---|
| Máquina de estados (llega a **Estado 11 "Autorizada"** con `request_number`) | Pre-aprobación y cupo de las tarjetas (F-07) |
| Términos calculados por el backend (tasa 1,82 · 12 cuotas · final 1,6M · inicial 800k) | Siembra del `user_request` (INSERT directo: saltea monto/teléfono/OTP/datos) |
| Registro `creditop_x_user_requests_records` | Link por WhatsApp (messaging service :8082 caído) |
| Filas de `otps` (el bypass persiste el registro igual que uno real) | AML TusDatos (driver fake, `job-fake-12345`) |
| Generación de documentos en el backend (14KB/10KB/435KB) | `user_request_documentations` y `netco_signing_documents` quedan **vacías** (sin S3) |

**Además:** el **voucher de desembolso falla** post-Estado-11 (`Voucher generation failed: Trying to access array offset on null`) — sin diagnosticar.

### F-09 · Con `standBy` NO hay pago por pasarela, y está bien

**Síntoma:** el crédito llega a Estado 11 sin ninguna fila en `payment_gateway_transactions`, pese a tener `initial_fee = 800.000`.
**Causa raíz:** es correcto. Con `standBy` el flujo NO pasa por `initial-fee-payment` (el guard `&& !response.data.standBy`); la cuota inicial no se cobra por pasarela en la rama in-platform.
**Estado:** no es un bug. Anotado porque **parece uno**.

---

### F-10 · Captura de identidad (ADO)

Foto del documento contra un proveedor externo: imposible con usuario sintético. Es **client-side**, así que no deja rastro en el backend — una corrida se trabó 20 minutos en silencio absoluto. Se saltea navegando directo a `first-payment-date`.

### F-11 · Los PDFs del cierre no cargan

`sign-documents` previsualiza consentimiento/pagaré/garantía desde `local-mock.s3.amazonaws.com`, host que **no existe** en local → "Error al cargar el documento" ×3 → no se puede firmar. Resuelto con `pkg/pdf-mock.ts` (PDF mínimo válido + CORS; solo intercepta buckets falsos, así que contra dev no toca nada).

### F-12 · El OTP de la firma sale por Twilio

401 en local. El backend **ya tiene** bypass de QA: si el teléfono está en el setting `qa_otp_bypass_phones` y `APP_ENV` es local/development, no manda SMS y el código son los **últimos 6 dígitos del celular**. El teléfono del harness (`3131010101`) no estaba en la lista. Agregado.

> **Ojo con la pista falsa:** buscar una *tabla* `qa_otp_bypass_phones` da "no existe" y lleva a concluir que el bypass no está implementado. Es una **fila de `settings`** (migración `add_qa_otp_bypass_phones_to_settings_table`).

### F-13 · Wompi (cuota inicial)
> **Incidente cerrado** (aplicado). Crónica completa: `cerrados.md`.

### F-14 · El harness arrastraba al usuario de vuelta al listado
> **Incidente cerrado** (resuelto). Crónica completa: `cerrados.md`.

### F-15 · La ventana B era una caja negra
> **Incidente cerrado** (resuelto). Crónica completa: `cerrados.md`.

### F-16 · Un selector CSS pisaba el handler de otro botón
> **Incidente cerrado** (resuelto). Crónica completa: `cerrados.md`.

### F-74 · El sweep resolvía el backend por su cuenta: contra `dev` registraba en LOCAL y dejaba la solicitud huérfana
> **Incidente cerrado** (resuelto). Crónica completa: `cerrados.md`.

### F-17 · La CSP de la página de login rompe tus pruebas de fetch

Un `fetch` cross-origin de prueba fallaba con "Failed to fetch" y parecía que el mock no servía. Era que el wizard había redirigido a `login.creditop.com`, cuya CSP bloquea fetches externos. **Verificá desde un origin sin CSP.**

### F-18 · `E2E_TARGET` default es `dev`, no `local`

Un script de diagnóstico consultaba **dev** sin avisar, y los datos no cuadraban (fechas de otro día, filas inexistentes). Exportá `E2E_TARGET=local` explícito en cualquier consulta suelta.

### F-19 · La tabla de credenciales es POLIMÓRFICA

`lender_allied_credentials` no tiene `allied_branch_id`: usa `allied_type` + `allied_id`, y la credencial puede colgar del **comercio** o de la **sucursal**. Buscar solo por sucursal da un falso "no tiene" (Motai la tiene a nivel comercio, id 554).

### F-20 · El `laravel.log` local está tapado de ruido

Llegó a **1,2 GB** de `Driver [loki] is not supported`: `GRAFANA_LOKI_ENABLED=false` no registra el driver, pero el canal `stack` de `config/logging.php` lo sigue listando. Los errores reales **sí** llegan, pero enterrados: buscar en una ventana chica del final da "no hay nada". Truncar con `: > laravel.log` (no `rm`: php-fpm lo tiene abierto y no liberarías el espacio). `LOG_CHANNEL=daily` acotaría el crecimiento.

---

### F-21 · La originación distintiva de SmartPay NO puede dispararse fuera de producción

> ⚠ **SUPERADO POR [F-155] — este cuerpo describe el estado ANTERIOR al 2026-08-19.** El hardcode se
> corrigió (hoy es `production ? 160 : 152`), así que **fuera de producción `isSmartPay()` ya NO es
> siempre falso**. Pero el arreglo replicó el condicional con un número distinto al de la config, y la
> inconsistencia cambió de forma en vez de desaparecer. Lo que corre hoy está en **F-155**; lo de abajo
> se conserva porque explica de dónde viene.

**Síntoma:** se prueba el canal SmartPay en local (o dev) y el flujo se comporta como un CreditopX rt=2 común: no salta el AML, no aparece el "Acuerdo de bloqueo de dispositivo", no hay desembolso diferido.

**Causa raíz — una inconsistencia dentro del propio código:**

```php
// app/Models/UserRequest.php:189
public function isSmartPay(): bool
{
    return $this->isImeiPath() && (int) $this->lender?->id === 160; // hardcode
}
```

```php
// config/lenders.php:24  — el MISMO canal, resuelto por entorno
'smartpay_lender_id' => env('APP_ENV') === 'production' ? 160 : 153,
```

El branding del mailer (`Lender::isSmartpayChannel()`) usa el **config consciente del entorno**; la originación usa un **160 hardcodeado**. Como fuera de producción el lender de SmartPay es el 153, `isSmartPay()` es **siempre false** en local y en dev.

**Qué queda gateado detrás de ese hardcode** (o sea: NO testeable fuera de prod):
- `TusDatosService:442` → el **skip del AML** de fondo
- `DeviceLockAgreementService:51` → el **acuerdo de bloqueo de dispositivo** (el contrato distintivo, en vez de pagaré + garantía + Netco)
- `ContinueUserFlowController:91` → su rama del flujo de continuación

**Qué SÍ funciona igual** (porque cuelga de `isImeiPath()` o del path del lender, no del id):
- `AddOriginationFlowType:54` emite `metadata.lender_path = lender->path->name` → **el wizard corre la rama IMEI** (selección de equipo y escaneo de IMEI)
- `AdoController:256` → credenciales de ADO por-lender
- Los crons de servicing device-lock (leen lenders con path IMEI)

**Evidencia:** en el dump local existen el **152** (`smartpay`, rt=2, path IMEI) y el **153** (`SmartPay`, rt=1, path IMEI); **no existe el 160**. Con el 152 el listado y la rama IMEI del front funcionan, pero los tres puntos de arriba no.

**Arreglo:** ninguno aplicado — es una decisión de producto, no del harness. Dos caminos: (a) clonar un lender con `id=160` en la BD local (patrón de `close-lender.ts`) para destrabar el flujo completo sin tocar código; (b) que `isSmartPay()` consuma `config('lenders.smartpay_lender_id')` como su hermano `isSmartpayChannel()` — **probablemente el bug real**, porque hoy la feature no es ejercitable en ningún entorno de prueba.

**Estado:** abierto · **vale reportarlo al equipo.**

### F-22 · CeluRD es el comercio del canal, y es RD (no Colombia)

**Síntoma:** al probar SmartPay los montos salen en `RD$` y el formato cambia.
**Causa raíz:** no es un bug: el canal es dominicano. `CeluRD Test` (allied **270**, sucursal `1bfb8cd0`) tiene `country_id = 60` (RD), y el seeder y el contrato por defecto del canal también son RD (locale `es_DO`, moneda `DOP`).
**Evidencia:** el listado renderiza `RD$ 2,000,000` y la sucursal aparece como "Celu Rd Santo Domingo".
**Estado:** informativo. Ojo al comparar cifras con los comercios colombianos — **no son la misma moneda**.

### F-23 · El escaneo de IMEI no funciona en local (MDM con host falso)

**Síntoma:** el flujo SmartPay llega hasta el handoff del asesor y el escaneo del IMEI no completa.
**Causa raíz:** `AlliedProductService::enroll` hace **dos** llamadas al merchant-gateway (Trustonic), ambas con header `X-Lb-Tenant-Id` = `allieds.trustonic_tenant_key`:
1. `POST /device-locking/devices/enroll` `{ imei }`
2. `GET /device-locking/devices/status?deviceIds=<imei>` → `{ devices: [ { marketName, model, manufacturer } ] }`

Con la respuesta de (2) **crea el Product y asocia el IMEI** al `user_request`. Si `devices` viene vacío, corta con "No se encontró el IMEI". En local `MERCHANT_GATEWAYS_HOST=https://merchant-gateways.fake` → no resuelve. Además `CeluRD.trustonic_tenant_key` estaba en **null**.
**Arreglo:** `mock-mdm` (:8098, implementa enroll/status + lock/unlock/release para los crons de servicing) + `MERCHANT_GATEWAYS_HOST=http://host.docker.internal:8098` + tenant key sembrada.
**Evidencia:** `POST device/register {imei:'356938035643809', user_request_id}` → `"Dispositivo registrado correctamente"`, con fila en `user_request_products` (imei asociado) y el producto creado desde la respuesta del MDM.
**Estado:** resuelto.

> **Dato práctico:** el IMEI se valida con `size:15` (exactamente 15 caracteres) en `AssociateImeiRequest`. El equipo NO se elige de un catálogo previo: **lo determina el MDM** a partir del IMEI escaneado.

### F-24 · `requires_imei` nunca se guarda (mass assignment silencioso)

**Síntoma:** ningún producto de la base tiene `requires_imei = 1`, ni siquiera los que crea el enrolamiento de IMEI.
**Causa raíz:** `AlliedProductService::enroll` hace `Product::firstOrCreate([...], ['requires_imei' => 1, ...])`, pero **`requires_imei` no está en `Product::$fillable`** → Eloquent lo descarta sin avisar. El producto se crea con el default de la columna (0).
**Evidencia:** producto #194 creado por un enrolamiento real quedó con `requires_imei = 0`; `SELECT COUNT(*) FROM products WHERE requires_imei = 1` → **0** en toda la base.
**Impacto:** hoy **latente** — el único uso de `requires_imei` en `app/` y `Modules/` es esa escritura, nadie lo lee. Pero la intención del código está rota y cualquier consumidor futuro leería datos incorrectos.
**Arreglo:** agregar `requires_imei` al `$fillable` (una línea). No aplicado — es código de producto.
**Estado:** abierto · vale reportarlo junto con F-21.

---

### F-25 · La mayoría de las entidades NO llama a nadie — no necesitan mock

**Síntoma:** se asume que ninguna entidad se puede probar en local porque los hosts del `.env` son `*.fake`.
**Causa raíz:** falso. Probando entidad por entidad contra el backend real, la mayoría **no hace ninguna llamada saliente** al seleccionarla: devuelve un modal con la URL del portal del proveedor, que sale de config, no de una API.

| Entidad | Al seleccionar | ¿Mock? |
|---|---|---|
| Sufi #7 (rt0) | modal "Continua el proceso con el asesor comercial" | **no** |
| Su+pay #11 (rt1) | modal | **no** |
| Meddipay #39 (rt1) | modal | **no** |
| Addi #6 (rt0) | modal "Se ha enviado un mensaje de WhatsApp con un link" | **no** |
| Sistecrédito #9 (rt1) | `GET /getCreditToken` | **sí** |
| Bancolombia #8 (rt1) | Payvalida `POST /api/v3/porders` | **sí** (F-05) |

**Implicancia:** toda la rama **agregador / self-management** —la del modal "seguí en tu celular"— ya era testeable en local sin construir nada. La `action` del lender en BD dice quién integra: `(sin action)` = no llama.

**Estado:** relevado. Mock para los que sí integran: `mock-lenders` (:8099).

### F-26 · Dos fallos que NO se arreglan mockeando

Aparecieron en el mismo relevamiento y conviene reconocerlos para no perder tiempo:

- **Banco de Bogotá #5** → `Undefined variable $certPath` en `BancoDeBogota.php:138`. Es un **bug de PHP**: revienta antes de llamar a nadie. Ningún mock lo arregla; necesita el config del certificado o un fix de código.
- **Welli #23 / Approbe #41 / BancolombiaBnpl #68** → `Attempt to read property "url_utm" on null`. No es el proveedor: la entidad **no está configurada para esa sucursal** (falta la fila en `lenders_by_allied_branches`). Error de método al probar — hay que usar un comercio que sí la tenga.

**Lección:** antes de culpar a un servicio externo, mirar si el error es un `Undefined variable` o un `on null` — eso es código o config, no red.

### F-27 · `new URL('//ruta', base)` no es la ruta que creés

**Síntoma:** un mock propio respondía siempre desde su handler raíz y su log quedaba vacío, pese a que el backend claramente lo llamaba.
**Causa raíz:** el backend arma la URL con **doble barra** (`baseUrl` + `/{pos}/getCreditToken` con `{pos}` vacío → `//getCreditToken`). En JS, `new URL('//x', base)` se interpreta como URL **protocolo-relativa**: `host='x'`, `pathname='/'`.
**Evidencia:** `new URL('//getCreditToken?a=1','http://localhost:8099').pathname` → `'/'`.
**Arreglo:** colapsar las barras iniciales antes de parsear: `String(req.url).replace(/^\/{2,}/, '/')`.
**Estado:** resuelto. **La pista fue el log VACÍO** — si el mock responde pero no registra nada, no está viendo lo que creés.

---

### F-28 · Matriz de conductas por comercio × entidad (relevada, no supuesta)

Al seleccionar una entidad, el backend responde una COMBINACIÓN de rasgos (no uno solo): `standBy` · `showModal` · `openProcessModal` (2ª variante de modal: "seguí en el punto de venta / en la app del lender", con `showModal=false`) · `validateLenderOtp` · `url` (a veces junto con modal). Resumen de lo relevado (7 comercios, ~35 selecciones):

| Conducta | Entidades (ejemplos) |
|---|---|
| standBy (in-platform) | TODOS los rt=2 · **Credifamilia rt=4 #24** (¡sin llamar al WSDL!) |
| modal + url del portal | Addi #6, Sufi #7, Su+pay #11, Abanta #50, Global Care #14, Brilla #19 |
| processModal (sin url) | Lagobo #35, Davivienda #36, Meddipay #39 (en sonria) |
| otp-lender (`validateLenderOtp`) | Sistecrédito #9 — origination in-house con OTP del lender |
| ERROR | BdB #5 (solo en algunos comercios, F-26) · Prami #12 (`array offset on null`) |

Hallazgos puntuales:
- **Credifamilia rt=4 selecciona con `standBy` y CERO llamadas externas** → la parte in-platform del flujo rt=4 (confirmation → fechas → firma) se puede recorrer en local sin VPN; el SOAP de radicación es de la formalización, no de la selección.
- **`Brilla Guajira #123` NO lista en el marketplace pero SÍ se deja seleccionar por API** → listado y seleccionabilidad son decisiones independientes.
- **La conducta depende del COMERCIO, no solo de la entidad**: BdB #5 funciona en celucambio (url→slm.bancodebogota.com) y en sonria (url→**bit.ly**) pero revienta con `$certPath` en godentist; Bancolombia #68/#100 en pullman devuelven url→**originaciones-stg.dev.creditop.com** (la URL sale de config por comercio — `url_utm` —, no de una API); Meddipay #39 da processModal en sonria y modal en godentist.

### F-29 · Receta del cierre rt=2 100% por API (sin navegador)

Secuencia verificada que lleva una solicitud de cero a **Estado 11 "Autorizada" con `request_number`** (Celupresto #96 y Mediarte 0% #94):

```
POST /api/onboarding/loan-application/update-user-request/{ur}   (select → standBy)
GET  /api/loans/requests/{ur}                                    (continue index)
POST /api/loans/requests/confirm {user_request_id}               → next_step: identity_validation
                                                                   (aws_validation · document_and_facial_recognition = el ADO;
                                                                    headless NO bloquea los pasos siguientes)
GET  /api/loans/requests/promissory-note/{ur}/select-payment-date  → { nextPaymentDates:[{date,day}], selectedCycle }
POST /api/loans/requests/promissory-note/{ur}/confirm-payment-date { payment_date }
GET  /api/loans/requests/promissory-note/{ur}/simulate-payment-schedule
POST /api/loans/requests/promissory-note/{ur}/confirm-payment-schedule { fee_number, selected_cycle, … }
GET  /api/loans/requests/promissory-note/{ur}          ← GENERA los documentos (es lo que hace el loader
                                                          de sign-documents); SIN esto, authorize muere con
                                                          "PromissoryNote no encontrado"
POST …/promissory-note/validate/send-otp                (bypass QA → sin SMS)
POST …/promissory-note/validate/verify-otp {otp: últimos 6 del celular}  → estado 28
POST …/promissory-note/validate/authorize               → estado 11 + request_number
```

Gotchas: las rutas de fechas/cronograma viven bajo el prefijo `promissory-note` (un 404 lo enseñó); el estado **28 "Autorizado pendiente desembolso" es el intermedio real** entre verify-otp y authorize; todo con UA de iPhone.

### F-30 · DENTIX no cierra en local: su pagaré es Deceval (SOAP)
> ⚠ **Stale** — corregido por F-31 y afinado por F-37 → `credifamilia`. Crónica completa: `cerrados.md`.

### F-31 · Credifamilia rt=4: la cadena real de bloqueos (no era el SOAP)
> **Graduó** → `credifamilia` — el hecho vive allá; la crónica, en git.

### F-32 · La regla de `promissory_type` tiene una excepción: el path IMEI difiere el desembolso
> **Graduó** → `harness` — el hecho vive allá; la crónica, en git.

### F-33 · zsh no hace word-splitting (trampa al verificar)

**Síntoma:** un loop `for L in "slug 77"; do set -- $L; cmd $1 $2` pasó `"slug 77"` como UN argumento; la herramienta reportó "sin branch_hash" para un comercio que sí lo tenía, y por un momento pareció un bug de datos.
**Causa raíz:** a diferencia de bash, **zsh no divide en palabras las expansiones sin comillas**. `set -- $L` deja `$1="slug 77"`.
**Arreglo:** `${=L}` en zsh, o evitar el truco: `for pair in slug:77; do S="${pair%%:*}"; L="${pair##*:}"`.
**Estado:** anotado en la sección de trampas — el error se veía como "el dato no existe" cuando era el shell.

### F-34 · La conducta la decide la CREDENCIAL del par (comercio, entidad) — no la entidad
> **Graduó** → `creditop §invariante 1` — el hecho vive allá; la crónica, en git.

### F-35 · Matriz completa: 24 comercios barridos

Cobertura del barrido headless sobre **todos** los comercios de `.flows.json`. Conductas observadas, agrupadas:

- **standBy (in-platform)** — todos los rt=2 y Credifamilia rt=4. Único grupo que puede cerrarse en local (ver F-32 para las excepciones).
- **modal + url de config** — el caso más común, sin tráfico saliente: Addi, Sufi, Servicrédito, Brilla, Global Care, Abanta, Su+pay, Welli, Meddipay, y **Bancolombia #68/#100**, cuya url apunta a `originaciones-stg.dev.creditop.com` (staging de CreditOp, no del banco).
- **processModal** (`openProcessModal` con `showModal:false`) — Lagobo, Davivienda, Meddipay en sonria.
- **otp-lender** — Sistecrédito donde hay credencial POS.
- **ERROR** — Banco de Bogotá donde hay credencial (F-26/F-34); Prami #12 (`array offset on null`).

**Dato útil:** los comercios de electro (alkosto, alkomprar, k-tronix) son idénticos entre sí — solo Bancolombia #68/#100 — así que como escenarios de prueba son intercambiables y no aportan cobertura nueva.

### F-36 · El muro de Deceval NO es el host: son credenciales criptográficas (y por eso NO se mockea)
> **Graduó** → `harness · credifamilia` — el hecho vive allá; la crónica, en git.

### F-37 · Netco solo lo usa Credifamilia — DENTIX no lo necesita
> **Graduó** → `credifamilia` — el hecho vive allá; la crónica, en git.

### F-38 · Rotativo (rt=3) SÍ existe y se distingue — pero no cierra por config del comercio
> **Incidente cerrado** (lo cierra F-57). Crónica completa: `cerrados.md`.

### F-39 · Servicing (cobranza por hardware): VERIFICADO end-to-end en local

Es la única parte del post-Estado-11 ejercitable localmente, y **funciona**. Los 3 crons viven en `legacy-backend` (`app/Console/Kernel.php`): lock 04:00 · unlock 05:00 · unroll 06:00.

**Receta verificada** (primera vez que se corre el ciclo completo):
1. Tener una solicitud con **IMEI enrolado** (`user_request_products.imei`).
2. Sembrar una fila en el ledger **`creditop_x_requests_history`** con `creditop_x_requests_status_id = 2` (mora) y `days_past_due >= 8` — clonar una fila existente y cambiar esos campos.
3. `php artisan app:lock-devices-past-due` → *"Dispatched 1 device locking jobs"*.
4. El job llama al MDM y persiste en **`device_locks`**: `status = locked`, `locked_at`, y el `api_response` completo.

**El ledger tiene 214.746 filas en el dump local** — o sea hay material real para ejercitar mora sin inventar casi nada.

**Gotcha del contrato (nos mordió):** `lock`/`unlock`/`release` NO usan el mismo contrato que `enroll`. El cuerpo es `{ devices: [{deviceId, title, message}] }` y la respuesta se lee con `data_get($response, 'results.0')`. Un mock que devuelva `{deviceId, state}` plano deja el `device_lock` en **`failed`** aunque responda `success: true` — silencioso y confuso. Corregido en `mock-mdm`.

**Lo que sigue sin cubrir del post-11:** el resto del servicing CreditopX (cascada de cobranza, mora, intereses, seguros, capital) corre en **`application`**, no en legacy — fuera del alcance de este stack local.

### F-40 · Ecommerce: NO es ejercitable — la ruta de checkout ya no existe en el wizard
> ⚠ **Stale** — CORREGIDO por F-54: el eje ecommerce existe — solo resuelve Bancolombia y se prueba contra dev. Crónica completa: `cerrados.md`.

### F-41 · "Formulario no encontrado" = el flujo DINÁMICO sin su schema
> **Graduó** → `form-service` — el hecho vive allá; la crónica, en git.

### F-42 · Varios "servicios externos" existen como repo local
> ⚠ **Stale** — superado por F-123 + el nodo `microservicios` (criterio: vivo en prod, no clonado en disco). Crónica completa: `cerrados.md`.

### F-43 · El formulario dinámico carga pero no deja avanzar: dos causas distintas

Continuación de F-41. Con el schema servido, el formulario **renderiza** pero rechaza todo: ciudad vacía, *"No pudimos validar tu correo"*, *"Selecciona un tipo de documento válido"*. Son **dos mecanismos independientes**, y ninguno se ve en la pantalla:

**(a) Los desplegables salen del PROPIO schema.** `PersonalInfoForm` lee `fields.cityOfResidence.options` y `fields.documentType.options`. Si el schema no trae `cityOfResidence`, el select queda vacío y el form bloquea con *"Selecciona tu ciudad para continuar"*.

> **Dato útil:** `PersonalInfoForm` es el **único paso realmente data-driven**. `AmountForm`, `PhoneForm`, `OtpForm` y `FinancialInfoForm` **no leen `fields`** — su contenido no depende del schema. O sea, para un schema mockeado, el único paso que hay que modelar con cuidado es el de datos personales.

**(b) El veredicto de correo/documento viaja en un campo `code`, no en el HTTP status.** El wizard compara contra constantes de `request-personal-info.shared.ts`; con **200 OK pero sin el `code` esperado** muestra el error de validación igual:

| Endpoint | Disponible | Ya registrado |
|---|---|---|
| `POST /v1/dynamic/full/find-user-by-email` | `OFS6001` | `OFS6000` |
| `POST /v1/dynamic/full/find-user-by-document-number` | `OFS7001` | `OFS7000` |

**Arreglo:** ambos en `mock-forms`. El mock acepta `?taken=1` (o `MOCK_FORMS_TAKEN=1`) para devolver el veredicto de "ya registrado" y ejercitar ese camino sin ensuciar datos.

**Patrón que se repite en este flujo:** *200 OK con cuerpo inesperado* se ve exactamente igual que *servicio caído*. Ya nos pasó tres veces (F-41 forma del schema, F-43 código de veredicto, F-39 contrato de lock). **Cuando algo del flujo dinámico "no anda", comparar el CUERPO contra lo que el consumidor espera — no mirar solo el status.**

### F-44 · El flujo dinámico usa OTRA taxonomía de documentos (no CC/CE/PEP)

**Síntoma:** se escribe un número de identidad válido y aparece **"Selecciona un tipo de documento válido"** — y el mensaje sale **debajo del campo NÚMERO**, no del selector, así que parece que el número está mal.

**Causa raíz:** el flujo dinámico (RD/VE) **no comparte la taxonomía de documentos del flujo clásico colombiano**. `dynamic-step-one.ts::isSupportedDocumentType` admite exactamente cuatro tipos, cada uno con su patrón:

| Tipo | Qué es | Patrón |
|---|---|---|
| `CED` | cédula dominicana | exactamente **11 dígitos** |
| `CI_VE` | cédula de identidad venezolana | 6 a 11 dígitos |
| `PAS` | pasaporte | 6 a 9 alfanuméricos |
| `PAS_VE` | pasaporte venezolano | 6 a 9 alfanuméricos |

**`CC`, `CE` y `PEP` NO están soportados** — cualquiera de ellos hace fallar la validación pase lo que pase en el número. Un schema (real o mockeado) que ofrezca los tipos colombianos deja el flujo dinámico **intransitable**.

**Evidencia:** con `10311385677` (11 dígitos, cédula dominicana válida) el form rechazaba mientras `documentType` fuera `CC`; con `CED` valida.

**Arreglo:** `mock-forms` ahora ofrece `CED/CI_VE/PAS/PAS_VE` y permite alfanuméricos en el número (para pasaporte).

**Implicancia de negocio:** el eje **país** no es solo formato de moneda (F-22) ni de pantallas (F-41) — también cambia **qué documentos existen**. Cualquier trabajo sobre el flujo dinámico debe asumir la taxonomía RD/VE, no la colombiana.

### F-45 · Flujo dinámico completo: los 5 pasos y qué exige cada uno

Cierre de F-41/F-43/F-44. El flujo dinámico (RD) recorre **cinco rutas** y cada una tiene su propio requisito; fallar cualquiera deja una pantalla que no explica la causa:

| Paso | Ruta | Qué exige | Si falla |
|---|---|---|---|
| 1 | `request-amount` | `GET /dynamic/{hash}/schema` **con forma válida** (`theme` + `components.logo.boxs.image` + `.userName`) | "Formulario no encontrado" (F-41) |
| 2 | `request-phone` | — | — |
| 3 | `request-otp` | `POST …/send-otp` y `…/validate-otp` | — |
| 4 | `request-personal-info` | `fields.cityOfResidence.options` en el schema + veredicto en `code` (`OFS6001`/`OFS7001`) + tipo de documento de la taxonomía RD/VE | ciudad vacía · "No pudimos validar tu correo" · "Selecciona un tipo de documento válido" (F-43, F-44) |
| 5 | `request-financial-info` | el submit debe devolver **`{ redirect }`** | 502 `submit_missing_redirect` → "espera unos minutos e intenta nuevamente" |

**Sobre el paso 5:** el servicio real orquesta el alta contra el legacy por **endpoints backdoor** (`create-temporary-user` → `accept-terms` → `resolve-lenders-redirect`), autenticados con `Authorization: Bearer <BACKDOOR_API_KEY>` (está en el `.env` de legacy) y con el teléfono en **E.164** (`+57…`, el patrón exige `^\+[1-9]\d{0,2}…`). Se intentó replicar esa cadena; la auth y el formato se resolvieron pero `create-temporary-user` devuelve `BD000` sin traza útil.

**Decisión:** `mock-forms` crea la solicitud por el **mismo camino que el resto del harness** (register + INSERT + `synthFill`, como `dev/sweep.ts`). El resultado es **equivalente** —un `user_request` real que `/lenders` consume— aunque el *cómo* difiera del servicio real. Verificado: submit → `{redirect:"/merchant/1bfb8cd0/464477/lenders?amount=8900", userRequestId:464477}`, la solicitud existe con el documento y monto enviados, y lista `smartpay rt2`.

> **Deuda anotada:** si alguna vez importa ejercitar la orquestación REAL (que crea el usuario como lo hace producción), hay que resolver el `BD000` de `create-temporary-user`. Para el objetivo de "recorrer el flujo dinámico en local", el atajo alcanza.

---

### F-46 · Elegir lender BORRA el asesor de la solicitud (y eso rompe Ábaco)

**Síntoma:** el login y los results de Ábaco mueren con `SQLSTATE[23000] … Column 'corporate_user_id' cannot be null` al insertar en `user_request_additional_information`.

**Causa raíz — NO es un bug del producto, es la llamada la que no se identifica.** En `UserRequestService:278`:

```php
$corporate_user_id = (auth()->check()) ? auth()->user()->id : $request->corporate_user_id;
```

`update-user-request` (la selección de lender) **reescribe** el campo: si la petición no está autenticada y no manda `corporate_user_id` en el cuerpo, lo deja en **NULL** — borrando el asesor que la solicitud ya tenía.

El wizard no sufre esto porque manda el header **`x-cognito-identity-id`** (lo arma `default-layout`), que el middleware `ResolveCognitoUser` convierte en usuario autenticado. Las solicitudes históricas creadas por UI conservan el asesor; las creadas por API pura, no.

**Evidencia** (aislado paso a paso):

| Momento | `corporate_user_id` |
|---|---|
| tras el INSERT | 1827080 |
| tras `synthFill` | 1827080 |
| **tras `update-user-request`** | **NULL** |

**Arreglo:** `dev/sweep.ts` manda `x-cognito-identity-id` con el sub del asesor en todas sus llamadas. **Lección general: una llamada por API que no manda ese header no es equivalente a la del wizard** — puede borrar datos en silencio.

### F-47 · Ábaco: la mitad ya estaba mockeada en el código

Ábaco es 100% externo (no hay código del proveedor), pero **antes de mockear conviene mirar qué ya está resuelto**:

| Endpoint | ¿Sale al proveedor en local? | Por qué |
|---|---|---|
| `/results` | **no** | `Abaco::results()` corta en `app()->environment(['local'])` y devuelve `AbacoFixture::generateDynamicMock()` |
| `/platforms` | **no** | el setting `abaco_config.platforms_check_enabled = false` lo sirve desde la config en BD |
| `/init/gig-economy` | **sí** | → `mock-abaco` :8102 |
| `/login` | **sí** | → `mock-abaco` :8102 |

**Gotchas del contrato** (`app/Actions/RiskCentrals/Abaco.php`):
- Los POST van **form-encoded** (`Http::asForm()`), no JSON.
- La respuesta de `init` debe traer `customer_id`/`token`/`redirect_url` **en la RAÍZ**: el cliente ya envuelve como `['success'=>…, 'data'=>$response->json()]`. Anidarlos bajo `data` devuelve **200 "initialized successfully" con los campos VACÍOS** — cuarta aparición del patrón "200 con cuerpo inesperado".
- Si `init` devuelve `redirect_url`, el backend le hace GET y extrae la cookie **`sessionid`**.

**Cómo se controla el veredicto:** el fixture keyea por `platforms[SLUG].auth === '200 - OK'`, marca que escribe el **paso 2** del login (no el 1). Con el `auth` puesto, `abaco_config.mock_pass` decide: `true` → `{"UBER":"success"}` · `false` → `{"UBER":"error"}`.

**Uso:** `node dev/sweep.ts abaco <slug> <lenderId>` corre la cadena entera.

### F-48 · Renting en v2: el discriminador es `product`, y estaba roto
> ⚠ **Stale** — el puente `lenders.product` fue reemplazado por `lender_requirements` → `motai`. Crónica completa: `cerrados.md`.

### F-49 · Dónde vive el paso de Ábaco en el front (y por qué el harness se lo comía)

**Síntoma:** una corrida de Motai R (`product='renting'`) llegó a `loan-approved` **sin pasar nunca por Ábaco**, pese a que el backend respondía `MOTV1001 requiere Abaco`.

**Causa raíz — el muro lo ponía el harness.** La bifurcación NO está donde uno la buscaría (en una pantalla propia del renting) sino en el **`action` de `/confirmation`**:

```ts
// routes/loan-confirmation.tsx:194
if (abacoRequirement.code === AbacoRequirementCode.REQUIRED) {
      return routeHelpers.redirect(ROUTE_PATHS.abaco(String(loanRequestId)));   // :206
}
```

O sea: se dispara **al tocar "Continuar" en confirmation**, y por lo tanto **ANTES del ADO**. El harness saltaba de `confirmation` directo a `first-payment-date` para esquivar la captura de identidad (F-10) — y con eso se comía exactamente el paso que se quería ver.

**El front consulta el requerimiento en TRES lugares**, todos vía el mismo endpoint del backend:

| Archivo | Para qué |
|---|---|
| `routes/loan-confirmation.tsx` | **la entrada real** a `/abaco` (action del "Continuar") |
| `routes/identity-validation-status.tsx` | `buildCompletionPath()` → `requestSent` si requiere Ábaco, `firstPaymentDate` si no |
| `routes/api/validation-status.tsx` | expone `validationStatusAbaco: {required, completed}` al polling |

**Respuesta a "¿cómo se hacía antes con modes?":** el **frontend nunca supo de modos**. Siempre preguntó lo mismo (`POST /api/onboarding/motai/check-abaco-requirement`) y ramificó por el código de respuesta. Lo único que cambió en v2 es **cómo decide el backend**: antes `allied_modes.config.isAbacoRequired` del modo de la solicitud; ahora `lenders.product === 'renting'` (F-48). Por eso la des-motaización no tocó estas rutas.

**Arreglo:** `guided.spec.ts` pregunta el requerimiento **antes** de saltear: si es `MOTV1001`, deja a B en `confirmation` (y avisa que el "Continuar" lleva a `/abaco`); si no, saltea el ADO como siempre. Verificado en el mismo comercio: `#169 Motai R` → se queda · `#168 Motai C` → saltea.

**Lección transferible:** cuando un flujo "no pasa por X", revisar primero si el harness **saltea** el punto donde X se decide. Los atajos que compensan pasos no automatizables pueden tapar justo la rama bajo prueba.

### F-50 · Renting cancelada después de Ábaco: una fila faltante que el front convierte en cancelación

**Síntoma:** la solicitud **464498** (`#169 Motai R`, tel 3131010101) pasó Ábaco entera y a los ~90s quedó **Cancelado**. Rastro en BD:

```
user_requests.user_request_status_id = 8            (Cancelado)
user_request_records: 3 → 8 "Cancelación no voluntaria código 5001"
```

**Ojo con la columna:** `user_requests.status` (=1) **no es** el estado de la solicitud; el estado vive en **`user_request_status_id`**. Mirar la columna equivocada hace creer que la solicitud está sana.

**Causa raíz — un dato que la migración de v2 no sembró.** `lender_identity_validation_types` no tiene fila para los lenders nuevos de Motai (**158, 168, 169, 170**). Todos los demás rt=2 sí la tienen. Y el resolutor la lee con un default silencioso:

```php
// ValidationStatusService.php:298
(int) ($userRequest->lender?->primaryIdentityValidationType?->identity_validation_type_id ?? 0)
```

Sin fila → `0` = **`Unknown`** (¡no `None`, que es `1`!) → `IdentityValidationStepResolver` cae en su `default` → `next_step: 'error'`, `type: 'unsupported_validation'`.

**Y ahí el front lo convierte en cancelación, en tres saltos, todos "fallback":**

| # | Dónde | Qué hace con un tipo que no conoce |
|---|---|---|
| 1 | `abaco/platform-otp-validation.tsx:257` | fallback → `identity-validation-instructions` |
| 2 | `identity-validation-instructions.tsx:94` | el `action` solo contempla `ado_validation` y `crosscore_validation`; el `return` final → `request-canceled` |
| 3 | `request-canceled.tsx:32` | **cancela en el `loader`** (no es una pantalla pasiva): `CancelLoanRequestUc` sin código → default **5001** "Error genérico de validación", `voluntary=false` |

`loan-confirmation.tsx:258` tiene el mismo fallback, así que el flujo normal (sin Ábaco) llega al mismo pozo.

**Lo peligroso es la forma, no el dato:** un tipo de validación no soportado —una condición de **configuración**— termina cancelando el crédito del cliente, sin mensaje ni código propio. `request-canceled` es una ruta que *ejecuta* la cancelación con solo aterrizar en ella, y es el destino de todos los fallbacks del wizard.

**Pista que lo delataba:** `identity.validation_type.drift_detected {"lender_id":169,"primary_validation_type":0,"legacy_validation_type":2}` repetido cada ~30s antes del cancel. El warning existe justo para esto: la fuente primaria (tabla) y la legacy (`lenders.validation_type`) discrepan y **gana la primaria**, aunque valga `0`.

**Arreglo local (solo BD, dump local):** sembrar la fila con `identity_validation_type_id = 1` (`None`) para 158/168/169/170 → el resolutor devuelve `no_validation_required` → post-Ábaco enruta a `first-payment-date` y el flujo cierra.

```sql
INSERT INTO lender_identity_validation_types (lender_id, identity_validation_type_id, `order`, status, created_at, updated_at)
SELECT l.id, 1, 1, 1, NOW(), NOW() FROM lenders l WHERE l.id IN (158,168,169,170)
  AND NOT EXISTS (SELECT 1 FROM lender_identity_validation_types t WHERE t.lender_id=l.id AND t.`order`=1);
```

**Dos cosas a decidir con el equipo (no las decide el harness):**
1. **Qué validación de identidad debe usar renting.** El dato legacy se contradice a sí mismo: `#158 Motai Renting` tiene `validation_type=1` (None) y `#169 Motai R` tiene `2` (AWS). Se sembró `None` porque es lo que deja correr el flujo en local y es coherente con el resto del harness (el ADO ya se finge validado, F-10). **La migración de v2 debería sembrar esta tabla explícitamente.**
2. **El fallback que cancela.** Un `unsupported_validation` debería terminar en una pantalla de error de configuración, no en una cancelación no voluntaria con código genérico.

**Verificado en la práctica (uReq 464499, mismo comercio y lender):** con la fila sembrada el flujo de renting cierra entero — `confirmation → abaco → abaco/platforms → abaco/platform-otp-validation → first-payment-date → payment-schedule → sign-documents → otp-validation → loan-approved`, con rastro `3 → 28 → 11` (Autorizada).

### F-51 · El formulario de referencias del Figma: el mecanismo existe, la posición y los campos no
> **Incidente cerrado** (comparación de un día contra dump local). Crónica completa: `cerrados.md`.

### F-52 · El scrub del harness borra la corrida anterior y deja el historial huérfano

**Cómo apareció:** al verificar el cierre de la uReq 464499 (F-50), la fila de `user_requests` **ya no existía**, pero sus `user_request_records` sí, con el rastro completo `3 → 28 → 11`.

**Causa:** `scrubphone` (`pkg/asesor.ts:236`) borra los users cliente del teléfono de prueba y, con ellos, sus `user_requests` (`deleteUsers` en `:178`, FK checks off). Como **cada corrida arranca scrubbeando**, la corrida N destruye la evidencia de la N-1. La 464499 la borró la corrida siguiente (464500, otro user_id, 33s después).

**Y el borrado es parcial:** `user_request_records` **no está** en la lista `childTables`, así que sus filas sobreviven al borrado del padre.

```
huérfanos en user_request_records:  873 / 1288  (68%)
```

**Dos implicancias opuestas, las dos importantes:**
- *A favor:* el historial huérfano es lo único que permitió reconstruir F-50 después de que la solicitud desapareciera. Sin él, la corrida cancelada no habría dejado rastro alguno.
- *En contra:* consultar `user_requests` por el id que imprimió una corrida vieja devuelve **vacío**, lo que se lee como "nunca existió" en vez de "lo borró el scrub". Es una trampa de verificación del mismo tipo que las de la sección F.

**Regla práctica:** para hacer forense de una corrida, consultarla **antes** de lanzar la siguiente; o buscar por `user_request_records`, que sobrevive. Y al mirar una solicitud vieja, recordar que la columna de estado es `user_request_status_id`, no `status` (F-50).

### F-53 · La guarda de "estás tocando dev compartido" viene desarmada de fábrica
> ⚠ **Stale** — herramientas citadas BORRADAS; la regla sigue viva: el guard se exporta A MANO en la shell, nunca en un `.env` (CLAUDE.md raíz). Crónica completa: `cerrados.md`.

### F-54 · La entrada por ecommerce existe y funciona — pero hoy solo resuelve Bancolombia

**Corrige a F-40**, que concluía que el eje ecommerce estaba muerto porque "no hay ruta `checkout` en el wizard". Es más matizado: lo que falta es la **landing**, no el mecanismo.

**Lo que SÍ funciona hoy (verificado contra el backend local, no supuesto):**

```
GET /api/onboarding/checkout/{allied_branch_hash}?o=&p=&t=&u=&ps=[&config=]
```

Los 5 parámetros van en **base64** (`CorbetaCheckoutController.php:119-146`): `o`=order (debe traer `billing` y `total`), `p`=products, `t`=token, `u`=return_url, `ps`=process_endpoint. Si falta uno → `SP20754` sin explicación.

El backend decodifica, **crea la solicitud** y responde **302** a
`{FRONTEND_URL_DEV}/bancolombia/self-service/{hash}/resolve-ecommerce-flow/{uReq}` (`:1250`).
Esa ruta **sí existe** en la rama actual (`routes.ts:158`). Probado con Pullman (`13874eb6`): creó la uReq y redirigió correctamente.

**El muro real: ese resolvedor es de BANCOLOMBIA.** `routes/bancolombia/ecommerce/resolve-ecommerce-flow.tsx` tiene título *"Validando información - Bancolombia"*, importa de `@creditop/bancolombia-origination` y su `SupportedFlowType` es `"bnpl" | "consumo"`. Con un comercio **CreditopX** el flowType sale `no_preapproved` y el propio loader llama `cancelCorbetaCheckout`:

```tsx
if (flowType === "no_preapproved") {
      await cancelCorbetaCheckout({ … });     // ← la solicitud nace CANCELADA
```

Evidencia: la uReq 464508 (Pullman, $1.5M) quedó en estado **8** con `Cancelación no voluntaria código 5001` **en el mismo segundo** de su creación. Es el mismo código genérico de F-50 — otra ruta que cancela desde el `loader`.

**Dónde está la pieza que falta.** La landing genérica multi-flujo —`route("checkout", "routes/checkout-redirection.tsx")` + `route("waiting-room", "routes/ecommerce-continue.tsx")`— existe **solo** en `feat/ecommerce-checkout-integration` (abril 2026). Verificado que **no** está en `main`, `develop`, `feature/motai-v2`, `feature/onboarding/ecommerce-web-origination` ni `feature/onboarding/ecommerce-continue-route`.

Dato de contexto: `feature/onboarding/ecommerce-continue-route` (junio, ya en `develop`) registró `/ecommerce/.../continue` — el handoff de CreditopX. O sea **develop tiene el medio del árbol ecommerce, pero no la puerta**.

**Trampas de entorno que costaron dos intentos:**

| Síntoma | Causa |
|---|---|
| 302 a `originaciones.dev.creditop.com` | `resolveFrontendBaseUrl()` (`:1160`) cae al default de `config/app.php`. **Sin `FRONTEND_URL_DEV` en `legacy-backend/.env`, el flujo local se ESCAPA A DEV sin avisar.** |
| `BP12700001` "user conflict" | el teléfono/documento ya tiene usuario con otra identidad (`:265`). Scrubbear antes. |
| 404 mudo al armar la URL | `E2E_API_BASE_URL` ya trae `/api` en local → `/api/api/…`. |

**Qué quedó en el harness:** `pkg/checkout-b64.ts` arma y sigue la URL base64 (`urlCheckout` / `seguirCheckout`), y `E2E_ENTRY=ecommerce` en `guided.spec.ts` entra por ahí. **Ojo:** cada GET al checkout **crea una solicitud**, así que no se puede pre-seguir headless *y* navegar el browser — genera dos y deja la primera huérfana.

**Confirmación desde el navegador (no solo por API).** La corrida visual con `E2E_ENTRY=ecommerce` sobre Pullman lo dejó a la vista, y la traza contrastada lo cazó en el **paso 1**:

```
01 A /bancolombia/self-service/13874eb6/resolve-ecommerce-flow/464508 │ BD 8 «Cancelado» ← DESENLACE MALO
04 A /bancolombia/self-service/13874eb6/no-preapproved                │ BD 8 «Cancelado»
```

El wizard aterriza en **`/no-preapproved`** —la pantalla de "no preaprobado" de Bancolombia— y la corrida termina en timeout esperando una pantalla a la que nunca va a llegar. Sin la traza, eso se veía como un cuelgue mudo de 5 minutos; con ella, el diagnóstico está en la primera línea.

**Confirmado desde el OTRO extremo: el plugin de WooCommerce.** `playground/creditop-woocommerce` (v1.0.20, lo que el comercio instala) es el productor real de esa URL, y en `class-creditop-gateway.php:507` apunta a:

```php
$redirect_url = $base . '/ecommerce/' . $hash . '/checkout' . '?o=' . …
```

O sea **el plugin apunta hoy a la landing que esta rama no tiene**. El propio comentario del plugin avisa del cambio de path (`/ecommerce/{hash}/checkout`, no `/checkout/{hash}` como el monolito viejo), así que la ruta se movió y el wizard de `main`/`develop` no la acompañó. Si producción funciona, es porque corre una rama que sí la tiene.

**Detalle de serialización, para quien reimplemente el contrato:** el plugin manda `o` y `u` **PHP-serializados** (`serialize()`) y `p` como JSON. Las dos formas funcionan: `deserializeData` (`CorbetaCheckoutController.php:767-787`) intenta `unserialize`, cae a `json_decode`, y castea array→objeto en ambos casos. El harness manda todo JSON y el backend lo acepta igual.

**Para correr un comercio CreditopX (Pullman) por ecommerce hace falta la landing genérica de la rama de abril.** Con lo que hay en `develop`, la entrada base64 solo tiene sentido para comercios Bancolombia.

### F-55 · El ruteo de validación de identidad tiene tres agujeros que CANCELAN el crédito

**Amplía a F-50.** Aquel arregló el síntoma (sembrar la fila faltante para 4 lenders). Auditando **todas** las bifurcaciones del wizard aparecieron tres agujeros más, del mismo mecanismo: el front no contempla un valor, cae en un fallback, y el fallback termina en `request-canceled` — **cuya ruta cancela en el `loader`**.

**1 · El backend emite 7 tipos de paso; el front mapea 5.** Verificado por grep sobre `apps/` y `modules/`:

```
aws_validation · ado_validation · crosscore_validation · evidente_validation · no_validation_required   → mapeados
unsupported_validation      → 0 ocurrencias en TODO el frontend
no_validation_configured    → 0 ocurrencias
```

Los dos huérfanos salen de `IdentityValidationStepResolver.php:100-111` (rama `default`) y `CreditopXFlowService.php:94-102` (lender sin `primaryIdentityValidationType`). Caen en el fallback de `loan-confirmation.tsx:258` → `identity-validation-instructions` → su action no matchea → `:94` → cancelación.

**Lo importante para F-50:** el enum `IdentityValidationType` tiene 7 casos y el resolver mapea 5 (1,2,4,5,6). **`Unknown=0` y `Questions=3` son valores REALES que caen en el default.** Sembrar la fila no alcanza si el valor sembrado es `3`: un lender con `identity_validation_type_id = 3` mata la solicitud igual.

Y el backend **ya avisa**: marca esos casos con `next_step => 'error'`. El front lee solo `step_details.type` (`loan-confirmation.tsx:241`) e ignora `next_step` — descarta la señal explícita.

**2 · Un fallo al cargar el TEMA VISUAL cancela el crédito.** `identity-validation-instructions.tsx:31-40`: el `catch` del loader —que envuelve el `GetAlliedThemeUc`, o sea el fetch del branding del comercio— redirige a `request-canceled`. Un problema de theming mata una solicitud viva. Esa pantalla tiene **cinco** salidas a cancelación (`:63, :77, :88, :94, :103`) más la del loader.

**3 · Renting + Evidente se cancela solo.** `abaco/platform-otp-validation.tsx` mapea 3 tipos (`aws`, `ado`, `no_validation_required`) — grep de `evidente` da **0**. Al terminar Ábaco, un lender con Evidente cae en el fallback `:258` → instructions → cancelación. `crosscore` zafa de casualidad porque instructions sí lo maneja.

**Contraste que muestra que es arreglable:** el mismo tipo huérfano **sí** está contenido en `identity-validation-status.tsx:128` (cambio de proveedor en caliente), donde el `default` cae a `defaultPath` en vez de a instructions. La misma clase de valor se maneja bien en un lugar y mal en el otro.

**Qué haría falta (decisión del equipo):** que el front honre `next_step === 'error'` con una pantalla de error de configuración, y que `request-canceled` deje de cancelar desde el `loader` — hoy **navegar o recargar esa URL cancela la solicitud**.

### F-56 · Cuatro de las cinco salidas de `/lenders` dan 404 fuera de `/merchant`
> ⚠ **Stale** — rama mergeada a qa el 2026-07-29; el análisis de `standBy` era de esa rama → `motai`. Crónica completa: `cerrados.md`.

### F-57 · Rescate antes de borrar `backend-e2e` y `backend-mcp`
> ⚠ **Stale** — el rescate se hizo; los hechos rescatados viven en sus nodos — las citas a `backend-e2e/docs/*` ya no resuelven. Crónica completa: `cerrados.md`.

### F-58 · Un rechazo de la firma de flujo llega como HTTP 200 y el front lo toma como éxito
> **Graduó** → `kyc §deuda F-58` — el hecho vive allá; la crónica, en git.

### F-59 · `bin/asesor` moría mudo en el paso `frontend` porque un `grep` sin match mata al script
> ⚠ **Stale** — el `env/` compartido se eliminó; la regla viva: bajo `set -euo pipefail`, un `VAR="$(grep …)"` sin match ABORTA el script sin mensaje. Crónica completa: `cerrados.md`.

### F-60 · Sonría no sirve para probar la omisión de Experian: el throttle corta antes que el flujo
> **Incidente cerrado** (la tabla que traía ya no valía (se auto-invalidó)). Crónica completa: `cerrados.md`.

### F-61 · Staging falla el login del asesor porque es OTRO pool de Cognito sobre la MISMA base

**Síntoma.** Contra `staging` el login de Cognito pasa sin problema, pero el wizard responde **"No tienes un comercio asignado"**. Se ve como un problema de permisos del comercio; no lo es.

**Causa raíz verificada.** Staging **no tiene backend propio**: usa el mismo legacy-backend y la misma base que dev. Lo único propio es el frontend desplegado. Pero el **frontend de staging entra por otro pool**:

| | puerta de Cognito | client |
|---|---|---|
| dev / local | `login.creditop.com` | `14lo4ra4khrdaomd78f0sqh2l4` |
| **staging** | `auth.merchant.creditop.com` | `il7p9uebtjjaoaqc6q9brg6f` |

Dos pools ⇒ la misma persona tiene **dos `sub` distintos**. Y del lado del backend hay **una sola fila** `users` con **un solo** `cognito_id`. Con el asesor de dev (`users` 1827080, `a.arismendy@uniandes.edu.co`, `cognito_id = 319b25f0-…`), entrar por staging le manda al backend un `sub` que esa fila no tiene → no lo encuentra → "no tienes un comercio asignado".

**Por qué no alcanza con "crear otra fila".** En `users`, `email`, `document_number` y `cell_phone` son **índices únicos**: no se puede duplicar a la misma persona con el otro `sub`. Pisarle el `cognito_id` a la fila de dev funciona, pero es **excluyente** — mientras esté el de staging, dev deja de andar.

**Solución (aplicada).** Una **cuenta de asesor por pool**, y que todo lo de Cognito sea **por target**:

- `pkg/config.ts` — `loadCognitoCreds()` pasó de `process.env` pelado a la cadena `env()`, así que las credenciales viven en `harness/.env.<target>` (gitignored) en vez de un `.cognito.json` único que habría que pisar para alternar.
- `pkg/cognito.ts` — el cache de sesión pasó de `.auth/cognito-state.json` a `.auth/cognito-state.<target>.json`. **No era cosmético**: el archivo viejo tenía cookies de los **dos** pools mezcladas (`login.creditop.com` **y** `.auth.merchant.creditop.com`), y con un único archivo la sesión de dev se inyecta en la corrida de staging — el front queda autenticado para Cognito y desconocido para el backend, **sin que aparezca el login** que lo corregiría.
- `bin/asesor` — `E2E_ASESOR_SUB` / `E2E_COGNITO_USER` de `.env.<target>` pisan al `asesor` de `.flows.json` (que describe al de dev). Es el `sub` que usa `load-permiso` para el assign.

En dev existe una familia de cuentas QA `oscar+<comercio>@creditop.com`, una por sucursal (`oscar+mediarte` ya está en la 375 de Mediarte, `oscar+dentix` en la 844 de DENTIX). Son las candidatas naturales para el pool de staging.

**Lo que queda abierto.** El `sub` de staging **no se puede deducir offline** (los de ambos pools son UUIDv7, sin nada que los distinga) y el storageState cacheado **no guarda JWT** — solo cookies. Se confirma en el primer login: si el wizard abre el comercio, el `cognito_id` que la fila ya tenía era el de staging; si repite "no tienes un comercio asignado", era del otro pool y hay que leer el real del id_token de esa sesión.

### F-62 · En dev/staging está desplegada solo LA MITAD de la omisión de Experian: aparece el selector, pero nada lo aplica
> **Incidente cerrado** (lo cierra F-63 (PR #988 desplegado)). Crónica completa: `cerrados.md`.

### F-63 · `RKV24027` (dato vigente) corta ANTES que la omisión por flujo — y se lee como si la omisión fallara

**Síntoma.** Con la tarea ya desplegada y el flujo firmado (`flow_id = 2`), dos de las tres variaciones de Experian devuelven `RKV24029` (omitido por flujo) pero la tercera devuelve **`RKV24027`**. Leído como "no todas se omitieron", parece que la omisión funciona a medias. No es así.

**Causa raíz verificada.** Las etapas de `CheckExperianTriggerService` corren en orden, y **"¿ya hay dato vigente para esta central?" (`RKV24027`) se evalúa antes** que la ventana de frecuencia y que la omisión por flujo (`RKV24029`). Si el usuario ya tiene un reporte fresco de esa central, la evaluación corta ahí y **nunca llega** a la etapa del flujo. `RKV24027` también significa "no se consulta" — solo que por otro motivo.

O sea: esa central **no participa de la medición**, no es que falle.

**Cómo leerlo bien.** Los únicos códigos que significan "sí, consultá" son `RKV24000` / `RKV24007` / `RKV24020` / `RKV24021`. Todo lo demás es una razón para no consultar. La prueba de la tarea es el **cambio**: centrales que devolvían uno de esos cuatro **antes** de firmar y devuelven `RKV24029` **después**. Contar como fallo a las que ya venían en `RKV24027` es un falso negativo — fue exactamente el primer veredicto equivocado de `dev/experian-api.ts`, ya corregido.

**Medición real (staging, 2026-07-21, con `91aaad3b` desplegado):**

| central | antes de firmar | después |
|---|---|---|
| `experian-acierta` | `RKV24021` (sí consulta) | **`RKV24029`** ✅ |
| `experian-quanto` | `RKV24021` (sí consulta) | **`RKV24029`** ✅ |
| `experian-acierta-quanto` | `RKV24027` (caché) | `RKV24027` — no participó |

Firma `URV13000`, `flow_id` 1 → 2. **Lo único que cambió entre ambas mediciones fue la firma** ⇒ la omisión de la tarea funciona.

**Cierra F-62:** el PR #988 se mergeó (`91aaad3b`) y se desplegó. La huella del build viejo era `URV13005` al firmar en estado 9; con el nuevo, `URV13000`.

### F-64 · El "Recorrido del wizard" cambiaba de forma según el ambiente — y contra dev salía vacío por un error que el panel se comía
> **Incidente cerrado** (fix aplicado). Crónica completa: `cerrados.md`.

### F-65 · El sembrado headless registraba al cliente en el backend LOCAL aunque el target fuera dev
> **Incidente cerrado** (aplicado). Crónica completa: `cerrados.md`.

### F-66 · El salto headless a `/lenders` "rebotaba" en staging — no era el front ni el estado, era una carrera post-login del harness
> **Incidente cerrado** (RESUELTO y verificado en los tres targets). Crónica completa: `cerrados.md`.

### F-67 · El salto a `/lenders` se colgaba 90s en staging — no era la inserción del sintético, era `domcontentloaded` esperando el stream de pre-aprobaciones
> **Incidente cerrado** (aplicado). Crónica completa: `cerrados.md`.

### F-68 · El guiado AUTO de Motai renting/rto nunca pasaba por Ábaco — lo salteaba el driver del harness, no la des-motaización
> **Incidente cerrado** (aplicado). Crónica completa: `cerrados.md`.

### F-69 · "Advisor validation error" en el `/continue` del asesor para lenders None-identity + Ábaco — un `validated=false` en una validación NO requerida
> **Incidente cerrado** (aplicado). Crónica completa: `cerrados.md`.

### F-70 · La pantalla del asesor (`financial-profile`) muere con `fetch failed` en local — falta el MS financial-health (:4000) → mock que lee la BD real
> **Incidente cerrado** (mock creado). Crónica completa: `cerrados.md`.

### F-75 · El marketplace sale VACÍO si el lender que ofrece la sucursal no tiene `group_rules` propias
> **Graduó** → `motai` — el hecho vive allá; la crónica, en git.

### F-78 · El badge del marketplace lo decide PREAPROBADOS, que le pregunta a OTRO backend — un fix de cupo mergeado en `qa` no mueve la tarjeta
> **Graduó** → `ms-preapprovals` — el hecho vive allá; la crónica, en git.

### F-71 · En CreditOp conviven DOS convenciones de tasa — nominal (el canon) y efectiva (Credifamilia) — y ya divergieron en producción: 1,82 % N.M. vs TEA 28,79 %
> **Graduó** → `creditopx · rotativo` — el hecho vive allá; la crónica, en git.

### F-72 · Tres divergencias entre la calculadora de negocio y el código: el IVA cableado, el 4×1000 que no existe, y una fianza "mensual" que no es un total repartido

Hermana de [F-71](#f-71): ahí eran dos convenciones de **tasa**; acá son dos definiciones del mismo **costo**. Y la trampa es peor, porque las tres divergencias van en la misma dirección — transcribir el `.xlsm` a código **cobra de más**.

**Síntoma.** Al reproducir la fianza de un crédito de salud desde la `Calculadora PV V20251009.xlsm` el valor a financiar sale distinto al que arma el backend, con la misma tarifa y el mismo monto. La diferencia es chica (miles de pesos sobre millones), así que se lee como redondeo y no como tres reglas distintas.

**Causa raíz verificada.** El `.xlsm` y `PaymentCalculationService` modelan la fianza de forma distinta en tres puntos. En lo único que **coinciden** es en la base, y eso importa decirlo para que nadie lo "arregle".

| | `.xlsm` (negocio) | `PaymentCalculationService` (producción) |
|---|---|---|
| **base** | `guaranteeBase = principal + deviceCost`, y `principal` viene de `marginBase = assetCost − downPayment + setupFee` | `($amount + $administrativeCosts)` con `$amount = original_amount − initial_fee` |
| **IVA** | campo aparte (`guaranteeVatRate`); en Alta va en **0** porque el 9,64 % de Novafianza ya lo trae adentro | **cableado al 19 % y multiplicado adentro**: `* (1 + (19 / 100))` |
| **4×1000 (GMF)** | lo **cobra**: `guaranteeTax = (guaranteeCost + guaranteeVat) * 0.004` | **no existe** — ninguna mención en todo `Modules/Loans/App/Services/PaymentSchedule/` |
| **mensualizada** | reparte un **total**: `totalGuarantee * (1 − guaranteeUpfront) / installments` | **% mensual del total financiado**: `guarantee_fixed_monthly_percentage% × totalAmountNoFee`, cobrado en **cada** cuota |

La base **sí coincide**: los dos descuentan la cuota inicial **antes** de calcular la fianza. Es un % de lo que se va a financiar *antes de sumarse ella misma* — ni del monto pedido, ni del valor final (eso sería circular).

La cuarta divergencia es la más peligrosa porque no es un redondeo: **la "fianza mensual" del `.xlsm` y la de producción son mecanismos diferentes.** Un `0,50 %` en `guarantee_fixed_monthly_percentage` a 36 cuotas suma **18 %** del financiado, no 0,5 %.

**Evidencia.**
- `Modules/Loans/App/Services/PaymentSchedule/PaymentCalculationService.php:82-85` → `// IVA hardcoded at 19% — matches monolito business rule.` seguido de `$guarantee = ($amount + $administrativeCosts) * ($inputs['guarantee_fund_percentage'] / 100) * (1 + (19 / 100));`
- `PaymentCalculationService.php:188-197` (`calculateInitialAmount`) → `$amount = $userRequest->original_amount; if ($userRequest->initial_fee > 0) { $amount -= $userRequest->initial_fee; }`
- `PaymentCalculationService.php:100` → `$guaranteePerMillionFixedMonthly = ($inputs['guarantee_fixed_monthly_percentage'] / 100) * $totalAmountNoFee;`
- `grep -rn "gmf\|GMF\|0.004" Modules/Loans/App/Services/PaymentSchedule/` → **sin resultados**.
- `playground/engine/reference/full-sheet.js` (la hoja verificada 30/30 contra los `.xlsm`) → `guaranteeBase` · `guaranteeCost` · `guaranteeVat` · `guaranteeTax` · `monthlyGuarantee`.

**Y el dato que ordena cuál importa.** En la copia local, `lenders_by_allieds` (994 filas):

| columna | comercios | valores |
|---|---|---|
| `guarantee_fund_percentage` (anticipada) | **338** | 5 % a 36,5 % · moda 13 · 15 · 10 · 12 · 14 |
| `guarantee_fixed_monthly_percentage` | **2** (lender 139) | 0,50 % |
| `administrative_costs_percentage` | **225** | — |
| `life_insurance_percentage` | 48 | — |
| `guarantee_insurance_per_million` | 0 | sin uso |

O sea: **la fianza anticipada es el caso real** (338 comercios) y la mensualizada es una excepción de dos filas. Y `administrative_costs_percentage`, que usan **225 comercios**, **entra a la base de la fianza** — cualquier normalización que lo omita calcula la fianza de menos.

**Qué hacer.**
- **Al transcribir un `.xlsm`**, mirar las tres: si el IVA ya viene en la tarifa, el campo va en 0; el GMF probablemente no se cobra; y si la fianza es mensual, confirmar si es un total repartido o un % por cuota — no son lo mismo.
- **Al normalizar**, el `administrative_costs_percentage` no es opcional: es parte de la base.
- **El IVA al 19 % cableado debería ser un dato con fecha**, no una constante en el código: fue 16 % hasta 2017. Misma deuda que el techo de usura.
- Prototipo con las dos bases (neto y bruto) como opción explícita: `playground/engine` — ver su README.

### F-79 · El canal del código de compra está APAGADO desde enero de 2026 — si no ves códigos, no es tu bug

**Síntoma:** vas a ejercitar el código de compra en punto de venta (el PIN que el cliente presenta en caja de Alkosto/K-TRONIX/Alkomprar) y no encontrás casos vivos: ninguna solicitud reciente en el estado que habilita el endpoint, ningún código emitido. Se lee como "el ambiente está mal sembrado" o "rompí algo".

**Causa raíz verificada — el canal dejó de emitir, aunque el tráfico sigue entrando.** Medido sobre la copia local de la BD (dump fresco al **2026-07-30**, o sea NO es falta de datos recientes):

| | |
|---|---|
| `purchase_codes` emitidos por mes | oct-25 **6.605** · nov-25 **9.682** · dic-25 1.905 · ene-26 **18** · feb-26 **3** · mar-26 **5** · abr–jul **0** |
| Solicitudes en estado **25** (`Pendiente de facturación`) con lender 68 | 119 en total, la última de **2026-03**; **cero** desde abril |
| Solicitudes de los retail Corbeta (209/210/211) | **siguen entrando**: mar-26 111 · abr 112 · may 56 · jun 68 |
| Estado **26** (`Facturado`) en toda la historia del dump | **10**, todas entre sep y dic de 2025 |
| Dónde terminan las de 2026 | 99 en estado 9 · **85 Canceladas** · 22 Autorizadas (11) · **0 en estado 25** |

Es decir: los comercios siguen originando, pero el camino ya **no pasa por el estado 25**, que es requisito duro del guard del código (ver F-82). Y el ciclo completo (facturar en caja → estado 26) se cerró 10 veces en total.

**Evidencia adicional:** en el mismo período `ecommerce_requests` sólo tiene filas de **jun-26 (22)** y **jul-26 (4)** → el canal ecommerce unificado es reciente y chico. De las 119 solicitudes en estado 25, **118 no tienen `ecommerce_request`**: son del camino clásico de `application`.

**Qué hacer.** Antes de depurar el código de compra o de sembrar un caso, asumí que **no hay tráfico vivo** y construí el caso a mano por el flujo del QR. Y antes de estimar un reemplazo de proveedor, preguntá **por qué se apagó**: cambiar quién emite el código no arregla un embudo que se corta antes.

**Dónde se corta, afinado (2026-07-31).** No es que las solicitudes no lleguen al estado 25: **llegan con todo listo y no reciben código.** De las 4 solicitudes de mar-26 en estado 25 (todas **Alkosto, allied 209, sucursal 946**), las 4 tienen la secuencia BNPL completa en el flow (`user_request_id`, `bnpl_transaction_id`, `retrieve_quota`, `retrieve_terms`, `acceptance_terms`) pero **sólo 2 tienen fila en `purchase_codes`**. El último código emitido para Alkosto es del **2026-03-02** (279 en total para ese comercio) y la solicitud del **2026-03-13** —la más reciente que alcanzó el estado 25, con `transactionId` presente— **no tiene código ni PIN**. O sea el embudo funciona hasta la puerta del código y ahí muere.

**Por qué la copia local no puede decir POR QUÉ.** Dos límites, los dos verificados:
- La tabla `logs` (donde el cliente de Corbeta escribe `CORBETA - register` / `Corbeta - query`) sólo retiene **2026-06-03 .. 2026-07-19** (1.017 filas) — los casos de marzo quedaron fuera de la ventana. Dato lateral: en esa ventana hay **cero** llamadas a Corbeta logueadas.
- El camino del código **puede fallar sin dejar rastro**: con un HTTP 400 y sin seed de `LenderErrorCode` para `App\Actions\Allieds\Corbeta`, `handleException` retorna `void` y `register()` hace `return $apiResponse` **nunca asignada** → `Error` de PHP 8, que **no es `Exception`** y ningún `catch` de la cadena lo captura (ver el riesgo P1 del handoff). Así que la ausencia de filas en `allied_errors_captures` **no prueba** que no se intentó.

**Lo que sí muestra `allied_errors_captures`** (retiene desde 2026-01-30): **todas** las capturas relacionadas con Corbeta vienen de `CorbetaCheckoutController::show` — la entrada **ecommerce**, no la del código — y con los códigos de los **casos de prueba cableados** (`CORB006`, `BP20755`, `BP20790`, `BP409XXX3`, `BP50020550`, `SP20754`). Concentradas en los primeros días de **junio de 2026**, que es cuando aparecen las únicas 22 filas de `ecommerce_requests`. Lectura: lo que se ejercitó últimamente es el **checkout ecommerce** (probablemente un barrido de QA), no el camino de caja.

**Estado:** el apagado está medido y es reproducible. La CAUSA (comercial, técnica o de flujo) **sigue sin determinar** y no se puede cerrar desde la copia local: hace falta el log de producción de marzo de 2026, o preguntarle a negocio. Quien lo investigue: mirá primero si la llamada a Corbeta explotaba por P1 (fallo silencioso, sin captura).

---

### F-80 · `bnpl_transaction_id` "ausente en el 100 %" es un artefacto de medir sobre el histórico — hoy SÍ se escribe
> **Graduó** → `bancolombia` — el hecho vive allá; la crónica, en git.

### F-81 · El sandbox del *In Store Billing Code* responde 409 a cualquier dato real, y no ejercita la seguridad
> **Graduó** → `bancolombia` — el hecho vive allá; la crónica, en git.

### F-82 · El guard del código de compra está escrito en NEGATIVO y se lee al revés
> **Graduó** → `bancolombia` — el hecho vive allá; la crónica, en git.

### F-83 · El límite de 20 caracteres del `address` de Bancolombia no lo cumple ninguna de las dos fuentes

**Síntoma:** el contrato del *In Store Billing Code* declara `address` con **`maxLength 20`** y lo describe
como "dirección de residencia del cliente". Suena a un detalle de validación; es un bloqueante.

**Medido en la copia local (2026-07-31), las tres fuentes candidatas:**

| Fuente | Filas | Exceden 20 | % | Máximo |
|---|---|---|---|---|
| `allied_branches.address` — **todas** | 1.692 | **1.134** | **67 %** | 134 |
| `allied_branches.address` — sólo Corbeta (24/209/210/211) | 133 | **82** | **62 %** | 86 |
| **Dirección de residencia del CLIENTE** (`fields.id = 44`, «Dirección de Residencia», vía `user_field_values`) | 2.267 | **630** | **28 %** | 90 |

Hoy se manda la de la **sucursal** (`CodeGenerationService` la toma de `alliedBranch->address`), que es
justo la peor de las tres. Y truncar no es una salida: un ejemplo real de Corbeta,
`«Centro comercial mall plaza, Local A1033, Avenida Kevin Angel entre calles 56 y 57G»` (86 chars), queda
en **`«Centro comercial mal»`** — cortado a mitad de palabra e inservible como dirección. Si Bancolombia
usa ese dato para la factura, además hay consecuencia fiscal.

**Lo que esto cierra y lo que abre.** Cierra la duda de magnitud: **no es un caso borde, es la mayoría**.
Abre la pregunta operativa, que es para el banco y no para nosotros: **¿qué hace Bancolombia con una
dirección de más de 20?** ¿Trunca, rechaza con `SA400`, o el campo es informativo? Sin esa respuesta, las
tres opciones (truncar, mandar la del cliente, mandar la de la sucursal) son igual de arbitrarias.

**Dato lateral útil:** existir un campo propio para la dirección del cliente **con el flujo Bancolombia
como razón de ser** (el field 44 se usa en su aceptación de términos, y el diccionario lo describe "sin
acentos, sin símbolos") es indicio de que el banco espera la del cliente, no la del punto de venta.
Indicio, no confirmación.

**Estado:** medido y reproducible. La decisión depende del banco.

---

### F-84 · El `Message-Id` fijo de no-producción SÍ es un UUID v4 válido (y el que no lo es está comentado)
> **Graduó** → `bancolombia` — el hecho vive allá; la crónica, en git.

### F-85 · Por el canal ASESOR un comercio Corbeta no cierra ahí: entrega el crédito al celular del cliente
> **Graduó** → `bancolombia` — el hecho vive allá; la crónica, en git.

### F-86 · El regreso de una pantalla externa no se puede deducir del `document.referrer`: cross-origin el browser manda sólo el origen

**Síntoma:** en el canal QR, después de la pantalla de autenticación simulada de Bancolombia (mock :8104),
el cliente aterrizaba en **`/login`** — el login de **asesor** (Cognito) — dentro de un canal que es
autogestión pura. La traza del run:

```
05 A /bancolombia/bnpl/start/JNDDQZFECD
06 A /_login-simulado
07 A /login        ← acá no debería estar nunca
```

**Hipótesis descartadas (verificadas contra `origin/main`):**

| se sospechó | se comprobó |
|---|---|
| `loan-info` exige sesión | `layouts/bancolombia/origination-layout.tsx` no tiene loader ni sesión ni redirect |
| el loader manda a login | `GET /bancolombia/bnpl/loan-info/{code}?code=…` responde **200 sin sesión** |
| algún redirect a `/login` en la ruta | en TODO el monorepo sólo hay 3 (`backoffice/logout`, `auth/callback`, y el action de `personal-info`), ninguno alcanzable desde ahí |

**Causa raíz:** el harness deducía el destino de regreso transformando `document.referrer`
(`/start/` → `/loan-info/`). Pero el wizard vive en `:5174` y el mock en `:8104`: **son orígenes
distintos**, y la política default del browser (`strict-origin-when-cross-origin`) recorta el referrer a
**`http://localhost:5174/`, sin path**. El `replace('/start/', …)` no encontraba nada, el destino quedaba
en `/` — y **`/` → 302 `/merchant` → `/login`** (verificado con `curl -D -`). El `/login` no era una falla
del flujo de Bancolombia: era el wizard haciendo lo correcto con una URL raíz.

Ojo con el diagnóstico: el referrer **no llegaba vacío**, llegaba *truncado*. Por eso el guard
`if (!ref)` no saltaba y no había ningún error — sólo un destino silenciosamente equivocado.

**Arreglo:** el retorno se **registra**, no se adivina. El mock expone `POST /_control/retorno {url}` y el
harness se lo dice en cuanto la URL del wizard muestra `/bancolombia/{tipo}/start/{encryptCode}` — ahí
están el código y el producto, exactos. El referrer queda sólo como respaldo y **únicamente si trae
`/start/`**; sin destino conocido la página ya no navega a ninguna parte, avisa.

**Regla general:** cualquier mock que sirva una pantalla en su propio puerto y tenga que devolver el
control al front está en esta situación. El referrer sirve para *loguear*, no para *navegar*.

---

### F-87 · `bin/mock-* start` reusaba el proceso viejo: editabas el mock y seguía sirviendo la versión anterior
> **Incidente cerrado** (resuelto — los mocks nuevos publican huella de código). Crónica completa: `cerrados.md`.

### F-88 · El front valida cada respuesta del banco con zod, y el runner por consola no lo veía: dos verdes que no se cruzaban
> **Graduó** → `bancolombia §pantallas` — el hecho vive allá; la crónica, en git.

### F-89 · El regreso del banco tiene UNA sola URL y es un despachador: `/bancolombia/{tipo}/redirect`

**Síntoma:** con el retorno apuntado a `loan-info` el primer salto al banco volvía bien, pero el
**segundo** —la clave dinámica al firmar— dejaba al cliente parado en la página del banco.

**Causa raíz (verificada):** el recorrido sale al banco **dos veces** (autenticación al empezar, clave
dinámica al firmar) y el wizard tiene una ruta dedicada para el regreso:
`routes/bancolombia/bnpl/redirect.tsx` y su gemela `loan/redirect.tsx` (`routes.ts:197` y `:220`). Su
`clientLoader` lee la sesión del cliente y decide solo:

```
step === 'session'      → loan-info/{code}?code=…      (ecommerce → ecommerce-loan-processing)
step === 'dynamic_key'  → processing/{code}?code=…      (ecommerce → payment-success, y antes POSTea origination)
(fallback)              → loan-info/{code}?code=…
```

Que ese despachador exista **es la evidencia de que el banco vuelve siempre al mismo sitio**: si el
proveedor pudiera volver a una pantalla distinta por paso, no haría falta. Apuntar el retorno a una
pantalla concreta funciona por casualidad en el primer salto.

**Arreglo:** el harness registra `/bancolombia/{bnpl|consumo}/redirect?code=…` y deja que el wizard rutee.
Sirve para los dos saltos y para los dos productos sin conocer el paso.

**Estado:** verificado en BNPL (los dos saltos). Ver también F-86 (por qué el retorno se registra en vez de
deducirse del referrer).

---

### F-90 · Las perillas de falla del mock eran GLOBALES: cualquier error terminaba en `no-preapproved`, no en la pantalla de error
> **Graduó** → `bancolombia §pantallas` — el hecho vive allá; la crónica, en git.

### F-91 · Un error de NEGOCIO del banco cancela la solicitud y le dice al cliente «intenta de nuevo» — y `business-error` no existe para autogestión
> **Graduó** → `bancolombia §pantallas` — el hecho vive allá; la crónica, en git.

### F-92 · Un 401 del gateway de Bancolombia no trae `errors` → revienta DENTRO del manejador de errores

**Síntoma:** una integración Bancolombia con credencial mal aprovisionada no falla con un error de negocio legible: tira un `Error` de PHP 8 (`Undefined array key "errors"`) **desde el propio `catch`**, así que el mensaje que llega arriba no habla de credenciales.

**Causa raíz verificada.** `Bancolombia::getRequestExceptionCode()` (`app/Actions/Lenders/Bancolombia.php:27`) accede por índice directo:

```php
return $exception->response->collect()['errors'][0]['code'];
```

Todos los errores **de negocio** del banco traen `errors[]` (`SA400`, `BP21000`, `BP12700001`, `SP500`…), así que el acceso parece seguro. Pero el **401 lo emite el gateway, no el servicio**, y su cuerpo tiene otra forma —comprobado contra `gw-sandbox-qa` el 2026-08-04:

```json
{"httpCode":"401","httpMessage":"Unauthorized","moreInformation":"Invalid client id or secret."}
```

Sin `errors`, `['errors'][0]['code']` lanza. Y como lo llama `Integration::handleException()` (`app/Actions/Lenders/Integration.php:82`), la excepción nace **dentro del manejador**: no la atrapa ningún `catch` de la cadena.

**No es teórico:** de las 4 credenciales Bancolombia distintas que hay en `lender_allied_credentials` (lenders 68/100), **sólo una** (#1124, `application_name = creditop`) está aprovisionada en el sandbox; las otras tres —incluida la de los 167 comercios `creditop-bnpl`— dan 401. Cualquiera de ellas contra ese host pega el camino roto.

**Qué hacer.** `?? null` en el acceso (`['errors'][0]['code'] ?? null`), y que el `null` se trate como "código desconocido". `BancolombiaBillingCode` **no** está afectado: atrapa `\Exception` directo y su `traceFailure()` ya contempla la respuesta sin forma esperada. Los afectados son `BancolombiaConsumerLoan` y `BancolombiaBnpl`, que sí pasan por `handleException`.

**Estado:** verificado el 2026-08-04 llamando al sandbox con `Client-Id` y `Client-Secret` inválidos. Relacionado: F-81.

---

### F-93 · `displayed_lenders` no es una tabla: es una columna JSON de `profiling_reviews`
> **Graduó** → `profiling` — el hecho vive allá; la crónica, en git.

### F-94 · El webhook `lender-result` no deja huella de recepción: «no llegó» y «llegó y falló» se ven igual
> **Graduó** → `aggregator §la vuelta` — el hecho vive allá; la crónica, en git.

### F-95 · El `response_type` de un lender cambia según el ambiente: verificarlo contra local miente
> **Graduó** → `entities · creditop §invariante 8` — el hecho vive allá; la crónica, en git.

### F-96 · `user_request_records` repite estados y no es cronológico: «la última fila» puede ser anterior al resto

**Síntoma.** Dos problemas que aparecen juntos al reconstruir el historial de una solicitud:

1. El "historial" muestra el mismo estado muchas veces seguidas, así que **contar filas miente** sobre cuántas veces avanzó el flujo.
2. Ordenando por `created_at`, **la última fila puede tener una hora anterior** a otras etapas del flujo. Una línea de tiempo armada así se lee como que la solicitud fue hacia atrás.

**Causa raíz verificada.** La tabla escribe **una fila por cada toque**, no por cada transición: si algo actualiza la solicitud cinco veces sin cambiarle el estado, quedan cinco filas iguales. Y las filas **no están garantizadas en orden de flujo** — hay solicitudes con el estado final registrado antes que estados intermedios (reutilización, backfill, o escrituras fuera de secuencia; no se determinó cuál).

**Evidencia.** La uReq 464168 tiene **cinco filas consecutivas de estado 9** («Formulario de perfil») entre 22:35 y 23:04. Y la uReq 464432 (staging) tiene el estado 8 «Cancelado» registrado a las 10:38 mientras el estado 3 «Seleccionó entidad» está a las 16:29 — el desenlace **antes** de la selección.

**Arreglo.** Dos cosas, y las dos hacen falta:

- **Colapsar estados consecutivos repetidos** al leer el historial. Sin eso, cualquier métrica de "cuántos pasos dio" está inflada.
- **No usar «la última fila» como el evento más reciente.** Si se necesita cuándo ocurrió un estado puntual, buscar ese estado; y si las horas de las etapas no son monótonas, **avisarlo** en vez de reordenar por hora — reordenar esconde el dato y pone la etapa en el lugar equivocado del flujo.

**Estado:** verificado el 2026-08-05 contra dev y staging. Implementado en `playground/trazador` (colapso + aviso de no-monotonía).

---

### F-97 · La BD guarda el documento FINAL, los logs guardan todos los intentos: buscar por cédula puede no encontrar
> **Graduó** → `kyc` — el hecho vive allá; la crónica, en git.

### F-98 · Sin `GRAFANA_TEMPO_ENDPOINT` los logs no llevan `trace_id` — y el span lo abre un middleware con alias, no global

**Síntoma.** Los logs llegan a Loki correctamente pero **sin `trace_id`**, así que no se pueden agrupar las líneas de una misma petición: una traza queda como una lista plana de eventos sueltos. Y en el camino contrario, un `php artisan tinker` que loguea a propósito tampoco lleva trace, lo que hace pensar que la instrumentación está rota.

**Causa raíz verificada.** Son **dos condiciones independientes** y las dos tienen que cumplirse:

1. **El processor que estampa el trace solo se registra si Tempo está habilitado.** `app/Providers/GrafanaServiceProvider.php::configureLogging` envuelve el `pushProcessor` en `if (config('grafana.tempo.enabled'))`, y ese processor es el único que escribe `$record->extra['trace_id']`. Además `initializeOpenTelemetry()` arranca con `if (!$endpoint) { return; }` — **sin `GRAFANA_TEMPO_ENDPOINT` el SDK de OpenTelemetry nunca se inicializa**, así que no hay span y `Span::getCurrent()` no está grabando.
2. **El span de la petición lo abre `App\Http\Middleware\OpenTelemetryMiddleware`**, que está registrado como **alias `'otel'`** en `app/Http/Kernel.php:68` — **no es global**. Una ruta que no lo declare no tiene span, y por lo tanto sus logs no llevan trace aunque Tempo esté configurado. Y nada que corra fuera de una petición HTTP (comandos de artisan, crons, colas) tiene span nunca.

**Evidencia.** Verificado el 2026-08-05 con un Tempo local en Docker: con `GRAFANA_TEMPO_ENABLED=true` y `GRAFANA_TEMPO_ENDPOINT=http://…:4318/v1/traces`, un `Log::channel('loki')` desde `tinker` sale **sin** trace, y una petición a `POST api/onboarding/loan-application/update-user-request/{id}` —que sí tiene el middleware, comprobado con `artisan route:list`— sale **con** un trace de 32 hex, recuperable después en Tempo (`GET /api/traces/<id>` → 200, span `POST api/onboarding/phone/register`).

**Arreglo.** Para que los logs sean agrupables hacen falta las dos cosas: el endpoint de Tempo configurado **y** que la ruta pase por el middleware `otel`. El sampler es `AlwaysOnSampler` mientras `grafana.sampling.rate` sea ≥ 1.0 (el default), así que el muestreo no hay que tocarlo.

**El detalle que cuesta una hora.** El endpoint lleva el path: `…:4318/v1/traces`. `OtlpHttpTransportFactory->create($endpoint, …)` usa la URL tal cual y **no le agrega la ruta**, así que con solo `http://host:4318` el `trace_id` igual aparece en los logs (el span existe) pero las trazas se van a un 404 — funciona a medias y no avisa.

**Estado:** verificado el 2026-08-05 contra un Tempo local.

---

### F-99 · `LOG_CHANNEL=stack` en local puede romper el request: el canal incluye `dynamodb` con `ignore_exceptions => false`

**Síntoma.** Se quiere ver los logs de la app en local, se pone `LOG_CHANNEL=stack` (que es el canal que incluye Loki) y empiezan a fallar peticiones que antes andaban.

**Causa raíz.** En `config/logging.php` el canal `stack` es `['dynamodb', 'loki']` con **`'ignore_exceptions' => false`**. El canal `dynamodb` usa el `DynamoDbHandler` de Monolog contra la tabla `inertia_logs`, con un `new DynamoDbClient([...])` construido **dentro del array de configuración**. En local no hay credenciales de AWS, así que ese handler falla — y con `ignore_exceptions` en `false` la excepción **no se traga**: se propaga desde la llamada a `Log::`.

**Evidencia.** Leído en `config/logging.php` (canal `stack` y canal `dynamodb`) el 2026-08-05. ⚠ **La consecuencia no se probó**: al detectar la configuración se eligió `LOG_CHANNEL=loki` para evitarla, así que "rompe el request" es la lectura del código, no una observación. La configuración sí está verificada.

**Arreglo.** En local usar `LOG_CHANNEL=loki` (un solo destino, el único que existe ahí). Si se quieren archivo **y** Loki, hay que agregar un canal a `config/logging.php` — archivo versionado del repo de la compañía. En los ambientes desplegados `stack` funciona porque sí hay credenciales de AWS.

**El dato de contexto.** En producción la etiqueta `channel` de Loki tiene **dos** valores (`loki` y `production`), o sea que allá llegan logs por más de un canal — consistente con que `stack` esté activo.

**Estado:** configuración verificada el 2026-08-05; la consecuencia es inferida del código y está sin comprobar.

---

### F-100 · `profiling_reviews.disbursed_lender` tiene TRES escritores: verlo lleno no prueba que llegó un webhook
> **Graduó** → `formalization` — el hecho vive allá; la crónica, en git.

### F-101 · `risk_centrals` mezcla dos momentos del flujo: leerla como «la lista de burós» pone ADO en la etapa equivocada
> **Graduó** → `kyc` — el hecho vive allá; la crónica, en git.

### F-102 · Sólo el 13 % de las líneas de log dice a qué solicitud pertenece, y lo dice con tres nombres distintos
> **Graduó** → `architecture §observabilidad` — el hecho vive allá; la crónica, en git.

### F-103 · Una solicitud TRABADA no está «rota» en la BD: sigue en curso, y el estado 10 no significa que el desembolso ocurrió
> **Graduó** → `creditop §invariante 4 · trazador` — el hecho vive allá; la crónica, en git.

### F-104 · El perfilador ML nuevo NUNCA corre en producción (falta la env), y el viejo lleva caído desde el 2026-08-05
> **Graduó** → `profiling §orden del listado` — el hecho vive allá; la crónica, en git.

### F-105 · `user_request_records` NO registra todas las transiciones: los estados 1 y 10 nunca dejan fila
> **Graduó** → `creditop §invariante 4 · trazador` — el hecho vive allá; la crónica, en git.

### F-106 · La fila de estado 9 en `user_request_records` se escribe al CREAR la solicitud: no prueba que el formulario se completó
> **Graduó** → `creditop §invariante 4 · trazador` — el hecho vive allá; la crónica, en git.

### F-107 · El vínculo buró↔solicitud NO es un hecho: lo calcula un stored procedure POR FECHA, y sólo cuando alguien lo corre a mano
> **Graduó** → `db-routines` — el hecho vive allá; la crónica, en git.

### F-108 · Hay 14 tablas de LOG en la BD que ninguna herramienta lee — pero sólo 2 sirven para atar a una solicitud
> **Graduó** → `db-routines · deceval` — el hecho vive allá; la crónica, en git.

### F-109 · El «solo lectura» del `-sql` del trazador dependía del motor, no de su guarda: `INTO OUTFILE` pasaba
> **Graduó** → `trazador` — el hecho vive allá; la crónica, en git.

### F-110 · El rotativo (rt=3) NO usa categorías: calcula un PLAZO MÍNIMO y por eso «desaparecen» las cuotas parametrizadas

**Síntoma.** Negocio parametriza los plazos de un comercio —por ejemplo 1, 3 y 6 cuotas— y al cliente le
aparece **sólo la más larga**. Se lee como un error de configuración y no lo es. Reportado en #tech-ops
el 2026-08-03 por **dos personas distintas en el mismo día** («solo le sale a 6 cuotas cuando está
parametrizado a 1, 3 y 6» · «este cliente lo quería a 3 pero quedó a 1»), lo que lo vuelve un patrón y
no un caso.

**Causa raíz** (verificada en código, y confirmada por la dueña de política). El rotativo **no pasa por
el motor de categorías** de rt=2. Tiene su propia cadena en
`application/app/Services/lenders/RevolvingLoanConfigService.php`, y el paso 8 dice literal:

```php
//8. Calcular el plazo mínimo. Dividir el cupo aprobado por la capacidad de pago.
$min_fee_number = ceil($available_amount / $payment_capacity) + 1;
```

O sea: **el plazo mínimo se CALCULA a partir del cupo y la capacidad de pago**, y recorta por abajo las
opciones que el comercio dejó configuradas. Si el cupo aprobado son 6 veces la capacidad mensual, el
mínimo da 6 y las de 1 y 3 desaparecen. El enganche y el FGA, en la misma función, salen de
`creditop_x_profiling_down_payments_fga` por **`multiplier_risk`**, no por categoría.

**Evidencia.** El hilo de #tech-ops del 2026-08-03: *«Rotativo NO tiene categorías»* · *«esas
condiciones se manejaron con reglas duras»* · *«la política de rotativo es estándar para todos, y
dependiendo del riesgo puede arrojar un plazo mín, por eso se le acota»* · *«pero estaba revisando y no
lo pueden ver en redash»*. Y el código: `RevolvingLoanConfigService.php:64` (ingreso), `:73` (gastos),
`:77` (capacidad), `:80` (multiplicador), `:86` (multiplicador ≤ 3 ⇒ rechazo), `:90-93` (cupo capado por
`lenders.max_rev_credit` y redondeado de a 50.000), `:95` (el plazo mínimo), `:99-104` (enganche/FGA por
`multiplier_risk`).

⚠ **Y por qué no se puede diagnosticar con los datos**: ni el multiplicador ni la capacidad de pago se
persisten, y el multiplicador lo calcula `FN_CreditopX_Revolving_Credit_Multiplier` — una función
almacenada **sin fuente en ningún repositorio** (ver el nodo `db-routines`). La frase «no lo pueden ver
en redash» no es una queja: es una consecuencia estructural.

**Arreglo.** Documental, aplicado: el nodo `creditopx` afirmaba que rt=2 y rt=3 comparten «el motor de
categorías» — falso para rt=3, corregido con la fórmula completa. Del lado del producto no se propone
nada: que el plazo mínimo se calcule puede ser exactamente lo que riesgo quiere. Lo que faltaba era que
estuviera escrito, para que soporte no lo persiga como un error de parametrización.

**Estado:** verificado el 2026-08-07 contra el código de `main`. **No verificado**: si el recorte ocurre
en el backend o si el front además filtra; y si `min_fee_number` se persiste en `revolving_credits`
(la columna existe en tres modelos).

⚠ **La lección de método**: esta regla no estaba en el código de forma legible ni en ningún doc — estaba
en la **respuesta de una persona en un hilo de soporte**. Las preguntas de #tech-ops son un detector de
huecos de documentación: cuando alguien pregunta «¿por qué el sistema hizo X?», la respuesta suele ser
una regla de negocio que nadie escribió.

---

### F-111 · El webhook de Prami ata SÓLO por `order_id` y con `firstOrFail()`: si no matchea, la solicitud se queda en «Seleccionó entidad» para siempre

**Síntoma.** «Aprobado por Prami / el cliente ya firmó, pero en CreditOp sigue en *Seleccionó entidad*».
Reportado **seis veces en una semana** en #tech-ops (2026-08-01 al 2026-08-04, cuatro personas
distintas). Se ve idéntico a «el agregador no llamó», y no lo es: el agregador llamó y CreditOp descartó
la llamada.

**Causa raíz** (verificada en código; el diagnóstico original lo dio un dev en el hilo del 2026-08-02).
`legacy-application/app/Http/Controllers/Api/PramiController.php:39-42`:

```php
$transaction = LenderTransaction::query()
    ->where('lender_id', $lender->id)
    ->where('order_id', $request->validated('order_id'))
    ->firstOrFail();      // ← si el order_id no matchea, LANZA y no se actualiza nada
```

El único vínculo es el `order_id`. **No hay respaldo por cliente, documento ni solicitud.** Si el
cliente cotizó dos veces —o si el `order_id` que devuelve Prami no es el de la cotización guardada—
`firstOrFail()` corta la transacción entera y la solicitud queda intacta. Textual del hilo: *«hay dos
solicitudes desde Prami, pero ninguno de los `order_id` que llega coincide con la solicitud del cliente
… por esta razón nunca se actualiza»*.

**Y dos cosas más que el mismo código revela:**

1. **De acá salen los estados 7 y 20** — los que ninguna etapa del trazador mapeaba (F-105/F-106 los
   dejaron como hueco). El webhook traduce el estado del agregador al nuestro (`:51-56`):
   `No_Completado`→**7** «No terminó proceso» · `Rechazado`→**6** «Negada» ·
   `Aprobado`→**20** «Aprobada no desembolsada» · `Originado`→**11** «Autorizada».
   Mismo mapeo en `MeddipayController.php:61`. O sea que **7 y 20 son estados de AGREGADOR**, no del
   flujo in-platform: por eso no aparecían en el recorrido de rt=2.
2. **El webhook PISA el monto**: `'final_amount' => $request->amount` (`:59`). Si hubiera matcheado, el
   valor de la solicitud pasaba a ser el que manda Prami — y en el caso del hilo diferían ($799.000 del
   webhook contra $918.900 de la solicitud). Cuando el `order_id` no matchea, esa discrepancia queda
   invisible; cuando matchea, gana el agregador sin avisar.

⚠ Y el lender se resuelve por **nombre**: `Lender::where('name', 'Prami')->firstOrFail()` (`:37`).
Renombrar la entidad en el admin rompe el webhook entero, en silencio. Es el anti-patrón 3 de
`hardcodes-entidades`.

**Evidencia.** El código citado. El hilo de #tech-ops del 2026-08-02 con el diagnóstico del dev, y seis
reportes del mismo síntoma entre el 2026-08-01 y el 2026-08-04 (Prami ×4, Welli ×1, y uno de firma).

**Arreglo.** Ninguno propuesto: el fallback correcto —¿buscar por cliente? ¿por la última transacción
pendiente?— es una decisión de negocio, porque elegir mal ataría el resultado a la solicitud equivocada.
Lo que faltaba era saber que el síntoma «se quedó en seleccionar entidad» tiene **dos causas
indistinguibles desde la BD**: el agregador no llamó (F-94), o llamó y el `order_id` no matcheó (ésta).

**Estado:** verificado el 2026-08-07 contra `main`. **No verificado**: con qué frecuencia falla el match
en producción — el webhook no deja registro cuando `firstOrFail()` lanza, así que no se puede contar.
Ése es justamente el motivo por el que se ve como si el agregador no hubiera llamado.

---

### F-112 · La compuerta de capacidad de endeudamiento NO mira los gastos que declara el cliente, y viene APAGADA por defecto
> **Graduó** → `profiling` — el hecho vive allá; la crónica, en git.

### F-113 · Credifamilia devuelve «APROBADO» con datos VACÍOS cuando la entrada es inválida, y nuestro código lo acepta como pre-aprobado
> **Graduó** → `credifamilia` — el hecho vive allá; la crónica, en git.

### F-114 · El cupo rotativo se calcula DOS veces con motores distintos: el que se muestra no es el que se otorga
> **Graduó** → `db-routines · rotativo` — el hecho vive allá; la crónica, en git.

### F-115 · Un rechazo de cupo rotativo no deja NINGÚN rastro: ni log, ni fila, ni estado
> **Graduó** → `rotativo` — el hecho vive allá; la crónica, en git.

### F-116 · `ctop_debt` descarta las cuotas de los créditos CreditopX por precedencia de `??` en PHP
> **Graduó** → `rotativo` — el hecho vive allá; la crónica, en git.

### F-117 · Sin fuente de continuidad laboral, el rotativo castiga con 0 puntos — peor que el peor cliente
> **Graduó** → `rotativo` — el hecho vive allá; la crónica, en git.

### F-118 · `category_rules_acceptance`: una clave AUSENTE no es un criterio que pasó, y la misma regla tiene dos grafías
> **Graduó** → `profiling · trazador` — el hecho vive allá; la crónica, en git.

### F-119 · `loan_limit` es un cupo «mensual» que nunca se reinicia: la categoría desaparece sola y sin aviso
> **Graduó** → `profiling (y el ejemplo canónico de Confluence-contradicha en context/CLAUDE.md)` — el hecho vive allá; la crónica, en git.

### F-120 · Un documento CE en el lender 84 SALTA todo el motor de reglas y recibe una categoría fija
> **Graduó** → `hardcodes-entidades` — el hecho vive allá; la crónica, en git.

### F-121 · El pagaré es un PDF congelado y el cliente es una referencia viva: pueden decir personas distintas, y nada lo detecta
> **Graduó** → `deceval` — el hecho vive allá; la crónica, en git.

### F-122 · El mismo guard de Deceval usa `||` en un repo y `&&` en el otro: en `legacy-application` NUNCA detecta un rechazo
> **Graduó** → `deceval` — el hecho vive allá; la crónica, en git.

### F-123 · El árbol describía 5 repos mientras producción corría 14 servicios
> **Graduó** → `microservicios (+ tools/roots.py)` — el hecho vive allá; la crónica, en git.

### F-124 · El teléfono con prefijo NO estaba corrupto: E.164 es lo correcto. La hipótesis de «acumula prefijos» la refutó el dato
> **Incidente cerrado** (la hipótesis se refutó: era ruido de pruebas en producción). Crónica completa: `cerrados.md`.

### F-125 · «¿Este comercio es Corbeta?» tiene CUATRO respuestas distintas — no cites una lista única

- **Síntoma:** un comercio entra al flujo Corbeta por una puerta y no por otra; o una consulta/doc asume
  `[24,209,210,211,311]` y los números no cuadran con lo que hace el código.
- **Causa raíz (verificada 2026-08-08):** no existe UNA lista de allieds «Corbeta» — hay al menos cuatro
  que DIVERGEN: `settings.corbeta_allieds` (BD, dump de dev) = `[24,209,210,211]` **con DOS filas
  duplicadas de la misma key** (id 21 y 26); el cutover/redirect ecommerce del monolito agrega el 311
  (Kalley), hardcodeado en `Customer/WoocommerceController` + `Api/BancolombiaController` +
  `Api/EcommerceReplayController` de `application`; `User.php` en AMBOS repos usa `[209,210,211]` **sin
  el 24**; y `BancolombiaBnpl.php:387` (`$aliadosConPrefijo`) tiene 8 ids.
- **Evidencia:** `SELECT id,code,`key`,value FROM settings WHERE `key` LIKE '%corbeta%'` (2 filas) +
  grep de los cuatro literales con archivo:línea. La tabla completa: nodo `corbeta` §gate.
- **Arreglo:** no hay uno único — al razonar pertenencia, mirá la lista del SITIO exacto que ejecuta.
  Deuda: unificar todo en el setting y borrar la fila duplicada.
- **Estado:** trampa viva.

### F-126 · Reversar un pago RETENIDO revienta: el código busca «PAGO REVERSADO» y la fila se llama «REVERSADO»

- **Síntoma:** desde el admin de cartera, reversar un pago tira **500** (`Attempt to read property "id"
  on null`). Reversar otros pagos del mismo crédito funciona, así que se lee como intermitente.
- **Causa raíz (verificada 2026-08-08):** `application/app/Http/Controllers/Admin/CreditopXPaymentController.php:1387`
  resuelve el tipo con `CreditopXPaymentType::where('name', 'PAGO REVERSADO')->first()->id`, pero en
  `creditop_x_payment_types` **la fila se llama `REVERSADO`** (id 8). `first()` devuelve `null` y el
  `->id` es fatal. No hay `try` que lo cubra: el `catch` del método envuelve más abajo.
- **Por qué parece intermitente:** la línea vive dentro de la rama `if ($payment->paymentType->name == 'RETENIDO')`
  (`:1377`), o sea **solo los pagos que entraron ANTES de la fecha de corte y todavía no se aplicaron**.
  Las otras dos ramas —ya aplicado (`:1396`) y ya reversado (`:1387`)— no tocan el catálogo y andan bien.
- **Evidencia:** `SELECT id,name FROM creditop_x_payment_types WHERE name LIKE '%REVERSAD%'` → una sola
  fila, `8 · REVERSADO`. Y `SELECT payment_type_id, COUNT(*) FROM creditop_x_payments GROUP BY 1` da
  **56 pagos en `payment_type_id=1` (RETENIDO)** en el dump local: el camino es alcanzable, no teórico.
- **Arreglo:** cambiar el literal a `'REVERSADO'` — o mejor, resolver por id contra una constante, que es
  lo que evita que el próximo rename de una fila de catálogo tumbe un flujo de plata.
- **Estado:** vivo en `main` de `legacy-application`. No aplicado: es un repo de la compañía.

### F-127 · La calculadora «por comercio» escribe dos tablas GLOBALES del lender: los comercios se pisan, y a rt≠2 se las borra

- **Síntoma:** un comercio configura el fondo de garantía o el método de pago de una entidad, y al rato
  «se le cambió solo» — o directamente desapareció. Otro comercio tocó la misma entidad, o alguien
  guardó esa pantalla en una entidad que no es rt=2.
- **Causa raíz (verificada 2026-08-08):** la pantalla es
  `admin/aliados/{allied}/entidades/{lendersByAllied}` —por comercio— pero
  `application/app/Http/Controllers/Admin/AlliedLenderController.php:254` y `:265` hacen
  `LenderGuaranteeCriteria::where('lender_id', …)->delete()` y
  `PaymentMethodsByLender::where('lender_id', …)->delete()`. **Ninguna de las dos tablas tiene columna
  de comercio**: en BD son `lender_id` + payload, o sea configuración GLOBAL de la entidad. La UI
  promete por-par y el esquema es por-entidad.
- ⚠ **CORREGIDO 2026-08-09 con contexto de negocio + medición.** La primera versión decía «51 comercios
  en riesgo» y **sobreestimaba el daño**. En CreditopX el lender es la **marca blanca del comercio**
  (Pullman → CrediPullman), así que casi siempre lender y comercio son 1:1 y «global por lender» ES
  «por comercio»: medido, **71 de los 74 lenders rt=2 están en UN solo comercio**. El daño 1 solo
  aplica a las **3 excepciones** que sí comparten: `Crediteame` (3 comercios), `DENTIX FINANCIAL
  SERVICES` (2) y una más. El daño 2 no depende de eso y aplica siempre.
- **Dos daños distintos:**
  1. **Pisada entre comercios — solo en los lenders compartidos.** Gana el último que guarde. Con el
     modelo 1:1 no pasa; con `Crediteame` y `DENTIX`, sí.
  2. **Borrado sin reposición** — el `delete()` corre siempre, pero el `create()` está condicionado a
     `$lendersByAllied->lender->response_type == 2` (`:255`, `:266`). Guardar la calculadora de un
     lender rt≠2 **borra y no repone**. Hay **1 fila de garantía viva de un lender rt=3**.
- **Evidencia:** `SHOW COLUMNS FROM lender_guarantee_criteria` y `… payment_methods_by_lender` → solo
  `lender_id`, sin `allied_id`. `SELECT l.response_type, COUNT(*) … GROUP BY 1` → garantía: 54 en rt=2
  y **1 en rt=3**; métodos de pago: 69, todos rt=2.
- **Arreglo:** es decisión de diseño, no parche — o las tablas ganan `allied_id` (y la config pasa a ser
  por par, como sugiere la pantalla), o la pantalla deja de ofrecerlas por comercio (y pasa a la ficha
  de la entidad, como dice el esquema). Mientras tanto: acotar el `delete()` y sacar el `rt == 2` de la
  condición de recreate, que es el que destruye datos.
- **Estado:** vivo en `main` de `legacy-application`. No aplicado: es un repo de la compañía. **Es
  material obligatorio para quien construya el panel nuevo de configuración** (→ `merchants` §9).

### F-128 · «Lo que recibe el comercio» se calcula con DOS bases distintas según la pantalla, y difieren en el 38 % de las solicitudes

- **Síntoma:** un comercio ve dos cifras distintas del neto que le queda por el mismo crédito según
  desde qué pantalla lo mire. Nadie lo reporta como bug porque cada pantalla es internamente coherente.
- **Causa raíz (verificada 2026-08-09):** la comisión sale de un único accessor,
  `application/app/Models/UserRequest.php:125` (`getCommissionValueAttribute`) =
  `(comission_percentage / 100) × final_amount`. Pero al restarla, las vistas no usan la misma base:
  - `resources/js/components/requests/RequestInfoCard.vue:187` → `final_amount - commission_value`
  - `resources/js/pages/customer/requests/ResponseRequestRegistration.vue:44` → `final_amount - commission_value`
  - `resources/js/pages/customer/corporate/requests/RequestsTable.vue:670` → **`amount - commission_value`**

  `amount` y `final_amount` **no son lo mismo**: `final_amount` es capital + administración **sin** el
  fondo de garantía (`PromissoryNoteService::calculateAmounts`), y `amount` sí lo incluye porque es la
  base de las cuotas (→ `formalization`).
- **Evidencia:** `SELECT COUNT(*), SUM(amount<>final_amount) FROM user_requests WHERE final_amount>0`
  → **30.749 de 81.877 difieren (38 %)**, con una diferencia promedio de ~79.482 y casos en las dos
  direcciones (uReq 412384: `amount` 2.000.000 vs `final_amount` 500.000).
- **Por qué importa más de lo que parece:** el comercio es **el cliente que decide** y en CreditopX es
  **quien puso el capital** (→ `negocio`). La cifra en discusión es exactamente cuánto le vuelve.
- **Arreglo:** definir cuál es la base correcta —es decisión de negocio, no de código— y dejar UNA
  fuente. Hoy ni siquiera hay un método que devuelva «neto del comercio»: la resta se hace en el
  template, tres veces.
- **Estado:** vivo en `main` de `legacy-application`. No aplicado: es un repo de la compañía.

### F-129 · El único cálculo de comisión del código es una tabla de 40 tramos hardcodeada dentro de un export, y falla ABIERTO (comisión cero) fuera de su rango

- **Síntoma:** la comisión de un crédito Corbeta sale en cero, o sale con valores viejos después de
  renegociar el acuerdo comercial. No hay error: la celda simplemente trae 0.
- **Causa raíz (verificada 2026-08-09):** `application/app/Exports/UserRequestsCorbetaExport.php:38`
  define un JSON con **40 tramos** (1.000.000 → 40.000.000, uno por millón) y `:156` lo recorre buscando
  el tramo por **igualdad exacta**: `if ($row['monto'] == $millones)`, donde
  `$millones = floor($user_request->final_amount / 1000000) * 1000000` (`:155`). Si el monto truncado no
  está en la tabla, `$consumoTotal` **queda en 0** y no hay `else` ni log. Los dos huecos:
  - `final_amount < 1.000.000` → `floor` da **0**, que no está en la tabla → comisión 0.
  - `final_amount >= 41.000.000` → fuera del último tramo → comisión 0.
- **Hoy es LATENTE, no activo:** medido en la copia local, de **27** solicitudes del lender 100 con
  `final_amount`, **ninguna** cae fuera del rango (0 por debajo de 1M, 0 por encima de 40M). Es
  coherente con la regla de producto —consumo es para tickets > 1 millón— así que el hueco se abre solo
  si esa regla se relaja o si suben los topes.
- **El riesgo que sí es estructural** es otro: la tabla es un literal en un archivo de export. Si cambia
  el acuerdo con Corbeta, **nada obliga a actualizarla** y el reporte sigue saliendo con las cifras
  viejas, sin avisar. Es la única fuente de ese número.
- **Contexto:** ese archivo es **el único lugar del código donde se calcula un ingreso de CreditOp**
  (Consumo: el total se parte 50/50 con Corbeta; BNPL: 1 % CreditOp + 0,5 % Bancolombia). El
  `comission_percentage` configurable por par comercio-entidad **no se usa para cobrar** (F-128 y el
  nodo `negocio`), y la liquidación real la hace otro departamento a mano desde el «Reporte de Recaudo».
- **Arreglo:** sacar la tabla a configuración (o a la BD, junto al resto del acuerdo comercial) y elegir
  el tramo por rango (`>=`) en vez de por igualdad, para que un monto fuera de la grilla no devuelva 0
  en silencio.
- **Estado:** vivo en `main` de `legacy-application`. No aplicado: es un repo de la compañía.

### F-130 · `countries.iso_code_2` guarda el código de TRES letras, y `iso_code_3` está vacío

- **Síntoma:** se manda a un tercero el ISO del país leyendo la columna que «suena» a dos letras y el
  proveedor rechaza el valor, o al revés: se busca `COL` en `iso_code_1` y no matchea nada.
- **Causa raíz (verificada 2026-08-09 contra la copia local):** los nombres están corridos una posición.
  `iso_code_1` trae el **alfa-2** (`CO`, `DO`, `AF`), **`iso_code_2` trae el alfa-3** (`COL`, `DOM`,
  `AFG`) y **`iso_code_3` está vacío en todas las filas**. O sea que el sufijo numérico **no es la
  cantidad de letras**, aunque se lea así.
- **Evidencia:** `SELECT id,name,iso_code_1,iso_code_2,iso_code_3 FROM countries WHERE id IN (1,47,60)`.
- **Arreglo:** no renombrar — hay otro repo con deploy propio que consulta `countries` (el form-service
  lee la fila completa), así que un rename rompe queries ajenas. Lo correcto es documentar la semántica
  donde se use y, si hace falta el alfa-3, leer `iso_code_2` a conciencia.
- **Estado:** trampa viva. Sin consumidor conocido que la sufra hoy, pero cualquier integración nueva
  por país la pisa.

### F-131 · La fila `countries.id = 1` es «Afghanistan» y es el DEFAULT: 155 entidades y 215.844 usuarios apuntan ahí

- **Síntoma:** una consulta por país devuelve entidades o usuarios que no tienen nada que ver, o un
  reporte «por país» sale con un país absurdo.
- **Causa raíz (verificada 2026-08-09):** las columnas `country_id` nacieron con `DEFAULT 1`, y la fila 1
  del catálogo es **Afghanistan** — con `dial_code`, `phone_code`, `locale` y `currency` **vacíos o
  NULL**. Como es el default, «sin definir» y «definido mal» son **indistinguibles**: no se puede saber
  si alguien eligió esa fila o si nadie eligió nada.
- **Evidencia:** `SELECT COUNT(*) … WHERE country_id=1` → **155 lenders · 215.844 usuarios · 0
  comercios**. Los comercios en cero son la clave de por qué hoy es inocuo: el camino vivo resuelve el
  país **por el comercio**, que sí apunta a la fila correcta.
- **Arreglo:** es destructivo y va aparte — cambiar el default obliga a revisar en el mismo cambio las
  consultas con id de país fijo, o el listado de crédito queda vacío. Mientras tanto: **no derivar el
  país del usuario ni de la entidad**; derivarlo del comercio.
- **Estado:** vivo. ⚠ Y no confundir con las cifras de otra medición (186 / 364.527): esas son de otro
  ambiente. Las de arriba son de la copia local.

### F-132 · Un «no coincide» de la central en el SEGUNDO nombre/apellido se descartaba como si el campo no se hubiera enviado

- **Síntoma:** un cliente queda guardado con el segundo apellido mal escrito y **no hay ningún error**.
  El crédito avanza, los documentos se firman con ese nombre y la entidad lo acepta. Desde soporte llega
  como «se guardó un usuario solo con un nombre y con un apellido».
- **Causa raíz (verificada 2026-08-13):** `TusDatosService.php:195` decide si un no-match cuenta como
  error. La tolerancia es correcta y deliberada —un cliente puede **no tener** segundo nombre o segundo
  apellido, y entonces el campo no se envía y TusDatos devuelve `match_code = null`— pero estaba escrita
  con comparación laxa: `$matchCode == null`. En PHP **`0 == null` es `true`**, y `0` es el código de
  TusDatos para **«no coincide»**. O sea que «está mal» se descartaba con el mismo silencio que «no lo
  mandé». El `match` de `:182` es estricto y sí construye el mensaje «Segundo apellido no coincide»; el
  `if` lo tira.
- **Evidencia:** `SELECT` sobre `kyc_name_checks` en prod (4.874 chequeos de TusDatos desde 2026-07-23):
  **198** validaciones pasaron con un no-coincide declarado — 87 de segundo apellido, 87 de segundo
  nombre, 24 de segundo apellido sin segundo nombre. Caso testigo uReq 523201: `{first_name: 1,
  middle_name: null, first_surname: 1, second_surname: 0}` y `passed = 1`.
- **Arreglo:** `=== null`. ⏳ **PENDIENTE DE MERGE en `main`** — mergeado a **`staging`** el 2026-08-15
  (PR #1098, `eb429dda`; la rama original sobre `main` quedó como respaldo y su PR #1082 se cerró).
  El manual del proveedor lo confirma desde su lado («Verificación exprés» v1.0, 2025-07-24):
  `0` = **no coincide** (<89,9 % de similitud) y `null` = no proporcionado. No eran lo mismo.
- **Estado:** vivo en `main`. ⚠ **El arreglo NO cierra el agujero**, solo tapa la fuga de la última
  línea de defensa: TusDatos es el ÚLTIMO de la cascada y solo se consulta si Ágil y Mareigua fallan, así
  que para la mayoría de los clientes ese aviso nunca se pide. Ver **kyc** § «El nombre».

### F-133 · Con un solo apellido, el pagaré de Deceval lo registra DOS veces

- **Síntoma:** el pagaré sale con el mismo apellido en primer y segundo apellido. Nadie lo ve hasta que
  Deceval rechaza por conflicto de identidad (`SDL.DA.0439`), al final del embudo.
- **Causa raíz (verificada 2026-08-13):** `Modules/Loans/App/Actions/DecevalSoap.php:283-284` parte el
  apellido con `Str::before($user->surname, ' ')` y `Str::after($user->surname, ' ')`. En Laravel,
  **`Str::after` devuelve la cadena COMPLETA si no encuentra el separador**, así que con
  `surname = "LICONA"` salen `primerApellido_Nat = LICONA` **y** `segundoApellido_Nat = LICONA`.
- **Evidencia:** comprobado contra el vendor del contenedor: `Str::after("LICONA", " ")` → `"LICONA"`.
  De las 1.574 solicitudes de Credifamilia en estado 11, **37** tienen un solo nombre y un solo apellido.
  Caso testigo uReq 519533: la traza confirma girador creado y pagaré firmado.
- **Arreglo:** partir con `preg_split` y devolver `''` cuando no hay segundo apellido — el mismo criterio
  que ya usa `PayloadFormatters::splitSurname` para los PDF de vinculación, que **sí** lo hace bien.
  No aplicado.
- **Estado:** vivo en `main`. Hay **cuatro** partidores de nombre distintos sobre las mismas dos
  columnas; este es el único que duplica. Ver **kyc** § «El nombre».

### F-134 · Una línea que no aparece en Loki NO significa que el código no corrió: mirá por qué canal sale

- **Síntoma:** se despliega un cambio, se busca su log en Grafana, no está — y se concluye que el
  despliegue no llegó. La conclusión es falsa y cuesta horas: el código corría, el log no viajaba.
- **Causa raíz (verificada 2026-08-15):** en este repo **sólo `TracerService::log()` fija el canal**
  (`app/Otel/TracerService.php:307`, `Log::channel('loki')`). Cualquier otro `Log::` usa el canal por
  defecto, que depende de `LOG_CHANNEL` del entorno — y varios `.env` del repo lo ponen en `single`,
  o sea un archivo dentro del contenedor. `app/Support/Logging/OnboardingLogger.php` delegaba en
  `Log::getFacadeRoot()`, así que sus eventos (`kyc.*`, `otp.*`) podían no llegar nunca a Grafana.
- **Evidencia:** solicitud 464872 en staging, 2026-08-15 03:09Z. La traza aparece completa —93 líneas,
  todas de `TracerService`, incluidas `Validating identity with AgilData` y `AgilData OK`— pero el
  evento `kyc.name_adoption`, que ese mismo código emite, **no está**. Se leyó como «el arreglo no
  está desplegado» cuando el deploy había terminado 51 minutos antes.
- **Arreglo:** que `OnboardingLogger` fije `Log::channel('loki')` con el mismo fallback de
  `TracerService`. **Aplicado en `staging`** (PR #1100, `ed2c37d6`) con 4 tests; 3 fallan sin él.
  ⏳ **Pendiente en `main`.**
- **Estado:** vivo en `main`. La regla general sigue valiendo aunque se arregle este caso: **antes de
  concluir que un código no corrió por la ausencia de su log, verificá por qué canal sale.** Un log
  que no llega no sólo no informa — desinforma, porque su ausencia se lee como evidencia.

### F-135 · El OTP real de staging no se puede validar: el proveedor manda el SMS y el código no vuelve de la caché

- **Síntoma:** el usuario recibe el SMS, digita el código y la validación responde `NO_PREVIOUS_OTP`.
  Desde afuera parece que digitó mal o que la sesión expiró. **Y el registro del teléfono responde
  `success`**, así que nada avisa en el paso anterior.
- **Causa raíz (verificada 2026-08-15):** `Modules/Onboarding/App/Services/OtpService.php:432` lee el
  código generado desde la caché (`readOtpFromRedis`) en todos los entornos salvo `local`, que tiene
  el atajo `1111`. Si la caché no lo entrega, el flujo aborta con `ONB014_OTP_GENERATION_FAILED` y
  **no persiste la fila de `otps`** — deliberadamente, para no dejar un espejo en `0`. Sin esa fila,
  `validateOtpCode` no encuentra nada y devuelve `NO_PREVIOUS_OTP`.
- **Evidencia:** staging, 2026-08-15 03:48Z. La traza muestra
  `OtpService::sendOtpCode: cache did not deliver the generated code, returning ONB014` y, dos líneas
  después, `Skipping unsigned legal document (no Credifamilia or OTP failed)` — pero el controlador
  igual devolvió `success` («Result contains user, returning success response»).
- **Arreglo:** dos caminos. (a) arreglar la caché de staging; (b) `ONBOARDING_DRIVER_CACHE=fake` junto
  con `ONBOARDING_DRIVER_OTP=fake`: el fake de OTP escribe el código en la caché él mismo
  (`FakeOtpServiceRepository::generateOtp`), así que el paso deja de fallar. ⚠ El driver fake de OTP
  **solo no alcanza**: reemplaza al proveedor, no al `CacheServiceInterface` que `OtpService:42`
  inyecta para leer de vuelta. No aplicado.
- **Estado:** vivo. **Rodeo mientras tanto:** un teléfono de `settings.qa_otp_bypass_phones` (código =
  últimos 4 dígitos) sí pasa, porque `OtpBypassService` retorna **antes** del chequeo de fila vacía.

### F-136 · «El voucher todavía no se ha generado» en un lender IMEI no es un error temporal: no lo genera nadie

- **Síntoma:** la solicitud está en **estado 11 «Autorizada»** —el admin lo muestra, Redash lo confirma,
  el cliente recibió sus documentos— y el voucher de desembolso no existe. El mensaje del panel
  («todavía no se ha generado») se lee como *«esperá un rato»*, y esperar no cambia nada. Llega
  reportado como «error de hoy» porque hoy alguien fue a buscar un voucher, no porque hoy empezara.
- **Causa raíz (verificada 2026-08-15):** el voucher se genera en **dos ramas mutuamente excluyentes**, y
  hay lenders que no caen en ninguna. `Modules/Loans/App/Services/LoanAuthorizationService.php:484` calcula
  `$isImeiFlow = lender->path->name === 'IMEI'` y con eso **saltea** `generateVoucher`,
  `updateDisbursedLender` y `completeRequest` (`:496`), difiriéndolos al desembolso. El único lugar que
  los ejecuta después es `handlePostDisbursementSideEffects:323` (`:343` el voucher), dentro de
  `disburseImeiRequest` — y `Modules/Loans/App/Http/Controllers/Customer/DeviceController.php:102`
  sólo llega ahí si `isSmartPay()`, que es
  `isImeiPath() && lender->id === 160` (`app/Models/UserRequest.php:190`). Un lender con `path_id=2`
  que **no** sea el 160 se cierra por `authorize()`, o sea por la rama que acaba de saltear el voucher.
  El que **saltea** mira el path; el que **ejecuta** mira el id. Es el hardcode de **F-21** visto desde
  producción: allá impedía probar SmartPay fuera de prod, acá deja sin voucher a otro lender real.
- **Alcance real: son CUATRO lenders, no uno** (re-medido en prod el 2026-08-15, independientemente).
  Todos los `path_id=2` que no son el 160 caen en el hueco: **164 CREDIMOVIL** · **162 Crédito Directo
  X** · **187 Crédito Directo X LB** · **172 My tech ya**. El 160 SmartPay es el único cubierto. El
  164 es apenas el 62% del problema; el resto se estaba pasando por alto porque el reporte llegó por
  Credimovil.
  <br>⚠ **Y NO se puede medir con `profiling_reviews.disbursed_lender`**, aunque tiente: esa columna
  se escribe junto al voucher en casi todos los call sites, **pero también** cuando un comercio marca
  la solicitud como desembolsada desde el panel
  (`Modules/Partner/App/Services/UserRequestManagementService.php:188`, `STATUS_DISBURSED = 11`), que
  **no genera voucher**. Medir por ahí exonera al 162 por error: su ratio alto es vía de ingreso
  distinta, no vouchers. La huella en BD del voucher **no existe** — `VoucherService::generateVoucher`
  solo escribe el PDF a S3 y no deja fila; el log `Voucher generated` lo emite el
  `LoanAuthorizationService`, no el service. Confirmar solicitud por solicitud pide listar S3.
- **Evidencia:** prod, lender **164 CREDIMOVIL** (`path_id=2`, `path='IMEI'`, rt=2). Solicitud 528704:
  IMEI registrado 13:55:56, estado 11 a las 13:55:58, `Notifications sent` 13:56:20 — y **ni una línea
  de voucher** en la traza. En Loki prod: `Voucher generation failed` **0 líneas en 24 h** (no falla:
  no se llama), `Voucher generated` 15 líneas en 12 h (los no-IMEI andan) y
  `Voucher generated (IMEI disbursement)` 1 línea (el 160, cuando sí llega). En BD, **999 solicitudes
  del 164 en estado 11 desde el 2026-03-27**: Credimovil no tuvo voucher nunca. **Y sigue vivo:** la
  re-medición del día siguiente dio **1002, con tres entradas de ese mismo día** — no es un incidente
  cerrado que quedó en la historia, es un goteo de ~7 diarias.
- **Arreglo:** que el ejecutor tenga la misma condición que el que saltea — `disburse` bifurcando por
  `isImeiPath()`, o `disburseImeiRequest` sin el 160. **No** agregar el 164 al hardcode: el próximo
  lender IMEI vuelve a caer en el hueco. No aplicado. **Rodeo:** el botón manual del panel (permiso
  `regenerate request voucher`, id 67 en prod, otorgado a 4 usuarios) genera el que falte, de a uno.
- **Estado:** vivo en `main`. La regla que sobrevive al arreglo: **cuando un side-effect se «difiere»,
  verificá que quien lo ejecuta se active con la misma condición que usó quien lo salteó.** Si difieren,
  el hueco no tira excepción ni deja log — y su ausencia se lee como «todavía no».

### F-137 · El comando que siembra las credenciales del SOAP de Credifamilia escribe tres claves que el Action no lee nunca

- **Síntoma:** seguís el README de la integración, corrés `credifamilia-consumo:seed-credentials`, el
  comando responde OK e idempotente — y la radicación SOAP igual falla por credencial. O peor: **funciona**,
  y entonces nadie se entera de nada. Las dos cosas dependen de un dato que el comando no mira.
- **Causa raíz (verificada 2026-08-15, contra `main`):** el que **escribe** y el que **lee** usan claves
  distintas dentro del mismo JSON `lender_allied_credentials.credential`.
  `app/Console/Commands/SeedCredifamiliaConsumoCredentialCommand.php:295-297` escribe
  `credifamilia_consumo_cert`, `credifamilia_consumo_key` y `credifamilia_consumo_cert_password`. El Action
  lee las del **REST**: `app/Actions/Lenders/CredifamiliaConsumo/CredifamiliaConsumo.php:411-412`
  (`credifamilia_cert` / `credifamilia_key`) y `:426` (`credifamilia_password`). Del prefijo
  `credifamilia_consumo_` sólo sobrevive un Setting sin relación, el timeout (`:429`). Así que la siembra
  es **inerte**: si la fila ya tenía el par REST, el SOAP anda —y parece que el comando sirvió—; si no lo
  tenía, revienta por clave ausente después de haber "sembrado bien".
- **Evidencia:** el docblock del comando hermano lo declara al revés de lo que hace el código —
  `app/Console/Commands/TestCredifamiliaConsumoSoapCommand.php:16` dice literalmente que el Action lee
  `credifamilia_consumo_{cert,key}`. Y `docs/lenders/credifamilia/README.md:111-118` (2026-06-01) trae la
  tabla que separa las claves REST de las «SOAP Consumo». Los tres coinciden entre sí y **difieren del
  Action**, que es el único que corre.
- **Arreglo:** decidir cuál es la fuente y alinear los otros dos. Si el cert es el mismo para REST y SOAP
  —que es lo que hace hoy el código— el comando y sus docs sobran y confunden: sacarlos. Si de verdad van
  a ser certificados distintos, el Action tiene que leer el prefijo `_consumo_` con *fallback* al REST. **No
  aplicado, y la intención no está confirmada**: no se pudo determinar si el reuso del cert REST fue una
  decisión o el comando quedó vestigial de una versión anterior. → ver nodo **credifamilia**.
- **Estado:** vivo en `main`. La regla general: **cuando un comando de operación y el código que consume
  el dato viven en archivos distintos, la clave del JSON es un contrato sin compilador** — nada falla al
  desincronizarse, y el modo de falla («funciona por casualidad») es peor que el error.

### F-138 · `update-user-request` no valida `lender_id`: una entidad ajena revienta con un null, y una regla inventada tira 500

- **Síntoma:** seleccionar una entidad que el comercio **no tiene cableada** no devuelve un error de
  validación sino un 500 de PHP: `Attempt to read property "id" on null` (o `"url_utm" on null`). Y una
  entidad que **sí está cableada pero no salió en el listado** se acepta sin chistar. O sea: el endpoint
  no distingue «no es tuya», «no existe» y «no te la ofrecí» — dos revientan igual y la tercera pasa.
- **Causa raíz (verificada 2026-08-17, contra `main`):** `app/Http/Requests/Customer/UserRequest/UpdateRequest.php:22-38`
  es el FormRequest de la ruta, y **`lender_id` no figura en `rules()`**. Sólo se exige `amount`. Sin
  `exists` ni una regla que ate la entidad a `lenders_by_allied_branches`, el id entra crudo y
  `ListLenderController@updateUserRequest`
  (`Modules/Onboarding/App/Http/Controllers/ListLenderController.php:66-73`) lo pasa al servicio, que
  deshace una relación que vino `null`.
- **Y hay un segundo defecto en el mismo `rules()`:** tres campos declaran `'optional'`, que **no es una
  regla de Laravel** (las reales son `sometimes` / `nullable`). Mientras el campo no venga, no pasa nada;
  el día que alguien manda `ecommerce_request_id`, el request muere con
  `BadMethodCallException: Method Illuminate\Validation\Validator::validateOptional does not exist`.
  Es una validación que sólo falla cuando por fin se usa.
- **Evidencia:** medido contra `local` (`main`) el 2026-08-17 con `harness/dev/caso.ts`, comercio
  Amoblando Pullman (sucursal `e9409aff`, 7 entidades cableadas):
  `lender 160` (SmartPay, existe pero no es de ese comercio) → `"id" on null`; `lender 24`
  (Credifamilia, ídem) → `"url_utm" on null`; `lender 999` (no existe) → **el mismo error que 160**;
  `lender 39` (Meddipay, cableada y ausente del listado) → **aceptada**, devuelve modal de autogestión.
  El `BadMethodCallException` se reprodujo mandando `ecommerce_request_id: 123` por curl.
- **Arreglo:** agregar a `rules()` `'lender_id' => ['required','integer','exists:lenders,id']` y, encima,
  una regla que verifique la arista `lenders_by_allied_branches` para la sucursal de esa solicitud —
  que es la que convierte un 500 en un 422 honesto. Y reemplazar los tres `'optional'` por `'sometimes'`.
  **No aplicado:** falta decidir si aceptar una entidad cableada-pero-no-listada es un bug o un permiso
  deliberado (el listado clasifica además de filtrar), y esa respuesta no está en el código.
- **Estado:** vivo en `main`. La regla general: **un FormRequest que no nombra un campo no lo está
  dejando pasar a propósito — no lo está mirando**, y el que revienta después es el que sí lo usa.

### F-139 · En local hay TRES simuladores de centrales apilados, y el de más arriba contesta siempre lo mismo

- **Síntoma:** dictás la respuesta de un buró para una cédula, corrés el flujo, y el backend guarda
  datos que nadie pidió — **siempre los mismos**. Peor: el flujo **termina bien**, así que uno concluye
  «el ingreso no cambia el listado» cuando el ingreso nunca llegó. Con tres corridas variando el
  ingreso 21× salió el mismo `last_payment_value` en las tres.
- **Causa raíz (verificada 2026-08-17 contra `main`, medido en local):** conviven **tres** mecanismos
  y el orden de precedencia no está escrito en ningún lado —
  **drivers fake → `mock_rules` → lambda → red**:
  1. `ONBOARDING_DRIVER_<CENTRAL>=fake` hace que `app/Providers/OnboardingDriverServiceProvider.php:110-139`
     registre un `Http::fake()` que intercepta **en la capa HTTP**, arriba de todo. Gana siempre.
  2. `mock_rules` (MOBA1002, fila en BD) marca `$isMock` sólo si el **teléfono** del usuario coincide
     con su `phone_number` (en local: `3099000000`).
  3. Recién si ninguno aplica, `app/Actions/RiskCentrals/*` evalúa `$useLambdaMock`, que además exige
     `filled(config('services.<central>.mock_host'))` y entorno `local`/`development`.
- **Evidencia:** con `ONBOARDING_DRIVER_AGILDATA=fake` el log trae `kyc.fake.http_drivers_registered`
  y `user_summaries.agildata` queda con `last_payment_value: 2910715` en toda corrida, sea cual sea lo
  dictado. Poniendo los cuatro drivers en `real` y con los `*_MOCK_HOST` cargados, la misma corrida
  devuelve el ingreso dictado (700.000 / 2.500.000 / 15.000.000, uno por caso) y Loki registra
  `Resolved response source` con `source: lambda`.
- **⚠ Un control negativo que NO sirve:** apuntar el `*_MOCK_HOST` a un puerto muerto **no prueba
  nada**. El Action hace `->throw()`, cae al **fixture en silencio** y el flujo termina igual de
  rápido. La única evidencia válida de que la lambda participó es el log `source=lambda`.
- **Arreglo:** para ejercitar centrales de verdad en local, los tres tienen que estar alineados: los
  cuatro `ONBOARDING_DRIVER_*` de KYC en `real`, los cuatro `*_MOCK_HOST` apuntando a la lambda, y
  `php artisan config:clear`. **No aplicado en el repo** — es configuración de `.env`, que no se
  versiona. La receta de qué dictar está en `tablero/data/mocks-de-centrales-un-solo-mecanismo.md`.
- **Estado:** vivo en `main`, pero **resuelto por decisión** (Miguel, 2026-08-18): los drivers fake de
  burós quedan **sin usar** y el mecanismo es el lambda, que cubre lo mismo y se dicta por cédula sin
  desplegar. Los de OTP y CACHE siguen en `fake` — el de OTP no pasa por `Http::fake` y el lambda no
  lo reemplaza. Detalle y lo que queda abierto (4 specs del harness que inyectan escenarios de burós):
  `tablero/data/mocks-de-centrales-un-solo-mecanismo.md` §«DECISIÓN». La regla general: **cuando tres
  mecanismos resuelven lo mismo y ninguno declara su precedencia, el que gana es el que intercepta más arriba** — y como todos devuelven algo
  plausible, la única forma de saber cuál contestó es que cada uno deje su marca en el log.

### F-140 · En local, una entidad rt=1 cuya integración no esté mockeada DESAPARECE del listado sin decir nada

- **Síntoma:** un comercio tiene N entidades cableadas y el listado devuelve N-1. La que falta **no
  sale con «Probabilidad muy baja»** ni con ningún mensaje: no está en la respuesta. Y no es la
  conducta que uno esperaría del rechazo, porque las reglas la **aprobaron**.
- **Causa raíz (verificada 2026-08-17 contra `main`, medido en local):** las entidades `rt=1` se
  autentican contra la **API del proveedor** antes de entrar al listado. En local los hosts apuntan a
  un mock genérico (`harness` :8099, `{"mock":"lenders-gateway"}`) que responde **200 a cualquier
  ruta** con un cuerpo genérico. `app/Actions/Lenders/Meddipay.php:232-235` pide algo concreto:
  `if (!$auth || !isset($auth['data']['token']))` → sin esa clave da la autenticación por fallida y la
  entidad queda fuera. El mock contesta `{"status":"OK","approved":true,…}`: **200 y sin `data.token`**.
- **Evidencia:** Amoblando Pullman (sucursal `03d5dea0`) tiene 7 entidades cableadas y el listado
  devuelve **6**; falta Meddipay (39). En los logs, para esa misma corrida:
  `Resultado de evaluación de reglas para entidad {"lender_id":39,"result":"aprobado"}` y, más
  adelante, `Autenticando con Meddipay {"allied_branch_id":389}` seguido de
  `Fallo en la autenticación con Meddipay`. Las credenciales **existen** (`lender_allied_credentials`
  tiene fila para lender 39 + Pullman), así que no es una fila faltante.
- **⚠ Cómo NO diagnosticarlo:** comparando configuración. Meddipay y Sistecrédito (que sí aparece) son
  idénticas en `lenders`, en `lenders_by_allied_branches` y en `lenders_by_allieds`; ninguna de las dos
  tiene ciudades de cobertura. La diferencia no está en ninguna tabla: está en si el mock sabe
  contestarle a ESA integración.
- **Arreglo:** para probar una entidad rt=1 en local hay que mockear **su** contrato, no alcanzar con
  el gateway genérico. **No aplicado.** Y mientras tanto: **una ausencia en el listado local no prueba
  una regla de negocio** — hay que mirar los logs de la corrida antes de concluir.
- **Estado:** vivo. La regla general: **un mock que responde 200 a todo convierte un fallo de
  integración en una ausencia silenciosa**, que es indistinguible de una exclusión por reglas. Un mock
  que devolviera 404 en las rutas que no conoce haría ruido — y el ruido acá sería la señal.

### F-141 · La pre-aprobación de `rt≠0` la dispara el FRONT, así que una corrida por API no la ejercita

- **Síntoma:** corrés el flujo entero por API —sin navegador— hasta el listado, y concluís sobre qué
  entidades quedaron pre-aprobadas. La conclusión es **incompleta y no avisa**: para la mayoría de las
  `rt≠0` la pre-aprobación **nunca se consultó** en esa corrida.
- **Causa raíz (verificada 2026-08-18 contra `main` de `frontend-monorepo`):** el listado del backend
  devuelve las cards, y es el **loader del wizard** quien dispara una promesa de pre-aprobación por
  entidad elegible contra el microservicio —
  `apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.tsx:149`
  (`process.env.VITE_PREAPPROVALS_ENDPOINT`), server-to-server, con streaming por entidad. Sin front,
  ese paso no ocurre: el backend ya devolvió su respuesta y nadie llama al MS.
- **⚠ La excepción que confunde:** **Meddipay (39) SÍ se resuelve en el backend**, inline, dentro de
  `Modules/Onboarding/App/Services/lenders/PreApprovedLenderService.php:453` (`if ($lender->id == 39)`,
  id quemado). Así que una corrida por API **sí** ejercita su pre-aprobación y **no** la de las demás.
  Ver una entidad pre-aprobada en una corrida headless no autoriza a suponer que las otras pasaron por
  el mismo camino.
- **Evidencia:** el mock del MS (`harness/mock-preapprovals`, :8095) acepta el escenario por petición
  (`?status=`, header `x-mock-status`, `body.force_status`) — y en las corridas headless del
  2026-08-18 **no recibió una sola llamada**, mientras que el mock de integraciones (:8099) sí
  registró el `/User/Login` y el `/CREDITOP/Customer/CreateOrder` de Meddipay.
- **Arreglo:** para validar el MS hay dos caminos y ninguno es la corrida headless actual: levantar el
  wizard, o llamar al MS directamente con el contrato que el front usa. **No aplicado.**
- **Estado:** vivo. La regla general: **cuando un paso del flujo vive en el cliente, una prueba
  server-to-server lo saltea sin fallar** — y el resultado se ve completo. Antes de concluir sobre una
  etapa, conviene preguntarse quién la dispara.

### F-142 · Una entidad con host nulo tira el listado ENTERO del comercio, y el síntoma parece «no ofrece nada»

- **Síntoma:** el listado de un comercio devuelve **cero** entidades, teniendo varias cableadas y con
  las reglas aprobándolas. Se lee como un hecho de negocio («ese comercio no ofrece nada»), y es una
  excepción de PHP.
- **Causa raíz (verificada 2026-08-18 en local contra `main`):** `app/Actions/Lenders/Credifamilia.php:69`
  hace `->baseUrl(config('services.credifamilia.host_oauth'))`, y esa clave sale de
  `CREDIFAMILIA_HOST_OAUTH` (`config/services.php:121`), que **no está en el `.env` local**. Con la
  variable ausente `config()` devuelve `null` y `PendingRequest::baseUrl()` tira
  `TypeError: Argument #1 ($url) must be of type string, null given`. La excepción **no queda contenida
  en esa card**: se lleva la construcción del listado completo.
- **Alcance medido:** **17 comercios** tienen a Credifamilia (lender 24) cableada en el dump local. En
  todos, el listado revienta igual. Es el mismo modo de falla que ya se conocía para `H2O_API_HOST`
  —donde la variable sí está, apuntando a un puerto cerrado a propósito, y por eso NO rompe—: la
  diferencia entre «apunta a algo muerto» y «no apunta a nada» es un `TypeError` contra un `cURL error`.
- **⚠ Cómo NO diagnosticarlo:** contando entidades. Una herramienta que reporte «0 entidades» sin mirar
  si la respuesta fue un error hace concluir exactamente lo contrario de lo que pasa. `dev/caso.ts` lo
  hacía y se corrigió el mismo día: ahora distingue «el LISTADO falló» de «cero entidades».
- **Arreglo:** agregar `CREDIFAMILIA_HOST_OAUTH` al `.env` local (aunque apunte a un host muerto, como
  hace `H2O_API_HOST`), o hacer que el Action tolere el nulo. **No aplicado** — `.env` no se versiona,
  y el arreglo en el Action es decisión de quien lo mantiene.
- **Estado:** vivo en local. La regla general: **una variable AUSENTE y una variable que apunta a algo
  muerto fallan distinto** — la segunda da un error de red que el código suele capturar, la primera un
  `TypeError` que nadie esperaba y que escala. Cuando se apaga una integración en un ambiente, conviene
  apuntarla a un puerto cerrado antes que borrarla.

### F-143 · Una entidad cableada a la SUCURSAL pero no al COMERCIO tira el listado entero

- **Síntoma:** el listado de un comercio revienta con `Attempt to read property "sort" on null`. No
  falla la card de esa entidad: **falla el listado completo**, y el comercio queda sin ofrecer nada.
- **Causa raíz (verificada 2026-08-18 en local contra `main`):** el listado se arma desde
  `lenders_by_allied_branches` (nivel SUCURSAL) pero el `sort` se busca en `lenders_by_allieds` (nivel
  COMERCIO) — `Modules/Onboarding/App/Services/lenders/LenderProbabilitySortingService.php:26-27`:
  `$lender_sort = $lenders_sort_data->get($lender->id); $lender->sort = $lender_sort->sort;` sin
  comprobar null. Una entidad presente en la sucursal y ausente del comercio devuelve `null` y el
  acceso a `->sort` lanza.
- **Por qué la inconsistencia es POSIBLE:** los dos niveles son tablas separadas y **no hay herencia
  viva** entre ellas — habilitar una entidad copia filas, no las deriva. Nada impide que una sucursal
  tenga una entidad que su comercio no tiene.
- **Evidencia y alcance:** el comercio `Creditop` (allied 24) tiene en sus sucursales tres entidades
  que NO están en `lenders_by_allieds`: **57 (Crédito Claro), 11 (Su+pay) y 52 (Wompi)**. En el dump
  local, **5 comercios** tienen al menos una entidad en esa situación.
- **⚠ Se confunde con F-142.** Los dos se ven igual desde afuera —listado vacío, «el comercio no
  ofrece nada»— y son causas distintas: aquélla es una variable de entorno ausente, ésta es data
  inconsistente. Sólo el mensaje de la excepción los separa, y por eso el runner lo imprime en vez de
  reportar «0 entidades».
- **Arreglo:** en el servicio, tolerar el null (`$lender_sort?->sort ?? <default>`) o excluir la card;
  y en los datos, decidir si una entidad de sucursal sin fila de comercio es válida. **No aplicado** —
  la decisión de producto no está tomada.
- **Estado:** vivo en `main`. La regla general: **cuando dos tablas describen lo mismo a distinto
  nivel y no hay herencia, la que consulta tiene que tolerar el hueco** — el `->` directo convierte un
  dato faltante de UNA entidad en una caída de TODAS.

### F-144 · Le dictás a TusDatos un rechazo y la solicitud AVANZA igual: el `status` tiene que ser la palabra `success`

- **Síntoma:** se le dicta al mock un veredicto de rechazo (`match_code: 0`) y la solicitud pasa
  lo mismo, guardando el nombre que tecleó el asesor. El mock respondió `200` y con el cuerpo pedido,
  así que todo parece bien.
- **Causa raíz (verificada 2026-08-18 contra `main`, medido en local):**
  `legacy-backend/Modules/Identity/App/Services/TusDatosService.php:150` corta con
  `if ($tusDatos->status !== 'success')` y retorna `errors => null`. Ese `errors` vacío es lo que
  `Modules/Onboarding/App/Services/OnboardingService.php:461` lee como **inconcluyente**, no como
  rechazo: sigue con los nombres del formulario y la solicitud avanza. Ninguna otra palabra sirve.
- **Evidencia:** dictando `{"status":"ok", …, "second_surname":{"match_code":0}}` la solicitud 464958
  avanzó y en la traza aparece `TusDatos inconclusive, falling back to form-provided names`. Con el
  mismo cuerpo y `"status":"success"`, la 464960 devolvió `ONB005 / KYC_VALIDATION_FAILED` con
  «Segundo apellido no coincide».
- **⚠ Cómo NO diagnosticarlo:** revisando si el mock contestó. Contestó `200` y el cuerpo llegó
  entero — se puede leer decodificando la fila de `risk_central_user_data`. El problema no es el
  transporte, es una palabra.
- **Arreglo:** dictar `status: "success"`, literal. **Estado:** vigente.

### F-145 · Con cédula colombiana, TusDatos NUNCA compara el nombre como cadena: su veto sale del `match_code`

- **Síntoma:** se le dicta a TusDatos un `nombre_completo` que es de otra persona y la solicitud pasa
  igual. Parece que la validación de nombre no funciona.
- **Causa raíz (verificada 2026-08-18 contra `main`):** para `document_type = 'CC'` el camino termina
  en el bucle de `match_code` de `TusDatosService.php:182-194` y, si ninguno reporta error, retorna
  éxito con **los nombres del formulario** — nunca compara `nombre_completo`. El `verifyCoincidence`
  que sí lo compara (`TusDatosService.php:325`) vive en la rama de **CE**.
- **Evidencia:** solicitud 464963 — Ágil abstenido, Mareigua devolviendo otra persona y TusDatos con
  `nombre_completo` ajeno pero todos los `match_code` en `1`: **ACEPTADA**. El mismo caso con
  `first_name`, `first_surname` y `second_surname` en `0`: `ONB005` (solicitud 464964).
- **⚠ Consecuencia al leer el código:** el arreglo del `0 == null` de CORE-420 vive en ese bucle, no
  en la comparación de cadena — por eso ese rechazo sí se podía probar en local aun cuando la
  comparación de nombre estaba relajada por entorno.
- **Arreglo:** para forzar un rechazo con CC hay que poner `match_code: 0`; dictar un nombre distinto
  no alcanza. **Estado:** vigente.

### F-147 · Una categoría SIN tope de cuotas se comporta como «tope cero»: al mejor cliente no se le puede cambiar el plazo

- **Síntoma:** `fee-number-options` devuelve **lista vacía** con `can_change: true`, y parece que el
  crédito no tiene plazos parametrizados. Del lado del cliente: «puedo cambiar la fecha pero el plazo no
  me ofrece nada».
- **Causa raíz (verificada 2026-08-20 contra `main`):** el filtro por categoría de
  `legacy-backend/Modules/Loans/App/Services/CreditChangeValidationService.php:175` compara
  `$feeNum <= $category->max_fee_number` **sin contemplar el NULL**. Una categoría sin tope tiene
  `max_fee_number = NULL`, y en PHP `3 <= null` es **false** —el null se convierte en 0—, así que el
  filtro descarta **todos** los plazos. El efecto queda al revés de la intención: «Segunda oportunidad»
  (tope 6) puede cambiar a 3 o 6 cuotas, y «Premium» —sin tope— no puede cambiar a ninguno.
- **Evidencia:** crédito 465094 en dev (CrediPullman): la línea ofrece `1,3,6,12`, va en la cuota 1 y
  `can_change` es `true`, pero `options` vuelve vacío. `users_category_log` dice que ese cliente resuelve
  a la categoría **12 «Premium»**, cuyo `max_fee_number` es NULL. Comprobado el comportamiento del
  lenguaje aparte: `php -r 'var_dump(3 <= null);'` → `false`. En dev, **58 de 144** categorías tienen el
  tope en NULL.
- **⚠ Cómo NO diagnosticarlo:** buscando datos faltantes. La línea de crédito **sí** tiene los plazos
  parametrizados y el crédito **sí** admite cambios; nada en la respuesta apunta a la categoría.
- **Alcance:** es código compartido, así que afecta **también el cambio de plazo de la app móvil**, no
  sólo al canal de soporte.
- **Arreglo:** tratar el NULL como «sin tope» (`max_fee_number === null || $feeNum <= …`). Una línea,
  pero cambia el comportamiento para 58 categorías: **decisión de producto**. **Estado:** abierto.

### F-148 · A un crédito con la fecha vencida, el menú de fechas ofrece SÓLO opciones que el guardado rechaza

- **Síntoma:** el cliente elige una de las dos fechas ofrecidas y el cambio falla con «la fecha tiene que
  ser de hoy en adelante». Con las dos opciones pasa lo mismo: un menú donde **todo** falla.
- **Causa raíz (verificada 2026-08-20 contra `main`):** `getNextPaymentCycles`
  (`legacy-backend/Modules/Loans/App/Services/CreditChangeValidationService.php:96`) toma como punto de partida la fecha
  de pago **del crédito** y nunca la compara con hoy, así que calcula «los próximos 5/16/28» a partir de
  una fecha que ya pasó. El guardado, en cambio, exige `after_or_equal:today`.
- **Evidencia:** crédito 412380 en local, con `next_payment_date` en 2026-07-16 (más de un mes viejo):
  ofrecía 2026-07-28 y 2026-08-05, las dos en el pasado. Con el punto de partida anclado en
  `max(fecha del crédito, hoy)` ofrece 2026-08-28 y 2026-09-05; y con fecha futura —el caso sano— el
  resultado no cambia.
- **⚠ La otra mitad, que sigue abierta:** las rutas de la app (`Consumer` y `Customer`) **no** validan
  `after_or_equal:today` al guardar, o sea que por ahí hoy se puede dejar una fecha de pago **en el
  pasado**. Dejar de ofrecerla no es lo mismo que rechazarla.
- **Arreglo:** el ancla ya está corregida en `develop` (PR #1166 del canal de soporte). **Estado:**
  arreglado en `develop`, **pendiente de llegar a `main`**; la validación de entrada de las rutas viejas,
  abierta.

### F-146 · El mismo cliente con el nombre mal se comporta AL REVÉS según por qué monolito entre

- **Síntoma:** se corrige el comportamiento en el flujo nuevo y el viejo sigue distinto; o un caso
  que se reproduce por un camino no se reproduce por el otro, con la misma configuración.
- **Causa raíz (verificada 2026-08-18 contra `main`):** la misma función, con el mismo nombre y
  leyendo **las mismas claves de `settings`**, devuelve valores opuestos.
  `legacy-backend/Modules/Onboarding/App/Services/OnboardingService.php:1334` retorna `false` al
  agotar los intentos; `application/app/Http/Controllers/Customer/PersonalInfoController.php:504`
  retorna `true`. El llamador es idéntico en los dos. Resultado: el flujo nuevo consulta la fuente
  registral en los dos primeros intentos y frena al tercero; el viejo **rechaza** los dos primeros y
  consulta al tercero.
- **⚠ Y en el flujo viejo el veto de la fuente registral NO EXISTE:** `PersonalInfoController.php:628-652`
  sólo mira el caso de éxito; ante cualquier error escribe los nombres del formulario y guarda. No hay
  rama para `errors`, y después del `save()` no queda ninguna otra validación de identidad.
- **Evidencia:** lectura de código línea por línea. Y el flujo viejo **sigue vivo**: 9.454 líneas/día
  en Loki de producción, con `PersonalInfoController::alliedsLendersValidator` corriendo hoy.
- **⚠ Cómo NO diagnosticarlo:** por logs. La cascada de identidad del monolito viejo **no emite
  ninguno**, así que buscar en Loki una frase del flujo nuevo da cero y parece que ese camino está
  muerto. No lo está.
- **Arreglo:** pendiente, con la decisión de cuál de las dos políticas es la correcta. **Estado:** abierto.

### F-149 · El lambda de mocks cambió y dejó de honrar lo dictado: acepta el POST y sirve datos aleatorios

- **Síntoma:** se le dicta al lambda qué debe contestar una central para una cédula, el POST responde
  `Global variable ... has been set to ...`, y la consulta devuelve **otra cosa**. Aguas abajo el
  síntoma no se parece a la causa: `personal-info` corta con `ONB004 laboral information is required`,
  y uno sale a buscar por qué ese comercio pide información laboral.
- **Causa raíz (medido el 2026-08-18, el mismo día que funcionaba):** el lambda fue **redesplegado
  con otra plantilla** y la nueva ignora las global-vars en la ruta de Agildata. Tres señales, todas
  comprobables en una petición:
  - el `type` de la respuesta pasó de `aorg.asofondos.agildata.domain.AfiliadoDetalladoa` a
    `xorg.asofondos.agildata.domain.AfiliadoDetalladox`;
  - el nombre dejó de ser fijo y ahora es **aleatorio por petición** — la MISMA cédula devolvió
    `Marcellus Dooley` y `Neha Douglas` en dos lecturas seguidas;
  - `GET /mockoon-admin/global-vars` responde `Cannot GET` (el POST sigue aceptando).
- **Por qué además rompe el flujo:** la plantilla nueva trae períodos de cotización viejos (`202510`,
  diez meses), así que el backend calcula `employed: false` y la solicitud no llega al listado.
- **⚠ Lo que hace visible el problema:** confirmar el dictado LEYENDO después de escribir. Sin esa
  comprobación el runner seguía adelante con datos que nadie pidió y el resultado se leía como un
  hecho de negocio. Con ella dice «la respuesta del buró no quedó dictada» y no corre.
- **Arreglo:** no es nuestro — hay que preguntarle al dueño del lambda si el redespliegue fue
  intencional y si las global-vars siguen soportadas en esa ruta. Mientras tanto, `--lambda` no sirve
  para dictar y hay que volver a inyectar (`synthFill`) si se necesita variar el buró.
- **Estado:** vivo. La regla general: **un mock compartido es infraestructura de otro** — puede cambiar
  bajo los pies en mitad de una sesión, y sin read-after-write eso se convierte en resultados
  plausibles y falsos en vez de un error.

### F-150 · El builder de documentos del Rent to Own se elige por id QUEMADO, así que sólo funciona donde el clon quedó con ese id

- **Síntoma:** la entidad Rent to Own firma sus documentos con el payload equivocado y el render muere
  con «Undefined variable» — una firma caída, no un documento con huecos. No se ve venir: el catálogo
  está bien sembrado y las plantillas existen.
- **Causa raíz (verificada 2026-08-22 contra `main`, reproducida en local):**
  `Modules/Loans/App/Services/DocumentGeneration/CatalogDocumentPayloadResolver.php:42-46` mapea
  `lender_id => builder` con ids **literales** (`158 => MotaiRentingPayloadBuilder`,
  `205 => MotaiRentToOwnPayloadBuilder`) y cae en silencio al genérico:
  `self::BUILDERS_BY_LENDER[$lenderId] ?? OnboardingPayloadBuilder::class` (`:65`).
  Pero **el id del clon NO es estable entre ambientes** — y no es una hipótesis: las migraciones del
  Rent to Own resuelven por `lenders.slug` **justamente por eso**, y su comentario lo dice («en qa el
  clon es el 205»). Medido: al correr esas migraciones en local, el clon quedó con **id 173**.
- **Evidencia:** con `slug = 'rent-to-own'` en id 173, `builderFor(173)` no encuentra entrada y usa
  `OnboardingPayloadBuilder`, que emite claves como `linea_de_credito` / `credit_line`, mientras
  `resources/views/creditopxpdf/lenders/motai/rto/contrato_rto_con_codeudor.blade.php` pide
  `$documento_cliente`, `$documento_codeudor`, `$celular_cliente`. Ninguna coincide.
- **⚠ Lo sabe el propio archivo.** Su docblock (`:34-36`) trae el TODO: «cambiar 158 y 205 por los ids
  de PRODUCCIÓN antes de desplegar… Mejor aún: resolver por `lenders.slug`, que sí es estable entre
  ambientes — es lo que ya hacen las migraciones del Rent to Own». O sea: **la mitad del sistema
  resuelve por slug y la otra por id literal**, y el desacople es el bug.
- **⚠ YA OCURRIÓ EN PRODUCCIÓN, un día después de que se agregara el mapa.** `28b2d436` (21-ago):
  «The rent-to-own entry was mapped to 205, the QA id of the lender. Production uses **193**, so the
  resolver fell back to the onboarding builder there and the RTO documents were generated without the
  price breakdown and the non-possessory pledge variables». O sea: documentos emitidos SIN el desglose
  de precio y SIN las variables de la prenda. Y el arreglo fue cambiar `205 =>` por `193 =>` — **el
  mismo mapa quemado con otro número**, así que el próximo ambiente vuelve a romperlo. Medido en
  local, donde el clon quedó con id **173**, ninguno de los dos números aplica.
- **Reproducido de punta a punta (2026-08-22, local, solicitud 465276).** Con el clon en id 173 la
  firma del titular devuelve **500** con `Undefined variable $nombre_cliente` sobre
  `…/motai/rto/contrato_rto_con_codeudor.blade.php`. Agregando **una sola línea** al mapa
  (`173 => MotaiRentToOwnPayloadBuilder::class`) y sin tocar nada más, la misma llamada devuelve
  **200** y el flujo cierra en estado **11 · Autorizada** con el codeudor `formalized`. El id es la
  única variable: eso descarta plantilla, catálogo y datos del cliente como causa.
- **Arreglo: resolver por `lenders.slug`, y está PROBADO** (2026-08-22, en una rama local sin
  commitear). El slug se verificó **idéntico en producción y en local** —`motai-renting`,
  `rent-to-own`—, así que el mapa deja de depender del ambiente. El fallback no cambia: un slug no
  mapeado sigue cayendo al builder de onboarding. Con eso, el flujo completo con codeudor cierra en
  **estado 11** y las tres suites de firma siguen en 19 verdes. La decisión de llevarlo al repo es de
  la empresa; lo que ya no hace falta es discutir si funciona.
- **Estado:** vivo en `main`. La regla general: **cuando una parte del sistema resuelve por una clave
  estable y otra por una inestable, la que manda es la inestable** — y el modo de falla es silencioso,
  porque el fallback devuelve un builder válido en vez de fallar.

### F-151 · La firma del codeudor muere con un 500 opaco porque `OTP_SERVICE_HOST` no está en ningún `.env.example`

- **Síntoma:** `POST /cosigner/signature/otp` devuelve `URV25003 · «Error interno del servidor.»`. Todo
  lo anterior funcionó —el codeudor ve el contrato y sus documentos—, así que parece un problema del
  documento o del token, no de configuración.
- **Causa raíz (verificada 2026-08-22 contra `main`):** la firma del codeudor no usa el OTP viejo del
  monolito sino el **microservicio** (`Modules/AuthV1/App/Http/Clients/OtpClient.php:40`, que hace
  `Http::baseUrl(config('services.otp_service.host'))`). Esa variable la leen cinco archivos y **no
  está en `.env.example`**, así que en un local recién armado es `null`: el cliente queda con base
  vacía, el POST no llega a ningún lado y el error de transporte sube convertido en 500.
- **Evidencia:** en Loki, `Error in OtpClient::post` → `SendOtpService::sendOtpOrchestrator` con el
  stack de `PendingRequest->send()`. `grep -n "^OTP_SERVICE" .env.example` no devuelve nada, y el
  cliente entró a `main` el 2026-08-03 (`feature new services`).
- **⚠ Es la misma clase que F-142, y por eso vale como regla:** una variable de entorno que nadie
  declara no falla al arrancar — falla en el punto más profundo del flujo, con el mensaje menos
  parecido a su causa. Antes de depurar un 500 en un camino que estrena microservicio, comprobá que su
  host esté definido.
- **Arreglo:** en local, apuntarla al mock de centrales (`harness/mock-centrales/server.mjs` sirve
  `/api/otp/generate` y `/api/otp/validate`); el contrato es mínimo — **2xx con `success: true`**, ya
  que el id del OTP lo crea este backend (`SendOtpService.php`, `$otp->id`) y los tiempos caen al
  fallback de config. En el repo de la empresa faltaría declararla en `.env.example`. **Estado:** vivo
  en `main`.
- ⚠ **El código ya no se puede leer de la BD:** la fila de `otps` guarda el literal
  `delegated-to-otp-service` en vez del código. Quien valide en local depende del mock o del bypass de
  QA por teléfono de `ValidateOtpService`.

### F-152 · El Rent to Own no tiene documentos para quien NO necesita codeudor, y el síntoma cambia según el ambiente

- **Síntoma:** dos caras de la misma causa, y ninguna falla con error. En qa/prod, el cliente del Rent
  to Own **firma un contrato de renting** —arrendamiento sin opción de compra, lo contrario del
  producto que compró—. En un local armado sólo con las migraciones del repo, **no se genera ningún
  documento** y el flujo sigue como si la entidad no tuviera catálogo.
- **Causa raíz (verificada 2026-08-22 contra `main`):** `lender_signing_documents` se consulta por
  rama —`SigningDocumentResolver::resolveForPolicy()` hace `where('requires_cosigner', $requiresCosigner)`—
  y del Rent to Own **sólo existe la rama `true`**. La migración que la siembra
  (`2026_08_20_120000_seed_rent_to_own_cosigner_documents`) lo declara en su cabecera: *«legal entregó
  únicamente las versiones con deudor solidario… ES UN HUECO CONOCIDO»*, y agrega que **no todas las
  categorías del RTO piden codeudor** — la que se llama justamente «Codeudor» está en
  `requires_cosigner = 0`.
- **Evidencia:** medido en local, el catálogo del clon tiene cinco filas y **todas** en la rama con
  codeudor (`lease_agreement`, `cosigner_agreement`, `promissory_note`, `chattel_mortgage`,
  `payment_schedule`), mientras el renting del 158 tiene las **dos** ramas pobladas. Y el nodo
  `codeudor` ya dice qué pasa con una rama vacía: `SigningDocumentResolver` devuelve vacío, no se
  difiere, no se re-renderiza — **la ausencia de configuración ES el fallback**.
- **⚠ Por qué los dos ambientes difieren:** la rama falsa de qa/prod la pobló
  `2026_08_18_120000_copy_renting_config_to_rent_to_own_lender`, que **no existe en ninguna rama ni
  commit** del repositorio. Es la segunda pieza de la config del RTO que puso una migración fantasma
  (la otra es la calculadora). **Consecuencia práctica: lo que valides en un ambiente no predice el
  otro, y ninguno se reconstruye desde el código.**
- **⚠ MEDIDO EN PRODUCCIÓN el 2026-08-22, y es peor que el hueco: `main` no describe lo que corre.**
  El ledger de migraciones de prod para esta entidad **diverge del repo en las dos direcciones**.
  Corrieron dos que no existen en ninguna rama ni commit (`..._copy_renting_config_to_rent_to_own_lender`
  del 18-08 y `..._set_rent_to_own_calculator_to_weekly_terms` del 19-08) y **no corrió ninguna de las
  dos que sí están en `main`** (`..._seed_rent_to_own_cosigner_documents` y
  `..._set_motai_payment_schedule_template`, ambas del 20-08) — aunque las filas de la rama con
  codeudor **existen igual**, escritas el 20-08 16:39. O sea que la configuración del Rent to Own en
  producción **no la produjeron las migraciones del repositorio**, y leer `main` para predecir prod
  lleva a la conclusión equivocada con toda la confianza.
- **⚠ Lo que en prod PARECE este hallazgo y NO lo es.** La solicitud `533540` tiene sus cinco
  documentos firmados y sus filas de catálogo salen de ramas distintas —el contrato y el pagaré
  apuntan a la rama SIN codeudor—, lo que se lee como «firmó el documento equivocado». **No lo es:**
  ese vínculo es sólo rastro (**F-154**), y el conjunto generado prueba lo contrario — incluye
  `chattel_mortgage`, que existe **únicamente** en la rama con codeudor, así que el resolver devolvió
  la rama correcta. Antes de escalar un caso así, mirá **qué tipos** se generaron, no a qué fila
  apuntan.
- **Dos personas ya cayeron en la categoría del hueco** (la 235, que se llama «Codeudor» y tiene
  `requires_cosigner = 0`) de 21 que pasaron por la entidad, y ninguna solicitud del Rent to Own llegó
  todavía al estado 11. O sea: **la trampa está armada y aún no cobró** — que es la ventana para
  cerrarla.
- **Arreglo:** definir las versiones sin codeudor de los documentos, o cerrar la categoría que no lo
  pide. Es decisión de negocio y legal, no de código. **Estado:** vivo en `main`, declarado por la
  propia migración, **y con evidencia en producción**.

### F-153 · Una regla de categoría con tarjetas revienta LEYENDO el buró, no evaluándolo — y el mismo archivo sí se protege en otros tres lugares

- **Síntoma:** la evaluación de categoría muere con `Undefined array key "status"` y el flujo reporta
  un error de cupo (`QUOTA_CHECK_ERROR`). Parece que el usuario no califica, o que el motor de cupo
  está roto; en realidad nunca llegó a decidir nada.
- **Causa raíz (verificada 2026-08-22 contra `main`):**
  `legacy-backend/Modules/Loans/App/Services/LenderUserCategoryService.php:827` y `:830` leen
  `$creditCard['status']['account']['businessAccountStatus']` y
  `$creditCard['status']['payment']['businessBureauEvent']` con **acceso directo**, sin `isset`. El
  guard existe sólo para la clave externa (`:817` chequea `creditCard`), y el comentario declara la
  intención: *«Lógica de producción: acceso directo»* — se asume que el buró real siempre trae esa
  forma. Un datacrédito con la forma corta (sólo `quotaAvailable`, o un payload recortado) tumba la
  regla antes de evaluarla.
- **⚠ Lo que lo vuelve un hallazgo y no una preferencia de estilo:** el **mismo archivo** lee ese
  payload **defensivamente en tres lugares** (`:725-726` con `?? []`, `:891` con `isset`) y directo en
  uno solo — y el directo es el que corre para las reglas de categoría (`:565`,
  `$criteria['credit_cards']`). O sea que la robustez del archivo depende de por qué camino entraste.
- **Evidencia:** inyectando `creditCard: [{quotaAvailable: 5000000}]` el cupo del codeudor falla con
  ese error; inyectando la forma larga que usa el propio harness (`status.account` + `status.payment`
  + el vector de comportamiento) devuelve `{"cosignerStatus":"approved","eligible":true}` sin tocar
  ninguna otra cosa.
- **⚠ Y los tests no lo cubren:** los de elegibilidad del codeudor **mockean el motor de cupo**
  (`shouldReceive('getCosignerQuota')`), así que prueban la máquina de estados y este camino nunca se
  ejercita. Su rojo o su verde no dicen nada de esto.
- **Arreglo:** para PROBAR, inyectar el buró con la forma completa. Para arreglar de verdad haría
  falta que la lectura sea tan defensiva como los otros tres puntos del archivo — código de la empresa.
  **Estado:** vivo en `main`.

### F-154 · El rastro de un documento firmado apunta a la fila de catálogo equivocada: la busca de nuevo, y sin la rama

- **Síntoma:** en `user_request_signing_documents`, los documentos de una misma solicitud referencian
  filas de `lender_signing_documents` de **ramas distintas** —unas con codeudor y otras sin—, lo que
  se lee como que el cliente firmó un juego mezclado. En una entidad cuyas dos ramas tienen plantillas
  de productos distintos, se lee como que firmó el contrato equivocado.
- **Causa raíz (verificada 2026-08-22 contra `main`):** la generación y el registro resuelven la fila
  **dos veces y con criterios distintos**. `DocumentSigningService` pide
  `SigningDocumentResolver::resolveForSigner()`, que sí filtra por rama, y genera cada documento con el
  `template` de la fila resuelta. Pero después `SigningDocumentRecorder::record()` **no recibe esa
  fila**: la vuelve a buscar en `catalogEntryId()` por `(lender_id, signer_role, document_type)`
  —**sin `requires_cosigner`**— y cierra con `->value('id')` sin `orderBy`. Cuando un `document_type`
  existe en las dos ramas, esa consulta es ambigua y se queda con el id más bajo.
- **Evidencia:** solicitud `533540` en producción. Los tres tipos que existen en **ambas** ramas
  (`lease_agreement`, `promissory_note`, `payment_schedule`) quedaron apuntando a las filas de la rama
  sin codeudor —ids 12, 13 y 14, más bajos— y los dos que existen **sólo** en la rama con codeudor
  (`cosigner_agreement`, `chattel_mortgage`) apuntan bien. Que `chattel_mortgage` se haya generado
  **prueba que el resolver devolvió la rama con codeudor**: no existe en la otra.
- **⚠ Qué está mal y qué no.** El documento entregado es el correcto —lo elige la fila resuelta, no
  esta consulta—. Lo que queda mal es la **evidencia**: en un flujo de firma electrónica, la fila que
  dice de qué configuración salió cada documento firmado apunta a otra. El propio docblock declara el
  alcance («el vínculo sirve para trazar, no para decidir»), así que el defecto no es de diseño sino de
  que la búsqueda quedó por debajo de lo que el catálogo pasó a poder expresar cuando se le agregó la
  rama.
- **Reproducido en local y medido en prod (2026-08-22).** Corriendo la consulta **tal cual** contra
  Motai Renting —que tiene las dos ramas— devuelve dos filas y el `LIMIT 1` implícito se queda con la
  de la rama sin codeudor. En producción, **18 documentos firmados** de solicitudes **que sí tienen
  codeudor** apuntan a filas de la rama sin codeudor: 15 de Motai Renting y 3 del Rent to Own. O sea
  que no es un caso raro del producto nuevo — **es todo el que tenga catálogo con las dos ramas**.
- **⚠ Modo de falla silencioso y con sesgo:** no hay error, y como gana el id más bajo, **siempre**
  pierde la rama que se sembró después. Toda entidad cuyo catálogo haya crecido en dos tandas tiene el
  mismo sesgo.
- **Aislado con un A/B local (transacción revertida, catálogo sembrado en las dos ramas como lo tiene
  prod):** con `main`, el rastro sale de la rama sin codeudor (`contrato_renting_sin_codeudor`); con el
  filtro agregado, sale de la correcta (`contrato_rto_con_codeudor`). Mismos datos y misma solicitud —
  **lo único que cambia es el código**, lo que descarta config y datos como causa.
- **Arreglo:** pasarle al recorder la fila ya resuelta, o agregar `requires_cosigner` al filtro. Ojo con
  el atajo de recalcular la política dentro del recorder: **evaluarla es caro** (corre reglas y consulta
  centrales) y la generación ya la paga una vez. Código de la empresa. **Estado:** vivo en `main`.

### F-155 · Quién es SmartPay se decide en CUATRO lugares y fuera de producción no coinciden: una entidad tiene la originación y otra el branding

- **Síntoma:** el canal SmartPay no se puede probar entero fuera de producción y no se ve por qué. La
  entidad que salta el AML y firma el acuerdo de bloqueo **no es** la que manda el correo con la marca
  SmartPay. Cada mitad funciona, así que ninguna prueba falla — simplemente nunca coinciden.
- **Causa raíz (verificada 2026-08-22 contra `main`):** la identidad del canal está resuelta con un
  literal por entorno, repetido en cuatro sitios, y **dos de ellos no dicen lo mismo**:

  | dónde | producción | fuera de producción |
  |---|---|---|
  | `config/lenders.php` (`smartpay_lender_id`) | 160 | **153** |
  | `app/Models/UserRequest.php` (`isSmartPay()`) | 160 | **152** |
  | `Modules/Onboarding/App/Services/BackDoorService.php` | 160 | **152** |
  | `Modules/Onboarding/App/Services/BackDoorUserService.php` | 160 | **152** |

  `Lender::isSmartpayChannel()` lee la config (**153**) y gatea el branding del mailer; `isSmartPay()`
  usa **152** y gatea la originación distintiva —salto de AML, acuerdo de bloqueo, desembolso
  diferido—. En producción los cuatro dicen 160 y el problema no se ve.
- **Evidencia (corrido en local, no deducido):** con `APP_ENV=local` y las dos entidades de path IMEI
  que trae el dump, `isImeiPath` es verdadero para las dos, pero `isSmartPay` sale **sí para la 152 y
  no para la 153**, mientras `isSmartpayChannel` sale **al revés**. O sea que **ninguna de las dos es
  SmartPay entera** fuera de producción.
- **⚠ Los números no son inocuos: en producción nombran entidades VIVAS y ajenas.** Medido el
  2026-08-22 en prod: la **152 es Refurbicredit** y la **153 es Crediemo**, las dos con desembolsos, y
  ninguna con path IMEI. La seguridad de todo esto descansa en que `app()->environment()` no se
  equivoque nunca, y **eso no está afirmado en ningún lado**. Lo que cuelga de esa identidad no es
  cosmético: `ContinueUserFlowController::confirm` **se salta el AML de TusDatos** cuando
  `isSmartPay()` es verdadero.
- **⚠ Y el comentario del código dice otra cosa que el código.** Junto al guard se lee «IMEI path skips
  AML validation», pero el guard es `isSmartPay()`, que exige **path IMEI *y* el id mágico**. Una
  entidad con path IMEI que no sea ese id **sí** corre el AML. Quien lea el comentario y no la función
  concluye al revés.
- **⚠ Esto SUPERA a F-21, que quedó viejo.** F-21 decía que fuera de producción `isSmartPay()` era
  siempre falso y que la originación distintiva estaba muerta. Se arregló el 2026-08-19 (el propio TODO
  del código cuenta que reventaba `confirm` al leer `expedition_date` en usuarios temporales), pero el
  arreglo **replicó el condicional con un número distinto al de la config**, que es como nació esta
  divergencia. El TODO ya nombra la salida correcta: sacar el id a configuración en vez de repetirlo.
- **Arreglo:** una sola fuente —la config que ya existe— y que los cuatro sitios la lean. Código de la
  empresa. **Estado:** vivo en `main`.

### F-156 · Un bloqueo de dispositivo que falla se reintenta para siempre y escribe una fila por intento: la garantía por hardware no se ejerce y nadie se entera

- **Síntoma:** ninguno. El cron de mora informa «Dispatched N device locking jobs» todos los días y
  termina bien. No hay error, ni alerta, ni estado que quede en rojo — sólo una fila más en
  `device_locks`. Del lado del negocio, un equipo en mora que el sistema cree estar bloqueando y no
  bloquea.
- **Lo que SÍ está verificado contra `main`:** `failed` no está en **ninguna** de las dos listas que
  deciden si hay que actuar. El cron excluye los productos con un lock `['locked','pending']`
  (`LockDevicesPastDueCommand`), y `activeDeviceLock` (`app/Models/UserRequestProduct.php:63`)
  considera activo sólo `['locked','unlock_failed']`. Un lock en `failed` no aparece en ninguna, así
  que **el producto vuelve a ser elegible al día siguiente**. Y el job **crea** la fila
  (`DeviceLock::create`), no la reutiliza.
- **⚠ PERO EL MECANISMO DE LA MULTIPLICACIÓN NO ESTÁ CONFIRMADO, y conviene saberlo antes de
  «arreglarlo».** Se intentó reproducir en local y **no se reproduce**: partiendo de cero, tres
  corridas del cron dejan **una** fila, no tres — con la cola en `sync` y también montando una cola
  asíncrona de verdad. Un intento fallido quema ~10 ids de auto-incremento (= `MAX_TRANSIENT_RETRIES`),
  o sea que los reintentos **sí** crean filas, pero se revierten y sobrevive una sola. En producción
  sobreviven todas, y **por qué difieren sigue abierto**. **Medido en producción, y NO es una carrera:** las filas
  de un mismo equipo salen **2 por día, separadas ~12 segundos, a la misma hora, todos los días** —
  secuenciales, no concurrentes. O sea que hay **dos multiplicadores encadenados**: el cron despacha
  **un job por fila del histórico de mora, no por solicitud** (medido: con 3 filas imprime
  `Dispatched 3`), así que un atraso de N días dispara N jobs; y como `failed` no excluye, **eso se
  repite cada día**. Lo que queda sin explicar es por qué en local esos N jobs dejan **una** fila y en
  producción dejan N.
- **Evidencia (medido en producción el 2026-08-22):** las proporciones lo delatan solas —
  `locked` va 1 fila por producto y `unlock_failed` también, pero `failed` va **323 filas sobre 41
  productos**, casi 8 por equipo. Repartidas por día: un producto acumuló **18 filas en 9 días
  seguidos** y otros dos vienen fallando **desde el 24 de junio**. Y lo que importa: **40 de esos 41
  equipos NUNCA llegaron a bloquearse** — ni una sola fila `locked` en toda su historia.
- **⚠ La consecuencia no es la tabla, es el producto.** El canal existe porque el celular ES la
  garantía y la cobranza se ejerce por hardware. Para esos 40 equipos —todos en mora, porque el cron
  sólo mira `days_past_due >= 8`— esa garantía **no se está ejerciendo**, y el reintento diario da la
  apariencia contraria: el sistema hace algo todos los días.
- **⚠ Y contamina cualquier conteo sobre `device_locks`.** Contar filas por estado no cuenta
  dispositivos: hay que contar `DISTINCT user_request_product_id`. Con filas, `failed` parece el
  estado más común del sistema; con dispositivos, es una minoría chica y atascada.
- **Lo que local SÍ permite** (sembrando a mano el ledger de mora `creditop_x_requests_history` —que en
  producción escribe **`application`**, no legacy— y con el mock del MDM al que se le puede **dictar el
  fallo**): ejercitar los tres comandos de punta a punta. El bloqueo y el desbloqueo funcionan y dejan
  **una** fila. Lo que no se puede reproducir ahí es la multiplicación.
- ⚠ **Un intento de arreglo que NO prosperó, anotado para que nadie lo repita:** reutilizar la fila
  `failed` en vez de crear una nueva. Medido en local con el A/B completo, **no cambia nada** —las dos
  ramas dejan una fila— porque local no reproduce el problema. **Arreglar esto a ciegas es escribir
  código que no se puede validar**; primero hay que entender por qué producción difiere.
- **⚠ POR QUÉ FALLAN — y la respuesta NO estaba en los logs, estaba en la base.** El job persiste la
  respuesta del proveedor en `device_locks.api_response`, así que la causa de cada fallo se consulta
  con SQL en vez de rastrear Loki. Las 323 filas la tienen. **Antes de ir a los logs por un job que
  falla, mirá si el job guardó la respuesta.**
- **⚠ El «40 equipos» necesita triaje: 13 son de un comercio de PRUEBA.** El comercio 292 «Comercio
  Prueba» aporta 13 equipos y 60 filas, y **no tiene `trustonic_tenant_key`** — el proveedor contesta
  «X-Lb-Tenant-Id header is required». O sea que hay datos de prueba en producción generando carga
  diaria y ensuciando cualquier métrica del canal. **Los equipos reales son 28, en 6 comercios.**
- **Y de esos 28, la causa NO es una sola** — son dos familias que se arreglan en lugares distintos:

  | causa | de quién es | equipos reales |
  |---|---|---|
  | el equipo está en otro estado (`DEVICE_INVALID_STATE` / *State transition*) | del proveedor / del equipo | **18, todos de un mismo comercio** |
  | el equipo no existe en el MDM (`device_not_found`) | inscripción que no cuajó | 5 |
  | `external_service` | transitorio del proveedor | 6 |
  | tenant inválido o ausente | **config nuestra** | 2 reales (+13 del comercio de prueba) |

  El grueso es **un solo cluster**: un comercio con 18 equipos que el MDM se niega a accionar. Eso es
  una conversación con el proveedor, no un arreglo de código — y es donde está el 64% del daño real.
- **Arreglo:** son dos, y separarlos importa. **(a)** la multiplicación de filas — pero **primero hay
  que entender el mecanismo**, porque no se reproduce en local y el arreglo obvio (reutilizar la fila)
  no se puede validar ahí. Descartada la carrera, lo que queda por entender es
  por qué los N jobs de un mismo día dejan N filas en producción y una sola en local — y ahí el
  candidato es la diferencia de entorno de cola, no el código.
  **(b)** las causas de arriba, cada una en su dueño. ⚠ **Arreglar (a) sin (b) deja a los mismos
  equipos igual de desprotegidos, sólo que con menos filas** — y encima les quita la única señal
  visible de que algo pasa. Código y config de la empresa. **Estado:** vivo en `main`, con **28 equipos
  reales** sin bloquear en producción.

### F-157 · `path = IMEI` NO significa «el celular es la garantía»: cuatro entidades lo tienen y desembolsan sin inscribir el equipo

- **Síntoma:** se lee que el canal IMEI existe porque el celular financiado ES la garantía, se mide
  cuántos créditos desembolsados tienen equipo inscrito, y sale que **casi la mitad no lo tiene**. La
  conclusión fácil —«se está desembolsando sin garantía»— es **falsa**, y por qué lo es importa más que
  el número.
- **Causa raíz (verificada 2026-08-22 contra `main` y medida en producción):** hay **dos**
  discriminadores y gatean cosas distintas. `UserRequest::isImeiPath()` (el `path` de la entidad) gatea
  el **servicing** —los crons de bloqueo—; `UserRequest::isSmartPay()` (path IMEI **y** el id del
  canal) gatea la **originación distintiva**: el salto de AML, el acuerdo de bloqueo, el desembolso
  diferido y el `device/register`. Una entidad puede tener `path = IMEI` **sin ser SmartPay**, y
  entonces origina como un CreditopX cualquiera: autoriza derecho, **sin inscribir ningún equipo**.
- **Evidencia (producción):** de las cinco entidades con `path = IMEI` que tienen desembolsos, **la del
  canal SmartPay tiene el equipo inscrito en el 100 % de los casos**. Las otras cuatro no: una acumula
  **596 desembolsos sin equipo contra 6 con equipo**, otra 158 sin contra 966 con. O sea que el grueso
  de los créditos con `path = IMEI` **nunca pasó por el enrolamiento**, y no por un fallo: porque ese
  camino no se les aplica.
- **⚠ Qué NO concluir.** Que esos créditos «perdieron la garantía» — no puede perderse algo que su
  originación nunca constituyó. Si esas entidades se venden como cobranza por hardware es una pregunta
  de negocio; el código sólo dice que no la ejercen. **Y al revés: para medir la salud del canal, filtrá
  por la entidad del canal, no por `path = IMEI`** — el path incluye entidades que juegan otro juego.
- **⚠ Y un riesgo latente que sí es del código:** `LoanAuthorizationService::authorize()` **no tiene
  ninguna guarda para el path IMEI**. Tiene la del codeudor (`deferred_for_cosigner`) pero no ésta, así
  que llamar al `authorize` estándar sobre una solicitud del canal la lleva a **estado 11 sin equipo
  inscrito**. Reproducido en local: la misma entidad cerrada por el camino correcto queda con IMEI, y
  cerrada por `authorize` queda con `NULL`. En producción **no está ocurriendo** (0 casos en la entidad
  del canal) porque el wizard sigue la secuencia buena — pero ⚠ **la respuesta del `verify-otp` devuelve
  `next_step: "authorize"`**, o sea que la API le está indicando al cliente justo el camino que la
  saltearía. Dos guardas simétricas, una sola implementada.
- **Arreglo:** para el riesgo latente, la misma guarda que ya existe para el codeudor. Para la lectura,
  no usar `path = IMEI` como sinónimo del canal. Código de la empresa. **Estado:** vivo en `main`.

### F-158 · Escribir el INGRESO de Experian pisa la OCUPACIÓN con «Empleado» quemado, y con eso ninguna regla que exija «Independiente» puede cumplirse

- **Síntoma:** una entidad no aparece en el listado y su regla se lee razonable. Se dicta el buró para
  cumplirla, se confirma que el buró llegó bien, y la entidad **sigue sin salir**. Del lado del
  usuario: «esta entidad nunca sale en pruebas».
- **Causa raíz (verificada 2026-08-23 contra `main`, en logs y en BD):** al persistir el ingreso
  promedio de *quanto*, `app/Actions/RiskCentrals/Experian.php:735` **también escribe el campo 29
  (ocupación) con el literal `'Empleado'`**. No es una decisión sobre la persona: es un efecto
  secundario de escribir el campo 87. Y pisa lo que **sí** se dedujo del historial laboral —
  `AgildataService` compara el nombre del empleador contra el de la persona y devuelve `Independiente`
  cuando coinciden (quien se cotiza a sí mismo).
- **Evidencia:** en una misma solicitud, los logs muestran `Storing labor info (flow A)` con
  **`Independiente`** una vez —el resultado correcto de Agildata— y después
  `UserFieldValue field 87 updated, writing field 29 (employment_situation = Empleado)`. En la base
  queda **una sola fila** del campo 29, con `Empleado`, mientras `user_summaries.agildata` conserva
  `self_employed: true`. **Los dos datos conviven contradiciéndose**, y el que leen las reglas es el
  pisado.
- **⚠ La consecuencia no es cosmética:** la regla de Credifamilia (`lender_rules` del `group_rule`
  7751) exige `ocupación = Independiente`. Con este pisado, **esa condición es inalcanzable por este
  camino** — la entidad queda excluida siempre, sin error, sin log de rechazo por regla y sin que nada
  lo señale.
- **⚠ Y hay TRES implementaciones de `storeLaboralInformation`** —`AgildataService`, `MareiguaService` y
  `OnboardingService`—; el propio código lo marca con un *«TODO: refactor this duplicated method»*.
  Con tres escritores del mismo campo, **el resultado depende del orden**, y el orden no está declarado
  en ninguna parte. Antes de concluir de dónde salió una ocupación, mirá cuál escribió última.
- **⚠ Al depurar esto NO alcanza con verificar que el buró llegó.** Llegó, se interpretó bien, y el
  resultado correcto quedó escrito — y después se perdió. Un chequeo de «¿el dato llegó?» pasa en verde
  (es la trampa de F-139 con otra cara): hay que mirar el valor FINAL del campo, no el del buró.
- **⚠ Y arreglarlo NO alcanza para que Credifamilia liste** — medido el 2026-08-23 en una rama local
  con el pisado desactivado. Con la ocupación en `Independiente`, edad 25, ingreso 3.000.000, sin
  reportes y score 760, la regla de grupo pasa a **`aprobado`** en la forense… y la entidad **sigue sin
  aparecer en el listado**. O sea que hay **al menos un filtro más abajo, y ese no loguea nada**: la
  forense de reglas no lo ve. Los tres gates ya descartados (ocupación, la regla de grupo 7751 y el
  score mínimo de `lender_datacredito_rules`, que para esa sucursal es **710**) quedan documentados
  para no volver a recorrerlos.
- **Arreglo:** que escribir el ingreso no escriba la ocupación. Código de la empresa. **Estado:** vivo
  en `main`.

### F-159 · El perfilamiento por datacrédito lee OTRA central que la que escribe el flujo sintético: en local esa etapa entera no corre, y no avisa

- **Síntoma:** ninguno. El listado sale, las reglas se evalúan, la corrida termina bien — y una etapa
  completa de validación **nunca se ejecutó**. Al depurar por qué una entidad aparece o no, se razona
  sobre reglas que en local no llegaron a correr.
- **Causa raíz (verificada 2026-08-23 contra `main`):**
  `ProfilingRulesService::applyProfilingAndRiskCentralRules` busca la central por **nombre exacto**:
  `RiskCentral::firstWhere('name', 'Experian - Acierta')` (id **1**), y sólo si encuentra una fila con
  score para ese usuario llama a `validateRulesByRiskCentral`. El recorrido sintético del harness
  persiste bajo **`Experian - Acierta+Quanto`** (id **9**), que es otra fila. Sin coincidencia, el
  bloque entero se saltea **sin log de que se salteó**.
- **Evidencia:** las dos centrales existen como filas distintas en el catálogo. En **producción se
  escriben las dos** —la id 1 con ~117 mil filas y la id 9 con ~35 mil, ambas vigentes—, así que allá
  el perfilamiento sí encuentra su fila. En local, el usuario sintético queda sólo con la id 9.
- **⚠ Por qué importa más de lo que parece:** el comercio también tiene que estar en
  `datacredito_frequencies` para que el bloque corra. Son **dos condiciones**, y cualquiera de las dos
  que falte produce el mismo silencio. Antes de concluir que «el perfilamiento no excluye», comprobá
  que corrió.
- **⚠ Misma familia que F-139 y F-140:** en local, lo que falta no falla — se saltea. El resultado es
  plausible y está incompleto.
- **Arreglo:** para PROBAR el perfilamiento en local hay que sembrar también la fila de
  `Experian - Acierta`. Para el producto, que la búsqueda por nombre exacto sea una decisión explícita
  y no una coincidencia de catálogo. **Estado:** vivo en `main`.

### F-160 · La configuración de reglas del dump local NO es la de producción: se depura contra umbrales que allá no existen

- **Síntoma:** una entidad no aparece en el listado local, se encuentra la regla que la excluye, se
  ajusta el caso para cumplirla… y en producción esa regla **ni siquiera está activa**. Se depuró
  contra una condición inventada por el dump.
- **Causa raíz (medido el 2026-08-23, la misma entidad y la misma sucursal en los dos lados):** la
  regla de datacrédito de Credifamilia difiere de forma drástica.

  | | score mínimo | antigüedad en el sector | moras permitidas |
  |---|---|---|---|
  | **producción** | **0** | **0** | 1000 |
  | **dump local** | **710** | **12** | 10 |

  En producción la regla está prácticamente desactivada; en local exige score 710 y doce meses de
  historia. **Ninguna de las dos es «la» configuración** — pero sólo una es la que corre para clientes
  reales.
- **⚠ Lo que esto invalida:** cualquier conclusión de la forma «esta entidad no sale porque no cumple
  X» sacada en local, **si X es un umbral de reglas**. Antes de escribir esa frase, comparalo con
  producción: `lender_datacredito_rules` y `lender_rules` son dos consultas.
- **⚠ Y no es sólo el umbral: el padrón también difiere.** La misma sucursal tiene **8 entidades
  activas en producción y 5 en local**. Un listado local puede omitir entidades que allá se ofrecen, y
  eso se lee como una regla de negocio.
- **⚠ Lo que NO explica:** alineando la regla local con la de producción, la entidad **sigue sin
  listar**. O sea que esta divergencia es real e importante, pero **no es la causa** de esa ausencia —
  la causa sigue abierta (→ ver el nodo `credifamilia`).
- **Cómo se encontró, que vale como método:** en vez de seguir preguntando «por qué no sale acá», se
  buscó en producción **una solicitud donde sí salió** y se compararon las dos configuraciones. Contra
  catorce cortes descartados leyendo código, la comparación con producción dio dos hechos en minutos.
- **Arreglo:** para depurar reglas, comparar siempre local contra producción antes de concluir. Para el
  dump, sería refrescar esa configuración. **Estado:** vigente.

### F-161 · Hay DOS `getLenders` y el que se lee no es el que corre: la clase hija nunca se ejecuta

- **Síntoma:** se depura el listado leyendo `LenderListingService::getLenders`, se descartan cortes uno
  por uno, y ninguno explica la ausencia de una entidad. Instrumentar ese método **no imprime nada**,
  aunque el código esté en el contenedor y los logs de esa solicitud sí lleguen.
- **Causa raíz (verificada 2026-08-23 contra `main`):** hay **DOS RUTAS DE LISTADO Y DOS CLASES**, y
  cada ruta usa la suya:

  | ruta | controlador | servicio |
  |---|---|---|
  | `lenders/{ur}` (v1) | `ListLenderController` | `LenderRetrievalService::getLenders` (**el padre**) |
  | `lenders-v2/{ur}` | `LenderListingController` | `LenderListingService::getLenders` (**la hija**) |

  `LenderListingService` **extiende** `LenderRetrievalService` y las dos definen `getLenders` con la
  misma firma. Ninguna está muerta — pero **leer una para explicar el comportamiento de la otra es
  leer código que no corre en ese camino**, y eso fue exactamente lo que pasó.
- **⚠ Y las dos implementaciones NO son iguales**, que es lo que vuelve el error caro: la del padre
  tiene lógica que la hija no —una compuerta por créditos previos del cliente en ese comercio, y una
  **exclusión de entidades por id quemado** que la hija no tiene—. O sea que las conclusiones sacadas
  leyendo la hija no sólo no aplican: pueden ser lo contrario de lo que pasa.
- **Evidencia, y es contundente porque las dos rutas responden a la MISMA solicitud:** v1 devuelve
  **3 entidades** y v2 devuelve **5**. Las dos que faltaban en v1 son justo las que se estaban
  persiguiendo. Además, instrumentar la hija mientras se llamaba a v1 no produjo **una sola línea** —
  ausencia total, no parcial, que es la firma de un método que no corre por ese camino.
- **⚠ Y NO devuelven lo mismo porque v1 arrastra cortes que v2 no tiene**, entre ellos la lista de ids
  quemada `[12, 23, 141, 142, 166]` y las salidas de la pre-aprobación. **El wizard usa v2**, así que
  medir contra v1 es medir un listado que ningún cliente ve — y una ausencia ahí se lee como regla de
  negocio cuando es el endpoint equivocado.
- **⚠ Cómo detectarlo rápido la próxima vez:** antes de leer un servicio, **mirá qué inyecta el
  controlador de la ruta**. Un `extends` con el mismo nombre de método es invisible desde adentro del
  archivo; sólo se ve en el punto de inyección.
- **Lo que estaba tapando:** dos ausencias que costaron catorce descartes. **Welli y Credifamilia no
  aparecían… en v1.** En v2 aparecen las dos, sin tocar nada más. Los cortes que las sacaban —la lista
  quemada y las salidas de la pre-aprobación— viven en el camino viejo.
- **⚠ Cómo detectarlo rápido la próxima vez:** antes de concluir de una ausencia, **pedí las DOS rutas
  para la misma solicitud y compará**. Son dos `curl` y descarta de un saque todo lo que acá costó
  horas.
- **Arreglo:** para el diagnóstico, entrar por el controlador. Para el código, que dos clases de la
  misma jerarquía no definan el mismo método público con implementaciones distintas. **Estado:** vivo
  en `main`.

### F-162 · Las reglas de grupo CLASIFICAN, no excluyen — y confundirlas hace ver «mala configuración» donde no la hay

- **Síntoma:** se abre la configuración de una entidad, se ve que su regla exige una ocupación
  concreta, se compara con los clientes reales y **no coincide**. Parece un error de parametrización
  que estaría dejando gente afuera.
- **Lo que en realidad pasa (medido en producción el 2026-08-23):** en las sucursales cuya regla exige
  **sólo `Independiente`**, la misma entidad cerró **1.923 créditos de clientes `Empleado`** —más que
  de independientes (755)—, además de 294 pensionados y hasta un desempleado. **La regla no impide
  nada**: la entidad sigue apareciendo y el crédito se otorga igual.
- **Por qué importa:** la conclusión «esta entidad no aparece porque el cliente no cumple la regla de
  grupo» es **falsa por construcción**. Esas reglas mueven la *clasificación* —la probabilidad y el
  orden—, no la presencia en el listado. Quien busque una ausencia ahí va a encontrar una
  discrepancia real y **una explicación equivocada**.
- **⚠ La configuración además es dispar, y eso confunde más:** la misma entidad tiene **cinco formas
  distintas** de esa regla repartidas entre sus sucursales —desde `Independiente` sola hasta las cuatro
  ocupaciones juntas—. La dispersión invita a leerla como intencional; los números dicen que da lo
  mismo.
- **Cómo se descartó, que es el método:** en vez de discutir si la regla estaba bien puesta, se contó
  **cuántos créditos reales la violan y se otorgaron igual**. Con 1.923 casos, la pregunta se contesta
  sola.
- **Arreglo:** ninguno de código. Lo que hay que arreglar es **dónde se busca la causa de una
  ausencia** → ver el mapa de exclusiones en el nodo `creditopx`. **Estado:** vigente.

### F-163 · La credencial de Deceval del dump LOCAL trae claves de Experian — y el error no lo dice

- **Síntoma:** cerrar una solicitud de Credifamilia en local muere con `Undefined array key
  "deceval_username"` → `DecevalIntegrationException` → HTTP 502, y la solicitud queda en **estado 28**.
  El mensaje señala una clave ausente, así que se lee como código que olvidó un campo.
- **Lo que en realidad pasa (medido el 2026-08-23):** `DecevalSoap` pide la credencial con
  `RiskCentralCredential::findForUserRequest($decevalCentral, $userRequest, $userRequest->lender_id)`,
  que **prefiere la fila del LENDER sobre la del comercio**. En local esa fila (id 6, `Lender#24`)
  contiene `experian_username` / `experian_password` — **claves de otra central** — donde deberían ir
  `deceval_username` / `deceval_password`. Las filas del comercio (ids 4 y 5) sí las traen, pero nunca
  se consultan.
- **⚠ NO es un bug de producción, y eso se midió antes de escribirlo:** en prod, Credifamilia lleva
  **550 solicitudes en 90 días, 296 en estado 11 y CERO trabadas en 28** (la última del 2026-08-22).
  Además las filas **no son las mismas**: prod tiene `Lender#24` en el **id 7** —otra fila— y una
  `Lender#181` que en local no existe. O sea, la de local es deriva del dump, no una copia de prod.
- **Por qué importa:** es una trampa de las caras. El síntoma apunta al código, el código está bien, y
  el dato malo vive en una tabla cifrada que no se puede leer con un `SELECT` —hay que decodificarla
  desde la aplicación—. Sin este hallazgo, el camino natural es depurar `DecevalSoap` durante horas.
- **Arreglo (sólo local):** completarle a la fila las dos claves copiándolas de la del comercio:

      $src = json_decode(json_encode(RiskCentralCredential::find(5)->credential), true);
      $dst = RiskCentralCredential::find(6);
      $cur = json_decode(json_encode($dst->credential), true);
      $cur['deceval_username'] = $src['deceval_username'];
      $cur['deceval_password'] = $src['deceval_password'];
      $dst->credential = $cur; $dst->save();

  **Estado:** vigente en local. En producción no aplica.

### F-164 · Deceval: cuatro operaciones, cuatro contenedores y TRES criterios de éxito distintos

- **Síntoma:** un mock de Deceval que devuelve un sobre con todos los nodos que el parser lee —y con
  `exitoso=true`— falla igual, con **«sin respuesta»** o con **«no exitoso»**. Los dos mensajes se leen
  como que el proveedor no contestó o rechazó, cuando contestó y aceptó.
- **Lo que en realidad pasa:** `DecevalSoap.php` entra por el **contenedor**, con
  `getElementsByTagNameNS('http://deceval.com/sdl/services/', …)`, y el contenedor **tiene otro nombre
  en cada operación**. Un sobre con los hijos correctos pero el contenedor equivocado da
  `count() === 0`, que el código traduce a «sin respuesta» — indistinguible de «no llegó nada».

  | petición | contenedor de la respuesta | cómo juzga el éxito |
  |---|---|---|
  | `CreacionGiradoresCodificados` | `RespuestaCrearGiradorDaneServiceDTO` | `exitoso === 'true'` |
  | `CreacionPagaresCodificado` | `RespuestaDocumentoPagareDaneServiceDTO` | `exitoso === 'true'` |
  | `consultarPagares` | `RespuestaConsultarPagaresDTO` | `exitoso`, y además lee `estadoPagare` |
  | `firmarPagares` | `RespuestaFirmarPagaresDTO` | **ignora `exitoso`**: pide `descripcion` empezando con `SDL.SE.0000` |
- **⚠ La cuarta es la que muerde.** `signPagare` no mira `exitoso` en absoluto: exige que `descripcion`
  arranque con el código `SDL.SE.0000`. Un sobre con `exitoso=true` y una descripción en prosa se
  rechaza, y el log dice **«signPagare no exitoso»** — apuntando al nodo que sí estaba bien.
- **El namespace es obligatorio** en el contenedor (la búsqueda es NS-aware) y **no** en los hijos, que
  se leen con `getElementsByTagName`, por nombre calificado.
- **Arreglo:** ninguno de código — es cómo habla el proveedor. Lo que se arregla es **saberlo antes**:
  el mock local (`harness/mock-deceval/`) ya ramifica por operación y lo documenta. **Estado:** vigente.

### F-165 · Credifamilia (rt=4) necesita SEIS externos, y cada uno faltante se ve igual: estado 28

- **Síntoma:** una solicitud de Credifamilia no llega a estado 11 y queda en **28**, con un mensaje que
  habla del proveedor. Cada muro tapa al siguiente: se resuelve uno y aparece otro, con otro mensaje.
- **La fila completa, medida el 2026-08-23 arrancando desde «no lista» hasta estado 11:**

  | # | muro | qué se ve | qué faltaba |
  |---|---|---|---|
  | 1 | el listado | la entidad no aparece | se consultaba `lenders` (v1) y el wizard usa **`lenders-v2`** (F-161) |
  | 2 | pre-aprobación | HTTP 500 | `PRE_APPROVALS_BASE_URL` sin apuntar al mock |
  | 3 | plan de pagos | falta `transaction_data` | el mock no devolvía las cinco claves del builder |
  | 4 | documentos legales | `vinculacion` sin generar | `mock-pdf-mapper` (:8100) no lo levanta nadie |
  | 5 | pagaré | `Error al generar pagaré Deceval` | Deceval: credencial (F-163) + mock (:8106, F-164) |
  | 6 | firma | `NETCO_PASSWORD_DERIVATION_SECRET is missing` | Netco: cinco variables + mock (:8107) |
- **Por qué importa:** ninguno de los seis mensajes nombra al mock que falta. Los seis se leen como
  hechos del negocio —«el proveedor rechazó», «falta un dato de la solicitud»— y llevan a depurar el
  código. Es el mismo modo de falla de F-139, F-140 y F-142, ahora con seis piezas en fila.
- **Arreglo:** el prevuelo de `harness/dev/caso.ts` ya comprueba Deceval y Netco cuando el caso va a
  cerrar, y los dos mocks tienen launcher (`bin/mock-deceval`, `bin/mock-netco`). La receta completa
  vive en el nodo `credifamilia`. **Estado:** resuelto para local.
- **⚠ Y lo que esto NO prueba:** ni el pagaré ni la firma son reales. Un pagaré desmaterializado vale
  justamente porque no se puede simular, y el «PDF firmado» que devuelve el mock de Netco es el mismo
  que entró. Un verde acá dice «la orquestación corre», nunca «el título es válido».

### F-166 · La firma de Credifamilia corre DENTRO de una transacción abierta — y cuando se traba, tres capas borran la causa

- **Síntoma:** dos autorizaciones simultáneas de Credifamilia y el cliente recibe
  `HTTP 500 · Error al procesar la autorización del crédito: There is no active transaction`. La
  solicitud queda en **estado 28**. El mensaje habla de transacciones, así que se lee como un bug del
  framework o de un `commit` mal puesto.
- **Reproducido el 2026-08-23 en local:** la misma suite de tres casos cierra **3/3 en serie** y
  **1/3 en paralelo**. No es aleatorio: es concurrencia.
- **⚠ Y el borde es más angosto de lo que parece — se midió:** lo que choca son **dos autorizaciones
  de la MISMA entidad rt=4**, no el paralelo en general. `pullman + motai + una Credifamilia` cierra
  **3/3 en estado 11**; agregándole una **segunda** Credifamilia, esa segunda es la única que cae —las
  otras tres siguen cerrando—. Tiene sentido con la causa: el lock está en `netco_signing_documents`, y
  **sólo rt=4 firma con Netco**. Los rt=2 no tocan esa tabla, así que no compiten.
- **Regla práctica mientras no se arregle:** en una corrida paralela, **una sola solicitud de
  Credifamilia a la vez**; el resto de los comercios y entidades pueden ir en paralelo sin problema.
- **⚠ Y EN rt=2 EL MISMO DISEÑO SE MANIFIESTA COMO LENTITUD, NO COMO DEADLOCK — medido.** Con nueve
  casos en paralelo, la generación de documentos de **CrediPullman y Motai tardó 90.002 ms**: clavó el
  límite de espera del runner. En aislamiento los mismos casos cierran, y el paso tarda **3 s**
  (Credifamilia), **18 s** (DHI X) o **35 s** (Motai). No es saturación de máquina —medido con load 2,29
  sobre 12 CPUs y el contenedor al 0,14 %—: es la transacción abierta serializando el trabajo.
- **⚠ Y eso se leía como una caída.** El runner reportaba «devolvió HTTP 0», que manda a buscar un
  backend muerto. Ahora distingue: «se pasó de los 90 s de espera (no falló: tardó)». La diferencia
  cambia dónde se busca la causa.
- **Lo que en realidad pasa, y son tres capas de enmascaramiento encadenadas:**
  1. **`LoanAuthorizationService` abre `DB::beginTransaction()` y llama a `generateAllDocuments()`
     dentro.** Ahí adentro se firman los seis documentos, y firmar significa **una llamada HTTP a Netco
     y un `put` a S3 por documento** (`DocumentSigningService:453` → `NetcoSignerProvider`). O sea que
     los locks de fila se sostienen durante **doce viajes de red**. Con dos solicitudes a la vez,
     `update netco_signing_documents` se traba: `SQLSTATE[40001] · 1213 Deadlock found`.
  2. **El `catch` que lo atrapa se llama `$s3Error`, pero su `try` NO envuelve sólo el S3**: encierra
     también el `$row->update([...])` que va después. Un deadlock de base de datos sale por ahí y se
     registra como **`netco.s3_put_failed_after_sign`**, con `s3_error_class` y `s3_error_message` — y
     se **persiste** en `netco_signing_documents.last_error_code` con el prefijo `S3_FAILED:`. La
     etiqueta equivocada queda guardada en la base, no sólo en el log.
  3. **La recuperación de ese `catch` repite el mismo `update` que acaba de fallar** — MySQL ya abortó
     la transacción entera al detectar el deadlock, así que vuelve a fallar. Cuando el `catch` de
     arriba hace `DB::rollBack()`, ya no hay nada que revertir: **`There is no active transaction`**, y
     esa excepción **reemplaza** a la original. Eso es lo único que ve el cliente.
- **Por qué importa:** quien depure esto entra por «no hay transacción activa» (capa 3), y si consigue
  llegar al log encuentra «falló el S3» (capa 2). **Ninguna de las dos nombra el deadlock**, que es la
  causa. Y el dato que quedó guardado en la fila miente igual.
- **⚠ HOY NO PASA EN PRODUCCIÓN, y se midió antes de escribirlo:** cero líneas con `Deadlock` en
  `legacy-backend` en 24 h (control: `Exception` da 120 en la misma ventana, así que la consulta
  funciona), cero solicitudes de Credifamilia trabadas en 28, y 296 de 550 en estado 11 en 90 días. **Lo
  que lo tapa es el volumen**: son ~6 solicitudes de Credifamilia por día, y dos rara vez se solapan.
  Es un defecto **latente**, no uno activo — pero el que lo despierte va a ser el crecimiento, y para
  entonces el diagnóstico ya viene con dos etiquetas falsas puestas.
- **Arreglo (propuesto, NO aplicado):** tres cosas, en orden de valor —
  **(a)** sacar las llamadas remotas de adentro de la transacción, o acotar la transacción a la
  escritura final; **(b)** angostar el `try` para que el `catch` de S3 atrape sólo el S3, y que un
  `QueryException` se propague con su nombre; **(c)** no reintentar dentro del `catch` el mismo
  `update` que falló. **Estado:** vigente, sin tarea abierta.

### F-167 · El plazo del crédito lo dicta el cliente: `confirm-payment-schedule` no valida contra los plazos simulados

- **Síntoma:** no hay síntoma. Ése es el punto — el crédito queda con un número de cuotas que la
  entidad nunca ofreció y todo lo demás se ve normal: cierra en estado 11, con sus documentos y su
  pagaré.
- **Lo que en realidad pasa (verificado en el código y reproducido el 2026-08-23):**
  `ConfirmPaymentScheduleRequest::rules()` valida `selected_cycle.fee_number` con
  **`required|integer|min:1`** — cualquier entero positivo, no uno de los plazos simulados. Y el campo
  que el controlador **usa de verdad** es el `fee_number` de primer nivel
  (`PaymentScheduleController:138` → `feeNumber: $request->fee_number`), que **no aparece en las reglas
  en absoluto**: no lo valida nada.
- **Reproducido:** con la entidad simulando **6, 12, 18 y 24**, se confirmó con **36** y la solicitud
  cerró en estado 11 con `user_requests.fee_number = 36`. El plazo no estaba en la simulación y nadie
  lo objetó.
- **Por qué importa:** el número de cuotas no es un dato cosmético — determina la cuota, el plan de
  pagos y lo que dice el pagaré. Si el cliente lo elige libremente, el título puede quedar emitido por
  un plazo que la entidad no aprobó.
- **⚠ Lo que NO se puede afirmar:** que esto haya pasado en producción. En 180 días, Credifamilia
  muestra 36 (409), 24 (321), 6 (123), 12 (52), 18 (43), 9 (12) y una cola de **4 (6) y 3 (4)**, más
  35 en `0` —que son solicitudes que nunca eligieron plazo, no un plazo raro—. Esa cola de diez filas
  **podría** ser el hueco ejercido o podría ser un catálogo que en su momento las ofrecía: no se sabe
  qué plazos estaban vigentes cuando se crearon, así que **queda como pregunta abierta, no como hecho**.
- **Arreglo (propuesto, NO aplicado):** validar el plazo contra los términos que devolvió la simulación
  para esa solicitud, y usar un solo campo en vez de dos —hoy se valida uno y se usa el otro—.
  **Estado:** vigente, sin tarea abierta.

### F-168 · «Autorizada» no es «radicada»: el crédito puede quedar en estado 11 sin haberse enviado al lender

- **Síntoma:** no hay síntoma. La solicitud queda en **estado 11**, el endpoint de autorización
  responde **HTTP 200** y cualquier runner reporta que cerró. El crédito **nunca llegó al lender**.
- **Lo que en realidad pasa (medido el 2026-08-23):** la radicación —mandarle a Credifamilia el
  paquete de documentos por SOAP (`transaccionConsumo` + `guardarDocumentoOpenKm`)— es un paso
  **posterior** al estado 11 y **no lo mueve**. Si falla, se registra en `lender_transactions` con
  estado `CREDIT_ERROR` y nada más cambia: ni el estado de la solicitud, ni el código HTTP.
- **Cómo se destapó:** en local el backend salía al **sandbox real del lender**
  (`pruebas.credifamilia.com.mx`), que desde acá da **504**. La transacción quedaba en `CREDIT_ERROR` y
  la corrida decía «CERRÓ en estado 11». Se vio sólo yendo a mirar la tabla.
- **⚠ Y hay un segundo problema en eso mismo:** hasta que se apuntó al mock, **cada corrida local
  mandaba una solicitud sintética al ambiente de pruebas de Credifamilia**. No es sólo lentitud.
- **Por qué importa:** «llegó a 11» es la vara con la que se mide si un flujo funciona, y **no alcanza**
  para esta familia. Un tablero, una prueba o un reporte que cuente estados 11 puede estar contando
  créditos que el lender nunca recibió.
- **Cómo se comprueba:**

      SELECT s.name FROM lender_transactions t
        LEFT JOIN lender_transaction_statuses s ON s.id = t.status_id
       WHERE t.user_request_id = ? ORDER BY t.id DESC LIMIT 1;

  `CREDIT_COMPLETED` es lo único que significa radicado. `CREDIT_REGISTERED` es a mitad de camino: la
  operación se registró pero el documento no se envió.
- **⚠ Un catálogo sin sembrar lo empeora:** si faltan los `lender_transaction_statuses` del lender, el
  intento de registrar el error tira `RuntimeException` y **tapa la causa real**. El mensaje al menos
  nombra el seeder (`Database\Seeders\Lenders\CredifamiliaConsumoSeeder`, idempotente).
- **Arreglo:** en el harness, `dev/caso.ts` ahora **lee y reporta** el estado de la radicación en cada
  cierre, y las suites pueden exigirlo con `"radicacion": "CREDIT_COMPLETED"`. Comprobado que la guarda
  atrapa: con el mock en modo rechazo, las tres corridas llegan a estado 11 y la suite **falla**.
  **Estado:** vigente — el producto sigue sin distinguir las dos cosas fuera de esa tabla.

### F-169 · El rotativo (rt=3) revienta si el cliente NO tiene cupo previo — un acceso sin guarda entre tres que sí la tienen

- **Síntoma:** una solicitud de una entidad rotativa muere generando documentos con
  `HTTP 500 · Attempt to read property "fga" on null`. No es una regla de negocio: es un crash de PHP.
- **Dónde:** `Modules/Loans/App/Services/GuaranteeService.php:227`

      $revolvingCredit = $this->revolvingCreditRepository->getByUserAndLender(...);
      $guarantee = !$alreadyHasGuaranteeAcceptance && $revolvingCredit->fga > 0;   // ← sin guarda

  **Los otros tres lugares que leen lo mismo sí preguntan primero** (`if ($revolvingCredit)`):
  `ConsentService:271`, `GuaranteeService:255` y `PaymentCalculationService:223`. O sea que la asimetría
  es de este renglón, no del diseño.
- **Qué lo dispara:** una solicitud rt=3 de un cliente **sin fila en `creditop_x_revolving_credits`**
  para esa entidad. Reproducido en local el 2026-08-23 con un cliente nuevo.
- **⚠ En producción NO ocurre hoy, y se midió:** de **122 solicitudes rt=3 en 90 días, las 122 tenían
  cupo previo** — ninguna excepción. El rotativo se le ofrece a quien ya tiene la línea.
- **⚠ Y lo que NO está establecido:** **por qué** no ocurre. En local la entidad rotativa **sí aparece
  en el listado** de un cliente sin cupo —el runner la eligió de ahí—, así que el camino existe. Si en
  producción no aparece, es por algo que no se identificó; si aparece, el crash está a un clic. Esa
  pregunta queda abierta y es la que decide si esto es una corrección menor o un 500 esperando.
- **Dónde queda la solicitud:** en **estado 10 «Pendiente de autorización»** — no en 3 como las que
  deciden afuera, ni en 28. O sea que el rotativo **avanza más** que rt=0/1 y muere justo antes de la
  autorización, en la generación de documentos.
- **Arreglo (propuesto, NO aplicado):** la misma guarda que tienen los otros tres.
  **Estado:** vigente.

### F-170 · El webhook de las entidades rt=1 NO vive en `legacy-backend` — y la mitad que sí está, rechaza siempre

- **La pregunta que contesta:** «las rt=1 avisan el resultado por webhook, ¿se puede simular?». Sí
  avisan, pero **no por donde uno buscaría**, y por eso conviene tener el mapa antes de intentarlo.
- **Lo medido en producción (90 días, `response_type = 1`):** llegan a estado final **6.146**
  solicitudes, y **el asesor es el canal principal, no el ecommerce**: 4.690 autorizadas por asesor
  contra 240 por ecommerce. Las que autorizan son **Welli (2.631), Meddipay (1.538), Bancolombia (534)
  y Prami (227)**.
- **⚠ Y ninguna de ésas la cierra `legacy-backend`.** El único cierre de rt=1 que hay en este repo es el
  `switch ($lender->name)` de `ValidateOtpController::validateLenderOtp`, y sólo tiene casos para
  **`Compensar`** y **`Sistecrédito`** — que suman **cero** autorizaciones en esos 90 días. O sea que el
  camino que existe acá no es el que se usa.
- **Dónde está el que se usa: en `legacy-application`**, el monolito viejo, y con **dos mecanismos
  distintos** que no conviene confundir:
  - **webhook server→server** — Bancolombia: `bnpl/webhook`, `consumer-loan/webhook` y sus variantes
    `-by-user-request`;
  - **URL de retorno** (vuelve el navegador del cliente, no el lender) — Meddipay
    `/meddipay/respuesta-exitosa/{userRequest}`, Bancolombia consumo
    `/consumo/respuesta-en-proceso/{userRequest}`.
- **La mitad receptora ya está escrita en `legacy-backend`, pero desconectada:** `Welli` tiene su
  `STATUS_MAP` completo (`fulfilled`→11, `pendiente_desembolso`→11, `dismissed`→8, `fraud`→6, …) y un
  `authorize()` que valida un bearer token. Le faltan **dos cosas**:
  1. **no hay ninguna ruta** que reciba el webhook — `webhooks.php` tiene ocho rutas y ninguna es de una
     entidad;
  2. **`authorize()` lee `services.welli.webhook_token`, que NO está declarado en `config/services.php`**
     (sólo está `host`). Con la clave ausente el token esperado es `null` y el guard **lanza
     `Unauthorized` siempre**, aunque el llamante traiga el token correcto.

  El propio código lo dice: `// Not used yet, uncomment when Welli webhook is migrated`.
- **Consecuencia para probar:** **no se puede dar desenlace a un rt=1 contra `legacy-backend` hoy**, ni
  con mocks. El mock tendría a quién llamar sólo en el monolito viejo, que el harness no maneja. Lo que
  sí se puede es **listar** y comprobar que la solicitud queda en estado 3, que es su comportamiento
  correcto.
- **⚠ Y no confundirlo con `simulator/aggregator-result`**, que existe en `legacy-backend` y parece la
  solución: exige que la solicitud esté ligada a un `ecommerce_request` y devuelve 422 si no. Sirve para
  el canal ecommerce, **no** para el flujo de asesor — que es justo donde rt=1 cierra el 95% de las veces.
- **⚠ PERO SÍ SE PUEDE PROBAR, y sin simular el receptor.** `legacy-application` **corre en local**
  (`php artisan serve --port=8000`) contra la MISMA base, así que se le puede disparar el webhook de
  verdad: `POST api.localhost:8000/welli/webhook` con `{timestamp, application_id, status}` y bearer
  token. Comprobado el 2026-08-23 de punta a punta — el handler real resuelve la transacción, aplica su
  `STATUS_MAP` y mueve la solicitud en la base que ve `legacy-backend`. Lo único simulado es **la entidad
  que llama**. En el harness: `@webhook=fulfilled`, opt-in.
- **⚠ Y LOS DOS `STATUS_MAP` DIFIEREN — demostrado corriendo, no leyendo.** `pendiente_desembolso` da
  **28** (el de application) y está escrito como **11** en `legacy-backend`; además `fraud` y
  `risk_in_process` sólo existen en el nuevo. Son 12 estados iguales y 3 distintos. Cuando el webhook
  migre, **uno de esos tres cambia de desenlace** — y el TODO que lo marca (`[PARIDAD]`) ya está en el
  código, pero sin decir cuál gana.
- **Tres trampas del camino, todas silenciosas:** el monolito viejo **rutea por subdominio** (el webhook
  está en `api.localhost`, y pegarle al host pelado da **405 «Supported methods: GET, HEAD»** por la ruta
  fallback, no 404); **`fetch` de Node descarta el header `Host`** sin avisar, así que el subdominio va en
  la URL; y sin `WELLI_WEBHOOK_TOKEN` en el `.env` de application el guard rechaza con 401.
- **⚠ Y rt=0 TAMBIÉN avisa por webhook — es la familia MÁS GRANDE y se pasa por alto.** Medido en
  producción (90 días): rt=0 lleva **15.339 solicitudes (46 % del total) y 4.196 autorizadas**, o sea
  que «redirige y nadie decide en plataforma» describe la ida, no la vuelta. Vuelven por un webhook
  **genérico**, no uno por entidad: `POST api.localhost/self-manager/webhook`
  (`SelfManagerController@webhook`), con
  `{lender_id, order_id, code_id, available_amount, purchase_amount, invoice_number, status}`. Lo
  domina **Addi** (3.529 de las 4.196); después PayJoy (224), Brilla (192), Sistecrédito (108). Mismo
  receptor real, misma técnica que el de rt=1 — sólo cambia el payload.

  ⚠ **Pero NO toda la familia lo recibe, y la partición importa:** de las 20 entidades rt=0 con
  solicitudes en 90 días, **sólo 3 tienen clase `action`** —y se llevan **13.471 de las 15.339
  solicitudes (88 %)**—; las otras **17 tienen `action` en NULL**: son redirección pura, sin webhook.
  Esas 17 igual acumulan **559 autorizadas**, así que cierran por otro camino que **no está
  identificado** (probablemente a mano, desde el panel). Queda como pregunta abierta.
- **⚠ Los ids de la familia Welli están QUEMADOS en el handler** (`whereIn('lender_id', [23,141,142,166])`)
  y en el runner. Una quinta variante dada de alta por configuración **no la encuentra el webhook**.
- **Arreglo:** ninguno acá; es trabajo de la migración. Lo que este hallazgo aporta es **dónde mirar**,
  **qué falta** y **cómo probarlo hoy**. **Estado:** vigente.

### F-171 · El webhook de rt=0: dos guardas rotas, y una que no puede dispararse nunca

- **Contexto:** `self-manager/webhook` (en `legacy-application`) es el que cierra a **rt=0**, la familia
  con más volumen —15.339 solicitudes en 90 días, 46 % del total—. Al recorrerlo de punta a punta
  aparecieron tres cosas en el mismo bloque, y ninguna se ve desde afuera.
- **1 · Una condición que es imposible por construcción:**

      if ($purchaseCode->barcode_checked && ($lender->id == 68 && $lender->id == 133))

  `$lender->id` no puede valer 68 **y** 133 a la vez: el `&&` de adentro tendría que ser `||`. La
  guarda que existe para rechazar un **código de compra ya usado** es, hoy, código muerto: nunca
  devuelve «El código ya fue utilizado». Para esas dos entidades el mismo código podría reutilizarse.
- **2 · `$purchaseCode` se lee sin comprobar que exista.** Una solicitud sin fila en `purchase_codes`
  tira `Attempt to read property "barcode_checked" on null` — un 500 de PHP en vez de un rechazo
  legible. Es el mismo modo de falla que F-169, en otro archivo.
- **3 · El `catch` referencia una variable que puede no estar definida.** Con un `order_id` inexistente
  el `firstOrFail()` corta antes de asignar `$transaction`, y el manejador de error revienta con
  `Undefined variable $transaction` — así que un webhook con un pedido desconocido no da un 404 claro
  sino otro 500, y el mensaje habla de una variable, no del pedido.
- **⚠ El `lender_id` del payload es el SLUG, no el número — y el slug NO es estable entre ambientes.**
  El lender 6 es `addi` en producción y **`credifamilia-addi`** en el dump local. Un runner que lo queme
  funciona en un lado y falla en el otro con un 404 que parece del webhook.
- **Cómo se recorre en local (los dos pasos, porque el webhook no crea nada):** primero la
  `LenderTransaction` y el código de compra —que en producción los deja el navegador del cliente al
  finalizar la compra (`FinalizePurchaseQrController`)—, y después el webhook, que los encuentra por
  `order_id`. En el harness: `@webhook=completed`, con `SELFMANAGER_TOKEN`.
- **El mapeo, comprobado corriendo:** `completed` → **11 Autorizada** (por el caso especial de los
  lenders 6 y 9; para el resto sería **26 Facturado**), `failed` → **6 Negada**, `cancelled` → **7 No
  terminó proceso**.
- **Arreglo:** los tres son de una línea cada uno, y los tres viven en `legacy-application`.
  **Estado:** vigente.

### F-172 · Un lender rt=2 sin categorías revienta al AUTORIZAR — y hay 6 así, activos, en producción

- **Síntoma:** el cliente recorre todo el flujo, firma, y en el último paso recibe
  `HTTP 500 · Attempt to assign property "already_used_loan" on null`. La solicitud queda en **estado
  28**. No hay nada en el mensaje que hable de configuración.
- **Dónde:** `Modules/Loans/App/Services/CreditopXRequestHistoryService.php:421`

      if ($userRequest->lender->response_type == 2) {
          $category = $this->promotionsByLenderRepository->getUserCategory(...);
          $category->already_used_loan += $userRequest->final_amount;   // ← sin guarda
          $this->promotionsByLenderRepository->saveCategory($category);
      }

  `getUserCategory` devuelve **null** cuando la entidad no tiene ninguna categoría configurada, y el
  `+=` lo asume presente.
- **Qué lo dispara, medido el 2026-08-23:** una entidad **rt=2 con cero filas en
  `lender_users_categories`**. Reproducido en local con **UOF credit** y **Osani X** (0 categorías,
  revientan) contra **DHI X** (1) y **Motai C** (4), que cierran bien. La diferencia es exactamente esa.
- **⚠ EN PRODUCCIÓN HAY SEIS ENTIDADES ASÍ, Y ESTÁN ACTIVAS.** Seis lenders rt=2 tienen cero categorías
  **y al menos una sucursal habilitada**; **Osani X está en 6 sucursales**. No han disparado porque
  ninguna registró tráfico en 90 días —de las 38 rt=2 con solicitudes, todas tienen categorías y hay
  **cero** trabadas en 28—, pero **están ofrecibles**: alcanza con que un cliente elija una.
- **Por qué importa más de lo que parece:** el crash NO es al listar ni al elegir, sino **al autorizar**
  — o sea después de que el cliente completó datos, pasó el buró, aceptó condiciones y firmó. Es el peor
  lugar posible para descubrir un dato de configuración faltante.
- **Y el mensaje no ayuda:** «Attempt to assign property on null» manda a leer código. La causa es una
  entidad dada de alta sin terminar de configurar, que es un problema de operación, no de desarrollo.
- **Arreglo (propuesto, NO aplicado):** dos cosas — guardar el null como hacen los otros lugares que
  leen categorías, y **no dejar habilitar una rt=2 sin al menos una categoría**, que es donde el error
  se evita de verdad. **Estado:** vigente, y con seis entidades expuestas hoy.

### F-173 · Bancolombia NO entra por el onboarding — y la entidad que sí aparece ahí está muerta

- **Síntoma:** se prueba «Bancolombia» pidiéndola en el listado del onboarding, sale prolijo, y el
  resultado no dice nada del negocio real. Nada avisa.
- **Lo que en realidad pasa (medido el 2026-08-23, 90 días de producción):** hay **tres** entidades con
  ese nombre y sólo dos vivas:

  | id | nombre en producción | rt | solicitudes |
  |---|---|---|---|
  | 100 | Bancolombia - Crédito de consumo | 1 | **2.812** |
  | 68 | Bancolombia - Compra y paga después (BNPL) | 1 | **1.687** |
  | 8 | **Bancolombia (No activo)** | 1 | **0** |

  Las dos vivas entran **por el canal QR (Corbeta)**, no por el onboarding. La que aparece en el
  listado del onboarding es la **8**, que está apagada.
- **⚠ Y el nombre no la delata donde se prueba:** el sufijo «(No activo)» existe en **producción**; el
  dump **local** guarda «Bancolombia» a secas. O sea que la única marca que distinguiría a la entidad
  muerta **no viaja al ambiente donde se corre**.
- **Su desenlace tampoco es el 11.** El canal QR cierra en **estado 25 «Pendiente de facturación»** con
  un código de compra emitido; el desembolso ocurre después y por afuera. Medir Bancolombia con la vara
  del estado 11 da cero por construcción.
- **Sí está cubierto, con otra herramienta:** `make harness-qr PRODUCT=bnpl|consumo` (por API) y
  `make harness-walk` (clickeando). Verificado el 2026-08-23: los dos productos cierran en 25 con
  código. Necesita `bin/mock-bancolombia` (:8104) y `bin/mock-corbeta` (:8103).
- **Por qué importa:** un barrido por el onboarding **parece** cubrir Bancolombia y no lo hace, en los
  dos sentidos — ejercita una entidad apagada y usa un estado terminal que no es el suyo. Es la forma
  más fácil de creer que un canal está probado cuando no se lo tocó.
- **Arreglo:** ninguno de código. El runner de casos avisa si el nombre trae la marca, pero **no se
  puede confiar en su silencio** por lo del dump. **Estado:** vigente.

### F-174 · En local los documentos NO se guardan: cada subida a S3 falla en silencio y la URL igual se escribe

- **Síntoma:** ninguno. La corrida informa «7 documentos firmados», las filas existen en
  `netco_signing_documents` / `user_request_signing_documents` con su `signed_at` y su
  `signed_pdf_url`, y todo se ve bien. **Los archivos no existen.**
- **Medido el 2026-08-23 en local:**

      Storage::disk('s3')->put(...)   → devuelve **false**, en **509 ms**
      Storage::disk('s3')->url(...)   → devuelve la URL igual
      GET de esa URL                  → **HTTP 404**

- **Por qué falla:** el disco `s3` apunta a **AWS real** (`endpoint = NULL`) con
  `AWS_BUCKET=local-mock`, un bucket que no existe. Y **por qué no se nota**:
  `filesystems.disks.s3.throw` está en **`false`**, así que Flysystem devuelve `false` en vez de
  lanzar — y **casi nadie mira ese booleano**. La URL no se consulta al bucket: se **construye** a
  partir del nombre, así que sale bien formada apunte a donde apunte.
- **El costo doble:** medio segundo por documento **gastado en fallar** (viaje a AWS y vuelta), unas
  seis veces en el camino de firma ≈ **3 s por caso**, y encima el artefacto no queda.
- **Lo que esto le quita al harness:** no se puede **abrir el PDF que produjo una corrida**. Se puede
  afirmar que el flujo llegó a firmar, no que el documento salió bien — que es justamente la mitad que
  las plantillas Blade deciden (ver F-150).
- **⚠ Y hay una excepción que lo demuestra:** el proveedor de firma **sí** mira el resultado y tiene
  plan B — `NetcoSignerProvider` captura el fallo y persiste el base64 en `signed_base64` «para
  recovery sin re-firma». O sea que en el único lugar donde alguien comprobó, el fallo estaba previsto.
  En los otros cinco puntos de subida, no.
- **Arreglo (local), APLICADO y medido el 2026-08-23:** un MinIO en `:9000` con el bucket `local-mock`
  y tres líneas en el `.env` de `legacy-backend`:

      AWS_ENDPOINT=http://host.docker.internal:9000     # lo consume el CONTENEDOR
      AWS_USE_PATH_STYLE_ENDPOINT=true
      AWS_URL=http://localhost:9000/local-mock          # lo consume el NAVEGADOR

  ⚠ **Las tres hacen falta y no son intercambiables.** `AWS_ENDPOINT` es a dónde escribe el backend;
  **`AWS_URL` es lo que se GUARDA en la base**, porque `url()` arma la dirección a partir del nombre del
  bucket y **no** del endpoint — sin él el archivo se guarda bien y la URL sigue apuntando a AWS, o sea
  que el 404 no se va. Y llevan hosts distintos a propósito: `host.docker.internal` para el contenedor,
  `localhost` para quien abra el link.
  **Resultado:** `put` pasó de **`false` en 509 ms** a **`true` en 25 ms**, los documentos se descargan
  (`%PDF-`, 14 archivos tras dos corridas) y un caso de Motai bajó de 27 s a **19,6 s**.
  **Estado:** resuelto en local; el hueco de diseño —`throw => false` y una URL que se construye sin
  consultar— sigue ahí.
**(2026-08-28) Re-verificación asistida de los 22 archivos derivados** (worker → 7; CERO
invalidaciones: los cambios CONFIRMAN los findings — el corte semanal cierra F-147/F-148 desde el
backend, los mocks locales cubren F-140/F-156/F-165, y el panel ganó radicación/webhooks/debug). Los
F-xx citados siguen vigentes salvo los que sus propias entradas ya marcan cerrados.

