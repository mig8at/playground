# CREDITOP · playground — una sola puerta para todo
#
# `make` sin argumentos lista lo que hay. La idea es no tener que recordar en qué carpeta vive cada
# comando ni cómo se llamaba el script.
#
# CONVENCIÓN DE NOMBRES: los NOMBRES PROPIOS se quedan como están (`tablero`, `harness`, `panel` son
# carpetas reales, traducirlas agregaría una capa de traducción mental) y los VERBOS van en inglés
# (`align`, `refs`, `seal`, `check`). Un comando de proyecto se nombra `proyecto-verbo`.
#
# ⚠ Por qué `trazador-ureq` y no `trazador ureq`: para make, dos palabras son dos objetivos distintos
# (correría `trazador` y después `ureq`). Se puede simular con un catch-all, pero entonces un typo
# como `trazdor-ureq` no da error: no hace nada en silencio. Con guion, make avisa y además el guion
# autocompleta con TAB.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# ── AYUDA ────────────────────────────────────────────────────────────────────────────────────────
.PHONY: help
help: ## esta lista
	@echo ""
	@echo "  CREDITOP · playground        (make <comando>)"
	@$(call listar,@dia,LO QUE SE USA TODOS LOS DÍAS)
	@$(call listar,@can,CANON — el corpus del equipo: leerlo y dictarle (skill: .claude/skills/canon))
	@echo "    y desde ~/Desktop/CREDITOP/github/playground/tools/canon:"
	@echo "    go run . -ronda                      ¿qué cambió en main de lo que el corpus declara?"
	@echo "    go run . -peso                       …y cuál de eso pesa, por actividad de 90 días"
	@$(call listar,@har,HARNESS — validar una tarea corriéndola contra el código real)
	@$(call listar,@expl,EXPLORACIONES — NO son fuente de contexto (ver CLAUDE.md))
	@echo ""

# listar <etiqueta> <título> — imprime los targets de una categoría, alineados.
# El separador es un TABULADOR y no `|`: con pipe, una descripción que contenga `|` (y hay varias,
# tipo `PRODUCT=bnpl|consumo`) se corta en la mitad. Elegir de separador un carácter que puede
# aparecer en el dato es el clásico bug de parseo casero.
define listar
	echo ""; echo "  $(2)"; \
	grep -hE "^[a-z][a-zA-Z0-9_-]*:.*## $(1) " $(MAKEFILE_LIST) \
	  | sed -E 's/^([a-z][a-zA-Z0-9_-]*):.*## $(1) /\1\t/' \
	  | awk -F'\t' '{printf "    \033[36m%-18s\033[0m %s\n", $$1, $$2}'
endef

# ── DÍA A DÍA ────────────────────────────────────────────────────────────────────────────────────
.PHONY: status tablero tareas tareas-guard cuadrilla-publicar sprint bitacora tarea-bloque tarea-context-add tarea-context tablero-db panel trazador trazador-buscar trazador-ureq \
	trazador-diag trazador-chequeo trazador-indexar-logs trazador-validar trazador-slack trazador-hilos
status: ## @dia ¿está el contexto al día? (resumen, no escribe nada)
	@$(MAKE) --no-print-directory trampas
	@echo ""
	@echo "  El contexto compartido es CANON, que vive en otro repo y tiene su propia ronda:"
	@echo "    cd ~/Desktop/CREDITOP/github/playground/tools/canon && go run . -ronda"
	@echo "  (dice qué fuentes declaradas cambiaron o desaparecieron de main; -peso las prioriza)"

tablero: ## @dia abre el tablero: las tareas a realizar (:5191)
	@cd tablero && npm run dev

# El tablero por CONSOLA. El store ya había resuelto la mitad —pasó a archivos porque «era el único
# rincón del playground que un modelo no puede leer sin levantar un server»— pero preguntar EN QUÉ SE
# TRABAJA seguía obligando a parsear los frontmatters a mano, y el GUARD sólo corría al publicar,
# cuando ya es tarde para decidir cómo escribir.
tareas: ## @dia las tareas abiertas, sin abrir la UI. N=<slug|id> · STAGE=work · TODAS=1 · JSON=1
	@cd tablero/server && go run ./cmd/tasks $(if $(N),-n $(N)) $(if $(STAGE),-stage $(STAGE)) $(if $(TODAS),-todas) $(if $(JSON),-json)

tarea-json: ## @dia proyección JSON tipada de UNA tarea (v3): el documento y su pila. N=<slug|id> · CONTENIDO=1 incluye borrador Jira
	@test -n "$(N)" || { echo "falta N=<slug|id>  ·  ej: make tarea-json N=tablero"; exit 2; }
	@cd tablero/server && go run ./cmd/tasks -n "$(N)" -json $(if $(CONTENIDO),-contenido)

# ⚠ Lee el SNAPSHOT de Jira, no el estado vivo — e imprime cuándo se tomó, porque un tablero
# presentado como actual siendo de hace días es peor que no tenerlo: se decide sobre él.
sprint: ## @dia el sprint activo con sus tareas y puntos, del snapshot (dice cuándo se tomó). JSON=1
	@cd tablero/server && go run ./cmd/tasks -sprint $(if $(JSON),-json)

bitacora: ## @dia el tiempo registrado, agrupado por día. DAYS=7 · JSON=1 (la nota entera va en el json)
	@cd tablero/server && go run ./cmd/tasks -bitacora $(or $(DAYS),7) $(if $(JSON),-json)

# ⚠ Sale 1 si el texto NO puede salir: sirve para frenar antes de publicar, no sólo para informar.
# Mide contra los repos LOCALES lo que el último `fetch` dejó: no habla con la red a propósito (un
# comando de lectura que sale a internet sorprende, y en 13 repos nadie lo correría). Por patch-id, así
# que detecta un cambio que llegó por SQUASH — donde el nombre de la rama ya no existe.
tareas-ramas: ## @dia ¿en qué ramas vive cada tarea y hasta dónde llegó (y si ya está en main)? mide git + PRs. N=<id|título> · SUGERIR=1 propone patrón a las que no declaran ramas · JSON=1
	@cd tablero/server && go run ./cmd/branches $(if $(N),-n "$(N)") $(if $(SUGERIR),-sugerir) $(if $(JSON),-json)

# Publica en CUADRILLA (el tablero del EQUIPO) las ramas de una tarea de acá. Viaja lo que se MIDE
# —repo y rama— y nada más: quién está en la épica y la rama base se deciden allá. Sin APLICAR=1 sólo
# dice qué haría. No crea épicas: la épica es un acuerdo del equipo.
cuadrilla-publicar: ## @dia publica en cuadrilla las ramas de una tarea (a tu parte de la épica). N=<id|título> · APLICAR=1 escribe · EN=<url>
	@cd tablero/server && go run ./cmd/cuadrilla -n "$(N)" $(if $(APLICAR),-aplicar) $(if $(EN),-en $(EN))

hoy: ## @dia la agenda derivada de las tareas: en movimiento (último bloque, lo que espera a alguien, entrega) y dormidas (≥14 d sin tocar). STAGE=work · JSON=1
	@cd tablero/server && go run ./cmd/today $(if $(STAGE),-stage $(STAGE)) $(if $(JSON),-json)

