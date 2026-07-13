# Plan de acción — simplificar y dinamizar CreditOp (eliminar procesos redundantes)

> **Qué es este doc:** el plan ejecutable para pasar de "CreditOp se adapta a cada quien con `if id==N`"
> a "los terceros se adaptan a CreditOp vía configuración". Cada afirmación está **verificada contra el
> código real** (`legacy-backend` / `application` / `frontend-monorepo`) y la **BD local** con `archivo:línea`.
> Es un doc **deber-ser + backlog**: propone el destino y ordena el camino. Fecha de evidencia: **2026-07-01**.
>
> Insumos: auditoría de docs (2026-07-01), clasificación de los branches de `OnboardingService` (30 branches),
> inventario de redundancias (R1–R11), verificación de poda/FKs y quick-wins. Complementa a
> [CREDITOP.md](../CREDITOP.md) §8 (la tesis) y [LOGICA-QUEMADA.md](../codigo/LOGICA-QUEMADA.md) (el inventario).

---

## 1. Resumen ejecutivo

- **El problema medido:** el onboarding concentra la deuda. `OnboardingService.php` = **1.959 LOC, 28 métodos,
  30 branches por comercio/lender/ID**. El módulo Onboarding expone **106 rutas** y **~40 códigos de error**;
  el wizard tiene **32 pantallas** (~18 en el camino de datos). Hay **51 lenders con cero uso** (33% del catálogo),
  el literal `Estado 11` se compara en **~80 sitios** solo en legacy (~170 entre ambos monolitos), y el array
  Corbeta `[209,210,211]` está copiado en **9 sitios**.
- **La salida (3 movimientos):**
  1. **Flujo único paramétrico** — marketplace al centro; cierres `rt=0` (redirect por config), `rt=2/3`
     (in-platform) y `rt=1/4` (detrás de adaptador + manifiesto). Los "flujos especiales" se vuelven config.
  2. **Onboarding ADO-first** — escanear cédula (la captura web **ya existe**, sin redirección) → fan-out
     automático por documento (buró + AML + proxy-ingreso) → marketplace. **Mata 17 de 30 branches** y
     adelgaza el god-service **~65-70%** (1.959 → ~600-650 LOC).
  3. **Manifiestos declarativos** (`merchant_profile` / `mode` / `channel` / `lender_integration`) — 10 de los
     30 branches migran ahí; solo 3 quedan en código (legal/anti-abuso). **~90% del branching sale del código.**
- **Redundancias inventariadas:** 11 (R1–R11), de las cuales 3 son **código muerto borrable ya** en horas-días.
- **Lo que NO se toca:** el motor de reglas (37.859 reglas — ya es el deber-ser), los proveedores de identidad
  (ADO/CrossCore/Evidente, ya multi-proveedor), el servicing (corre 100% en `application`, fuera de alcance),
  y lo legal (consentimiento/habeas data, OTP de firma).

---

## 2. Línea base medida (para auditar el progreso)

| Métrica | Hoy (2026-07-01) | Target | Evidencia |
|---|---:|---:|---|
| Branches por comercio/ID en onboarding | **30** | **≤ 3** | clasificación completa §4.3 |
| LOC `OnboardingService.php` | **1.959** | **~650** | conteo directo |
| Lenders activos con 0 uso | **51** (de 153) | **0** | BD local (mirror dev) |
| Sitios con literal `status_id == 11` (legacy) | **~80** | **1 enum** | grep verificado |
| Copias del array Corbeta `[209,210,211]` | **9** | **1 config** | grep verificado |
| Webhook controllers rt=1 muertos (sin ruta) | **4** | **0** | R3 |
| Servicing copiado en legacy que nunca corre | comandos/controllers/servicios | **0** | R4 (`Kernel.php:15-18` solo agenda device-lock) |
| Paquete FE muerto (`form-engine` + `dynamic.tsx`) | 1 paquete + 1 ruta + stories | **0** | R7 |
| Pantallas del camino de datos del wizard | **~18** | **~8** | R9 (4 variantes de captura) |
| Paths paralelos del marketplace | **2** (`lenders` + `lenders-v2`) | **1** | R1 |
| Motores de pre-aprobación | **2** (switch-por-id 929 LOC + MS Go) | **1** (MS) | R10 |
| Motores Datacrédito | **2** (semánticas opuestas) | **1 paramétrico** | R2 |

