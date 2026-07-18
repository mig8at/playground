# MotaiX · contexto
> **estado:** al día con main · Flujo Motai (comercio 158, in-platform rt=2): 3 productos CreditopX (crédito/renting/RTO) + Ábaco como "Información complementaria" (ingreso gig informativo).

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
El flujo **Motai** — un comercio aliado (id 158) que origina in-platform (rt=2 CreditopX). En el simulador, **Motai es el comercio seed** (`merchant.nombre = 'Motai'`, sucursal `PRINCIPAL`), y trae dos rasgos distintivos: sus **3 productos CreditopX** (compra financiada / renting / rent-to-own) y el flag de **Ábaco** por entidad (ingreso gig como *información complementaria* tras elegir). Apunta a población gig/migrante (PEP = Permiso Especial de Permanencia) sin historial de buró tradicional.

## Contenido
**Override de la calculadora por comercio** (`merchantCalc['Motai']`, ejemplo real del panel — aliado Motai/Sonría): **cuota inicial 30%**, **cargo fijo 400.000**; no overridea `montoMax` → hereda el máx del rango de la entidad (`credit_line_by_lenders.max_amount`).

**3 productos CreditopX** (plantillas semilla de "Agregar entidad", `CREDITOPX_PRODUCTS`; son defaults de arranque, no un motor):
- **Compra financiada** (crédito) — tasa 2.2%, plazo máx 24, monto máx 3M; sube score mín a 500 y cuota inicial a 15%.
- **Renting operativo** (arrendamiento) — tasa 1.8%, plazo máx 36, monto máx 4M; **sin buró duro** (`acceptThinFile`), exige ingreso ≥ 1M, inicial 0.
- **Rent-to-Own** (arrendamiento con compra) — tasa 2.0%, plazo máx 48, monto máx 5M; hereda score/doc/inicial, agrega ingreso mín 1.2M.

En el nodo *Estado en sucursal* los productos se etiquetan Crédito / Renting / Renting con compra.

**Ábaco = "Información complementaria"** (flag por entidad `abacoExtra` / `setEntidadAbaco`): si la entidad elegida lo activa, tras la selección aparece el nodo *Información complementaria* que pide el **ingreso EXTRA gig** (Rappi/DiDi/Uber) que Ábaco valida entrando con las credenciales del cliente. Ese ingreso **se SUMA al ingreso base** (ya NO está en la cascada de ingreso) y es **INFORMATIVO**: no cambia el cupo, la cuota ni la decisión — fiel al legacy, donde el resultado de Ábaco no está cableado. Ábaco es proveedor EXTERNO (CreditOp solo consume su API).

## Dónde mirar
El flujo rt=2 de Motai comparte la mecánica de consolidación de CreditopX (MAP.md §S5): orquestador `[application] LenderRetrievalService.php:73 getLenders` → categoría/tramo (`:650 processRevolvingAndCreditopXLenders`); cupo autoritativo `[legacy] CreditopXQuotaController.php:66 getAvailableQuota`. La copia de reglas por sucursal (§S2) es la del padre **Merchants**.
> El id 158, los "modos del comercio" y el detalle de des-motaización no salen del simulador flow (vienen del análisis de negocio/PRD); flow modela Motai como el comercio seed con producto + Ábaco. Superficie de código específica a linkar en la fase de data.

## Gotchas / riesgos
- **Ábaco no decide**: el ingreso extra es informativo (no toca cupo/cuota/decisión), fiel al legacy donde el resultado no está cableado.
- **PEP migratorio ≠ PEP AML**: aquí PEP = Permiso Especial de Permanencia (población gig/migrante); en el AML de TusDatos "PEP" = Persona Expuesta Políticamente.
- El renting/RTO "real" se gatea por **modo del comercio + path**, no por una columna de producto (`product_type` es fantasma) — dato del análisis de código, no modelado en flow.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (store `merchant`/`merchantCalc`/`CREDITOPX_PRODUCTS`, nodo IngresosExtrasNode "Información complementaria", fieldDocs `node.ingresosextras`/`ent.abaco`/`buro.abacoIncome`) + MAP.md §S5 para el cascade rt=2.

## Enlaces
- Padre: **Merchants**. Simulador: playground/flow (comercio seed "Motai", nodos Configurar entidad → Información complementaria). Mapa: playground/flow/MAP.md §S5.
