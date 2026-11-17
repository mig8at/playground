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
| `server/files.go` | los adjuntos: `POST /api/files` (multipart, campo `file`), `GET/DELETE /api/files/<id>` |
| `src/App.vue` | la interfaz; la ruta es la pestaña activa: `#/c/<id>`, o `#/nueva/<n>` para una sin preguntas |
| `wally/.data/conversations.json` · `wally/.data/files/` | lo guardado y el texto de los adjuntos (fuera de git) |

- **Necesita Jarvis conectado en Chrome** y la sesión de Google de Miguel. Sin eso, la pregunta vuelve con el error de
  la receta.
- **De a una pregunta por vez** (409 si llega otra): Jarvis maneja una pestaña por vez y AI Studio corta si se le pide
  mucho.
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
- **Lo que contesta el modelo se trata como no confiable**: el Markdown se muestra, pero el HTML crudo sale como texto
  y sólo se enlaza a http(s).
- Si falla, la pregunta no se guarda y vuelve al campo para mandarla de nuevo.
