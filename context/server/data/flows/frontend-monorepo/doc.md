# frontend-monorepo · contexto
> **estado:** al día con main · Monorepo del wizard de originación (React Router / Vue). Cliente HTTP puro: no toca la BD, consume legacy + el MS Go, y "streamea" las pre-aprobaciones lender-a-lender.

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
Monorepo del wizard de originación (React Router / Vue, con SSR). No decide crédito: es **cliente HTTP puro** — captura el monto, pide el formulario dinámico, dispara el listado y resuelve las pre-aprobaciones. No toca la base de datos.

Lo distintivo es que **el wizard nuevo NO pasa por el PHP** de application/legacy para la pre-aprobación rt=1: su loader consume **directamente el MS Go** (`pre-approvals-service`). Y el "streaming" del listado (`lenders-v2`) no es SSE: lo simula el loader del front resolviendo cada card lender-a-lender.

## Contenido
Piezas del flujo que resuelve el front (MAP.md S3/S6):

- **Captura de monto (S3)** — `request-amount.tsx:200`. El monto viaja al backend (que crea la UR al validar OTP, no acá).
- **Formulario dinámico (S3)** — `personal-info-config.repository.ts:14` pide la config del form; `partner-info`/`phone-number`/`phone-otp` repositories manejan el alta+OTP.
- **Disparo del listado (S3)** — `loan-options.repository.ts:25` (timeout 60s) llama `lenders-v2` (JSON síncrono).
- **Fan-out de pre-aprobación rt=1 (S6, camino B)** — `available-lenders.tsx`: `:120` endpoint, `:158` elegibles (rt≠0), `:182` fetch, `:672` `Await`; el loop de resolución lender-a-lender está en `:103-131`.
- **Payload + POST al MS Go** — `fetch-lender-preapproval.ts`: `:146` product key, `:152` payload, `:171` POST a `/v1/preapprovals/check`, `:261/:264` polling de Credifamilia.
- **Entidad de resolución** — `lender-resolution.entity.ts` normaliza approved/rejected/pending.

## Dónde mirar
**frontend-monorepo** (índice maestro, MAP.md Apéndice C):
- **Rutas** (`apps/loan-request-wizard/app/routes/`): `dynamic/request-amount.tsx:200` · `lenders-marketplace/available-lenders.tsx:120` (fan-out + streaming) · `.../lenders/preapproval-retry.tsx`
- **Módulos** (`modules/loan-request-wizard/`):
  - `loan-application-form/.../infrastructure/{partner-info,phone-number,phone-otp}.repository.ts`
  - `lenders-marketplace/.../infrastructure/repositories/loan-options.repository.ts:25` (timeout 60s)
  - `lenders-marketplace/.../infrastructure/adapters/fetch-lender-preapproval.ts:146/152/171/261/264`
  - `lenders-marketplace/.../domain/entities/lender-resolution.entity.ts`
- Config del form dinámico: `.../personal-info-config/infrastructure/personal-info-config.repository.ts:14`

Base URL del backend: `VITE_API_URL` (legacy) · del MS de pre-aprobación: `VITE_PREAPPROVALS_ENDPOINT`.

## Gotchas / riesgos
- **`lenders-v2` NO es SSE**: el "streaming" lo hace el loader del front resolviendo pre-aprobaciones lender-a-lender (`available-lenders.tsx:103-131`).
- **El front nuevo consume el MS Go directamente** (no pasa por el `PreApprovedLenderService` PHP, que es el path viejo).
- **Race Credifamilia**: el timeout del front (40s) es **mayor** al write_timeout del MS (30s) a propósito (abortar duplicaba transacciones).
- **Código muerto en el front**: la rama `frontend_response` y el campo `encrypt_code` no tienen backend que los produzca (el MS solo emite approved/rejected/pending).

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (MAP.md §0 tabla Repos + Apéndice C índice frontend + S3/S6 camino B).

## Enlaces
- Padre: **Architecture**. Mapa: playground/flow/MAP.md §0/S3/S6/Apéndice C. Simulador: playground/flow.
