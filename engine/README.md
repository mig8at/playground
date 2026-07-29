# engine — motor de cálculo

**Cinco etapas.** Cada una trae sus propios inputs y sus propias fórmulas: se lee de izquierda
a derecha y en cada nodo está todo lo que ese paso necesita.

```bash
npm install
npm run dev     # http://localhost:5196
node verify.mjs # 30 puntos de control contra los archivos fuente
```

```
┌ el crédito ────────┐   ┌ tasa ─────────────────┐
│ monto  10.000.000  │──▸│ DICHA [mensual] 2% E.M.│──┐
│ cuotas         24  │   │ ───── ▾ EFECTIVA ───── │  │  ┌ cuota ──────────────┐
│ − cuota inicial 0  │   │ SE COBRA [mensual] M.V.│  ├─▸│ +seguro de vida  0% │
└────────────────────┘   │ equivale a 26,82% E.A. │  │  ├─────────────────────┤
           │             ├────────────────────────┤  │  │ cuota del crédito   │
           │             │ tasa del período  2,00%│  │  │ fianza por cuota    │
           │             └────────────────────────┘  │  │ cuota total 528.711 │
           │             ┌ valor a financiar ─────┐  │  └─────────────────────┘
           └────────────▸│ FIANZA · VA AL MONTO ▸  │──┘             │
                         │ fianza            0%   │                 ▾
                         │ IVA de la fianza  0%   │        ┌ Plan de pagos ───────────┐
                         │ 4 × 1000          0%   │        │ # saldo interés capital …│
                         └────────────────────────┘        └──────────────────────────┘
```

`tasa` y `valor a financiar` van **en paralelo** porque ninguna depende de la otra; `cuota`
depende de las dos. La disposición no está escrita a mano: sale de las dependencias reales
(`layout.js` las calcula del AST).

Está en **lo mínimo a propósito**, para ordenar de a poco. La hoja paramétrica completa —19
fórmulas, 17 inputs y las 6 configuraciones de producto (Motai, Alta, salud)— vive en
**`reference/full-sheet.js`**: fuera de la app pero **viva**, porque `verify.mjs` la corre y
sigue probando que **una sola hoja reproduce los cuatro productos** con 30 puntos exactos
contra los `.xlsm` y el PDF.

**Cómo volver a crecer, un bloque por vez: [docs/HOJA-COMPLETA.md](docs/HOJA-COMPLETA.md).**

## La conversión de tasa, como la conversión que es

```
 DICHA     [anual ▾]      28,17 %
 ───────── ▾ EFECTIVA ─────────
 SE COBRA  [mensual ▾]   2,089764 %
 equivale a 28,17% E.A.
```

Se lee de arriba hacia abajo: de dónde sale el número, **por qué camino**, y en qué termina.
**La convención va en el medio y es el interruptor**, porque es exactamente ahí donde se decide
si se capitaliza o se divide:

```
efectiva   periodRate = (1 + statedRate) ^ (statedPerYear / periodsPerYear) − 1
nominal    periodRate = statedRate * statedPerYear / periodsPerYear
```

Mismos dos parámetros; solo cambia `×` por `^`. Es un `if()` de **selección de parámetro**, no
lógica de negocio.

### Y es la demostración de F-71, en un click

Un crédito de 12.000.000 a 36 cuotas con "28,17%", según cómo se lea ese número:

| | tasa del período | E.A. real | cuota |
|---|---|---|---|
| **efectiva** | 2,089764% | 28,17% | 493.292 |
| **nominal** | 2,3475% | **32,11%** | **513.150** |

**3,94 puntos** al año y **714.890 pesos** en el crédito. Es el error de CORE-127 con otros
números: el canon de la plataforma es **nominal** (`credit_line_by_lenders.rate_suffix` = `"N.M."`
en las 157 filas) y los `.xlsm` **capitalizan**.

La UI muestra **porcentaje** (`28,17 %`) porque escribir `0.2817` es antinatural. El documento
guarda el decimal — la interfaz traduce, el dato no cambia.

### La sigla, al lado de cada porcentaje

Cada fila del bloque lleva su notación colombiana, con el nombre largo en el tooltip. Son **tres
familias**, y confundirlas es exactamente F-71:

| fila | familia | qué dice | ejemplos |
|---|---|---|---|
| **dicha**, efectiva | `ef` | capitaliza | `E.A.` `E.M.` `E.T.` `E.Sm.` |
| **dicha**, nominal | `no` | no capitaliza: se reparte dividiendo | `N.A.` **`N.M.`** `N.T.` |
| **se cobra** | `vc` | *cuándo* se cobra: al final del período | `M.V.` `T.V.` `Q.V.` `Sm.V.` |

Dos cosas que la sigla hace visibles gratis:

- Poner "dicha mensual + nominal" imprime **`N.M.`** — literalmente el `rate_suffix` de las 157
  filas de `credit_line_by_lenders`. La UI habla la notación de la columna.