retomar: ## @dia retomar UNA tarea en frío: la pila (el último bloque entero), ramas y PRs, pendientes (y a quién esperan), bitácora — y qué falta. N=<id|slug> · BRIEF=1 suma la FICHA de sus nodos de context sin abrir los docs (~1/10 del doc; hasta 4, BRIEF=a,b elige) — decide qué doc abrir, no lo reemplaza
	@test -n "$(N)" || { echo "falta N=<id|slug>  ·  ej: make retomar N=84"; exit 2; }
	@cd tablero/server && go run ./cmd/today -n "$(N)" $(if $(JSON),-json) $(if $(BRIEF),-brief "$(BRIEF)")

deploys: ## @dia ¿qué se desplegó y a qué ambiente? FALLAS=1 deja SÓLO lo que falló, con el error del log. DIAS=7 · REPO=legacy-backend · JSON=1
	@cd tablero/server && go run ./cmd/deploys $(if $(DIAS),-dias $(DIAS)) $(if $(REPO),-repo $(REPO)) $(if $(FALLAS),-fallas) $(if $(JSON),-json)

anatomia: ## @dia ¿cuánto pesa el documento de cada tarea, cuántos bloques tiene su pila, y qué sección con fecha parece historia fuera de lugar? N=<id|slug>
	@cd tablero/server && go run ./cmd/today -anatomia $(if $(N),-n "$(N)")

bitacora-add: ## @dia ⚠ ESCRIBE la bitácora con minutos MEDIDOS por el comando. TAREA=<id|slug> TITULO='…' [NOTA='…'|NOTA_F=archivo] y UNA fuente: LAPSO=HH:MM-HH:MM · PULSO=HH:MM · MIN=N FUENTE='…'. [KIND=progress] [SECO=1]
	@test -n "$(TAREA)" -a -n "$(TITULO)" || { echo "faltan TAREA= y TITULO=  ·  ej: make bitacora-add TAREA=84 LAPSO=21:58-22:11 TITULO='…' NOTA='…'"; exit 2; }
	@cd tablero/server && go run ./cmd/worklog -tarea "$(TAREA)" -titulo "$(TITULO)" $(if $(NOTA),-nota "$(NOTA)") $(if $(NOTA_F),-nota-archivo ../../$(NOTA_F)) \
	  $(if $(LAPSO),-lapso $(LAPSO)) $(if $(PULSO),-pulso $(PULSO)) $(if $(MIN),-min $(MIN)) $(if $(FUENTE),-fuente "$(FUENTE)") $(if $(KIND),-kind $(KIND)) $(if $(SECO),-n)

tarea-bloque: ## @dia ⚠ ESCRIBE un bloque en la pila de una tarea: `# título` y la descripción, en un Markdown. N=<id|slug> ARCHIVO=<bloque.md> (o `-`: por stdin, como lo usan las herramientas con BLOQUE=) · [VIA=harness|trazador|db] · [SECO=1]
	@test -n "$(N)" -a -n "$(ARCHIVO)" || { echo "faltan N= y ARCHIVO=  ·  ej: make tarea-bloque N=84 ARCHIVO=tablero/docs/task-context-block.example.md SECO=1"; exit 2; }
	@cd tablero/server && go run ./cmd/task-context -tarea "$(N)" -bloque $(if $(filter -,$(ARCHIVO)),-,$(if $(filter /%,$(ARCHIVO)),$(ARCHIVO),../../$(ARCHIVO))) $(if $(VIA),-via $(VIA)) $(if $(SECO),-n)

# El formato de hitos se retiró el 2026-09-23. El target queda para que quien siga una guía vieja
# reciba el camino nuevo en vez de un «No rule to make target».
tarea-context-add:
	@echo "el formato de hitos se retiró el 2026-09-23: la pila es de bloques. Usá make tarea-bloque N=<tarea> ARCHIVO=<bloque.md>"; exit 2

tarea-context: ## @dia la pila de una tarea: sus últimos bloques. N=<id|slug>
	@test -n "$(N)" || { echo "falta N=<id|slug>  ·  ej: make tarea-context N=84"; exit 2; }
	@cd tablero/server && go run ./cmd/task-context -tarea "$(N)" -ver

pg: ## @dia la puerta a los CONECTORES: base y logs de un ambiente, con la fuente que contestó. ARGS='sql --target prod --query "SELECT …"' · ARGS='logs --target qa --query "{…}" --since 1h' · ARGS=help
	@bin/pg $(or $(ARGS),help)

tablero-db: ## @dia SQL de SOLO LECTURA. TARGET=local|dev|qa|staging|prod SQL='SELECT …' [MD=1 cita sólo DB + ambiente + query] [BLOQUE=<id|slug> la consulta y lo que dio, como bloque de la pila de esa tarea]
	@test -n "$(TARGET)" || { echo "falta TARGET=local|dev|qa|staging|prod"; exit 2; }
	@test -n $$'$(subst ','\'',$(SQL))' || { echo "falta SQL='SELECT …'"; exit 2; }
	@cd tablero/server && go run ./cmd/db-query -target "$(TARGET)" -sql $$'$(subst ','\'',$(SQL))' $(if $(MD),-md) $(if $(BLOQUE),-bloque $(BLOQUE))

cierre: ## @dia el cierre del día: qué tareas tocaste (git, la pila y el pulso) y a cuál le falta el bloque del día, la bitácora o ramas. Sale 1 si falta algo. DIA=YYYY-MM-DD · JSON=1
	@cd tablero/server && go run ./cmd/closeout $(if $(DIA),-dia $(DIA)) $(if $(JSON),-json)

trampas: ## @dia las TRAMPAS del sistema (`F-xx`): ¿el índice está completo y sus citas siguen apuntando bien? INDICE=1 sólo el índice (sin tocar los repos)
	@cd tablero/server && go run ./cmd/traps $(if $(INDICE),-index)

citas: ## @dia ¿las citas `archivo:línea` de un documento siguen apuntando a lo que dicen? (ancla por contenido contra `main`) DOC=<doc.md …> · OK=1 lista también las sanas
	@test -n "$(DOC)" || { echo "falta DOC=<doc.md>  ·  ej: make citas DOC=tablero/data/traps/doc.md"; exit 2; }
	@cd tablero/server && go run ./cmd/citations $(if $(OK),-ok) $(addprefix ../../,$(DOC))

tareas-guard: ## @dia ¿este texto puede salir a Jira? (el cuerpo de una tarea NO: nombra repos y rutas). F=<archivo>
	@test -n "$(F)" || { echo "falta F=<archivo>  ·  ej: make tareas-guard F=tablero/tasks/x/task.md"; exit 2; }
	@cd tablero/server && go run ./cmd/tasks -guard ../../$(F)

# ── JIRA, por consola ────────────────────────────────────────────────────────────────────────────
# Existían desde hace rato en `tablero/server/cmd/` y NO figuraban acá: el único target del tablero
# abría la UI. Es exactamente lo que ya pasó con el trazador —capacidad real, invisible en el
# catálogo, y por lo tanto inexistente para quien no la conociera de memoria—. Corren SIN el server.
#
# `jira` y no `tablero-issue-…` por la misma razón que `pulso` y `panel`: es un nombre propio más, y
# los nombres largos desalinean la ayuda.
#
# ⚠ ESTOS ESCRIBEN EN JIRA, que es hacia afuera y lo ve el equipo. Pedí confirmación antes de correr
# cualquiera de los tres. Y necesitan `ATLASSIAN_*` en `tablero/.env` — hoy ese archivo NO existe.
.PHONY: jira-create jira-move jira-edit
jira-create: ## @dia ⚠ ESCRIBE: crea una tarea en Jira y la mete al SPRINT ACTIVO. JSON={summary,description,points?,status?,sprint?}
	@test -n "$(JSON)" || { echo "falta JSON=<archivo.json>  ·  {summary, description, points?, status?, sprint?}"; exit 2; }
	@cd tablero/server && go run ./cmd/issue-create $(JSON)

