# Wally — un chat con Gemini por la web de AI Studio, eligiendo el modelo

Para hacerle preguntas a Gemini sin abrir AI Studio: a la izquierda las conversaciones guardadas (con buscador y por
día: Hoy, Ayer, Últimos 7 días, Antes); al centro, **en pestañas, las abiertas** —varias a la vez, cada una con su
borrador y su modelo—, y abajo el campo, que crece con lo escrito. Cada respuesta dice con qué modelo salió, cuánto
tardó y a qué hora; un bloque de código lleva su lenguaje y su «Copiar».

**Las pestañas** siguen la gramática del taller (`tools/ui/README.md`, «documentos abiertos»): un clic en la lista
abre la conversación de paso (itálica, la reemplaza el próximo clic); doble clic, o mandar una pregunta, la deja fija;
«+» abre una nueva; ✕ o el botón del medio la cierran. Se recuerdan en esta máquina (`wally.tabs`). Mientras una
espera respuesta, su pestaña y su fila laten, y en las otras se escribe pero no se manda (las preguntas van de a una).

**Pregunta POR LA WEB, no por la API** (decisión de Miguel, 2026-11-17): cada pregunta la hace `bin/aistudio` (la
receta `jarvis/recipes/aistudio/ask.ts`) en su Chrome con Jarvis, con su cuenta y en un chat temporal de AI Studio
(no queda en el History ni en Drive). Usa el uso gratuito de la web, que acepta textos enormes, y no la cuota de una
llave. La primera versión, del mismo día, llamaba a la API con la llave de `connectors/.env` y se retiró por eso.

| pieza | qué es |
|---|---|
| `make wally` | levanta la interfaz (:5228, Vue) y la API (:5229, Go). En Cockpit es la app Wally |
| `server/main.go` | la API: `GET /api/models`, `GET/DELETE /api/conversations[/<id>]`, `DELETE /api/conversations/<id>/messages/<bloque>`, `POST /api/ask {id?, model, text, files?}` |
| `server/config.go` | la configuración (`GET/PUT /api/config`, en `.data/config.json`) y lo de hoy (`GET /api/usage`); en el sidebar derecho |
| `server/agents.go` | los agentes: `GET/POST /api/agents` (abajo) |
| `server/pool.go` · `server/topics.go` | el pool de AI Studio (todas las preguntas, de cualquier proveedor) · la lista de temas de knowledge para el formulario de un agente |
| `server/files.go` | los adjuntos: `POST /api/files` (multipart, campo `file`), `GET/DELETE /api/files/<id>` |
| `src/App.vue` | la interfaz; la ruta es la pestaña activa: `#/c/<id>`, o `#/nueva/<n>` para una sin preguntas |
| `wally/.data/conversations.json` · `wally/.data/files/` | lo guardado y el texto de los adjuntos (fuera de git) |

- **Necesita Jarvis conectado en Chrome** y la sesión de Google de Miguel. Sin eso, la pregunta vuelve con el error de
  la receta.
- **Todas las preguntas pasan por EL POOL** (`server/pool.go` → `jarvis/recipes/aistudio/pool.ts`, desde el
  2026-11-17): un proceso de Node con LA conexión a Chrome (el puente de Jarvis acepta una sola de Playwright, pero
  esa maneja varias pestañas a la vez), hasta 2 preguntas en paralelo (`WALLY_POOL_MAX`) y 20 s entre comienzos
  (`WALLY_POOL_GAP`; con 8 s la segunda ya recibió «Permiso denegado»). Suelta la conexión a los 20 s sin trabajo,
  así `bin/aistudio` por consola puede usarla. Las pestañas se abren de a una y con reintento: crear otra mientras una
  carga AI Studio falló una vez con «Cannot read properties of undefined (reading '_page')». El núcleo de la pregunta
  es `askOn` (`page.ts`), el mismo de `bin/aistudio ask`.
  **Trabaja en una ventana aparte de Chrome, minimizada** (desde el 2026-11-17, para no llenarle de pestañas la
  ventana a Miguel): `openWorkPage` pide la pestaña con el `Target.createTarget` de CDP (`newWindow`, `background`) y
  la extensión de Jarvis (0.2.3) la abre en su ventana aparte, que reusa. `AISTUDIO_WINDOW=aside` la deja normal sin
  robar el foco (para otro escritorio de macOS) y `tab` vuelve a la pestaña de siempre. Medido: minimizada, la
  página sigue `visible` para Chrome (no la frena) y contestó en 6 s, por la receta y por Wally. Chrome no tiene un
  modo sin ventana para el Chrome en uso: `--headless` es sólo para uno que arranca así, y no puede abrir el perfil
  de la persona mientras está abierto.
- **La conversación la guarda Wally, en BLOQUES** (idea de Miguel, 2026-11-17): cada pregunta tuya y cada respuesta es
  un bloque con su id. AI Studio no recuerda nada (chat temporal: cada pregunta abre uno nuevo), así que la próxima
  pregunta le manda TODOS los bloques guardados como transcripción (`transcript`) y la pregunta nueva al final.
  **Cualquier bloque se borra** con su tacho (aparece al pasar el mouse), sin confirmación: así se saca contexto que
  no aporta y se queda sólo lo que sirve. Arriba a la derecha, «contexto: N bloques · M caracteres» dice lo que va a
  viajar. Los bloques de antes no tenían id: se les pone al cargar.
- **La configuración** (el engranaje de la lista, `#/configuracion`; idea de Miguel, 2026-11-17, como la de avisos del
  chat): se guarda en el servidor al tocarla y vale desde la próxima pregunta. **Proveedor**: AI Studio (Gemini 4
  Hydrogen), **DeepSeek** (chat.deepseek.com, `jarvis/recipes/deepseek/`) o **ChatGPT** (chatgpt.com en chat temporal,
  `jarvis/recipes/chatgpt/`, con su «Pensar») o **Groq** (chat.groq.com, el ultra rápido, con GPT OSS 120B o 20B; hasta
  ~20 mil caracteres); todos por su web y por el pool,
  en el Chrome de Miguel con su sesión. El Thinking level de AI Studio; «Pensamiento Profundo» y «Búsqueda
  inteligente» de DeepSeek; la ventana de Chrome (minimizada, aparte o pestaña), y lo de hoy por modelo (preguntas,
  cortes, media, cupo agotado y pausa). ⚠ **Los agentes y el asistente sólo van por AI Studio** aunque se elija otro
  (`providerFor`), salvo que se marque «Permitir» (`agentsOther`; antes `agentsDeepSeek`, que se migra solo): llevan
  contexto interno de CreditOp, que DeepSeek guarda en China (y deja en el historial) y ChatGPT puede guardar 30 días;
  y ChatGPT gratis no acepta los ~77 mil caracteres de un agente (sí ~40 mil), ni Groq más de ~20 mil. Medido el 2026-11-17 con DeepSeek
  elegido: un chat contestó por DeepSeek en 8,7 s y Pikachu fue por AI Studio (y dio la pausa de Hydrogen).
