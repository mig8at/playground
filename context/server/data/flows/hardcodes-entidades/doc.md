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
2. **Arrays de ids quemados por comercio/lender** — `[24,209,210,211,311]` Corbeta, `[218,219,221,222]` Pash, ~~`MOTAI_LENDER_IDS=[158]`~~ (retirado 2026-08-28), Welli `[23,141,142,166]`, allieds sueltos `26/153/225/277/250/67/95/24`. Raíz de ~11 clusters.
3. **Branch por nombre (`lender.name ==`) + assets por-id** — `LenderTabBehaviorResolver` por string, y peor: **archivos nombrados por id** (`consent_{id}.blade`, `payment_schedules/lender_{id}`, URLs S3 de T&C por id). Cada lender con doc propio = un archivo con su número.
> ~~Espejo en el front: `MOTAI_LENDER_IDS` forka la card, la fórmula de precio (duplicada), el routing y el tipo de documento PEP — todo por `id === 158`.~~ **Corregido el 2026-08-28**: la des-motaización retiró el fork — `MOTAI_LENDER_IDS` ya no existe como CÓDIGO en `main` (front y backend; quedan 2 comentarios que narran el retiro); la card se decide por `lenders.product` y el precio viene calculado del backend (`calculated`).

**(2026-08-28) Re-verificación asistida de los 41 archivos derivados** (worker digirió el diff contra
este doc en 10 funcionalidades; las 3 que invalidaban afirmaciones se verificaron a mano — las tres
ciertas, corregidas arriba en su lugar). De lo nuevo que este censo hereda: el pipeline de codeudor y
su cupo (nodo codeudor), el corte semanal (nodo servicing), el reprice en vivo de Meddipay con
tooltips de FGA en la card, y la parametrización que reemplaza hardcodes — tipos de documento
permitidos por sucursal (`allowedDocumentTypes`) en vez de excluir PEP incondicional, y el país del
tema del comercio en vez de asumir Colombia. La dirección del censo es la esperada: **los hardcodes se
retiran hacia configuración**, y este doc registra los que quedan.

## Dónde mirar

La tabla de abajo lista 24 clusters, pero **casi todos entran por tres puertas**. Si vas a integrar una
entidad, abrí estas tres y vas a saber en minutos si te toca tocar código o alcanza con config.

- **Puerta 1 · el god-method del dispatch por id** —
  `legacy-backend/Modules/Onboarding/App/Services/lenders/PreApprovedLenderService.php`: el if-chain
  con una rama por lender rt=1. **Son OCHO ramas vivas** (re-verificadas contra `main` el 2026-09-18):
  `:79` Addi (9) · `:167` Bancolombia BNPL (68) · `:193` Bancolombia Consumo (100) · `:265` Welli (23) ·
  `:307` Credifamilia (24) · `:453` Meddipay (39) · `:542` Prami (12) · `:593` Banco de Bogotá/CeroPay
  (133). *(Acá se listaban seis: faltaban Welli y Banco de Bogotá —los dos sí están en la tabla de
  abajo— y Prami se había corrido de `:535`.)* **Sumar un agregador = agregar un `if` acá.**
  ⚠ **La ironía está en el mismo repo, y ahora con su cita:** `lenders.action` es una **columna que
  guarda un nombre de clase**, y el camino polimórfico ya está construido —
  `legacy-backend/Modules/Onboarding/App/Services/lenders/LegacyLenderService.php:48-54` hace
  `$lenderClass = $lender->action` → `class_exists($lenderClass)` → `new $lenderClass()`, y lo mismo en
  `:77` y en `Modules/Onboarding/App/Services/UserRequestService.php:544`. **Existe, funciona, y este
  método no lo usa.**
