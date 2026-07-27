# engine — motor de cálculo y política

Prototipo visual del **`calculator-service`** que estamos diseñando: un microservicio que evalúa
documentos versionados (hojas de cálculo y políticas de riesgo) contra un juego de inputs, **sin
saber nada del dominio**. Recibe números, devuelve números; recibe hechos, devuelve un veredicto
con su motivo.

```bash
npm install
npm run dev     # http://localhost:5196
```

## Qué se ve

Dos pestañas, las dos vivas: tocás un input y todo se recalcula.

| pestaña | qué muestra |
|---|---|
| **Cálculo** | La **cadena de cálculo**: un nodo por fórmula, izquierda → derecha en el orden en que el motor las resuelve. Abajo, la tabla de la serie. |
| **Política** | El árbol de decisión. El *gate* corre en cadena y **corta en la primera regla que falla**; después abanican las ramas del *outcome*. Solo se ilumina el camino que se tomó. |

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
- la fórmula **renderizada como matemática** (MathML nativo), con interruptor
  **símbolos ⇄ con valores** — la segunda sustituye cada referencia por su número real:
  `pmt(0,004125; 104; 10.790.920)`;
- el **LaTeX** en texto, con botón de copiar;
- **depende de** y **lo usan**, ambos navegables: click y saltás a esa fórmula.

Todo sale del **mismo AST que evalúa el motor**, así que no puede desincronizarse del cálculo:
no hay una segunda transcripción de la fórmula que se pueda quedar vieja.

MathML y no KaTeX a propósito: lo pinta el navegador solo, sin CDN ni dependencia extra.

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

## Dos niveles de zoom: **por etapa** y **detalle**

El botón de la barra superior alterna cómo se agrupan las fórmulas. Es **solo disposición**:
el documento no cambia, sigue siendo una bolsa plana de fórmulas con nombre y el motor
ignora `groups` por completo.

| hoja | detalle | por etapa |
|---|---|---|
| `motai-rto` | 9 nodos / 12 aristas | **4 / 4** |
| `alta-fleet` | 8 / 11 | **4 / 4** |
| `motai-renting` | 12 / 16 | **5 / 5** |
| `creditopx-salud` | 17 / 30 | **7 / 11** |

Agrupado, cada columna es una etapa del negocio y el grafo se lee de un vistazo:

```
alta-fleet     Entrada → ┬ Crédito moto ──┬→ Total al cliente
                         └ Crédito póliza ┘

salud          Entrada  → ┬ Comercio ┬→ Fianza → Desembolso → Cuota
               tabla    → └ Tasas ───┘
```

En `alta-fleet` se ve de una la razón de que la cuota sea escalonada: **son dos créditos**
con plazos distintos que se suman.

**"Detalle"** abre cada fórmula en su propio nodo, con la expresión escrita adentro. Sirve
para depurar una cadena puntual; "por etapa" sirve para entenderla.

## Un solo nodo de Entrada

Inputs y constantes **no ocupan un nodo cada uno**: van todos juntos en el nodo *Entrada* de la
izquierda. Son hojas del grafo y dibujarlos sueltos era ruido — llenaban la primera columna y
cruzaban aristas por todos lados sin decir nada. Lo que se quiere leer es la cadena.

Las **constantes no tiran ninguna arista** (son ambiente: se ven en el nodo y ya). Los **inputs
sí**, pero solo hacia las fórmulas que los leen directo, y la arista dice cuál viaja por ahí.
Las **tablas quedan como nodo aparte** porque tienen contenido que vale ver y pocos consumidores.

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
src/layout.js      disposición automática por profundidad (sin dagre: son DAGs chicos)
src/MoneyInput.vue campo de dinero con separador de miles
src/nodes/         InputsNode · GroupNode · CalcNode · TableNode · RuleNode · EndNode · RiskNode
verify.mjs         arnés de regresión contra los archivos fuente
```

`engine.js` es el mismo diseño que iría en el paquete `formula` de Go. El intérprete no usa
`eval()`: solo números, referencias, aritmética y funciones de una lista blanca.

## Las hojas

| hoja | fuente | período base → cobro |
|---|---|---|
| `motai-renting` | `Calculadora Renting VF.xlsx`, pestaña Renting | mensual → semanal (**prorrateo lineal**) |
| `motai-rto` | `Calculadora Renting VF.xlsx`, pestaña Rent to Own | semanal → semanal |
| `creditopx-salud` | `Calculadora PV V20251009.xlsm` (los dos) | mensual → mensual |
| `alta-fleet` | `Creditop-ALTA FLEET-270726-203915.pdf`, punto 9 | mensual → **semanal** (sin puente definido) |

Cuatro hojas, **cuatro convenciones de período distintas**. Ese desorden estaba escondido en los
archivos; acá la barra superior lo dice en cada hoja y marca ⚠ cuando base ≠ cobro.

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
