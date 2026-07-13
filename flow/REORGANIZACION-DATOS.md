# Reorganización de datos del simulador — análisis y propuesta

> **Qué es.** Análisis completo de cómo está organizado el estado del simulador (`src/store.js`,
> 1.044 líneas + 20 componentes) y propuesta de reorganización para que los flujos de datos sean
> **ordenados** (cada cosa en su lugar, una sola fuente de verdad) y **reactivos de verdad**
> (sin parches manuales), eliminando hardcoding, código muerto y números mágicos.
>
> **Método.** Lectura completa del store y todos los nodos + verificación por grep de cada
> afirmación de "muerto/vivo" (2026-07-11). Las citas `archivo:línea` son de ese día.
>
> **Alcance.** Es reorganización de EMPAQUE, no de dominio: el modelo conceptual (catálogo →
> gate de sucursal → categoría → tramo → cuota) es fiel al CreditOp real (verificado en la
> auditoría de cobertura) y **no se toca**. Lo que se reordena es dónde viven los datos, cómo
> reaccionan y qué sobra.

---

## 1. Diagnóstico — 7 hallazgos con evidencia

### D1 · La reactividad está parcheada a mano (`editTick`, 19 sitios)

El síntoma más estructural. Cinco registros viven como **objetos planos NO reactivos** con hojas
reactivas adentro: `relationDefs` (overlays de sucursal), `perfilDefs` (categorías), `sucDatacredito`,
`sucGroups`, `tramoDefs`. Como Vue no puede observar el registro, **cada mutador tiene que acordarse
de hacer `editTick.n++`** para que la persistencia se entere — hoy hay **19 sitios** así.

- **Por qué se hizo:** los getters `relationOf()` / `perfilOf()` / `tramosOf()` / `sucursalDatacreditoOf()` /
  `sucursalGroupsOf()` **siembran al primer acceso** (escriben) y se llaman **dentro de computeds**
  (`lenders`, `perfilDiag`, `sucursalGate`…). Escribir estado reactivo dentro de un computed se
  auto-invalida → se "arregló" haciendo el registro plano y parchando la invalidación con el tick.
- **El costo:** un setter nuevo que olvide el `editTick.n++` produce el bug más silencioso posible —
  **la edición funciona en pantalla y se pierde al recargar**. Ya hay 19 lugares que recordar.
- **La causa raíz no es Vue, es acoplar "leer" con "sembrar".** Si el sembrado ocurre en **eventos**
  (crear entidad, seleccionarla por primera vez) y no en la lectura, los registros pueden ser
  `reactive({})` normales, un `watch` profundo cubre la persistencia y `editTick` desaparece entero.

### D2 · La identidad de una entidad es su **nombre** (string)

Todo se indexa por `l.name`: `merchant.enabled[name]`, `relationDefs[name]`, `perfilDefs[name]`,
`sucDatacredito[name]`, `sucGroups[name]`, `tramoDefs[name]`, `perfilBlacklist[name]`,
`preApproval[name]`, `plazos[name]` (LendersNode) y `ui.selected` = nombre.

- **Renombrar una entidad la deja huérfana de TODA su config** (categorías, tramos, reglas de
  sucursal, blacklist…) — el registro viejo queda basura y se re-siembra uno nuevo desde plantilla.
- **Duplicar copia a medias:** `duplicateCustomLender` clona `terms/overrides/entidad` pero NO
  perfil, ni tramos, ni la 2ª capa — la copia "pierde" la mitad de la configuración sin avisar.
- **Colisiones posibles** con los nombres del catálogo mock (`findLenderDef:374` busca en
  `customLenders` y cae a `LENDERS`).

**Fix:** `id` estable generado al crear (contador o slug corto); `name` pasa a ser solo display.
Todos los registros keyed por id; `ui.selected` = id. Renombrar se vuelve gratis y duplicar puede
copiar TODO el árbol de config.

### D3 · ~440 líneas muertas o dormidas (≈19% del código)

Verificado por grep hoy — nada de esto tiene un consumidor vivo:

| Qué | Dónde | Líneas | Evidencia |
|---|---|---|---|
| **Motor de evaluación viejo** `checkLender`/`evalLender`/`ruleFail` + `RULE_TO_SUBJECT` + `SKIP_IF_THIN` | store.js:560–612 | ~70 | Nadie los llama; la decisión real vive en `sucursalGate` + categoría + tramo (computed `lenders`) |
| Cadena de herencia UI `ruleApplies`/`activeRuleCount`/`inheritStatus`/`heredarRule`/`resetRule` | store.js:55–69, 383–391 | ~25 | Sus únicos consumidores son código muerto (los de esta tabla). `ruleValue`/`setRule` SÍ viven (seeds + monto) |
| `RuleEditorInline.vue` | nodes/ | 57 | 0 imports (el editor de reglas por catálogo se quitó del UI hace tiempo) |
| `Console.vue` | nodes/ | 68 | 0 imports (la reemplazó SettingsBar) + ~35 líneas de CSS `.console*` |
| `CreditopxConfigNode.vue` + mecanismo familia/productos (`merchantCreditopx`, `setCreditopxFamily`, `toggleCreditopxProduct`, `creditopxOn/creditopxProductOn`, `generatedLendersFor`) | nodes/ + store.js:251–304 | ~90 | El nodo no está registrado en App.vue → `merchantProducts` siempre vacío → `gen` en el computed `lenders` siempre `[]` |
| Herencia nivel-0 `baseDef`/`CREDITOPX_DEFAULT` | store.js:209–211, 44 | ~8 | Solo heredaban los productos generados (muertos). Las entidades custom usan `producto`, no `product` → nunca heredan de la base |
| **Catálogo mock**: `LENDERS` (5), `MERCHANTS` (6×sucursales), `applyBranch`/`selectComercio`/`selectSucursal`/`branchesOf`, `comercioHasCreditopx`/`builtinCreditopxName` | store.js:83–196, 269–276 | ~95 | El nodo Comercio es **texto libre** (MerchantNode: `v-model` directo); nadie llama a los selectores; el marketplace solo usa `customLenders` |
| `RangeSlider.vue` | src/ | 29 | 0 imports |
| `state.fechaExp` | store.js:404 + SolicitudNode:64 | 2 | Se edita y **nadie la lee** (ninguna regla la consume) |

> El motor de reglas del catálogo (`RULE_CATALOG`) **no** está muerto: hoy su rol real es
> (a) **plantilla de sembrado** de la 2ª capa (`seedDatacredito`/`seedGroups` leen `overrides`) y
> (b) fuente de `initialFeePct` para rt≠2. Eso hay que **declararlo** (es un catálogo de semillas,
> no un motor) — ver propuesta.

### D4 · Hardcodes y números mágicos

1. **Sentinelas "no restringe"** — la peor trampa activa: en `catChecks` un umbral está "apagado"
   cuando vale un número mágico (`maxNegatives ≥ 20`, `maxDelinq ≥ 10`, `maxInquiries ≥ 20`,
   `minScore = 0`, `minContinuity = 0`). Mismo truco en `seedDatacredito` (20 = abierto). Si el
   usuario escribe **20 queriendo decir literalmente 20**, la regla se apaga en silencio.
   → Semántica explícita: `null` = no restringe (input vacío, placeholder "sin límite").
2. **Defaults inline**: `amountMin ?? 1000000` (entidadCfg:103), terms default `{2.0, 24, 3M}` en
   `addCustomLender`, `lateRate = rate + 1.5` **inventado** (entidadCfg:111), `CONT_M`, `capacityPct 30`.
3. **Un comercio quemado por nombre**: `merchantCalc = { 'Motai': { cuotaInicial: 30, … } }`
   (store.js:231) — override de la calculadora keyed por el string del nombre, en el código.
4. **Plantillas como código**: `perfilTemplate()` (categorías A/B/C con 20 umbrales inline) y
   `tramoTemplate()` — datos de negocio dentro de funciones.
5. **La semántica de `response_type` está regada en ~7 archivos**: `RT_LABEL` en store (con
   `4: 'Híbrido'` **huérfano** — ningún nodo lo mapea), `RT` y `RT_VAR` en LendersNode, opciones
   0/1/2 en LendersConfigNode, branching `rt === 2 / rt === 1 / else` en el computed `lenders` y en
   `seedAmountRule`, `isCx/isRt1/else` en PerfilamientoNode, chips de leyenda en App.vue.
   **Agregar rt=3 (rotativo) hoy = tocar 7 lugares.** Y es exactamente lo que pide el roadmap
   ([BALANCE-Y-PROXIMOS-NODOS.md](BALANCE-Y-PROXIMOS-NODOS.md) grupo C).
6. **Colores de proveedor por triplicado**: `EDGE_C` en App.vue, `PROVS` en BuroNode (hex quemados)
   y las clases `.node--exp/--agil/…` en CSS. Cambiar el color de un buró = 3 archivos.
7. **Inconsistencias de fidelidad** (de la auditoría): Credifamilia-addi como `rt=0` (MAP.md lo
   trata rt=1), y `condonedDues` que `entidadCfg` expone pero `cuotaBreakdown` **ignora** (el
   tooltip promete que bajan la cuota y el número no lo hace).

