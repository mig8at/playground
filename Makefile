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
.PHONY: status context tablero panel
status: ## @dia ¿está el contexto al día? (resumen, no escribe nada)
	@cd context && python3 tools/alinear.py --ver | tail -n 25
	@echo ""
	@cd context && python3 tools/refs.py | tail -n 2

context: ## @dia abre la viz del árbol de contexto (:5193)
	@cd context && npm run dev

tablero: ## @dia abre el tablero: las tareas a realizar (:5191)
	@cd tablero && npm run dev

panel: ## @dia abre el panel del harness para probar flujos (:5195)
	@cd harness && npm run dev

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
.PHONY: context-align context-diff context-refs context-seal context-check context-map context-salud
context-align: ## @ctx qué nodos quedaron viejos + escribe alineacion.json (corrélo DESPUÉS DE CADA MERGE)
	@cd context && python3 tools/alinear.py

context-salud: ## @ctx ¿el árbol SIRVE para un LLM? ruteo, archivos mudos, hubs, findings sin indexar
	@cd context && python3 tools/salud.py

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

context-map: ## @ctx regenera docs/ROUTE-MAP.md (el hook ya lo hace al editar un map.json)
	@cd context && python3 tools/build-route-map.py

# ── PRUEBAS (harness) ────────────────────────────────────────────────────────────────────────────
.PHONY: harness-contract harness-sandbox harness-walk harness-qr harness-mocks harness-check
harness-contract: ## @har ¿el mock de Bancolombia cumple los esquemas zod del front? (sin browser ni BD)
	@cd harness && npm run --silent contrato:bancolombia

harness-sandbox: ## @har ¿el BANCO DE VERDAD acepta lo que mandamos? pega contra el gateway real. GRUPO=A|B|C|D|E
	@cd harness && node dev/sandbox-bancolombia.ts $(if $(GRUPO),--grupo $(GRUPO)) $(if $(CRED),--cred $(CRED))

harness-walk: ## @har recorre las pantallas del canal QR clickeando. PRODUCT=bnpl|consumo
	@cd harness && E2E_TARGET=local npx tsx dev/caminar-qr.ts --producto $(or $(PRODUCT),bnpl)

harness-qr: ## @har el canal QR por API, sin browser: ¿cierra en estado 25 con código? PRODUCT=bnpl|consumo
	@cd harness && E2E_TARGET=local npx tsx dev/qr-corbeta.ts --producto $(or $(PRODUCT),bnpl)

harness-mocks: ## @har levanta los mocks del canal QR (Bancolombia :8104 + Corbeta :8103)
	@cd harness && bin/mock-bancolombia start && bin/mock-corbeta start

harness-admin-ciudades: ## @har ¿el selector de ciudad del admin filtra por país? Pide `harness/.admin.json` + el admin en :8000
	@cd harness && E2E_TARGET=local npx playwright test dev/admin-ciudades.spec.ts --reporter=list

harness-check: ## @har typecheck del harness
	@cd harness && npm run --silent typecheck

harness-loki: ## @har ¿por qué terminó así esta solicitud? forense en los logs. UREQ=519245 [SINCE=12h]
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
.PHONY: trazador-acceso trazador-sql
trazador-acceso: ## @har ¿puedo leer los logs en Loki? (TARGET=prod|dev QUERY='{...}' SINCE=1h)
	@cd trazador/server && go run . $(if $(TARGET),-target $(TARGET)) $(if $(QUERY),-query '$(QUERY)') $(if $(SINCE),-since $(SINCE))

trazador-sql: ## @har UNA consulta de SOLO LECTURA a la BD del ambiente. SQL='SELECT …' [TARGET=prod|local] [CSV=1]
	@test -n "$(SQL)" || { echo "falta SQL='SELECT …'  ·  ej: make trazador-sql TARGET=local SQL='SELECT id,name FROM countries LIMIT 3'"; exit 2; }
	@cd trazador/server && go run . -target $(if $(TARGET),$(TARGET),prod) -sql $$'$(subst ','\'',$(SQL))' $(if $(CSV),-csv)

# ── EXPLORACIONES ────────────────────────────────────────────────────────────────────────────────
# Están acá para poder abrirlas, NO porque sean fuente. No se citan para decidir (ver CLAUDE.md).
.PHONY: flow engine dict domain
flow: ## @expl simulador del flujo (:5190)
	@cd flow && npm run dev

engine: ## @expl motor de reglas (:5197)
	@cd engine && npm run dev

dict: ## @expl diccionario de negocio (:5194)
	@cd diccionario && npm run dev

domain: ## @expl modelo de dominio deber-ser (sin puerto fijo)
	@cd domain-model && npm run dev