- **Un solo modelo por proveedor: Gemini 4 Hydrogen con «Thinking level: High»** (Miguel, la tarde del 2026-11-17: «no le veo
  necesidad de usar el 3.8»), para el chat, los agentes y `bin/aistudio`. Con un solo modelo la interfaz no muestra
  selector (`chatModels`); Flash sigue a mano con `bin/aistudio --model gemini-3.8-flash`. El nivel lo pone la receta
  en cada pregunta (`ensureThinking`): cada modelo trae el suyo (Hydrogen nace en High, Flash en Medium). La preferencia
  del navegador cambió de clave (`wally.model.v2`) para no volver sola a Flash, que era el de siempre hasta esa tarde.
  ⚠ Con un solo modelo, cuando se acaba su cupo diario Wally queda en pausa hasta que vuelve (abajo).
- **Cuánto deja Google por día**: cada pregunta (de Wally o de `bin/aistudio`) queda en
  `~/.cache/my-tools/aistudio-uso.jsonl` —hora, modelo, nivel, tamaño, tiempo y si salió, la cortó Google u otro
  error; nunca el texto— y `bin/aistudio uso [--days 7]` lo resume por día y modelo, con la hora del primer corte y
  cuántas salieron antes. Empezó a registrar el 2026-11-17 a las 15:30 para medirlo con el uso real, sin tandas a
  propósito (una tanda es justo lo que hace cortar a la cuenta).
- **El cupo diario de la web es POR MODELO, y AI Studio dice cuándo vuelve** (medido el 2026-11-17 a las 15:30,
  Hydrogen tras un día entero de pruebas): un aviso «Failed to generate content, Quota exceeded: you have reached the
  daily limit of requests for this model (resets in 11 horas y 30 minutos)», junto con «No tienes más generaciones
  gratuitas… tu propia clave de API pagada» y una tarjeta «Upgrade». Vuelve a las 3:00 de Colombia (medianoche del
  Pacífico); los otros modelos siguen andando, por eso a mano se podía seguir chateando. La receta junta todos los
  avisos (el del cupo primero), y `noteFailure` pausa ESE modelo hasta la hora que dice (+2 min, `dailyReset`) en vez de
  1 a 5 min; el «rate limit» por minuto sigue con la pausa corta de toda la cuenta. El «Dashboard» de AI Studio (Uso,
  Límite de frecuencia) es sólo de la API con llave: el cupo de la web no aparece en ningún número.
- **El «cuelgue» de las preguntas largas era de la receta** (2026-11-17, Pikachu: 77 mil caracteres, cinco veces): AI
  Studio sólo dibuja los turnos a la vista, y con una pregunta enorme el turno de la respuesta quedaba fuera de pantalla
  y llegaba VACÍO (sólo sus botones), aunque había contestado en 10 s. La receta esperaba ese texto hasta el tope y
  decía «AI Studio no contestó». Se reprodujo con Flash, y `lastAnswerText` ahora trae el último turno a la vista antes
  de leerlo: la misma pregunta salió en 12,5 s. No era la ventana minimizada, ni la pausa antes de «Run», ni el texto.
- **Cuando AI Studio se traba de verdad** (`runAndWait`): si «Run» no pasa a «Stop» en 60 s, o si genera 4 min sin que
  cambie la respuesta (`AISTUDIO_STALL`), saca foto y texto a `~/.cache/my-tools/aistudio-fallas/` y corta, en vez de
  esperar los 10 min en silencio.
- **Cuando Google corta** («Permiso denegado», 403, cuota) la receta deja una
  pausa de 1 a 5 min, al azar, para TODA la cuenta (`*` en `~/.cache/my-tools/aistudio-pausa.json`): el corte es por el ritmo de la
  cuenta, no por modelo (Flash Lite contestó a las 9:48 y a las 9:49 ya no, 2026-11-17). Wally muestra hasta qué hora
  y no deja preguntar.
- **Los archivos adjuntos NO se suben a AI Studio** (que los guardaría en el Drive de la cuenta aunque el chat sea
  temporal): Wally les saca el texto EN ESTA MÁQUINA y ese texto viaja con la pregunta, delimitado con su nombre,
  mientras en la conversación sólo queda su ficha (tipo, nombre, cuánto texto; al tocarla se ve el texto). Van texto y
  código, PDF (`pdftotext`, de poppler) y Word, RTF u ODT (`textutil`, de macOS); una imagen, un binario o un PDF
  escaneado vuelven con su porqué. Tope: 25 MB de original y 3 millones de caracteres de texto. Se adjuntan con el
  clip, arrastrándolos o pegándolos; pertenecen al bloque de la pregunta: borrarlo (o la conversación) los borra del
  disco, y cerrar una pestaña borra los que no se mandaron. Medido el 2026-11-17: un log de 23 mil caracteres con
  Gemini 3.8 Flash, 47 s.