**Volumen por `response_type`** (mirror dev; validar contra prod): rt=0 **156K** solicitudes · rt=1 **140K** ·
rt=4 10.8K · rt=2 4K · rt=3 13. Los dos extremos de volumen (rt=0 y rt=1) están en los extremos opuestos de
dinamización: rt=0 es trivial (una URL) y rt=1 depende de la API del tercero.

---

## 3. Visión destino: el flujo único paramétrico

**Un solo flujo. Dos carriles.**

```
Escanear cédula (ADO, in-web)          [captura YA construida: Capture.tsx + /api/identity/*]
        │
        ▼
Fan-out automático por documento       [paralelo: Datacrédito · TusDatos/AML · proxy-ingreso (Quanto/Agildata)]
        │                              [thin-file (PEP/gig): plan alterno → Abaco / Evidente / 1 campo declarado]
        ▼
MARKETPLACE (muestra las entidades)    [el motor de 37K reglas — NO se toca; 100% de solicitudes pasa acá]
        │
        ├── rt=0  → redirect          (una URL en el manifiesto — 156K solicitudes casi gratis)
        ├── rt=2/3 → in-platform      (fecha → pagaré/consent → OTP → Estado 11)
        └── rt=1/4 → adaptador        (contrato LenderIntegration + manifiesto; decide el tercero)
```

- **Carril A (núcleo dinamizable):** rt=0 + rt=2/3 — CreditOp controla todo; 100% simulable E2E.
- **Carril B (borde adaptador):** rt=1/4 — no se simplifica por dentro (decide una API externa); se
  **encapsula** detrás del contrato. El manifiesto declara qué inputs extra pide cada banco, y el flujo
  los pide **diferidos** (solo si el usuario elige ese lender).
- **Los 4 manifiestos:** `merchant_profile` (comportamiento del comercio), `mode` (producto/underwriting),
  `channel` (entrada + notificación), `lender_integration` (auth/mapeo/estados/cierre). Validación de esquema
  al cargar + **suite de conformidad** (harness) como gate de alta. Ejemplos concretos (Pullman/Motai/SmartPay):
  ver conversación de diseño; el esquema formal es el entregable del WS3.

**Límites honestos del ADO-first** (no ocultarlos):
- El **ingreso no sale de la cédula** → proxy de buró (patrón Pullman `aciertaQuanto`, ya existente), Abaco
  (gig) o 1 campo declarado. Es el único dato no-gratis.
- **Consentimiento/habeas data y OTP de firma** son legales: quedan (el teléfono puede pedirse al final).
- **OCR no es 100%** → el scan aporta liveness + número de documento; los datos autoritativos vienen de
  Registraduría/TusDatos por número. Fallback manual para lecturas fallidas.
- La captura es foto fija (`<input capture>`); subir a *liveness activa* (`getUserMedia`) es upgrade opcional,
  también in-web y sin redirección.

---

## 4. Workstreams

### WS1 · Quick wins (horas–días, riesgo bajo) — arrancan YA

