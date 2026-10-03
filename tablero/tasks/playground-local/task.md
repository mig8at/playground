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