# ⚠ `status` es una lista ORDENADA de subcadenas, no un destino suelto: el workflow de CORE no deja
# saltar estados — para «pruebas» hay que pasar por «progreso» primero.
jira-move: ## @dia ⚠ ESCRIBE: mueve un issue de estado (subcadena del nombre). KEY=CORE-309 A=prueba
	@test -n "$(KEY)" -a -n "$(A)" || { echo "faltan KEY=<CORE-309> y A=<subcadena del estado>"; exit 2; }
	@cd tablero/server && go run ./cmd/issue-transition $(KEY) $(A)

jira-edit: ## @dia ⚠ ESCRIBE: edita título y/o descripción de un issue. JSON={key,summary?,description?}
	@test -n "$(JSON)" || { echo "falta JSON=<archivo.json>  ·  {key, summary?, description?}"; exit 2; }
	@cd tablero/server && go run ./cmd/issue-update $(JSON)

panel: ## @dia abre el panel del harness para probar flujos (:5195)
	@cd harness && npm run dev

# ⚠ El trazador estuvo meses con SÓLO su plomería en este catálogo —la sonda de acceso, el SQL crudo—
# mientras su modo principal, el que contesta «¿qué le pasó a esta persona?», no figuraba en ninguna
# parte. Es la herramienta más parecida a Redash que hay acá y no se usaba porque no se veía. El
# catálogo existe para que eso no pase: si un comando no está, la herramienta no existe.
trazador: ## @dia ¿QUÉ LE PASÓ a esta solicitud? el flujo por etapas, del sistema real (:5192)
	@cd trazador && npm run dev

# El VISOR de Figma: el recorrido de un diseño, pantalla por pantalla y con el prototipo navegable.
# Lee por connectors/figma (el mismo `figma map` de bin/pg) y guarda las imágenes en visor/.cache/.
.PHONY: visor visor-test
visor: ## @dia ¿CÓMO ES el diseño de este flujo? un diseño de Figma recorrido pantalla por pantalla, con el prototipo navegable (:5193 · API :5194)
	@cd visor && npm run dev

visor-test: ## @dia las pruebas del visor: la traducción a HTML (flex, absolutas, recortes, dibujos) y el server (rutas de disco, una sola bajada)
	@go test ./visor/...

visor-fidelidad: ## @dia ¿cuánto se parece el HTML traducido a Figma? píxel a píxel contra la imagen exportada, por pantalla. REF='<url de la sección>' [SOLO=id,id] [TODAS=1 también las web]. Necesita `make visor` corriendo
	@test -n "$(REF)" || { echo "falta REF='<url de la sección de Figma>'"; exit 2; }
	@node visor/tools/fidelity.mjs --ref '$(REF)' $(if $(SOLO),--only $(SOLO)) $(if $(TODAS),--all)

visor-enlaces: ## @dia ¿siguen vivas las pantallas que enlazan las tareas? recorre el tablero y dice, por cada enlace del visor, si la pantalla sigue igual, CAMBIÓ o la BORRARON (por su huella). Sale ≠0 si hay alguno roto. DIR=<carpeta> (default: las tareas)
	@cd visor/server && go run . -links "$(abspath $(or $(DIR),tablero/tasks))"

trazador-buscar: ## @dia la HISTORIA de una persona por cédula, teléfono o solicitud. Q=1012345678 [TARGET=prod] [JSON=1] [MD=1 anotación para pegar en la tarea] [BLOQUE=<id|slug> la agrega como bloque a la pila de esa tarea]
	@test -n "$(Q)" || { echo "falta Q=<cédula|teléfono|uReq>  ·  ej: make trazador-buscar Q=1012345678"; exit 2; }
	@cd trazador/server && go run . -target $(or $(TARGET),prod) -buscar $(Q) $(if $(JSON),-json) $(if $(MD),-md) $(if $(BLOQUE),-bloque $(BLOQUE))

trazador-ureq: ## @dia la traza por etapas de UNA solicitud. UREQ=519245 [TARGET=prod] [TEL=3001234567 suma la fase de AUTH, que es la MITAD de los eventos del navegador] [HTML=f.html] [JSON=1] [MD=1] [BLOQUE=<id|slug> la agrega como bloque a la pila de esa tarea]
	@test -n "$(UREQ)" || { echo "falta UREQ=<n>  ·  ej: make trazador-ureq UREQ=519245"; exit 2; }
	@cd trazador/server && go run . -target $(or $(TARGET),prod) -ureq $(UREQ) $(if $(TEL),-tel $(TEL)) $(if $(HTML),-html $(HTML)) $(if $(JSON),-json) $(if $(MD),-md) $(if $(BLOQUE),-bloque $(BLOQUE))

# Los modos que el binario ya tenía y el catálogo no mostraba. Que existan en el código no alcanza: si
# no están acá no están en la ayuda, y lo que no está en la ayuda no existe para quien (o lo que) lee
# el catálogo al arrancar — que es justo la regla que este repo tiene escrita en su CLAUDE.md.
trazador-diag: ## @dia el diagnóstico FINO de una traza: qué se puede AFIRMAR de cada línea. UREQ=519245 MODO=campos|anclas|spans [TARGET=prod]
	@test -n "$(UREQ)" || { echo "falta UREQ=<n>  ·  ej: make trazador-diag UREQ=519245 MODO=anclas"; exit 2; }
	@case "$(MODO)" in campos|anclas|spans) ;; *) echo "falta MODO=campos|anclas|spans  (campos: qué llaves trae el contexto · anclas: cuánto se puede afirmar de cada línea · spans: si el span_id alcanza para ubicarlas)"; exit 2;; esac
	@cd trazador/server && go run . -target $(or $(TARGET),prod) -ureq $(UREQ) -$(MODO)

trazador-chequeo: ## @dia ¿el mapa del trazador sigue siendo cierto? sin corpus y sin tocar nada: coherencia interna, el vocabulario de ramales que comparte con el harness y, con TARGET, las tablas declaradas. [TARGET=local|dev]
	@cd trazador/server && go run . -chequeo $(if $(TARGET),-target $(TARGET))

# El índice de mensajes de log → archivo que resuelve las trazas y que `trazador-chequeo` cruza contra el
# mapa. Se deriva de los repos y no se versiona: se reconstruye cuando el código de los repos cambió.
trazador-indexar-logs: ## @dia reconstruye el índice de LOGS del trazador (mensaje → archivo que lo emite) desde los repos, con las refs remotas al día. [SIN_FETCH=1]
	@cd trazador/server && go run . -indexar-logs $(if $(SIN_FETCH),-sin-fetch)

estilo-ui: ## @dia verifica teclado, arrastre y persistencia de las cuatro UIs encendidas; Jira usa datos de prueba. SOLO=<herramienta,…>
	@SOLO="$(SOLO)" node tools/ui-check.mjs

estilo-minimo: ## @dia «mínimo o nada» en las cuatro UIs encendidas: ninguna región mide entre 0 y su mínimo, en cuatro anchos de ventana ni con el teclado. SOLO=<herramienta,…>
	@node --test tools/ui/workbench.test.mjs >/dev/null && echo '  ✓  workbench.js: la lógica, sin navegador'
	@SOLO="$(SOLO)" node tools/ui-minimum.mjs

