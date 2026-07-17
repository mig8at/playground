# Plataforma · group
> **estado:** al día con main · El **sustrato transversal** de CreditOp: el modelo de datos, el motor de decisión, el harness, la migración y el alta/reglas que TODOS los flujos consultan — más el **deber-ser** (la simplificación). No es un flujo; es la base común.

<!-- GROUP transversal (3er sombrero del árbol, junto a CreditopX operador y Bróker). Agrupa los
     nodos de REFERENCIA: material que los flujos consultan pero ninguno dueña. Su doc = qué es el
     sustrato + los miembros + el deber-ser (planes). Cada miembro trae los datos duros para no abrir docs/. -->

## Qué es
Los flujos (CreditopX, Bróker) describen **cómo se origina un crédito**; la Plataforma describe **el sustrato que usan todos**: qué tablas/columnas existen y cuáles deciden, cómo decide el motor, cómo se prueba, qué falta migrar, y cómo se da de alta un comercio. Es material de **referencia transversal** — se consulta, no se recorre. Acá también vive el **deber-ser** (adónde va la plataforma), porque es transversal a todos los flujos.

## Miembros
- **Modelo de datos y config** — qué tabla/columna guarda cada cosa, cuál decide, cuál está muerta (censo 176 columnas, bug min_income, response_type=4 huérfano, niveles N0-N3).
- **Motor de decisión** — quién se aprueba: 3 niveles (listado/pre-aprobación/cupo), 2 motores datacrédito, cascada getLenders, group rules, y la **receta de synth por lender** + frontera de inyectabilidad.
- **Harness y pruebas E2E** — *el nodo del OKR*: los 2 harness (backend-e2e Go + frontend-e2e Playwright), receta de usuario sintético + `laravel_encrypt`, testids, mocks/bypasses/stashes, por qué falla cada caso.
- **Migración application→legacy** — estado por módulo (🟢🟡🔴), backlog P0-P3 para apagar el monolito, allowlist por comercio, webhooks rt=1 huérfanos, e inventario de hardcodes/deuda (P0 vivo `dd()` en Wompi.php:78).
- **Alta y reglas por sucursal** — el panel admin (pantalla→endpoint→BD), el mecanismo de las **37.284 copias** de reglas por sucursal (5% deriva) y el default BdB.

## Deber-ser / simplificación
El norte de la plataforma (síntesis de `PLAN-ACCION-SIMPLIFICACION` + `UNIFICACION-Y-RESPONSABILIDADES`):

> **Tesis:** hoy CreditOp **se adapta a cada comercio** con ifs quemados por ID; el destino es un **modelo único paramétrico** al que los comercios se adaptan por **configuración** (una fila, no un deploy).

**Dos movimientos:**
1. **Unificar** — un solo flujo paramétrico: los productos (compra/renting/RTO) dejan de ser un `if merchantMode` y pasan a **catálogo** (lenders CreditopX por categoría); TyC/PEP/calculadora/modo pasan a **config por columna**. Sumar un comercio = agregar filas.
2. **Separar responsabilidades** — dejar de fundir en una bandera cosas independientes: **producto** (qué se contrata) vs **underwriting/decisión** (cómo se aprueba) vs **nivel de política** (base→producto→acuerdo, **herencia con override, NO copia** → mata las 37k copias) vs **los dos sombreros** (operador rt=2/3 vs bróker rt=0/1/4) vs **actores** (asesor arma / administrador decide).

**Piezas del plan:** ADO-first en el onboarding · 4 manifiestos declarativos · política R1–R11 por config · poda de ~51 lenders muertos · 30 branches clasificados (17 mueren / 10 → config / 3 quedan) · god-service −65%. Cubre el **PRD MVP2** de Manuela y cierra las **11 brechas** de José, pero con estructura (que escala) en vez de una lista plana transitoria. Está **prototipado** en `playground/flow` (catálogo + niveles + herencia con override borrable). La tarea **motai-v2** es el primer escalón ejecutado de este deber-ser.

## Dónde mirar
El sustrato central que todos tocan: `Lender.php` · `Allied.php` · `AlliedBranch.php` · `UserRequest.php` · `ResponseType.php` + `ResponseTypesTableSeeder` (catálogo rt 0-3) · `config/lenders.php` · `LenderListingService.php` (cascada de visibilidad) · `DatacreditoRuleEvaluator.php` (decisión rt=2). El detalle por dominio vive en cada nodo miembro.

## Bitácora
- **2026-07-17** — Group creado como 3er sombrero del árbol (junto a CreditopX y Bróker) para hacer context **autosuficiente**: absorbe el material transversal (5 nodos de referencia) + el deber-ser, que antes solo estaba enlazado desde la raíz. Objetivo: resolver cualquier tarea de CreditOp sin abrir `docs/`.

## Enlaces
- Miembros: nodos **modelo-datos · motor-decision · harness · migracion · admin-reglas**.
- Deber-ser (fuente, mientras exista `docs/`): `docs/mejoras/PLAN-ACCION-SIMPLIFICACION.md` · `docs/vision/UNIFICACION-Y-RESPONSABILIDADES.md` · `docs/mejoras/MOTAI-PLAN-EVOLUCION.md`.
- Prototipo del deber-ser: `playground/flow`. Primer escalón ejecutado: tarea **motai-v2**.
- Memorias: `plan-simplificacion` · `nomenclatura-negocio` · `simulador-gap-analisis`.
