# CREDITOP · playground — una sola puerta para todo
#
# `make` sin argumentos lista lo que hay. La idea es no tener que recordar en qué carpeta vive cada
# comando ni cómo se llamaba el script.
#
# CONVENCIÓN DE NOMBRES: los NOMBRES PROPIOS se quedan como están (`context`, `tablero`, `panel` son
# carpetas reales, traducirlas agregaría una capa de traducción mental) y los VERBOS van en inglés
# (`align`, `refs`, `seal`, `check`). Un comando de proyecto se nombra `proyecto-verbo`.
#
# ⚠ Por qué `context-align` y no `context align`: para make, dos palabras son dos objetivos distintos
# (correría `context` y después `align`). Se puede simular con un catch-all, pero entonces un typo
# como `contxt-align` no da error: no hace nada en silencio. Con guion, make avisa y además el guion
# autocompleta con TAB.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# ── AYUDA ────────────────────────────────────────────────────────────────────────────────────────
.PHONY: help
help: ## esta lista
	@echo ""
	@echo "  CREDITOP · playground        (make <comando>)"
	@$(call listar,@dia,LO QUE SE USA TODOS LOS DÍAS)
	@$(call listar,@ctx,CONTEXTO — el conocimiento validado contra main)
	@$(call listar,@har,HARNESS — validar una tarea corriéndola contra el código real)
	@$(call listar,@wrk,WORKERS — el índice de los repos y los agentes que lo consumen)
	@$(call subcomandos,workers/cli.py)
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

# subcomandos <cli> — los subcomandos de un CLI, SACADOS DEL CLI.
#
# ⚠ Por qué no van escritos en el `##` del target, que sería lo obvio. Ahí estaban, y quedaron viejos:
# la línea anunciaba 7 de 18 — `logs`, `negocio`, `relaciones` y otros 8 no existían para nadie que no
# los hubiera escrito. Un subcomando que el catálogo no nombra es un subcomando que no se usa, y esta
# es la MISMA copia-a-mano que el CLAUDE.md de la raíz ya escarmentó una vez con la lista de comandos.
# Sale del `--help`, así que uno nuevo aparece acá el día que se agrega, sin que nadie se acuerde.
define subcomandos
	printf "    \033[36m%-18s\033[0m " "$(patsubst %/,%,$(dir $(1))) ↳"; \
	($(1) --help 2>/dev/null | sed -n '/^positional arguments:/,/^optional\|^options/p' \
	  | grep -E "^    [a-z-]+ " | awk '{printf "%s%s", (NR>1?" · ":""), $$1}' \
	  || true); echo ""
endef

# ── DÍA A DÍA ────────────────────────────────────────────────────────────────────────────────────
.PHONY: status context tablero tareas tareas-guard cuadrilla-publicar sprint bitacora panel trazador trazador-buscar trazador-ureq \
	trazador-diag trazador-chequeo trazador-validar trazador-slack trazador-hilos
status: ## @dia ¿está el contexto al día? (resumen, no escribe nada)
	@cd context && python3 tools/alinear.py --ver | tail -n 25
	@echo ""
	@cd context && python3 tools/refs.py | tail -n 2

context: ## @dia abre la viz del árbol de contexto (:5193)
	@cd context && npm run dev

tablero: ## @dia abre el tablero: las tareas a realizar (:5191)
	@cd tablero && npm run dev

# El tablero por CONSOLA. El store ya había resuelto la mitad —pasó a archivos porque «era el único
# rincón del playground que un modelo no puede leer sin levantar un server»— pero preguntar EN QUÉ SE
# TRABAJA seguía obligando a parsear los frontmatters a mano, y el GUARD sólo corría al publicar,
# cuando ya es tarde para decidir cómo escribir.
tareas: ## @dia las tareas abiertas, sin abrir la UI. N=<slug|id> · STAGE=work · TODAS=1 · JSON=1
	@cd tablero/server && go run ./cmd/tareas $(if $(N),-n $(N)) $(if $(STAGE),-stage $(STAGE)) $(if $(TODAS),-todas) $(if $(JSON),-json)

tarea-json: ## @dia proyección JSON tipada de UNA tarea, derivada del Markdown. N=<slug|id> · CONTENIDO=1 incluye borrador Jira
	@test -n "$(N)" || { echo "falta N=<slug|id>  ·  ej: make tarea-json N=tablero"; exit 2; }
	@cd tablero/server && go run ./cmd/tareas -n "$(N)" -json $(if $(CONTENIDO),-contenido)

# ⚠ Lee el SNAPSHOT de Jira, no el estado vivo — e imprime cuándo se tomó, porque un tablero
# presentado como actual siendo de hace días es peor que no tenerlo: se decide sobre él.
sprint: ## @dia el sprint activo con sus tareas y puntos, del snapshot (dice cuándo se tomó). JSON=1
	@cd tablero/server && go run ./cmd/tareas -sprint $(if $(JSON),-json)

bitacora: ## @dia el tiempo registrado, agrupado por día. DAYS=7 · JSON=1 (la nota entera va en el json)
	@cd tablero/server && go run ./cmd/tareas -bitacora $(or $(DAYS),7) $(if $(JSON),-json)

# ⚠ Sale 1 si el texto NO puede salir: sirve para frenar antes de publicar, no sólo para informar.
# Mide contra los repos LOCALES lo que el último `fetch` dejó: no habla con la red a propósito (un
# comando de lectura que sale a internet sorprende, y en 13 repos nadie lo correría). Por patch-id, así
# que detecta un cambio que llegó por SQUASH — donde el nombre de la rama ya no existe.
tareas-ramas: ## @dia ¿en qué ramas vive cada tarea y hasta dónde llegó (y si ya está en main)? mide git + PRs. N=<id|título> · SUGERIR=1 propone patrón a las que no declaran ramas · JSON=1
	@cd tablero/server && go run ./cmd/ramas $(if $(N),-n "$(N)") $(if $(SUGERIR),-sugerir) $(if $(JSON),-json)

