# Nomenclatura de negocio — glosario canónico y reorganización conceptual

> **Por qué este doc.** El costo de los nombres ya se pagó una vez: el `motai-renting` del código
> es el **rent-to-own** del PRD (inversión C1) — contratos, calculadora y comunicación dependían de
> cuál "renting" leías. Este doc extiende el diccionario de productos (D2, [MOTAI-PLAN-EVOLUCION.md](../mejoras/MOTAI-PLAN-EVOLUCION.md) §4.2)
> a **todo el vocabulario** con el que negocio, producto y tec hablan de CreditOp.
>
> **Fuentes:** [CREDITOP.md](../CREDITOP.md) (modelo de negocio), PRD MVP2 de Manuela Romero
> (motai-manu.pdf, 23/05/2026) y el simulador `playground/flow`.
> **Regla de uso:** PRDs, contratos, pantallas y reuniones usan la columna **"decí"**; el código
> mantiene sus keys técnicos con un **mapa explícito** (nunca renombrar BD "en caliente").

---

## 1. Los choques de nombre detectados (con evidencia)

| # | Choque | Dónde se ve | Costo si no se arregla |
|---|--------|-------------|------------------------|
| N1 | **"X" significa 3 cosas**: CreditopX (la familia/motor rt=2) · "Creditop X" (lender 37) · "Motai X" (producto histórico retirado, capital propio; y en la pantalla del MVP1 = la compra financiada) | PRD: "Política de Riesgo — Motai Renting en **Creditop X**"; pantalla MVP1: "**Motai X**, Motai Renting y Alquiler" | Alguien lee "Motai X" y no sabe si es el producto vivo, el lender muerto o la familia |
| N2 | **"Renting" invertido** (C1): código `motai-renting` = se queda el bien; PRD renting = lo devuelve | `allied_modes` vs PRD §Objetivo | Ya resuelto en D2 — falta **propagarlo** (CREDITOP.md §4 eje 2 seguía con la definición vieja; corregido en este commit) |
| N3 | **La misma plata con 3 nombres**: "canon" (R4/R5), "cuota" (R6, §6 rangos), "tarifa" (calculadora) | PRD, mismo documento | Reglas que suenan a cosas distintas comparan el mismo número |
| N4 | **"Plan semanal/mensual/trimestral" nombra frecuencia pero significa permanencia**: todos pagan semanal; el factor (1.25x/1.0x/0.94x) premia el **compromiso** (semana a semana / 4 / 12 semanas) | PRD calculadora renting | "Trimestral" se lee como "paga cada 3 meses" — falso |
| N5 | **Unidades de plazo mezcladas**: la tabla RTO dice "12 meses = 12 semanas" | PRD §1 hoja 2 | Un plazo mal leído cambia la cuota ~4x |
| N6 | **"Perfil App / No-App"**: "App" suena a nuestra app; es la **fuente de validación de ingresos** | PRD §2/§3 (la propia columna Cobertura ya dice "conductores de apps" / "empleados e independientes") | Confusión con canal/app de CreditOp |
| N7 | **"Reglas Universales" no son universales**: R4/R5 (canon) son del producto arrendamiento; R1 (referencias) es requisito de proceso, no de riesgo; R3 (score 400) choca con §5 (score 0) = **C9 abierto** | PRD §2 | Se hereda al código como una lista plana y se pierde quién puede cambiar qué |
| N8 | **"Perfil" sobrecargado (4 usos)**: política "por perfil" (=fuente de ingresos) · formulario de perfil (estado 9) · perfilamiento (snapshot de lenders) · perfil consolidado (datos de riesgo) | PRD + BD + simulador | Cada conversación arranca definiendo cuál perfil |
| N9 | **Decisiones con nombre de botón**: "Aprobar / Validar codeudor / Rechazar" — "validar codeudor" es una acción pendiente, no un resultado | Pantalla final asesor MVP1 | Métricas de aprobación ambiguas |
| N10 | **"Mora vigente" sin unidad**: en el PRD es **$ saldo** ("moras ≤ 10 millones"); en las reglas por lender de BD es **nº de cuentas** | PRD §5 vs `lender_datacredito_rules` | Umbral 10 = ¿10 pesos millones o 10 cuentas? |
| N11 | **R7 vs R8 casi homónimos**: "capacidad de endeudamiento" (flujo: ≤40% ingreso mensual) vs "endeudamiento total" (stock: <50% patrimonio) | PRD §2 | Se citan cruzados en reuniones |
| N12 | **"Precio de venta total" en renting operativo**: si el cliente nunca compra, no hay venta — es la **base del canon** | PRD calculadora hoja 1 | Contrato de arriendo hablando de "venta" |
| N13 | **PEP doble** (ya advertido en CREDITOP.md): Permiso Especial de Permanencia (migratorio, Motai) vs Persona Expuesta Políticamente (AML) | PRD MVP1 §3 vs onboarding | Un "PEP" en un requisito legal es ambiguo |
| N14 | **5 palabras para el mismo eje**: línea / modo / producto / modelo / opción (renting, RTO, compra) | PRD ("líneas de revenue", "ambos modelos") + código (`allied_modes`) | El eje central del negocio sin nombre fijo |

