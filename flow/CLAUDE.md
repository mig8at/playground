# Flow — el simulador de los rieles

`flow` es un **simulador para entender**, no producción ni un catálogo real: un grafo editable (Vue 3 + Vue Flow, sin
backend, el estado en `localStorage`) donde una solicitud camina comercio → canal → solicitud → burós → reglas →
perfilamiento → listado → lo que pasa después de elegir. Es de Miguel, para su propio entendimiento: se pone al día
de vez en cuando y **no tiene que seguir al código al pie de la letra**. Lo que muestra Flow nunca es evidencia.

- **Abrir:** la app Flow de Cockpit, o `make flow` (:5252, Vite). Sin servidor propio.
- **Por consola, lo carga y lo cambia Claude: `bin/flow`** (`flow/cli/flow.mjs`). Le habla a la app ABIERTA (la de
  Cockpit) por su servidor (`server/bridge.mjs`: la CLI manda comandos, la app los aplica con su propia lógica y contesta);
  si no hay ninguna, la abre. Lee las bases por `bin/pg`, sólo lectura, qa por defecto:
  - `bin/flow status` — qué entidades tiene, cuál está elegida y cómo sale cada una en el listado (y por qué no).
  - `bin/flow branches --target qa --lender 149` — sucursales activas con esa entidad.
  - `bin/flow import --target qa --branch <id|hash> --lender 149[,24] [--select <nombre>] [--replace]` — la entidad REAL:
    línea, categorías activas con su regla de titular inicial, tramos, reglas de la sucursal, producto y la ficha delegada
    (`delegated_origination_profiles`).
  - `bin/flow client --occupation pensionado --continuity 12m --score 800 …` — el cliente de la solicitud.
  - `bin/flow add|select|remove|clear|delegated|view graph|table|open`. `bin/flow` sin argumentos lo dice todo.
  - Hoy en Cockpit (2026-11-25, de qa): Motai Renting y Rent to Own (sucursal 682), Credifamilia y CrediPullman (2232) y
    Banco Finandina (2247), con el cliente empleado, sin negativos y 12 meses de continuidad.
  - ⚠ Cada ventana guarda su propio escenario: con dos apps abiertas (Cockpit y un navegador), las dos reciben el
    comando. El botón «Importar prod» se fue: leía por el trazador, que se borró el 2026-10-13.
- Las rutas por hash (`#/lender?…`) se quitaron el 2026-11-25: Cockpit guarda la última ruta y la volvía a aplicar al
  reiniciar, y creaba entidades de ejemplo solas. Todo eso lo hace `bin/flow`.
- **Por consola, para un modelo:** `python3 flow/tools/flow_context.py map --text` · `route "<pregunta>" --text` ·
  `brief <tema> --text`. Mapa → una ficha → la fuente que cita. No le pases cédulas, solicitudes ni datos de un caso.
- **Un caso o un estado real** no se contesta acá: el harness (correr), `bin/pg` (la base, Loki) y, en prod, el
  tracer del repo compartido.

## La ventana (2026-11-26): el workbench de la base

- **Sidebar «Escenario»** (`ScenarioSidebar.vue`), a la izquierda y para las dos vistas: el comercio y la sucursal, las
  **entidades** (elegir una acá es lo mismo que en «Entidades disponibles»; el punto dice si sale en el listado), el
  **cliente** (`ClientForm.vue`: monto, ingreso, ocupación, continuidad, edad, score, negativos, documento, cuotas que ya
  paga y experiencia) y la **leyenda**, que antes flotaba sobre el lienzo. Secciones plegables (`<details>`), guardadas
  en `flow.sidebar-sections`.
- **Editor**: las pestañas «Grafo | Tabla» son su banda; en el grafo, a la derecha, Encuadrar, mostrar lo que no
  participa y Reiniciar.