- **Puerta 2 · los arrays de ids quemados** — no tienen un solo archivo, pero sí una firma para
  grepear: `[24,209,210,211,311]` (Corbeta, y ojo que el setting `corbeta_allieds` existe y es la
  fuente correcta), `[218,219,221,222]` (Pash), Welli `[23,141,142,166]`.
  ⚠ **Y desde el 2026-09 el array de Corbeta vive en DOS lados a propósito.** `OnboardingV2` reproduce los literales de v1 en una clase de constantes —`legacy-backend/Modules/OnboardingV2/App/Constants/KycParityConstants.php`, `DEFAULT_EMPLOYMENT_ALLIED_IDS = [209, 210, 211]`— y su docblock dice que **v1 no se modifica**: son los mismos literales que ya usa. O sea que la deuda **no se movió, se duplicó**, y hoy grepear un solo repo o un solo módulo ya no alcanza. ⚠ Peor: esa lista es **independiente del setting `corbeta_allieds`**, que v1 **también** honra en su Flow B — **las dos aplican**, así que sacar un comercio de la config no lo saca del comportamiento. Ahí hay que tocar las dos.

  ⚠ **`MOTAI_LENDER_IDS` ya NO es una de esas firmas — no lo grepees esperando código.** Re-verificado
  contra `main` el 2026-09-14: quedan **dos** apariciones y las dos son COMENTARIOS que cuentan que se
  retiró (`apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.helpers.ts` y su
  test). La regla viva se escribe por PRODUCTO: `isCalculatorProduct(product)`, **definida** en
  `frontend-monorepo/modules/loan-request-wizard/lenders-marketplace/src/lib/domain/constants/lender.constants.ts:70`
  y **consumida** en `apps/loan-request-wizard/app/routes/lenders-marketplace/available-lenders.helpers.ts:72`.
  *(Acá se citaba `available-lenders.helpers.ts:46-48`, que es el archivo que la usa y ni siquiera la
  línea donde la usa.)*
  Los dos archivos que este nodo citaba —`AvailableLenders.tsx:555` y `hooks/useLenderSelection.ts:8`—
  **siguen existiendo pero ya no forkean por ese array**: la cita quedó señalando otra cosa.
- **Puerta 3 · el branch por NOMBRE** —
  `legacy-backend/Modules/Onboarding/App/Services/lenders/LenderTabBehaviorResolver.php:28`: decide la UX
  post-selección comparando `lender.name` como string —
  `NON_NEW_TAB_LENDER_NAMES = ['Compensar', 'Sistecrédito', 'Meddipay']`—. Se rompe con un renombre en el
  admin, sin que falle nada visible. ⚠ **Son TRES nombres acá, no seis:** Lagobo y Davivienda también
  branchean por nombre pero **en otro archivo** (`Modules/Onboarding/App/Services/UserRequestService.php:736`
  y `:746`, ver el nodo `redirect`), y Prami lo hace por id. La fila de la tabla los junta a todos porque
  el síntoma es el mismo; el sitio a tocar, no.

⚠ **Lo que este nodo NO te da**: la línea exacta de los 101 sitios del catálogo. Ésas viven en el
`map.json` (la columna `sitios` de la tabla las cuenta). Las tres puertas de arriba son el atajo para
el 80 % de los casos; para el 20 % restante, entrá por la fila de la tabla y grepeá el id en los
archivos del mapa.

## Catálogo de BLOQUEADORES (🔴 sumar un similar obliga a tocar código)

<!-- generado del audit; "sitios" = ocurrencias verificadas con file:line en map.json -->
| Entidad / comercio | ids | qué forka | sitios | sev |
|---|---|---|---|---|
| **Asyco** | lender 154, 155 | landing post-11 propia ('loan-approval-success' vs 'stand-by') + voucher con cuota inicial; 6 forks por id | 6 | P1 |
| **Bancolombia** | 68 BNPL, 100 Consumo | dispatch por id en PreApprovedLenderService (`if id==68 → BancolombiaBnpl`; `id==100 → amount=1000000 + ConsumerLoan`); secuencia multi-step propia | 12 | P1 |
| **Corbeta** | allied 209/210/211 | onboarding entero: rama self-management (salta confirmación de desembolso) + datos laborales DUMMY | 11 | P1 |
| **Credifamilia** | lender 24 (+ OnVacation 179 co-listado) | radicación SOAP `register()` + response_type por accessor, solo si `id==24` | 7 | P1 |
| **Magnocell + CE** | lender 84 + doc `CE` | ⚠ **salta el MOTOR DE REGLAS ENTERO, no sólo el gate datacrédito**: si `document_type==='CE' && id===84` (`Modules/Loans/App/Services/LenderUserCategoryService.php:400-403`) asigna la **categoría 22 quemada** (`findById(22)`, `:407`) y retorna sin evaluar un solo tier — las políticas configuradas de esa entidad no se aplican. ~~El gemelo de `Modules/Loans` tiene el bloque comentado, así que los dos motores tratan distinto al mismo cliente~~ **(corregido 2026-08-28: la copia de Onboarding se RETIRÓ — el motor quedó uno solo, en Loans, y el bypass corre activo ahí (`findById(22)`), ahora consistente)**. Ver **F-120** | 2 | P1 |
| **Meddipay** | lender 39 | toda la integración Meddipay detrás de `id==39` (`new Meddipay->consult`) | 4 | P1 |
| **Motai (Renting)** | lender 158 · ~~allied_mode 2~~ · `motai-renting` | ~~TODO el pipeline (15 hardcodes)~~ **la v2 los retiró casi todos** (2026-08-28): producto por `lenders.product`, precio por `lenders.calculator`, modos borrados. Queda lo del canal del formulario dinámico (id por ambiente) | ~2 | P2 |
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

