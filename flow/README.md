# flow — el simulador del onboarding de CreditOp

Un grafo **editable** (Vue 3 + Vue Flow, 100% local, sin backend) donde ves una solicitud de crédito
caminar de punta a punta —comercio → canal → solicitud → burós → reglas → perfilamiento → listado de
entidades → formalización— y podés tocar **cualquier** dato para ver qué entidad se cae, cuál queda
y **por qué**.

## Por qué existe

Explicar CreditOp con un documento no funciona: la decisión de crédito es una **cascada de 5 capas**
(catálogo del comercio → estado en sucursal → group_rules + datacrédito → categoría de perfilamiento
→ tramo por monto) y cada capa tiene semántica propia. Peor: la misma regla **excluye** a una entidad
CreditopX y solo **reordena** a una externa. Nadie retiene eso leyendo.

Acá lo tocás: bajás el score del cliente, apagás Ágil Data, cambiás el monto — y las tarjetas del
listado se recalculan con el motivo del rechazo escrito encima. Es **documentación que se puede tocar**
(la frase es de [BALANCE-Y-PROXIMOS-NODOS.md](docs/BALANCE-Y-PROXIMOS-NODOS.md), que lo explica en criollo
para negocio).

## Arranque rápido

```bash
cd /Users/miguelochoa/Desktop/CREDITOP/playground/flow
npm install          # ya está instalado en esta máquina
npm run dev          # → http://localhost:5190
npm run build        # vite build → dist/ (gitignoreado); ~1s, es la validación de rutina
```

Puerto **5190**, `strictPort: true` (si está ocupado, **falla**, no se corre solo). Para levantar una
2ª instancia sin pisar la del user: `PORT=5191 npm run dev` (`vite.config.js:7`).
`.claude/launch.json` define el target `flow` con `autoPort: true` justamente para eso.

**Convención de esta carpeta** (regla del user, respetala): en `flow` **no se levanta preview para
validar** — editás, corrés `npm run build`, commiteás local y describís el cambio; el user revisa en
su propio :5190. Y como todo `playground/`: **commit local, nunca push**.

### Lo primero que vas a ver: nada

El catálogo **arranca vacío** a propósito (`customLenders` sale de `localStorage`, no hay lenders
hardcodeados desde la poda F0). Hasta que no creés una entidad en **"Entidades del comercio"**
(botón *+ Agregar entidad*: nombre + tipo rt + producto) el grafo no tiene qué decidir y la mitad de
los nodos no aparece. Si ves un canvas casi vacío **no está roto**.

Recorrido mínimo para entender el modelo en 2 minutos:

1. *Entidades del comercio* → **+ Agregar entidad** → `CreditopX · rt2`, producto Crédito.
2. Clic en su fila → aparecen a la izquierda **Configurar entidad / comercio / sucursal**,
   **Perfilamiento** con sus 3 categorías y **Tramos por monto**; a la derecha, si pasa el listado,
   **Formalización** → **Estado del crédito**.
3. Cambiá el **N° de documento** en *Solicitud*: el buró entero se re-siembra (determinístico) y el
   listado cambia.
4. En el nodo *Experian · Acierta* clickeá el botón de API (ícono Wifi) del encabezado para simularlo
   caído → sin score → mirá qué categoría gana ahora (el chip **Exp** de *Perfil consolidado* se apaga
   como indicador, pero no es clicable).

## Cómo está armado

| Archivo | Qué es |
|---|---|
| `src/store.js` (~980 líneas) | **Todo el motor y el estado.** Catálogo de reglas, entidades, buró simulado, gate de sucursal, perfilamiento, tramos, cuota, post-selección y persistencia. Si venís a entender la lógica, empezá acá. |
| `src/App.vue` | Layout del grafo: posiciones fijas de los nodos, colores de edges por tema, y el `watch` que **agrega/quita** los nodos de config y de salida según la entidad seleccionada. |
| `src/fieldDocs.js` (107 entradas) | Diccionario **campo del simulador → realidad del código**: tabla donde vive, capa (application / legacy-backend / wizard / MS Go), estado (`decide` · `display` · `kyc` · `pisado` · `muerto` · `servicing`) y detalle. 28 de esas entradas son de nodo (`kind: 'node'`), con gotchas propios. |
| `src/nodes/*.vue` (22 nodos + 3 helpers) | Un componente por nodo. Helpers: `FieldInfoPanel` (el sidebar de detalle), `SettingsBar` (barra inferior), `ProviderField` (fila de dato de buró). |
| `src/settings.js` | Preferencias de UI aparte del escenario: tema y el check "Mostrar campos fuera de la solicitud". Se aplican por atributo en `<html>` + CSS global. |
| `src/styles.css` | Todo el CSS (temas claro/oscuro incluidos). |
| `src/useFails.js` | Wrapper de 7 líneas sobre el computed compartido `failing` — antes cada nodo creaba el suyo (~20 duplicados). |