# Publica en CUADRILLA (el tablero del EQUIPO) las ramas de una tarea de acá. Viaja lo que se MIDE
# —repo y rama— y nada más: quién está en la épica y la rama base se deciden allá. Sin APLICAR=1 sólo
# dice qué haría. No crea épicas: la épica es un acuerdo del equipo.
cuadrilla-publicar: ## @dia publica en cuadrilla las ramas de una tarea (a tu parte de la épica). N=<id|título> · APLICAR=1 escribe · EN=<url>
	@cd tablero/server && go run ./cmd/cuadrilla -n "$(N)" $(if $(APLICAR),-aplicar) $(if $(EN),-en $(EN))

hoy: ## @dia la agenda derivada de las tareas: en movimiento (próximo paso, preguntas vencidas, entrega) y dormidas (≥14 d sin tocar). STAGE=work · JSON=1
	@cd tablero/server && go run ./cmd/hoy $(if $(STAGE),-stage $(STAGE)) $(if $(JSON),-json)

retomar: ## @dia retomar UNA tarea en frío: retoma, próximo paso, ramas y PRs, preguntas vencidas, pendientes, último Registro, bitácora — y qué falta. N=<id|slug>
	@test -n "$(N)" || { echo "falta N=<id|slug>  ·  ej: make retomar N=84"; exit 2; }
	@cd tablero/server && go run ./cmd/hoy -n "$(N)" $(if $(JSON),-json)

deploys: ## @dia ¿qué se desplegó y a qué ambiente? FALLAS=1 deja SÓLO lo que falló, con el error del log. DIAS=7 · REPO=legacy-backend · JSON=1
	@cd tablero/server && go run ./cmd/deploys $(if $(DIAS),-dias $(DIAS)) $(if $(REPO),-repo $(REPO)) $(if $(FALLAS),-fallas) $(if $(JSON),-json)

anatomia: ## @dia ¿cómo está repartido el archivo de cada tarea (estado/registro) y qué sección parece estar fuera de lugar? N=<id|slug>
	@cd tablero/server && go run ./cmd/hoy -anatomia $(if $(N),-n "$(N)")

bitacora-add: ## @dia ⚠ ESCRIBE la bitácora con minutos MEDIDOS por el comando. TAREA=<id|slug> TITULO='…' [NOTA='…'|NOTA_F=archivo] y UNA fuente: LAPSO=HH:MM-HH:MM · PULSO=HH:MM · MIN=N FUENTE='…'. [KIND=progress] [SECO=1]
	@test -n "$(TAREA)" -a -n "$(TITULO)" || { echo "faltan TAREA= y TITULO=  ·  ej: make bitacora-add TAREA=84 LAPSO=21:58-22:11 TITULO='…' NOTA='…'"; exit 2; }
	@cd tablero/server && go run ./cmd/bitacora -tarea "$(TAREA)" -titulo "$(TITULO)" $(if $(NOTA),-nota "$(NOTA)") $(if $(NOTA_F),-nota-archivo ../../$(NOTA_F)) \
	  $(if $(LAPSO),-lapso $(LAPSO)) $(if $(PULSO),-pulso $(PULSO)) $(if $(MIN),-min $(MIN)) $(if $(FUENTE),-fuente "$(FUENTE)") $(if $(KIND),-kind $(KIND)) $(if $(SECO),-n)

cierre: ## @dia el cierre del día: qué tareas tocaste (git + pulso) y a cuál le falta retoma, registro, bitácora o ramas. Sale 1 si falta algo. DIA=YYYY-MM-DD · JSON=1
	@cd tablero/server && go run ./cmd/cierre $(if $(DIA),-dia $(DIA)) $(if $(JSON),-json)

tareas-guard: ## @dia ¿este texto puede salir a Jira? (el cuerpo de una tarea NO: nombra repos y rutas). F=<archivo>
	@test -n "$(F)" || { echo "falta F=<archivo>  ·  ej: make tareas-guard F=tablero/data/x.md"; exit 2; }
	@cd tablero/server && go run ./cmd/tareas -guard ../../$(F)

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

trazador-buscar: ## @dia la HISTORIA de una persona por cédula, teléfono o solicitud. Q=1012345678 [TARGET=prod] [JSON=1] [MD=1 anotación para pegar en la tarea]
	@test -n "$(Q)" || { echo "falta Q=<cédula|teléfono|uReq>  ·  ej: make trazador-buscar Q=1012345678"; exit 2; }
	@cd trazador/server && go run . -target $(or $(TARGET),prod) -buscar $(Q) $(if $(JSON),-json) $(if $(MD),-md)

trazador-ureq: ## @dia la traza por etapas de UNA solicitud. UREQ=519245 [TARGET=prod] [TEL=3001234567 suma la fase de AUTH, que es la MITAD de los eventos del navegador] [HTML=f.html] [JSON=1] [MD=1]
	@test -n "$(UREQ)" || { echo "falta UREQ=<n>  ·  ej: make trazador-ureq UREQ=519245"; exit 2; }
	@cd trazador/server && go run . -target $(or $(TARGET),prod) -ureq $(UREQ) $(if $(TEL),-tel $(TEL)) $(if $(HTML),-html $(HTML)) $(if $(JSON),-json) $(if $(MD),-md)

# Los modos que el binario ya tenía y el catálogo no mostraba. Que existan en el código no alcanza: si
# no están acá no están en la ayuda, y lo que no está en la ayuda no existe para quien (o lo que) lee
# el catálogo al arrancar — que es justo la regla que este repo tiene escrita en su CLAUDE.md.
trazador-diag: ## @dia el diagnóstico FINO de una traza: qué se puede AFIRMAR de cada línea. UREQ=519245 MODO=campos|anclas|spans [TARGET=prod]
	@test -n "$(UREQ)" || { echo "falta UREQ=<n>  ·  ej: make trazador-diag UREQ=519245 MODO=anclas"; exit 2; }
	@case "$(MODO)" in campos|anclas|spans) ;; *) echo "falta MODO=campos|anclas|spans  (campos: qué llaves trae el contexto · anclas: cuánto se puede afirmar de cada línea · spans: si el span_id alcanza para ubicarlas)"; exit 2;; esac
	@cd trazador/server && go run . -target $(or $(TARGET),prod) -ureq $(UREQ) -$(MODO)

