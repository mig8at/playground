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
	  | awk -F'\t' '{printf "    \033[36m%-16s\033[0m %s\n", $$1, $$2}'
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

# ── CONTEXTO ─────────────────────────────────────────────────────────────────────────────────────
.PHONY: context-align context-refs context-seal context-check context-map
context-align: ## @ctx qué nodos quedaron viejos + escribe alineacion.json (corrélo DESPUÉS DE CADA MERGE)
	@cd context && python3 tools/alinear.py

context-refs: ## @ctx ¿las citas `archivo:línea` apuntan a lo que dicen? (NODE=<nodo> para uno solo)
	@cd context && python3 tools/refs.py $(NODE)

context-seal: ## @ctx marca un nodo como verificado HOY — solo si de verdad lo revisaste. NODE=<nodo>
	@test -n "$(NODE)" || { echo "falta NODE=<nodo>  ·  ej: make context-seal NODE=kyc"; exit 2; }
	@cd context && python3 tools/sellar-verificado.py $(NODE)

context-check: ## @ctx ¿las rutas de TODOS los nodos existen en main? (el hook ya lo hace al editar uno)
	@cd context && for m in server/data/flows/*/map.json; do \
	  out=$$(python3 tools/oracle.py "$$m" 2>&1 | head -1); \
	  case "$$out" in *"DROPPED 0"*) ;; *) echo "  ⚠ $$(basename $$(dirname $$m)): $$out";; esac; \
	done; echo "  (sin líneas arriba = los 31 nodos sin rutas muertas)"

context-map: ## @ctx regenera docs/ROUTE-MAP.md (el hook ya lo hace al editar un map.json)
	@cd context && python3 tools/build-route-map.py

# ── PRUEBAS (harness) ────────────────────────────────────────────────────────────────────────────
.PHONY: harness-contract harness-walk harness-qr harness-mocks harness-check
harness-contract: ## @har ¿el mock de Bancolombia cumple los esquemas zod del front? (sin browser ni BD)
	@cd harness && npm run --silent contrato:bancolombia

harness-walk: ## @har recorre las pantallas del canal QR clickeando. PRODUCT=bnpl|consumo
	@cd harness && E2E_TARGET=local npx tsx dev/caminar-qr.ts --producto $(or $(PRODUCT),bnpl)

harness-qr: ## @har el canal QR por API, sin browser: ¿cierra en estado 25 con código? PRODUCT=bnpl|consumo
	@cd harness && E2E_TARGET=local npx tsx dev/qr-corbeta.ts --producto $(or $(PRODUCT),bnpl)

harness-mocks: ## @har levanta los mocks del canal QR (Bancolombia :8104 + Corbeta :8103)
	@cd harness && bin/mock-bancolombia start && bin/mock-corbeta start

harness-check: ## @har typecheck del harness
	@cd harness && npm run --silent typecheck

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