- **Sidebar secundario**: el detalle de un campo o nodo del grafo (`FieldInfoPanel.vue`) o la calculadora de la celda de
  la tabla (teletransportada al `.workbench` desde `TableView.vue`). Aparece con lo elegido y se cierra con su ✕ o Esc;
  su manija ajusta el ancho pero no lo pliega.
- **Pie**: la entidad elegida, «escenario guardado» y el botón del sidebar. El tema sigue siendo de Cockpit: el botón del
  tema está oculto y existe para que `bindThemeToggle` escuche a Cockpit y ponga al lado el botón del panel «Claude».
- Las medidas (`flow.sidebar-w`, `flow.sidebar-open`, `flow.auxiliarybar-w`) se guardan; lo que se pinta se deriva con
  `fitRegions` en `App.vue`.

## Dos vistas: Grafo y Tabla

Arriba, «Grafo | Tabla» (o `bin/flow view table`), guardado en `flow-settings`. El **grafo** cuenta UNA entidad, nodo por
nodo. La **tabla** (`src/TableView.vue`, 2026-11-25) pone el mismo cliente contra todas las entidades: una fila por paso de
la solicitud y una columna por entidad, y cada celda dice si pasa (verde), si se corta (rojo), si sigue con probabilidad
baja (ámbar) o si no le aplica. Al abrir una celda sale, a la derecha, la «calculadora» del paso; el cliente se edita en el
sidebar «Escenario» y toda la tabla se recalcula.

- Tiene las seis filas: **1 · Listado** (las reglas duras de la sucursal: tipo de documento, centrales y grupos; CreditopX
  que no las cumple no sale, las demás salen con probabilidad baja) y **2 · Preaprobación** (quién contesta, las
  categorías si decide el motor —cada una con lo que pide y lo que tiene el cliente, en verde y rojo, y arriba quién ganó
  y qué tumbó a las de más prioridad (`categoryRequirements`, que sale de la misma `catChecks` que decide)—, lo que se
  dicta si decide la API, el cupo y la cuota con su fianza) y **3 · Elegir la
  entidad** (`selectionCheck`: lo que revisa `update-user-request`, lo que guarda —el `amount` de CreditopX lleva el FGA,
  el de la delegada no— y por dónde sigue cada riel) y **4 · Validación de identidad** (`identityOutcome`: los proveedores de
  `lender_identity_validation_types` en orden, que `bin/flow import` trae desde 2026-11-25; lo que contesta cada uno se
  dicta en la celda y, si el primario no valida, pasa al siguiente) y **5 · Plan de pagos** (`paymentDateOptions` y
  `paymentSchedule`, que usa también el nodo del grafo: CreditopX el 5, 16 o 28 entre 26 y 60 días después de mañana; la
  delegada, cada día de su ficha en el mes siguiente si faltan 30 días o más, y el interés de los días de más en la
  primera o en la última cuota según `extra_days_interest`, que trae `bin/flow import`) y **6 · Firma y cierre**
  (`signingOf`/`closingOutcome`: el juego de documentos en el orden de `PromissoryNoteController` —firma configurable,
  juego fijo de Credifamilia, catálogo con o sin codeudor, estándar—, si el pagaré va a Deceval, la firma con OTP que se
  dicta en la celda, el 11, la formalización del riel 4 y quién cobra; `bin/flow import` trae `lender_signing_documents`,
  `netco_lender_settings`, `promissory_type_id` y `externally_serviced`).
- **La política de Finandina** (`finandinaAmount` en `src/store.js`, como `FinandinaAmountCalculator` de main; 2026-11-25):
  un perfil con `capacity_method = finandina_v1` sólo aplica si el ingreso viene de Ágil Data o Mareigua y cae en una
  de sus bandas (`income_bands`, en SMMLV); su cupo es el menor entre la capacidad (ingreso − % ley − % gastos − cuotas
  que ya paga, llevada a monto con `capacity_rate` y el plazo), las veces el ingreso de la banda, el tope sin
  experiencia y los máximos. `bin/flow import` trae las bandas, el tope sin experiencia, `capacity_rate` y el SMMLV
  (`settings.smmlv_by_year`). En la tabla se editan el ingreso (se escribe como el de Ágil Data), las cuotas que ya paga,
  la experiencia crediticia y el tipo de documento. No modela el tope del mes de la entidad ni sus créditos recientes.
