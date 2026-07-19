# backend-e2e · atajos `make` para pruebas rápidas y para dejar un entorno listo.
#
# Dos namespaces de entorno, separados a propósito:
#   · el LEGACY lee su propio .env (APP_*/DB_*/ONBOARDING_*) — este make NO lo toca.
#   · el HARNESS (backend-e2e) lee NUESTRO .env.local (E2E_*); cada comando lo sourcea.
# Local es todo 127.0.0.1:80 hardcodeado; el .env.local solo aporta E2E_* (ej. SEED).
#
#   ── comando unificado (lo que se usa) ──
#   make local <ecommerce> <merchant> <lender> [state]   flujo ecommerce contra el legacy LOCAL
#   make dev   <ecommerce> <merchant> <lender> [state]   idem contra DEV (WEBHOOK=<url> p/ ver el payload)
#       ecommerce: vtex | woocommerce | self    (flipea ecommerce_type_id → elige el notificador; revierte al salir)
#       lender:    credipullman (rt2 → cierre REAL +settle) · bancolombia/sistecredito (rt0/1 → SIMULADOR)
#       state:     approved (default, E11) | rejected (E6) | 7 | 8
#       modificadores: EXPLAIN=1 documenta sin ejecutar · WEBHOOK=<url> receptor público (en dev hay default)
#   make scenario <name>                      corre un combo nombrado de presets.json   ·   make scenarios (lista)
#       presets.json: alias de merchant por entorno (pullman→638bd7f1 en dev) + defaults (webhook/monto)
#   ── entorno listo ──
#   make up / make down                       levanta / apaga el legacy local (NO toca su .env)
#   make ready <ecommerce|asesor> <merchant> <lender>   up + siembra → entorno listo (URL + login asesor)
#   make prep <merchant> <lender>             siembra precondicionales (deja un user_request listo)
#   make create <role> <merchant>             crea un asesor de prueba   ·   make env (config activa)
#   ── diagnóstico ──
#   make run <ecommerce|asesor> <merchant> <lender>     prep + flujo clásico (web/asesor) contra local
#   make explain <ecommerce|asesor> <merchant> <lender> documenta el flujo clásico SIN ejecutar
#   make offer <merchant>                     qué lenders ofrece un comercio (GET /lenders)
#   make perfilador <merchant> <lender>       valida el motor de riesgo (perfil → ¿ofrecido?)
#   make random [N]                           N tripletas válidas al azar (smoke)
#   make get <user-request|merchant|lender> <arg>   inspector read-only
#   make list · make doctor · make clean · make help
#
# Ej: make local vtex pullman credipullman   ·   make dev vtex 638bd7f1 bancolombia rejected WEBHOOK=...
SHELL := /bin/bash
.DEFAULT_GOAL := help
LEGACY ?= $(HOME)/Desktop/CREDITOP/github/legacy-backend
GENCONTRACT ?= ../frontend-e2e/bin/gen-contract.php
COGNITO_JSON ?= ../frontend-e2e/.cognito.json
DEVTOKENS ?= ../frontend-e2e/.auth/dev-tokens.json

CMDS := local dev scenario scenarios run explain ready prep create offer perfilador random get up down list doctor clean env help
# args posicionales tras el target (hack MAKECMDGOALS): el catch-all %: de abajo los vuelve no-op.
ARGS := $(filter-out $(CMDS),$(MAKECMDGOALS))
# target del harness: local (default) | dev. Solo afecta read-only + create/clean (el resto es
# local-only por la guarda de main.go). Uso: make list TARGET=dev · make clean TARGET=dev
TARGET ?= local
# sourcea las E2E_* del perfil del target (.env.local | .env.dev) — no toca el legacy.
# El .env propio va PRIMERO y los hechos compartidos (../env/<target>.env) DESPUÉS, pero
# como `set -a` pisa, se invierte el orden de sourceo para que el propio siga ganando.
LOAD := set -a; [ -f ../env/$(TARGET).env ] && . ../env/$(TARGET).env; [ -f .env.$(TARGET) ] && . ./.env.$(TARGET); set +a
# --target=dev solo si TARGET≠local (vacío para local → no-op).
TFLAG := $(if $(filter-out local,$(TARGET)),--target=$(TARGET),)
# WEBHOOK=<url pública> → E2E_STORE_WEBHOOK_URL del webhook de tienda (p.ej. webhook.site). Necesario
# en dev (el cluster no alcanza el mock local). EXPLAIN=1 → documenta el flujo sin ejecutar.
WEBHOOKEXPORT := $(if $(WEBHOOK),export E2E_STORE_WEBHOOK_URL="$(WEBHOOK)";,)
EXPLAINFLAG := $(if $(EXPLAIN),--explain,)