| # | Acción | Evidencia | Impacto |
|---|---|---|---|
| 1.1 | **Poda suave de los 51 lenders muertos**: `UPDATE lenders SET status=0` (+ opcional `status=0` en `lenders_by_allied(_branch)s`). **NO DELETE**: solo 5 FKs declaradas pero ~50 tablas + 8 vistas `VW_*` usan `lender_id` sin constraint → historial huérfano. | El path vivo ya filtra `status=1` (`LenderListingService.php:92`); 43/51 son rt=2/3 marca-blanca "X" | –33% de catálogo atravesando la cascada de perfilamiento; 100% reversible. **Prerrequisito: validar 0-uso contra PROD** (esto es mirror dev) |
| 1.2 | **Bug real:** guard imposible `id==68 && id==133` | `application SelfManagerController.php:86` | Un código de barras Corbeta ya redimido puede reprocesarse (riesgo de doble facturación) |
| 1.3 | **Paridad Welli antes del cutover:** `pendiente_desembolso => 11` sella como desembolsado un crédito que no lo está (`application` lo mapea a 28) | `legacy app/Actions/Lenders/Welli.php:37-40` (TODO `[PARIDAD]` explícito) | Evita Estado 11 prematuro si el cutover activa Welli en legacy |
| 1.4 | **Centralizar array Corbeta** `[209,210,211]` (9 sitios → `config('services.corbeta.allied_ids')`, el bloque `services.corbeta` ya existe) | `User.php:314`, `OnboardingController.php:832,1319` (autofill duplicado), etc. | Alta de comercio Corbeta = 1 config, no 6 archivos |
| 1.5 | **Enum de estados + EAV:** `UserRequestStatus::DISBURSED=11` (~80 sitios legacy), `UserFieldId::{INCOME=87, OCCUPATION=29, …}` (~60 sitios) | grep verificado | Reemplazo mecánico grep-driven; elimina la clase entera de "magic number" |
| 1.6 | **SmartPay 160 literal en el path viejo** → `config('lenders.smartpay_lender_id')` | `LenderRetrievalService.php:~270` (`$hasLender160 … === 160`) | En dev ese branch nunca corre (160 no existe) — divergencia dev/prod invisible |
| 1.7 | **Decidir el filtro `TEMPORAL [12,23,141,142,166]`**: vive SOLO en el path viejo (`LenderRetrievalService.php:248-256`); el v2 no lo replica | grep verificado | O ya no hace falta (borrar con el path viejo) o hay que portarlo consciente a config — decisión de 1 hora |

### WS2 · Borrar código muerto (horas–días, riesgo bajo)

| # | Qué se borra | Evidencia |
|---|---|---|
| 2.1 | **4 webhook controllers rt=1 sin ruta** en legacy (Approbe, BancoDeBogota, Payvalida, Sistecredito). Al cutover rt=1 se re-portan desde `application` **detrás del adaptador**, no se resucitan estas copias desfasadas | R3; ver [PENDIENTES-MIGRACION.md](../codigo/PENDIENTES-MIGRACION.md) §P0.2 |
| 2.2 | **Servicing copiado que nunca corre** en legacy: comandos sin schedule (`UpdateCreditopXRequestsCommand` etc.), controllers sin ruta, **imports colgantes que reventarían si se agendaran**. No es un punto de partida: es un intento abandonado | R4; `Kernel.php:15-18` solo agenda device-lock + crosscore |
| 2.3 | **FE: `packages/form-engine`** (sin consumidor real) + ruta huérfana `routes/dynamic/dynamic.tsx` + stories + deps en 2 `package.json` | R7 |
| 2.4 | **Rama else muerta** `Experian::quanto` (la guardia exterior ya garantiza la condición) | `OnboardingService.php:786-790` |

### WS3 · Manifiestos declarativos: branching → config (semanas)

Los **10 branches "movibles"** clasificados, con su campo destino (la semilla del esquema):

| Branch hoy | Destino en manifiesto |
|---|---|
| `stratum_field_allieds` exige estrato (`OnboardingService:292`) | `merchant_profile.form.stratum_required` |
| `kyc_document_not_found_bypass` (`:484`) | `merchant_profile.kyc.document_not_found_bypass` (default off) |
| `commerceHasCreditopX` crea ledger (`:855`) | efecto declarado del cierre rt=2/3 en `lender_integration`/`mode` |
| `validateCorbetaOnboarding` → ONB006 (`:1941`) | `merchant_profile.onboarding_variant: corbeta` |
| `passTusDatos` por canal (`:442`) | `channel.kyc.level` |
| `terms_and_conditions_id=18` + `ENABLED_LENDERS_FOR_LEGAL` (`OnboardingController:119,812`) | `lender_integration.legal.terms_id` / `mode.terms` |
| `isMotaiRenting` fuerza `corbetaOnboarding=false` (`:1216`) | precedencia declarativa de `mode` (parche de colisión muere) |
| renting salta buró → Abaco (`:1279`) | `mode.risk` declara su **plan de fan-out** (sin Datacrédito, con Abaco) |
| `errorCode ONB006` enruta al FE (`:1354`) | el FE lee `onboarding_variant` del payload, no un código de error |
| `attachMotaiRentingModeIfNeeded` + `MODE_ID=2` (`:1577`) | `channel.mode_id` resuelto del manifiesto |

Entregables: esquema formal de los 4 manifiestos (campos/tipos/enums/obligatorios) + validación al cargar +
3 manifiestos ejemplo (Pullman, Motai, SmartPay) + **suite de conformidad** en el harness como gate de alta.
Hacerlo junto con WS1.4/1.5 (comparten los mismos literales). R5 y R11 se cierran aquí.

### WS4 · Onboarding ADO-first (semanas; pilotar con 1 comercio)

Los **17 branches "eliminables"** mueren porque el fan-out por documento hace para TODOS lo que hoy se decide
por comercio. Los más ilustrativos:

- **Inyección de ingreso Pullman/DFS** (`:760-802` — `aciertaQuanto` + `userViability` con sub-ifs por comercio)
  → el buró + proxy-ingreso corren incondicionales en el fan-out.
- **Autofill dummy Corbeta/Pash 1.5M** — **duplicado** en `OnboardingController:832` y `:1319` → muere dos veces.
- **Bypass PEP** (`:314` — salta KYC + inyecta laboral dummy) → el fan-out define plan por tipo de documento
  (PEP: sin Datacrédito, ingreso vía Abaco).
- **`shouldUseManualBirthDate`** (allied 272 + 6 lenders, `:247`) → el scan entrega la fecha real para todos.
- **Split Flow A/Flow B** por sesión (`:616`) → desaparece la dicotomía y todo el árbol Flow B.
- **`validatePreApproveLender`** (129 LOC, filtro `[12,141,142,166]`, `:1781`) y **`alliedsLendersValidator`**
  (68 LOC, `experian_trigger_allieds`, `:1661`) → mueren enteros; la pre-aprobación vive en el MS (WS5/R10).

**Resultado neto en el god-service:** 10 métodos se eliminan (~297 LOC), 7 se mueven (~460 LOC),
`storePersonalInfo` baja de ~783 a ~250 LOC. **1.959 → ~600-650 LOC.** Quedan 3 branches core:
rate-limit ONB040 (`:145`), validación `checkdate` (`:209`), validación CC vs CE/PEP (`PersonalInfoRequest:30`).

En el FE (R9): las **4 variantes** de captura personal/laboral (tronco clásico, Motai, Bancolombia, dynamic-form)
convergen en un flujo único de captura; pantallas de error unificadas con copy por config. ~18 → ~8 pantallas.

#### Modelo de identidad, firma y contacto (decisión de diseño del ADO-first)

Separación conceptual que ordena todo el rediseño — *"la cara es la identidad; el código es el respaldo; el teléfono es el buzón"*:

| Función | Quién la cumple | Base en código |
|---|---|---|
| **Identidad** (¿quién sos?) | Cédula + biometría ADO (selfie + liveness + match) | Captura in-web ya construida; `AdoService` |
| **Voluntad / firma** (¿aceptás?) | **Biometría como ancla** primaria; OTP como fallback | Hoy el ancla es débil: checkbox + celular sin verificar; solo **80 de 219.295** filas de consentimiento linkean `otp_id`. El Decreto 2364/2012 admite explícitamente "datos biométricos" como firma electrónica |
| **Contacto** (¿dónde te hablo?) | Celular + email, verificados por **entregabilidad** (no identidad) | `OtpService::sendOtpCodeViaEmail` (`OtpService.php:499`) **ya existe** con flag `$fromPromissoryNote` — el email como canal alternativo del mismo código está construido al 80%. El modelo `Otp` sigue keyed por `cell_phone` |
| **Retorno / "login"** (volver a entrar) | Selfie contra el enrolamiento (ADO ya trae semántica **enroll/verify**: `AdoEnrollCallbackRequest` + `AdoVerifyCallbackRequest`) | Encaja directo con revolving rt=3: segunda compra = selfie → cupo, sin OTP ni formulario |

Reglas derivadas: **un solo código** cuando se use OTP (canal a elección WhatsApp/email; nunca doble validación obligatoria — duplica fricción sin sumar seguridad proporcional); *step-up* (doble factor) solo para perfiles de riesgo alto, declarado por config (`signature: { anchor, channels, step_up }` en el manifiesto); el celular sigue siendo **imprescindible como contacto** para servicing (cobranza, recordatorios, device-lock SmartPay, QR asesor) — se captura en la firma, no al inicio.

> ⚠️ **Caveat Deceval:** el pagaré desmaterializado se firma vía SOAP con Deceval y hoy el ritual escribe `otp_id` (`DocumentSigningService`). Si el contrato/API de Deceval exige OTP en su ceremonia, la firma biométrica aplica solo a pagarés `traditional`/PDF hasta renegociar. **Verificar con Deceval antes de comprometer el diseño** (pregunta abierta §8.6). Fallback siempre necesario: biometría falla (cámara/luz/no-match) → OTP (patrón Evidente ya existente).

Prototipo clickeable del flujo (validado contra código, 46 claims): `https://claude.ai/code/artifact/6fec5b40-b9dd-4d0e-b051-7650f8130caa`.

### WS5 · Convergencia de dobles motores (semanas; con shadow-run)

| Redundancia | Acción | Riesgo |
|---|---|---|
| **R1 — doble path marketplace**: `lenders` (viejo) + `lenders-v2` (vivo), ambos ruteados (`api.php:48-49`) | Retirar `ListLenderController@index` + ruta; migrar `CreditStudyService` a `LenderListingService`; colapsar la herencia `LenderRetrievalService→LenderListingService`. ⚠️ verificar consumidores backend del path viejo antes | medio |
| **R10 — doble pre-aprobación**: `PreApprovedLenderService` (929 LOC, `if($lender->id==N)` por lender) vs MS Go | Portar los adapters restantes (Bancolombia) al `pre-approvals-service`; borrar `validatePreApproveLender` junto con R1. El manifiesto `lender_integration` reemplaza el switch | medio |
| **R2 — dos motores Datacrédito con semántica OPUESTA**: `RiskCentralValidationService` (rt≠2: `score <`, `maturation <=`) vs `DatacreditoRuleEvaluator` (rt=2: `score >=`, fail-closed) | Converger a **un evaluador paramétrico** (campos como config por lender). **Obligatorio shadow-run**: correr ambos en paralelo y comparar veredictos antes de apagar uno — las semánticas invertidas son trampa de regresión | **alto** |

### WS6 · Cutover del strangler (continuo; el más largo)

**R8:** la originación completa está duplicada y VIVA en ambos monolitos (`application routes/customer.php:116-144`
vs legacy `Modules/Onboarding`), ruteada por allowlist por comercio. Plan: expandir la allowlist
comercio-a-comercio → cutover total → **decomisar las rutas de originación de `application`**.
El servicing NO entra aquí (decisión previa: fuera de alcance; ver
[CONTINUACION-CREDITO-ANALISIS.md](../codigo/CONTINUACION-CREDITO-ANALISIS.md)).
Cada comercio migrado debe pasar la **suite de conformidad** antes del switch — el harness E2E es el gate.

---

## 5. Fases y secuencia

| Fase | Semanas | Contenido | Criterio de salida |
|---|---|---|---|
| **P0 — limpiar** | 1–2 | WS1 completo + WS2 completo | Métricas 1.1–1.7 y 2.1–2.4 en target; poda validada contra prod |
| **P1 — un solo camino** | 3–6 | R1 (path único marketplace) + R10 (pre-aprobación → MS) + esquema de manifiestos v1 (WS3) con Pullman como piloto | `lenders/` retirado; `validatePreApproveLender` borrado; 1 comercio corriendo 100% por manifiesto |
| **P2 — ADO-first** | 6–12 | WS4 pilotado con 1 comercio (sugerido: Pullman, ya auto-inyecta ingreso) + R2 en shadow-run + resto de manifiestos | God-service ≤700 LOC; branches ≤3+manifiestos; shadow-run Datacrédito con paridad medida |
| **P3 — converger** | continuo | WS6 (allowlist → cutover → decomiso originación en `application`) + suite de conformidad como gate permanente | % de originación en legacy = 100%; alta de tercero = manifiesto + conformidad, sin tocar núcleo |

**Regla de oro de secuencia:** P0 y P1 no dependen del rediseño ADO-first — son valor inmediato aunque P2 se
posponga. P2 se pilota con **un** comercio antes de generalizar. R2 jamás se apaga sin shadow-run.

---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El mirror dev ≠ prod (la poda de 51 se midió en dev) | Correr la misma query contra prod antes del `status=0`; la baja es reversible |
| Semánticas opuestas en R2 (score `<` vs `>=`) | Shadow-run con comparación de veredictos; converger config por lender, no "elegir un ganador" a ojo |
| El path viejo `lenders/` puede tener consumidores backend no-FE | Grep de consumidores + log de acceso en la ruta 2 semanas antes de retirar |
| OCR falla / thin-file sin buró | Fallback manual de corrección + plan thin-file (Abaco/Evidente/campo declarado) — ya existen como proveedores |
| Manifiestos = nueva superficie de error (config sprawl) | Validación de esquema al cargar (falla fuerte y temprano) + versionado + suite de conformidad obligatoria |
| Legal (habeas data, OTP firma) | No se toca: quedan como pasos core (3 branches que sobreviven) |
| Colisión de namespace en greps (field 160 vs lender 160) | El enum `UserFieldId` separa los usos EAV de los usos lender (WS1.5/1.6) |

## 7. Qué NO se toca (activos, no deuda)

1. **El motor de reglas** (`group_rules`/`lender_rules`/`lender_datacredito_rules`/categorías — 37.859 reglas):
   ya es data-driven; es el modelo a extender, no a reescribir.
2. **Los proveedores de identidad y riesgo** (ADO, TusDatos, Datacrédito/Experian, Abaco, CrossCore, Evidente):
   el puerto multi-proveedor ya existe (`WritableIdentityValidationRepository`); ADO-first los orquesta distinto,
   no los reemplaza.
3. **El servicing** (cartera/cobranza/revolving en `application`): fuera de alcance de este plan (decisión previa).
4. **Los pasos legales**: consentimiento/habeas data, OTP de firma, rate-limit anti-abuso.

## 8. Decisiones abiertas (negocio)

1. **Poda:** ¿confirmamos contra prod y ejecutamos el `status=0` de los 51? ¿Alguno de los 43 "X" marca-blanca
   tiene plan comercial vivo?
2. **rt=4 (Credifamilia):** ¿se formaliza como fila del catálogo `response_types` o queda documentado como
   "valor sin fila"? (afecta el esquema del manifiesto `lender_integration`).
3. **Piloto ADO-first:** ¿Pullman (ya auto-inyecta ingreso, menor delta) u otro comercio?
4. **Liveness activa** (`getUserMedia`) vs foto fija actual: ¿se incluye en P2 o se difiere?
5. **Filtro `[12,23,141,142,166]`** (WS1.7): ¿los 5 lenders ya funcionan en v2 (borrar) o se porta a config?
6. **Deceval y firma biométrica:** ¿la ceremonia de firma de Deceval (pagaré desmaterializado) acepta ancla
   biométrica en lugar de OTP, o el OTP es requisito contractual? Define el alcance de la firma-con-rostro
   (todo vs solo pagarés `traditional`/PDF). **Consultar con Deceval / legal.**
7. **Compliance del ancla biométrica:** validar con legal que selfie+liveness+match como firma electrónica
   (Decreto 2364/2012) reemplaza al OTP para consentimiento habeas data y pagaré. Nota: el ancla actual es
   más débil (checkbox + celular sin verificar), así que el cambio *sube* el estándar probatorio.

---

*Métricas de re-verificación: las queries y greps de la línea base (§2) son re-ejecutables para medir avance
por fase. El harness `backend-e2e` es la suite de conformidad desde P1.*
