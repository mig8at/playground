# Architecture · contexto
> **estado:** al día con main · Vista de ALTO NIVEL de los repos de CreditOp: application (VIVO/default) + legacy-backend (strangler, parallel-run) + frontend-monorepo (wizard) + ms-preapprovals (Go rt=1), sobre una BD compartida.

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
Índice de alto nivel de cómo está construido el ecosistema de CreditOp. La misma originación de crédito vive repartida (y a menudo **duplicada**) en varios repos, así que antes de leer cualquier flujo conviene saber quién corre en prod, quién es reescritura y quién decide qué. Contexto BASE: clave para casi cualquier tarea.

El hecho estructural central es el **strangler / parallel-run**: mucha lógica existe **dos veces** (application VIVO ↔ legacy reescrito), sobre la **misma base de datos**. Salvo indicación, **application es el que corre**.

## Contenido
Los repos que trazó el mapa del flujo (MAP.md §0):

| Repo | Qué es | Estado |
|---|---|---|
| **application** | Monolito Laravel/Inertia (Aliados). | **VIVO / default** (lo que corre en prod hoy) |
| **legacy-backend** | Reescritura Laravel Modules (strangler). | *parallel-run*; default solo en piezas ya migradas |
| **frontend-monorepo** | Monorepo del wizard (React Router / Vue). | Cliente HTTP; consume legacy + el MS Go |
| **pre-approvals-service** | MS Go hexagonal; resuelve pre-aprobación **rt=1** para el wizard nuevo. | Vivo para el path nuevo |
| **microservices** | MS Go greenfield (kyc-gateway, customer-service…). | Mayormente sin consumidores (greenfield) |

**Piezas ya migradas a legacy (default):** envío de OTP, el endpoint de cupo rt=2 (`/available-quota`), y la KYC V2 de Credifamilia. Todo lo demás sigue resolviéndose en application.

**El eje que decide TODO** (`response_type`, no existe columna `product_type`):

| rt | Nombre | Quién decide el crédito | Inyectable local |
|---|---|---|---|
| **0** | url_utm / redirect | Nadie (redirige a la web del lender) | n/a |
| **1** | Integración / agregador | API externa del lender (Welli, Bancolombia, Meddipay…) | ❌ No (decisión fuera) |
| **2** | CreditopX in-platform | CreditOp (motor de categorías local) | ✅ Sí |
| **3** | Rotativo (revolving) | CreditOp (cupo rotativo local) | ✅ Sí |

## Subcontextos
- **frontend-monorepo** — el front (wizard React Router/Vue). NO toca la BD; cliente HTTP puro.
- **legacy-backend** — el backend refactor (Laravel modular). Destino de la migración; reconstruyó el núcleo CreditopX.
- **application** — el monolito viejo (Aliados). Runtime por defecto; aloja alta de entidades, panel admin y todo el servicing.
- **ms-preapprovals** — microservicio Go de pre-aprobación (rt=1) para el wizard nuevo.

## Dónde mirar
Rutas raíz de cada repo (MAP.md §0):
- **application** (VIVO): `/Users/miguelochoa/Desktop/CREDITOP/bitbucket/application`
- **legacy-backend** (strangler): `/Users/miguelochoa/Desktop/CREDITOP/github/legacy-backend`
- **pre-approvals-service** (Go, rt=1): `/Users/miguelochoa/Desktop/CREDITOP/github/pre-approvals-service`
- **frontend-monorepo** (wizard): `/Users/miguelochoa/Desktop/CREDITOP/github/frontend-monorepo`
- **microservices** (greenfield): `/Users/miguelochoa/Desktop/CREDITOP/github/microservices`

El índice maestro de archivos por repo está en MAP.md Apéndice C; cada subcontexto trae su propia superficie.

## Gotchas / riesgos
- **Deriva**: dos copias (application ↔ legacy) sobre la misma BD que pueden divergir. El mapa lo señala en cada etapa (p.ej. Welli id 166 solo existe en application; en legacy/MS es 23/141/142).
- **`product_type` es fantasma**: no existe columna; el "tipo de producto" se modela con `response_type` + `path_id`.
- **HARDCODE Credifamilia (id 24)**: el accessor del modelo `Lender` fuerza rt=1 en todo el flujo, ignorando la BD.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (MAP.md §0: tabla de Repos + strangler/parallel-run + tabla response_type; Apéndice C índice por repo).

## Enlaces
- Raíz: **CreditOp**. Mapa: playground/flow/MAP.md §0. Simulador: playground/flow.