### D5 · Tipos mezclados y derivaciones duplicadas

- `state.monto = '1200000'` (string) y `state.salario = ''` — pero `MoneyInput` **emite number**:
  el mismo campo es string al arrancar y number tras la primera edición. `montoNum()` re-parsea con
  regex en el store, y BuroNode y PerfilamientoNode repiten el parseo por su cuenta.
- La **cascada de ingreso** (Ágil → Mareigua → Ábaco → Quanto → declarado) vive en el computed
  `perfil`, pero `subjectOf()` re-deriva la continuidad por su lado y `incomeVerified` se deduce
  **comparando strings** (`!['declarado','—'].includes(salarioFuente)`).
- **Tres vocabularios para el mismo sujeto**, mapeados a mano: claves de `RULE_CATALOG`
  (`age`, `monthlyIncome`…), campos de `GROUP_FIELDS`, y los puentes `RULE_TO_SUBJECT` /
  `FIELD_TO_RULE`. Además idiomas mezclados (`edad` en el buró vs `age` en el sujeto).
- `subjectOf()` es **función**, no computed: se reconstruye en cada llamada (failingRuleKeys por
  campo × nodo, perfilDiag, sucursalDiag, lenders…). Y `useFails()` crea **un computed por
  componente** que re-corre `sucursalGate` + categoría (~8 duplicados del mismo cálculo).

### D6 · Persistencia manual y todo-o-nada

`graphSnapshot()`/`restoreGraph()` enumeran **cada registro a mano** (merchant, state, bureau,
nulls, providerDown, merchantCalc, relations, perfiles, sucursal.datacredito, sucursal.groups,
tramos.defs, tramos.state, selected). Agregar una feature = tocar **3 lugares** (el estado, el
snapshot, el restore) + acordarse del `editTick` en los setters. La versión es única y
**todo-o-nada**: `version !== 1` → se descarta el escenario COMPLETO. `customLenders` va aparte con
su propia clave y su propio watcher.

### D7 · Vista repetida donde podría ser data-driven

Los **5 nodos de buró son el mismo componente escrito 5 veces** (~185 líneas): header con toggle de
API + lista de `ProviderField`. Solo cambian título, color, tooltip y la lista de campos — exactamente
lo que cabe en un descriptor.

---

## 2. Propuesta — arquitectura objetivo

### Principios

1. **Datos ≠ lógica ≠ vista.** Los catálogos declarativos (proveedores, response_types, reglas,
   plantillas, defaults) viven en `data/` sin una línea de lógica; los motores puros y el estado en
   `stores/`; los componentes solo renderizan y despachan.
2. **Identidad estable**: `id` al crear; `name` es display. Todo registro keyed por id.
3. **Reactividad nativa, cero `editTick`**: registros `reactive({})`; el sembrado ocurre en
   **eventos** (crear/seleccionar), nunca dentro de computeds; la persistencia observa con deep watch.
4. **Un solo sujeto**: `subject` es UN computed canónico; gate de sucursal, categoría y tramo
   consumen el mismo objeto; un único **diccionario de campos** (label, tipo, ops, proveedor,
   descripción en criollo) reemplaza a `GROUP_FIELDS` + `RULE_TO_SUBJECT` + `FIELD_TO_RULE` + `BURO_DESC`.
5. **`null` = no restringe** — nada de `>= 20` mágico.
6. **`response_type` como descriptor** (`RT_DEF`): label, color, quién decide, si es creable, y flags
   de comportamiento (`decideLocal`, `usaCategorias`, `usaPreaprobacion`, `esRedirect`). Los nodos y
   el computed `lenders` leen flags, no comparan `rt === 2`. **Agregar rt=3/rt=4 = llenar una fila**
   (+ su mecánica si aplica) — es el habilitador directo del roadmap de nodos del BALANCE.
7. **Derivados en cadena de computeds**: `subject` → `gates` (Map por entidad) → `marketplace` →
   `failing`. Nada se recalcula por render; `useFails` lee del store en vez de recomputar.
8. **Persistencia declarativa**: cada slice se registra con `{ key, version, state, (migrate) }`;
   snapshot/restore/watch son genéricos; versión **por slice** (un formato viejo de tramos no borra
   el escenario entero).
9. **El escenario demo es data cargable**, no código: las entidades/comercios de ejemplo van a
   `data/escenario-demo.js` con un botón "cargar ejemplo" (reemplaza al mock LENDERS/MERCHANTS).

### Layout propuesto

```
src/
  data/                        ← declarativo puro (cero lógica)
    providers.js               ← descriptor de burós: key, label, short, color, header, campos
    response-types.js          ← RT_DEF 0..4: label, color, flags de comportamiento, creable
    subject-fields.js          ← diccionario ÚNICO de campos del sujeto (fusiona 4 mapas actuales)
    rule-catalog.js            ← RULE_CATALOG (declarado como CATÁLOGO DE SEMILLAS)
    plantillas.js              ← categorías A/B/C, tramos, calculadora, terms default
    escenario-demo.js          ← entidades/comercio de ejemplo (cargable, opcional)
  stores/
    entities.js                ← catálogo único {id, name, rt, producto, config} + CRUD
    merchant.js                ← comercio/sucursal (texto) + calculadora con overrides por id
    solicitud.js               ← inputs de la solicitud (numéricos de verdad)
    bureau.js                  ← profile() determinístico, nulls, providerDown, sembrado
    subject.js                 ← computed: perfil consolidado + sujeto canónico (única fuente)
    profiling.js               ← categorías + blacklist + preaprobación (por entityId, reactivo)
    sucursal.js                ← 2ª capa: datacrédito + group_rules (por entityId, reactivo)
    tramos.js                  ← tramos por monto (por entityId, reactivo)
    marketplace.js             ← lenders computed + cuotaBreakdown + failing (derivados puros)
    persist.js                 ← registro de slices → snapshot/restore/watch genérico + migraciones
  nodes/
    ProviderNode.vue           ← UN componente para los 5 burós (driven por data/providers.js)
    …los demás nodos, cada uno importando SOLO su slice
```

### Cómo se ve (3 muestras)

**Proveedor como data** (mata: 5 componentes casi iguales, `PROVIDER_OF`, colores por triplicado,
tooltips repetidos):

```js
// data/providers.js
export const PROVIDERS = [
  { key: 'experian', label: 'Datacrédito · Experian', short: 'Exp', hd: 'blue',
    edge: ['#6aa9e2', '#3f7fb0'],
    fields: [
      { key: 'score', label: 'Score', certeza: 1, rule: 'score', min: 0, max: 1000 },
      { key: 'quantoIncome', label: 'Ingreso (Quanto)', certeza: 3, type: 'money' },
      { key: 'totalDebt', label: 'Saldo deuda', type: 'money', info: true },
      // …
    ] },
  // agil, tusdatos, mareigua, abaco…
]
```

**response_type como descriptor** (mata el branching en 7 archivos y el 'Híbrido' huérfano):

```js
// data/response-types.js
export const RT_DEF = {
  0: { label: 'Redirect',  color: 'blue',   decide: 'su sitio', decideLocal: false, usaCategorias: false, usaPreaprobacion: false, creable: true },
  1: { label: 'Agregador', color: 'amber',  decide: 'su API',   decideLocal: false, usaCategorias: false, usaPreaprobacion: true,  creable: true },
  2: { label: 'CreditopX', color: 'purple', decide: 'CreditOp', decideLocal: true,  usaCategorias: true,  usaPreaprobacion: false, creable: true },
  3: { label: 'Rotativo',  color: 'purple', decide: 'CreditOp', decideLocal: true,  usaCategorias: true,  usaPreaprobacion: false, creable: false /* → BALANCE grupo C */ },
}
// el computed lenders pregunta rtDef(l.rt).usaCategorias, no `l.rt === 2`
```

**Slice con persistencia declarativa** (mata `editTick` y el snapshot manual):

```js
// stores/tramos.js
export const tramos = reactive({})          // { [entityId]: { on, franjas: [{min,max,maxFee,mandatory}] } }
export function seedTramos(entityId) {      // se llama al CREAR la entidad (evento), no al leer
  if (!tramos[entityId]) tramos[entityId] = { on: true, franjas: clone(PLANTILLAS.tramos) }
}
registerSlice({ key: 'tramos', version: 2, state: tramos,
  migrate: { 1: (old) => porNombreAPorId(old) } })   // v1 (por nombre) → v2 (por id)
```

### Qué gana cada dolor