estilo-componentes: ## @dia ¿la base pinta lo que dice? dibuja cada componente de tools/ui/spec.json con workbench.css y compara alto, padding, letra, radio e icono contra la especificación. No necesita las herramientas encendidas
	@node tools/ui-spec.mjs

estilo-guia: ## @dia catálogo interactivo de la UI compartida en http://127.0.0.1:5198
	@python3 -m http.server 5198 --bind 127.0.0.1 --directory tools/ui

estilo-sync: ## @dia distribuye tools/ui a las cuatro herramientas
	@node tools/ui-icons.mjs
	@python3 tools/ui-sync.py

estilo-iconos: ## @dia genera el bloque de iconos de la base desde Lucide (tools/ui/icons.json); CHECK=1 sólo comprueba
	@node tools/ui-icons.mjs $(if $(CHECK),--check,)

estilo-check: ## @dia ¿las cuatro UIs comparten de verdad UN tema? md5 de los `theme.css`, mezclas `in oklch` (que tiñen de rojo), contraste y variables usadas sin declarar
	@python3 tools/ui-sync.py --check
	@node tools/ui-icons.mjs --check
	@python3 tools/style.py

estilo-contraste: ## @dia mide el contraste de lo que SE PINTA en las cuatro UIs (lo que `estilo-check` no puede ver: el color viene de un ancestro y el fondo de otro). Necesita las UIs CORRIENDO. SOLO=<herramienta> · THEME=light|dark fija el tema de las que tienen botón
	@THEME="$(THEME)" SOLO="$(SOLO)" node tools/contrast.mjs

estilo-tema: ## @dia cambia el tema de LAS CUATRO UIs de un saque: pegás un export de tweakcn en un archivo y esto lo reparte. DE=<archivo.css> (sin DE, sólo dice cuál está puesto)
	@python3 tools/style.py --tema $(if $(DE),$(DE))

trazador-validar: ## @dia audita el MAPA de etapas contra líneas crudas: solapes, patrones mudos, decisiones que no resuelven. CORPUS=<tsv|ndjson>
	@test -n "$(CORPUS)" || { echo "falta CORPUS=<ruta al TSV del censo o a un timeline.ndjson>"; exit 2; }
	@cd trazador/server && go run . -validar $(CORPUS)

trazador-slack: ## @dia lee #tech-ops de los últimos N días y CLASIFICA los reportes (solo lectura). DIAS=7 · SIN=1 lista los que ninguna regex reconoció (texto real del canal) — el veredicto los cuenta aparte, no como «fuera de alcance»
	@test -n "$(DIAS)" || { echo "falta DIAS=<n>  ·  ej: make trazador-slack DIAS=7"; exit 2; }
	@cd trazador/server && go run . -slack $(DIAS) $(if $(SIN),-slack-sin)

trazador-hilos: ## @dia los reportes de #tech-ops CON SU HILO de respuestas: contrasta lo reportado con lo que pasó (solo lectura). DIAS=7
	@test -n "$(DIAS)" || { echo "falta DIAS=<n>  ·  ej: make trazador-hilos DIAS=7"; exit 2; }
	@cd trazador/server && go run . -incidencias $(DIAS)

# ── PULSO ────────────────────────────────────────────────────────────────────────────────────────
# Cuándo toqué los repos de la compañía, en tramos de 5'. Alimenta «Mi jornada» del tablero y se
# registra SOLO: es un LaunchAgent, no algo que haya que arrancar cada día.
#
# `pulso` y no `tablero-pulso` por dos razones: es un nombre propio más (como `panel`, que tampoco es
# una carpeta), y los nombres de 23 caracteres desalinean la ayuda de `make`.
.PHONY: pulso pulso-install pulso-status pulso-uninstall
pulso: ## @dia mi jornada REAL: cuándo toqué los repos de la compañía, en tramos de 5'. DAYS=7
	@cd tablero && { test -x server/bin/pulse || npm run --silent server:build; } \
	  && server/bin/pulse report -days $(or $(DAYS),7)

pulso-install: ## @dia deja el pulso registrando solo (cada 5 min, arranca con la sesión) + siembra el pasado
	@cd tablero && npm run --silent server:build && server/bin/pulse seed && server/bin/pulse install

pulso-status: ## @dia ¿el pulso está vivo? último tick y actividad de hoy
	@cd tablero && server/bin/pulse status

pulso-uninstall: ## @dia saca el agente del pulso (lo ya registrado se queda)
	@cd tablero && server/bin/pulse uninstall

# ── CONTEXTO ─────────────────────────────────────────────────────────────────────────────────────
# ⚠ Acá vivían los 14 comandos del árbol `context/` (align, refs, seal, lint, diff, triar, jev…). Ese
# árbol se apagó el 2026-09-21: el contexto curado es CANON y vive en otro repo (`github/playground/
# tools/canon`), con sus propios comandos —`go run . -ronda`, `-peso`, `-lint`, `-pregunta`—. Lo que
# quedó acá de aquel conjunto son las piezas que no eran del árbol: `trazador-huella` y `confluence`, cada
# una en el grupo de la herramienta a la que pertenece. (`repos` también quedó, y se retiró el 2026-09-23:
# generaba el snapshot de la consola de ramas que sólo leía la vista del árbol. Y `entidades`, con
# workers, el 2026-09-24.)
.PHONY: jev-test

jev-test: ## @dia la conexión con la API de Jev, sin uso encima hasta que aterrice uno (connectors/jev): pruebas offline, sin red
	@go test -count=1 ./connectors/jev

# El código del tablero se nombra en inglés (decisión de Miguel del 2026-09-23): identificadores,
# archivos y carpetas; los comentarios siguen en español. La vara del inglés es la stdlib de Go y de
# Python, NO el diccionario del sistema, que deja pasar `aviso` o `leer`. Lo legítimo que la vara no
# conoce va a tablero/tools/naming-allow.txt, con su categoría.
tablero-naming: ## @dia ¿el código del tablero, o el compartido (connectors, cmd, lib), nombra algo en español? identificadores de Go, Vue/JS y Python, claves JSON, archivos y carpetas. Sale 1 si sí. WORDS=1 lista las palabras desconocidas
	@cd tablero/server && go run ./cmd/naming $(if $(WORDS),-words)

tablero-naming-test: ## @dia pruebas del chequeo de nombres: la vara, las formas derivadas y un nombre español inventado en cada lenguaje
	@cd tablero/server && go test -count=1 ./internal/naming

tablero-ui-offline: ## @dia prueba la interfaz del tablero SIN servidores: compila, sirve el dist/ desde disco y simula la API en Chromium. No toca datos
	@cd tablero && npx vite build --logLevel error && node tools/ui-offline.mjs

trazador-huella: ## @dia la huella MEDIDA de un flujo (tablas/eventos/código) desde una corrida, cruzada contra canon. UREQ=x [MYSQL=/tmp/huella-mysql.log]
	@test -n "$(UREQ)" || { python3 trazador/tools/footprint.py; exit 2; }
	@python3 trazador/tools/footprint.py $(UREQ) $(if $(NOMBRE),--nombre "$(NOMBRE)",) $(if $(MYSQL),--mysql $(MYSQL),)

# ── PRUEBAS (harness) ────────────────────────────────────────────────────────────────────────────
.PHONY: harness-restauracion harness-ecommerce harness-contract harness-sandbox harness-walk harness-qr harness-mocks harness-centrales harness-rto harness-peru harness-comercio harness-forms-g2 harness-bcp-volver tests-codeudor harness-listado harness-caso harness-check soporte-qa
harness-contract: ## @har ¿el mock de Bancolombia cumple los esquemas zod del front? (sin browser ni BD)
	@cd harness && npm run --silent contrato:bancolombia