**Vacíos que el propio PRD deja marcados** (para cerrar con Manuela, son de política, no de nombres):
score mínimo titular **400 vs 0** (C9); "mora grave activa" tachada con "falta acotarlo"; requisito para
cuota > $250.000 "falta acotarlo"; la franja de ingresos **$2.900.000–$2.999.999 quedó sin definir**
(§3 corta en <2.9M, §6 en ≤2.999.999); límites inconsistentes (codeudor ">650" en §4 vs "mínimo 650" en §5).

---

## 2. Glosario canónico (decí / evitá)

### La familia y los productos

| Concepto | Decí | Evitá | Por qué |
|---|---|---|---|
| El motor in-platform (rt=2/3): CreditOp opera, el comercio pone capital y riesgo | **CreditopX** (una palabra, solo para esto) | "Creditop X" para productos; bautizar productos "X" | N1: X queda reservado a la familia |
| Crédito clásico para adquirir | **Compra financiada** | "Motai X", "crédito" a secas | D2 |
| Arrienda y **devuelve** el bien | **Renting operativo** | "alquiler" (código legado), "renting" a secas | D2 / N2 |
| Arrienda y **se queda** el bien | **Rent-to-Own (RTO)** | "renting" (así lo llama el código legado), "renting con compra" | D2 / N2 |
| El eje renting/RTO/compra | **producto** | línea, modo, modelo, opción | N14; "modo" muere con el plan §10; "línea" solo en conversación de revenue |
| La oferta concreta de un comercio | **producto del comercio** — se nombra "Comercio + Producto" (ej. **Motai Renting**) | nombres de fantasía por comercio | El título del propio PRD ya lo hace bien |

### La política de riesgo y sus niveles

| Concepto | Decí | Evitá | Por qué |
|---|---|---|---|
| Reglas comunes a toda la familia CreditopX | **Política base (nivel 0)** | "reglas universales", "plantilla default" | N7; "universal" esconde el nivel |
| Reglas propias del producto | **Política del producto (nivel 2)** | mezclarlas en la base | canon min/max es del arrendamiento, no de la familia |
| Umbrales pactados con UN comercio | **Acuerdo comercio·producto (nivel 3)** | "la relación" (jerga BD) | CREDITOP.md §1: operar exige "acuerdo comercial + de riesgo" — ese es el nombre |
| Origen de cada regla vs el nivel de arriba | **heredada / ajustada / nueva** | — | Ya establecido (simulador + prototipos) |
| Si el cliente califica | **elegibilidad** | "viabilidad", "evaluación" | Un solo nombre para el sí/no |
| Cuánto se le ofrece | **oferta** (cupo / canon estándar) | mezclarlo con elegibilidad | El PRD §6 (rangos de cuota) es OFERTA, no filtro — separarlos como hace el motor real (cupo rt=2) |
| Identificador de una regla | key semántico (`canon.semanal.rango`, `carga.mensual.max`) | R1…R8 | Plan §10 ya los depreca; R# no dice qué gate toca |

### La plata (arrendamiento vs crédito)

| Concepto | Decí | Evitá | Por qué |
|---|---|---|---|
| Pago periódico de un arrendamiento (renting **y** RTO) | **canon** (semanal) | cuota, tarifa | N3; el propio PRD dice "Regla del Canon… aplica a ambos modelos" |
| Pago periódico de un crédito (compra financiada) | **cuota** | canon | Mantiene la frontera contractual arriendo/crédito |
| Pago adelantado del RTO | **pago inicial** | "cuota inicial" (en arriendo no hay cuota) | Coherencia N3 |
| Compromiso que abarata el canon | **permanencia** (sin / 4 / 12 semanas) | "plan semanal/mensual/trimestral" | N4 |
| Duración de contratos de arrendamiento | **plazo en SEMANAS** (con "≈ meses" entre paréntesis si ayuda) | plazos en meses para renting/RTO | N5 |
| Base sobre la que se calcula el canon (renting) | **valor base del canon** | "precio de venta total" | N12 |
| Base de la amortización (RTO) | **valor a financiar** | — | Ya está bien en el PRD |
| Tope aprobado en CreditopX | **cupo** | "monto aprobado" a secas | Es el término del motor real (rt=2/3) |

### Los datos, los segmentos y las decisiones