trazador-chequeo: ## @dia ¿el mapa del trazador sigue siendo cierto? sin corpus y sin tocar nada: coherencia interna, el vocabulario de ramales que comparte con el harness y, con TARGET, las tablas declaradas. [TARGET=local|dev]
	@cd trazador/server && go run . -chequeo $(if $(TARGET),-target $(TARGET))

estilo-ui: ## @dia verifica teclado, arrastre y persistencia de las cuatro UIs encendidas; Jira usa datos de prueba
	@node tools/ui-check.mjs

estilo-guia: ## @dia catálogo interactivo de la UI compartida en http://127.0.0.1:5198
	@python3 -m http.server 5198 --bind 127.0.0.1 --directory tools/ui

estilo-sync: ## @dia distribuye tools/ui a las cuatro herramientas
	@python3 tools/ui-sync.py

estilo-check: ## @dia ¿las cuatro UIs comparten de verdad UN tema? md5 de los `tema.css`, mezclas `in oklch` (que tiñen de rojo), contraste y variables usadas sin declarar
	@python3 tools/ui-sync.py --check
	@python3 tools/estilo.py

estilo-contraste: ## @dia mide el contraste de lo que SE PINTA en las cuatro UIs (lo que `estilo-check` no puede ver: el color viene de un ancestro y el fondo de otro). Necesita las UIs CORRIENDO. SOLO=<herramienta>
	@node tools/contraste.mjs

estilo-tema: ## @dia cambia el tema de LAS CUATRO UIs de un saque: pegás un export de tweakcn en un archivo y esto lo reparte. DE=<archivo.css> (sin DE, sólo dice cuál está puesto)
	@python3 tools/estilo.py --tema $(if $(DE),$(DE))

trazador-validar: ## @dia audita el MAPA de etapas contra líneas crudas: solapes, patrones mudos, decisiones que no resuelven. CORPUS=<tsv|ndjson>
	@test -n "$(CORPUS)" || { echo "falta CORPUS=<ruta al TSV del censo o a un timeline.ndjson>"; exit 2; }
	@cd trazador/server && go run . -validar $(CORPUS)

trazador-slack: ## @dia lee #tech-ops de los últimos N días y CLASIFICA los reportes (solo lectura). DIAS=7
	@test -n "$(DIAS)" || { echo "falta DIAS=<n>  ·  ej: make trazador-slack DIAS=7"; exit 2; }
	@cd trazador/server && go run . -slack $(DIAS)

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
	@cd tablero && { test -x server/bin/pulso || npm run --silent server:build; } \
	  && server/bin/pulso report -days $(or $(DAYS),7)

pulso-install: ## @dia deja el pulso registrando solo (cada 5 min, arranca con la sesión) + siembra el pasado
	@cd tablero && npm run --silent server:build && server/bin/pulso seed && server/bin/pulso install

pulso-status: ## @dia ¿el pulso está vivo? último tick y actividad de hoy
	@cd tablero && server/bin/pulso status

pulso-uninstall: ## @dia saca el agente del pulso (lo ya registrado se queda)
	@cd tablero && server/bin/pulso uninstall

# ── CONTEXTO ─────────────────────────────────────────────────────────────────────────────────────
.PHONY: context-align context-diff context-refs context-simbolos context-seal context-check context-map context-salud context-lint context-ramas context-ramas-test
.PHONY: context-jev context-jev-test tablero-jev tablero-jev-test
context-jev: ## @ctx laboratorio local de Jev: ARGS='route "pregunta" [--live]' | 'bench [--live]' | 'label reporte --expected nodo' | stats
	@python3 context/tools/jev.py $(or $(ARGS),--help)

context-jev-test: ## @ctx pruebas offline del ruteo local, contrato y abstención de Jev
	@PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s context/tools -p test_jev.py
	@PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s workers -p test_jev_routing.py

context-ramas: ## @ctx actualiza la consola de repos y ramas desde Git local, sin fetch. JSON=1 imprime el snapshot
	@cd context && python3 tools/ramas.py $(if $(JSON),--json)

context-ramas-test: ## @ctx pruebas del estado de ramas: activa, cambios locales y fusionada
	@PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s context/tools -p test_ramas.py

tablero-jev: ## @ctx laboratorio Jev del tablero: ARGS='bench [--live]' | 'triage <id|slug> [--live --allow-internal]' | 'label reporte …' | stats
	@python3 tablero/tools/jev.py $(or $(ARGS),--help)

tablero-jev-test: ## @ctx pruebas offline de Choice + Noul + Score y minimización del payload de tablero
	@PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tablero/tools -p test_jev.py

context-align: ## @ctx qué nodos quedaron viejos + escribe alineacion.json (corrélo DESPUÉS DE CADA MERGE)
	@cd context && python3 tools/alinear.py

context-salud: ## @ctx ¿el árbol SIRVE para un LLM? ruteo, archivos mudos, hubs, findings sin indexar — y el lint
	@cd context && python3 tools/salud.py
	@cd context && python3 tools/lint.py

context-lint: ## @ctx la guardia que BLOQUEA: conteos horneados, refs muertas, secciones prohibidas, rutas desnudas, nodos invisibles
	@cd context && python3 tools/lint.py

context-huella: ## @ctx la huella MEDIDA de un flujo (tablas/eventos/código) desde una corrida. UREQ=x [MYSQL=/tmp/huella-mysql.log]
	@test -n "$(UREQ)" || { cd context && python3 tools/huella.py; exit 2; }
	@cd context && python3 tools/huella.py $(UREQ) $(if $(NOMBRE),--nombre "$(NOMBRE)",) $(if $(MYSQL),--mysql $(MYSQL),)

