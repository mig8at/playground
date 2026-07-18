# Hardcodes de entidades/comercios — la deuda que frena la plataforma · contexto
> **estado:** ⚠ deuda transversal VIVA (auditoría 2026-07-18, 40 agentes, 206 hallazgos → 31 clusters verificados contra código) · **24 de 31 acoplamientos BLOQUEAN la integración por-config** → hoy CreditOp es una herramienta que se **adapta a cada externo**, no una plataforma que **escala por datos**.

## ⚠ Cómo usar este nodo (es un DOLOR, no una referencia pasiva)
Si tu tarea **agrega, integra o toca el flujo de una entidad (lender) o comercio (allied)** — o si vas a escribir `if ($lender->id == N)`, un array de ids, o `lender.name == '…'` — **pará y leé acá primero**:
1. **Buscá si ya está acoplada** (tabla de abajo) y en cuántos sitios: el trabajo real casi siempre es más grande de lo que parece (Motai = 15 sitios en 3 repos).
2. **NO sumes otro hardcode.** Cada `if id==N` nuevo agranda esta deuda y hace a CreditOp menos plataforma. Usá/creá la **columna o setting de config** (ver "Cómo des-hardcodear").
3. **Si no hay más remedio que hardcodear**, registrá la deuda acá (sumá el sitio a `map.json` + una fila a la tabla) para que el próximo la vea.

El costo de ignorar esto: el patrón **ya se está replicando** (ver "Señal de alarma") — cada entidad nueva hoy nace acoplada.

## El dolor en una frase
Para sumar una entidad/comercio con un flujo distinto **hay que editar código en `application` + `legacy-backend` + `frontend-monorepo`**, en vez de insertar filas de config. Eso es lo que hace que CreditOp no escale: el onboarding de un cliente nuevo es un release, no un alta de datos.

## Los 3 anti-patrones raíz (los 24 bloqueadores colapsan acá)
1. **God-method `PreApprovedLenderService` con `if ($lender->id == N)`** — un if-chain con una rama por cada lender rt=1 (68, 100, 39, 12, 9, 6, 5, 133, 154/155, 84, 11…). Raíz de ~9 clusters. Sumar un agregador = editar este método. Irónico: `lender->action` YA existe como clase polimórfica — la solución está a medio construir y no se usa acá.
2. **Arrays de ids quemados por comercio/lender** — `[24,209,210,211,311]` Corbeta, `[218,219,221,222]` Pash, `MOTAI_LENDER_IDS=[158]`, Welli `[23,141,142,166]`, allieds sueltos `26/153/225/277/250/67/95/24`. Raíz de ~11 clusters.
3. **Branch por nombre (`lender.name ==`) + assets por-id** — `LenderTabBehaviorResolver` por string, y peor: **archivos nombrados por id** (`consent_{id}.blade`, `payment_schedules/lender_{id}`, URLs S3 de T&C por id). Cada lender con doc propio = un archivo con su número.
> Espejo en el front: `MOTAI_LENDER_IDS` forka la card, la fórmula de precio (duplicada), el routing y el tipo de documento PEP — todo por `id === 158`.

## Catálogo de BLOQUEADORES (🔴 sumar un similar obliga a tocar código)

