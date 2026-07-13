# Creditop · Playground

Sandbox local de herramientas, harness E2E, investigación y prototipos del usuario.
**Repo local; no se pushea.**

> ⚠️ **Antes de tocar nada — leé [`docs/operacion/CONVENCIONES.md`](docs/operacion/CONVENCIONES.md).**
> Hay reglas estrictas sobre dónde se guardan los cambios según el repo (playground
> vs. legacy-backend / frontend-monorepo / application). Romperlas contamina prod o
> pierde trabajo local.

## TL;DR de la regla

| Estás escribiendo en… | Política |
|---|---|
| `playground/*` (este repo) | ✅ commit local · ❌ no push |
| `github/legacy-backend`, `github/frontend-monorepo`, `bitbucket/application` | ✅ stash o rama local · ❌ no commit a `main` · ❌ no PR sin pedir |

Las pruebas locales usan **mocks/fakes** del backend + **BD local** (mirror del dump
de dev). Nunca se apunta a `dev` (RDS remota) por defecto. Detalle completo en
[`docs/operacion/CONVENCIONES.md`](docs/operacion/CONVENCIONES.md).

## Proyectos

| Proyecto | Qué es | Documentación |
|---|---|---|
| **[backend-e2e/](backend-e2e/)** | Harness Go que ejerce los flujos de originación contra `legacy-backend` en modo mock. CLI `[canal] → [comercio] → [lender]` + subcomandos de operación: `prep` (siembra precondicionales), `get` (inspector read-only), `doctor` (diagnóstico), `clean`. | [`README`](backend-e2e/README.md), [`SUITE`](backend-e2e/SUITE.md), [`VALIDATION`](backend-e2e/VALIDATION.md) |
| **[frontend-e2e/](frontend-e2e/)** | Suite Playwright del onboarding contra el stack local + UI del wizard. | [`README`](frontend-e2e/README.md), [`VALIDATION`](frontend-e2e/VALIDATION.md), [`PLAN-PRUEBAS`](frontend-e2e/PLAN-PRUEBAS.md) |
| **[backend-mcp/](backend-mcp/)** | Servidor MCP de utilidades contra el backend/BD local (synth, inject, assign, diagnósticos). | — |
| **[flow/](flow/)** | **Simulador Vue Flow de onboarding** (comercio → solicitud → burós → perfil → entidades) con catálogo CreditopX, política por niveles y herencia con override. `npm run dev` → :5190. | [`docs/negocio/SIMULADOR-REGLAS-NEGOCIO.md`](docs/negocio/SIMULADOR-REGLAS-NEGOCIO.md) |
| **[merchant-config/](merchant-config/)** | Prototipos HTML de la ficha comercio / niveles / consola admin (plan Motai §10). | [`README`](merchant-config/README.md) |
| **[domain-model/](domain-model/)** | Visualizador Vue del modelo de dominio "deber-ser" (105 entidades, 75 VOs). | [`README`](domain-model/README.md), [`audit/`](domain-model/docs/audit/) |
| **[simulador-filtros/](simulador-filtros/)** | Simulador Vue Flow de filtros comercio↔lender (demo educativa, no fiel a realidad). | [`README`](simulador-filtros/README.md) |
| **[validator/](validator/)** | Generador de carga Go para microservicios. | [`README`](validator/README.md) |
| **[docs/](docs/)** | **Docs maestros**, organizados por intención (codigo/ negocio/ mejoras/ vision/ operacion/). Empieza por [`docs/CREDITOP.md`](docs/CREDITOP.md). |

## Docs maestros (negocio + arquitectura)

Conocimiento de dominio compartido. La carpeta separa **intenciones**: [`codigo/`](docs/codigo/) = la realidad
verificada · [`negocio/`](docs/negocio/) = lenguaje de negocio · [`mejoras/`](docs/mejoras/) = planes accionables ·
[`vision/`](docs/vision/) = el modelo a futuro · [`operacion/`](docs/operacion/) = cómo trabajar acá.
Índice canónico: [`docs/CREDITOP.md`](docs/CREDITOP.md) §12. Lectura recomendada:

1. [`docs/CREDITOP.md`](docs/CREDITOP.md) — qué es Creditop, los 4 ejes, `response_type`, ciclo de vida, **índice canónico**.
2. [`docs/codigo/MECANICA-CREDITO.md`](docs/codigo/MECANICA-CREDITO.md) — mecánica financiera + operación de cartera.
3. [`docs/codigo/MODELO-DATOS.md`](docs/codigo/MODELO-DATOS.md) — tablas y relaciones reales.
4. [`docs/codigo/LOGICA-QUEMADA.md`](docs/codigo/LOGICA-QUEMADA.md) — catálogo de hardcodes.
5. [`docs/codigo/REFERENCIA-FLUJOS.md`](docs/codigo/REFERENCIA-FLUJOS.md) — mecánica por flujo (cita archivo:línea).
6. [`docs/codigo/MAPA-FLUJOS.md`](docs/codigo/MAPA-FLUJOS.md) — encadenamiento FE↔BE.
7. [`docs/codigo/CASOS-ESPECIALES.md`](docs/codigo/CASOS-ESPECIALES.md) — clasificación de fallos del harness.
8. [`docs/operacion/HARNESS-ARQUITECTURA.md`](docs/operacion/HARNESS-ARQUITECTURA.md) — composer + estrategias en backend-e2e y frontend-e2e.
9. **[`docs/operacion/CONVENCIONES.md`](docs/operacion/CONVENCIONES.md) — REGLAS DE OPERACIÓN (esto)**.

## Stack local típico

```bash
# 1. Levantar el backend en modo mock (recursos externos en fake)
cd ~/Desktop/CREDITOP/github/legacy-backend
git stash apply           # bypasses del backend (NO commitear)
make up && make mock-all && make restart
# → API en http://localhost (vhost legacy-backend.inertia-develop)

# 2. (Si se necesita UI) levantar el wizard
cd ~/Desktop/CREDITOP/github/frontend-monorepo
git stash apply           # data-testids + lender-action (NO commitear)
cd apps/loan-request-wizard
pnpm dev                  # → http://localhost:5174

# 3. Correr el harness que corresponda
cd ~/Desktop/CREDITOP/playground/backend-e2e
go run . asesor pullman credipullman       # backend E2E (Go)

cd ~/Desktop/CREDITOP/playground/frontend-e2e
npm run e2e -- channel=asesor merchant=pullman lender=credipullman   # frontend E2E (Playwright)
```

## Antes del primer commit en una sesión nueva

```bash
# verificar en qué repo estás antes de cualquier git add
pwd
git remote -v

# si es playground/* → commit local OK
# si es legacy-backend / frontend-monorepo / application → STASH, no commit
```