- **El modo asistido «Asistente»** (se elige al abrir una pestaña nueva; la pestaña lleva una «A»): Wally deja de sólo
  contestar y puede PEDIR VER cosas de la máquina, pero no las corre él (idea de Miguel, 2026-11-17). **Sus
  instrucciones son [`WALLY.md`](WALLY.md)**, lo que `CLAUDE.md` es para Claude Code: quién es, cómo pedir y el
  catálogo de comandos de sólo lectura. Va antes de CADA pregunta y se lee en el momento: editarlo cambia a Wally desde
  la próxima, sin reiniciar. Para pedir, el modelo escribe un bloque ```comando; cada comando sale como tarjeta con
  **Correr** y **Descartar**, la salida queda como ficha de la respuesta que lo pidió (viaja pegada a ella; borrar el
  bloque la borra) y «Mandar resultados» le avisa para que siga. El primer modo, «Asistente de knowledge» (sólo la
  biblioteca, con el mapa adjunto al empezar), sigue andando para sus conversaciones.
  ⚠ **Qué se corre lo decide el servidor, no el modelo**: la lista blanca (`allowList`, `server/commands.go`) —la
  biblioteca (`make knowledge-map|search|read`), `make tareas`, el catálogo (`comandos [palabra]`), las trampas
  (`trampas`, `trampa F-xx`) y las guías (`guia <herramienta>`, de una lista fija)— con los argumentos validados: los
  de `make` se corren SIN SHELL y los demás leen un archivo fijo; se vuelve a validar al correr. Lo demás queda «no
  permitido» (`commands_test.go`: `;`, `$(…)`, `|`, rutas, otro target). **Afuera a propósito**: bases, logs,
  PostHog, datos de clientes o de producción y la pila de las tareas: son de lectura, pero lo que lee Wally viaja a
  Google. Para sumar un comando: su línea en `allowList`, su caso en la prueba y su fila en WALLY.md (tienen que decir
  lo mismo).
- **El experimento del 2026-11-17** (Claude como aprobador, la misma pregunta: «un comercio dice que una entidad no
  le aparece a sus clientes: ¿cómo lo investigo y qué puede pasar?»):
  - **3.8 Flash**, 3 vueltas: pidió 4 comandos (aprobados 3; `comandos lender` descartado: medio catálogo), después 3
    más (el tema `lender-listing` y las trampas F-118 y F-140, que eran las del índice para ese síntoma), y contestó
    con `harness-listing`, las puertas v1/v2, reglas duras que reordenan y F-140, citando cada cosa. Tiempos: 12 s,
    241 s y 30 s (la segunda, con ~30 mil caracteres de contexto). Todo lo que pidió estuvo en la lista y tuvo sentido.
  - **Hydrogen**, con WALLY.md corregido: pidió mejor de entrada (leyó el tema directo, 3 comandos sin redundancia, en
    8,5 s), pero con las salidas no contestó en 10 min. Fue el modelo que Google cortó primero ese día.
  - **¿Modo automático?** Lo pedido fue siempre seguro (la lista blanca lo garantiza de todos modos); lo que le
    faltaba era criterio de costo (buscar un id en vez de leerlo, palabras demasiado generales), y se corrigió en
    WALLY.md. Lo que todavía frena el automático es Google: tres cortes en el día y respuestas de hasta 4 min con
    contexto largo.
- **Poner al día la biblioteca con Hydrogen** (2026-11-17, Claude como aprobador y verificador). WALLY.md suma los
  comandos de lectura de código (`server/code.go`): `cambios` (lo de `knowledge-check` que cambió), `fuentes tema`,
  `diff tema repo:ruta` (desde el commit revisado hasta `origin/main`) y `codigo repo:ruta` (con números de línea);
  `git` sin shell, el repo de `tools/repos.json`, la ruta sin `..`. Y un formato de propuesta por sección (veredicto,
  por qué con archivo:línea y commit, texto nuevo, fuentes a sellar): **Wally no escribe**.
  - `creditopx-offer-calculation` (1 fuente cambiada): eligió el tema solo con `cambios`, pidió `fuentes`, el `diff`
    y SÓLO la sección afectada; 4 vueltas, ~67 s. Veredicto «sigue cierta» (el commit `60f773a32` sólo agregó
    `paymentDateAfterSettling`, 34 líneas y ninguna borrada): correcto, con las líneas bien citadas.
  - `weekly-collection-reminders` (3 fuentes): 3 vueltas, ~41 s, 6 propuestas. Cinco «sigue cierta» y una «cambió»
    (`3a434b108`: la consulta excluye créditos de prueba), con el párrafo corregido idéntico al anterior salvo esa
    cláusula. Todo verificado contra `main` (líneas, commits, `TestCreditExclusion`) y aplicado: 12 → 8 fuentes
    pendientes.
  - La tanda siguiente, el mismo día, dejó la biblioteca entera al día (`knowledge-check` en 0, 1.294 fuentes):
    `creditopx-payment-application` («sigue cierta» hasta que se le preguntó; entonces vio solo que los dos motores
    mueven distinto la fecha al saldar el mínimo y que legacy-application sigue con un ciclo), `creditopx-portfolio-
    servicing` (distinguió que lo nuevo era del otro tema), `motai-renting` («falta algo»: los recordatorios no les
    escriben a los créditos de prueba) e `identity-name-validation` (7 propuestas, 4 «falta algo»: el corte de nombres
    como el registro, el reintento sin el «DE» de casada en web y móvil, el código 2 rechazado en RiskV2, la marca en
    `kyc_name_checks`; y encontró que `legacy-application` sigue con el corte viejo). Todo verificado contra `main`
    antes de aplicarlo; los textos necesitaron retoques de editor (matices, una comparación que no aplicaba, pasar una
    «observación» al tema). Sumó a WALLY.md el veredicto «falta algo», mirar el otro monolito con `buscar` y pedir
    rangos (`codigo …:desde-hasta`). Costo: 6 cortes de Google en el día (el último, «rate limit» explícito), dos
    esperas de 10 min sin respuesta y vueltas de 8 a 270 s según el contexto.
  - **Evaluación para un modo automático**: los 10 comandos que pidió fueron de la lista, siguieron el procedimiento
    de WALLY.md y hacían falta (se aprobaron todos). **La lectura puede ir en automático** (la lista blanca garantiza
    que sea de sólo lectura). **La escritura todavía no**: sus propuestas fueron correctas en los dos temas, pero son
    seis temas; aplicar sigue pidiendo verificar contra `main` (lo que hizo Claude). Lo que más rendiría: armar el paquete de un tema (secciones, diffs y rangos) y mandarlo en UNA vuelta, en vez de 4 a 7 vueltas que reenvían el contexto cada vez y disparan el límite de Google. El freno real es Google: el mismo
    día, Hydrogen fue rechazado y una vez no contestó en 10 min.
- **Borrar es con dos toques, sin `confirm()`**: dentro de Cockpit (Tauri, un WKWebView sin el plugin de diálogos)
  `confirm()` no muestra nada y devuelve «no», así que el tacho no borraba (Miguel, 2026-11-17). El primer toque lo
  arma («¿Borrar?» en rojo, 4 s) y el segundo borra (`armOrRun`), en la lista y en la pestaña de agentes. Probado con
  `confirm` forzado a «no».
- **Toda conversación es del asistente** (Miguel, 2026-11-17: «no dos cosas diferentes, que sea el default»): ya no se
  elige «Chat» o «Asistente»; una sin modo —nueva o de antes— contesta con WALLY.md y puede pedir comandos de lectura.
  Vacía, dice «¿Qué hacemos?», qué puede hacer y cuatro arranques (knowledge, trampas, código de main, resumir). Sólo
  las viejas del modo «knowledge» llevan su «K».
- **Los agentes y las conversaciones se manejan por consola: `bin/wally`** (`wally/cli.ts`; Miguel: «crear un agente no
  es algo que yo haga a mano: lo hace Claude»). `agents` · `agent create --name --intent [--notes|--notes-file]
  [--file]… [--topic]…` · `agent update <nombre> [--intent] [--notes|--notes-file]` (vale desde la próxima
  pregunta; `PUT /api/agents/<conv>`, que cambia sólo lo que llega) · `agent delete <nombre>` · `topics [palabra]` · `conversations` · `new [--title]` ·
  `delete <id>` (la de Wally no) · `ask [--conv|--agent] 'pregunta'`, con `--json`. Habla con la API, así que aparece
  solo en la interfaz; crear no le pregunta nada al modelo. El formulario de agentes y su «+» se sacaron de la
  interfaz. Probado el 2026-11-17: un agente con notas, un archivo y un tema, creado y borrado (con su archivo), y una
  conversación nueva, listada y borrada.
- **Wally lleva el borde de colores de sus agentes**, como tu foto en el chat: un arco por agente, en su color, alrededor
  de su bolita en la lista y en su saludo (`ringArcs`, el mismo cálculo del ícono de la pestaña de agentes).
- **La conversación con Wally, como «Mi chat»** (Miguel, 2026-11-17: «hablar directamente con Wally, el
  orquestador»): una sola, arriba de todo en la lista con su bolita y lo último que se dijo, y la que se abre al
  arrancar. Es del modo asistente (WALLY.md y sus comandos de lectura) y la crea el servidor la primera vez
  (`Conversation.Main`, `GET /api/main`); vacía, saluda («Hola, soy Wally») con tres sugerencias. Medido: «¿Qué podés
  hacer?» por DeepSeek en 9 s, contando knowledge, la puesta al día y las trampas. Los agentes se aterrizan después.
- **El sidebar derecho tiene pestañas por ícono, como el perfil del chat** (`auxiliarybar`, 340 px, con manija y su
  botón en el pie; se recuerda la pestaña, `wally.aux-tab`): **Agentes** (su ícono es un anillo con un arco por agente
  en su color; la lista con su bolita, su intención y cuántas fuentes suyas cambiaron, el «+» para uno nuevo, y tocar
  uno abre su conversación; los agentes ya no están en la lista de la izquierda), **Modelo** (el proveedor y las
  opciones de cada uno; el engranaje de la lista lleva acá, y `#/configuracion` lo abre), **Servicios** (con un punto
  rojo en el ícono si alguno no está listo) y **Hoy** (el uso). Antes la configuración era una pestaña del editor.
  Todo se ajusta a ese ancho, y la barra de escribir baja de renglón si el editor queda angosto.