- Una categoría sin `max_fee_number` (NULL en la base) no recorta los plazos, como en main; hasta el 2026-11-25 Flow lo
  leía como 0 y dejaba a CreditopX sin plazos.
- **No tiene lógica propia**: usa la de `store.js` (el listado, `sucursalGate`, `perfilDiag`, `bondOf`,
  `cuotaBreakdown`), con alias en inglés al final de ese archivo. Lo que se cambia en una vista se ve en la otra.

## Los rieles (el `response_type` de la entidad)

| rt | riel | quién decide | después de elegir |
|---|---|---|---|
| 2 | CreditopX | CreditOp, con categorías y tramos | elegir → identidad → [Ábaco, codeudor] → plan (5/16/28, entre 26 y 60 días) → firma → 11 |
| 4 | originación delegada | la entidad, por el servicio de preaprobación | recheck → identidad → formulario de la entidad → plan con su ficha → firma → [radicación] → 11 |
| 1 | agregador | la API de la entidad | radica → la entidad contesta después |
| 0 | redirect | la entidad, en su sitio | se redirige |

El rt=3 (rotativo) se dobla a rt=2. **El riel 4 se separó el 2026-11-25** (antes se doblaba a CreditopX) y es UNA
sola «delegada»: no se distingue Finandina de Credifamilia. Dos nodos lo explican:

- **Servicio de preaprobación** (`PreApprovalNode.vue`, `preApprovalResponseOf` en `src/store.js`): cuelga arriba de
  «Entidades disponibles» —es ahí, tarjeta por tarjeta, donde se le consulta— y muestra la entidad elegida. Para rt=4 y
  rt=1 dictás lo que contesta pre-approvals-service —aprueba, rechaza o no contesta, el monto máximo y la tasa— y el
  listado y el resto del flujo reaccionan.
- **Motor de cupo · legacy-backend** (`QuotaEngineNode.vue`, arriba de la preaprobación): aplica las categorías. Verificado
  en main el 2026-11-25, se le pregunta en dos momentos y los dos los dispara el servidor del wizard:
  1. en el listado, por pre-approvals-service, por cada tarjeta CreditopX (`POST /api/loans/lender/available-quota`,
     `CreditopXQuotaController::getAvailableQuota`); la delegada que lo usa (Finandina) llega por un alias que está en
     develop y no en main; Credifamilia contesta con su API;
  2. después de validar la identidad (o del formulario de la entidad si no hay validación pendiente), directo y para
     CUALQUIER entidad en casa (`available-quota/extended`): decide codeudor, fecha de pago o cancelada; sin política
     «titular extendida», aprueba sin evaluar.
- **La columna que decide el cupo** (2026-11-25): categorías y tramos → perfilamiento → motor de cupo, de arriba abajo,
  con el motor justo encima de «Validación de identidad» (`placeDecisionColumn` la ubica según dónde cae la identidad).
  La preaprobación llega al motor de izquierda a derecha, sólo si la entidad lo usa. La ficha delegada quedó al lado de «Configurar entidad».
  En qa (medido el 2026-11-25) la política «titular extendida» (tipo 2) la tienen sólo Banco Finandina (149), Motai
  Renting (158), Rent to Own (205) y AltaX (211); CrediPullman y Credifamilia no: `extended` les aprueba sin evaluar.
- **Halo = contesta un tercero** (2026-11-25; antes fue borde punteado): las centrales, Ábaco y el servicio de preaprobación cuando
  decide la API de la entidad (agregador o delegada sin motor). Una central «caída» se marca con borde rojo.
