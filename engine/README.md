# engine — motor de cálculo y política

Prototipo visual del **`calculator-service`** que estamos diseñando: un microservicio que evalúa
documentos versionados (hojas de cálculo y políticas de riesgo) contra un juego de inputs, **sin
saber nada del dominio**. Recibe números, devuelve números; recibe hechos, devuelve un veredicto
con su motivo.

```bash
npm install
npm run dev     # http://localhost:5196
```

## Tres etapas, de izquierda a derecha

El canvas está rotulado en tres zonas, y todo es vivo: tocás un input y se recalcula entero.

| | zona | qué hay |
|---|---|---|
| **1** | **Entrada** (ámbar) | inputs, constantes y tablas. Todo editable, nada se calcula |
| **2** | **Cálculo** (azul) | las fórmulas agrupadas por etapa; el output en morado |
| **3** | **Qué sigue** (verde) | qué se hace con los números una vez calculados |

La etapa 3 es la que faltaba y la que hace visible **la frontera del servicio**:

- **Plan de pagos** — la **tabla completa como nodo**, con scroll interno. En el simulador la
  tabla *es* la salida: la cuota es un número suelto, la tabla muestra **por qué** — cómo baja el
  saldo y cómo el interés le va cediendo lugar al capital fila por fila. Estaba en un cajón
  colapsado al pie y competía con el grafo; ahora es parte de la cadena.
- **Política** — el veredicto, con la regla que lo disparó. Si la hoja no tiene política
  lo dice, que también es información: son recursos separados.
- **Fuera del motor** — punteado y apagado a propósito: documentos, core, BD, pantalla.
  El motor devolvió números y un veredicto; de ahí en adelante es del que llama.

La pestaña **Política** sigue estando para ver el árbol completo (el *gate* corre en cadena
y **corta en la primera regla que falla**), pero ya no hace falta ir a buscarla para saber
que existe.

### La entrada es la perilla

Todo lo que define el cálculo se cambia en el nodo *Entrada* y el grafo entero se recalcula:

```
la tasa está dicha   [mensual ▾]     ← statedPerYear
se cobra             [mensual ▾]     ← periodsPerYear
amount                10.000.000
statedRate  MENSUAL          0,02
installments                   24     ← número libre, no una lista fija
```

Bajar `installments` de 24 a 6 mueve la cuota de **528.711 a 1.785.258**, los intereses de
2.689.063 a **711.549**, y la tabla de 24 a **6 filas**. Sin perder el foco del campo.

**Se edita adentro del grafo.** No hay panel lateral: el nodo *Entrada* trae los campos, con
separador de miles en los montos. Y las **constantes también son editables** — es un simulador,
así que "¿y si el IVA fuera 21%?" se contesta escribiendo. `restablecer` vuelve a los valores
del archivo original; `SHEETS` nunca se muta.

La prueba que más rápido explica el diseño: **vaciá un input**. Solo se apagan sus descendientes
(`skipped` / `upstream`); el resto sigue dando su número. Eso es la evaluación parcial, y es lo
que hace usable un editor donde la hoja está a medio escribir.

## Click en una fórmula → panel derecho

Clickeás cualquier fórmula (una fila de un grupo, o un nodo en modo detalle) y se abre un panel
a la derecha con:

- el **valor** actual y, si no calculó, por qué;
- la fórmula **renderizada con KaTeX**, con interruptor
  **símbolos ⇄ con valores** — la segunda sustituye cada referencia por su número real:
  `pmt(0,004125; 104; 10.790.920)`;
- el **LaTeX** en texto, con botón de copiar;
- **depende de** y **lo usan**, ambos navegables: click y saltás a esa fórmula.

Todo sale del **mismo AST que evalúa el motor**, así que no puede desincronizarse del cálculo:
no hay una segunda transcripción de la fórmula que se pueda quedar vieja.

### El reparto con KaTeX

Son dos mitades distintas y conviene no confundirlas:

| | quién |
|---|---|
| AST → string LaTeX | **`src/latex.js`** — ninguna librería puede hacerlo: no conocen nuestro árbol |
| string LaTeX → dibujo | **KaTeX** — recibe LaTeX y lo pinta; no lo produce |

`latex.js` maneja precedencia (paréntesis solo donde hacen falta), `\dfrac`, superíndices,
`\begin{cases}` para los `if()` y notación de corchete para las tablas
(`rentalPlans[planDurationWeeks].factor`).

Dos detalles de LaTeX que hay que saber:

- En modo matemático la **coma y el punto son puntuación**: `10.790.920` saldría
  `10. 790. 920` con espacios. Van encerrados en llaves (`10{.}790{.}920`) para volverlos
  símbolos comunes. Con separadores en español eso pasa en cada número.
- El `trust` de KaTeX está acotado a `\htmlClass`, el único comando HTML que generamos
  (para pintar de morado los valores sustituidos). `\href` y el resto quedan cerrados.

KaTeX suma ~260 KB de JS y ~30 KB de CSS al bundle, más las fuentes. Para una herramienta
local que corre sin red, gratis.

> Detalle técnico que cuesta un rato encontrar: los controles dentro de un nodo necesitan la clase
> **`nodrag`** o Vue Flow arrastra el nodo al escribir. Y el `v-model` apunta al **store**, no al
> prop `data`: `data` se recrea en cada recálculo, así que atarlo ahí haría perder el foco a cada
> tecla.

## Por qué el cálculo NO es de nodos sí/no y la política SÍ

Un grafo sí/no modela **control de flujo**. En la aritmética no hay: todo se calcula siempre,
`financedAmount = taxableBase + vatAmount` no tiene rama "no". Y un nodo por *operación*
convertiría `(1 + monthlyRate) ^ (monthsPerYear / weeksPerYear) - 1` en seis cajitas con cables
— menos legible que la expresión escrita. Por eso: **un nodo por fórmula, la expresión como texto
adentro**.

## Un nodo por zona

Cada zona es **un nodo**, y las etapas viven como **secciones adentro**:

```
┌─ Entrada ──────┐   ┌─ Cálculo ───────────┐   ┌─ Plan de pagos ─┐
│ inputs         │   │ ── COMERCIO ──      │   └─────────────────┘
│ constantes     │ → │ maxAmount           │ → ┌─ Política ──────┐
├─ merchantConfig┤   │ ── TASAS ──         │   └─────────────────┘
│ 142 · Dentix   │   │ monthlyRate         │   ┌ Fuera del motor ┐
│ 178 · Gaes     │   │ ── FIANZA ──  …     │   └ ─ ─ ─ ─ ─ ─ ─ ─ ┘
└────────────────┘   └─────────────────────┘
```

Antes era un nodo por etapa. Se juntaron por dos razones:

1. **Simetría.** Si los datos van juntos porque son datos, los cálculos van juntos porque
   son cálculos. La entrada ya era un nodo; el cálculo no tenía por qué ser cinco.
2. **El panel derecho lo hace mejor.** El argumento para separarlos era "el grafo muestra
   las dependencias" — pero el panel da `depende de` y `lo usan` **con los valores y
   navegables**. Estaban duplicando trabajo y el grafo perdía.

El grafo se queda con la **arquitectura** (entrada → cálculo → qué sigue, y dónde termina el
servicio) y el panel con las **dependencias**.

Ganancia concreta: `creditopx-salud` pasó de 5 columnas —ilegible sin zoom— a 3, y las 15
fórmulas se leen de corrido como un desglose. Las etapas no se perdieron: son los
encabezados de sección, y por eso en `alta-fleet` se sigue viendo que hay
**CRÉDITO MOTO** y **CRÉDITO PÓLIZA** por separado.

## Un solo nodo de Entrada

Inputs y constantes **no ocupan un nodo cada uno**: van todos juntos en el nodo *Entrada* de la
izquierda. Son hojas del grafo y dibujarlos sueltos era ruido — llenaban la primera columna y
cruzaban aristas por todos lados sin decir nada. Lo que se quiere leer es la cadena.

Las **constantes no tiran ninguna arista** (son ambiente: se ven en el nodo y ya). Los **inputs
sí**, pero solo hacia las fórmulas que los leen directo, y la arista dice cuál viaja por ahí.

### Las tablas también son entrada

`merchantConfig` y `rentalPlans` son **datos que entran**, no cálculo, así que llevan la misma
cabecera ámbar que el nodo *Entrada* y se apoyan justo debajo: la zona de entrada se lee como
una familia aunque ocupe más de un nodo. (Antes tenían la cabecera azul de las etapas y se leían
como si calcularan algo.)

Quedan en nodo propio y no adentro de *Entrada* porque tienen contenido que vale ver —las tres
filas, con la **fila activa resaltada** según el input— y pocos consumidores.

Son **editables** por el mismo motivo que las constantes: si Dentix renegocia la fianza al 8%,
eso se prueba escribiendo. La clave y el `label` son de solo lectura; el resto se edita y
recalcula toda la cadena. La copia es profunda, así que `restablecer` de verdad restablece.

El efecto: `motai-rto` pasó de 18 nodos a **9**; `alta-fleet` de 16 a **8**.

Las decisiones son otra cosa. `creditScore >= 400` sí tiene dos caminos, el orden importa
(corta y reporta cuál falló) y el resultado no es un número sino **un veredicto más un porqué**.
Ahí el árbol es la forma correcta.

## Las piezas