Los nodos, por etapa: **contexto** (Comercio, Canal, Entidades del comercio) · **onboarding**
(Solicitud) · **burós** (Experian·Acierta, Experian·Quanto, Ágil Data, TusDatos, Mareigua → Perfil
consolidado) · **config del lender seleccionado** (Configurar entidad / comercio / sucursal, Estado
en sucursal, group_rules, Perfilamiento + categorías + Tramos por monto) · **decisión** (Entidades
disponibles) · **salida** (Información complementaria → Formalización → Estado del crédito).

## Conceptos que hay que entender sí o sí

**`response_type` (rt) es el eje de todo.** Define quién decide el crédito y, con eso, qué mitad del
grafo se enciende:

| rt | Nombre | Decide | En el simulador |
|---|---|---|---|
| 2 | CreditopX | CreditOp | Todo local: categoría, cupo, tramo, cuota, formalización paso a paso |
| 1 | Agregador | la API del lender | Un switch `aprueba / rechaza / timeout` — en la vida real tampoco lo controlamos |
| 0 | Redirect | su sitio | Se va y perdemos visibilidad |
| 3 | Rotativo | CreditOp | Cadena de formalización definida, pero **no se puede crear desde la UI** |

**Excluir vs clasificar.** Si falla el gate de sucursal (datacrédito + group_rules): rt=2 **se cae del
listado**; rt≠2 **baja al fondo** como "prob. baja" pero sigue visible. Es la inversión que más
confunde y está modelada explícita (`sucursalGate` → `verdict: 'exclude' | 'classify'`).

**El corte de monto no está donde parece.** En rt=2 la regla `amount` está deshabilitada a propósito
(`seedAmountRule` la borra): el tope real es el **cupo de la categoría** —`min(max_amount, fondo
disponible)`, inflado por el enganche `/(1−fee)` y topeado por capacidad de pago— y después el
**tramo**. En rt≠2 sí manda la regla `amount`.

**Fail-closed.** Sin dato no se pasa: si el buró no reporta un campo (checkbox por campo) o si el
proveedor está "caído" (apaga todos los suyos), la condición que lo mira **falla**, no se saltea.
Igual que producción.

**Cascada de ingreso:** Ágil Data → Mareigua → Quanto → declarado → 0. **Ábaco queda afuera**: es un
ingreso extra *informativo* (gig: Rappi/DiDi/Uber) que vive en el nodo "Información complementaria",
que solo aparece si la entidad tiene el flag `abacoExtra` prendido **y** además pasó el listado.

**16 reglas, override disperso.** `RULE_CATALOG` tiene 16 reglas; cada entidad solo declara
*overrides* y lo ausente queda "abierto" (= no restringe). Los umbrales abiertos son sentinelas
(20 negativos, 20 consultas, 10 moras): un valor en el borde **no restringe**.

**El sidebar es la fuente de verdad, no el tooltip.** Casi todo label (subrayado punteado) y todo
header de nodo abre `FieldInfoPanel` con tabla + capa + estado + gotchas. Esc cierra el sidebar;
2º Esc deselecciona la entidad.

## Deber-ser vs. lo que hoy existe (leer antes de citar el simulador como verdad)

El simulador es fiel en el **motor de decisión** —esa parte se auditó contra el código (ver
[MAP.md](docs/MAP.md))— pero en la **configuración** modela el deber-ser:

| El simulador muestra | El sistema real hace |
|---|---|
| **Herencia viva** por niveles: entidad → comercio → sucursal, con puntito gris (heredado) / amarillo (editado) y clic para volver a heredar | **No hay herencia viva.** Las reglas se **COPIAN** por sucursal al habilitar la entidad (~37k filas, con deriva). El simulador ya lo matiza en datacrédito/group_rules, que se **siembran** desde la entidad y luego derivan — esa parte sí es fiel a la copia |
| Catálogo limpio, entidades creadas a mano con 3 campos | El back-office que **produce** esa config (formularios de entidad y de comercio-lender, con sus campos fantasma) no está modelado — es la zona con menor cobertura declarada (31%) |
| Un motor de datacrédito | **Dos**, con campos y comparadores distintos (miden cosas diferentes del mismo reporte) |
| rt=2 que falla el gate → siempre excluido | El real lo conserva si el comercio tiene `have_ctopx`, y difiere el corte a la categoría |
| Cuotas condonadas visibles | Se muestran pero **no bajan** la cuota calculada (también acá: el tooltip promete algo que el número no hace) |

Las 4 divergencias de fidelidad están listadas y priorizadas en
[BALANCE-Y-PROXIMOS-NODOS.md](docs/BALANCE-Y-PROXIMOS-NODOS.md) §4. La cobertura honesta declarada ahí:
**~35% simulado / ~57% documentado** sobre la originación (el servicing post-desembolso está fuera
de alcance por decisión).

## Gotchas

- **`localStorage`, tres claves** (más una legacy). El escenario vive en `flow-graph` (versionado,
  `GRAPH_VERSION = 1`: un snapshot de otra versión se **ignora en silencio** y volvés a defaults) y el
  catálogo en `flow-custom-lenders`. Las preferencias van aparte en `flow-settings` (y `flow-theme`,
  leída solo por compatibilidad). **Reiniciar** (barra inferior, dos clics) borra las dos primeras y
  recarga; tema y visibilidad se conservan.
