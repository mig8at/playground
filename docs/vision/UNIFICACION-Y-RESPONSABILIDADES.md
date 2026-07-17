# Unificación y separación de responsabilidades — el modelo ordenado detrás de Motai, Alta y el renting

> **Qué es este documento.** Un puente entre tres piezas que hoy miran el mismo problema desde ángulos
> distintos:
> - el **PRD MVP2 de Manuela** (el *qué* necesita el negocio: renting, rent-to-own, política de riesgo, codeudor),
> - el **Análisis de Brechas de José** (el *cómo* cerrarlo con el mínimo esfuerzo y bajo riesgo, para sostener la operación de forma transitoria),
> - y **nuestro análisis estructural** (el *por qué* un modelo unificado y con responsabilidades separadas resuelve las dos cosas **y además ordena la aplicación a futuro**).
>
> No reemplaza a los otros dos: los **conecta y les da destino**. Está escrito para negocio y tecnología por igual;
> el detalle técnico está para respaldar el *por qué*, no para exigir leerlo.

---

## 0. Resumen ejecutivo (TL;DR)

> **En una frase:** hoy CreditOp **se adapta a cada comercio** (cada caso está "cosido" dentro del código); el objetivo es **un modelo único que se configura**, al que los comercios se adaptan.

**El problema** — cada comercio nuevo (Motai, Alta, …) se resuelve con condicionales quemados que viajan por todo el flujo: no escala (tocás código en varios lugares por comercio), reglas duplicadas (~37.000 copias por sucursal, ~5% ya derivada), todo disperso (documentos/PEP/calculadora/"modo" quemados y repartidos FE+BE, la fórmula incluso duplicada), y producto y decisión mezclados en una sola bandera. **Raíz:** no hay estándar, hay un traje a medida por comercio.

**Cómo lo resolvemos** — un modelo unificado con responsabilidades separadas, en dos movimientos: (1) **Unificar** — los productos (compra/renting/rent-to-own) son entradas de catálogo, no un `if`; documentos, cálculo y reglas pasan a config → sumar un comercio = agregar una fila. (2) **Separar responsabilidades** — el *producto* (qué se contrata) aparte del *underwriting/decisión* (cómo se aprueba); la política vive en niveles con herencia (base → producto → acuerdo): **se hereda, no se copia**; el administrador decide con la recomendación del motor.

**Cómo se llega** — por etapas, sin reescribir: extendiendo los patrones que ya están bien hechos (config por columna, catálogo de entidades). Ya prototipado y demostrado en `playground/flow` (catálogo, niveles, herencia con override borrable).

**El resultado** — comercio nuevo = una fila · cero deriva de reglas · producto y riesgo desacoplados · una aplicación ordenada que escala.

*(El resto del documento es el detalle y la evidencia con `archivo:línea`.)*

---

## 1. Las tres piezas, en una foto

| Documento | Qué aporta | Horizonte | Postura |
|---|---|---|---|
| **PRD MVP2 (Manuela)** | El *qué*: automatizar el flujo de Motai con dos líneas nuevas (renting y rent-to-own), política de riesgo automática (R1–R8), codeudor, simulador y documentos de formalización. Revenue estimado **+40M/mes**. | Producto | Define la necesidad |
| **Brechas Alta vs Motai (José)** | El *cómo-mínimo*: identifica con precisión (archivo:línea) las 11 brechas que separan lo ya construido de "Motai fase final + Alta fase 1", y propone cerrarlas **reutilizando al máximo** lo existente. | **Transitorio** (sostener hasta ~nov 2026) | Conservador, bajo riesgo |
| **Este documento** | El *por qué* y el *orden*: muestra que **unificar el flujo** y **separar las responsabilidades** cubre lo que pide Manuela, cierra las brechas de José, y de paso resuelve problemas presentes que ninguna lista transitoria toca. | Estructural / a futuro | El destino, alcanzable por etapas |

**La clave de lectura:** José tiene razón en su alcance — un puente barato y de bajo riesgo para una ventana de
tiempo corta. Pero **él mismo lo dice** al final de su documento: su enfoque es *"deliberadamente básico y
transitorio… no está pensado para soportar un gran número de modalidades ni de variables… cualquier crecimiento
que supere ese marco exigirá reemplazar el backend legado"*. Este documento describe **hacia dónde debe apuntar
ese puente** para que el trabajo transitorio sea el **primer escalón** del modelo definitivo, y no deuda que haya
que rehacer.

