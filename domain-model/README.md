# CREDITOP · ERD del deber-ser

> 📚 Este proyecto describe el **deber-ser** (el target). El estado **ACTUAL** del negocio (qué es Creditop,
> flujos, `response_type`, hardcodes, modelo de datos) está en los docs maestros [`../docs/`](../docs/) —
> empieza por [`../docs/CREDITOP.md`](../docs/CREDITOP.md). El problema que este modelo resuelve está en `../docs/NEGOCIO.md §6`.

Visualizador interactivo del **modelo de dominio (deber-ser) v4** de Creditop, construido con
**Vue 3 + [Vue Flow](https://vueflow.dev/)** (el equivalente de React Flow para Vue).

**Reemplazó a un ERD estático** previo (Cytoscape + Mermaid, ya eliminado):
pasa de un diagrama renderizado como imagen fija a un **diagrama de tablas vivo** — arrastrable,
filtrable y consultable, con **descripción de negocio por columna** — alimentado directamente por el
mismo `modelo-dominio.json`.

---

## Por qué el deber-ser es una mejora sobre la estructura de tablas actual

Esta app visualiza el **deber-ser**: una reorganización conceptual de la base de datos real de
Creditop. La mejora no es estética — es de **modelo de datos**. Hoy el esquema físico tiene
**212 tablas, 26 vistas y 42 rutinas**, con deudas estructurales que se arrastran de años. El
deber-ser las colapsa en **21 agregados / 105 entidades**, manteniendo **trazabilidad 1:1** a cada
tabla real (cada entidad declara su `legacy.tabla`, visible en el panel de detalle).

### De la estructura actual → al deber-ser

| Hoy (estructura física, 212 tablas) | Deber-ser (lo que muestra esta app) | Por qué mejora |
|---|---|---|
| 4 tablas de transacción de cierre (`lender_transactions`, `payvalida_transactions`, `sistecredito_transactions`, `payment_gateway_transactions`) | **1 entidad `LenderTransaction`** (puerto + adapter) | Agregar un lender = un adapter, no una tabla nueva ni ramas de código |
| 6 proveedores KYC, cada uno con su tabla/log (Jumio, CrossCore, Metamap, OCR, Netco…) | **1 `IdentityVerification`** + VO `Proveedor` | Cambiar/agregar proveedor sin tocar el modelo; auditoría uniforme |
| ~14 tablas de scoring / multiplicadores / profiling / buró sueltas | **`ScoringPolicy`** + `BureauData` (el motor SQL como servicio) | Políticas versionables y simulables; outcomes no binarios |
| 3 tablas de reglas (`lender_rules`, `group_rules`, `category_rules`) con la misma condición copiada en decenas de lenders | **1 `EligibilityPolicy`** referenciable | "Definir una vez, referenciar muchas"; elimina divergencias silenciosas |
| 5 roles de back-office clonados (mismos permisos, distinto estado que autorizan) | Capacidad declarativa `autorizar:{etapa}` | Menos roles, menor privilegio; sumar "Cobranza/Riesgo" sin clonar |
| Decenas de catálogos `*_statuses` / `*_types` como tablas | **75 value-objects** (enum/catálogo) | Menos ruido; lo que es un valor deja de ser una entidad |
| País por defecto `id=1` (Afganistán) en vez de `47` (Colombia); formato disperso | **`Country` como raíz canónica** (moneda/locale/formato/`dial_code`) | Multi-país real (CO/DO → EC/MX/PE); montos y documentos derivados del país |
| `cell_phone` UNIQUE **global** → colisiona entre países | Unicidad por `(country_id, cell_phone)` / E.164 | Escala multi-país sin choques de números locales |
| Ledger de cobranza (`creditop_x_requests_history`, 47 cols) implícito | **`RevolvingCredit`** con ledger + pagos + facturación de primera clase | Aging, contraoferta y saldo a facturar trazables |

> Fuente: el análisis what-is + to-be está en `CREDITOP-MODELO-DATOS.md` (§3.7 deudas, §4 deber-ser,
> §5 por qué mejora). Esta app es la cara navegable de ese deber-ser.

### Y además, cómo se ve la mejora aquí

La estructura actual no tiene una visualización explorable de su dominio. Esta app la aporta:
nodos de tabla **interactivos** (no una imagen fija), **agrupados por contexto**, con búsqueda,
filtros, foco en vecinos, panel de detalle con el **mapeo deber-ser → tabla legacy**, y posiciones
arrastrables y persistentes. Permite *recorrer* el modelo, no solo mirarlo.

---

## Qué visualiza

- **105 entidades** (21 aggregate roots + 84 internas) agrupadas por los **8 contextos** de dominio.
- **129 relaciones** con cardinalidad (`N:1`, etc.), columna FK/rol, y distinción
  **interna** (línea sólida) vs **referencia entre contextos** (línea punteada).
- Cada tabla-nodo: header con contexto + tabla legacy, columnas con tipo y marca **PK**/**FK**.

## Características

- **Layout agrupado por contexto** (dagre por cluster + grilla): mantiene juntas las tablas de cada
  agregado. Botón **Auto-organizar** para recalcular y **⇄ TB/LR** para cambiar la dirección.
- **Posiciones arrastrables y persistentes** (se guardan en `localStorage`; Auto-organizar las limpia).
- **Filtro por contexto** (chips arriba) y **búsqueda** por nombre de entidad o tabla legacy.
- **Foco en vecinos**: al seleccionar una tabla, atenúa todo lo que no esté conectado a ella.
- **Panel de detalle**: relaciones salientes, "referenciada por", y todas las columnas con su mapeo
  a la columna legacy. Las relaciones son clicables para saltar de tabla en tabla.
- **Descripción de negocio por columna** (100% de cobertura): cada columna muestra, además del tipo
  y la columna legacy, una frase de qué significa para el negocio. El header indica cuántas la tienen.
- **"Por qué este modelo"** (botón en el header → página `/por-que` con **Vue Router**): página dedicada
  que cuenta **de dónde partimos** (código a medida por actor) → **hacia dónde vamos** (modelo canónico al
  que los actores se ajustan) → **qué hicimos y por qué** (los 9 frentes) → **playbook de expansión**
  (nuevo lender/comercio/país = filas, no código). Stats en vivo desde el modelo.
- **"Reglas"** (botón en el header → página `/reglas`): explica visualmente **cómo se configura una regla**
  — diagrama de flujo (catálogo → regla → de dónde sale el dato por país → evaluación) + un **demo
  interactivo** (armás una regla, cambiás de país y ves cómo el mismo criterio resuelve el dato de otra
  fuente y da aprueba/no aprueba).
- Minimapa, controles de zoom y leyenda.

---

## Fuente de datos

`src/data/modelo-dominio.json` — el **deber-ser v4** (fuente de verdad, self-contained en este
proyecto). La app lo lee y lo mapea a nodos/edges de Vue Flow en `src/lib/transform.ts`. Se edita
acá directamente (antes existía una copia upstream en el extinto `creditop-cli/docs/`, ya
consolidado). Para reaplicar las transformaciones idempotentes sobre el JSON:

```bash
npm run clean-names              # nombres limpios (ver abajo)
npm run apply-refinements        # refinamientos estructurales (ver abajo)
npm run apply-aggregate-changes  # cambios de límite de agregado (ver abajo)
npm run apply-db-findings        # anotaciones verificadas contra dev (read-only; ver abajo)
npm run apply-business-refinements  # refinamientos guiados por el negocio (ver abajo)
npm run apply-rules-and-logs     # motor de reglas canónico + saca los logs (ver abajo)
npm run apply-inversion          # configuradores (lender+merchant) + proveedores por país (ver abajo)
npm run apply-inversion-2        # cierre de la inversión: buró/cierre/scope país como dato (ver abajo)
npm run apply-reduction          # reducción: colapsa columnas/entidades redundantes (ver abajo)
npm run apply-evaluable-field    # registro de facts para reglas dinámicas (ver abajo)
```

> Las etiquetas de contexto en inglés (Geography, Credit, …) viven en el código
> (`CONTEXT_LABELS` en `transform.ts`), no en el JSON, para que sobrevivan a un refresh del modelo.

### Curación de nombres de columnas (`npm run clean-names`)

El deber-ser que genera el toolkit todavía arrastra nombres de columna crudos del legacy
(`allied_industry_id`, `have_ctopx`, `order`…). [`scripts/clean-names.mjs`](scripts/clean-names.mjs)
los normaliza **dentro del modelo** (escribe el `n` limpio y preserva la columna real en `legacy`,
visible en el panel de detalle). Convención aplicada:

| Regla | Ejemplo |
|---|---|
| Quitar el prefijo redundante del propio agregado | `allied_industry_id` → `industry_id` |
| Los FK nombran su destino (entidad), no el origen legacy | `user_id`→`customer_id`, `user_request_id`→`loan_application_id`, `allied_id`→`merchant_id`, `allied_branch_id`→`merchant_branch_id`, `country_city_id`→`city_id`, … |
| Booleans con `is_`/`has_`/verbo | `have_ctopx` → `has_ctopx`, `allow_other_payment` → `allows_other_payment` |
| Timestamps con `_at` | `star_allied` → `starred_at` |
| Evitar palabras reservadas SQL | `order` → `sort_order` |

El script es **idempotente** (las reglas se aplican por la columna `legacy`, no por el `n` actual) y
**seguro** (omite con aviso si un nombre limpio colisiona). Las reglas globales y los overrides
curados por entidad están al inicio del archivo; ahí se agregan casos nuevos. También renombra
entidades/value-objects (p.ej. el subdominio de scoring de español a inglés) y mantiene consistentes
sus referencias (`relaciones`, `agregados`, `ref(VO)`).

### Refinamientos estructurales (`npm run apply-refinements`)

A partir de la revisión multi-agente ([`REFINAMIENTO-DEBER-SER.md`](docs/REFINAMIENTO-DEBER-SER.md)),
[`scripts/apply-refinements.mjs`](scripts/apply-refinements.mjs) materializa promesas que el modelo
declaraba en prosa pero no modelaba, de forma **idempotente**:

- VO `Provider` + atributo `provider` en `IdentityVerification` (unificación real de los 6 KYC).
- VO `ProviderType` + atributo `provider_type` en `LenderTransaction` (discriminador del puerto).
- Entidad `RoleAuthorizedStatus` (capacidad declarativa que colapsa los 5 roles de back-office).
- Resuelve la doble clasificación de 5 tablas: las quita de `fueraDeAlcance` y las declara en
  `legacy.absorbe` de su entidad (`LenderTransaction`, `SignedLegalDocument`, `BureauInquiry`).

### Cambios de límite de agregado (`npm run apply-aggregate-changes`)

[`scripts/apply-aggregate-changes.mjs`](scripts/apply-aggregate-changes.mjs) reescribe tres límites
de consistencia (declarativo e idempotente):

- **CreditPolicy unificada + versionada:** nueva raíz `creditPolicy` (por lender) + `policyVersion`
  (draft/active/retired); `eligibilityPolicy` y `scoringPolicy` pasan de raíz a miembros junto con
  reglas, categorías, scoring y multiplicadores → activación atómica de una versión. Los logs
  transaccionales (`bureauInquiry`, `eligibilityEvaluation`) salen a raíz propia.
- **RevolvingCredit partido:** nueva raíz `loanAccount` (per-desembolso) dueña del ledger
  (`requestHistoryEntry`, `payment`, `paymentRegister`, `signedLegalDocument`, `requestProcessRecord`);
  `revolvingCredit` queda con el cupo per-cliente. Relación `RevolvingCredit 1:N LoanAccount`.
- **Canales fuera del HUB:** `paymentLink`, `ecommerceRequest`, `draftRequest` pasan a raíces de
  intake propias; `loanApplication` conserva la solicitud y sus detalles (incl. `purchaseCode`).

### Hallazgos verificados contra dev (`npm run apply-db-findings`)

[`scripts/apply-db-findings.mjs`](scripts/apply-db-findings.mjs) documenta en el modelo las 5
decisiones que se resolvieron con consultas **read-only** al dev remoto (evidencia en
[`HALLAZGOS-BD.md`](docs/HALLAZGOS-BD.md)). **No modifica ninguna base de datos.**

- Canales `paymentLink`/`ecommerceRequest` → `loanApplication` son **N:M** (puentes sin UNIQUE).
- `role` == `user_profile` (1:1; 4898/4898 con `role_id == user_profile_id`).
- `multiple_allieds`: **N:M Customer↔Merchant** denormalizado (JSON, ~2%) → **normalizado** a la
  entidad bridge `CustomerMerchant` (miembro de `Customer`); el atributo queda como mapeo legacy.
- FKs colgantes (`payment_plan_id`, `credit_note_calculation_id`, `starting_value_calculation_id`):
  tablas inexistentes en dev → anotadas; el pricing real vive en `treasury_calculations`.
- KYC per-lender: confirmado que `jumioVerification`/`crosscoreEvaluation` ya llevan `lender_id`.

### Refinamientos guiados por el negocio (`npm run apply-business-refinements`)

[`scripts/apply-business-refinements.mjs`](scripts/apply-business-refinements.mjs) aplica cambios cuyo
criterio es el **retorno para el modelo de negocio de Creditop** (BNPL multi-país; agregador + Creditop X):

- **Expansión multi-país** (driver de crecimiento): `Country.is_operating` + `operational_since`
  (país operativo ≠ catálogo ISO); unicidad **por país** de `document_number`/`cell_phone` (hoy UNIQUE global).
- **Onboarding por país:** entidad `DocumentType` (CC/CE/PEP/TI/NIT/PA) por país con formato y
  `bypass_centrales`; `Customer.document_type` pasa a FK del catálogo.
- **Conversión por contraoferta** (caso de uso central de originación): VO `Offer` =
  `requestedOffer` (original_amount + términos) → `finalOffer` (final_amount + términos); montos como
  `Money` (moneda derivada de Country), tasa/plazo/inicial como `Terms`.

### Motor de reglas canónico + sin logs (`npm run apply-rules-and-logs`)

[`scripts/apply-rules-and-logs.mjs`](scripts/apply-rules-and-logs.mjs):

- **Reglas canónicas compartidas (lenders + merchants):** entidad `RuleDefinition` = la cláusula
  (`field`, `operator`, `value`, `applies_to: lender|merchant|both`) **definida una sola vez**.
  Los bindings de lender (`eligibilityRule` ← `lender_rules`) y de merchant/branch
  (`eligibilityPolicy` ← `group_rules`) la referencian vía `rule_definition_id` en vez de copiar la
  condición inline (hoy: "mayoría de edad" en 79 lenders, "ocupación formal" en 140). El evaluador es
  genérico → **agregar un lender/merchant es data, no código a medida.**
- **Sin logs en el dominio:** se eliminan las entidades-telemetría (`providerEvidenceLog`,
  `merchantStatusLogEntry`, `incentiveLog`) y las 16 tablas `*_log` de `fueraDeAlcance`. La
  observabilidad se maneja con **logs estructurados + Grafana/CloudWatch** en los microservicios.

### Inversión: configuradores + proveedores por país (`npm run apply-inversion`)

A partir de la validación multi-agente ([`VALIDACION-INVERSION.md`](docs/VALIDACION-INVERSION.md)),
[`scripts/apply-inversion.mjs`](scripts/apply-inversion.mjs) completa el giro "los actores se adaptan
a Creditop, no al revés":

- **`VerificationPolicy` + `VerificationStep`** — el **configurador** de KYC: declara qué documentos
  se aceptan y qué pasos se exigen, con **scope polimórfico** resuelto por especificidad
  (`país < lender < merchant < sucursal < tipo de documento`). Lender **y** merchant son
  configuradores de primera clase. Elimina `DocumentType.bypass_centrales` (pasa a `VerificationStep
  bureau=skip`) y desacopla los flags de KYC del lender.
- **`BureauProvider` + `CountryProviderBinding`** — registro de **proveedores por país**: el motor pide
  una *capability* (`bureau`/`pep_aml`/`identity`/`e_signature`), el binding resuelve el proveedor real
  del país. KYC multi-país = mismo proceso, proveedores como dato. Alta de un país = filas, no código.

### Cierre de la inversión (`npm run apply-inversion-2`)

[`scripts/apply-inversion-2.mjs`](scripts/apply-inversion-2.mjs) lleva a DATO lo que aún era código:

- **Buró como dato:** `CountryBureauPolicy` (a qué centrales consultar por país) + `BureauFieldMapping`
  (cómo extraer score/ingreso vía `json_path`) → reemplazan los 6 bloques de `SP_Update_..._Risk_Centrals`.
- **Patrón de cierre como dato:** VO `ClosingPattern` + `Lender.closing_pattern_id`/`adapter_slug` +
  `IntegrationContract` + `LenderStatusMapping` → matan el `switch(lender_id)` y las clases `Action`;
  `ProviderType` pasa a `kind` genérico (payvalida/sistecrédito son lenders, no tipos).
- **Eje país y rol semántico:** `country_id` en `CreditPolicy`/`OnboardingForm`, `FormField.semantic_role`
  (el motor lee por rol, no por `field_id`), y `CountrySetting`/`MerchantSetting` key/value — el merchant
  declara su comportamiento como dato, no como columnas-flag.

### Reducción del modelo (`npm run apply-reduction`)

A partir de [`AUDITORIA-REDUCCION.md`](docs/AUDITORIA-REDUCCION.md),
[`scripts/apply-reduction.mjs`](scripts/apply-reduction.mjs) colapsa lo que el modelo config-driven
vuelve redundante, **conceptualmente** y preservando la trazabilidad (`legacy.reducidas`/`legacy.absorbe`,
visibles en el panel):

- **−7 entidades:** KYC por-proveedor (`Jumio`/`CrossCore`/`Signing`) → `IdentityVerification.evidence`;
  `ScoringRule`→`ScoringPolicy`; `BureauSummary`→proyección de `BureauInquiry`; `DeviceEnrollment`→`DeviceLock`;
  `LenderIntegrationFlow`→telemetría.
- **−~60 columnas:** `CategoryEligibilityCriteria` (~18 criterios → bindings de `RuleDefinition`); flags de
  `Merchant`/`Lender` → `Setting`/políticas; derivables (`full_name`, `age`, flags de validación).
- **−6 value-objects:** multiplicadores → filas; catálogos CX duplicados (`RequestStatus`, `PaymentMethod`,
  `PaymentType`) unificados.
- **No se toca** lo regulatorio/legacy ni los montos de ledger/snapshots (riesgo alto): quedan documentados.

### Registro de facts para reglas dinámicas (`npm run apply-evaluable-field`)

A partir del panel de diseño ([`DISENO-EVALUABLE-FIELD.md`](docs/DISENO-EVALUABLE-FIELD.md)),
[`scripts/apply-evaluable-field.mjs`](scripts/apply-evaluable-field.mjs) agrega el contexto transversal
**`decisioning`** con el registro de *facts* que vuelve **abierto el espacio de reglas sin código**:

- **`EvaluableField`** (catálogo de "qué se puede evaluar", tipado) + **`FactSourceBinding`** (de dónde
  sale el valor por país) + **`FeatureTransform`**/`FeatureDependency` (computados versionados, DAG) +
  **`RuleGroup`**/`RuleGroupMember` (reglas compuestas AND/OR) + **`OperatorTypeRule`** (matriz
  operador↔tipo) + **`FactValueSnapshot`** (materialización tipada).
- Las 4 referencias sueltas (`RuleDefinition.field`, `ScoringPolicy.variable`, `FormField.semantic_role`,
  `BureauFieldMapping.field_code`) se re-cablean al catálogo.
- **Más reglas / fact nuevo / país nuevo = filas**, no código ni esquema. **No es EAV:** el catálogo
  define *qué* y *dónde*; los valores siguen tipados e indexados en sus tablas nativas.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5183
npm run build    # type-check (vue-tsc) + build de producción a dist/
npm run preview  # sirve el build de dist/
```

Requiere Node 18+.

## Estructura

```
src/
  data/modelo-dominio.json    # el deber-ser v4 (fuente de verdad de la viz)
  lib/types.ts                # tipos que reflejan el JSON
  lib/transform.ts            # JSON -> nodes/edges, layout (dagre por contexto), vecinos, etiquetas
  components/TableNode.vue     # nodo de tabla custom (header + columnas + handles)
  components/DetailPanel.vue    # panel lateral de detalle de entidad
  router/index.ts             # Vue Router: "/" (ERD), "/por-que" (manifiesto), "/reglas" (cómo funcionan)
  views/ErdView.vue           # el ERD: Vue Flow + toolbar + filtros + persistencia
  views/PorQueView.vue        # página "Por qué este modelo" (de dónde partimos → hacia dónde vamos)
  views/ReglasView.vue        # página "Cómo funcionan las reglas" (diagrama + demo interactivo)
  App.vue                     # shell con <router-view>
  main.ts                     # createApp + router
scripts/
  clean-names.mjs            # cura nombres de columnas/entidades/VOs (npm run clean-names)
  apply-refinements.mjs      # refinamientos estructurales del modelo (npm run apply-refinements)
  apply-aggregate-changes.mjs # cambios de límite de agregado (npm run apply-aggregate-changes)
  apply-db-findings.mjs      # anotaciones verificadas read-only contra dev (npm run apply-db-findings)
  apply-business-refinements.mjs # refinamientos guiados por el negocio (npm run apply-business-refinements)
  apply-rules-and-logs.mjs   # motor de reglas canónico + remoción de logs (npm run apply-rules-and-logs)
  apply-inversion.mjs        # configuradores + proveedores por país (npm run apply-inversion)
  apply-inversion-2.mjs      # cierre: buró/cierre/scope país como dato (npm run apply-inversion-2)
  apply-reduction.mjs        # reducción de columnas/entidades redundantes (npm run apply-reduction)
  apply-evaluable-field.mjs  # registro de facts para reglas dinámicas (npm run apply-evaluable-field)
```

## Roadmap (fuera del alcance de esta primera versión)

Esta versión cubre el **ERD del deber-ser + descripción de negocio por columna**. Posibles
siguientes pasos (el viejo `modelo.html` fue eliminado; estos datos viven en `modelo-dominio.json`):

- Vistas adicionales sobre el mismo JSON: estados/transiciones, reglas de elegibilidad, patrones de
  cierre y "realidad actual" (what-is).
- Export del diagrama a PNG/SVG.
- Resaltar sobre los nodos afectados las **deudas estructurales** documentadas (país `id=1`,
  `cell_phone` UNIQUE global, taxonomía de comercio en 3 columnas, etc.).
- Toggle de idioma para la chrome de la UI (hoy en español; los nombres del modelo, en inglés).
```