<!-- generado del audit; "sitios" = ocurrencias verificadas con file:line en map.json -->
| Entidad / comercio | ids | qué forka | sitios | sev |
|---|---|---|---|---|
| **Asyco** | lender 154, 155 | landing post-11 propia ('loan-approval-success' vs 'stand-by') + voucher con cuota inicial; 6 forks por id | 6 | P1 |
| **Bancolombia** | 68 BNPL, 100 Consumo | dispatch por id en PreApprovedLenderService (`if id==68 → BancolombiaBnpl`; `id==100 → amount=1000000 + ConsumerLoan`); secuencia multi-step propia | 12 | P1 |
| **Corbeta** | allied 209/210/211 | onboarding entero: rama self-management (salta confirmación de desembolso) + datos laborales DUMMY | 11 | P1 |
| **Credifamilia** | lender 24 (+ OnVacation 179 co-listado) | radicación SOAP `register()` + response_type por accessor, solo si `id==24` | 7 | P1 |
| **Magnocell + CE** | lender 84 + doc `CE` | ⚠ **bypass del gate datacrédito**: cortocircuito ANTES de leer config si `document_type==='CE' && id===84` (venezolanos con cédula de extranjería) | 2 | P1 |
| **Meddipay** | lender 39 | toda la integración Meddipay detrás de `id==39` (`new Meddipay->consult`) | 4 | P1 |
| **Motai (Renting)** | lender 158 · allied_mode 2 · `motai-renting` | TODO el pipeline: confirmación auto-gestión, precio inflado (1.5M+100%+IVA, duplicado), PEP, T&C, salta OTP+cuota inicial | 15 | P1 |
| **Pash** | allied 218/219/221/222 | `[218,219,221,222]` → `session('isPash')` → pantalla de bienvenida distinta + fork de onboarding | 4 | P1 |
| **Pullman / CrediPullman (+ DFS)** | allied 94, 189; lender 77 | fuerza `hadPreApproveLender=false` (ignora pre-aprobado, obliga datacrédito) + selección de método Quanto por id | 11 | P1 |
| **Sistecrédito / Addi** | lender 6, 9 | pre-aprobación + voucher + colisión semántica del par `[6,9]` | 5 | P1 |
| **Sonría** | allied 26 | ⚠ **pisa los términos de Bancolombia** (fee_numbers/max_amount/rate) por allied hardcodeado; afecta Welli/Credifamilia/Meddipay | 4 | P1 |
| **Welli** | lender 23/141/142/166 | 4 variantes reusando 1 consulta `run_risk` (BASE=23); ids por el MS y el front | 10 | P1 |
| **Banco de Bogotá / CeroPay** | lender 5, 133 (+ UMA 135/136/137) | proveedor dedicado `BancoDeBogotaCeroPay->consult` gated por `id==133` | 3 | P2 |
| **Comercio allied 277** | allied 277 | salta la validación de info laboral/ingresos (field 29/87) y estrato | 3 | P2 |
| **routing por `lender.name`** | Compensar/Sistecrédito/Meddipay/Prami/Lagobo/Davivienda | UX post-selección (tab/OTP/modal) por string de nombre — rompe si renombran | 5 | P2 |
| **Creditop interno** | allied 24 (≠ lender 24) + sucursales `[17,570,928,1440]` | listado de pruebas vs producción por id | 8 | P2 |
| **Energiteca** | allied 153 | saca Sistecrédito del listado si no viene 'Approved' (solo para 153) | 2 | P2 |
| **Kreditkasa / Viva tu crédito** | allied 67, 95 | lista base de lenders quemada `[6,19,32,9,17,18]` en el registro pre-aprobado | 2 | P2 |
| **Prami** | lender 12 | `if id==12` → integración externa Prami (exige Experian real) | 3 | P2 |
| **Pre-aprobación sin monto** | `amount=1000000` placeholder; Consumo 100, Corbeta 209/210/211 | monto placeholder forzado para correr validaciones cuando el flujo no pide monto | 4 | P2 |
| **SmartPay** | 160 prod / 152-153 no-prod (+ SU+PAY 11) | canal IMEI, device-lock, mailer/branding por id (`isSmartPay()` = path IMEI && id===160) | 9 | P2 |
| **UMA / "Triumph"** | allied 225 (label distinto app vs legacy) | endpoint UMA propio + flujo de update distinto, DUPLICADO en 2 repos | 8 | P2 |
| **Woocommerce** | allied 250 | esquema de auth del webhook (Bearer) por id | 1 | P2 |
| **país RD/Colombia** | country_id 60 / 47 | `alliedCountry===60` bifurca todo el flujo (RD dynamic vs clásico) — el dato es config, el branch es literal | 6 | P2 |