- La fila de abajo **siempre** es vencida, porque nuestro `pmt` cobra al final del período (el
  `type=0` de Excel). Deja a la vista que *anticipado* no está soportado, sin una nota al pie.

Los nombres largos están **escritos** en `RATE_NOTATION`, no derivados: así "quincena vencid**a**"
concuerda en género sin trucos de string.

## Para entenderlo desde cero

**[docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md)** — sin saber nada de finanzas y sin fórmulas
hasta el final: por qué prestar plata es alquilarla, por qué el interés baja aunque la tasa no se
mueva, por qué convertir períodos no es dividir, y por qué la E.A. sirve para comparar y no es lo
que se paga.

## Las piezas

```
src/engine.js      tokenizer → parser descendente → AST → intérprete.  SIN eval().
                   + pmt / ipmt / ppmt  + evalSheet()  + evalPolicy()
src/sheets.js      la hoja mínima
reference/full-sheet.js  la hoja completa + las 6 configuraciones (solo verify)
src/store.js       estado reactivo compartido; los nodos lo importan directo
src/layout.js      disposición automática por profundidad (sin dagre: son DAGs chicos)
src/nodes/         StageNode (la etapa universal) · SeriesNode (la tabla)
src/RateBlock.vue  la conversión de tasa
src/MoneyInput.vue campo de dinero con separador de miles
src/PercentInput.vue  muestra %, guarda decimal
verify.mjs         arnés de regresión contra los archivos fuente
```

`engine.js` es el mismo diseño que iría en el paquete `formula` de Go. El intérprete no usa
`eval()`: solo números, referencias, aritmética y funciones de una lista blanca.

## La hoja mínima

`simulador` es la hoja **sin lógica de negocio**: nada de IVA, seguros, fianza ni margen.
Solo la mecánica, y es la que muestra el concepto sin ruido:

```
entra    monto · tasa · nº de cuotas · cada cuánto se paga
sale     cuota · total pagado · intereses · E.A.
```

Su documento completo son ~25 líneas de JSON: cinco fórmulas, tres inputs, dos períodos.
El botón **documento** de la barra lo muestra — la hoja entera es ese JSON, nada vive en
código.

No necesita `termIn`: si decís "24 cuotas" directamente, el nº de cuotas **es** `n`. Ese
tercer período solo existe cuando el negocio dice el plazo en meses pero cobra en otro
período (el caso de Motai).

Sobre 10.000.000 al 2% dicho mensual, 24 cuotas:

| se cobra | periodRate | cuota | total | E.A. |
|---|---|---|---|---|
| semanal | 0,458029% | 440.940 | 10.582.564 | 26,82% |
| quincenal | 0,995049% | 470.457 | 11.290.976 | 26,82% |
| mensual | 2,000000% | 528.711 | 12.689.063 | 26,82% |
| trimestral | 6,120800% | 805.706 | 19.336.952 | 26,82% |

⚠ Ojo con leer esa tabla: con el **nº de cuotas fijo en 24**, cambiar la periodicidad cambia
la **duración del crédito** — 24 semanas son 5,5 meses y 24 trimestres son 6 años. Por eso
el total sube tanto. La E.A. quieta en 26,82% confirma que la tasa se convirtió bien: es el
mismo costo del dinero, sobre plazos distintos.

## Convenciones

- **Tasas en decimal**: `0.19`, no `19`. Así lo escriben los `.xlsm` y así se le pasan derecho a
  `pmt()` — desaparece el `/100` de todas las fórmulas.
- **Todo positivo**: `downPayment` entra positivo y la fórmula resta. El Excel lo pide en negativo
  y es una trampa.
- **Claves de tabla numéricas**: `merchantId: 178`, nunca `"Gaes"`. Un string mágico mal escrito
  cae al `else` en silencio. El texto vive en `label` y el motor nunca lo lee.
- **Fechas afuera**: `firstPeriodDays` es un **input**. El calendario (todos los lunes, mínimo 5
  días, festivos) es política del llamador, no aritmética.

## Lo que deliberadamente NO está

- **Versionado.** Decisión de alcance: se agrega cuando se pida. Es una tabla nueva, no un rediseño.
- **Conversión automática de período.** El motor nunca convierte solo: renting quiere prorrateo
  lineal y RTO quiere conversión compuesta de la tasa. Elegir por ellos rompería uno de los dos.
  Cada hoja escribe su puente con nombre y a la vista.
- **Fechas, calendario y días hábiles.**
- **Persistencia.** Las hojas viven en `sheets.js`; en el servicio real serían filas de Postgres.

## Verificación

```bash
node verify.mjs
```

33 comprobaciones contra los archivos originales — las tres cuotas del RTO, los tres planes del
renting, los dos escenarios completos de salud y el punto 9 de Alta. Ver
[docs/VERIFICACION.md](docs/VERIFICACION.md) y el diccionario de términos en
[docs/DICCIONARIO.md](docs/DICCIONARIO.md).