.PHONY: $(CMDS)

# ─────────────────────────── entorno listo ───────────────────────────
up: ## levanta el legacy local (make -C legacy up) — NO modifica su .env
	@[ -d "$(LEGACY)" ] || { echo "✗ no encuentro legacy en $(LEGACY) (export LEGACY=...)"; exit 1; }
	@echo "▶ levantando legacy local (sin tocar su .env)…"
	@$(MAKE) -C "$(LEGACY)" up

down: ## apaga el legacy local
	@$(MAKE) -C "$(LEGACY)" down

ready: ## <ecommerce|asesor> <merchant> <lender> — MANUAL: up + siembra + asesor logueable; ecommerce imprime la URL
	@$(LOAD); origen="$(word 1,$(ARGS))"; merchant="$(word 2,$(ARGS))"; lender="$(word 3,$(ARGS))"; \
	[ -n "$$origen" ] && [ -n "$$merchant" ] && [ -n "$$lender" ] || { echo "uso: make ready <ecommerce|asesor> <merchant> <lender>"; echo "ej:  make ready ecommerce pullman credipullman"; exit 2; }; \
	case "$$origen" in ecommerce|web) ecom="--ecommerce";; *) ecom="";; esac; \
	sub=$$(python3 -c "import json,base64; t=json.load(open('$(DEVTOKENS)'))['id_token']; p=t.split('.')[1]; print(json.loads(base64.urlsafe_b64decode(p+'='*(-len(p)%4)))['sub'])" 2>/dev/null || true); \
	cogflag=""; [ -n "$$sub" ] && cogflag="--cognito-id=$$sub"; \
	echo "▶ up legacy"; $(MAKE) --no-print-directory -C "$(LEGACY)" up >/dev/null 2>&1 || $(MAKE) -C "$(LEGACY)" up; \
	echo "▶ prep $$merchant × $$lender $$ecom $$cogflag"; \
	prep_out=$$(go run . prep --merchant "$$merchant" --lender "$$lender" $$ecom $$cogflag) || { echo "✗ prep falló"; exit 1; }; \
	eval "$$prep_out"; \
	echo; echo "✅ entorno listo · hash=$$E2E_PARTNER_HASH"; \
	if [ -n "$$ecom" ]; then \
		url=$$(php "$(GENCONTRACT)" "$$E2E_PARTNER_HASH" 2>/dev/null); \
		if [ -n "$$url" ]; then echo; echo "🌐 URL DEL WIZARD (frontend-monorepo → legacy local · pegá en el navegador):"; echo "   $$url"; \
		else echo "⚠ no pude generar la URL (¿php / $(GENCONTRACT)?)"; fi; \
	fi; \
	if [ -n "$$sub" ] && [ -f "$(COGNITO_JSON)" ]; then \
		u=$$(python3 -c "import json;print(json.load(open('$(COGNITO_JSON)')).get('user',''))" 2>/dev/null); \
		pw=$$(python3 -c "import json;print(json.load(open('$(COGNITO_JSON)')).get('pass',''))" 2>/dev/null); \
		echo; echo "🔑 LOGIN ASESOR (hub Cognito → quedás como asesor Comercial de $$merchant):"; \
		echo "   Hub:  https://login.creditop.com"; echo "   User: $$u"; echo "   Pass: $$pw"; \
	else \
		echo; echo "ℹ️  asesor Cognito no asociado (sin sub). Capturalo: frontend-e2e → npx playwright test dev/cognito-login.spec.ts --headed"; \
	fi; \
	echo; echo "   (el wizard debe estar en :5174 — frontend-e2e: make wizard)"