| Hoy | Después |
|---|---|
| `editTick.n++` en 19 setters; olvido = edición que no persiste | 0 — deep watch por slice |
| Renombrar entidad = pierde categorías/tramos/reglas | Rename gratis (id estable); duplicar copia TODO |
| Agregar rt=3 = tocar ~7 archivos | 1 fila en `RT_DEF` + su mecánica |
| Sembrado dentro de computeds (registros planos a la fuerza) | Sembrado en eventos; todo reactivo |
| Escribir 20 en "negativos máx" apaga la regla | `null` = sin límite, explícito |
| 5 nodos de buró (~185 líneas) + colores ×3 + `PROVIDER_OF` | 1 `ProviderNode` + `data/providers.js` |
| Snapshot/restore a mano, versión todo-o-nada | Slices auto-registrados, migración por slice |
| ~440 líneas muertas (motor viejo, mock, 4 componentes) | Borradas (F0, sin riesgo) |
| `subjectOf()` función + `useFails` ×8 duplicados | `subject`/`failing` computeds compartidos |
| 'Motai' quemado en `merchantCalc`; plantillas en funciones | Todo en `data/` (plantillas + demo cargable) |

---

## 3. Plan por fases (cada una commiteable y verificable en :5190)

| Fase | Qué | Toca | Riesgo | Tamaño |
|---|---|---|---|---|
| **F0 · Poda** ✅ **APLICADA** (2026-07-11) | Borrado: motor viejo (`checkLender`/`evalLender`/`ruleFail`+mapas), cadena de herencia muerta (`ruleApplies`/`activeRuleCount`/`inheritStatus`/`heredarRule`/`resetRule`), helpers `yes`/`no`, `Console`/`CreditopxConfigNode`/`RuleEditorInline`/`RangeSlider`, mecanismo familia (`merchantCreditopx`/`setCreditopxFamily`/`toggleCreditopxProduct`/`generatedLendersFor`/`baseDef`/`CREDITOPX_DEFAULT`), mock `LENDERS`/`MERCHANTS`+selectores, CSS de consola. **`store.js` 1044→860; ~440 líneas menos.** Pendiente menor: `fechaExp` (queda para F3, va con "números de verdad"). | store + 4 files + CSS | Nulo (0 consumidores, verificado) | M (−~440 líneas) |
| **F1 · Identidad** | `id` estable en entidades; registros keyed por id; `ui.selected` = id; migrador localStorage v1→v2 (nombre→id); duplicar copia el árbol completo | store + nodos que leen `ui.selected` | Medio (migración) | M |
| **F2 · Reactividad** | Sembrado por evento; registros `reactive`; borrar `editTick`; `persist.js` con slices registrados y versión por slice | store | Medio | M |
| **F3 · Sujeto único** | `subject` computed; diccionario único de campos; `null` = no restringe (fuera sentinelas 20/10); números de verdad en `solicitud` (monto/salario) | store + ProviderField + Perfilamiento/Relacion | Medio | M |
| **F4 · Data-driven UI** | `data/providers.js` + `ProviderNode` único (5→1); `EDGE_C`/leyenda/`PROVS` leen del descriptor | App + nodos buró | Bajo | S–M |
| **F5 · RT_DEF + fidelidad** | Descriptor de response_type (flags, sin 'Híbrido' huérfano); condonadas: usarlas en `cuotaBreakdown` o marcarlas display-only; rt de Credifamilia consistente con MAP | store + 4 nodos | Bajo | S |
| **F6 · Split físico** | Partir `store.js` en `stores/` + `data/` (mecánico una vez F1–F5) | todo | Bajo (mover, no cambiar) | M |

Orden recomendado: **F0 → F1 → F2** son el corazón (poda, identidad, reactividad); F3–F6 pueden
intercalarse. Cada fase termina con `npm run build` + commit local (regla de oro del playground).

## 4. Qué NO haría

- **Pinia / Vuex** — overkill: slices con `reactive` + `computed` + un `persist.js` de 40 líneas
  cubren exactamente lo que este simulador necesita, sin dependencia nueva.
- **TypeScript ahora** — el retorno no paga la migración en un prototipo; JSDoc en los motores
  (subject, gates, cupo) da el 80% del beneficio.
- **Re-modelar el dominio** — la cadena catálogo → gate → categoría → tramo → cuota es fiel al
  sistema real (auditoría 2026-07-11); el problema es el empaque, no el modelo. Cambiar semántica
  de negocio acá sería un regreso.
- **Backend/API** — la gracia del simulador es ser 100% local y determinístico (`profile()` por
  documento). Eso se queda.

---

*Relación con [BALANCE-Y-PROXIMOS-NODOS.md](BALANCE-Y-PROXIMOS-NODOS.md): esta reorganización es el
**habilitador** de los nodos futuros — cada nodo nuevo (2ª evaluación, OTP, rotativo, Credifamilia
async) se vuelve "un slice + una fila en RT_DEF + un componente", en vez de otra capa de parches
sobre un store monolítico.*
