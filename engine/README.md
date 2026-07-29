# engine — motor de cálculo

**Seis etapas, y las dos del medio son la idea entera.** En el cálculo hay exactamente **dos
puntos** donde algo puede entrar, y cada uno es un nodo:

```
                     ┌ tasa ────────────┐
                     │ tasa del período │──────────┐
                     └──────────────────┘          │
 ┌ el crédito ───┐                                 ▾
 │ monto         │  ┌ al monto ─────────┐  ┌ cuota ────────────┐  ┌ Plan de ┐
 │ cuotas        │─▸│ valor a financiar │─▸│ cuota del crédito │─▸│  pagos  │
 │ cuota inicial │  └─────────┬─────────┘  │ cuota total       │  └─────────┘
 └───────────────┘            ▾            └───────────────────┘
                    ┌ a la cuota ──────┐             ▴
                    │ cargos por cuota │─────────────┘
                    └──────────────────┘
```

| | qué entra ahí | termina en | genera intereses |
|---|---|---|---|
| **al monto** | lo que se financia junto con el crédito | `financedAmount` | **sí** |
| **a la cuota** | lo que viaja arriba de cada pago | `installmentCharges` | no |

Agregar un costo nuevo de un lender es **elegir uno de los dos nodos**. No hay una tercera
respuesta, y las dos están en pantalla — eso es lo que hace posible normalizar entidades en vez
de configurarlas una por una.

Y así `cuota` queda con un solo trabajo: la anualidad y la suma. Antes hacía las dos cosas —
el `pmt` **y** los recargos — y por eso costaba leerlo.

### La fianza es la prueba

Es el mismo costo, y `guaranteeUpfront` elige a cuál de los dos va. Con fianza del 5% sobre
10.000.000 a 24 cuotas:

| la fianza va | valor a financiar | cargos por cuota | cuota del crédito | **cuota total** |
|---|---|---|---|---|
| **al monto** | 10.500.000 | 0 | 555.147 | **555.147** |
| **a la cuota** | 10.000.000 | 20.833 | 528.711 | **549.544** |

Los **5.603** de diferencia son el interés que se paga por financiarla: `pmt(2%, 24, 500.000)`
= 26.436 contra `500.000 / 24` = 20.833. El interruptor está en el encabezado de la sección de
fianza, y su color es el del nodo a donde manda la plata — ámbar el monto, teal la cuota.

### Ninguna columna está escrita a mano

La disposición sale de las dependencias **reales** del AST (`layout.js`). Por eso `tasa` y
`al monto` caen en paralelo — ninguna depende de la otra — y `a la cuota` cae *después* de
`al monto`, porque el seguro de vida se calcula sobre lo financiado. Ese hecho no está declarado
en ningún lado: lo dibuja la fórmula.

Cada nodo muestra **siempre su resultado**; `showRows: false` esconde los pasos intermedios,
nunca la salida. Un nodo que no dice qué produce obliga a leer la etiqueta del cable.

```bash
npm install
npm run dev     # http://localhost:5196
node verify.mjs # 30 puntos de control contra los archivos fuente
```

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