prep: ## <merchant> <lender> — siembra precondicionales (deja un user_request listo)
	@m="$(word 1,$(ARGS))"; l="$(word 2,$(ARGS))"; \
	[ -n "$$m" ] && [ -n "$$l" ] || { echo "uso: make prep <merchant> <lender>"; exit 2; }; \
	$(LOAD); go run . prep --merchant "$$m" --lender "$$l"

create: ## <role> <merchant> — crea un asesor de prueba (namespaced por SEED)
	@r="$(word 1,$(ARGS))"; m="$(word 2,$(ARGS))"; \
	[ -n "$$r" ] && [ -n "$$m" ] || { echo "uso: make create <role> <merchant>"; exit 2; }; \
	$(LOAD); go run . create "$$r" "$$m" $(TFLAG)

env: ## muestra la config activa (modo · DB · URL · health :80)
	@$(LOAD); \
	echo "harness: local (127.0.0.1:80 hardcodeado; .env.local aporta E2E_*)"; \
	echo "SEED=$${SEED:-<no set>}"; \
	echo "legacy: $(LEGACY)"; \
	code=$$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: legacy-backend.inertia-develop' --max-time 5 http://127.0.0.1:80/api 2>/dev/null); \
	case "$$code" in 2*|3*|4*) echo "backend :80 → HTTP $$code (arriba)";; *) echo "backend :80 → HTTP $${code:-000} (no responde — make up)";; esac

# ─────────────────────────── pruebas rápidas ───────────────────────────
run: ## <ecommerce|asesor> <merchant> <lender> — prep (siembra) + flujo clásico (web/asesor) contra el legacy LOCAL
	@$(LOAD); origen="$(word 1,$(ARGS))"; merchant="$(word 2,$(ARGS))"; lender="$(word 3,$(ARGS))"; \
	[ -n "$$origen" ] && [ -n "$$merchant" ] && [ -n "$$lender" ] || { echo "uso: make run <ecommerce|asesor> <merchant> <lender>"; echo "ej:  make run ecommerce pullman credipullman   ·   make run asesor alkosto 160"; exit 2; }; \
	case "$$origen" in ecommerce|web) ch=web;; asesor) ch=asesor;; *) echo "✗ origen '$$origen' inválido (ecommerce|asesor)"; exit 2;; esac; \
	echo "▶ prep $$merchant × $$lender (siembra precondicionales)…"; \
	prep_out=$$(go run . prep --merchant "$$merchant" --lender "$$lender") || { echo "✗ prep falló"; exit 1; }; \
	eval "$$prep_out"; \
	[ -n "$$E2E_PARTNER_HASH" ] && [ -n "$$E2E_LENDER_ID" ] || { echo "✗ prep no devolvió E2E_PARTNER_HASH/E2E_LENDER_ID"; exit 1; }; \
	echo "▶ go run . $$ch $$E2E_PARTNER_HASH $$E2E_LENDER_ID   (hash sembrado · legacy local)"; \
	go run . "$$ch" "$$E2E_PARTNER_HASH" "$$E2E_LENDER_ID"

explain: ## <ecommerce|asesor> <merchant> <lender> — documenta el flujo clásico SIN ejecutar (no toca el backend)
	@origen="$(word 1,$(ARGS))"; merchant="$(word 2,$(ARGS))"; lender="$(word 3,$(ARGS))"; \
	[ -n "$$origen" ] && [ -n "$$merchant" ] && [ -n "$$lender" ] || { echo "uso: make explain <ecommerce|asesor> <merchant> <lender>"; exit 2; }; \
	case "$$origen" in ecommerce|web) ch=web;; asesor) ch=asesor;; *) echo "✗ origen inválido (ecommerce|asesor)"; exit 2;; esac; \
	go run . --explain "$$ch" "$$merchant" "$$lender"

local: ## <ecommerce> <merchant> <lender> [state] — flujo ecommerce unificado contra el legacy LOCAL
	@e="$(word 1,$(ARGS))"; m="$(word 2,$(ARGS))"; l="$(word 3,$(ARGS))"; s="$(word 4,$(ARGS))"; \
	[ -n "$$e" ] && [ -n "$$m" ] && [ -n "$$l" ] || { echo "uso: make local <ecommerce> <merchant> <lender> [state]"; echo "ej:  make local vtex pullman credipullman   ·   make local vtex pullman bancolombia rejected"; exit 2; }; \
	set -a; [ -f .env.local ] && . ./.env.local; set +a; \
	go run . $(EXPLAINFLAG) flow "$$e" "$$m" "$$l" $$s