harness-sandbox: ## @har ¿el BANCO DE VERDAD acepta lo que mandamos? pega contra el gateway real. GRUPO=A|B|C|D|E
	@cd harness && node dev/sandbox-bancolombia.ts $(if $(GRUPO),--grupo $(GRUPO)) $(if $(CRED),--cred $(CRED))

harness-walk: ## @har recorre las pantallas del canal QR clickeando. PRODUCT=bnpl|consumo
	@cd harness && E2E_TARGET=local npx tsx dev/walk-qr.ts --producto $(or $(PRODUCT),bnpl)

harness-qr: ## @har el canal QR por API, sin browser: ¿cierra en estado 25 con código? PRODUCT=bnpl|consumo
	@cd harness && E2E_TARGET=local npx tsx dev/qr-corbeta.ts --producto $(or $(PRODUCT),bnpl)

harness-centrales: ## @har levanta el mock LOCAL de centrales de riesgo (:8105) — reemplaza el lambda de la empresa
	@cd harness && node mock-centrales/server.mjs

harness-mocks: ## @har levanta los mocks del canal QR (Bancolombia :8104 + Corbeta :8103)
	@cd harness && bin/mock-bancolombia start && bin/mock-corbeta start

harness-codes: ## @har levanta el mock LOCAL del servicio de códigos (:8111) — el que resuelve el código que el cliente trae de la app. Pide CODE_GENERATION_SERVICE_BASE_URL=http://host.docker.internal:8111 en el .env del backend
	@cd harness && node mock-codes/server.mjs

harness-codigo: ## @har siembra un código de preaprobado para probar la pantalla del asesor en local (pide `harness-codes` arriba). COMERCIO=<hash|slug> [CODIGO=<AA0000> sin él se inventa uno] [ENTIDAD=<lender_id>]
	@test -n "$(COMERCIO)" || { echo "falta COMERCIO=<hash de sucursal o slug de .flows.json>"; exit 2; }
	@cd harness && bin/seed-code "$(COMERCIO)" "$(CODIGO)" "$(ENTIDAD)"

harness-codigo-qa: ## @har genera un código de preaprobado REAL en qa (el que emitiría la app) para probar el canje en la pantalla del asesor. Pide la VPN de dev. [COMERCIO=<hash> default Pullman ec977139] [ENTIDAD=<lender_id>] [USUARIO=<user_id> default un cliente sintético]
	@cd harness && COMERCIO="$(COMERCIO)" ENTIDAD="$(ENTIDAD)" USUARIO="$(USUARIO)" LOTE="$(LOTE)" node dev/codigo-qa.ts
# LOTE=10 genera 10 por comercio de Colombia (los que tienen asesores en qa) y deja harness/.runs/codigos-qa.json
# para cargar la lista de QA. Vencen a fin de mes: se corre de nuevo cada mes.

harness-codigo-prueba: ## @har redime un código sembrado desde la UI del asesor y comprueba que sólo quede su entidad. HASH=<sucursal> CODIGO=<4 dígitos> LENDER='<nombre>'
	@test -n "$(HASH)" || { echo "uso: make harness-codigo-prueba HASH=<hash> CODIGO=<4 dígitos> LENDER='<nombre>'"; exit 2; }
	@test -n "$(CODIGO)" || { echo "uso: make harness-codigo-prueba HASH=<hash> CODIGO=<4 dígitos> LENDER='<nombre>'"; exit 2; }
	@test -n "$(LENDER)" || { echo "uso: make harness-codigo-prueba HASH=<hash> CODIGO=<4 dígitos> LENDER='<nombre>'"; exit 2; }
	@cd harness && E2E_AUTORELLENO=0 E2E_CLIENT_CODE_HASH="$(HASH)" E2E_CLIENT_CODE="$(CODIGO)" E2E_CLIENT_CODE_LENDER="$(LENDER)" npx playwright test channel/client-code.spec.ts --project=chromium

harness-admin-ciudades: ## @har ¿el selector de ciudad del admin filtra por país? Pide `harness/.admin.json` + el admin en :8000
	@cd harness && E2E_TARGET=local npx playwright test dev/admin-cities.spec.ts --reporter=list

harness-pais-comercio: ## @har ¿el país de un comercio se puede corregir hasta la primera SOLICITUD? Pide `harness/.admin.json` + el admin en :8000
	@cd harness && E2E_TARGET=local npx playwright test dev/admin-merchant-country.spec.ts --reporter=list

harness-telefono-duplicado: ## @har ¿dos altas del MISMO teléfono (una con indicativo y otra sin) crean dos usuarios? Escribe en LOCAL y limpia
	@cp harness/dev/php/user-duplicated-by-phone.php $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-telefono.php
	@cd $(HOME)/Desktop/CREDITOP/github/legacy-backend && ./vendor/bin/sail artisan tinker .harness-telefono.php < /dev/null 2>&1 | grep -vE "Restricted Mode|DEPRECATED|Psy Shell" ; rm -f $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-telefono.php

harness-pais-usuario: ## @har ¿el usuario temporal nace con el país del COMERCIO o nace afgano? Los dos caminos de alta. Escribe en LOCAL y limpia
	@cp harness/dev/php/merchant-country-on-the-user.php $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-pais.php
	@cd $(HOME)/Desktop/CREDITOP/github/legacy-backend && ./vendor/bin/sail artisan tinker .harness-pais.php < /dev/null 2>&1 | grep -vE "Restricted Mode|DEPRECATED|Psy Shell|nullable is deprecated" | cat -s ; rm -f $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-pais.php

harness-comercio-pais: ## @har ¿el POST de comercios de la API exige país y lo guarda, o el comercio nace afgano? Escribe en LOCAL y limpia
	@cp harness/dev/php/create-merchant-by-api-requires-country.php $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-comercio.php
	@cd $(HOME)/Desktop/CREDITOP/github/legacy-backend && ./vendor/bin/sail artisan tinker .harness-comercio.php < /dev/null 2>&1 | grep -vE "Restricted Mode|DEPRECATED|Psy Shell|nullable is deprecated" | cat -s ; rm -f $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-comercio.php

harness-volver-a-entrar: ## @har el cliente llega a /lenders, se sale y vuelve con el MISMO número: ¿retoma o le nace otro usuario? Escribe en LOCAL y limpia
	@cp harness/dev/php/reentering-does-not-duplicate.php $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-volver.php
	@cd $(HOME)/Desktop/CREDITOP/github/legacy-backend && ./vendor/bin/sail artisan tinker .harness-volver.php < /dev/null 2>&1 | grep -vE "Restricted Mode|DEPRECATED|Psy Shell|nullable is deprecated" | cat -s ; rm -f $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-volver.php

harness-dni-choca: ## @har ¿un DNI peruano se puede registrar si el número ya existe como cédula colombiana? Muestra las 3 guardas. LOCAL
	@cp harness/dev/php/peruvian-dni-clashes-with-national-id.php $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-dni.php
	@cd $(HOME)/Desktop/CREDITOP/github/legacy-backend && ./vendor/bin/sail artisan tinker .harness-dni.php < /dev/null 2>&1 | grep -vE "Restricted Mode|DEPRECATED|Psy Shell|nullable is deprecated" | cat -s ; rm -f $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-dni.php