context-diff: ## @ctx QUÉ cambió en el código de un nodo desde su sello — lo que se lee para re-verificar. NODE=x [STAT=1]
	@test -n "$(NODE)" || { echo "falta NODE=<nodo>  ·  ej: make context-diff NODE=onboarding"; exit 2; }
	@cd context && python3 tools/diff.py $(NODE) $(if $(STAT),--stat,)

context-refs: ## @ctx ¿las citas `archivo:línea` apuntan a lo que dicen? (NODE=<nodo> para uno solo)
	@cd context && python3 tools/refs.py $(NODE)

context-simbolos: ## @ctx ¿la cita apunta al SÍMBOLO que la prosa le pone al lado? (lo que refs.py NO mira). NODE=<nodo>
	@cd context && python3 tools/simbolos.py $(NODE)

context-seal: ## @ctx marca un nodo como verificado HOY — solo si de verdad lo revisaste. NODE=<nodo>
	@test -n "$(NODE)" || { echo "falta NODE=<nodo>  ·  ej: make context-seal NODE=kyc"; exit 2; }
	@cd context && python3 tools/sellar-verificado.py $(NODE)

context-check: ## @ctx ¿las rutas de TODOS los nodos existen en main? (el hook ya lo hace al editar uno)
	@cd context && for m in server/data/flows/*/map.json; do \
	  out=$$(python3 tools/oracle.py "$$m" 2>&1 | head -1); \
	  case "$$out" in *"DROPPED 0"*) ;; *) echo "  ⚠ $$(basename $$(dirname $$m)): $$out";; esac; \
	done; echo "  (sin líneas arriba = los $$(ls -d server/data/flows/*/ | wc -l | tr -d ' ') nodos sin rutas muertas)"

context-entidades: ## @ctx regenera docs/ENTIDADES.md — la ficha de NEGOCIO de cada entidad, medida contra PROD (alcance, ticket, plazo, aprobación, embudo, ocupación declarada vs real). [DIAS=90] [MIN=200]
	@cd context && python3 tools/build-entidades.py

context-map: ## @ctx regenera docs/ROUTE-MAP.md (el hook ya lo hace al editar un map.json)
	@cd context && python3 tools/build-route-map.py

# ── WORKERS ──────────────────────────────────────────────────────────────────────────────────────
# UN proyecto con dos mitades que se necesitan: el ÍNDICE de cómo están construidos los repos
# (`context` entra por pregunta de negocio; esto entra POR REPO) y los AGENTES de Gemini que lo
# consumen. Van juntos porque la medición fue una sola: los agentes rinden cuando cada herramienta
# devuelve exactamente lo que hace falta — el trabajo fino vive en los índices, no en el prompt.
# La dependencia sigue en un sentido: workers lee context, no al revés.
#
# ⚠ El índice NO tiene un target por verbo, a propósito: es un CLI de verdad y se maneja solo.
# `workers/cli.py --help` lista los subcomandos y `cli.py <subcomando> --help` sus opciones con los
# valores válidos. Un target de make (`ALIAS=x ZOOM=2`) no puede decir eso — y esta herramienta la
# usa tanto Miguel como un modelo, que necesita DESCUBRIRLA, no que se la expliquen. La ayuda es la
# documentación y no se desincroniza, porque sale del mismo código que corre.
.PHONY: workers
workers: ## @wrk el índice de los repos, sus logs y su modelo de datos. CLI: `workers/cli.py <sub> --help`
	@cd workers && ./cli.py $(if $(ARGS),$(ARGS),--help)

# Muestra 3 caracteres del valor a propósito: alcanza para distinguir `loc`alhost de `ine`rtia-dev, y
# no alcanza para usar un secreto. Lo que se busca no es el valor: es a DÓNDE apunta cada conexión.
env-auditoria: ## @wrk ¿a qué apunta cada .env del playground? clave + 3 caracteres, marcando lo COMPARTIDO. [RAIZ=ruta]
	@python3 workers/env_auditoria.py $(if $(RAIZ),$(RAIZ))

# ── PRUEBAS (harness) ────────────────────────────────────────────────────────────────────────────
.PHONY: harness-ecommerce harness-contract harness-sandbox harness-walk harness-qr harness-mocks harness-centrales harness-rto harness-peru harness-comercio harness-forms-g2 harness-bcp-volver tests-codeudor harness-listado harness-caso harness-check soporte-qa
harness-contract: ## @har ¿el mock de Bancolombia cumple los esquemas zod del front? (sin browser ni BD)
	@cd harness && npm run --silent contrato:bancolombia

harness-sandbox: ## @har ¿el BANCO DE VERDAD acepta lo que mandamos? pega contra el gateway real. GRUPO=A|B|C|D|E
	@cd harness && node dev/sandbox-bancolombia.ts $(if $(GRUPO),--grupo $(GRUPO)) $(if $(CRED),--cred $(CRED))

harness-walk: ## @har recorre las pantallas del canal QR clickeando. PRODUCT=bnpl|consumo
	@cd harness && E2E_TARGET=local npx tsx dev/caminar-qr.ts --producto $(or $(PRODUCT),bnpl)

harness-qr: ## @har el canal QR por API, sin browser: ¿cierra en estado 25 con código? PRODUCT=bnpl|consumo
	@cd harness && E2E_TARGET=local npx tsx dev/qr-corbeta.ts --producto $(or $(PRODUCT),bnpl)

harness-centrales: ## @har levanta el mock LOCAL de centrales de riesgo (:8105) — reemplaza el lambda de la empresa
	@cd harness && node mock-centrales/server.mjs

harness-mocks: ## @har levanta los mocks del canal QR (Bancolombia :8104 + Corbeta :8103)
	@cd harness && bin/mock-bancolombia start && bin/mock-corbeta start

harness-admin-ciudades: ## @har ¿el selector de ciudad del admin filtra por país? Pide `harness/.admin.json` + el admin en :8000
	@cd harness && E2E_TARGET=local npx playwright test dev/admin-ciudades.spec.ts --reporter=list

harness-pais-comercio: ## @har ¿el país de un comercio se puede corregir hasta la primera SOLICITUD? Pide `harness/.admin.json` + el admin en :8000
	@cd harness && E2E_TARGET=local npx playwright test dev/admin-pais-comercio.spec.ts --reporter=list

