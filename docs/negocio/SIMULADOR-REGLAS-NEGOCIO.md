# Simulador de onboarding — reglas de negocio a tener en cuenta

Guía de **negocio** (no técnica) para el simulador `playground/flow`. No busca replicar el sistema; busca que el simulador respete el **espíritu** de cómo decide CreditOp: que cada entidad tenga reglas propias, que "aparecer en la lista ≠ estar aprobado", y que CreditopX decida adentro mientras los externos deciden afuera.

Derivado de contrastar el simulador contra doc + código real (workflow 2026-07-03, 88 hallazgos, 85 confirmados en código).

---

## 1. Cómo decide CreditOp (7 reglas macro)

1. **El comercio/sucursal define qué entidades se ofrecen.** Cada sucursal tiene su propio set de lenders habilitados (`lenders_by_allied_branches`). Es la primera y única capa que agrega/quita del catálogo; si el lender no está en la sucursal, no compite.

2. **Quién presta define todo — 4 naturalezas:**
   - **CreditopX (marca propia por comercio: CrediPullman, DENTIX FINANCIAL SERVICES…)** → CreditOp decide con sus reglas y datos. Es donde CreditOp controla la regla.
   - **Entidades externas (Bancolombia, Welli, Meddipay, Banco de Bogotá…)** → decide la entidad en su API; CreditOp solo consulta y muestra.
   - **Agregadores / redirect** → solo muestra y redirige.
   - **Formalización externa (Credifamilia)** → origina adentro, radica afuera (SOAP).

3. **Aparecer en la lista ≠ tener el crédito.** Dos momentos: **listado/marketplace** (qué se muestra y en qué orden por probabilidad — las reglas acá sobre todo ORDENAN) y **cupo/pre-aprobación** (el corte duro real, al elegir la entidad).

4. **En CreditopX, no cumplir una regla del listado NO saca al lender** — se muestra con menor probabilidad; el "no" duro llega en el cupo.

5. **Cada lender tiene reglas distintas, y el mismo lender puede exigir distinto según el comercio/sucursal.**

6. **El ingreso que cuenta no siempre es el declarado** (cascada Ágil Data / Quanto / declarado; en algunos comercios se inyecta automático). **Reglas fail-closed:** si falta el dato, se rechaza por defecto.

7. **El crédito sigue vivo tras aprobado (Estado 11):** solo CreditopX lleva cartera adentro (cobranza, mora, cupo rotativo que se libera al pagar); los externos gestionan la suya.

---

## 2. Variables de decisión (catálogo único de reglas)

Las reglas miran el **perfil de riesgo**, no solo el monto. Propuesta: **todas las entidades comparten el mismo catálogo de reglas**; por defecto cada regla está **"abierta" (rango completo = no restringe)** y se ajusta por entidad. Una regla **"aplica"** cuando su valor es más angosto que el default abierto.

| key | Regla (negocio) | Tipo | Control UI | Rango / opciones | Default (abierto) |
|-----|-----------------|------|------------|------------------|-------------------|
| `score` | Score datacrédito | rango | slider | 0–1000 | 0–1000 |
| `age` | Edad | rango | slider | 18–100 | 18–100 |
| `amount` | Monto solicitado | rango | number ($) | 0–50M | 0–50M |
| `monthlyIncome` | Ingreso mensual (mínimo) | mín | number ($) | 0–20M | 0 |
| `negatives12m` | Negativos últimos 12m (máx) | máx | slider | 0–20 | 20 (=sin límite) |
| `currentArrears` | Mora vigente / cuentas en mora (máx) | máx | slider | 0–10 | 10 |
| `inquiries6m` | Consultas al buró últimos 6m (máx) | máx | slider | 0–20 | 20 |
| `creditHistoryMonths` | Antigüedad de historial crediticio (meses mín) | mín | number | 0–240 | 0 |
| `debtToIncomePct` | Endeudamiento / capacidad de pago (máx %) | máx | slider | 0–100 | 100 |
| `documentTypes` | Tipos de documento aceptados | conjunto | chips | CC · CE · PEP | todos |
| `gender` | Género | conjunto | chips | M · F | todos |
| `employment` | Situación laboral | conjunto | chips | empleado · independiente · pensionado · desempleado | todos |
| `requireCleanAml` | Exige listas restrictivas (AML) limpias | booleano | toggle | sí/no | no |
| `requireVerifiedIdentity` | Exige identidad verificada | booleano | toggle | sí/no | no |
| `acceptThinFile` | Acepta sin historial de buró (thin file) | booleano | toggle | sí/no | sí |
| `initialFeePct` | Cuota inicial exigida (%) | valor | slider | 0–100 | 0 |

**Criterio de control:** *slider* para rangos acotados y chicos (score, edad, %, conteos 0–20); *number* para montos abiertos (monto, ingreso, meses); *chips* para conjuntos; *toggle* para sí/no.

**"Cuáles aplican":** el sidebar muestra las 16 reglas siempre; las que restringen (valor ≠ default abierto) se marcan activas, las demás quedan atenuadas como "abierta / no aplica". Así se ve de un vistazo qué exige realmente cada entidad.

### Overrides de ejemplo (semilla realista)
- **CrediPullman** (CreditopX): `documentTypes=[CC]`, `score≥550`, `age≤75`, `negatives12m≤0`.
- **DENTIX FINANCIAL SERVICES** (CreditopX): `documentTypes=[CC]`, `amount 200k–8M`, `score≥500`.
- **Welli** (externa): `amount≤3M`, `score≥550`.
- **Banco de Bogotá** (externa): `score≥620`, `monthlyIncome≥1.5M`.
- **Credifamilia-addi** (redirect): `amount 100k–3M`.

---

## 3. ¿Los comercios/sucursales tienen reglas (edad, género…)?

**No como reglas propias e independientes.** Las condiciones de edad/género/ingreso/ocupación **pertenecen a la entidad (lender)**, no al comercio. Lo que hace el comercio/sucursal es:

- **Definir el universo** de entidades que se ofrecen (qué lenders).
- **Escopar/variar** las reglas de una entidad: la misma regla de un lender se configura **por sucursal** (`allied_branch_id`), así que la misma entidad puede exigir distinta edad/ingreso en una sucursal vs otra. También la sucursal decide si corre o no el filtro de datacrédito.

**Implicación para el simulador:** el catálogo de reglas vive a nivel **entidad** (compartido), y opcionalmente una **sucursal puede sobrescribir** los valores de una entidad. Recomendado: arrancar con reglas por entidad (más simple) y, si se quiere fidelidad, agregar después una capa de override por (sucursal, entidad).

---

## 4. Alcance / fidelidad

- **CreditopX (in-platform)**: las reglas SÍ deciden localmente → el simulador puede/debe evaluarlas.
- **Entidades externas**: la regla real la aplica su API; en el simulador las reglas son **requisitos informativos** (o un estado forzable), no el veredicto real.
- Servicing post-Estado 11, agregadores batch, ML de perfilamiento: fuera de alcance; representar con notas.