| Concepto | Decí | Evitá | Por qué |
|---|---|---|---|
| Cómo se validan los ingresos | **segmento de ingresos: gig (por apps → Ábaco)** vs **tradicional (AgilData + Mareigua + TusDatos)** | "perfil App / No-App" | N6, N8 |
| Los datos de riesgo unificados del solicitante | **perfil del solicitante** (perfil consolidado) | usar "perfil" para el segmento | N8 |
| Snapshot de lenders mostrados (tabla BD) | **perfilamiento** (queda como está, es técnico) | — | Renombrarlo costaría más de lo que aporta |
| Resultados de la evaluación | **Aprobado / Aprobado con codeudor / Rechazado** (+ estado transitorio "pendiente codeudor") | "aprobación directa/condicional", "validar codeudor" como resultado | N9 |
| Exigencia de codeudor bajo condición | **codeudor condicional** (regla: ingreso < X → codeudor con score ≥ 650) | "codeudor obligatorio" a secas | Es condicional por definición |
| DTI de flujo (deudas + canon ≤ 40% ingreso mensual) | **carga mensual** | "capacidad de endeudamiento" | N11 |
| DTI de stock (< 50% del patrimonio) | **endeudamiento total** | — | N11: par con el anterior |
| Mora en el buró | **siempre con unidad**: "mora vigente ($ saldo)" o "cuentas en mora (nº)" | "mora vigente" pelada | N10 |
| Quien pone el dinero (cara al cliente y a negocio) | **entidad** (técnico: lender) | mezclar en una misma pantalla | El wizard real ya dice "pantalla de entidades" |
| rt=1 / rt=0 en una frase | **integración** (decide su API) / **referido** (decide su sitio) | "UTM" fuera de contexto técnico | Los nombres del catálogo ya son buenos |
| Documento migratorio vs AML | **PEP (migratorio)** / **PEP (AML)** — siempre calificado | "PEP" pelado | N13 |
| La herramienta de cotización del asesor | **simulador de oferta** (o cotizador) | "calculadora" y "simulador" alternados | El PRD usa ambos para lo mismo |

---

## 3. Cómo se reorganiza el PRD con este vocabulario

Las 6 secciones de política del PRD encajan en el modelo de herencia (el que ya usa el simulador
y los prototipos de merchant-config) sin perder nada:

| Sección del PRD | Se convierte en | Nivel |
|---|---|---|
| §1 "Reglas Universales" R1–R8 | Se reparte: buró 100%, carga mensual 40%, endeudamiento total 50%, referencias → **política base**; canon 150–300k, carga semanal 25% → **política del producto arrendamiento** | 0 y 2 |
| §2 Validación de ingresos (Palenca→Ábaco…) | **Segmentos de ingresos** (gig/tradicional) = de dónde sale el dato del perfil del solicitante | datos, no reglas |
| §3 Política por perfil de cliente | Reglas de elegibilidad **por segmento de ingresos** (umbral $3M → directo; menos → codeudor condicional) | 2 |
| §4 Política de codeudor | Una sola regla: **codeudor condicional** | 0 (aplica a la familia) |
| §5 Análisis Datacrédito | Reglas de buró de la política base, **ajustables por acuerdo** (así funciona hoy el motor rt=2) | 0, override en 3 |
| §6 Rangos de cuota por perfil | **Política de OFERTA** (canon estándar por segmento) — separada de la elegibilidad | oferta |
| Diferencias renting vs RTO (docs a firmar) | **Formalización por producto** (no es política de riesgo: el PRD mismo dice "misma política") | 2 (atributo) |
| §13 Cobranza y recaudo | Servicing post-Estado 11 (etapas de mora 1-7 / 8-30 / 31-90 / 90+) — fuera de originación | servicing |

**La validación más linda:** el título de Manuela — *"Política de Riesgo — Motai Renting en Creditop X"* —
ya nombra los tres niveles sin saberlo: **CreditopX** (familia, nivel 0) · **Renting** (producto, nivel 2) ·
**Motai** (comercio → acuerdo, nivel 3). La reorganización no le cambia el contenido: le pone dirección a cada regla
(quién la define y quién puede ajustarla), que es exactamente lo que se pierde en una lista R1–R8.

---

## 4. Ajustes que aplicaría (priorizados)

| # | Ajuste | Dónde | Estado |
|---|---|---|---|
| A1 | Corregir la definición invertida de renting en el doc maestro (§4 eje 2 seguía pre-D2) | CREDITOP.md | ✅ hecho en este commit |
| A2 | Pasarle a Manuela el glosario §2 + los vacíos marcados (C9 score, mora grave, franja 2.9–3.0M, cuota >250k) para la próxima versión del PRD | Confluence / reunión | propuesto |
| A3 | Alinear el simulador flow al glosario: "Plantilla default" → **Política base · CreditopX**; "relación (nivel 3)" → **acuerdo (nivel 3)**; productos → **Compra financiada / Renting operativo / Rent-to-Own**; "Lenders disponibles" → **Entidades disponibles** | playground/flow | ✅ hecho (commit 5b6b3c4) — keys internos del código sin tocar |
| A4 | En el código real: mapear los `code` legados de `allied_modes` y adoptar keys semánticos de reglas | Etapa 1 del plan Motai | ya está en el plan (§4.2, §10) |
| A5 | Reglas de estilo permanentes: "X" reservado a la familia · PEP siempre calificado · plazos de arrendamiento en semanas · mora siempre con unidad · canon vs cuota según contrato | todos los docs/PRDs nuevos | vigente desde este doc |