---

## 2. El problema de fondo (los tres lo señalan, con distinto lenguaje)

Hoy **cada comercio es un traje a medida cosido dentro del código**, no un formulario que se llena. El mismo flujo
de onboarding se "dobla" para cada caso con condicionales quemados que viajan de punta a punta.

- **Manuela lo sufre:** no se puede sumar Alta (ni ningún comercio nuevo) sin tocar código en varios lugares.
- **José lo inventaría:** las brechas 4.1–4.6 son exactamente eso — documentos de TyC, opción PEP, el indicador de
  modo, la calculadora y el envío legal **quemados y dispersos** entre frontend y backend. Lo ubica archivo por
  archivo (`isMotaiRenting`, `merchant_mode === 'motai_renting'` repetido en 5 rutas, `MOTAI_LENDER_IDS = [158]`,
  la fórmula de la calculadora duplicada en dos archivos, etc.).
- **Nosotros lo medimos:** además de los hardcodes, las **reglas de riesgo se copian en cada sucursal** al asignar
  un lender (no se leen en vivo) → **~37.284 copias** de reglas duras con **~5% de deriva** (ver
  [HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md](../codigo/HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md)).

> **La causa raíz (tesis de [CREDITOP.md](../CREDITOP.md) §8):** *CreditOp se adapta a cada comercio, en vez de que
> los comercios se adapten a un estándar de CreditOp.* La explosión de "casos" no son flujos distintos: **son el
> mismo flujo con un `if` quemado.** Motai no es un módulo — es un `modo` (`isMotaiRenting`) que altera el flujo base.

---

## 3. La solución, en dos movimientos

### 3.1 Unificar — un solo flujo paramétrico

Que **incorporar un comercio o un producto sea agregar una fila de configuración, no editar condicionales.**

- **Los productos dejan de ser un `if`.** Compra financiada, renting operativo y rent-to-own dejan de vivir como
  `merchantMode === 'motai-renting'` y pasan a ser **entradas de catálogo**: *lenders CreditopX por categoría*
  (`CTPX-BUY` / `CTPX-RENT` / `CTPX-RTO`), hermanos de CrediPullman o SmartPay, que comparten la misma maquinaria
  in-platform (originación, firma, desembolso, cobranza, marketplace, motor de reglas). Detalle:
  [MOTAI-PLAN-EVOLUCION.md](../mejoras/MOTAI-PLAN-EVOLUCION.md) §10.
- **TyC, PEP, calculadora y "modo" pasan a ser config, no código.** Documentos habilitados por producto, opción
  PEP como atributo, la calculadora resuelta con parámetros (alistamiento/margen/IVA/tasa) en vez de una fórmula
  quemada y duplicada en el frontend.