harness-suite-paises: ## @har ¿el cliente nace con el país de su comercio, su documento y su celular? La suite de internacionalización, contra la base. [PAR=1]
	@cd harness && node dev/case.ts --suite suites/paises.json $(if $(PAR),--paralelo)

harness-ecommerce: ## @har EL CANAL ECOMMERCE de punta a punta: ¿el carrito de la tienda entra, el comercio queda atado al crédito y sus datos llegan al formulario? [SUITE=suites/ecommerce.json] [COMERCIO=amoblar] [TEL=<uno de qa_otp_bypass_phones> — obligatorio contra un ambiente desplegado: el OTP sólo es predecible para los teléfonos de esa lista]
	@cd harness && node dev/ecommerce.ts $(if $(SUITE),--suite '$(patsubst harness/%,%,$(SUITE))',--suite suites/ecommerce.json) $(if $(COMERCIO),--comercio $(COMERCIO)) $(if $(TEL),--tel $(TEL))

harness-ambiente: ## @har ¿la config de un target es coherente, y nadie resuelve el ambiente por fuera de la cadena? TARGET=qa [JSON=1]
	@cd harness && node bin/preflight.ts $(if $(TARGET),$(TARGET)) $(if $(JSON),--json)

harness-restauracion: ## @har ¿la base de dev/QA sigue teniendo lo que NUESTRAS TAREAS necesitan (ecommerce, Alta, códigos)? solo lectura. FOTO=1 la guarda en harness/.runs/ ANTES de una restauración · CONTRA=.runs/qa-restore-….json dice qué se PERDIÓ después
	@cd harness && node dev/restore-check.ts $(if $(FOTO),--snapshot) $(if $(CONTRA),--compare $(CONTRA)) $(if $(TARGET),--target $(TARGET))

harness-listado: ## @har del COMERCIO al listado de entidades, por API y sin browser: ¿cuáles le salen a un cliente y por qué NO las otras? [COMERCIO=pullman] [MONTO=2000000] [MD=1 la corrida como anotación fechada, con su comando adentro, para pegar en la tarea] [BLOQUE=<id|slug> la agrega sola, como bloque, a la pila de esa tarea]
	@cd harness && MD=$(MD) BLOQUE=$(BLOQUE) node dev/listing.ts $(if $(COMERCIO),--comercio $(COMERCIO)) $(if $(MONTO),--amount $(MONTO)) $(if $(BRANCH),--branch $(BRANCH)) $(if $(V2),--v2)

harness-caso: ## @har CASOS hipotéticos de punta a punta, en PARALELO. CASOS='pullman@meddipay=rechaza;pullman@income=900000' [PAR=1] [LAMBDA=1 buró y proveedores dictados] [PRE=1 simula la consulta de PRE-APROBADOS del front] [CERRAR=1 = cierra por el lender CreditopX hasta estado 11] [MANUAL=1 identidad aprobada a mano, como en el admin] [MD=1 la corrida como anotación fechada, con su comando adentro, para pegar en la tarea] [BLOQUE=<id|slug> la agrega sola, como bloque, a la pila de esa tarea]
	@cd harness && MD=$(MD) BLOQUE=$(BLOQUE) node dev/case.ts $(if $(SUITE),--suite '$(SUITE)') $(if $(CASOS),--casos '$(CASOS)') $(if $(COMERCIO),--comercio $(COMERCIO)) $(if $(LENDER),--lender $(LENDER)) $(if $(MONTO),--amount $(MONTO)) $(if $(PAR),--paralelo) $(if $(LAMBDA),--lambda) $(if $(PRE),--preaprobados) $(if $(CERRAR),--cerrar) $(if $(MANUAL),--manual)

harness-caminar: ## @har el WIZARD entero por HTTP, sin navegador: pasa por cada pantalla del FRONT (loaders, actions, zod) y la contrasta con la BD. En PARALELO. Si un caso sale mal, consulta PostHog (qué pantalla registró el error). CASOS='#e9409aff:77;pullman:77' [FLOW=self-service|merchant|ecommerce — ecommerce entra por el checkout de la tienda y comprueba que la solicitud quede atada al pedido y personal-info bloqueado] [PAR=1] [CERRAR=1 hasta loan-approved] [MANUAL=1 identidad aprobada a mano] [MONTO=2000000] [CUOTA=300000 la cuota inicial que carga el asesor: con >0 el action toma la rama del cobro por pasarela, que con 0 no se ejecuta nunca] [PLAZO=6 en cuántas cuotas cerrar; sin esto toma el MÁS LARGO que ofrezca la entidad, que es el que más ejercita. ⚠ no confundir con CUOTA, que es plata] [MOTOR=navegador Chromium sin ventana, corre el JS del cliente y guarda evidencia] [FORENSE=1 consultar PostHog aunque cierre bien] [GATE=aprobado|rechazado qué contestar en un gate MANUAL —una pantalla de decisión, no de avance, como `entidad/resultado` de BCP—. Sin esto el caminador se detiene ahí a propósito: no elige por nadie. ⚠ `rechazado` deja la solicitud NEGADA] [MD=1 la corrida como anotación fechada, con su comando adentro, para pegar en la tarea] [BLOQUE=<id|slug> la agrega sola, como bloque, a la pila de esa tarea]
	@cd harness && MD=$(MD) BLOQUE=$(BLOQUE) node dev/walk-wizard.ts $(if $(CASOS),--casos '$(CASOS)') $(if $(COMERCIO),--comercio $(COMERCIO)) $(if $(LENDER),--lender $(LENDER)) $(if $(MONTO),--amount $(MONTO)) $(if $(CUOTA),--cuota-inicial $(CUOTA)) $(if $(PLAZO),--cuotas $(PLAZO)) $(if $(PAR),--paralelo) $(if $(CERRAR),--cerrar) $(if $(MANUAL),--manual) $(if $(FLOW),--flow $(FLOW)) $(if $(MOTOR),--motor $(MOTOR)) $(if $(GATE),--gate $(GATE)) $(if $(HEADED),--headed)

harness-posthog: ## @har ¿qué VIO el cliente en ESTA solicitud, y en qué PANTALLA se rompió? la tercera fuente (BD=desenlace · Loki=causa en el backend · PostHog=recorrido y errores DEL FRONT): sus eventos del embudo y sus logs con pantalla, etapa y error. ⚠ sólo qa/staging y prod: dev y local sirven el front LOCAL, que no escribe. UREQ=502060 [DESDE=2026-09-03T01:40:00Z] [PANTALLAS=otp,lenders,confirmation]
	@test -n "$(UREQ)" || { echo "falta UREQ=<n>  ·  ej: make harness-posthog UREQ=502060"; exit 2; }
	@cd harness && node dev/posthog-ureq.ts $(UREQ) $(if $(DESDE),--desde $(DESDE)) $(if $(PANTALLAS),--pantallas $(PANTALLAS))

harness-posthog-errores: ## @har ¿qué PANTALLAS del front se están rompiendo, y con qué error? el canal de LOGS agregado (pantalla · etapa · error, y los mensajes por patrón). ⚠ sólo qa/staging y prod: dev y local no tienen front desplegado. [DIAS=7]
	@cd harness && node dev/posthog-errors.ts $(if $(DIAS),--dias $(DIAS))

