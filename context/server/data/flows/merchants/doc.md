# Merchants · contexto
> **estado:** al día con main · Los comercios/merchants aliados: su alta/configuración Y sus flujos de originación concretos. La contraparte de Entities en el marketplace.

<!-- STUB del árbol visual — la data (archivos) se linka en la fase de organización. -->

## Qué es
Los **comercios/merchants** aliados. Cubre dos caras: (1) el **alta y configuración** — entidad/comercio/sucursal, config por nivel, cómo se habilitan los lenders; y (2) los **flujos de originación concretos** por comercio/canal (subcontextos). Contraparte de **Entities** (los prestamistas) en el marketplace.

## Contenido
_Pendiente de curar._ El alta/config y el detalle por flujo se linkan al organizar (data previa en `flows-curated/{comercios,motai,smartpay,credipullman}` y git `@159906a`).

## Subcontextos
- **MotaiX** — flujo Motai (comercio 158, in-platform): modo del comercio + Ábaco (ingresos gig).
- **SmartPay** — canal in-platform (path IMEI): el celular como garantía, bloqueo por MDM.
- **Pullman** — flujo CrediPullman/Pullman (rt=2 in-platform "vanilla").

## Bitácora
- **2026-07-17** — Se fusionó el nodo `flows` acá: los flujos concretos pasan a subcontextos de Merchants (que ya cubría el alta/config de comercios). Títulos del árbol pasados a inglés.

## Enlaces
- Raíz: **CreditOp**. Contraparte: **Entities**.