- **`editTick` es una trampa activa.** Cinco registros (`relationDefs`, `perfilDefs`, `sucDatacredito`,
  `sucGroups`, `tramoDefs`) son objetos **planos** con hojas reactivas, así que cada setter tiene que
  hacer `editTick.n++` a mano para que el guardado se entere — hoy hay **23 sitios**. Un setter nuevo
  que se lo olvide produce el bug más silencioso posible: **se ve bien en pantalla y se pierde al
  recargar.** El diagnóstico completo (y el plan para matarlo) está en
  [REORGANIZACION-DATOS.md](docs/REORGANIZACION-DATOS.md) D1/F2.
- **La identidad de una entidad es su nombre (string).** Todos los registros están keyed por
  `l.name`. Renombrar rompe la asociación con su config; está previsto en F1 y **no está hecho**.
- **Thin file se dispara por longitud del documento.** `profile()` marca `file = digits.length >= 6`:
  un documento de 5 dígitos o menos genera un cliente **sin historial** (sin score). Es la forma
  rápida de probar `allow_0_score`.
- **El buró se re-siembra al cambiar el N° de documento** — y pisa lo que hayas editado a mano en los
  nodos de proveedor.
- **Comentario mentiroso en `store.js:419`:** dice que "el salario declarado (si > 0) sobrescribe el
  ingreso estimado de Ágil Data". El código hace lo contrario: el declarado es el **penúltimo**
  escalón de la cascada. Manda el código.
- **Rama muerta en `App.vue:138`:** `def.generated ? 'tpl-prod-…' : 'tpl-base-…'`. Ninguna entidad
  tiene `generated` (murió en la poda F0) y el handle `tpl-prod-*` no existe en ningún componente →
  siempre toma la rama `tpl-base-`. Inofensivo, pero no te confunda.
- **`RT_LABEL` tiene un `4: 'Híbrido'` huérfano** que ningún nodo entiende, y rt=3 (rotativo) tiene
  cadena de formalización pero no está en el `<select>` de creación.
- **El catálogo del comercio no tiene checkbox**: una entidad nace habilitada y el único interruptor
  de visibilidad es **"Estado en sucursal"** (`lenders_by_allied_branches.status`, filtro duro).
- **`dist/` y `node_modules/` están gitignoreados** — `npm run build` no ensucia el árbol.

## Docs de esta carpeta

| Doc | Qué aporta |
|---|---|
| [MAP.md](docs/MAP.md) | **El mapa del código real**, no del simulador: 6 etapas (alta → asociación → inicio → burós → consolidación rt=2 / rt=1) con archivo y **línea exacta** de cada paso, más el orden verificado del cascade y los gotchas por etapa. Construido con 12 agentes (6 investigadores + 6 verificadores adversariales). Es la referencia cuando querés abrir el código de verdad. |
| [DOCUMENTATION.md](docs/DOCUMENTATION.md) | **Campo por campo**: qué hace de verdad cada campo del admin, las 3 "cuotas" que se llaman igual y no son lo mismo, los 3 baldes de la calculadora del comercio, el inventario completo de los formularios admin y los **campos fantasma**. De acá sale `fieldDocs.js`. |
| [BALANCE-Y-PROXIMOS-NODOS.md](docs/BALANCE-Y-PROXIMOS-NODOS.md) | La foto honesta para **negocio**: qué cubre el simulador (con porcentajes por zona), qué falta, los próximos nodos propuestos y por qué el 100% es un espejismo. |
| [REORGANIZACION-DATOS.md](docs/REORGANIZACION-DATOS.md) | Deuda técnica del `store.js`: 7 hallazgos con evidencia y plan **F0–F6**. **Solo F0 (poda, −440 líneas) está aplicada**; F1–F6 son propuesta. |
| [FAQ-SOPORTE.md](docs/FAQ-SOPORTE.md) | Los dolores reales de #tech-ops (barrido de ~590 mensajes) explicados con el mapa: causa probable + qué revisar + a quién escalar, con nivel de confianza 🟢🟡🔴. Origen del "trazador de solicitudes" de `playground/soporte`. |

**Fuera de esta carpeta:** el contexto cross-repo vive en `playground/context/` (`ROUTE-MAP.md` +
`server/data/flows/`), que además absorbió el viejo `playground/docs/`.

> ⚠️ **Punteros podridos.** La tabla de repos de `MAP.md` §0 apunta a
> `~/Desktop/CREDITOP/bitbucket/application`, **que ya no existe**: el monolito vivo hoy está en
> `~/Desktop/CREDITOP/github/legacy-application` (los archivos y líneas que cita sí siguen ahí).
> `DOCUMENTATION.md:311` y `src/fieldDocs.js:6` citan `docs/codigo/*.md`, de la carpeta
> `playground/docs/` **borrada** — recuperables con `git show 159906a:docs/<ruta>`.
