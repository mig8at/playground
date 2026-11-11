---
id: 96
title: "Playground local"
clase: proyecto
stage: work
created: "2026-09-24T12:00:00-05:00"
knowledge: [lender-listing]
canon: []
jira: []
jira_title: ""
---

## Pendientes

- [x] ~~Arreglar el conector de logs (`bin/pg logs`) para que no devuelva «0 líneas» cuando no corrió~~ (2026-10-13: acepta días y semanas, los conteos dicen su número, la ventana va siempre y avisa el tope): hoy `--since 16d`
  falla por la unidad («d» no es una duración de Go) y una consulta de conteo (`sum(count_over_time(…))`) falla al leer
  la respuesta; en los dos casos el error se pierde fácil y se lee como «no hay nada». Termina cuando acepta días y los
  conteos, o los rechaza con un error claro y salida distinta de cero. Visto el 2026-10-13 midiendo una incidencia.
- [x] Adaptar la primera tanda de conocimiento desde el tablero: Credifamilia, alta y baja de
  comercios, canje de códigos, contexto ecommerce e identidad. Termina cuando sus fuentes pasan
  `make knowledge-check`, las tareas relacionadas los cargan con `make retomar` y las hipótesis
  o cambios fuera de `main` siguen distinguidos del mecanismo local.
- [x] Adaptar renting/RTO, firma del codeudor y requisitos de Ábaco desde #5, #12, #13,
  #14 y #76: fuentes revisadas en `main`, tareas enlazadas y retoma comprobada. El contexto
  distingue firma registrada de autorización, consulta vigente de ingreso aprobado y código de configuración aplicada.
- [x] Adaptar formularios y país desde #8, #43 y #73: país y documentos, catálogo geográfico
  y esquema/respuestas del formulario con fuentes revisadas en `main`, tareas enlazadas y
  retoma comprobada. Las mediciones de ambientes y propuestas de arquitectura quedan en sus tareas.


- [x] Separar el contexto local de Canon: `knowledge/` versionado con fuentes, retoma sin red y consultas de negocio/producto opcionales. Termina cuando las pruebas verifican ausencia de llamadas a Canon por defecto y `make knowledge-check` valida el primer tema contra ambos monolitos.

- [ ] Sumar el visor a `tools/ui-check.mjs` (`make estilo-ui`) y hacer que falle si termina verificando cero apps; termina cuando `make estilo-ui` recorre las cuatro.

- [ ] Confirmar con la VPN que el asesor de dev no quedó asociado a la sucursal de Pullman por la prueba de rutas del harness (2026-09-25); termina cuando `whois` en dev muestra su sucursal de siempre, o se revierte.
  Depende de: Miguel — la VPN de dev.

- [ ] Aprobar o ajustar las decisiones propuestas en el prototipo (sección «Decisiones»); termina cuando
  cada una queda marcada hecha o descartada con su motivo.
  Depende de: Miguel — visto bueno sobre las cinco propuestas.
- [x] «Mínimo o nada» en `tools/ui/workbench.js`: plegar por defecto en `bindResize`, umbral = mínimo,
  la última medida abierta guardada por el módulo y un `fitRegions()` para la ventana; tokens
  `--sidebar-min` 240, `--panel-min` 124, `--editor-min` 360. Termina cuando las cuatro borran su copia
  (harness `lastKey`, los `watch` del trazador, el apretado a 160 del tablero) y `make estilo-ui` prueba
  que ninguna región queda entre 0 y su mínimo arrastrando, con teclado y con tres anchos de ventana.
  Hecho: lo verifica `make estilo-minimo` (cuatro anchos, teclado en cada manija, las cuatro apps).
- [x] Llevar la escala a `tools/ui/workbench.css`: `--text-title`, `--row-h`, retirar `--space-5`, toolbar y
  menú con `--radius-sm`; termina cuando `make estilo-sync` la reparte y `make estilo-check` sigue verde.
- [ ] Llevar los espacios propios de cada herramienta a la grilla de 4 (hoy ~30 valores distintos de
  padding, margin y gap en el harness y el tablero); termina cuando `artifacts/medir-estilo.py` da sólo
  tokens y el 2px de las toolbars, y las capturas antes/después no muestran saltos.
