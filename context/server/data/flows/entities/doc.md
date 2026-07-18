# Entities · contexto
> **estado:** al día con main · Las ENTIDADES (prestamistas) de CreditOp, agrupadas por sus 3 familias según cómo se comportan. La contraparte de Merchants en el marketplace.

<!-- STUB del árbol visual — la data (archivos) se linka en la fase de organización. -->

## Qué es
Las **entidades** = los prestamistas. Se agrupan en 3 familias por su `response_type` (cómo se comportan en el flujo), que son los subcontextos de este nodo. Junto con **Merchants** (los merchants), son los dos lados del marketplace: la entidad presta, el comercio vende.

## Contenido
_Pendiente de curar._ El detalle por familia vive en cada subcontexto; la superficie de archivos se linka al organizar.

## Subcontextos
- **CreditopX** — familia in-platform (rt=2/3): CreditOp decide, firma y desembolsa.
- **Aggregator** — familia por integración/API (rt=1): decide y gestiona la API externa del lender.
- **Redirect** — familia por redirección (rt=0, UTM/referido): CreditOp deriva al sitio del lender.

## Bitácora
- **2026-07-17** — Nodo creado para agrupar las 3 familias de prestamista bajo un padre (simétrico con Merchants).

## Enlaces
- Raíz: **CreditOp**. Contraparte: **Merchants**. Flujos concretos: **merchants**.