- **La conversación es un chat** (2026-11-17, «como en el chat, con bolitas»): quien contesta a la izquierda, con su
  bolita y su nombre en su color (un agente, el suyo; sin agente, Wally), en una burbuja; vos a la derecha, en la tuya,
  con la hora adentro. El color de un agente sale de su nombre (`agentHue`, con el ángulo áureo para que nombres
  parecidos no queden en tonos parecidos) y es el mismo en la lista, su ficha y sus burbujas.
- **En la interfaz, «AI Studio» se llama «Gemini»** (sólo Gemini 4 Hydrogen); por dentro el proveedor sigue siendo
  `aistudio`, y la receta y `bin/aistudio` no cambian de nombre.
- **Los agentes son GENÉRICOS** (Miguel, 2026-11-17: «no sólo para recontextualizar knowledge»): nombre, intención y un
  contexto que es lo que se le escriba («Lo que tiene que saber»), los archivos que se le adjunten (su texto se saca en
  esta máquina, como el de una pregunta; se borran con el agente) y, opcionales y plegados, temas de knowledge. Con
  temas, sigue lo de abajo (fuentes contra main, propuestas); sin temas, sus sugerencias son «Contame qué entendiste» y
  «Arrancá».
- **El proveedor se elige en la barra de escribir, y es UNO para todo** (Miguel, 2026-11-17: «el chat arranca con el
  modelo que se haya colocado en el input; si se cambia en la conversación, no importa»): es el de la configuración
  (elegirlo en la barra lo guarda ahí), sin «Automático» ni proveedor por conversación; cada respuesta dice con cuál
  salió. Vale también para los agentes: el permiso general se sacó de la interfaz, y en la conversación de un agente
  con un proveedor que no es Gemini la barra avisa «Pikachu manda su contexto interno a DeepSeek». El menú es propio
  (no un `<select>`, que en macOS no muestra el título de una opción): cada opción dice el nombre reconocible y, chico,
  el modelo interno, los TOKENS de su modelo más poderoso (`providerContext`: Gemini 4 Hydrogen 1M de la ficha de
  Google; DeepSeek V4 1M según resúmenes no oficiales; ChatGPT gratis no lo publica; GPT OSS 120B ~128k) y lo que su web
  aceptó por mensaje (`providerLimits`: ChatGPT ~40 mil car., Groq ~19 mil). Lo que no se puede usar (en pausa, sin
  sesión, sin Jarvis, próximamente) queda apagado con `aria-disabled` y la causa al pasar el mouse; una pausa muestra
  su CUENTA REGRESIVA a la derecha («9 h 53 min», o «4:05» en la última hora), también en el botón y en la nota de la
  barra, y al vencer se vuelve a leer el estado. La barra avisa además si lo que viaja (la precarga del agente, la
  conversación y lo escrito) no le entra al elegido.
- **Kimi está, pero apagado («Próximamente»)**: la receta existe (`jarvis/recipes/kimi/`, `bin/kimi`), y en el plan
  gratis sus modelos buenos se frenan con «Muchas personas están chateando… Suscríbete» (Miguel, 2026-11-17: «va a
  seguir poniendo ese mensaje para que uno pague»). `/api/providers` lo lista con estado `proximamente` y su causa, que
  el menú muestra en gris y al pasar el mouse; no está en `providerModels`, así que no se puede elegir. Elegir un
  proveedor que no existe en la configuración ahora da 400 (antes `valid` lo cambiaba en silencio por Gemini).
- **Al arrancar, Wally comprueba los servicios** (`status.go`, `jarvis/recipes/aistudio/check.ts`): a los 5 s de
  levantarse —lo levanta Cockpit— el pool abre cada web en la ventana aparte y mira si está el campo para preguntar con
  sesión, SIN preguntar nada (no gasta cupo): `listo`, `sin-sesion` (entrar a mano), `error` o `sin-jarvis`. A eso se
  le suma la pausa vigente de cada uno (la del último aviso: el cupo diario de Gemini dice cuándo vuelve). Se ve en la
  configuración («Servicios», con «Comprobar ahora») y en las opciones de la barra; `GET /api/providers`,
  `POST /api/providers/check`. Medido el 2026-11-17: los cuatro listos en ~6 s, Gemini en pausa hasta las 03:10. El
  cupo que QUEDA no lo muestra ninguna web: sólo se sabe cuando se acaba.
