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
| **Cálculo** | El grafo de dependencias de la hoja. Un nodo por **nombre declarado** (input, constante, tabla, fórmula, output), izquierda → derecha en el orden en que el motor calcula. Abajo, la tabla de la serie. |
| **Política** | El árbol de decisión. El *gate* corre en cadena y **corta en la primera regla que falla**; después abanican las ramas del *outcome*. Solo se ilumina el camino que se tomó. |

La prueba que más rápido explica el diseño: **vaciá un input**. Solo se apagan sus descendientes
(`skipped` / `upstream`); el resto sigue dando su número. Eso es la evaluación parcial, y es lo
que hace usable un editor donde la hoja está a medio escribir.

## Por qué el cálculo NO es de nodos sí/no y la política SÍ

Un grafo sí/no modela **control de flujo**. En la aritmética no hay: todo se calcula siempre,
`financedAmount = taxableBase + vatAmount` no tiene rama "no". Y un nodo por *operación*
convertiría `(1 + monthlyRate) ^ (monthsPerYear / weeksPerYear) - 1` en seis cajitas con cables
— menos legible que la expresión escrita. Por eso: **un nodo por nombre, la expresión como texto
adentro**.

Las decisiones son otra cosa. `creditScore >= 400` sí tiene dos caminos, el orden importa
(corta y reporta cuál falló) y el resultado no es un número sino **un veredicto más un porqué**.
Ahí el árbol es la forma correcta.

## Las piezas

```
src/engine.js    tokenizer → parser descendente → AST → intérprete.  SIN eval().
                 + pmt / ipmt / ppmt  + evalSheet()  + evalPolicy()
src/sheets.js    las 4 hojas reales + la política de Motai
src/layout.js    disposición automática por profundidad (sin dagre: son DAGs de 18-26 nodos)
src/nodes/       CalcNode · TableNode · RuleNode · EndNode
verify.mjs       arnés de regresión contra los archivos fuente
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