dev: ## <ecommerce> <merchant> <lender> [state] — flujo unificado contra DEV (WEBHOOK=https://webhook.site/... para ver el payload)
	@e="$(word 1,$(ARGS))"; m="$(word 2,$(ARGS))"; l="$(word 3,$(ARGS))"; s="$(word 4,$(ARGS))"; \
	[ -n "$$e" ] && [ -n "$$m" ] && [ -n "$$l" ] || { echo "uso: make dev <ecommerce> <merchant> <lender> [state]  WEBHOOK=https://webhook.site/..."; echo "ej:  make dev vtex 638bd7f1 bancolombia rejected WEBHOOK=\$$WH"; exit 2; }; \
	set -a; [ -f .env.dev ] && . ./.env.dev; set +a; \
	$(WEBHOOKEXPORT) go run . $(EXPLAINFLAG) flow "$$e" "$$m" "$$l" $$s --target=dev

scenario: ## <name> — corre un scenario nombrado de presets.json (sourcea el .env del entorno solo)
	@n="$(word 1,$(ARGS))"; \
	[ -n "$$n" ] || { echo "uso: make scenario <name>   ·   make scenarios (lista los disponibles)"; exit 2; }; \
	env=$$(python3 -c "import json; print(json.load(open('presets.json'))['scenarios'].get('$$n',{}).get('env',''))" 2>/dev/null); \
	[ -n "$$env" ] || { echo "✗ scenario '$$n' no existe — make scenarios"; exit 2; }; \
	set -a; [ -f .env.$$env ] && . ./.env.$$env; set +a; \
	go run . $(EXPLAINFLAG) scenario "$$n"

scenarios: ## lista los scenarios disponibles (presets.json)
	@go run . scenarios

offer: ## <merchant> — qué lenders ofrece un comercio (GET /lenders)
	@m="$(word 1,$(ARGS))"; [ -n "$$m" ] || { echo "uso: make offer <merchant>"; exit 2; }; \
	$(LOAD); go run . offer "$$m"

perfilador: ## <merchant> <lender> — valida el motor de riesgo (perfil → ¿ofrecido?)
	@m="$(word 1,$(ARGS))"; l="$(word 2,$(ARGS))"; \
	[ -n "$$m" ] && [ -n "$$l" ] || { echo "uso: make perfilador <merchant> <lender>"; exit 2; }; \
	$(LOAD); go run . perfilador "$$m" "$$l"

random: ## [N] — N tripletas válidas al azar (smoke; default 5)
	@$(LOAD); go run . random $(word 1,$(ARGS))

get: ## <user-request|merchant|lender> <arg> — inspector read-only
	@k="$(word 1,$(ARGS))"; a="$(word 2,$(ARGS))"; \
	[ -n "$$k" ] && [ -n "$$a" ] || { echo "uso: make get <user-request|merchant|lender> <arg>"; exit 2; }; \
	$(LOAD); go run . get "$$k" "$$a" $(TFLAG)

list: ## lista comercios y lenders (BD local; TARGET=dev para dev)
	@$(LOAD); go run . list $(TFLAG)

doctor: ## diagnóstico del setup (8 checks; TARGET=dev para dev)
	@$(LOAD); go run . doctor $(TFLAG)

clean: ## borra el namespace del seed (uno a uno, nunca bulk; TARGET=dev exige I_KNOW de .env.dev)
	@$(LOAD); go run . clean $(TFLAG)

help: ## muestra esta ayuda
	@echo "backend-e2e · atajos make (pruebas rápidas + entorno listo · legacy LOCAL)"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "}{printf "  make %-12s %s\n", $$1, $$2}'
	@echo
	@echo "  ej:  make local vtex pullman credipullman                              (flujo unificado · local)"
	@echo "       make dev   vtex 638bd7f1 bancolombia rejected WEBHOOK=https://webhook.site/...   (dev)"
	@echo "       make ready ecommerce pullman credipullman                         (deja el entorno listo)"

# catch-all: vuelve no-op los args posicionales (local, ecommerce, pullman, …). Los targets
# reales de arriba tienen prioridad sobre este patrón.
%:
	@:
