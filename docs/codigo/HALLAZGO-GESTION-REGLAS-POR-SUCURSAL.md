# Hallazgo — Cómo se gestionan las reglas de las entidades (para revisar con negocio)

> **Estado:** hallazgo técnico verificado contra BD local (`creditop`, snapshot).
> **Fecha:** 2026-07-03 · **Para:** revisión con negocio / riesgo.
> **En una frase:** las reglas con las que una entidad decide a quién le presta **no se
> guardan una sola vez en la entidad y se leen en vivo**; se **copian dentro de cada
> sucursal** cuando se asigna la entidad. Eso duplica miles de veces, deja copias
> desactualizadas y hace que algunas entidades corran criterios que no son los suyos.

---

## 1. Cómo funciona hoy

Cada entidad ("lender") tiene dos tipos de reglas:

- **Reglas duras** → miran los **datos del solicitante** (edad, género, ocupación, ingreso, antigüedad…).
- **Reglas de datacrédito** → miran el **reporte de buró** (score, moras, negativos, consultas, antigüedad financiera).

De cada una existe una **plantilla** definida a nivel entidad. Pero esa plantilla **no es lo que se evalúa** en el onboarding. Cuando se asigna una entidad a una sucursal, el sistema **copia** la plantilla y crea una regla propia de esa sucursal — y **esa copia** es la que se ejecuta.

Consecuencia del diseño:
- No hay una única fuente de verdad: hay **una copia por (sucursal × entidad)**.
- Cambiar la plantilla de una entidad **NO** actualiza las copias ya creadas.
- Una entidad sin plantilla propia arranca con un **default hardcodeado: Banco de Bogotá** (`lender_id = 5`).

---

## 2. Evidencia (números reales)

### Reglas duras
| Métrica | Valor |
|---|---|
| Plantillas (nivel entidad) | **679** filas · 136 entidades |
| Copias reales (por sucursal) | **37.284** filas · 135 entidades |
| Copias que ya **no coinciden** con la plantilla de su entidad (deriva) | **1.861 (5,0%)** |

Ejemplos de escala: Credifamilia-addi = 1 plantilla → **6.486 copias** en 1.081 sucursales; Bancolombia CPD = 5.982 copias; Sistecrédito = 5.124; Banco de Bogotá = 4.807.

### Reglas de datacrédito
| Métrica | Valor |
|---|---|
| Entidades activas | 149 |
| Con plantilla propia | **107** (⇒ **42 sin política propia**) |
| Copias por sucursal | 7.076 |
| Copia fiel de la plantilla de su entidad | **6.125 (87%)** ✅ |
| Entidades sin plantilla → corriendo el **default Banco de Bogotá (score 640)** | 32 entidades · ~772 filas |
| Casos graves (entidad con política propia, pero una sucursal pisada con el default) | **5** |

**Lectura:** el datacrédito está mayormente sano (87% respeta a la entidad). El problema estructural se ve sobre todo en las **reglas duras** (37 mil copias, 5% ya derivado) y en las **42 entidades sin política de buró propia** que terminan aplicando los cortes de Banco de Bogotá sin que nadie lo haya decidido para ellas.

---

## 3. Ejemplos concretos y veredicto

### 3.1 Modificaciones sistemáticas — un mismo comercio afina una entidad
**Credifamilia en "Colchones Ensueño"** (≈85-89 sucursales cada una):

| Campo | Plantilla (entidad) | En las sucursales | ¿Tiene sentido? |
|---|---|---|---|
| Edad | `>= 20` y `<= 74` | `>= 35` y `<= 73` | ✅ Plausible: banda de edad más estricta, negociada por el comercio. |
| Ocupación | `Independiente` | `Empleado \| Pensionado` | ⚠️ **La plantilla parece la equivocada.** Credifamilia (vivienda) presta a empleados/pensionados; la copia de sucursal es la que tiene sentido. La "fuente de verdad" está mal. |
| Género | `M \| F` | `F` (solo mujeres) | ⚠️ **Revisar con negocio.** Si no es intencional, está excluyendo a todos los hombres en ~89 sucursales. |
| Ingreso (campo 87) | `>= 1.850.000` | `>= 0` (algunas) | ⚠️ Desactiva el piso de ingreso. Confirmar si es un producto sin piso o un error. |

> Este caso muestra el problema de raíz: un comercio grande personaliza una entidad, y como no hay una "capa de comercio", la personalización se replica en cada sucursal **y** la plantilla original queda desactualizada. A veces la copia es la correcta y la plantilla la vieja.

### 3.2 Ingreso apagado — Banco de Bogotá en "Colchones Ensueño"
Plantilla `ingreso >= 1.300.000` → en **26 sucursales** quedó en `>= 0`.
**Veredicto:** ⚠️ efectivamente **anula el filtro de ingreso** de BdB en ese comercio. Puede ser intencional (producto tipo "Cero Pay") o un error que deja pasar a todos por ese criterio. **Confirmar con negocio.**

### 3.3 Tuning menor y razonable
- **Banco de Occidente**: ingreso `>= 3.000.000` → `3.500.000` / `3.550.000` (piso un poco más alto). ✅ Plausible.
- **Compensar**: edad `<= 69` → `72`; ingreso `>= 1.300.000` → `1.000.000`. ✅ Plausible.
- **Banco Santander**: antigüedad (campo 161) `>= 12` meses → `6` / `24` / `0`, distinto por sucursal. ⚠️ Inconsistente entre sucursales; parece ajuste manual sin criterio único.

### 3.4 Casos graves de datacrédito — entidad corriendo el corte de otra
Entidades pequeñas (odontología/clínicas) con **su propio score**, pero una sucursal quedó con el **default 640 de Banco de Bogotá**:

| Entidad | Comercio | Sucursal | Score propio | Score que corre |
|---|---|---|---|---|
| Credifis X (Rotativo) | Tienda Fisio | Sede Cali | 500 | **640** |
| Oral credit X | Oralcare | Sede principal | 500 | **640** |
| Riex credit | Ríe clínica odontológica | Villa del prado | 400 | **640** |
| Riex credit (Rotativo) | Ríe clínica odontológica | Villa del prado | 400 | **640** |
| CORESDENT (Dra. Andrea Forero) | CORESDENT | Principal | 500 | **640** |

**Veredicto:** ❌ **No tienen sentido — son errores.** Esas sucursales rechazan por buró a clientes que la entidad **sí aceptaría** (le exigen 640 cuando su política real es 400-500). Impacto directo en aprobación.

### 3.5 "Deriva" que en realidad es ruido
Las ediciones custom de datacrédito (ej. **Approbe** en Colchones Ensueño) difieren de la plantilla **por un solo campo menor** (score/consultas/negativos idénticos). ✅ No son cambios de política; son diferencias cosméticas. Buena parte del 5% de "deriva" es de este tipo.

---

## 4. Riesgos

1. **Sin fuente de verdad.** Nadie puede responder "¿con qué reglas presta hoy la entidad X?" — depende de cada una de sus miles de copias.
2. **Aprobación incorrecta.** Casos como 3.4 rechazan clientes buenos; casos como 3.2 pueden dejar pasar de más.
3. **Cambios no propagan.** Ajustar la política de una entidad exige tocar hasta ~1.000 filas por sucursal, o usar "aplicar a todas las sucursales" (que **crea más copias**, no corrige las viejas).
4. **Default frágil.** 42 entidades dependen de un `lender_id = 5` fijo. Si a Banco de Bogotá le cambian el id o le borran la plantilla, las entidades nuevas se quedan sin molde.
5. **La plantilla puede ser la vieja.** En 3.1 la copia de sucursal es la correcta y la plantilla la desactualizada — o sea, ni siquiera la "fuente" es confiable.

---

## 5. Preguntas / decisiones para negocio

- ¿Las reglas deben vivir **en la entidad** (fuente de verdad) y la sucursal guardar **solo excepciones**? (modelo recomendado)
- ¿Existe una capa intermedia legítima **por comercio** (ej. Colchones Ensueño negocia condiciones propias con Credifamilia)? Hoy no existe y por eso se replica por sucursal.
- Confirmar caso por caso los ⚠️/❌: género solo-mujeres, ingreso en 0, y los 5 scores en 640.
- ¿Se corrige el default hardcodeado (Banco de Bogotá) por algo explícito/configurable?

---

## Apéndice — Fuente

> El **MECANISMO** de la copia —dónde y cómo se dispara la clonación por sucursal, con `archivo:línea` (el panel de
> `application`: `AlliedBranchEdit` → `AlliedAlliedBranchController@update` → `addNewRule`/`addNewLenderRule`; el
> default BdB lender 5; el 2º disparador de credencial e-commerce; las reglas huérfanas; el gemelo no-invocado de
> `legacy-backend/Modules/Partner`)— es **dueño de [ADMIN-ALTA-OPERACION.md](./ADMIN-ALTA-OPERACION.md) §1 Paso 4 y §2**
> (verificado 2026-07-08, veredicto CONFIRMED). Este doc es dueño del **hallazgo y sus números**; abajo, solo de dónde salen esas cifras:

- **De dónde salen los conteos:** consultas sobre `lender_rules` (plantilla = `group_rule_id NULL`; copia = por `group_rule_id`→`group_rules.allied_branch_id`) y `lender_datacredito_rules` (plantilla = `allied_branch_id NULL`; copia = por sucursal), en la BD local `creditop`.
- **Quién EVALÚA la copia** (por qué la deriva importa): `legacy-backend/Modules/Onboarding/App/Services/lenders/LenderListingService.php` + `LenderValidationService.php` (duras) + `ProfilingRulesService.php` / `RiskCentralValidationService.php` (datacrédito) leen la **copia por-sucursal**, no la plantilla del lender.
- **El default de las 42 entidades sin política propia:** Banco de Bogotá `lender_id = 5` (`LenderRuleRepository::findDefaultDatacreditoRule`); el punto exacto del disparo vive en ADMIN-ALTA.