- [ ] Agregar a `make estilo-check` un chequeo de literales fuera de la escala (tamaños, pesos, espacios,
  radios), como el de colores literales; termina cuando da los mismos conteos que
  `artifacts/medir-estilo.py` y sale ≠0 ante uno nuevo.
- [x] Subir `.tabs` / `.tab` a `workbench.css` y migrar `.editor-tabs` y `.aux-tabs` del tablero.
- [ ] Reemplazar los caracteres usados como icono en las cuatro herramientas (`alert`, `edit`, `grip` y
  `comment` ya están en la base); termina cuando ninguna pinta un ✕ ⧉ ▸ ⚠ o un emoji como icono.
- [ ] Trazador: entrar a `.workbench` con `.auxiliarybar.overlay`, y `.sidebar-vacio` → `.empty`.
- [ ] radar, fase 1 · consola: `make radar-uso`, `-friccion`, `-deriva` y `-sesion` sobre las transcripciones
  de este playground, con `JSON=1`; termina cuando las cuatro corren con pruebas que fallan si se cuenta
  un target como muerto sin mirar la fecha en que se sacó del Makefile, o si se ignoran sus alias.
- [x] radar, fase 2 · interfaz en :5188 con `tools/ui` (sidebar con vistas y período, editor con la tabla,
  panel con la sesión); termina cuando `make estilo-check` y `make estilo-contraste` la cuentan verde.
  Hecho: `make radar` (:5188 · API :5189); los dos chequeos la cuentan verde, el de contraste en claro y oscuro.
- [x] radar, fase 3 · `make cierre` avisa la fricción NUEVA del día (lo que pidió aprobación, lo que frenó
  un hook); termina cuando un rechazo inventado en un transcript de prueba aparece en el cierre.
  Hecho: `TestTheDaysNewFrictionReachesTheCloseout` (cmd/closeout); «nueva» = no pasó igual en los 30 días anteriores.
- [x] keyring, fase 2 · el aviso al arrancar: el hook `SessionStart` corre red, AWS y sesiones de asesor
  (`keyring/check`, `check.Quick`) en paralelo con el catálogo y agrega el bloque KEYRING con lo que
  falla, vence pronto o no tiene VPN.
- [x] keyring, fase 3 · la vista: Vue + servidor Go (`make keyring-ui`, :5182 · API :5183) con
  `theme.css` y `workbench.css`, las mismas filas que la consola, cada grupo apenas contesta; la recorren
  `estilo-ui`, `estilo-minimo`, `estilo-contraste` y `estilo-check`.
- [ ] keyring · la escritura por servicio de AWS: hoy la matriz mide sólo lectura (una llamada List/Describe
  por servicio y perfil). Termina cuando cada celda dice también si hay escritura, medida sin cambiar nada.
  Depende de: Miguel — elegir cómo medirla (sondas contra un recurso inexistente, `--dry-run` de EC2, o
  sólo bajo demanda).
- [ ] Gemini responde 401 con la llave de `connectors/.env`; termina cuando `make keyring SOLO=services`
  lo da en verde.
  Depende de: Miguel — una llave nueva de Gemini.
- [x] ensayo · la herramienta: `make ensayo` corre las preguntas fijas con `claude -p` y las califica
  contra su juez; `make ensayo-comparar` decide pregunta por pregunta y sale 1 si B no se adopta.
  Hecho: 11 pruebas en `ensayo/score_test.go` (una tanda contra sí misma sale «igual», un `TARGET=`
  faltante rompe la ruta, un juez caído no califica) y una corrida real de `error-a-archivo` con acierto.
- [ ] ensayo · la línea base: `make ensayo TANDA=base` con las tres preguntas, tres corridas cada una.
  Termina cuando las tres tienen juez y está escrito cuánto costó la tanda (así se decide si cada
  comparación se paga). Depende de: Miguel — levantar MySQL local (`listado-local`) y que el conector de
  prod vuelva a contestar (`desembolsos-prod` da 500 desde Redash, también con `SELECT 1`).
- [ ] ensayo · el primer uso: las diez correcciones de los CLAUDE.md del frente «Reglas vigentes» de #90,
  la raíz recortada contra la actual. Termina cuando cada corrección queda adoptada o descartada con su
  bloque y la tabla de `make ensayo-comparar`.
