# 📐 Convenciones operativas del playground

> **Regla de oro**: cómo se guardan los cambios según el repo en el que estés.
> Esta convención **aplica a todas las herramientas del playground** y **a cualquier sesión
> de trabajo** (Claude Code, otro asistente, humano sólo). Romper esta regla es contaminar
> el repo de prod o perder trabajo local — no hay segunda oportunidad.

---

## 1. La frontera

Trabajamos contra **dos universos** de repos. La regla cambia según en cuál estás.

### A · `~/Desktop/CREDITOP/playground/*` — el sandbox

Proyectos: `backend-e2e/`, `frontend-e2e/`, `flows/`, `domain-model/`,
`simulador-filtros/`, `validator/`, `docs/`.

- ✅ **Commit local** (git commit normal).
- ❌ **NO se pushea**. Algunos no tienen remote; otros lo tienen pero la política es no push.
- ✅ Estos commits **son la fuente de verdad del trabajo** del sandbox — quedan en el historial
  local de `playground` (un solo repo git que abarca todos los subproyectos).
- ✅ Si descubrís un hallazgo nuevo, **documentalo en `docs/`** (CASOS-ESPECIALES, LOGICA-QUEMADA,
  HARNESS-ARQUITECTURA, REFERENCIA-FLUJOS, etc., según el dueño) y commiteá local.

### B · Repos reales de producción

Proyectos: `~/Desktop/CREDITOP/github/legacy-backend/`,
`~/Desktop/CREDITOP/github/frontend-monorepo/`, `~/Desktop/CREDITOP/bitbucket/application/`.

- ❌ **NO commitear a `main`** desde el flujo del playground.
- ❌ **NO armar PRs automáticamente** ni proponer pushear cambios al equipo sin pedir.
- ✅ Los cambios necesarios para **pruebas locales rápidas** viven en:
  - **`git stash`** (típicamente `stash@{0}` con el paquete de bypasses) o
  - **ramas locales** dedicadas que no se pushean (`test`, `mock-onboarding`).
- ✅ El **conocimiento** de qué cambia cada stash/rama vive en docs del playground
  (`docs/hallazgos-backend.md`, `frontend-e2e/VALIDATION.md`, etc.).

**La decisión de abrir una PR al equipo es manual, del usuario, fuera de este workflow.**
Si encontrás un bug real (afecta prod), catalogalo en docs; no abras PR sin pedir.

---

## 2. Patrones aceptados para pruebas locales

Esta es la **lista corta** de mecanismos legítimos para correr los flujos sin depender de
servicios externos / ambientes compartidos. Todos viven en stash / ramas locales / configs
locales — nunca en `main` de los repos reales.

### 2.1 · Mocks y fakes del backend

- **Modo mock del legacy-backend**: `cd github/legacy-backend && make up && make mock-all && make restart`.
  Activa drivers fake (`ONBOARDING_DRIVER_*=fake`, `EXPERIAN_DRIVER=fake`, etc.) y permite el
  header `X-Fake-Scenario` para inyectar escenarios (`success`, `invalid-code`, `issue-date-mismatch`, …).
  Detalle en `github/legacy-backend/docs/local-dev.md`.
- **Stash con bypasses** del propio backend (legacy-backend `stash@{0}` "bypasses completos"):
  guards `if (app()->environment('local','development'))` que evitan Twilio, S3, Wompi, etc.
  Aplicar con `git stash apply` cuando se necesite; nunca commitear.

### 2.2 · BD local (mirror de dev)

- **MySQL del legacy-backend**: contenedor `legacy-backend-mysql-1` (MySQL 8.0.35, :3306).
  Esquema `creditop`, idéntico a dev (212 tablas + 26 vistas + 42 rutinas). Datos vienen de
  un dump de `inertia-dev`.
- **Refresco dump→local**: `cd ~/Desktop/CREDITOP/db-dump && bash dump-dev.sh && bash import-local.sh`
  (read-only desde RDS dev; nunca push).
- ✅ **Para sembrar precondicionales** (lender_users_categories, permisos granulares,
  lender_allied_credentials faltantes, etc.): INSERT directo a la BD local con
  `backend-e2e: go run . prep --merchant X --lender Y`. Idempotente, namespaced por seed
  (limpieza con `go run . clean`).