- **Esto es exactamente lo que pide José en su §6** ("parámetros centralizados en listas… incorporar un comercio
  se reduce a agregar una entrada"). La diferencia: en vez de una **lista plana básica y transitoria**, le damos
  **estructura** para que escale (siguiente punto).

### 3.2 Separar responsabilidades — dejar de fundir cosas distintas en una

El `isMotaiRenting` de hoy mezcla, en una sola bandera, cosas que son independientes. El modelo las separa en ejes:

| Eje que hoy está fundido | Qué decide | Por qué separarlo |
|---|---|---|
| **Producto** (compra / renting / rent-to-own) | Documentos a firmar, cálculo del canon, comunicación al cliente | Cambiar el producto no debería tocar el riesgo, y viceversa. Permite "rent-to-own con buró" o "renting sin Ábaco" sin código nuevo. |
| **Underwriting y decisión** (fuentes de ingreso, con/sin buró, política, quién aprueba) | Si el cliente califica y con qué oferta | Es el motor de riesgo, reusable entre productos. |
| **Nivel de la política** (base → producto → acuerdo con el comercio) | De dónde sale cada regla y quién puede cambiarla | Evita las 37k copias: se **hereda**, no se copia (ver §6). |
| **Los dos sombreros** (bróker rt=0/1 vs operador rt=2/3) | Quién presta, quién decide, quién cobra la cartera | Es la distinción de negocio más importante ([CREDITOP.md](../CREDITOP.md) §1). |
| **Actores** (asesor comercial vs administrador) | Quién ve qué pantalla y quién toma la decisión final | Es justo la brecha 4.7–4.11 de José: la decisión se muda del asesor al administrador. |

> **Síntesis linda:** el propio título de Manuela — *"Política de Riesgo — Motai Renting en Creditop X"* — ya nombra
> tres de estos niveles sin proponérselo: **CreditopX** (la familia, nivel base) · **Renting** (el producto) ·
> **Motai** (el comercio → el acuerdo). El modelo solo le pone **dirección** a cada regla: quién la define y quién
> puede ajustarla. Eso es lo que se pierde en una lista R1–R8 plana.

---

## 4. Cómo cubre lo que pide Manuela (PRD MVP2)

| Necesidad del PRD | Cómo la resuelve el modelo | Dónde vive |
|---|---|---|
| **Simulador renting / rent-to-own** (calculadora con factores, amortización) | Calculadora **paramétrica del lado del servidor** (alistamiento/margen/IVA/tasa/planes como config del producto), no quemada en el frontend | Producto (config) |
| **Política de riesgo automática R1–R8** | Reglas repartidas por **nivel**: buró 100%, carga mensual, endeudamiento → **base**; canon 150–300k, carga semanal → **producto arrendamiento**; ajustes por comercio → **acuerdo**. Motor único que **recomienda**, no reemplaza al humano | Base + producto + acuerdo |
| **Codeudor** | Una **regla condicional** ("ingreso < X → exige codeudor con score ≥ 650"), no un caso aparte | Base (aplica a la familia) |
| **Documentos de formalización** (renting: contrato+pagaré; RTO: +garantía mobiliaria) | **Documentos por producto** (atributo), no un `if` por lender. El patrón de firma/custodia de Credifamilia (S3 + PDF + firma) se generaliza | Producto |
| **Perfil App vs No-App** | **Segmento de ingresos**: *gig* (por apps → Ábaco) vs *tradicional* (AgilData/Mareigua/TusDatos). Ábaco ya está construido; se habilita por config | Datos (no reglas) |
| **Decisión: directa / condicional / rechazo** | Resultado del motor = **Aprobado / Aprobado con codeudor / Rechazado**, presentado al **administrador** para decisión asistida | Underwriting + actor admin |

> **Bonus de orden:** de paso corrige la **inversión de terminología** que arrastra el PRD y el código (el
> "renting" del código es el "rent-to-own" del negocio). Glosario canónico en
> [NOMENCLATURA-NEGOCIO.md](../negocio/NOMENCLATURA-NEGOCIO.md).

---

## 5. Cómo cierra las brechas de José

Las 11 brechas caen en dos grupos, y cada grupo lo resuelve uno de los dos movimientos del §3.

**Brechas de código (4.1–4.6) → las cierra la _unificación_ (config, no código):**

| Brecha (José) | Cómo la resuelve el modelo |
|---|---|
| 4.1 TyC hardcodeado y disperso | Documentos **habilitados por producto/comercio** en config; un solo mecanismo |
| 4.2 PEP hardcodeado (FE+BE) | PEP como **atributo del tipo de documento**, no condicional repartido |
| 4.3 Indicador de modo vía sesión del frontend | El "modo" **desaparece**: el producto es una entrada de catálogo (lender CreditopX), no una bandera que viaja |
| 4.4 Calculadora quemada y ejecutada en el frontend | Cálculo **paramétrico en el servidor**; una sola fuente (hoy la fórmula está **duplicada** en dos archivos) |
| 4.5 Envío de TyC acoplado a Credifamilia | Envío/firma **generalizado por producto**, no atado a un lender |
| 4.6 Plantillas de TyC en S3 y en el MS de firma | Plantillas como **config versionada** por producto |

**Brechas operativas (4.7–4.11) → las cierra la _separación de actores_:**

| Brecha (José) | Cómo la resuelve el modelo |
|---|---|
| 4.7 El perfil financiero pasa al **administrador** | Se formaliza el actor "administrador" como responsable de la **decisión** (separado del asesor que arma la solicitud) |
| 4.8 Habilitar Ábaco | Se habilita por **config del producto** (`isAbacoRequired`), no por código |
| 4.9 / 4.10 / 4.11 Ingreso del admin, desacople del asesor del *polling*, notificación al terminar Ábaco | Consecuencias directas de separar **quién arma** (asesor) de **quién decide** (admin): cada actor tiene su vista y su disparador |

> **Todas las brechas de José se cubren.** La diferencia no es *qué* se resuelve, sino *cómo*: José las cierra con
> el **mínimo** (una lista básica, suficiente para pocos comercios y una ventana corta); el modelo las cierra con
> **estructura** (que escala y no hay que rehacer).

---

## 6. Por qué el modelo es más sólido — y por qué es compatible con el puente de José

José cierra su documento con honestidad: su solución *"no está pensada para soportar un gran número de modalidades
ni de variables, ni un alto volumen de tráfico, ni constituye una solución mantenible a gran escala… cualquier
crecimiento exigirá reemplazar el backend legado"*. Ese es precisamente el hueco que este modelo llena, con tres
diferencias que lo hacen más sólido:

1. **Escala a muchas modalidades y comercios.** La lista plana de José sirve para "unos pocos comercios"; el modelo
   —productos como catálogo + política por niveles— soporta N comercios y N productos **sin tocar código**.
2. **Resuelve problemas presentes que la lista no toca.** El más importante: la **copia de reglas por sucursal**
   (37k copias, deriva). El modelo usa **herencia con override, no copia**: si un comercio no configura una regla,
   **usa la de la política base en vivo**; cada cambio crea una **edición borrable** que vuelve al default. Cero
   deriva, y "¿qué cambió este comercio?" pasa a ser una pregunta trivial. *(Este modelo ya está **funcionando y
   demostrado** en el simulador `playground/flow`: puntos gris = heredado / amarillo = editado, con clic para
   revertir.)*
3. **Se llega por etapas, sin rewrite.** No requiere reemplazar el backend de golpe. **La lista de José es
   literalmente el primer paso**; solo hay que darle forma: en vez de una lista plana, ejes separados (§3.2) y
   herencia (punto 2). El plan escalonado está en [PLAN-ACCION-SIMPLIFICACION.md](../mejoras/PLAN-ACCION-SIMPLIFICACION.md)
   y [MOTAI-PLAN-EVOLUCION.md](../mejoras/MOTAI-PLAN-EVOLUCION.md) (etapas E0–E4).

> En una frase: **el puente de José y este modelo no compiten.** El puente resuelve el *ahora*; el modelo asegura
> que ese puente se construya apuntando al lugar correcto, para que cada cosa que se haga transitoriamente sume al
> destino en vez de convertirse en deuda.

---

## 7. El orden que deja en la aplicación (el deber-ser)

Cuando el modelo está en pie, la aplicación queda así de ordenada:

- **Comercio nuevo** = una fila de configuración (qué productos ofrece, qué lenders, qué ajustes de política).
- **Lender nuevo** = implementa un **contrato estándar** (en vez de una clase a medida por banco).
- **Producto nuevo** = una entrada de catálogo + una plantilla de reglas heredable.
- **Política** = niveles con herencia (base → producto → acuerdo), editable sin copiar, auditable.
- **Decisión** = motor que recomienda + actor (administrador) que decide, con responsabilidades claras.
- **Los dos sombreros** quedan explícitos: dónde CreditOp es bróker (rt=0/1) y dónde es operador (rt=2/3).

El resultado: menos código, menos `if` por ID, menos duplicación, y un flujo que **cualquiera puede extender por
configuración**.

---

## 8. Qué NO cambia (respeto al trabajo ya hecho)

Para que quede claro que esto **no tira nada** de lo construido:

- **Reutiliza todo Motai fase 1 y Credifamilia** (onboarding, Ábaco, OTP, firma, mensajería) — igual que propone José.
- **No propone microservicios nuevos ni un rewrite** — el trabajo puede vivir sobre legacy-backend, por etapas.
- **Es compatible con la ventana transitoria** — se puede empezar por las brechas de José, pero dándoles la forma
  del modelo (catálogo + ejes + herencia) desde el primer commit.
- La única diferencia real: en vez de una **lista que habrá que tirar cuando llegue el volumen**, una **estructura
  que crece con el negocio**.

---

## 9. Recomendación

**Construir el puente de José, pero con la estructura del modelo.** En concreto:

1. Cerrar las brechas 4.1–4.6 moviendo el hardcode a **config**, pero organizando esa config como **catálogo de
   productos + niveles de política** (no como una lista plana).
2. Formalizar la **separación producto ↔ underwriting** y el **actor administrador** (brechas 4.7–4.11) desde el
   arranque.
3. Adoptar **herencia con override (no copia)** para la política de riesgo — ya validado en el simulador.
4. Usar el **glosario canónico** en PRDs, contratos y pantallas para cerrar la ambigüedad de nombres.

Así, el esfuerzo transitorio que igual hay que hacer para Motai/Alta se convierte en el **primer escalón** del
CreditOp ordenado, y no en deuda técnica futura.

---

## Apéndice — Fuente (dónde viven las fallas, con archivo:línea)

> Cada referencia está **verificada** y etiquetada por origen: **[LQ]** = re-grep del código + BD local
> ([LOGICA-QUEMADA.md](../codigo/LOGICA-QUEMADA.md)) · **[J]** = análisis de brechas de José (rama `develop`, jun-2026:
> legacy-backend commit `70e910d`, frontend commit `181b8c41`) · **[H]** =
> [HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md](../codigo/HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md) · **[A]** = mapeo del
> admin visual + verificación adversarial ([ADMIN-ALTA-OPERACION.md](../codigo/ADMIN-ALTA-OPERACION.md), 2026-07-08).

**Los tres repos involucrados** (el mapeo real es más preciso que "application vs legacy"):

| Repo | Qué es | Qué falla vive acá |
|---|---|---|
| **`legacy-backend`** (Laravel modular) | La **nueva** originación/onboarding | La mayoría de los bypasses y hardcodes de onboarding |
| **`frontend-monorepo`** (wizard React) | El **nuevo** front de onboarding (`loan-request-wizard`) | Modo por sesión, calculadora quemada+duplicada, PEP, IDs de lender |
| **`bitbucket/application`** (monolito Vue + PHP) | El sistema **viejo**: front Vue legacy + **todo el servicing/cartera** + **el ADMIN de configuración** (alta de comercios/sucursales/entidades/reglas) | Los `if id==N` en `.vue`; la cartera post-desembolso; y **el panel que dispara la copia de reglas** [A] |

> Aclaración: el onboarding "quemado por comercio" vive sobre todo en el **stack nuevo** (legacy-backend + wizard
> React). En `application` está el acoplamiento por ID del front viejo (`.vue`) y el servicing. Los `.vue` con
> `if id==N` **no** están en el wizard React. [LQ §0]

### Falla 1 — El comercio/producto es un `if`, no una entrada de catálogo

| Dónde | archivo:línea | repo | fuente |
|---|---|---|---|
| Motai como *modo* (`MOTAI_RENTING_ALLIED_MODE_ID=2`, cadena `merchant_mode==='motai_renting'`) | `Modules/Onboarding/App/Http/Controllers/OnboardingController.php:36, 1160, 1149, 1472` | legacy-backend | [LQ §3] [J] |
| Origen del indicador de modo (sesión del front) + comparación repetida en **5 rutas** | `merchant-mode.tsx:20,24`; rutas `phone-number:103 / otp-verification:63 / loan-request-form:80`, `bancolombia/onboarding otp:155 / register:90` | frontend-monorepo | [J 4.3] |
| ID de Motai quemado en el front | `lenders-marketplace/.../lender.constants.ts:12` (`MOTAI_LENDER_IDS=[158]`) | frontend-monorepo | [J] |
| Forking de entrada por comercio (Pullman 94, DENTIX 189) | `OnboardingService.php:491,572,668,694-695`; `DatacreditoQueryByAlliedController.php:77,81` | legacy-backend | [LQ §3] |
| `if id==N` en el front viejo (decenas de `v-if` por allied/lender) | `resources/js/.../v2/ListLenders.vue:662,1092,2780`; `WelcomeUser.vue:8`; `RequestsTable.vue:101` | bitbucket/application | [LQ §3, §8] |

**→ La mejora:** el producto es una **entrada de catálogo** (lender CreditopX por categoría CTPX-BUY/RENT/RTO); el
"modo" desaparece y es la **categoría** la que dispara el comportamiento, no el `id`. (Diseño: [MOTAI-PLAN-EVOLUCION.md](../mejoras/MOTAI-PLAN-EVOLUCION.md) §10; demostrado en el simulador.)

### Falla 2 — Reglas copiadas por sucursal (no se heredan)

| Dónde | archivo:línea | repo | fuente |
|---|---|---|---|
| **El disparo real (el panel que se usa)**: habilitar la entidad en la SUCURSAL — no al asignarla al comercio | `AlliedBranchEdit.vue:153-164` (PUT `admin.allieds.branches.update`) → `AlliedAlliedBranchController::update:102` → foreach `:127` → `addNewRule:142` + `addNewLenderRule:143` | **application** | [A] |
| La copia de reglas duras | `LenderRulesController::addNewLenderRule:330` — lee plantilla (`group_rule_id=NULL`, :332), crea `GroupRule 'AB'+branchId` (:344) y **clona cada fila** (:350) | application | [A] |
| La copia de datacrédito + default BdB | `LenderDatacreditoRulesController::addNewRule:75` — plantilla `allied_branch_id=NULL` (:96); sin plantilla → **default `lender_id=5` inline** (:102) | application | [A] [H] |
| **Segundo disparador**: crear credencial e-commerce también copia | `AlliedEcommerceCredentialsController@store:96-99` | application | [A] |
| **Huérfanas**: quitar el lender no borra las copias | `AlliedLenderController::destroy` (borra asignaciones, deja `group_rules`/`lender_rules`) | application | [A] |
| **Gemelo del mecanismo** (mismo copiador, duplicado entre repos) | `Partner/App/Services/AlliedManagementService.php:257-258` → `LenderRuleManagementService.php:399-422`; default `LenderRuleRepository::findDefaultDatacreditoRule():148` (`lender_id=5`) | legacy-backend | [A] [H] |
| Evaluación de la **copia** (no de la plantilla) | `Modules/Onboarding/App/Services/lenders/LenderListingService.php` + `LenderValidationService.php` (duras) + `RiskCentralValidationService.php` (datacrédito) | legacy-backend | [H] |
| Tablas | `lender_rules` (plantilla `group_rule_id NULL` / copia por sucursal) · `lender_datacredito_rules` (plantilla `allied_branch_id NULL` / copia por sucursal) | BD `creditop` | [H] |

Escala del daño: **37.284 copias** de reglas duras (**5% ya derivó**); **42 entidades sin política de buró propia**
corriendo el corte de Banco de Bogotá (score 640) sin decisión explícita. [H §2] Matices: la copia es idempotente,
el datacrédito solo se copia para Colombia (`country_id==47`) — las duras siempre — y el "aplicar a todas" del
editor de reglas **crea más copias, no corrige las viejas**. [A]

**→ La mejora:** **herencia con override, no copia** — la sucursal/acuerdo guarda **solo excepciones** y se lee la
base en vivo. Es literal el "modelo recomendado" que el propio hallazgo le plantea a negocio ([H §5]) y el que **ya
está funcionando en el prototipo** (override disperso: gris = heredado, amarillo = editado, clic para revertir).

### Falla 3 — Todo quemado y disperso (TyC, PEP, calculadora, modo)

| Dónde | archivo:línea | repo | fuente |
|---|---|---|---|
| IDs de TyC dispersos y **duplicados** (13/16/17/18) | `RegisterCellPhoneService.php:411,421,427,442`; **duplicado** en `UserService.php:325,339,345,362`; `OnboardingController.php:120,754,756` | legacy-backend | [LQ §4] [J 4.1] |
| Envío legal atado a Credifamilia (lender 24 como único disparador) | `LegalService.php:31` (`ENABLED_LENDERS_FOR_LEGAL=[24]`), `:35-36` (slugs pdf-mapper), `:40-41` (plantilla WhatsApp) | legacy-backend | [J 4.5] |
| PEP quemado (bypass) FE+BE | `OnboardingService.php:293` (`$isPEP = document_type==='PEP'`); front `document-type.ts:3,8`, `personal-info-form.tsx:51,53-57`, `init-loan-request.tsx:158` (`nationality:'VENEZOLANA'`) | legacy-backend + frontend-monorepo | [J 4.2] |
| Calculadora quemada **y duplicada** en el front | `LenderCardContent.tsx:214-222` (alistamiento 1.5M, margen 1, IVA 0.19) **y** `useLenderSelection.ts:81-88` (misma fórmula, riesgo de divergencia); excepción `AvailableLenders.tsx:160-164` | frontend-monorepo | [J 4.4] |
| Ruta del backend embebida en el front | `financial-profile.repository.ts:46` (`/api/onboarding/motai/update-status`) | frontend-monorepo | [J] |

**→ La mejora:** **config, no código** — documentos, PEP y parámetros de la calculadora (alistamiento/margen/IVA/tasa/planes)
como **configuración por producto**, resueltos del lado del servidor y en **una sola fuente**. Sumar un comercio = una fila.

### Falla 4 — Producto y decisión fundidos + bypass de buró

| Dónde | archivo:línea | repo | fuente |
|---|---|---|---|
| Un solo flag dispara el bypass y fuerza `corbeta_onboarding=false` | `OnboardingController.php:1160` (`merchant_mode==='motai_renting'`) | legacy-backend | [J 3.3] [LQ §3] |
| Se **omite el motor de viabilidad** → no se consulta Datacrédito | `DatacreditoQueryByAlliedController::userViability` no se ejecuta en modo Motai | legacy-backend | [J 3.3] |
| Inyección de info laboral ficticia (1.5M) | `OnboardingService.php` `storeLaboralInformation(...,1500000,'Empleado',3)` — `:317/:714` [J] · `:254/:643` [LQ] (misma lógica, distinta línea por rama) | legacy-backend | [J] [LQ §5] |
| `lender_id=24` fijado como Credifamilia al consultar Datacrédito | `DatacreditoQueryByAlliedController.php:342` | legacy-backend | [J] |
| Punto único para habilitar Ábaco | `Modules/Onboarding/routes/api.php:196` (`motai/check-abaco-requirement`) | legacy-backend | [J 4.8] |

**→ La mejora:** **separar producto de underwriting/decisión.** El producto define documentos/cálculo/comunicación;
el underwriting define fuentes de ingreso y política (por niveles); y el **actor administrador** decide con la
recomendación del motor (las brechas 4.7–4.11 de José son justo la aparición de ese actor). El bypass deja de ser
un `if` global y pasa a ser un atributo del producto (con/sin buró, gig vs tradicional).

### El patrón de fondo (por qué no alcanza un parche)

Los tres anti-patrones que concentran la lógica quemada [LQ §8]:
1. **Acoplamiento por ID literal** (`if lender_id==N` / `if allied_id==N`) esparcido, en vez de flag/columna.
2. **Listas duplicadas** del mismo array de allieds/lenders (backend 3-4 sitios + front) → divergencia garantizada.
3. **Sandbox/mock dentro del código** (payloads/cédulas fijas bajo `!isProduction()`).

Mover ese hardcode a una **lista** ataca (parcialmente) el #2, pero deja intactos el #1 y el modelo por-comercio.
Lo que **ya está bien abstraído y es el modelo a seguir** [LQ §8]: el switch por `response_type`, la columna
`have_ctopx`, el `Setting corbeta_allieds`, las factories `PromissoryNoteSigningFactory`/`signingProvider` y la
clase base `Integration`. El camino es **extender esos patrones** (config + herencia + catálogo), no una lista plana.

> ⚠️ Aparte, un **P0 vivo** que conviene sacar en cualquier caso: `dd($exception)` en `Wompi.php:78` corta en prod
> cualquier request que toque ese path. [LQ §7]

---

### Documentos relacionados
- [CREDITOP.md](../CREDITOP.md) — modelo de negocio, los 4 ejes, los dos sombreros, la tesis de fondo (§8).
- [MOTAI-PLAN-EVOLUCION.md](../mejoras/MOTAI-PLAN-EVOLUCION.md) — plan escalonado E0–E4 y §10 (productos como lenders CreditopX).
- [DES-MOTAIZACION-CONFLUENCE.md](../mejoras/DES-MOTAIZACION-CONFLUENCE.md) — versión negocio (Confluence) del modelo de renting + plan de ejecución.
- [NOMENCLATURA-NEGOCIO.md](../negocio/NOMENCLATURA-NEGOCIO.md) — glosario canónico (14 choques de nombre).
- [PLAN-ACCION-SIMPLIFICACION.md](../mejoras/PLAN-ACCION-SIMPLIFICACION.md) — el deber-ser general (flujo único paramétrico, manifiestos).
- [HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md](../codigo/HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md) — la copia de reglas por sucursal y su deriva.
- Simulador `playground/flow` — prueba visual del modelo (catálogo de productos, niveles, herencia con override).