- **Los agentes** (idea de Miguel, 2026-11-17, que reemplaza por ahora a los grupos): una lista de chats con nombre
  propio (de Pokémon), cada uno con **una intención** —tener al día el contexto local de una parte— y sus temas de
  knowledge. **No hablan entre ellos**: cada uno es UNA conversación larga, en el modo asistente (WALLY.md y sus comandos
  de lectura, que se aprueban como siempre), a la que se vuelve cada vez que algo cambia en su parte. El agente vive
  dentro de su conversación (`Conversation.Agent`: nombre, intención, temas), así que borrar, los bloques y los
  comandos son los de siempre; la lista de fechas no lo muestra porque tiene su sección, «Agentes», con su «+»
  (`#/agente-nuevo`). Crearlo no le pregunta nada a Google.
  - **Su contexto precargado** (`agentContext`): en CADA pregunta, entre WALLY.md y la conversación, viaja quién es y,
    por cada tema, el `rules.md` vigente y el estado de sus fuentes contra main (al día · CAMBIÓ · no está). Se lee en
    el momento: si se aplica una propuesta, la próxima pregunta ya la ve.
  - **Quién toma un cambio**: la fila de cada agente dice cuántas fuentes de sus temas cambiaron en main (y su ficha,
    arriba de la conversación, lo repite); con la conversación vacía ofrece «Ponete al día con lo que cambió»,
    «Revisá que tu parte siga cierta» y «Contame tu parte».
  - **Compactar** la conversación cuando crezca queda para más adelante.
  - **Los nueve** (2026-11-17), que cubren los 48 temas sin repetir, cada uno con Flash y hasta ~75 mil caracteres de
    precarga: **Pikachu** KYC · **Charmander** CreditopX (oferta, cupo, configuración, pagos, cartera, recordatorios) ·
    **Bulbasaur** entidades (listado, reglas de perfil y puntaje, tipos de respuesta, integraciones, credenciales,
    Ábaco) · **Squirtle** tienda y caja (ecommerce, VTEX, API de la tienda, caja, códigos de compra) · **Snorlax** el
    camino de una solicitud (caminos, estados, canal, cliente que vuelve, formulario, país) · **Jigglypuff** el cierre
    (codeudor, pagaré en Deceval, Credifamilia) · **Magnemite** dispositivos y renting (IMEI, bloqueo, planes, Motai) ·
    **Meowth** comercios y admin (alta, convenios, admin, roles, campañas de WhatsApp) · **Alakazam** el mapa general
    (negocio, app móvil, infraestructura). Un tema nuevo de knowledge no entra solo a ninguno.
  - **La lista compara contra main en lote** (`blobsAtMain`: un `git cat-file --batch-check` por repo): uno por fuente
    eran 16 s con los nueve, y la lista salía vacía hasta entonces; en lote, 0,3 s.
  - **Pikachu** (el primero): KYC —`kyc-pipeline`, `kyc-path-and-experian-trigger`, `identity-validation`,
    `identity-name-validation` y `otp-source-and-bypass`—, con Flash. Su precarga: ~55 mil caracteres; la primera
    pregunta, con WALLY.md, fueron 77 mil (13:15, «Contame tu parte»): AI Studio no contestó en 10 min, con la cuenta
    cortada desde las 12:39. Después se supo que esos «cuelgues» eran de la receta (abajo).
  - **Su primera revisión, por DeepSeek** (2026-11-17, 16:14, con el permiso de agentes prendido a pedido de Miguel
    y apagado al terminar; Hydrogen sin cupo): «Revisá que tu parte siga cierta» en 3 vueltas y ~70 s. Siguió WALLY.md
    al pie: primero `buscar` para anclar líneas, después `codigo` con rangos de 20 a 55 líneas, y un veredicto por
    tema: todo lo verificado «sigue cierta», con 14 citas archivo:línea que se comprobaron EXACTAS contra main (guarda
    `OBV22012`, `missingUserFields`, `RKV24007`, `MAX_TYPOS = 3`, los `substr` del bypass), y dijo lo que NO alcanzó a
    verificar (TusDatos, el `NameUtils` de RiskV2, las etapas 5 a 7). Nada que aplicar.
- **Mew, el agente de pruebas** (2026-11-17, el primero que no es de knowledge): le das una tarea y propone CÓMO se
  comprueba corriendo —por criterio, el comando del harness, qué demuestra frente a su caso de control, qué se espera
  en la base y qué trampa puede dar un falso verde—, más lo que el harness no alcanza y el orden. No corre nada. Su
  contexto son sus notas, [`agents/mew.md`](agents/mew.md) (los caminos del harness, las perillas de `harness-case` y
  `harness-walk-wizard`, las claves de una suite y el formato); los temas los lee según la tarea. Para eso se sumó a
  la lista blanca **`tarea <N|slug>`**: SÓLO el `task.md`, nunca la pila ni los artifacts (traen mediciones de los
  ambientes). Se crea con `bin/wally agent create --name Mew --intent '…' --notes-file wally/agents/mew.md`.
  **Probado con la tarea 101** (nombres en el onboarding), por DeepSeek: 3 vueltas, ~100 s; pidió la tarea, el índice
  de trampas, tres trampas (F-132, F-133, F-145), el tema `identity-name-validation` y `comandos harness`, y propuso
  5 pruebas. Sus dos tandas de `harness-case` se corrieron en local (rama con `NameSimilarity` igual a `main`): los 7
  casos dejaron en `users` y `kyc_name_checks` exactamente lo que dijo —Ñ y tildes conservadas en los tres sentidos,
  `completed` en las dos formas sin ambigüedad, `token_mismatch` sin completar en la ambigua y con el error de tipeo—.
  Avisó solo que el runner no imprime el nombre (hay que leer `users`), que `adopted` no prueba un cambio, que «no
  hay fila» no prueba «no consultó» y F-133 (el pagaré con un apellido). Lo que dijo del comando de reparación
  (`--since`, `--apply`, `--undo`, sólo `CC`, sin desembolsados ni validación manual) está en `main`. Un caso de la
  tanda cayó en el listado con «There is no active transaction» (del backend, en paralelo), después de guardar el
  nombre. **Le pedí la suite** y contestó lo correcto: con las claves de `espera` que había, sólo comprobaría que el
  caso llega al listado, no el nombre; y propuso las claves que faltaban. Se sumaron al runner (`nombreGuardado` y
  `chequeoNombre`, `harness/dev/case.ts`) y quedó `harness/suites/nombres.json`, con sus 6 casos más el ambiguo que
  había dejado afuera: 7/7 en local, y una copia con las expectativas cambiadas dio rojo con las tres diferencias.
  Sus notas se pusieron al día con `bin/wally agent update Mew --notes-file wally/agents/mew.md`.
- **Noctowl, el dictamen de producción** (2026-11-17): lee Sentinel y dice 🟢/🟡/🔴, qué mirar ya (máximo 3), qué
  echarle ojo, qué es ruido conocido y los despliegues del día, con qué correr para confirmar. Sus notas,
  [`agents/noctowl.md`](agents/noctowl.md): cómo decide Sentinel, lo ya conocido y cómo no leerlo mal. Para eso se
  sumaron a la lista blanca **`sentinel now`**, **`sentinel day [fecha]`** y **`sentinel deploy repo [versión]`**
  (`runSentinel`, sin shell; lee lo guardado). ⚠ **Es la primera vez que viajan datos de PRODUCCIÓN al proveedor**,
  con el sí de Miguel: agregados (cuántas solicitudes, conversión por pantalla, errores por servicio, nombres de
  comercios y entidades, títulos de despliegues), nunca de clientes. `sentinel signal` queda afuera (trae líneas de
  log de una entidad) y de `deploy` se saca el texto de los errores nuevos del front, que puede traer lo que escribió
  un cliente: queda cuántos son (`withoutFrontErrorTexts`, con su prueba).
  **Primer dictamen, por DeepSeek** (18:38): 3 vueltas, ~60 s; pidió `now` y `day`, después los tres despliegues de
  la tarde y las trampas. Dio 🔴 por las pantallas del wizard tras el front v1.11.12 (OTP falla 16 % contra 8 % antes
  y 4 % lo normal; registro 9 % contra 17 %), y separó bien lo conocido (los dos servicios callados desde el 12/11, el
  ×5 de legacy-backend, la ráfaga de legacy-application que ya venía de antes de su despliegue). Los números,
  comprobados contra las salidas, eran exactos. Cuatro errores de lectura, que pasaron a sus notas: llamó al OTP «el
  paso que cierra la solicitud» (es el del comienzo), a Sistecrédito «comercio» (es entidad), dijo que empezó «~16:54»
  (el «antes» de los despliegues de las 17:26 estaba en 5 %), y dio por hecho «tráfico de prueba» en Sonría y Asyco.
  Tampoco vio que el registro de todo el wizard ya había caído a 9 % a las 11:30, sin despliegue.
