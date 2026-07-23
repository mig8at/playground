# frontend-e2e · atajos `make` — flujo E2E (wizard real) hasta /lenders con inyección de KYC armado.
# Apunta a DEV por defecto; `local` lo corre contra el legacy local (mismo flujo, --target local).
#
#   ── entorno listo ──
#   make up                                   levanta el legacy local (NO modifica su .env)
#   make wizard                               levanta el wizard (loan-request-wizard) en :5174
#   make ready                                up + wizard → entorno listo para probar a mano
#   make down                                 apaga el legacy local
#   make env                                  health del wizard (:5174) y del backend (:80)
#   make login <local|dev|staging>            loguea en Cognito y cachea la sesión (.auth/) para reusarla
#   ── pruebas ──  (entrada PRINCIPAL: el panel visual → `npm run dev` → http://localhost:5195)
#   make run  <asesor|ecommerce> <merchant>   MANUAL: entra y queda en monto (manejás vos a mano)
#   make auto <asesor|ecommerce> <merchant>   GUIADO: seed + Continuar; en /lenders elegís y sigue
#   make vtex [merchant=pullman]              flujo VTEX por UI: vtexInit (legacy crea la URL base64) → wizard → /lenders
#   make test [specs...]                      corre los specs con Playwright
#   make help
#
# Equivale a los bins: `make auto asesor pullman` ≡ `bin/asesor pullman auto` · `make run ecommerce pullman` ≡ `bin/ecommerce pullman`.
SHELL := /bin/bash
.DEFAULT_GOAL := help
LEGACY ?= $(HOME)/Desktop/CREDITOP/github/legacy-backend
FRONT  ?= $(HOME)/Desktop/CREDITOP/github/frontend-monorepo
WIZARD := $(FRONT)/apps/loan-request-wizard

CMDS := run auto vtex ready test up down wizard env login help
ARGS := $(filter-out $(CMDS),$(MAKECMDGOALS))

.PHONY: $(CMDS)

# ─────────────────────────── entorno listo ───────────────────────────
up: ## levanta el legacy local (make -C legacy up) — NO modifica su .env
	@[ -d "$(LEGACY)" ] || { echo "✗ no encuentro legacy en $(LEGACY) (export LEGACY=...)"; exit 1; }
	@echo "▶ levantando legacy local (sin tocar su .env)…"
	@$(MAKE) -C "$(LEGACY)" up

down: ## apaga el legacy local
	@$(MAKE) -C "$(LEGACY)" down

wizard: ## levanta el wizard (loan-request-wizard) en :5174
	@if curl -s -o /dev/null --max-time 3 http://localhost:5174 2>/dev/null; then echo "wizard ya en :5174"; else \
		[ -d "$(WIZARD)" ] || { echo "✗ no encuentro el wizard en $(WIZARD) (export FRONT=...)"; exit 1; }; \
		echo "▶ pnpm dev (wizard)…"; ( cd "$(WIZARD)" && pnpm dev >/tmp/fe-wizard.log 2>&1 & ); \
		for i in $$(seq 1 40); do curl -s -o /dev/null --max-time 2 http://localhost:5174 2>/dev/null && break; done; \
		curl -s -o /dev/null --max-time 3 http://localhost:5174 2>/dev/null && echo "  ✓ wizard listo en :5174" || echo "  ✗ no levantó (ver /tmp/fe-wizard.log)"; fi

ready: ## up legacy + wizard → entorno listo para probar a mano en el navegador
	@$(MAKE) --no-print-directory up
	@$(MAKE) --no-print-directory wizard
	@echo "✅ entorno listo · wizard http://localhost:5174 · backend http://localhost"
	@echo "   flujo completo:  make auto ecommerce pullman   (= bin/ecommerce pullman auto)"

env: ## health del wizard (:5174) y del backend (:80)
	@echo "frontend-e2e: wizard http://localhost:5174 · backend http://localhost (siempre localhost)"
	@code=$$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:5174 2>/dev/null); \
	 case "$$code" in 2*|3*|4*) echo "wizard :5174 → HTTP $$code (arriba)";; *) echo "wizard :5174 → HTTP $${code:-000} (no responde — make wizard)";; esac
	@code=$$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: legacy-backend.inertia-develop' --max-time 5 http://127.0.0.1:80/api 2>/dev/null); \
	 case "$$code" in 2*|3*|4*) echo "backend :80 → HTTP $$code (arriba)";; *) echo "backend :80 → HTTP $${code:-000} (no responde — make up)";; esac

