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
.PHONY: status context tablero tareas tareas-guard sprint bitacora panel trazador trazador-buscar trazador-ureq
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
tareas-ramas: ## @dia ¿en qué ramas vive cada tarea y hasta dónde llegó? mide git y guarda el snapshot. N=<id|título> · JSON=1
	@cd tablero/server && go run ./cmd/ramas $(if $(N),-n "$(N)") $(if $(JSON),-json)

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

trazador-buscar: ## @dia la HISTORIA de una persona por cédula, teléfono o solicitud. Q=1012345678 [TARGET=prod] [JSON=1]
	@test -n "$(Q)" || { echo "falta Q=<cédula|teléfono|uReq>  ·  ej: make trazador-buscar Q=1012345678"; exit 2; }
	@cd trazador/server && go run . -target $(or $(TARGET),prod) -buscar $(Q) $(if $(JSON),-json)

trazador-ureq: ## @dia la traza por etapas de UNA solicitud. UREQ=519245 [TARGET=prod] [HTML=f.html] [JSON=1]
	@test -n "$(UREQ)" || { echo "falta UREQ=<n>  ·  ej: make trazador-ureq UREQ=519245"; exit 2; }
	@cd trazador/server && go run . -target $(or $(TARGET),prod) -ureq $(UREQ) $(if $(HTML),-html $(HTML)) $(if $(JSON),-json)

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
.PHONY: context-align context-diff context-refs context-seal context-check context-map context-salud context-lint
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
.PHONY: harness-contract harness-sandbox harness-walk harness-qr harness-mocks harness-centrales harness-rto harness-peru tests-codeudor harness-listado harness-caso harness-check soporte-qa
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

harness-listado: ## @har del COMERCIO al listado de entidades, por API y sin browser: ¿cuáles le salen a un cliente y por qué NO las otras? [COMERCIO=pullman] [MONTO=2000000]
	@cd harness && node dev/listado.ts $(if $(COMERCIO),--comercio $(COMERCIO)) $(if $(MONTO),--amount $(MONTO)) $(if $(BRANCH),--branch $(BRANCH)) $(if $(V2),--v2)

harness-caso: ## @har CASOS hipotéticos de punta a punta, en PARALELO. CASOS='pullman@meddipay=rechaza;pullman@income=900000' [PAR=1] [LAMBDA=1 buró y proveedores dictados] [PRE=1 simula la consulta de PRE-APROBADOS del front] [CERRAR=1 = cierra por el lender CreditopX hasta estado 11]
	@cd harness && node dev/caso.ts $(if $(SUITE),--suite '$(SUITE)') $(if $(CASOS),--casos '$(CASOS)') $(if $(COMERCIO),--comercio $(COMERCIO)) $(if $(LENDER),--lender $(LENDER)) $(if $(MONTO),--amount $(MONTO)) $(if $(PAR),--paralelo) $(if $(LAMBDA),--lambda) $(if $(PRE),--preaprobados) $(if $(CERRAR),--cerrar)

harness-suite: ## @har corre una SUITE de casos declarada en JSON y falla si alguno no cumple lo que declara. SUITE=harness/suites/x.json [PAR=1] [CERRAR=1] [LAMBDA=1]
	@cd harness && node dev/caso.ts --suite '$(patsubst harness/%,%,$(SUITE))' $(if $(PAR),--paralelo) $(if $(CERRAR),--cerrar) $(if $(LAMBDA),--lambda) $(if $(PRE),--preaprobados)

soporte-qa: ## @har el chat del cliente contra la API real, con cada respuesta al costado (:5199). Para QA
	@echo "  → http://localhost:5199/agente-soporte-modificacion-datos.cliente-qa.html    (Ctrl-C para cortar)"
	@cd tablero/data/artifacts && python3 -m http.server 5199

tests-codeudor: ## @har corre la suite del CODEUDOR (desactivada en el repo por CORE-431) en un schema DESECHABLE. PREPARAR=1 la primera vez
	@cd harness && bash bin/tests-codeudor.sh $(if $(PREPARAR),--preparar)

harness-rto: ## @har deja el lender Rent to Own usable en LOCAL (categorías, reglas, identidad) — config de PRUEBA, no de negocio
	@cd harness && node dev/montar-rto.ts

harness-peru: ## @har deja un COMERCIO PERUANO usable en LOCAL para mirar el wizard con su país (S/, +51, 9 dígitos). Sólo local, idempotente
	@cd harness && node dev/montar-peru.ts

harness-pantallas: ## @har ¿por qué PANTALLAS habría pasado el cliente? el recorrido del wizard derivado del router en main. AL REVÉS con ENDPOINT=confirm-payment-schedule. [FILTRO=texto] [JSON=1]
	@cd harness && node dev/pantallas.ts $(if $(FILTRO),--filtro '$(FILTRO)') $(if $(ENDPOINT),--endpoint '$(ENDPOINT)') $(if $(JSON),--json) $(if $(SIN_ENDPOINTS),--sin-endpoints)

harness-check: ## @har typecheck del harness
	@cd harness && npm run --silent typecheck

# ⚠ NO llega a producción: el harness no tiene `.env.prod` (solo local/dev/staging) y este comando no
# acepta TARGET — va por `E2E_TARGET`, que por defecto es **dev**. Pedirle una solicitud de prod
# devuelve CERO anclas sin decir por qué, y eso se lee como «no hay logs» en vez de «buscaste en otro
# lado». Para producción: `make trazador-acceso TARGET=prod`.
harness-loki: ## @har ¿por qué terminó así esta solicitud? forense en los logs. ⚠ dev/staging/local, NO prod. UREQ=519245 [SINCE=12h]
	@cd harness && node dev/loki-trace.ts $(UREQ) $(if $(SINCE),--since $(SINCE))

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

trazador-posthog: ## @har ¿qué VIO el cliente en el navegador? Sin UREQ = sonda de acceso + censo (TARGET=prod UREQ=n)
	@cd trazador/server && go run . -posthog $(if $(TARGET),-target $(TARGET)) $(if $(UREQ),-ureq $(UREQ)) $(if $(LIMIT),-limit $(LIMIT))

# El «por qué» del negocio (política de riesgo, contratos con lenders, PRDs) no está en el código:
# está en Confluence. El script ya existía en `context/tools/` desde antes, pero fuera del Makefile —
# o sea invisible para quien no leyera `context/CLAUDE.md`. Solo lectura: no hay verbo que escriba.
# ⚠ Nada de ahí entra al árbol sin pasar por el código (el protocolo, en `context/CLAUDE.md`).
confluence: ## @har el POR QUÉ del negocio, que el código no tiene. Sin CMD muestra su ayuda. CMD='buscar "cupo rotativo"' | 'espacios' | 'paginas Creditop' | 'leer <id>'
	@cd context && python3 tools/confluence.py $(CMD)

trazador-sql: ## @har UNA consulta de SOLO LECTURA a la BD del ambiente. SQL='SELECT …' [TARGET=prod|staging|dev|local] [CSV=1]
	@# ⚠ el mismo escapado que la línea de abajo, y por la misma razón: `test -n "$(SQL)"` se rompía
	@# con cualquier consulta que llevara comillas DOBLES (`WHERE x = "y"`), porque make expande antes
	@# que el shell y las dobles del dato cerraban las del test. Fallaba con «binary operator expected»
	@# y el mensaje de ayuda hacía creer que faltaba SQL, cuando SQL estaba y era válido.
	@test -n $$'$(subst ','\'',$(SQL))' || { echo "falta SQL='SELECT …'  ·  ej: make trazador-sql TARGET=local SQL='SELECT id,name FROM countries LIMIT 3'"; exit 2; }
	@cd trazador/server && go run . -target $(if $(TARGET),$(TARGET),prod) -sql $$'$(subst ','\'',$(SQL))' $(if $(CSV),-csv)

# Los agentes de workers: el bucle a la vista, contra Gemini. La receta de CÓMO combinarlos —cuántos
# ángulos, cuántos archivos, cuándo medir en vez de leer— está en `workers/README.md` §«Cómo se orquesta».
.PHONY: agente-modelos agente-plan agente-seleccion agente-contraste agente-analisis agente-lector agente-datos
agente-modelos: ## @wrk ¿qué modelos habilita mi key hoy? (correlo primero, y ante cualquier 404 de modelo)
	@cd workers && python3 gemini.py --modelos

agente-seleccion: ## @wrk NO contesta: dice QUÉ ARCHIVOS habría que leer y por qué. Sólo índices. PREGUNTA='…'
	@cd workers && python3 seleccion.py $(if $(PREGUNTA),"$(PREGUNTA)")

agente-contraste: ## @wrk PASO 2: otro agente elige archivos que el primero NO miró, para contrastar
	@cd workers && python3 contraste.py

agente-plan: ## @wrk NO busca: decide cuántos ángulos y cómo se dice en el código. PREGUNTA='…'
	@test -n "$(PREGUNTA)" || { echo "falta PREGUNTA='…'"; exit 2; }
	@cd workers && python3 plan.py "$(PREGUNTA)"

agente-analisis: ## @wrk LA FILA ENTERA: plan → N seleccionadores por ángulo → lector. PREGUNTA='…'
	@test -n "$(PREGUNTA)" || { echo "falta PREGUNTA='…'"; exit 2; }
	@cd workers && python3 analisis.py "$(PREGUNTA)"

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

domain: ## @expl modelo de dominio deber-ser (sin puerto fijo)
	@cd domain-model && npm run dev

.PHONY: plantillas plantillas-check
plantillas: ## @expl PROTOTIPO: onboarding compuesto por el backend, realtime por SSE (:5198 + Go :8090)
	@cd plantillas && npm run dev

plantillas-check: ## @expl compila el server del prototipo (go vet + build)
	@cd plantillas/server && go vet ./... && go build -o /dev/null ./... && echo "plantillas: ok"

.PHONY: cuadrilla
cuadrilla: ## @expl PROTOTIPO: las épicas del equipo — ramas y PRs por persona (:5197)
	@cd cuadrilla && npm run dev