> **El selector de plan se decide por CANTIDAD, no por entidad** — `offersPlanChoice(plans)` en
> `lenders-marketplace/src/lib/domain/constants/lender.constants.ts:120-122` es literalmente
> `Array.isArray(plans) && plans.length > 1`. Vale como patrón más allá de la pantalla: la pregunta
> «¿hay algo que elegir?» se le hace al DATO, así que una entidad que cotice un plazo único queda
> cubierta sin tocar código y la que cotice varios conserva su selector. Es el movimiento 2 de
> «Cómo des-hardcodear» hecho en chico.
>
> ⚠ **Y trae su propia advertencia sobre cómo se mide un cambio así:** medido contra producción el
> 2026-09-13, las dos entidades con calculadora traen **tres** planes cada una — o sea que el cambio
> **no mueve ninguna pantalla hoy**. Cambia la REGLA, no el render. Un A/B visual contra prod habría
> dado «sin diferencias» y eso no es evidencia de que no haga nada.

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
- **Blades por-id**: el mecanismo «archivo nombrado por número de lender» es su propia superficie de
  acoplamiento, y **creció**. Contados contra `main` el 2026-09-18: **NUEVE** consentimientos —`139`,
  `140`, `152`, `162`, `164`, `167`, `172`, `187`, `189`— cuando acá se nombraban tres. ⚠ En cambio
  `payment_schedules/lender_{id}` es **uno solo** (`lender_139`) y vive en `legacy-application`, el
  monolito viejo — y ese mecanismo **ya tiene reemplazo en curso**: la migración
  `2026_08_20_130000_set_motai_payment_schedule_template.php` mueve el plan de pagos a una **columna
  `template`**. Es la dirección que este censo espera, hecha en chico.

**(2026-09-18) Nodo RE-VERIFICADO entero.** 16 afirmaciones auditadas —14 de código leídas contra `main`
y 2 de dato medidas contra producción—, **cero chequeos débiles y ninguna afirmación falsa**: el censo
describe bien la deuda. Lo que apareció es que **el censo se quedaba corto en tres conteos**, y los tres
hacia arriba: el if-chain tiene **ocho** ramas y acá se listaban seis, los consentimientos por id son
**nueve** y se nombraban tres, y `lender->action` —la solución a medio construir— resultó estar **más
construida de lo que decía**: es una columna con nombre de clase que ya se instancia en tres sitios.
✔ Y las **101 rutas del mapa siguen resolviendo sin un solo drop**, que es el dato que sostiene el
«sitios» de la tabla. ⚠ Dos citas apuntaban a otra cosa: `isCalculatorProduct` se citaba en el archivo
que la consume y no donde se define, y Prami se había corrido siete líneas.

## Fronteras / Enlaces
- El **detalle por entidad** vive en sus nodos: **aggregator** (rt=1, el god-method), **motai** / **smartpay** / **pullman** / **credifamilia** / **corbeta**, **entities** (backbone de lenders), **merchants** (comercios/allieds). Este nodo es la LENTE transversal de acoplamiento, no reemplaza esos docs.
- El **deber-ser**: [[plan-simplificacion]] (flujo único paramétrico + R1-R11) y la task **motai-v2** (des-motaización = el primer bloqueador ya movido a config — prueba de que cada 🔴 es factible).
- Superficie: **101 sitios verificados** (file:line en `map.json`), 0 drops contra el oráculo. Fuente: auditoría por workflow `wjfw8nvsf` (2026-07-18).