login: ## [local|dev|staging] — SIN arg: VALIDA en consola qué logins están OK (read-only, los 3). CON arg: loguea ese target y cachea la sesión (.auth/cognito-state.<t>.json).
	@t="$(word 1,$(ARGS))"; \
	if [ -z "$$t" ]; then \
	  echo "▶ login por target (session-check · read-only):"; \
	  for x in staging dev local; do \
	    out=$$(E2E_TARGET=$$x node bin/session-check.ts 2>/dev/null); \
	    if echo "$$out" | grep -q '"status":"valid"'; then echo "  ✅ $$x — login OK"; else echo "  ⛔ $$x — sin sesión · $$out"; fi; \
	  done; \
	  echo "  (para loguear uno:  make login <target>   · dev/local necesitan :5174 arriba)"; \
	else \
	  case "$$t" in local|dev|staging) ;; *) echo "✗ target inválido: '$$t' — usá: make login <local|dev|staging>"; exit 1;; esac; \
	  case "$$t" in local|dev) curl -s -o /dev/null --max-time 3 http://localhost:5174 2>/dev/null || echo "  ⚠ $$t entra por el front local :5174 — si no responde, corré 'make wizard' antes";; esac; \
	  echo "▶ login Cognito ($$t) → cachea .auth/cognito-state.$$t.json"; \
	  E2E_TARGET="$$t" npx playwright test dev/warm-session.spec.ts --headed --reporter=line; \
	  echo "▶ estado de la sesión ($$t):"; E2E_TARGET="$$t" node bin/session-check.ts; \
	fi

# ─────────────────────────── pruebas ───────────────────────────
run: ## <asesor|ecommerce> <merchant> — MANUAL: entra y queda en monto (manejás vos a mano)
	@origen="$(word 1,$(ARGS))"; m="$(word 2,$(ARGS))"; [ -n "$$m" ] || m="pullman"; \
	case "$$origen" in \
	  ecommerce) echo "▶ bin/ecommerce $$m   (manual)"; bin/ecommerce "$$m";; \
	  asesor|*)  echo "▶ bin/asesor $$m   (manual)";    bin/asesor "$$m";; \
	esac

auto: ## <asesor|ecommerce> <merchant> — GUIADO: seed cada pantalla, vos das Continuar; en /lenders elegís y sigue
	@origen="$(word 1,$(ARGS))"; m="$(word 2,$(ARGS))"; [ -n "$$m" ] || m="pullman"; \
	case "$$origen" in \
	  ecommerce) echo "▶ bin/ecommerce $$m auto"; bin/ecommerce "$$m" auto;; \
	  asesor|*)  echo "▶ bin/asesor $$m auto";    bin/asesor "$$m" auto;; \
	esac

vtex: ## [merchant=pullman] — flujo VTEX por UI: vtexInit (legacy crea la URL base64 vía /vtex/init) → wizard → /lenders
	@m="$(word 1,$(ARGS))"; [ -n "$$m" ] || m="pullman"; \
	echo "▶ VTEX checkout por UI (merchant=$$m) — requiere wizard :5174 + legacy local en modo mock"; \
	E2E_MERCHANT="$$m" npx playwright test channel/vtex-checkout.spec.ts

test: ## [specs...] — corre los specs con Playwright
	@npx playwright test $(ARGS)

help: ## muestra esta ayuda
	@echo "frontend-e2e · atajos make (flujo inject hasta /lenders · dev por defecto, local opcional)"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "}{printf "  make %-9s %s\n", $$1, $$2}'
	@echo
	@echo "  ej:  make auto asesor pullman                  (GUIADO asesor · DEV · Cognito real)"
	@echo "       make auto ecommerce pullman               (GUIADO desde la tienda · checkout)"
	@echo "       make run  asesor pullman                  (MANUAL · login asesor, manejás vos)"
	@echo "       make run  ecommerce pullman               (MANUAL desde la tienda)"
	@echo "       npm run dev                               (PANEL visual :5195 — la entrada principal)"

# catch-all: vuelve no-op los args posicionales. Los targets reales tienen prioridad.
%:
	@:
