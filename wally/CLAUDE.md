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
| `server/agents.go` | los agentes: `GET/POST /api/agents` (abajo) |
| `server/pool.go` · `server/groups.go` | el pool de AI Studio y los grupos de agentes (abajo, en pausa) |
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
- **La conversación la guarda Wally, en BLOQUES** (idea de Miguel, 2026-11-17): cada pregunta tuya y cada respuesta es
  un bloque con su id. AI Studio no recuerda nada (chat temporal: cada pregunta abre uno nuevo), así que la próxima
  pregunta le manda TODOS los bloques guardados como transcripción (`transcript`) y la pregunta nueva al final.
  **Cualquier bloque se borra** con su tacho (aparece al pasar el mouse), sin confirmación: así se saca contexto que
  no aporta y se queda sólo lo que sirve. Arriba a la derecha, «contexto: N bloques · M caracteres» dice lo que va a
  viajar. Los bloques de antes no tenían id: se les pone al cargar.
- **Los modelos** son dos, elegidos por Miguel para el día a día (2026-11-17) de las fichas del selector: Gemini
  3.8 Flash, el de siempre, y Gemini 4 Hydrogen para lo difícil (`chatModels`). Los dos sin «Paid».
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
    cortada desde las 12:39. **Falta su primera respuesta.**
- **Los grupos de agentes** (EN PAUSA desde el 2026-11-17: Miguel prefirió empezar por los agentes sueltos; el código
  queda y no se toca) (idea de Miguel, 2026-11-17, «como Duncan»: varios agentes en paralelo y un chat de todos):
  en la lista, «Grupos de agentes» y su «+» (`#/grupo-nuevo`). El grupo **Knowledge** (`server/groups.go`) lo
  coordina **Wally** (sin modelo: reparte, avisa y cierra) y lo trabajan **EVA** y **M-O**, en paralelo por el pool.
  Se arma de dos formas: «Poner al día lo pendiente» (los temas con fuentes cambiadas según `knowledge-check`) o
  «Revisar temas» (los que se marcan). Cada agente toma un tema de la cola y lo manda **en UN envío**: el paquete
  (`taskPack`) ya lleva lo que antes pedía en 4 a 7 vueltas —las fuentes, el `diff` de cada una cambiada y las
  secciones afectadas, o el tema entero si es una revisión—; si pide más, sus comandos de lectura se corren solos
  (`decideCommand`, la misma lista blanca: la lectura va en automático, como salió de la evaluación), hasta 5 vueltas
  y 6 comandos por vuelta. **Escribir sigue igual**: el grupo NO toca knowledge; deja propuestas para verificar contra
  `main`. En el chat del grupo cada agente publica sólo lo corto (toma un tema, la línea `RESUMEN:` de su respuesta,
  una pausa, un problema); tocar su ficha arriba, o «Abrir la conversación», abre su conversación completa, que es una
  más de la lista («EVA · tema»). Un corte de Google lo espera el agente hasta que vence la pausa (+20 s, hasta 4
  veces); otro error, lo reintenta una vez a los 30 s. Un grupo que corría cuando se reinició el servidor queda
  «terminado» con sus agentes «cortado». API: `GET /api/topics`, `GET/POST /api/groups`, `GET/DELETE
  /api/groups/<id>`; se guarda en `.data/groups.json`.
  - **Primera corrida (2026-11-17, 12:49, Flash, 2 temas para revisar)**: la interfaz anduvo (plan, fichas, posts en
    vivo); M-O no abrió su pestaña (el `_page`, ya con reintento) y EVA chocó 5 veces con «Permiso denegado»: la
    cuenta venía cortada desde las 12:39 tras un día entero de pruebas. Se frenó a mano. **Falta una corrida entera
    con la cuenta descansada**: que los dos contesten en paralelo y salga el `RESUMEN:`.
- **Lo que contesta el modelo se trata como no confiable**: el Markdown se muestra, pero el HTML crudo sale como texto
  y sólo se enlaza a http(s).
- Si falla, la pregunta no se guarda y vuelve al campo para mandarla de nuevo.