- **El modo AUTOMÁTICO: `bin/wally ask … --auto [--rounds 6]`** (2026-11-17, Miguel: «un agente que no espere la
  acción mía o tuya»): corre solo los comandos que pida el modelo y le manda los resultados, hasta que contesta sin
  pedir nada o se acaban las vueltas. Lo que corre lo sigue decidiendo el servidor (la lista blanca, sólo lectura): un
  comando fuera de ella queda «no permitido» y se le avisa. El tope existe porque cada vuelta reenvía todo el contexto
  al proveedor. Es seguro por la lista, no por el modelo: sumar a la lista algo que escribe lo volvería peligroso.
- **Porygon, el primer agente automático** (2026-11-17): pone al día la biblioteca solo —`cambios`, los `diff` de cada
  fuente, las secciones que tocan— y da un veredicto por tema con el formato de WALLY.md; no escribe ([`agents/
  porygon.md`](agents/porygon.md)). Se probó con lo que cambió ese día en legacy-application (la gestión del cupo
  rotativo, `1ebeb8da`: 5 rutas en `routes/admin.php` y un `first_payment_date` opcional en `RefinanceCredit`), que
  dejó 4 fuentes de 4 temas para revisar. Por DeepSeek, `--auto`: **5 vueltas, 15 comandos, ~3 min, sin que nadie
  aprobara nada**. Veredictos: client-profiling y device-locking «sigue cierta», creditopx-portfolio-servicing «falta
  algo» (la refinanciación del cupo impone la primera cuota desde afuera) y admin-panel «falta algo» (la sección
  «Créditos CreditopX» dice que una utilización no se gestiona desde su detalle y no cuenta que el cupo entero sí; esa
  sección no lista `routes/admin.php` entre sus fuentes, y aun así la encontró). Los cuatro se comprobaron contra
  `main`, y el de admin-panel era uno que Claude no había previsto. De sus citas, una línea estaba corrida dos
  (`preview` es la 66, dijo 64). Con el sí de Miguel, Claude leyó el código nuevo (`RevolvingCreditManagementController`,
  `RefinanceRevolvingCredit`), escribió los dos párrafos a partir del suyo, sumó esas fuentes y selló las cuatro en
  `2798bb7a`: `knowledge-check` volvió a 0.
- **Manual o Auto, en la barra de escribir** (2026-11-17, Miguel): un alternador por conversación (se recuerda en esta
  máquina, `wally.auto`). En **Auto** corre solo los comandos que pida —los de la lista blanca, que valida el servidor—
  y le manda los resultados, hasta 6 vueltas seguidas (`AUTO_ROUNDS`); al pasar el tope frena y lo dice. Lo mismo que
  `bin/wally ask --auto`. Si te vas a otra pestaña mientras corre, los comandos quedan corridos y la barra «Mandar
  resultados» espera. Probado: una pregunta que pedía `trampa F-135` corrió el comando, mandó los resultados sola y
  contestó.
- **La tarjeta de comandos ya no se sale de la burbuja**: la columna de `.commands` crecía con el comando más largo
  (`nowrap`) y la ficha OUT quedaba afuera; ahora es `minmax(0, 1fr)` y el comando se corta con «…». Medido a 1440 px:
  4 tarjetas, ninguna ficha afuera.
- **El código de main sale de los clones de canon** (`main_clones` en `tools/repos.json`): `codigo`, `buscar` y
  `diff` leen `~/Desktop/CREDITOP/canon/repos/<repo>`, a los que se les hace fetch (`make knowledge-check FETCH=1`) sin tocar
  las ramas de los clones de trabajo de otras sesiones.
- **En vivo, también lo que corre desde otro lado** (2026-11-17, Miguel: «verlo en tiempo real»): el servidor anota qué
  conversación espera respuesta (`GET /api/busy`, de la interfaz o de `bin/wally ask --auto`) y la interfaz lo mira
  cada 2,5 s: muestra la pregunta y la burbuja «corriendo solo · N s», y recarga la conversación abierta cuando cambia
  (mensajes nuevos, comandos corridos). Un comando que se está corriendo queda **«corriendo»** en el servidor (otra
  ventana no lo vuelve a correr: 409 «ya está corriendo», que la interfaz y el CLI toman como «lo tomó otro»); en
  Auto, o con una corrida de afuera, la tarjeta dice «en cola» y «corriendo…» en vez de Correr/Descartar. Al
  arrancar, un comando que quedó «corriendo» de un proceso cortado vuelve a «propuesto».
- **Canon, para leer**: `canon tema <id>[#ancla]` y `canon buscar '…'` (`runPlayground`, el CLI `playground` con la
  sesión de Miguel, sin shell).
- **Ditto: un tema de canon a knowledge, solo** ([`agents/ditto.md`](agents/ditto.md)): lee el tema, busca cada
  afirmación en los dos monolitos (`buscar` acepta una carpeta), lee el rango, y entrega el borrador de `rules.md`, sus
  fuentes, las diferencias con canon y lo no verificado; no escribe. Primera corrida (2026-11-17, `asesor/context`,
  por DeepSeek en Auto): 7 vueltas de 4 a 5 búsquedas, hasta que el mensaje llegó a ~130 mil caracteres y la web lo
  rechazó («El contenido es demasiado largo»); de ahí salieron los trozos (abajo). Retomado con los trozos, entregó en
  2 vueltas más: 7 secciones, 16 fuentes en los dos monolitos, 3 diferencias con canon (la baja también borra
  `cognito_id`, el sufijo es un contador `-t<n>`, el token sólo se pega para asesores de Smartpay) y 2 cosas sin
  verificar que dejó afuera. Un verificador independiente (`main-verifier`) confirmó sus 13 afirmaciones contra `main`,
  con líneas corridas y omisiones (un tercer lugar que pega el token, más llamadas al limpiador, el prefijo del perfil
  en el documento); con eso quedó `knowledge/advisor-accounts`. Las primeras búsquedas en los clones
  de canon tardaban ~24 s: son clones parciales (`blob:none`) y el primer `git grep` baja los archivos;
  `make knowledge-check FETCH=1` ahora los baja por adelantado.
- **DeepSeek en TROZOS cuando no entra** (Miguel: «no lo compactemos, partámoslo»; en Gemini no hace falta): la receta
  (`jarvis/recipes/deepseek/page.ts`) parte lo que pasa de `DEEPSEEK_CHUNK` (100 mil; medido: 109 mil entraron, ~130 mil
  no) por renglones y lo manda en el MISMO chat: cada trozo menos el último pide «no contestes, respondé sólo OK i/n»
  (sin Pensamiento Profundo, para que sea rápido) y el último trae la pregunta. Y reconoce el aviso «El contenido es
  demasiado largo»: antes la receta esperaba los 10 min. Probado retomando a Ditto (con un tope de 60 mil): dos
  mensajes de 128 y 136 mil caracteres salieron en trozos, en 23 y 52 s, y Ditto entregó en 2 vueltas.