### 2.3 · Frontend testids

- Stash del `frontend-monorepo` (`stash@{0}` "data-testid flujo completo + lender-action,
  fix lenderData.id") agrega los `data-testid` que `frontend-e2e` necesita y que el equipo
  todavía no ha mergeado.
- Reiniciar el wizard si se aplican (HMR de paquete workspace).

### 2.4 · `.env.local` del wizard

Variables como `VITE_API_URL=http://localhost` y `VITE_ONBOARDING_FORM_SERVICE=http://localhost/api/forms-fake`
viven en `.env.local` del proyecto del frontend-monorepo, **gitignored**, jamás commitear.

---

## 3. Anti-patrones (NO hacer)

1. ❌ **Abrir PR a `main` de legacy-backend/frontend-monorepo/application sin pedir explícitamente.**
   Aunque el fix sea trivial y obvio, la decisión es del usuario.
2. ❌ **Commitear `.env.local`, `.cognito.json`, `db-dump/`** o cualquier credencial en cualquier repo.
   Verificar `.gitignore` antes de `git add -A`.
3. ❌ **Mezclar bypasses locales con código de prod** en un mismo commit/PR.
4. ❌ **Apuntar a `dev` (RDS remota) desde un CLI sin guard explícito**. Si en algún momento se habilita,
   por defecto solo READ; WRITE requiere flag intencional (`I_KNOW_THIS_TOUCHES_SHARED_DEV=1`).
5. ❌ **Asumir que un cambio en el playground se "comparte"** — no se pushea, queda solo en la máquina.

---

## 4. Antes de empezar (checklist para cualquier nuevo chat / sesión)

- [ ] ¿En qué repo estoy escribiendo el cambio? Verificar con `pwd` + `git remote -v`.
- [ ] Si es `playground/*`: commit local OK; no push.
- [ ] Si es `legacy-backend` / `frontend-monorepo` / `application`: NO commitear a `main`. Usar stash o rama local.
- [ ] ¿Estoy a punto de proponer una PR? **Preguntar al usuario** antes de armarla.
- [ ] ¿El cambio toca credenciales / `.env` / claves? Verificar `.gitignore` antes.
- [ ] ¿Estoy a punto de apuntar a un ambiente compartido (dev RDS / dev API)? **Por defecto, no**; usar local con mocks.

---

## 5. Mini-glosario

- **Playground**: `~/Desktop/CREDITOP/playground/` — un único repo git que contiene todos los subproyectos
  de investigación/pruebas/herramientas del usuario.
- **Repos reales**: `~/Desktop/CREDITOP/github/legacy-backend/`, `github/frontend-monorepo/`,
  `bitbucket/application/` — repos de producción del equipo de Creditop, con remotes activos
  y reviewers humanos.
- **Stash**: `git stash` — área local de cambios pendientes que no son commit. Es donde viven los
  bypasses/fakes/testids que sirven para pruebas locales pero no van a prod.
- **Rama local `test`** (de un repo real): rama derivada de la base de desarrollo que acumula fixes
  + guards de andamiaje. **No se pushea.** Sirve para correr los flujos completos contra el stack
  local. Si un fix de esa rama también vale para prod, se cataloga en docs del playground; la PR
  real es decisión aparte.

---

## 6. Por qué esta convención existe

El usuario trabaja en un sandbox propio para investigar y experimentar contra Creditop SIN ensuciar
los repos del equipo. La frontera entre "código de prod" y "andamiaje de pruebas" es la diferencia
entre un PR sensible para reviewers ocupados y un set de fixes/guards/mocks que sólo viven en local.

Mezclar ambos lados:

- Contamina prod con código que no debe ir (drivers fake, guards de entorno, IDs hardcodeados).
- Convierte cada hallazgo del sandbox en una propuesta de PR sin proceso de discusión.
- Pierde la separación que hace que el sandbox sea ágil.

Mantener la convención mantiene viva la velocidad del playground.

---

**Última revisión:** 2026-06-05.
**Aplicación**: cualquier sesión de trabajo en `~/Desktop/CREDITOP/playground/`, incluyendo asistentes
automatizados (Claude Code, etc.) y manual.