harness-telefono-duplicado: ## @har ¿dos altas del MISMO teléfono (una con indicativo y otra sin) crean dos usuarios? Escribe en LOCAL y limpia
	@cp harness/dev/php/usuario-duplicado-por-telefono.php $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-telefono.php
	@cd $(HOME)/Desktop/CREDITOP/github/legacy-backend && ./vendor/bin/sail artisan tinker .harness-telefono.php < /dev/null 2>&1 | grep -vE "Restricted Mode|DEPRECATED|Psy Shell" ; rm -f $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-telefono.php

harness-pais-usuario: ## @har ¿el usuario temporal nace con el país del COMERCIO o nace afgano? Los dos caminos de alta. Escribe en LOCAL y limpia
	@cp harness/dev/php/pais-del-comercio-en-el-usuario.php $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-pais.php
	@cd $(HOME)/Desktop/CREDITOP/github/legacy-backend && ./vendor/bin/sail artisan tinker .harness-pais.php < /dev/null 2>&1 | grep -vE "Restricted Mode|DEPRECATED|Psy Shell|nullable is deprecated" | cat -s ; rm -f $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-pais.php

harness-comercio-pais: ## @har ¿el POST de comercios de la API exige país y lo guarda, o el comercio nace afgano? Escribe en LOCAL y limpia
	@cp harness/dev/php/crear-comercio-por-api-exige-pais.php $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-comercio.php
	@cd $(HOME)/Desktop/CREDITOP/github/legacy-backend && ./vendor/bin/sail artisan tinker .harness-comercio.php < /dev/null 2>&1 | grep -vE "Restricted Mode|DEPRECATED|Psy Shell|nullable is deprecated" | cat -s ; rm -f $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-comercio.php

harness-volver-a-entrar: ## @har el cliente llega a /lenders, se sale y vuelve con el MISMO número: ¿retoma o le nace otro usuario? Escribe en LOCAL y limpia
	@cp harness/dev/php/volver-a-entrar-no-duplica.php $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-volver.php
	@cd $(HOME)/Desktop/CREDITOP/github/legacy-backend && ./vendor/bin/sail artisan tinker .harness-volver.php < /dev/null 2>&1 | grep -vE "Restricted Mode|DEPRECATED|Psy Shell|nullable is deprecated" | cat -s ; rm -f $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-volver.php

harness-dni-choca: ## @har ¿un DNI peruano se puede registrar si el número ya existe como cédula colombiana? Muestra las 3 guardas. LOCAL
	@cp harness/dev/php/dni-peruano-choca-con-cedula.php $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-dni.php
	@cd $(HOME)/Desktop/CREDITOP/github/legacy-backend && ./vendor/bin/sail artisan tinker .harness-dni.php < /dev/null 2>&1 | grep -vE "Restricted Mode|DEPRECATED|Psy Shell|nullable is deprecated" | cat -s ; rm -f $(HOME)/Desktop/CREDITOP/github/legacy-backend/.harness-dni.php

harness-suite-paises: ## @har ¿el cliente nace con el país de su comercio, su documento y su celular? La suite de internacionalización, contra la base. [PAR=1]
	@cd harness && node dev/caso.ts --suite suites/paises.json $(if $(PAR),--paralelo)

harness-ecommerce: ## @har EL CANAL ECOMMERCE de punta a punta: ¿el carrito de la tienda entra, el comercio queda atado al crédito y sus datos llegan al formulario? [SUITE=suites/ecommerce.json] [COMERCIO=amoblar] [TEL=<uno de qa_otp_bypass_phones> — obligatorio contra un ambiente desplegado: el OTP sólo es predecible para los teléfonos de esa lista]
	@cd harness && node dev/ecommerce.ts $(if $(SUITE),--suite '$(patsubst harness/%,%,$(SUITE))',--suite suites/ecommerce.json) $(if $(COMERCIO),--comercio $(COMERCIO)) $(if $(TEL),--tel $(TEL))

harness-ambiente: ## @har ¿la config de un target es coherente, y nadie resuelve el ambiente por fuera de la cadena? TARGET=qa [JSON=1]
	@cd harness && node bin/preflight.ts $(if $(TARGET),$(TARGET)) $(if $(JSON),--json)

harness-listado: ## @har del COMERCIO al listado de entidades, por API y sin browser: ¿cuáles le salen a un cliente y por qué NO las otras? [COMERCIO=pullman] [MONTO=2000000] [MD=1 la corrida como anotación fechada, con su comando adentro, para pegar en la tarea]
	@cd harness && MD=$(MD) node dev/listado.ts $(if $(COMERCIO),--comercio $(COMERCIO)) $(if $(MONTO),--amount $(MONTO)) $(if $(BRANCH),--branch $(BRANCH)) $(if $(V2),--v2)

harness-caso: ## @har CASOS hipotéticos de punta a punta, en PARALELO. CASOS='pullman@meddipay=rechaza;pullman@income=900000' [PAR=1] [LAMBDA=1 buró y proveedores dictados] [PRE=1 simula la consulta de PRE-APROBADOS del front] [CERRAR=1 = cierra por el lender CreditopX hasta estado 11] [MANUAL=1 identidad aprobada a mano, como en el admin] [MD=1 la corrida como anotación fechada, con su comando adentro, para pegar en la tarea]
	@cd harness && MD=$(MD) node dev/caso.ts $(if $(SUITE),--suite '$(SUITE)') $(if $(CASOS),--casos '$(CASOS)') $(if $(COMERCIO),--comercio $(COMERCIO)) $(if $(LENDER),--lender $(LENDER)) $(if $(MONTO),--amount $(MONTO)) $(if $(PAR),--paralelo) $(if $(LAMBDA),--lambda) $(if $(PRE),--preaprobados) $(if $(CERRAR),--cerrar) $(if $(MANUAL),--manual)

harness-caminar: ## @har el WIZARD entero por HTTP, sin navegador: pasa por cada pantalla del FRONT (loaders, actions, zod) y la contrasta con la BD. En PARALELO. Si un caso sale mal, consulta PostHog (qué pantalla registró el error). CASOS='#e9409aff:77;pullman:77' [FLOW=self-service|merchant|ecommerce — ecommerce entra por el checkout de la tienda y comprueba que la solicitud quede atada al pedido y personal-info bloqueado] [PAR=1] [CERRAR=1 hasta loan-approved] [MANUAL=1 identidad aprobada a mano] [MONTO=2000000] [CUOTA=300000 la cuota inicial que carga el asesor: con >0 el action toma la rama del cobro por pasarela, que con 0 no se ejecuta nunca] [PLAZO=6 en cuántas cuotas cerrar; sin esto toma el MÁS LARGO que ofrezca la entidad, que es el que más ejercita. ⚠ no confundir con CUOTA, que es plata] [MOTOR=navegador Chromium sin ventana, corre el JS del cliente y guarda evidencia] [FORENSE=1 consultar PostHog aunque cierre bien] [GATE=aprobado|rechazado qué contestar en un gate MANUAL —una pantalla de decisión, no de avance, como `entidad/resultado` de BCP—. Sin esto el caminador se detiene ahí a propósito: no elige por nadie. ⚠ `rechazado` deja la solicitud NEGADA] [MD=1 la corrida como anotación fechada, con su comando adentro, para pegar en la tarea]
	@cd harness && MD=$(MD) node dev/caminar-wizard.ts $(if $(CASOS),--casos '$(CASOS)') $(if $(COMERCIO),--comercio $(COMERCIO)) $(if $(LENDER),--lender $(LENDER)) $(if $(MONTO),--amount $(MONTO)) $(if $(CUOTA),--cuota-inicial $(CUOTA)) $(if $(PLAZO),--cuotas $(PLAZO)) $(if $(PAR),--paralelo) $(if $(CERRAR),--cerrar) $(if $(MANUAL),--manual) $(if $(FLOW),--flow $(FLOW)) $(if $(MOTOR),--motor $(MOTOR)) $(if $(GATE),--gate $(GATE)) $(if $(HEADED),--headed)

harness-posthog: ## @har ¿qué VIO el cliente en ESTA solicitud, y en qué PANTALLA se rompió? la tercera fuente (BD=desenlace · Loki=causa en el backend · PostHog=recorrido y errores DEL FRONT): sus eventos del embudo y sus logs con pantalla, etapa y error. ⚠ sólo qa/staging y prod: dev y local sirven el front LOCAL, que no escribe. UREQ=502060 [DESDE=2026-09-03T01:40:00Z] [PANTALLAS=otp,lenders,confirmation]
	@test -n "$(UREQ)" || { echo "falta UREQ=<n>  ·  ej: make harness-posthog UREQ=502060"; exit 2; }
	@cd harness && node dev/posthog-ureq.ts $(UREQ) $(if $(DESDE),--desde $(DESDE)) $(if $(PANTALLAS),--pantallas $(PANTALLAS))

harness-posthog-errores: ## @har ¿qué PANTALLAS del front se están rompiendo, y con qué error? el canal de LOGS agregado (pantalla · etapa · error, y los mensajes por patrón). ⚠ sólo qa/staging y prod: dev y local no tienen front desplegado. [DIAS=7]
	@cd harness && node dev/posthog-errores.ts $(if $(DIAS),--dias $(DIAS))

harness-suite: ## @har corre una SUITE de casos declarada en JSON y falla si alguno no cumple lo que declara. SUITE=harness/suites/x.json [PAR=1] [CERRAR=1] [LAMBDA=1] [MANUAL=1] [MD=1 la corrida como anotación fechada, con su comando adentro, para pegar en la tarea]
	@cd harness && MD=$(MD) node dev/caso.ts --suite '$(patsubst harness/%,%,$(SUITE))' $(if $(PAR),--paralelo) $(if $(CERRAR),--cerrar) $(if $(LAMBDA),--lambda) $(if $(PRE),--preaprobados) $(if $(MANUAL),--manual)

soporte-qa: ## @har el chat del cliente contra la API real, con cada respuesta al costado (:5199). Para QA
	@echo "  → http://localhost:5199/agente-soporte-modificacion-datos.cliente-qa.html    (Ctrl-C para cortar)"
	@cd tablero/data/artifacts && python3 -m http.server 5199

tests-codeudor: ## @har corre la suite del CODEUDOR (desactivada en el repo por CORE-431) en un schema DESECHABLE. PREPARAR=1 la primera vez
	@cd harness && bash bin/tests-codeudor.sh $(if $(PREPARAR),--preparar)

harness-rto: ## @har deja el lender Rent to Own usable en LOCAL (categorías, reglas, identidad) — config de PRUEBA, no de negocio
	@cd harness && node dev/montar-rto.ts

harness-kyc-flow: ## @har deja el resolvedor de KYC usable en LOCAL: siembra la setting `kyc_pipeline_allieds` vacía (= todos por el flujo legacy, como en qa). Sin ella `kyc-flow/{hash}` da 500 y el front cae al v1 sin avisar. Sólo local, idempotente
	@cd harness && E2E_TARGET=local node dev/montar-kyc-flow.ts

harness-peru: ## @har deja un COMERCIO PERUANO usable en LOCAL para mirar el wizard con su país (S/, +51, 9 dígitos). Sólo local, idempotente
	@cd harness && E2E_TARGET=local node dev/montar-peru.ts

harness-comercio: ## @har siembra un COMERCIO ENTERO en LOCAL desde su spec (`harness/comercios/*.json`): sucursales, entidades, reglas duras, perfiles, bienvenida y autogestión. Sin COMERCIO lista los que hay. [CLEAN=1 lo borra]
	@cd harness && E2E_TARGET=local node dev/montar-comercio.ts $(COMERCIO) $(if $(CLEAN),--clean)

harness-forms-g2: ## @har levanta el mock del FORM-SERVICE (:8109) — el formulario del VEHÍCULO de BCP. ⚠ Sin esto, en local ese formulario ESCRIBE en la BD compartida de dev. [CMD=start|stop|status|logs|capturar]
	@cd harness && bin/mock-forms-g2 $(if $(CMD),$(CMD),start)

harness-bcp-volver: ## @har el flujo VEHICULAR de BCP por HTTP y qué se PIERDE al volver atrás (el monto, el gate, la etapa). local · dev · qa · staging [TARGET=qa] [COMERCIO=#hash] [MONTO=60000] [TEL=a,b obligatorio fuera de local: el OTP sólo se salta con los del bypass] [FRONT=url] [NIEGA=1 el recorrido B, que deja una solicitud NEGADA]. En local pide `harness-peru` + `harness-forms-g2`; contra qa el comercio YA existe (`#a8221e67`)
	@cd harness && E2E_TARGET=$(or $(TARGET),local) node dev/bcp-volver.ts $(if $(TEL),--tel $(TEL)) $(if $(NIEGA),--niega) $(if $(COMERCIO),--comercio '$(COMERCIO)') $(if $(MONTO),--amount $(MONTO)) $(if $(INICIAL),--inicial $(INICIAL)) $(if $(BONO),--bono $(BONO)) $(if $(FRONT),--front $(FRONT))

harness-pantallas: ## @har ¿por qué PANTALLAS habría pasado el cliente? el recorrido del wizard derivado del router en main. AL REVÉS con ENDPOINT=confirm-payment-schedule. [FILTRO=texto] [JSON=1]
	@cd harness && node dev/pantallas.ts $(if $(FILTRO),--filtro '$(FILTRO)') $(if $(ENDPOINT),--endpoint '$(ENDPOINT)') $(if $(JSON),--json) $(if $(SIN_ENDPOINTS),--sin-endpoints)

harness-check: ## @har typecheck del harness
	@cd harness && npm run --silent typecheck

# ⚠ NO llega a producción: el harness no tiene `.env.prod` (solo local/dev/staging) y este comando no
# acepta TARGET — va por `E2E_TARGET`, que por defecto es **dev**. Pedirle una solicitud de prod
# devuelve CERO anclas sin decir por qué, y eso se lee como «no hay logs» en vez de «buscaste en otro
# lado». Para producción: `make trazador-acceso TARGET=prod`.
harness-ssr: ## @har la consola del SSR del wizard: a qué servicio llamó, con qué código y cuánto tardó (`[outbound]`). SOLO=1 filtra a lo saliente y los errores · N=120 líneas de cola · SEGUIR=1 se queda mirando. ⚠ lo escribe `bin/asesor` al levantar el wizard: si lo arrancaste a mano con `pnpm dev`, su salida se fue a esa terminal
	@f=/tmp/asesor-wizard.log; \
	if [ ! -f "$$f" ]; then \
	  echo "  ✗ no existe $$f"; \
	  echo "     lo escribe bin/asesor al levantar el wizard (lo trunca en cada arranque)."; \
	  echo "     Si levantaste el wizard a mano con 'pnpm dev', su salida se fue a ESA terminal y acá no hay nada que mirar."; \
	  exit 1; \
	fi; \
	filtro='.'; [ -n "$(SOLO)" ] && filtro='\[outbound\]|[Ee]rror|ELIFECYCLE|ECONN|failed'; \
	if [ -n "$(SEGUIR)" ]; then tail -n $(or $(N),120) -f "$$f" | grep -E --line-buffered "$$filtro"; \
	else tail -n $(or $(N),120) "$$f" | grep -E "$$filtro"; fi

harness-loki: ## @har ¿por qué terminó así esta solicitud? forense en los logs. ⚠ dev/staging/local, NO prod. UREQ=519245 [TARGET=local|dev|staging|qa — por defecto LOCAL: sin esto caía al default `dev` y consultaba el Loki COMPARTIDO buscando un uReq local, que en el mejor caso da «cero anclas» y en el peor te muestra la corrida de OTRO con el mismo id] [SINCE=12h]
	@cd harness && E2E_TARGET=$(or $(TARGET),local) node dev/loki-trace.ts $(UREQ) $(if $(SINCE),--since $(SINCE))

harness-paises: ## @har ¿de qué país es cada entidad? inferencia DRY-RUN desde el cableado. No escribe. [SQL=1]
	@cd harness && node dev/paises.ts $(if $(SQL),--sql,)

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
# ⚠ Los TARGET son cuatro —`prod` · `staging` · `dev` · `local`— y están los cuatro `.env.<target>`
# (`trazador/server/serve.go:36` es la lista autoritativa). El help decía `prod|dev` y `prod|local`:
# subestimaba la herramienta, y a un help se le cree — el que lo leía concluía que no podía consultar
# staging. Si agregás un target, tocá los tres lugares: serve.go, el `.env.<target>` y estas líneas.
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
# está en Confluence. El script ya existía en `context/tools/` desde antes, pero fuera del Makefile —
# o sea invisible para quien no leyera `context/CLAUDE.md`. Solo lectura: no hay verbo que escriba.
# ⚠ Nada de ahí entra al árbol sin pasar por el código (el protocolo, en `context/CLAUDE.md`).
confluence: ## @har el POR QUÉ del negocio, que el código no tiene. Sin CMD muestra su ayuda. CMD='buscar "cupo rotativo"' | 'espacios' | 'paginas Creditop' | 'leer <id>'
	@cd context && python3 tools/confluence.py $(CMD)

trazador-sql: ## @har UNA consulta de SOLO LECTURA a la BD del ambiente. SQL='SELECT …' [TARGET=prod|staging|dev|local] [CSV=1] [MD=1 anotación + tabla markdown, para pegar en la tarea]
	@# ⚠ el mismo escapado que la línea de abajo, y por la misma razón: `test -n "$(SQL)"` se rompía
	@# con cualquier consulta que llevara comillas DOBLES (`WHERE x = "y"`), porque make expande antes
	@# que el shell y las dobles del dato cerraban las del test. Fallaba con «binary operator expected»
	@# y el mensaje de ayuda hacía creer que faltaba SQL, cuando SQL estaba y era válido.
	@test -n $$'$(subst ','\'',$(SQL))' || { echo "falta SQL='SELECT …'  ·  ej: make trazador-sql TARGET=local SQL='SELECT id,name FROM countries LIMIT 3'"; exit 2; }
	@cd trazador/server && go run . -target $(if $(TARGET),$(TARGET),prod) -sql $$'$(subst ','\'',$(SQL))' $(if $(CSV),-csv) $(if $(MD),-md)