- **Cada proveedor sigue su chat, y Wally manda sólo lo nuevo** (Miguel, 2026-11-17: «configurar cada cliente con la
  mejor forma de trabajo»). La conversación recuerda, por proveedor, el chat donde quedó (`Conversation.Chats`: su
  dirección, la huella de lo de arriba —WALLY.md y la precarga del agente— y qué bloques y salidas ya tiene). Si ese chat
  tiene exactamente lo que Wally guarda (`canContinue`), la próxima pregunta va a ESE chat con sólo lo nuevo (`delta`: las
  salidas de los comandos que pidió, lo que entró por otro proveedor y la pregunta); si se borró un bloque, cambió
  WALLY.md o la precarga, o el chat falla, abre uno nuevo con todo (y una pausa de Google no se reintenta). Wally sigue
  siendo el dueño de la conversación. Por proveedor:
  - **DeepSeek**: su chat (`/a/chat/s/<id>`), y en trozos cuando lo primero no entra. Medido: la vuelta con la salida
    de un comando pasó de reenviar ~10 mil caracteres a mandar 2 mil.
  - **ChatGPT**: con historial (sin `temporary-chat`), su chat `/c/<id>`: su web gratis acepta ~40 mil por mensaje, y
    así sólo lo primero tiene que entrar. `bin/chatgpt` por consola sigue en chat temporal.
  - **Gemini**: sigue TEMPORAL a propósito (no queda en el Drive) y le llega todo cada vez: acepta textos enormes. Su
    receta no devuelve dirección, así que Wally no recuerda chat.
  - **Groq**: no tiene historial; le llega todo.
- **Los límites de cada proveedor son CONFIGURACIÓN: [`providers.json`](providers.json)** (versionado; el servidor lo lee
  en cada pregunta, `server/providers.go`): por proveedor, lo más que entró en UN mensaje por su web (`messageChars`,
  medido: ninguna web lo publica), el contexto publicado del modelo (`contextTokens`), si sigue su chat o es temporal
  (`chat`) y si parte en trozos lo que no entra (`chunks`, al 90 % de lo medido; el pool lo hace en DeepSeek adentro
  de su receta y en ChatGPT con una llamada por trozo en el mismo chat). La barra de escribir dice «va en N trozos» en
  vez de «no le entra» para los que parten. Medido el 2026-11-17 por bisección, con relleno sin datos y «respondé sólo
  OK» (bin/deepseek, bin/chatgpt, bin/groq): DeepSeek 114.250 entra y 116.875 no; ChatGPT 72.375 entra (77 mil falló
  antes); Groq 37.125 entra y 40.937 no, con un minuto entre pruebas (seguidas, su cupo por minuto corta antes:
  «Rate limit reached» con dos de ~30 mil). Buscado en internet: lo único publicado es el contexto de los modelos (Groq, 131.072 tokens en su ficha);
  el tope por mensaje de las webs gratis no aparece en ninguna fuente oficial.
- **La carpeta de pruebas: lo ÚNICO donde un agente escribe** (`wally/pruebas/`, fuera de git; `server/sandbox.go`,
  2026-11-17, Miguel: «que un agente haga una página web en una carpeta pruebas»). El modelo entrega cada archivo en un
  bloque ` ```archivo pruebas/<proyecto>/<archivo> ` y eso es un comando **«escribir»** con su contenido (va como una
  tarjeta, no como cien renglones de código; en Auto se guarda solo). Se valida en el servidor: la ruta adentro de la
  carpeta (ni `..`, ni ocultos, ni un enlace simbólico que salga), tipos fijos (html, css, js, mjs, json, svg, md, txt),
  400 KB por archivo y 60 archivos por proyecto. Reescribir uno guarda el anterior en `.historial/`. Además:
  `listar pruebas[/proyecto]`, `leer pruebas/…` y **`probar pruebas/<proyecto>`**, que abre la página en un Chromium
  sin ventana (`wally/sandbox-check.mjs`, el Playwright del harness) y devuelve EN TEXTO lo que el modelo no ve: errores
  de consola y de JavaScript, recursos que no cargaron, título, encabezados, botones, imágenes rotas y si se desborda en
  escritorio (1280) y teléfono (390); deja capturas en `.capturas/`. No se ejecuta nada de lo escrito fuera del navegador.
  ⚠ **Lo escrito se sirve AISLADO** (`GET /pruebas/…`, `serveSandbox`): `Content-Security-Policy: sandbox allow-scripts`
  (origen propio: no ve cookies ni almacenamiento de Wally), `connect-src 'none'` y `form-action 'none'` (ni un pedido,
  ni a la API de Wally ni afuera) y sólo recursos de la misma carpeta; por eso la página tiene que ser autocontenida
  (sin CDNs). Comprobado con una página que hacía `fetch('/api/conversations')`: bloqueado. La interfaz la muestra con
  **«Ver»** en la tarjeta: un iframe con `sandbox` que ocupa el lugar de la conversación, en escritorio o teléfono.
  Es seguro en Auto por esto (ruta validada, nada se ejecuta, servido aislado), no por el modelo.
  **Smeargle** ([`agents/smeargle.md`](agents/smeargle.md)) es el agente que la usa. Primera corrida (DeepSeek, Auto): una
  landing de un taller de bicicletas ficticio —encabezado con un logo SVG, tres servicios con precio, horario y un
  formulario de turno—, en UNA respuesta de 13 mil caracteres con tres archivos (12,7 KB), y `probar` sin errores en
  escritorio y teléfono al primer intento. Comprobado aparte, usándola: el formulario vacío muestra sus tres avisos y
  completo confirma el turno en la misma página. Lo que costó, y quedó arreglado:
  - **El orden**: `probar` corría ANTES que los `escribir` de la misma respuesta (se leían primero los comandos).
    Ahora los archivos van primero (`parseCommands`).
  - **El aislamiento rompía los formularios**: sin `allow-forms`, el navegador corta el envío antes del evento
    `submit` y la validación de la página nunca corría (`probar` no lo ve: no usa la página). Se agregó `allow-forms`;
    el envío real lo sigue cortando `form-action 'none'`.
  - **DeepSeek, al seguir un chat, no veía la respuesta del tercer mensaje**: la receta contaba mensajes y su lista es
    virtual (el número deja de crecer). Ahora la respuesta es nueva si se vio generar o si cambió el último texto.
  - **`bin/wally ask` cortaba a los 5 min** (el tope de `fetch` de Node) con la pregunta todavía en curso: pregunta por
    `http`, sin ese tope.
  **Los parches** (2026-11-17, como los editores de Cursor o Claude Code): para cambiar un archivo que ya existe el
  agente manda un bloque ` ```parche pruebas/… ` con uno o más cambios `<<<<<<< BUSCAR … ======= … >>>>>>> REEMPLAZAR`
  (comando **«parchar»**, `patchSandbox`). Cada texto buscado tiene que estar UNA vez (tolera los espacios del final
  de cada renglón); se aplican todos o ninguno, y lo que falla vuelve como salida explicada (cuál, y si no está o se
  repite) para que lo corrija solo. Probado pidiéndole cambios a Smeargle en Auto, sin intervenir: (1) un cuarto
  servicio y el botón en verde: 3 vueltas, 71 s, de punta a punta solo; los parches salieron «no permitidos» por una
  barra de más en la expresión de la lista blanca, y él mismo lo notó y reescribió los tres archivos (el diff, mínimo
  y correcto; el formulario confirma con el servicio nuevo). (2) Arreglado eso, «el sábado hasta las 15:00»: un parche
  de un cambio, una respuesta de 335 caracteres en vez de 13 mil, 2 vueltas, 38 s. La lección de la falla: probar la
  función no alcanza si el comando no pasa la lista (`commands_test.go` ahora lo comprueba para los de la carpeta).
  **Los criterios y el freno** (2026-11-17; la idea es de los harness de agentes largos: una lista de «hecho» que el
  modelo no puede saltarse, y verificar usando la página). Cada proyecto lleva `criterios.json`: un criterio por cada
  cosa pedida, con los pasos que lo comprueban (`tocar`, `escribir`, `elegir`, `marcar`, `ver`, `no_ver`; cada uno
  arranca con la página recién cargada y tiene que terminar en un `ver` o `no_ver`). `probar` los ejecuta
  (`sandbox-check.mjs`) y dice cuál pasa; si falla, con el paso y lo que se ve en su lugar; si el archivo falta, es un
  problema y devuelve la forma. **El freno** (`sandboxPending`, `GET /api/conversations/<id>/pending`): en Auto, si el
  modelo contesta sin pedir nada pero escribió después del último `probar`, o el último dejó algo en rojo, Wally le
  dice «todavía no terminaste» y sigue (hasta 3 veces; después frena y avisa), en la interfaz y en `bin/wally`.
  Probado con una calculadora de propina, en Auto: 2 vueltas, 74 s; entregó la página y 4 criterios con los números
  exactos (15 % de 100.000 entre 2 → $57.500 cada uno), todos en verde; un caso que no había escrito él (20 % entre 4)
  también pasó. ⚠ Los criterios los escribe el mismo agente: sirven para que no cierre a ciegas, no reemplazan mirar
  que cubran lo pedido. En esa corrida el freno no llegó a actuar (salió todo a la primera): lo cubren sus pruebas.
  `probar` dice si hay errores y si pasan los criterios, no cómo se ve: eso se mira (las capturas quedan en
  `wally/pruebas/.capturas/`) o se usa.
