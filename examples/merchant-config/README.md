# merchant-config — prototipos del modelo de renting

Dos prototipos HTML autónomos (sin build, claro/oscuro) para alinear con Jose y negocio **antes** de
programar. Diseño y veredicto de verificación: [`../docs/mejoras/MOTAI-PLAN-EVOLUCION.md` *(histórico — `git show 159906a:docs/mejoras/MOTAI-PLAN-EVOLUCION.md`)* **§10**.

| Archivo | Qué muestra |
|---|---|
| [`propuesta.html`](./propuesta.html) | **Pieza de negocio (para Manuela/Jose)** — no técnica: cómo está hoy (todo amarrado a Motai, complicado), cómo debería quedar (ficha + 3 productos), por qué el cambio es válido y de bajo riesgo, y cómo responde al MVP2. Contraste visual hoy → deber-ser. |
| [`index.html`](./index.html) | **¿Comercio o CreditopX?** — 2 columnas. Izquierda: lo que declara el comercio (marca · qué lenders habilita · cómo decide). Derecha: **3 lenders CreditopX separados** (`CTPX-BUY/RENT/RTO`, categoría crédito/arrendamiento) que comparten el motor rt=2; reglas como filas, precio, ingresos/buró, documentos, codeudor. Tags **existe / extender / nuevo** = el trabajo real. |
| [`admin.html`](./admin.html) | **Consola de decisión del administrador del comercio** — bandeja de solicitudes → perfil financiero (con origen del dato) → evaluación de reglas visible → recomendación calculada → aprobar / validar codeudor / rechazar, con auditoría. Sirve para los modos manual/mixta/automática. |
| [`niveles.html`](./niveles.html) | **Formularios por nivel** — la config partida en los 3 niveles del modelo: comercio (identidad + qué ofrece + cómo decide) · producto/lender "Motai X" (plantilla: categoría, reglas base, docs) · relación (economía del comercio + reglas con interruptor **heredar/ajustar** + codeudor propio + sucursales). Cada nivel anota qué pantallas dispersas de hoy reemplaza. |
| [`flow.html`](./flow.html) | **Recorrido paso a paso del flujo** (stepper + botón Siguiente): comercio → datos base → lenders → **datos extra (según el lender elegido)** → decisión → desembolso. Cards con formularios llenos; el color de cada paso indica su capa. Muestra el orden acordado y la separación datos base (antes de lenders) vs datos extra (después). |

## Abrir

Doble clic al archivo, o el target `merchant-config` de `.claude/launch.json` (server estático Node, puerto 5191).

## Ideas que fijan estos prototipos

1. **Productos = lenders del catálogo** (familia CreditopX), no "modos" del comercio: el cliente elige en el marketplace.
2. **La categoría del lender (arrendamiento/crédito) dispara el comportamiento — objetivo**: hoy lo dispara el id 158 + `isMotaiRenting`; construir esa categoría es parte del trabajo.
3. **Regla = fila** (clave estable + operador + valor), sobre el motor que ya existe. IDs propuestos en §10.2 del plan (deprecan R1–R8).
4. Solo hay **tres construcciones nuevas**: decisión manual del comercio, Ábaco y codeudor. El resto existe o se extiende.

## Honestidad del prototipo (verificado contra código el 2026-07-06)

- La calculadora reproduce **exacto** la fórmula real y el ejemplo del PRD ($14.360.920) — pero esa fórmula hoy vive **quemada y duplicada en el frontend**, no en BD ("existe · extender").
- "Reactivar buró en renting": hoy el flujo **saltea** el buró a propósito (bypass `isMotaiRenting`); el PRD lo quiere al 100% → la tarea es revertir el bypass.
- En rt=2 el evaluador usa las reglas **genéricas** del lender (ignora las de sucursal del CRUD).
- Falta en el prototipo: **tabla de amortización** del simulador rent-to-own (lo pide el PRD).
- Pendientes de negocio: score 400 vs 0 (conflicto interno del PRD), terminología de productos, ¿2 o 3 entradas en la lista?