- [x] ODD · specs en las tareas de código (hecho el 2026-11-02, piloto en harness #86): una sección opcional `## Specs` en la plantilla, con `S#`, la cita textual
  de quien pidió (Miguel, producto, Jira) y la suite o comando que la comprueba. Idea tomada de Organic Driven
  Development de gentle-ai, que ya usa el equipo de la app (`creditop_mobile/odd/tasks/`). Termina cuando una tarea
  real con código la usa y su bloque dice si ayudó a retomar. No se instala gentle-ai en el playground.
- [x] ODD · veredicto por spec (hecho el 2026-11-02, `make tarea-verify`): `make tarea-verify N=…` (o `harness-knowledge` apuntado a una tarea) lee las `S#` de
  la tarea, corre lo que cada una cita y responde `S1 ✓ · S2 ✗`. Termina cuando la tarea piloto da su veredicto
  por spec. Depende de: la sección `## Specs`.
- [ ] ODD · proporcionalidad del cierre: que una sesión chica (sin rama, pocos minutos) no exija bloque, sólo
  bitácora, como ODD no deja artefactos para lo trivial. Termina cuando `make cierre` distingue los dos casos y
  la regla queda en `tablero/CLAUDE.md`.

- [x] Vigía · saber qué estado es una falla — 2026-11-11, por el catálogo de producción (`user_request_statuses`): 6 es
  Negada y 8 Cancelado, decisiones y no fallas; los grupos (aprobadas, negadas) están en `sentinel/server/main.go`. No se
  verificó en el código de los monolitos.
- [ ] Vigía · fase 1 y la vista (prototipo hecho el 2026-11-11: `sentinel/`, app en Cockpit, lee prod cada 5 min): que
  Miguel la mire y reconozca los números como ciertos. Termina cuando lo dice, o cuando corrige qué está mal.
- [ ] Vigía · fase 2, avisar solo: cuando algo pasa a alerta, un aviso (macOS, chat o Slack, según decida Miguel), sin
  repetir el mismo; más seguido en las 2 horas después de un despliegue a producción. Termina cuando una alerta real
  llega sola y una que ya se avisó no se repite.
- [ ] Vigía · decidir con Miguel lo abierto del frente (qué vigilar, qué es «salirse», por dónde avisar). Termina cuando
  el frente lo dice y no quedan preguntas.
  Depende de: Miguel — las respuestas de «Preguntas para decidir».

## Alcance

Lo transversal a las herramientas locales —`harness`, `tablero`, `trazador`, `visor` y las que
vengan—: cómo se ve, cómo se divide la pantalla, cómo se llama cada parte y qué contrato cumple una
herramienta nueva para parecerse a las demás. Una mejora de una sola herramienta sigue yendo a su
contenedor; lo que no es de herramientas (negocio, conectores, país) sigue en `playground` (#90).

La fuente de lo que ya existe es `tools/ui/` (`theme.css`, `workbench.css`, `workbench.js`,
`RegionMenu.vue`) y `make estilo-check`, que lo verifica en las cuatro.

## Frente: conocimiento local desde las tareas

**Objetivo.** Recuperar el conocimiento técnico útil del trabajo real, de forma incremental y
con fuentes comprobables. Cada tema explica un mecanismo y sus límites; el tablero conserva
los casos, las propuestas, los pendientes de negocio y las mediciones de ambientes.

**Cierre de cada tanda.** Leer las tareas pertinentes y sus bloques, verificar el código de
`main`, escribir o ajustar el tema, enlazarlo en `knowledge:` y comprobar fuentes y retoma.
Los temas se descubren con `make knowledge-map`; no se mantiene un segundo tablero en la biblioteca.
Publicar en Canon no es parte de este cierre. Sus referencias anteriores quedan opcionales.

## Frente: el estándar del esqueleto

**Objetivo.** Un documento —prototipo en artifact— que diagrame el esqueleto principal de una
herramienta y le dé nombre a cada parte visual (sidebar, editor, toolbar, statusbar…), con la regla
de cuándo existe cada una, para que una herramienta nueva se arme leyendo eso y no copiando otra.

**Estado del estándar.** El prototipo
[`artifacts/anatomia-del-workbench.html`](https://claude.ai/artifact/HAeuwXf3LCoQzYhTarn1Vz) define el
esqueleto, la tipografía (5 tamaños, 2 pesos), los espacios (4 · 8 · 12 · 16 · 24), las alturas
(24 · 28 · 32 · 40 · 30), los iconos (el juego de `workbench.css`, un solo tamaño de 16px) y la forma
(radios 0 · 6 · completo). El contrato vigente sigue siendo `tools/ui/README.md` hasta aprobarlo.

## Frente: radar — el uso real de las herramientas

**Objetivo.** Una herramienta que lee las transcripciones de Claude Code de ESTE playground y muestra
cómo se usan de verdad las herramientas: uso, fricción (lo que pidió aprobación, lo que frenó un hook,
lo que falló), deriva (lo documentado que nadie usa y lo usado que nadie documenta) y el recorrido de una
sesión. Nace de haber encontrado a mano, en una tarde, el catálogo de `make` cortado, diez skills
invisibles desde la raíz y `canon-search` pidiendo aprobación cada vez.

**Reglas.** Sin modelo y sin copias a mano: todo se deriva de las transcripciones, el Makefile (con sus
alias), las skills y `git log`. Sólo lectura y sólo `localhost`; los comandos se muestran cortados y sin
secretos. Un target sin uso es una señal con fecha, no un veredicto — un «muerto» se decide contra la
fecha en que salió del Makefile. Para partir comandos se reusa lo de los hooks, no un parser nuevo.

**Lo que se evaluó y NO se eligió.** Un router con Jev que conteste con JSON qué herramienta usar: sería
un segundo modelo decidiendo por el primero, y sus «stores» una copia del catálogo que envejece. Medido
el mismo día, con las skills visibles el ruteo nativo acertó 74 de 84 corridas sin falsos positivos.

## Frente: ensayo con/sin — un cambio al playground se mide antes de quedarse

**Objetivo.** Que un cambio a lo que guía al modelo —un CLAUDE.md, una skill, un hook, una memoria, una
trampa— se adopte sólo si, corriendo las mismas preguntas con y sin él, el resultado no empeora en
ninguna y mejora en alguna. Hoy esos cambios entran por criterio y radar mide su uso, no su efecto.
La idea viene de Harness² (Google Research, `google-research/harness2`): correr la configuración actual
y la candidata sobre la misma tarea y quedarse con la diferencia observada. Se toma el método, no la
herramienta.

**Las preguntas fijas** están en `ensayo/preguntas.json`. Cada una sale de un error que ya costó y tiene
un juez que no es un modelo: un comando que imprime lo que la respuesta tiene que nombrar.

| id | el error que mide | la ruta que se exige | el juez |
|---|---|---|---|
| `listado-local` | `E2E_TARGET` por defecto es dev | `E2E_TARGET=local` antes de `harness-listing` | el mismo listado, corrido por el juez |
| `desembolsos-prod` | el estado 11 no cuenta desembolsos | `--target prod` y `disbursed_at`; prohibido contar por estado 11 | la misma consulta, por el conector |
| `error-a-archivo` | mirar un solo monolito, o el working tree | `git grep` contra main en los DOS monolitos | el `git grep` de los dos |

Se quedaron afuera, a propósito, «¿cierra este caso?», «¿esta regla excluye?» y «¿qué le pasó a esta
solicitud?»: sus jueces escriben en la base o dependen de una solicitud viva, y un juez que cambia entre
tandas rompe la comparación. Cambiar una pregunta cambia su huella, y `ensayo-comparar` se niega a
comparar tandas con huellas distintas.

**Qué se mide por corrida.** Todo sale de lo que ya existe; nada se anota a mano.

- **acierto**: la respuesta contra el juez. Es la medida principal; las demás sólo desempatan. Si el juez
  no contestó, la corrida queda «sin juez»: no cuenta como acierto ni como error.
- **ruta**: las llamadas enteras de la transcripción (radar las corta a 160 caracteres). Lo que `must`
  pide cuenta sólo si la llamada salió bien: un `git grep` que el permiso frenó no es haber mirado main.
  Lo que `must_not` prohíbe cuenta con sólo intentarlo.
- **fricción**: las llamadas que no salieron bien, con el criterio de radar (`denied`, `blocked`, `error`).
- **costo**: `total_cost_usd` y `num_turns` del `--output-format json` de `claude -p`.

**Regla de adopción.** Tres corridas por pregunta y por lado (`N=3`), porque una sola es ruido. B se adopta
si ninguna pregunta baja su acierto y alguna mejora, o si, empatando, mejora la ruta o la fricción sin
costar más de un tercio extra. Ese tercio se fijó a ojo y se ajusta con la línea base. Adoptado o no, queda
un bloque con la tabla de `ensayo-comparar`: es la «experiencia con evidencia» de Harness², en la pila en
vez de un `EXPERIENCE.md`.

**Cómo se comprueba.**

    make ensayo TANDA=base SECO=1                 # sólo los jueces: gratis, dice cuáles contestan
    make ensayo TANDA=base                        # GASTA: 3 preguntas × 3 corridas, tope US$1.5 cada una
    # … aplicar el cambio (un CLAUDE.md, una skill) …
    make ensayo TANDA=recorte
    make ensayo-comparar A=base B=recorte         # sale 0 si B se puede adoptar, 1 si no

- A y B corren en el MISMO checkout, una después de la otra, y cada tanda guarda el commit que midió
  (`+cambios` si había cambios sin commitear). Dos copias en worktree fallan en silencio sin los `.env`.
- Las corridas usan `--allowedTools` acotado a lectura, `make` de consulta y `bin/pg`, y niegan
  `Edit`, `Write`, `git commit/push` y `--apply`. Llevan `--add-dir ~/Desktop/CREDITOP/github`, como una
  sesión normal: sin él, todo `git -C` a main queda frenado y el modelo termina leyendo el working tree.
  Corren sin `E2E_TARGET`, porque decirlo es parte de lo que se mide. Los hooks del repo siguen activos.
- radar ya separa estas corridas (`human: false`), así que no ensucian `radar-uso`.
- Las tandas quedan en `ensayo/.tandas/`, fuera de git: guardan las respuestas, que pueden traer datos
  de prod.

**Lo que se evaluó y NO se eligió.**

- **Instalar Harness²**: su red no tiene límite, desactiva el sandbox de Codex y edita sus propias
  guardas; acá la sesión tiene credenciales de prod y una base de dev compartida que ya se borró una vez.
- **Que un modelo componga el cambio (el paso «compose»)**: lo propone o lo escribe Miguel; el ensayo
  sólo mide.
- **Juzgar con un modelo**: el paper compara comportamiento sin un juez de verdad, y eso adoptaría con
  gusto una regla que «debería excluir» y no excluye. Acá el juez es el harness, la base o `git grep`.

## Frente: keyring — a qué hay acceso ahora y cuándo vence

**Objetivo.** Saber antes de empezar qué credenciales y redes están vivas: VPN de dev y de prod, perfiles
de AWS, las bases, Loki y PostHog por ambiente, los servicios de `connectors/` y las sesiones de asesor
del harness, con su vencimiento cuando lo hay. Nace de un curl a dev que murió por DNS: sin VPN, «no
tengo acceso» y «no estoy conectado» se leen igual.

**Reglas.** Cada fila hace UNA lectura barata con las credenciales de `connectors/`, nunca una copia; no
escribe, no gasta (Jev y la escritura de canon sólo se miran, no se prueban) y nunca muestra un valor
secreto: sólo si hay, de quién es y cuándo vence. Sale 1 si algo falla. Consola primero
(`make keyring`, en `keyring/server`), después el aviso al arrancar, y la vista al final.

**Lo que se evaluó y NO se eligió.** Adivinar el vencimiento de las credenciales de AWS pegadas del
portal de SSO: no lo declaran (lo fija el permission set), así que la fila dice cuándo se pegaron y no
inventa una hora.


## Frente: un agente saca una tarea solo, antes de pasar a multiagente

**Objetivo.** Que un agente, con una tarea del tablero y nada más, la lleve hasta un cierre comprobado usando
las herramientas del playground, sin que Miguel tenga que corregirle el ambiente, la fuente o la conclusión.
Multiagente viene después: varios agentes sin verificación automática multiplican afirmaciones sin comprobar,
y en la sesión del 2026-11-02 los errores no fueron de velocidad sino de verificación.

**El recorrido, paso a paso** (lo que hoy funciona, armado con las corridas de esa sesión):

| paso | pregunta | con qué |
|---|---|---|
| 1 · entender | ¿qué pide la tarea, qué se hizo, qué se sabe? | `make retomar N=…` (documento, pila, pendientes, ramas y `knowledge:`), `make knowledge-search`, el índice de síntomas de `tablero/data/traps/doc.md` |
| 2 · delimitar | ¿qué comando dice «hecho»? ¿contra qué ambiente? | escribir el criterio como una corrida (`harness-case`, una suite, una consulta) antes de tocar nada; el ambiente más chico que conteste |
| 3 · el ambiente | ¿una corrida ahora diría la verdad? | `make harness-doctor TARGET=local`, `make keyring`; en remoto, `make harness-env-drift` |
| 4 · reproducir | ¿pasa, y cuánto? | `harness-case`, `-listing`, `-walk-wizard` (con `JSON=1`); en prod sólo lectura: `bin/pg request timeline`, `events request`, `sql` |
| 5 · localizar | ¿dónde se decide? | `git grep` contra `main` en los dos monolitos, o el subagente `main-verifier`; el texto de un error lleva al archivo |
| 6 · cambiar y probar | ¿lo arreglé sin romper otro flujo? | la misma corrida del paso 2, y `make harness-regression TARGET=local` |
| 7 · registrar | ¿lo encuentra el próximo? | `BLOQUE=<tarea>` en las corridas, `make tarea-bloque`; un mecanismo verificado a `knowledge/`; una trampa a `traps/doc.md` |
| 8 · cerrar | ¿quedó medido y entregado? | `make bitacora-add PULSO=…`, `make cierre`; commit por ruta; push, PR, Jira o Canon sólo con el sí de Miguel |

**Los tropiezos que el recorrido tiene que atajar** (todos del 2026-11-02):
- **Local no es prod.** La base local viene de dev: ids y configuraciones distintas (Motai R sin plazo, AltaX
  pidiendo codeudor). Antes de llamar defecto a algo visto en local, mirar el mismo dato en prod (sólo lectura).
- **Una salida cortada se lee como «no está».** `isRevolvingIncrement` «faltaba» porque se leyeron 900
  caracteres. Leer la respuesta entera o preguntar por la clave.
- **Una rama que no es `main` mide esa rama.** `harness-doctor` lo avisa; la conclusión dice qué rama se midió.
- **Un verde no es el caso.** Una suite que pasa con datos sembrados no prueba la regla en prod.

**Pendientes del frente:**
- [x] `make agente N=…` (`tablero/server/cmd/agent`, hecho el 2026-11-02): en una sola salida JSON lo que hoy son cinco comandos — la tarea y
  su pila, sus temas de `knowledge:`, las trampas cuyo síntoma coincide, el estado del ambiente (`harness-doctor`) y
  las ramas. Termina cuando un agente arranca una tarea con esa sola llamada.
- [x] El criterio de «hecho» por tarea, como corrida (hecho el 2026-11-02): `## Specs` en la plantilla y
  `make tarea-verify N=…`; el piloto es harness (#86), que da `S1 ✓ · S2 ✓ · S3 ✓ · S4 ✓`.
- [ ] Probar el recorrido con dos o tres tareas reales de distinto tipo (un defecto, una regla de negocio, una
  herramienta), con `make ensayo` para comparar con y sin la guía. Termina cuando hay una tabla con tiempo,
  correcciones de Miguel y afirmaciones que resultaron falsas, por tarea.
  Primera tanda («agente», 2026-11-02, US$3,08): 5 de 6 aciertos; las fallas fueron del juez y del permiso del
  ensayo, no de la guía (bloque del día). Falta la tanda «sin»: medirla sin `make agente` pide un checkout aparte,
  y este worktree es compartido.
- [ ] Recién con eso, multiagente: un agente que investiga (sólo lectura, `main-verifier`), uno que corre (harness)
  y uno que escribe, coordinados por un workflow. Termina cuando una tarea sale con los tres y su verificación
  automática no encuentra afirmaciones sin comando.

## Frente: sala — agentes independientes que barren temas en paralelo

**Objetivo.** Encontrar contradicciones entre knowledge/ y `main`, huecos de la biblioteca, reglas sin prueba y
posibles defectos con varios agentes a la vez, sin que Miguel tenga que guiar cada uno, y verlos trabajar.

**Cómo está armada** (`sala/`, `make sala` → :5201; por consola `make barrido [TEMAS=a,b] [N=3]`). A la izquierda,
los temas de knowledge/ de la revisión más vieja a la más nueva, los topes y «Simulado». Se lanza y aparece un panel
por agente con lo que va corriendo (cada herramienta y cada cosa que dice), y uno más para el verificador.
- **Un agente por tema**, en paralelo y sin turnos: una sesión larga de `claude -p` (Opus 5.5, esfuerzo medio) con
  todas las herramientas de lectura (main de los dos monolitos, `knowledge-*`, `bin/pg` en sólo lectura, el harness).
  No hablan entre ellos. Cada uno termina con su lista de `HALLAZGO: <tipo> | <qué, con archivo:línea> | <destino> |
  COMANDO: <cmd>`.
- **El verificador** (Opus 5.5, esfuerzo alto) arranca cuando terminan todos, no escribió nada y pone un veredicto por
  hallazgo (✓, ✗ o —) con el comando que corrió.
- **Retroalimentación:** lo que el verificador confirma queda en `sala/.barridos/conocidos/<tema>.md` y entra al brief
  del próximo barrido de ese tema. Cada barrido deja su informe y su `barrido.json` en `sala/.barridos/<id>/` (fuera de
  git), y la página los muestra en «Barridos anteriores».
- **Nada se escribe solo en knowledge/.** Pasar los hallazgos a un tema es otra pasada, con una segunda mirada.
- **Qué gasta (medido el 2026-11-02).** `claude -p` entra con la sesión de claude.ai de Miguel (plan de equipo): gasta
  el límite del asiento (ventana de 5 horas y semanal), no se cobra por token. Los US$ son el equivalente a precio de
  API, para comparar. Cada sesión arranca con ~66k tokens de carga fija (Claude Code, el proyecto, MCP); por eso
  conviene una sesión larga y no muchos turnos cortos. ⚠ La CLI no reconoce los ids 5.5 y su US$ no sirve para
  comparar modelos: comparar tokens.

**Lo que se evaluó y NO se eligió: la sala de llamadas** (2026-11-02 y 03, retirada el 2026-11-03). Varios agentes con
roles (investigador, arquitecto, datos, probador, verificador, coordinador) en una «llamada» por turnos o en canal, con
un portero en Haiku que decidía a quién despertar, pizarra de afirmaciones, preguntas con dueño y varias salas. Se
compararon con el mismo tema (`lender-profile-rules`), el mismo brief y el mismo tope: un agente solo dio 10
hallazgos (9 comprobados ciertos) con US$2,13 eq.; la llamada, 0 con US$2,49 eq. Cada turno volvía a pagar el
contexto base y cada rol alcanzó a trabajar una vez. Coordinar agentes cuesta más de lo que aportan mientras cada
turno cueste un contexto entero; lo que sirvió de ella (que lo afirmado lo compruebe otro) quedó en el verificador.

**Pendientes del frente:**
- [x] Barrido · un verificador que no firme todo: marcó 28 de 28 con ✓ y la pasada a knowledge descartó partes de
  H16 y H17. Termina cuando un barrido real tiene algún ✗ o —, o una segunda mirada no encuentra nada que él aprobó.
  Con el prompt que le pide abrir cada cita y tomar como ✗ una parte falsa, el segundo barrido real dio 3 ✗ de 26.
- [ ] Barrido · lo que el segundo dejó para la tarea, que son datos de prod: dos sucursales de comercios peruanos en
  Bogotá y una en el comodín de Colombia, y el RTO de Motai que firma la prenda. (La tabla FNG vacía ya está en
  `incidencias`.) Termina cuando cada uno tiene dueño en
  `incidencias` o queda descartado con su motivo.
- [ ] Barrido · las suites que señalaron los dos: reemplazo de respuestas del formulario dinámico, cascada
  zona→ciudad en el wizard, formas de `alignedSplit`, cascada Ágil Data→TusDatos con `ONB005`, tipos de documento
  por país, el árbol de ciudades de form-service, la ciudad de cada sucursal contra el país de su comercio, la fianza
  y el plan de Credifamilia, las fórmulas del renting, el catálogo de firmas de Motai, editar un convenio que pisa la
  garantía de otros comercios, guardar una sucursal con una entidad sin convenio, Ábaco según `abaco_is_enabled` y su
  salto de buró, que las opciones del formulario de SmartPay coincidan con su política de puntaje, la baja y la
  reactivación de un comercio, la espera del asesor y del titular en IMEI, un desembolso IMEI fallido, la guarda
  `ALLIED_DISABLED` del OTP v2 y la elección de camino del KYC (`OBV23000`/`OBV23001`/`OBV23003`). Termina cuando cada una corre con `make harness-suite` o queda descartada con su motivo.


## Frente: vigía de producción — saber pronto si un cambio que subió está fallando

**Objetivo.** Un lugar que consulte solo, cada pocos minutos, lo que pasa en producción por **entidad** y por
**comercio**, y avise cuando algo se sale de lo normal; sobre todo en las horas siguientes a un despliegue, para que un
cambio que rompe algo se vea en minutos y no cuando lo reporta un comercio. Es el OKR de Miguel («servicios saludables
y monitoreados», alertas de salud) aplicado a la originación. Idea del 2026-11-11, para retomar al día siguiente.

**Lo que ya existe y sirve (medido el 2026-11-11).**
- *Producción se lee sin VPN*, por Redash (`bin/pg sql --target prod`, sólo lectura): en el último día, 1.109 solicitudes
  por `user_request_status_id`, y por entidad con `user_requests.lender_id` → `lenders` (Addi 138, Bancolombia consumo 43,
  Welli 41…). El comercio está en `allied_id` y la sucursal en `allied_branch_id`.
- *Qué se desplegó y cuándo*: `make deploys` (repo, ambiente, versión, fecha y si falló); en dos días, 3 despliegues a
  producción (`legacy-backend v0.6.46`, `legacy-application v1.2.11` y `v1.2.12`). Es el «antes y después».
- *Lo que no está en la base*: errores en los logs por servicio (`bin/pg logs`, Loki de prod, con credenciales), errores
  de pantalla que vio el cliente (`bin/pg events errors`, PostHog), y trabajos fallidos de la cola (`bin/pg jobs failed`).
- *Avisar*: el chat ya manda avisos de macOS y un agente puede hablar como agente (`bin/chat … --as`); Slack, por `bin/pg
  slack post` (escribe: sólo con confirmación).

**Prototipo (2026-11-11): `sentinel/`** —ver `sentinel/CLAUDE.md`— con las fases 1 y 3 armadas sobre datos reales; falta la 2. El diseño:
1. *Una pasada, por consola* (`make sentinel`): por entidad y por comercio, la última hora contra **la misma hora de los
   7 días anteriores** —el volumen cambia mucho por hora y día, así que un umbral fijo mentiría—: cuántas solicitudes
   entraron, cuántas fallaron, cuántas quedaron trabadas, y si se salió de su rango normal; más los errores de Loki por
   servicio y los trabajos fallidos en la misma ventana. Marca los despliegues a producción de esa ventana. Sale 1 si
   hay alerta. Sólo lectura.
2. *Periódico y con avisos*: corre cada 10–15 min (un LaunchAgent como el pulso, o dentro de Cockpit) y, cuando algo se
   sale, avisa por macOS y en el chat («Addi: 0 solicitudes en la última hora, normal 6–9 · desde el despliegue de
   legacy-backend v0.6.46 de las 15:10»), con el enlace al tracer del equipo para mirar el caso. En las 2 horas después de
   un despliegue a producción, más seguido y más sensible. Sin repetir el mismo aviso.
3. *La vista*: una app en Cockpit con un semáforo por entidad y comercio, la curva del día contra lo normal y las marcas
   de despliegue; un clic lleva a las solicitudes de esa hora.

**Lo que NO entra.** Escribir en producción (nada: sólo lectura, como todo prod). Reemplazar las alertas de infraestructura
del equipo (caídas de servidores, CPU): esto mira el negocio —¿siguen entrando y avanzando solicitudes?—, no la máquina.

**Preguntas para decidir.** ¿Todas las entidades y comercios, o una lista de los que importan? ¿Qué es «falla» para cada
señal (los estados, cuántos minutos sin avanzar es «trabada»)? ¿Qué tan sensible (muchas alertas falsas cansan y se
ignoran)? ¿Por dónde avisar: macOS, el chat, un canal de Slack del equipo? ¿Vive en Cockpit o aparte?