harness-suite: ## @har corre una SUITE de casos declarada en JSON y falla si alguno no cumple lo que declara. SUITE=harness/suites/x.json [PAR=1] [CERRAR=1] [LAMBDA=1] [MANUAL=1] [MD=1 la corrida como anotación fechada, con su comando adentro, para pegar en la tarea] [BLOQUE=<id|slug> la agrega sola, como bloque, a la pila de esa tarea]
	@cd harness && MD=$(MD) BLOQUE=$(BLOQUE) node dev/case.ts --suite '$(patsubst harness/%,%,$(SUITE))' $(if $(PAR),--paralelo) $(if $(CERRAR),--cerrar) $(if $(LAMBDA),--lambda) $(if $(PRE),--preaprobados) $(if $(MANUAL),--manual)

soporte-qa: ## @har el chat del cliente contra la API real, con cada respuesta al costado (:5199). Para QA
	@echo "  → http://localhost:5199/agente-soporte-modificacion-datos.cliente-qa.html    (Ctrl-C para cortar)"
	@cd tablero/tasks/agente-soporte-modificacion-datos/artifacts && python3 -m http.server 5199

tests-codeudor: ## @har corre la suite del CODEUDOR (desactivada en el repo por CORE-431) en un schema DESECHABLE. PREPARAR=1 la primera vez
	@cd harness && bash bin/tests-cosigner.sh $(if $(PREPARAR),--preparar)

harness-rto: ## @har deja el lender Rent to Own usable en LOCAL (categorías, reglas, identidad) — config de PRUEBA, no de negocio
	@cd harness && node dev/mount-rto.ts

harness-kyc-flow: ## @har deja el resolvedor de KYC usable en LOCAL: siembra la setting `kyc_pipeline_allieds` vacía (= todos por el flujo legacy, como en qa). Sin ella `kyc-flow/{hash}` da 500 y el front cae al v1 sin avisar. Sólo local, idempotente
	@cd harness && E2E_TARGET=local node dev/mount-kyc-flow.ts

harness-peru: ## @har deja un COMERCIO PERUANO usable en LOCAL para mirar el wizard con su país (S/, +51, 9 dígitos). Sólo local, idempotente
	@cd harness && E2E_TARGET=local node dev/mount-peru.ts

harness-comercio: ## @har siembra un COMERCIO ENTERO en LOCAL desde su spec (`harness/comercios/*.json`): sucursales, entidades, reglas duras, perfiles, bienvenida y autogestión. Sin COMERCIO lista los que hay. [CLEAN=1 lo borra]
	@cd harness && E2E_TARGET=local node dev/mount-merchant.ts $(COMERCIO) $(if $(CLEAN),--clean)

harness-forms-g2: ## @har levanta el mock del FORM-SERVICE (:8109) — el formulario del VEHÍCULO de BCP. ⚠ Sin esto, en local ese formulario ESCRIBE en la BD compartida de dev. [CMD=start|stop|status|logs|capturar]
	@cd harness && bin/mock-forms-g2 $(if $(CMD),$(CMD),start)

harness-bcp-volver: ## @har el flujo VEHICULAR de BCP por HTTP y qué se PIERDE al volver atrás (el monto, el gate, la etapa). local · dev · qa · staging [TARGET=qa] [COMERCIO=#hash] [MONTO=60000] [TEL=a,b obligatorio fuera de local: el OTP sólo se salta con los del bypass] [FRONT=url] [NIEGA=1 el recorrido B, que deja una solicitud NEGADA]. En local pide `harness-peru` + `harness-forms-g2`; contra qa el comercio YA existe (`#a8221e67`)
	@cd harness && E2E_TARGET=$(or $(TARGET),local) node dev/bcp-return.ts $(if $(TEL),--tel $(TEL)) $(if $(NIEGA),--niega) $(if $(COMERCIO),--comercio '$(COMERCIO)') $(if $(MONTO),--amount $(MONTO)) $(if $(INICIAL),--inicial $(INICIAL)) $(if $(BONO),--bono $(BONO)) $(if $(FRONT),--front $(FRONT))

harness-pantallas: ## @har ¿por qué PANTALLAS habría pasado el cliente? el recorrido del wizard derivado del router en main. AL REVÉS con ENDPOINT=confirm-payment-schedule. [FILTRO=texto] [JSON=1]
	@cd harness && node dev/screens.ts $(if $(FILTRO),--filtro '$(FILTRO)') $(if $(ENDPOINT),--endpoint '$(ENDPOINT)') $(if $(JSON),--json) $(if $(SIN_ENDPOINTS),--sin-endpoints)

harness-check: ## @har typecheck del harness
	@cd harness && npm run --silent typecheck

# ⚠ NO llega a producción: el harness no tiene `.env.prod` (solo local/dev/staging) y este comando no
# acepta TARGET — va por `E2E_TARGET`, que por defecto es **dev**. Pedirle una solicitud de prod
# devuelve CERO anclas sin decir por qué, y eso se lee como «no hay logs» en vez de «buscaste en otro
# lado». Para producción: `make trazador-acceso TARGET=prod`.
harness-ssr: ## @har la consola del SSR del wizard: a qué servicio llamó, con qué código y cuánto tardó (`[outbound]`). SOLO=1 filtra a lo saliente y los errores · N=120 líneas de cola · SEGUIR=1 se queda mirando. ⚠ lo escribe `bin/advisor` al levantar el wizard: si lo arrancaste a mano con `pnpm dev`, su salida se fue a esa terminal
	@f=/tmp/asesor-wizard.log; \
	if [ ! -f "$$f" ]; then \
	  echo "  ✗ no existe $$f"; \
	  echo "     lo escribe bin/advisor al levantar el wizard (lo trunca en cada arranque)."; \
	  echo "     Si levantaste el wizard a mano con 'pnpm dev', su salida se fue a ESA terminal y acá no hay nada que mirar."; \
	  exit 1; \
	fi; \
	filtro='.'; [ -n "$(SOLO)" ] && filtro='\[outbound\]|[Ee]rror|ELIFECYCLE|ECONN|failed'; \
	if [ -n "$(SEGUIR)" ]; then tail -n $(or $(N),120) -f "$$f" | grep -E --line-buffered "$$filtro"; \
	else tail -n $(or $(N),120) "$$f" | grep -E "$$filtro"; fi

harness-loki: ## @har ¿por qué terminó así esta solicitud? forense en los logs. ⚠ dev/staging/local, NO prod. UREQ=519245 [TARGET=local|dev|staging|qa — por defecto LOCAL: sin esto caía al default `dev` y consultaba el Loki COMPARTIDO buscando un uReq local, que en el mejor caso da «cero anclas» y en el peor te muestra la corrida de OTRO con el mismo id] [SINCE=12h]
	@cd harness && E2E_TARGET=$(or $(TARGET),local) node dev/loki-trace.ts $(UREQ) $(if $(SINCE),--since $(SINCE))

harness-paises: ## @har ¿de qué país es cada entidad? inferencia DRY-RUN desde el cableado. No escribe. [SQL=1]
	@cd harness && node dev/countries.ts $(if $(SQL),--sql,)

# Observabilidad LOCAL: Loki (logs) + Tempo (el que le pone trace_id a esos logs). Misma decisión que con
# MySQL — se corre el servicio real en Docker, no un mock. Un mock obligaría a reimplementar LogQL y el
# forense quedaría validado contra la imitación en vez de contra Loki.
.PHONY: harness-obs-up harness-obs-down
harness-obs-up: ## @har levanta Loki (:3100) + Tempo (:4318) locales para observar el camino rápido
	@cd harness && bin/loki-local start && bin/tempo-local start

harness-obs-down: ## @har baja Loki y Tempo locales (se llevan sus datos)
	@cd harness && bin/loki-local stop; bin/tempo-local stop