```
src/engine.js      tokenizer → parser descendente → AST → intérprete.  SIN eval().
                   + pmt / ipmt / ppmt  + evalSheet()  + evalPolicy()
src/sheets.js      las 4 hojas reales + la política de Motai
src/store.js       estado reactivo compartido; los nodos lo importan directo
src/latex.js       AST → LaTeX (KaTeX se encarga de dibujarlo)
src/FormulaPanel.vue  el panel derecho
src/layout.js      disposición automática por profundidad (sin dagre: son DAGs chicos)
src/MoneyInput.vue campo de dinero con separador de miles
src/nodes/         InputsNode · GroupNode · CalcNode · TableNode · RuleNode · EndNode · RiskNode
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

## Las hojas de producto

| hoja | fuente | período base → cobro |
|---|---|---|
| `motai-renting` | `Calculadora Renting VF.xlsx`, pestaña Renting | mensual → semanal (**prorrateo lineal**) |
| `motai-rto` | `Calculadora Renting VF.xlsx`, pestaña Rent to Own | semanal → semanal |
| `creditopx-salud` | `Calculadora PV V20251009.xlsm` (los dos) | mensual → mensual |
| `alta-fleet` | `Creditop-ALTA FLEET-270726-203915.pdf`, punto 9 | mensual → **semanal** (sin puente definido) |

Cuatro hojas, **cuatro convenciones de período distintas**. Ese desorden estaba escondido en los
archivos; acá la barra superior lo dice en cada hoja y marca ⚠ cuando base ≠ cobro.

## Los períodos son selects, no constantes

Había una sopa de constantes —`weeksPerYear`, `monthsPerYear`, `daysPerMonth`,
`statedPerYear`, `periodsPerYear`— que eran **todas la misma pregunta contada distinto**.
Ahora cada hoja declara tres períodos por nombre y el resto se deriva:

```
periods: { rateStatedIn: 'mensual', chargedEvery: 'semanal', termIn: 'mensual' }
```

| declaración | qué contesta | de dónde sale el número |
|---|---|---|
| `rateStatedIn` | ¿en qué período el negocio **dice** la tasa? | `statedPerYear` |
| `chargedEvery` | ¿en qué período se **amortiza**? | `periodsPerYear` |
| `termIn` | ¿en qué unidad viene el **plazo**? | `termPerYear` |

El catálogo `PERIODS` es la única fuente: anual 1 · semestral 2 · trimestral 4 · bimestral 6
· mensual 12 · quincenal 24 · semanal 52 · diaria 360.

Efecto: `motai-rto` pasó de 7 constantes a 4, `alta-fleet` de 4 a 2 — y los tres son
**selects en el nodo Entrada**. Cambiá "se cobra" de semanal a trimestral y se mueve todo:

```
periodRate    0,412539%  →  5,497783%
termPeriods         104  →          8
cuota           127.815  →  1.703.347
plan de pagos  104 filas →    8 filas
veredicto      R4 (canon muy bajo) → R5 (supera el máximo)
E.A.              23,87% →     23,87%   ← no se mueve: es el mismo crédito
```

Y `realWorldCharge` queda aparte: es cómo cobra **el producto**, que el motor no controla.
Cuando difiere de `chargedEvery` la franja marca **⚠ falta puente** — el caso de `alta-fleet`,
que amortiza mensual y cobra semanal sin que nadie escribiera la conversión.

## La tasa, estandarizada

Las tres hojas que amortizan pasan por el **mismo par de líneas**:

```
annualEffectiveRate = (1 + statedRate) ^ statedPerYear - 1
periodRate          = (1 + annualEffectiveRate) ^ (1 / periodsPerYear) - 1
```

- `statedRate` + `statedPerYear` — la tasa **como la dice el negocio**. Motai la da mensual
  (`statedPerYear: 12`), salud la da E.A. (`statedPerYear: 1`).
- `periodsPerYear` — el ritmo en el que se **amortiza**: 52 semanal, 12 mensual, 4 trimestral.
- Todo lo demás (`pmt`, `ipmt`, `ppmt`, la serie) usa `periodRate` y nada más.

La E.A. queda de moneda común. **Estandarizar no movió ni un dígito**: `(1+m)^(12/52)` y
`((1+m)^12)^(1/52)` son la misma expresión, así que las 33 verificaciones dan idénticas.

Lo que sí apareció es la **E.A. de cada producto**, que ninguna hoja exponía y que es el único
eje en el que dos productos se comparan (además de ser lo que la ley obliga a publicar):

| hoja | E.A. | tasa del período |
|---|---|---|
| `motai-rto` | **23,87%** | 0,412539% × 52 |
| `alta-fleet` | **24,90%** | 1,87% × 12 |
| `creditopx-salud` | **28,17%** | 2,089764% × 12 |

### Y por qué `motai-renting` no tiene tasa

No es una omisión técnica, es **estructura legal**. El techo de **usura** aplica al crédito, no al
arrendamiento. Sin opción de compra el cliente nunca es dueño: paga por *usar* la moto y la
devuelve, así que **no hay capital que amortizar → no hay interés → no es crédito**. Con opción de
compra (RTO) sí hay saldo y sí hay interés — el PRD lo llama *"un crédito disfrazado de arriendo"*.

La propia calculadora trata el mismo 1,8% de dos maneras: en la pestaña Renting lo lista como
**"Parámetro"**, y en Rent to Own como **"Equivale a ~0,4125% semanal"**.

Por eso la constante se llama **`anchorRate`** y no `monthlyRate`: solo sirve para fijar un precio
(amortizar el precio de venta a 24 meses y prorratear `÷30 ×7`). **"Arreglar" ese prorrateo para
que capitalice no es un fix — es recaracterizar el producto** y meterlo en el perímetro del
crédito. Ahí está la respuesta al `+1,11%` que figuraba como pregunta abierta: no hay nada que
convertir.

Cada hoja declara además su `legalNature`, visible en la franja. Detalle en el nodo `motai` del
contexto.

`motai-renting` queda afuera de la tabla de E.A. **a propósito**: no amortiza, no hay saldo.
Su `PMT` a 24 meses es un ancla de precio. Ahora esa diferencia se ve sola — es la única hoja
sin tasa efectiva en la franja.

Y `alta-fleet` declara `periodsPerYear: 12` porque el PDF **amortiza mensual**. Que además se
cobre semanal sigue siendo el puente sin escribir: estandarizar la tasa no lo resuelve, lo
**aísla** — separa "cómo se expresa la tasa" (resuelto) de "cómo se cobra semanal lo que se
calculó mensual" (pendiente con Manuela).

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