## Ya es config (🟢) — la prueba de que se PUEDE
Estos 7 no bloquean: ya leen BD/setting/columna, o son globales. **Importan porque demuestran que el patrón plataforma existe en el propio código** — el problema es la inconsistencia, no la imposibilidad.
- **Settings de migración/rollout** (`new_frontend_allieds`, `stratum_field_allieds`, `experian_trigger_allieds`, bypass/see-all) — forkean leyendo la tabla `Setting`.
- **Taxonomía `path_id`** (IMEI=2 / managed=3) y **canal ecommerce/merchant** — discriminantes por columna.
- **IVA 19%** y **otorgamiento especial por bandas de score** (DENTIX/DFS) — quemados pero GLOBALES (no per-entidad); la columna `lenders_by_allieds.iva` ya existe sin usar.
- **`response_type`** (0-4) — enum estructural de despacho; quemado pero es el eje del sistema, no un acoplamiento a un externo puntual.

## Cómo des-hardcodear (los 24 se resuelven con 4 movimientos, no 24)
1. **Registry de adapters de integración** — columna `lenders.integration_key` → clase que implementa una interfaz `PreApproval` común; el dispatcher itera config en vez del if-chain. Mata ~9 clusters. (`lender->action` ya existe → reusarlo.)
2. **Capability flags/columns por lender/allied** — `self_managed_confirmation`, `skips_bank_otp`, `skips_initial_fee`, `requires_pep_document`, `dummy_labor`, `bureau_flow`, `post_approval_route`, `card_template`, `min_amount`. Reemplazan los arrays de id.
3. **Usar las tablas de config que YA existen** — `creditLines` + `lenders_by_allieds` (Sonría: `fee_numbers/max_amount/rate` ya son columnas → poblar la fila, no el `if`), `allied_documents` (T&C por comercio, ya hecho en [[motai-v2]]), el setting `corbeta_allieds` (leerlo en los 6 sitios con el array quemado).
4. **Assets por-config** — `consent_template` en vez de `consent_{id}.blade`; T&C vía `allied_documents` en vez de URLs S3 por id.

## Señal de alarma (por qué es urgente)
El patrón **se está replicando en tiempo real**: **ONVACATION** (lender 313 / 179) ya aparece co-hardcodeado *al lado de Motai* reusando sus PDFs legales, y `consent_164` es un lender sin mapear que ya tiene su blade por número. Cada entidad nueva nace acoplada. La deuda **crece**, no se estabiliza — es "adapter" ganándole a "platform".

## Gaps conocidos (el catálogo UNDERCOUNTS — hay más de 24)
El crítico de completitud levantó 3 que ni entraron al conteo:
- **Approbe** (lender 139): integración entera propia con cifrador **AES-128-CBC bespoke** (IV cero, sin padding), controller + webhook + estado intermedio 4.
- **Payvalida** (pasarela): tablas/modelos/webhook dedicados, checksum SHA-512 — hermana de Wompi, nunca enumerada.
- **Blades por-id** (`consent_139/152/164`, `payment_schedules/lender_{id}`): el mecanismo "archivo nombrado por número de lender" es su propia superficie de acoplamiento.

## Fronteras / Enlaces
- El **detalle por entidad** vive en sus nodos: **aggregator** (rt=1, el god-method), **motai** / **smartpay** / **pullman** / **credifamilia** / **corbeta**, **entities** (backbone de lenders), **merchants** (comercios/allieds). Este nodo es la LENTE transversal de acoplamiento, no reemplaza esos docs.
- El **deber-ser**: [[plan-simplificacion]] (flujo único paramétrico + R1-R11) y la task **motai-v2** (des-motaización = el primer bloqueador ya movido a config — prueba de que cada 🔴 es factible).
- Superficie: **101 sitios verificados** (file:line en `map.json`), 0 drops contra el oráculo. Fuente: auditoría por workflow `wjfw8nvsf` (2026-07-18).

## Bitácora
- **2026-07-18** — creado desde la auditoría de 40 agentes (206 hallazgos → 31 clusters → 24 bloqueadores + 7 config-ok + 3 gaps). Registrado como nodo de DOLOR para que el brief lo surface al tocar integración de entidades/comercios.