# ── TRAZADOR ─────────────────────────────────────────────────────────────────────────────────────
# La herramienta de SOPORTE: hasta dónde llegó una solicitud y por qué se rompió. Hoy cubre el primer
# paso —probar que los logs se pueden leer— y es el único lugar del playground que habla con PRODUCCIÓN.
# Solo GET: no escribe nada en ningún ambiente.
# ⚠ El módulo Go vive en `trazador/server/`, no en `trazador/` (se mudó al pasar a Vue + server Go).
# Desde `trazador/` el go run falla con «cannot find main module».
# ⚠ Los TARGET son cinco —`prod` · `staging` · `qa` · `dev` · `local`— y están los cinco `.env.<target>`
# (`targetsPermitidos` en `trazador/server/serve.go` es la lista autoritativa). El help decía `prod|dev` y
# `prod|local`: subestimaba la herramienta, y a un help se le cree — el que lo leía concluía que no podía
# consultar staging. Si agregás un target: serve.go, el store y el selector de la Vue (una prueba exige que
# coincidan), el `.env.<target>` con su `.example`, y estas líneas.
.PHONY: trazador-acceso trazador-sql trazador-posthog confluence
trazador-acceso: ## @har SONDA Loki: ¿puedo leer? ⚠ MUESTRA líneas, no las cuentes. Para CONTAR: QUERY='sum(count_over_time({...}[24h]))'. [TARGET=…] QUERY='{...}' SINCE=1h
	@cd trazador/server && go run . $(if $(TARGET),-target $(TARGET)) $(if $(QUERY),-query '$(QUERY)') $(if $(SINCE),-since $(SINCE))

# ⚠ TEL no es un lujo: la fase de AUTH ocurre ANTES de que exista la solicitud, así que PostHog la
# identifica por `phone_<e164>` y no por `loan_request_<n>`. Medido sobre 7 días, el teléfono identifica
# 47.792 eventos y la solicitud 24.006 — sin TEL se ve la mitad, y un recorrido que arranca en «monto»
# se lee como que el cliente entró por ahí. El binario siempre tuvo `-tel`; acá faltaba.
trazador-posthog: ## @har ¿qué VIO el cliente en el navegador? Sin UREQ = sonda de acceso + censo. [TARGET=prod] [UREQ=n] [TEL=3001234567 ⚠ sin esto se ve la MITAD: la fase de AUTH se identifica por teléfono] [LIMIT=n]
	@cd trazador/server && go run . -posthog $(if $(TARGET),-target $(TARGET)) $(if $(UREQ),-ureq $(UREQ)) $(if $(TEL),-tel $(TEL)) $(if $(LIMIT),-limit $(LIMIT))

# El «por qué» del negocio (política de riesgo, contratos con lenders, PRDs) no está en el código:
# está en Confluence. Solo lectura: no hay verbo que escriba.
# ⚠ Nada de ahí entra a canon sin pasar por el código: el corpus describe lo que corre en `main`, y
# un PRD describe lo que se quiso. La regla de admisión está en las `skills/` del repo de canon.
confluence: ## @har el POR QUÉ del negocio, que el código no tiene (sólo lectura). Sin CMD muestra su ayuda. CMD='search cupo rotativo' | 'spaces' | 'pages Creditop' | 'read <id>'
	@$(if $(CMD),bin/pg confluence $(CMD),bin/pg help | grep -A1 confluence)

# ── CANON ─────────────────────────────────────────────────────────────────────────────────────────
# Lectura gratis y escritura por la API, contra CANON_URL (producción por defecto: pide la VPN de
# prod). Cuándo y qué se escribe: `.claude/skills/canon/SKILL.md`. La llave no se imprime nunca.
.PHONY: canon-search canon-read canon-code canon-propose canon-write
canon-search: ## @can ¿canon ya lo tiene? qué sección y qué área lo cubren, gratis. Q='monto avisado al comercio'
	@test -n "$(Q)" || { echo "falta Q='<palabras del negocio>'"; exit 2; }
	@cd tablero/server && go run ./cmd/canon search $(Q)
canon-read: ## @can las secciones completas. IDS='cuota/context#<ancla>' (varias por coma) o el tema entero
	@test -n "$(IDS)" || { echo "falta IDS='<tema/capa#ancla>'"; exit 2; }
	@cd tablero/server && go run ./cmd/canon read '$(IDS)'
canon-code: ## @can los archivos que declara un área. AREA=cuota/context [N=0]
	@test -n "$(AREA)" || { echo "falta AREA='<tema/capa>'"; exit 2; }
	@cd tablero/server && go run ./cmd/canon code '$(AREA)' $(or $(N),0)
canon-propose: ## @can ensaya una pieza sin escribir: dónde iría y qué rechaza el lint. PIECE=<pieza.json>
	@test -n "$(PIECE)" || { echo "falta PIECE=<pieza.json> (formato: .claude/skills/canon/SKILL.md)"; exit 2; }
	@cd tablero/server && go run ./cmd/canon propose '$(abspath $(PIECE))'
canon-write: ## @can ⚠ ESCRIBE en canon: borrador → piezas → cierre, en UNA revisión que ve el equipo. PIECE='a.json b.json' TITLE='…'
	@test -n "$(PIECE)" || { echo "falta PIECE=<pieza.json…>"; exit 2; }
	@cd tablero/server && go run ./cmd/canon write -title '$(or $(TITLE),canon: dictado desde el playground)' $(abspath $(PIECE))

trazador-sql: ## @har UNA consulta de SOLO LECTURA a la BD del ambiente. SQL='SELECT …' [TARGET=prod|staging|qa|dev|local] [CSV=1] [MD=1 anotación + tabla markdown, para pegar en la tarea] [BLOQUE=<id|slug> la agrega como bloque a la pila de esa tarea]
	@# ⚠ el mismo escapado que la línea de abajo, y por la misma razón: `test -n "$(SQL)"` se rompía
	@# con cualquier consulta que llevara comillas DOBLES (`WHERE x = "y"`), porque make expande antes
	@# que el shell y las dobles del dato cerraban las del test. Fallaba con «binary operator expected»
	@# y el mensaje de ayuda hacía creer que faltaba SQL, cuando SQL estaba y era válido.
	@test -n $$'$(subst ','\'',$(SQL))' || { echo "falta SQL='SELECT …'  ·  ej: make trazador-sql TARGET=local SQL='SELECT id,name FROM countries LIMIT 3'"; exit 2; }
	@cd trazador/server && go run . -target $(if $(TARGET),$(TARGET),prod) -sql $$'$(subst ','\'',$(SQL))' $(if $(CSV),-csv) $(if $(MD),-md) $(if $(BLOQUE),-bloque $(BLOQUE))

# ── EXPLORACIONES ────────────────────────────────────────────────────────────────────────────────
# Están acá para poder abrirlas, NO porque sean fuente. No se citan para decidir (ver CLAUDE.md).
# Ya no vive acá: el 2026-09-10 cuadrilla se mudó al repo COMPARTIDO
# (`github/playground/tools/cuadrilla`) y se rehizo en Go + Vue. El target se queda porque la puerta
# es una sola: lo que cambió es a dónde apunta. Levanta la API en :8080 y el front en :5197 — NO en
# el :5173 que anuncia `task dev`, porque ese lo tiene el Vite de legacy-backend.
.PHONY: cuadrilla
cuadrilla: ## @expl las épicas del equipo — ramas por persona. Vive en el repo COMPARTIDO (API :8080 · front :5197)
	@cd ../github/playground && task dev TOOL=cuadrilla
