# SmartPay · contexto
> **estado:** al día con main · Canal in-platform (rt=2) con path IMEI: el celular como garantía, salta el AML de TusDatos, bloqueo por MDM (device-lock).

<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
**SmartPay** = canal in-platform (rt=2 CreditopX) cuyo producto es un **crédito para celular con el propio celular como garantía**, distinguido por un **path IMEI** y por el bloqueo remoto del dispositivo (MDM device-lock) ante impago. En el simulador `flow` no hay un nodo dedicado a SmartPay: aparece como **caveats del canal** dentro de otros nodos (producto y buró), porque su particularidad no es una columna de config sino cómo el flujo rt=2 se ramifica por *path* y qué pasos de KYC salta.

## Contenido
Lo que el simulador `flow` fija sobre SmartPay (verificado en fieldDocs.js):
- **Path IMEI, no columna de producto**: `product_type` es fantasma; el "tipo de producto" se modela con `response_type` + `path_id`, y **el path IMEI es el ejemplo canónico**. El celular (identificado por IMEI) es la garantía del crédito.
- **Salta el AML de TusDatos**: SmartPay, como canal, **NO corre el AML de TusDatos** y usa un mailer propio. (Contrasta con el flujo estándar, donde identidad + AML de TusDatos pueden ser reglas duras del gate de viabilidad.)
- **PEP desambiguado**: el "PEP" del AML de TusDatos = Persona Expuesta Políticamente, distinto del PEP migratorio (Permiso Especial de Permanencia) de Motai.

Como canal rt=2, comparte el resto de la mecánica de consolidación CreditopX (base sucursal → status → group_rules+datacrédito → categoría/tramo → cupo local), que es la del subcontexto **Pullman** y del padre **Merchants**.

## Dónde mirar
El único ancla que da MAP.md es el AML de TusDatos dentro del gate de burós (§S4): `[application] app/Actions/RiskCentrals/Tusdatos.php` (identidad + AML). El resto del flujo rt=2 es el cascade de §S5 (`LenderRetrievalService::getLenders`).
> El detalle propio de SmartPay — bloqueo MDM / device-lock, los 3 crons legacy de servicing, y los ids dev 153 / prod 160 — **no está modelado en el simulador flow**; vive en el análisis de código (SMARTPAY-FLUJO-ANALISIS). Superficie de código específica a linkar en la fase de data.

## Gotchas / riesgos
- Flow modela SmartPay **por sus excepciones** (path IMEI + skip AML), no como un flujo completo: no esperes aquí el device-lock ni la garantía-celular cableados.
- El IMEI es de **SmartPay** (canal celular), no de Motai — no confundir los dos productos in-platform.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (fieldDocs `ent.producto`/`node.default` "path IMEI", `buro.listas`/`node.tusdatos` "SmartPay salta el AML") + MAP.md §S4 (TusDatos). Los internals de MDM/crons/ids quedan para la fase de data (no están en flow).

## Enlaces
- Padre: **Merchants**. Hermano: **Pullman** (mismo núcleo rt=2). Simulador: playground/flow (caveats en nodos Configurar entidad y TusDatos). Mapa: playground/flow/MAP.md §S4-S5.