- **El camino de la entidad elegida** (`paint` en `App.vue`): lo que recorre, pleno y con líneas gruesas; su configuración,
  a media luz; lo que no usa (el perfilamiento sin categorías, el motor para agregador y redirect), apagado.
- **Elegir la entidad** (`LenderSelectionNode.vue`, `selectionCheck`): `update-user-request` NO vuelve a consultar el
  cupo; rechaza el monto distinto del pedido de la tienda, la cuota inicial que alcanza el monto y la originación apagada,
  y pasa a 3. Reemplazó a la «Re-evaluación en POS», que dibujaba una consulta que no existe.
- **Ficha de originación delegada** (`DelegatedProfileNode.vue`, `delegatedOf`), sobre «Plan de pagos» y con líneas a lo que
  la lee en main (2026-11-25): el plan (`PaymentDateService`, controladores de PaymentPlan) y la formalización al autorizar
  (`LoanAuthorizationService`), hacia la radicación o el estado final. La tabla `delegated_origination_profiles` es de
  CORE-918 (merge del 2026-11-03); la fila de Finandina, del 2026-11-17 (CORE-845). Las tres claves que eligen código
  (`inputs_source`, `bond_percentage_source`, `formalization`) son de sólo lectura; los valores fijos se pueden cambiar
  ahí mismo para probar «¿y si la fila dijera otra cosa?»: `payment_days` (fichas) y `forced_bond_type` (anticipada,
  vencida o NULL = lo trae la preaprobación), y el % cuando sale de la tabla del FNG, que Flow simula. Lo cambiado se marca
  en ámbar contra lo que vino de qa (`production.baseline.delegated`, lo guarda `bin/flow import`) y «Volver a lo de qa»
  lo deshace.
- **La fianza de la delegada** (`bondOf` en `src/store.js`, como `PaymentPlanPayloadBuilder::resolveBond`, verificado en
  main el 2026-11-25): el % con `fng_table` sale de la tabla del FNG por plazo; con `pre_approval` es el
  `guarantee_percentage` de la preaprobación, que con el motor (`creditop_x_pre_approval`, Finandina) es el **FGA de la
  categoría ganadora** (`lender_users_categories.fga`: 5 % en AA·A·B y 9 % en C·S·Y en qa; sin él, el del convenio) y
  con la API de la entidad (Credifamilia) se dicta en el nodo de preaprobación. El tipo es `forced_bond_type` si la ficha
  lo fuerza; si no, el de la preaprobación (con el motor, siempre anticipada). Hasta el 2026-11-25 Flow simulaba un 10 %
  fijo para todas.

La cuota del riel 4 es aproximada (sin 4×1000 ni intereses de los días hasta la primera cuota).

## Lo que conviene saber antes de tocarlo

- **`npm run build` es la vara**: no hay pruebas de la UI. Mirá cómo se ve con `make ui-shot URL=http://localhost:5252/` (con `make flow` arriba) o en la app.
- Los nombres en español que traía al entrar a my-tools son deuda congelada de `make tablero-naming`; lo nuevo, en
  inglés.
- **El tema y la base son los compartidos** (`theme.css`, `workbench.css` y `workbench.js`, copiados por `make style-sync`;
  `make style-check` lo vigila): el lienzo es el `editor`, el detalle de un campo el `auxiliarybar`, y hay un pie.
  **El tema no se elige en Flow**: lo hereda de Cockpit (claro/oscuro y paleta). `styles.css` arranca con el puente:
  lo neutro apunta a los tokens del tema y lo propio (el color de cada riel y sus tintes, mezclados con la tarjeta)
  queda acá. ⚠ La base también define `.field` (en columna): el de Flow va en fila a propósito.
- `docs/` es histórico, de cuando vivía en `temp/` (cita `playground`, el trazador y `make flow-context`, que ya
  no existen acá).