- **Compactar: lo viejo se resume, lo último queda** (`server/compact.go`, 2026-11-17; lo que hacen los harness de
  agentes cuando el contexto se llena). Los bloques viejos se reemplazan por UN bloque `summary` que escribe el
  proveedor de la conversación en una pregunta aparte, con secciones fijas (qué se pidió, qué se hizo, hechos
  comprobados CON sus citas, lo que falló, estado y pendientes); los últimos 4 bloques quedan tal cual
  (`compactKeep`, y el corte cae en una pregunta). **Nada se pierde**: el original va a `wally/.data/archive/<conv>-
  <fecha>.json`. Después de compactar, el chat del proveedor se olvida (tenía lo viejo) y la próxima pregunta abre uno
  con el resumen; viaja como «Resumen de lo anterior», no como algo que dijo Miguel. Un resumen que falla o viene
  vacío no toca nada. **Se hace solo** cuando la conversación guardada pasa `compactChars` del proveedor
  (`providers.json`: Gemini 600 mil, DeepSeek 250 mil, ChatGPT 120 mil, Groq 20 mil), antes de preguntar; a mano, el
  botón de la barra de escribir o `bin/wally compact [--conv|--agent] [--keep 4]`. En la interfaz el resumen es un
  bloque plegado que dice cuánto reemplazó. Probado con Ditto (DeepSeek): 16 bloques → 1 resumen, de 129.801 a 26.489
  caracteres, con las citas `archivo:línea` copiadas enteras; después, preguntado por cosas que sólo estaban en lo
  compactado (qué búsquedas quedaron «no permitidas», la línea de `cognito_id`, el `destroy` vacío del admin), contestó
  bien las tres —comparado con el archivo y con `main`— mandando 39 mil caracteres en vez de más de 130 mil.
- **Ver trabajar a un agente** (2026-11-17, cuatro cambios de interfaz):
  - **Las vueltas automáticas son una línea fina**, no una burbuja de Miguel: lo que Wally le manda al modelo entre
    respuesta y respuesta («Listo: corrí los N comandos… Seguí», «Todavía no terminaste…») se reconoce por su texto
    (`roundNote`) y se muestra como «siguió con el resultado de N comandos» o «Wally no lo dejó cerrar: …».
  - **La página al lado de la conversación** (`.work-split`): «Ver» la abre a la derecha, a mitad de ancho, y se
    recarga sola cuando el agente escribe o parcha; si el agente trabaja solo (Auto, o una corrida de afuera) se abre
    sola con la primera escritura. Con menos de 1100 px ocupa todo, como antes.
  - **El cambio de cada escritura**: el servidor guarda en el comando el diff por renglones (`server/diff.go`,
    `Command.Change`: `+N −M`, o «nuevo»); la ficha lo abre en verde y rojo.
  - **El resultado de `probar` como lista**: `sandbox-check.mjs` deja el resumen en datos junto a las capturas y el
    comando lo guarda (`Command.Report`): la ficha «sin errores · 5/5 criterios» y debajo cada criterio con ✓ o ✗ (y
    el paso que falló), los errores y los desbordes.
  ⚠ Para verificar la vista previa, `make ui-shot` (un Chromium real): el navegador embebido de la sesión de Claude
  bloquea los iframes con `src` y la muestra en blanco aunque ande.
- **Enterarse cuando un agente termina** (`server/runs.go`, 2026-11-17): quien corre el modo Auto —la interfaz o
  `bin/wally ask --auto`— avisa al cerrar (`POST /api/conversations/<id>/done`, con las vueltas y, si frenó sin quedar
  bien, por qué). Sale un **aviso de macOS** por el avisador del chat, como Sentinel y Correo (tocarlo abre Wally en
  esa conversación, `cockpit://wally/#/c/<id>`; con sonido si frenó mal; sin aviso si la interfaz la tiene adelante), y
  la corrida queda **«sin ver»** hasta que se abre su conversación con Wally a la vista (`…/seen`). Las sin ver son el
  **numerito del ícono de Wally** en la barra de Cockpit (`postMessage` `badge`, que también suma al globito del
  Dock: por eso cuenta corridas terminadas, no agentes trabajando) y un punto en el agente, con su resultado debajo
  del nombre; mientras trabaja, el agente dice «trabajando solo…». `GET /api/live` da las dos cosas (quién espera
  respuesta y qué quedó sin ver) y la interfaz lo consulta al abrir y cada 2,5 s. Lo sin ver vive en memoria: un
  reinicio de Wally lo olvida.
- **Los grupos de agentes se sacaron** (2026-11-17, Miguel: «al parecer no funciona por el momento»): un grupo
  «Knowledge» con Wally de coordinador y EVA y M-O en paralelo; su única corrida chocó con el cupo de Google. Se fueron
  su pantalla, su sección de la lista, `server/groups.go` y sus rutas; la lista de temas pasó a `server/topics.go`. Su
  historia está en git (commit ee0d1432), y sus conversaciones viejas (por ejemplo «EVA · cosigner-signature») siguen en
  la lista hasta que se borren.
- **Lo que contesta el modelo se trata como no confiable**: el Markdown se muestra, pero el HTML crudo sale como texto
  y sólo se enlaza a http(s).
- Si falla, la pregunta no se guarda y vuelve al campo para mandarla de nuevo.