# Los agentes de workers: el bucle a la vista, contra Gemini. La receta de CÓMO combinarlos —cuántos
# ángulos, cuántos archivos, cuándo medir en vez de leer— está en `workers/README.md` §«Cómo se orquesta».
.PHONY: agente-modelos agente-plan agente-seleccion agente-contraste agente-analisis agente-lector agente-datos
agente-modelos: ## @wrk ¿qué modelos habilita mi key hoy? (correlo primero, y ante cualquier 404 de modelo)
	@cd workers && python3 gemini.py --modelos

agente-seleccion: ## @wrk NO contesta: dice QUÉ ARCHIVOS habría que leer y por qué. Sólo índices. PREGUNTA='…'
	@cd workers && python3 seleccion.py $(if $(PREGUNTA),"$(PREGUNTA)")

agente-contraste: ## @wrk PASO 2: otro agente elige archivos que el primero NO miró, para contrastar
	@cd workers && python3 contraste.py

agente-plan: ## @wrk NO busca: decide cuántos ángulos y cómo se dice en el código. PREGUNTA='…' [JEV=1 envía pregunta sin datos sensibles a TypeSafe]
	@test -n "$(PREGUNTA)" || { echo "falta PREGUNTA='…'"; exit 2; }
	@cd workers && CONTEXT_JEV=$(if $(filter 1 yes true,$(JEV)),1,0) python3 plan.py "$(PREGUNTA)"

agente-analisis: ## @wrk LA FILA ENTERA: plan → N seleccionadores por ángulo → lector. PREGUNTA='…' [JEV=1 experimental]
	@test -n "$(PREGUNTA)" || { echo "falta PREGUNTA='…'"; exit 2; }
	@cd workers && CONTEXT_JEV=$(if $(filter 1 yes true,$(JEV)),1,0) python3 analisis.py "$(PREGUNTA)"

agente-lector: ## @wrk PASO 2: lee los archivos que eligió `agente-seleccion` y contesta. Recorta a 300k tokens
	@cd workers && python3 lector.py $(if $(PREGUNTA),"$(PREGUNTA)")

# Los otros agentes leen CÓDIGO. Éste MIDE: base de datos y logs reales, un ambiente por corrida.
# Es seguro contra prod porque la guarda de solo-lectura vive en Go (`trazador/server/sql.go`), no en el
# prompt — un prompt se convence, esa función no.
agente-datos: ## @wrk NO lee código: MIDE contra la BD y los logs reales. PREGUNTA='…' [TARGET=local|dev|staging|prod]
	@test -n "$(PREGUNTA)" || { echo "falta PREGUNTA='…'  ·  ej: make agente-datos TARGET=prod PREGUNTA='¿cuántas solicitudes quedan en estado 3?'"; exit 2; }
	@cd workers && python3 datos.py "$(PREGUNTA)" --target $(if $(TARGET),$(TARGET),local)

# ── EXPLORACIONES ────────────────────────────────────────────────────────────────────────────────
# Están acá para poder abrirlas, NO porque sean fuente. No se citan para decidir (ver CLAUDE.md).
.PHONY: flow engine dict domain
flow: ## @expl simulador del flujo (:5190)
	@cd flow && npm run dev

engine: ## @expl motor de reglas (:5196)
	@cd engine && npm run dev

dict: ## @expl diccionario de negocio (:5194)
	@cd diccionario && npm run dev

domain: ## @expl modelo de dominio deber-ser (:5183)
	@cd domain-model && npm run dev

.PHONY: plantillas plantillas-check
plantillas: ## @expl PROTOTIPO: onboarding compuesto por el backend, realtime por SSE (:5198 + Go :8090)
	@cd plantillas && npm run dev

plantillas-check: ## @expl compila el server del prototipo (go vet + build)
	@cd plantillas/server && go vet ./... && go build -o /dev/null ./... && echo "plantillas: ok"

# Ya no vive acá: el 2026-09-10 cuadrilla se mudó al repo COMPARTIDO
# (`github/playground/tools/cuadrilla`) y se rehizo en Go + Vue. El target se queda porque la puerta
# es una sola: lo que cambió es a dónde apunta. Levanta la API en :8080 y el front en :5197 — NO en
# el :5173 que anuncia `task dev`, porque ese lo tiene el Vite de legacy-backend.
.PHONY: cuadrilla
cuadrilla: ## @expl las épicas del equipo — ramas por persona. Vive en el repo COMPARTIDO (API :8080 · front :5197)
	@cd ../github/playground && task dev TOOL=cuadrilla

# Las dos de acá abajo NO hablan de CreditOp: son para escribir mejor, una en inglés y otra en
# español. Están en el playground porque es donde viven las herramientas de Miguel, y en @expl
# porque la regla que importa es la misma que para el resto de esta sección — no son fuente de
# contexto de nada.
.PHONY: ingles ingles-check
ingles: ## @expl NO es de CreditOp: leer inglés con las 100 palabras más usadas (:5189)
	@cd ingles && npm run dev

ingles-check: ## @expl ¿las historias tienen todo traducido? corrélo al agregar una. [N=02]
	@cd ingles && node herramientas/check.js $(N)

.PHONY: escriba escriba-check
escriba: ## @expl NO es de CreditOp: practicar ortografía del español, por reglas (:5188)
	@cd escriba && npm run dev

escriba-check: ## @expl ¿las reglas están sanas y todas explican su porqué? corrélo al agregar una. [N=04]
	@cd escriba && node herramientas/check.js $(N)
