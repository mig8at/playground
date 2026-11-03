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

## Frente: sala — varios agentes en una llamada (experimental)

**Objetivo.** Probar si varios agentes con roles distintos, sentados en la misma «llamada» sobre una tarea, la
resuelven mejor o más barato que uno solo. Nace del ensayo del 2026-11-02: el agente solo no descubría las
herramientas que más le ahorraban (`harness-doctor`, `make agente`); un participante cuyo trabajo sea decir
«con qué se hace esto» ataca justo eso.

**Cómo está armada** (`sala/`, `make sala` → :5201). Una página con un recuadro por participante (quién habla,
qué está corriendo, cuánto lleva gastado), la transcripción común y una pizarra de afirmaciones. Miguel entra
como un participante más: escribe, interrumpe o corta.
- **Moderador:** es código, no un modelo. Da la palabra por turnos y corta por tope de rondas, tope de gasto, o
  cuando el probador dice que terminó.
- **Experto en herramientas:** arranca con `make agente N=…` y dice qué comando conviene para cada paso. Sólo
  catálogo, `agente`, `doctor`, `knowledge-*` y `retomar`.
- **Arquitecto:** dónde se decide algo en `main`, en los dos monolitos. Sólo lectura (`git grep`, `knowledge/`).
- **Probador:** escribe y corre las comprobaciones (harness contra local, `tarea-verify`, lecturas de `bin/pg`) y
  avisa cuando termina.
- Cada agente es una sesión de `claude -p` que se retoma turno a turno (`--resume`), con su rol en el prompt de
  sistema, sus herramientas permitidas y un tope de gasto por turno. Nadie edita archivos, commitea ni corre el
  harness contra prod.
- **La pizarra:** una afirmación entra con el comando que la sostiene (`AFIRMO: … | COMANDO: …`). La que no lo
  trae queda marcada: tres agentes de acuerdo no prueban nada.
- `MOCK=1` corre la llamada con respuestas simuladas, sin gastar, para la interfaz.

**Pendientes del frente:**
- [x] Una llamada real sobre una tarea del tablero, con tope de US$3 (hecho el 2026-11-02: tarea 86, una ronda,
  US$1,25; bloque del día). Salieron dos arreglos para el moderador y la pizarra (abajo).
- [ ] El moderador no cierra con un «TERMINÉ» que deja cosas abiertas: abre una ronda de objeciones antes de
  cortar. Y una corrección a algo existente (una nota, un tema, una suite) va a la pizarra aunque venga en prosa.
  Termina cuando una llamada real lo muestra. Hecho en el código y probado simulado el 2026-11-02 (objeción → la
  llamada sigue; corrección en prosa → C3, refutada por el probador con COMPRUEBO); falta verlo en una llamada real.
- [ ] Compararla con el agente solo en las tres preguntas de tarea del ensayo. Termina cuando hay una tabla de
  aciertos, turnos y costo; si la sala no gana, queda como experimento y se dice por qué.
