# engine — motor de cálculo

## El ejemplo cableado

La app arranca con un caso real, no con ceros: un crédito de salud CreditopX con una cuota inicial
de −4.000.000 encima.

```
el crédito     monto 10.000.000 · cuotas 36 · cuota inicial 4.000.000
               ─────────────────────────────────────────────
               monto neto                     6.000.000      ← la variable limpia
tasa           28,17% E.A.  →  se cobra mensual 2,089764% M.V.
monto final    fianza             10% del neto →   600.000
               IVA de la fianza  19% de fianza →   114.000
               4 × 1000     (fianza+IVA)×0,004 →     2.856   ← fórmula
               ─────────────────────────────────────────────
               valor a financiar              6.716.856
a la cuota     seguro de vida         0,1307% →     8.779
cuota          cuota del crédito                 267.335
               cuota total                       276.114
```

**La fianza va sobre el monto NETO** — la cuota inicial se resta antes. No es una decisión nuestra:
lo hacen los dos artefactos. El código real
(`PaymentCalculationService::performCalculation` + `calculateInitialAmount`) calcula

```php
$amount    = original_amount − initial_fee;      // una vez, arriba
$guarantee = ($amount + $administrativeCosts) * (fga% / 100) * (1 + 19/100);
```

y el `.xlsm` llega al mismo lugar por otro camino (`marginBase = assetCost − downPayment +
setupFee` → `principal` → `guaranteeBase = principal + deviceCost`). Es un % de lo que se va a
financiar **antes de sumarse ella misma**: ni del monto pedido, ni del valor final —eso sería
circular.

La estructura de fianza + IVA + GMF está **verificada contra `Calculadora PV V20251009.xlsm`**
(es el preset `salud-gaes`). Cada número de arriba se comprobó contra aritmética calculada aparte,
no contra el motor: `valor a financiar`, `periodRate`, la cuota, el seguro, el interés del mes 1
(150.353) y el cierre del plan en −0 a la fila 36.

**Ejercita los tres tipos de campo a propósito**, que es de lo que se trata la prueba:

| campo | tipo | por qué está |
|---|---|---|
| cuota inicial | **monto** | negativo: prueba que restar no necesita un caso especial |
| fianza | **%** | sobre **el monto neto** — la cuota inicial ya se restó |
| IVA de la fianza | **%** | sobre **otro campo** — un IVA va sobre la fianza, no sobre el monto |
| 4 × 1000 | **fórmula** | va sobre la **suma** de dos campos, así que el selector de base no alcanza |
| seguro de vida | **%** | sobre el valor a financiar, y por cuota |

Y el documento guardado es la hoja resuelta, sin nada cableado en el motor:

```
netAmount           = amount - downPayment          ← la única derivada que no es un campo
fianzaValue         = netAmount * fianza
ivaDeLaFianzaValue  = fianzaValue * ivaDeLaFianza
_41000Value         = (fianzaValue + ivaDeLaFianzaValue) * 0.004
seguroDeVidaValue   = financedAmount * seguroDeVida

financedAmount      = netAmount + fianzaValue + ivaDeLaFianzaValue + _41000Value
installmentCharges  = seguroDeVidaValue
```

(`_41000`: el tokenizer solo acepta identificadores que empiecen con letra o `_`, así que un nombre
que arranca en dígito lleva el guión bajo adelante.)

Los cinco campos **se borran con una ×**. El ejemplo es configuración, no motor.

**Cada nodo se llama como la cosa real que es.** El color es el grupo: lo que **alimenta** el
cálculo, y lo que el cliente **paga**.

```
 ┌ línea de crédito ─────┐  ámbar · lo que ALIMENTA
 │ ● efectiva ○ nominal  │
 │ DICHA  [anual]  28,17%│──┐        credit_line_by_lenders: la tasa, su
 │ SE COBRA [mens] 2,08…%│  │        convención Y los plazos, todo en una fila
 │ plazos 6,12,18,24,36,48  │
 └───────────────────────┘  │
 ┌ la solicitud ─────────┐  │   ┌ cuota ──────────────────┐  verde · lo que se PAGA
 │ monto      10.000.000 │  │   │ seguro de vida   0,1307%│
 │ cuota inicial resta   │  ├──▸│ + campo                 │   ┌ Plan de ┐
 │ cuotas    [36 cuotas ▾]  │   ├─────────────────────────┤──▸│  pagos  │
 │ monto neto  6.000.000 │  │   │ cuota del crédito 267.335   └─────────┘
 └───────────┬───────────┘  │   │ cuota total       276.114│
    monto neto 6.000.000    │   │ CUOTA POR PLAZO          │
 ┌───────────▾───────────┐  │   │  6 cuotas     1.211.546  │
 │ tarifas               │  │   │ 36 cuotas       276.114 ◂│
 │ fianza           10%  │  │   │ 48 cuotas       231.780  │
 │ IVA de la f… fianza19%│  │   └─────────────────────────┘
 │ 4 × 1000     fórmula  │  │
 └───────────┬───────────┘  │
 ┌───────────▾───────────┐  │
 │ valor a financiar     │──┘
 │ fianza        600.000 │
 │   monto neto × fianza │
 │ IVA de la f…  114.000 │
 │   fianza × IVA de la… │
 │ 4 × 1000        2.856 │
 │            6.716.856  │
 └───────────────────────┘
```

**`la solicitud`** es `user_requests` y solo eso: lo que decide el cliente. **`línea de crédito`** es
una fila de `credit_line_by_lenders` — ahí viven la tasa, el `rate_suffix` (la convención) **y**
`fee_numbers` (los plazos), así que el editor de plazos vive ahí y no en la solicitud. El nombre de
tabla también mata el choque viejo `tasa` / `tarifas`: dos títulos que empezaban igual, en columnas
vecinas y del mismo color.

**`tarifas` → `valor a financiar`** es la partición perillas/pesos: arriba lo que cambia por lender,
abajo lo que es igual para todos. Y **cada fila de abajo muestra su expresión traducida** —
`monto neto × fianza`, no `netAmount * fianza`. La regla de la hoja es que la UI nunca muestra un
`name`, y las filas de expresión la estaban rompiendo; el crudo queda en el tooltip, que es donde
sirve para copiarlo a otra fórmula.

**Compartir columna no significa estar conectado.** Entre `línea de crédito` y `la solicitud` **no
hay flecha**: `netAmount = amount − downPayment` no toca la tasa, y `periodRate` no toca el monto.
Son paralelos de verdad. La que sí existe se dibuja **hacia abajo**, con handles `Top`/`Bottom` que
solo aparecen en las etapas que los usan.

**Asimetría decidida:** el lado del monto está partido en dos nodos, el de la cuota va junto. Con un
recargo típico la partición sería aire; se parte el día que un lender normal tenga dos o tres.

⚠ **El color no dice de dónde viene el dato.** `la solicitud` la llena el cliente; `línea de crédito`
y `tarifas` los configura la entidad, y los tres son ámbar. Esa distinción la llevan los títulos —
que ahora son nombres de tabla, así que se lee de una.

### Detalles que se ganaron probando

- **Un subtotal de un solo término no se dibuja**: `cargos por cuota 8.779` al lado de
  `seguro de vida 8.779` no decía nada. Sigue siendo fórmula (la necesita el total).
- **La fila de salida no repite el título del nodo** — en `valor a financiar` queda solo el número.
- **`cuota inicial` dice `resta`.** Se escribe en positivo y `monto neto` la resta; desde que se
  fueron los prefijos de signo, nada en la fila lo decía.
- **`valor a financiar` y `cuota` se muestran como una FÓRMULA**, con el mismo dibujo del tablero
  pero sin editar: cada caja con su valor debajo, y el total al pie.

  ```
  ┌ monto neto ┐ + ┌ fianza  ┐ + ┌ IVA de la fianza ┐ + ┌ 4 × 1000 ┐
  │ 6.000.000  │   │ 600.000 │   │     114.000      │   │  2.856   │
  └────────────┘   └─────────┘   └──────────────────┘   └──────────┘
                                                      = 6.716.856
  ```

  Usa **el mismo componente** que el editor, así que las dos vistas no pueden divergir: si el tablero
  dibuja una fracción apilada, acá también. El `name` crudo de cada caja queda en su tooltip.

  Y eso arregló algo que la lista escondía: mostraba un total que **no coincidía con sus filas**
  (600.000 + 114.000 + 2.856 no da 6.716.856) porque la base venía de otra etapa y era invisible.
  `alsoShow: ['netAmount']` la trae — se lee, no se posee: no cambia el grafo.

  Un nodo que muestra una composición **nunca esconde un término**, ni siquiera un subtotal
  redundante: sin fila no tiene etiqueta ni valor, y la fórmula lo dibujaba con su `name` crudo
  (`installmentCharges` en vez de `cargos por cuota`).

- **Un TABLERO, no un input.** La fórmula no se escribe: se **arma por cajas**. Se elige un
  cuadrito y se le pone un campo, un número o una operación.

  ```
  armá la fórmula                              1 sin llenar   listo
  ┌───────────────────────────────────────────────────────┐
  │  ┌ fianza  +  IVA de la fianza ┐   ×   0.004           │
  └───────────────────────────────────────────────────────┘
  CAMPOS        el monto neto · el monto · cuotas · fianza · IVA de la fianza
  OPERACIONES   ▢+▢   ▢−▢   ▢×▢   ▢÷▢
                ▢^▢   123   ▢
  ```

  **La anidación se ve por los marcos, no por paréntesis** — el marco interno de
  `fianza + IVA de la fianza` es el paréntesis. Y las cajas muestran el **español**: la fórmula
  guarda el identificador, la misma regla del resto.

  **La división es una fracción de verdad**, numerador arriba y denominador abajo con la línea en
  medio. Es donde más se gana: `fianza ÷ cuotas` apilado se lee como lo que es —un reparto— y no como
  una operación cualquiera.

  **Y hay raíz**, con su índice editable:

  ```
    2 ╭─────────╮
     √│ fianza  │
      │─────────│
      │ cuotas  │
      ╰─────────╯
  ```

  No es un nodo aparte: una raíz **es** `x ^ (1/n)`, que es lo que el motor evalúa. Se detecta al
  dibujar, así que el texto guardado sigue siendo nativo del motor y va y vuelve idéntico. Con el
  índice editable, **una tecla da todas las raíces** — y tiene un uso real: `(1 + tasa) ^ (1/12) − 1`
  es la raíz doceava, o sea la conversión de una tasa anual a mensual.

  Tanto las operaciones como la raíz **envuelven** lo elegido en vez de reemplazarlo. Al principio la
  raíz reemplazaba, y elegir una fracción y apretar raíz te la borraba.

  Aplicar una operación **envuelve** lo que está elegido: seleccionás algo, apretás `×`, y pasa a ser
  `eso × ▢` con el hueco nuevo ya elegido. Es lo que hace un editor matemático.

  El árbol va y vuelve con `formulaTree.js`, que usa **el parser del motor** — así el tablero y el
  cálculo no pueden interpretar distinto la misma fórmula. Verificado: las 7 fórmulas reales
  round-trip **idénticas**, con los paréntesis mínimos, y las raíces se detectan sin confundir una
  potencia normal (`amount ^ 2` no es una raíz).

  **Por qué no una librería.** MathLive (la sucesora de MathQuill) edita **LaTeX**, no nuestro árbol:
  habría que serializar a LaTeX, parsear el LaTeX del usuario, y después *restringir* todo lo que
  ofrece —integrales, matrices, `\sin`, subíndices— a lo que el motor acepta (`+ − × ÷ ^` y cuatro
  funciones). Sería trabajo para **quitar** capacidades. Y nuestros nombres son etiquetas de varias
  palabras (`IVA de la fianza`), que en LaTeX quedan como `\operatorname{...}`. La fracción son diez
  líneas de CSS y la raíz cinco; el árbol y el round-trip ya estaban.

  Y si la expresión tiene algo que el tablero no dibuja —`pmt`, `if`, una comparación— ese campo se
  sigue editando **como texto**. Mejor eso que dibujar mal algo que el motor entiende bien.

  **Las teclas son las que los datos justifican.** Las 14 fórmulas reales —los 6 presets más las 3
  calculadoras de `lenders.calculator`— usan solo `+ − × ÷` y paréntesis: ni una potencia, ni una
  raíz, ni una fracción. Por eso no hay `√`, `|▢|`, `π` ni `e`: sería notación sin datos detrás, y
  además `abs` y las constantes no están en la lista blanca del motor. El `▢ ^ ▢` sí está porque el
  motor lo soporta y es lo que haría falta para capitalizar una tasa dentro de un campo.

  Mientras quede un `▢`, el motor dice "carácter inesperado" y **solo ese campo y lo que depende de
  él** se apagan — el resto del nodo sigue calculando. Es la evaluación parcial de siempre, y es lo
  que hace que se pueda armar una fórmula en vivo sin que la pantalla se vacíe.

  Va como **overlay y no dentro del nodo**: si el nodo creciera al abrirlo se solaparía con el de
  abajo, porque Vue Flow posiciona por alto medido y el layout no sabe que hay un tablero abierto.
  Y mientras está abierto el nodo deja de recortar y sube de z-index — con `!important`, porque Vue
  Flow escribe el suyo inline.
- **No hay flechas para reordenar, y es a propósito.** Un campo solo puede apoyarse en los
  **anteriores** —lo imponen el selector de base y los chips de nombres— así que el orden es correcto
  **por construcción**. Reordenar solo podía romperlo, y obligaba a validar y revertir cada
  movimiento: la solución creaba el problema.

  Lo único que sí podía romper el grafo de referencias era **borrar algo del medio**. Así que un
  campo del que otros cuelgan **no se puede quitar**, y el tooltip dice quién depende:

  ```
  fianza            × bloqueado — IVA de la fianza · 4 × 1000 dependen de este campo
  IVA de la fianza  × bloqueado — 4 × 1000 depende de este campo
  4 × 1000          × libre
  ```

  Las dos formas de depender cuentan: tener el campo como **base** de un porcentaje, o **nombrarlo**
  en una expresión. Lo segundo sale de `refsOf` sobre el AST y no de un regex, así que una referencia
  dentro de un paréntesis cuenta igual y una que solo se *parece* al nombre no cuenta.

  Se borra en cascada desde la punta: quitar el 4×1000 libera al IVA, y quitar el IVA libera a la
  fianza. Antes `removeField` borraba y limpiaba en silencio la base de quien apuntara — y si alguien
  lo nombraba en una expresión, quedaba roto sin aviso.
- **El `documento` es un panel lateral**, así que la hoja se lee mientras se edita. Reencuadra
  mirando el ancho real del lienzo, no el toggle: Vue Flow actualiza sus dimensiones por un
  `ResizeObserver` que llega después de cualquier cantidad de frames.

### Los plazos son una LISTA, no un input

`cuotas` sigue siendo **un** valor —la calculadora necesita uno para dar una cuota— pero es un
**select** sobre la lista de plazos que el lender **ofrece**, no un número libre: escribirlo a mano
dejaba calcular un plazo que no está en venta. No es un invento: en producción también es una lista,
`credit_line_by_lenders.fee_numbers`, una cadena separada por comas (`'6,12,24,36,48,60,72'` ·
`'12,18,24'` · `'1,2,3,4,5'`). Se edita igual, y el store la ordena, deduplica y descarta lo que no
sea un plazo válido.

Y eso es lo que hace que la lista **signifique** algo en vez de ser un selector: **la calculadora
corre una vez por plazo**, y esa vitrina es exactamente la pantalla que el cliente ve.

```
CADA PLAZO
  6 cuotas   ...
 12 cuotas   ...
 36 cuotas   ...   ← el elegido, resaltado
 48 cuotas   ...
```

Son N evaluaciones de la **misma** hoja cambiando un solo input. Clickear una fila elige ese plazo:
cambia la cuota, el plan de pagos y la fila resaltada — y **el resto de la vitrina no se mueve**,
porque ningún plazo depende de otro.

Es también la forma en que la política va a juzgar: no calcula el plazo, **descarta** los que no
pasan (ver [docs/POLITICA-Y-CALCULO.md](docs/POLITICA-Y-CALCULO.md)). Lo que recorta la lista —los
topes `min/max_fee_number`, el cupo por categoría de usuario, y las bandas de monto que pueden
**fijar** un plazo único— es política, y sigue aparcada.

Y si al editar la lista sacás el plazo elegido, **salta al más cercano** (en empate, al más corto).
Sin eso el select quedaba vacío y la cuota se calculaba con un plazo que ya no se ofrece — el estado
imposible que el select existe para evitar.

### Tres orígenes, no "constantes y variables"

"Constante" depende de qué estés recorriendo: el IVA es constante *nacionalmente* pero **tiene
fecha** (16% → 19% en 2017), y la fianza es constante *por comercio* y variable entre los 338 que la
usan. El **origen** no cambia, y ya es cómo están guardados los datos:

| origen | qué | dónde vive | en la hoja |
|---|---|---|---|
| **cliente** | monto · cuotas · cuota inicial | `user_requests` | **inputs fijos** |
| **config** | tasa · fianza% · seguro% · admin% | `credit_line_by_lenders` · `lenders_by_allieds` | **campos** |
| **ley** | IVA 19% · GMF 0,4% · usura | cableado | constantes (deberían tener fecha) |

Las del cliente son **estructurales**: todo crédito tiene monto, plazo y a veces cuota inicial. Las
de config son **campos**, porque cambian por lender.

Dos cosas verificadas contra la BD local que ordenan esto:

- **La tasa no depende del plazo.** 157 líneas de crédito para 157 lenders — una por lender — y
  ninguna con tasas distintas por plazo. El plazo solo tiene que caer entre `min_fee_number` y
  `max_fee_number`.
- **La solicitud guarda una COPIA de la tasa.** En 2026, 1.878 de 1.969 solicitudes coinciden con la
  de su línea; en 2024, 4.413 de 149.586. La divergencia es histórica: la config se movió y las
  solicitudes viejas conservaron su tasa. O sea que el service debe **recibir** la tasa, no
  resolverla.

### Primero las variables limpias, después los cálculos

`netAmount = amount − downPayment` es la **primera derivada** y sale solo de datos del cliente: es
lo que el cliente de verdad financia. Es `calculateInitialAmount` del backend, tal cual.

**Hacen falta los dos, el neto y el bruto.** Producción calcula los costos administrativos y el
seguro de vida sobre `original_amount`:

```php
$administrativeCosts  = $inputs['original_amount'] * (admin% / 100) + adminFixed;
$lifeInsuranceMonthly = $inputs['original_amount'] * (seguro% / 100) + …
```

Por eso un porcentaje **elige su base** (`el monto neto` · `el monto` · `el valor a financiar`, u
otro campo), y por eso el neto no reemplaza al bruto.

Y por eso la **cuota inicial no vive en un destino**: no es un costo, es lo que define el monto
real. Ponerla como un término negativo obligaba a inventar una base "subtotal"; con el neto como
variable, la fianza es `% × netAmount` y el truco desaparece.

### Los dos puntos de inserción

Dentro del azul hay exactamente **dos** lugares donde puede entrar un costo:

| | qué entra ahí | termina en | paga intereses |
|---|---|---|---|
| **monto final** | todo lo que mueve el monto que se financia | `financedAmount` | **sí** |
| **a la cuota** | lo que viaja arriba de cada pago | `installmentCharges` | no |

Agregar un costo nuevo de un lender es **elegir uno de los dos**. No hay una tercera respuesta.

`monto final` y no *"al monto"*: ahí vive también la **cuota inicial**, que resta, y "al monto" daba
a entender que todo lo de ese nodo suma. Que uno pague intereses y el otro no vive en el tooltip
del título, no en pantalla — estuvo como insignia visible mientras los dos nodos caían en columnas
distintas y era lo único que los hacía leer como par, pero comparten columna y color.

### Todo se suma. Un negativo resta.

Es la regla única de los dos puntos, y es lo que hace que la cuota inicial sea un campo como
cualquier otro en vez de un caso especial en la fórmula:

```
cuota inicial  −4.000.000  →  financedAmount: amount + cuotaInicial + fianzaValue + ivaDeLaFianzaValue
                              valor a financiar 6.000.000 · cuota 317.227
```

Antes era un input cableado con `sign: -1` y la fórmula decía `amount - downPayment + …`. Ahora es
una suma pura: **el motor no tiene una idea de "lo que resta"**, igual que ya había dejado de tener
una idea de qué es una fianza.

Los labels tampoco llevan prefijo de signo (`−cuota inicial`, `+seguro de vida`): el valor ya trae
el suyo, y con el título del nodo diciendo a dónde va, el prefijo era una tercera copia.

### Y se agregan desde el nodo: `+ campo`

Los dos puntos de inserción tienen un botón `+ campo`. Un campo son **tres cosas**, y las tres se
leen como una frase antes de crearlo:

| tipo | qué hace |
|---|---|
| **monto** | un monto fijo, se suma tal cual |
| **%** | un porcentaje **sobre** algo: la base del punto, u **otro campo del mismo nodo** |
| **fórmula** | una expresión que se escribe entera |

Y en `a la cuota`, además: **cada cuota** o **total ÷ cuotas**.

```
fianza             %        sobre el monto              → porcentaje sobre el monto
IVA de la fianza   %        sobre fianza                → porcentaje sobre fianza
cuota de manejo    fórmula  amount * 0.01 / installments
```

El `%` sobre otro campo no es un adorno: es lo que hace expresable un IVA, que se calcula sobre la
**fianza** y no sobre el monto. Y la base se resuelve **a pesos** — apuntarla al nombre del campo
daría su perilla (0,05) en vez de sus pesos (500.000).

### La fórmula: el campo es una celda

Con tipo **fórmula** el campo no tiene perilla: su valor **es** la expresión, que se ve y se edita
en el nodo, con el resultado debajo. Es la celda de una hoja de cálculo — el modelo del que salen
los `.xlsm` originales.

No hace falta validarla antes: el motor devuelve el error con su razón, y la evaluación parcial
apaga **solo lo que depende** de ella. Escribiendo `amount *` a medias:

```
cuota de manejo    —      expresión incompleta
cargos por cuota   error
cuota del crédito  528.711     ← sigue calculando: no depende del campo roto
cuota total        sin calcular
```

Los ciclos los caza el motor, así que una fórmula puede referenciar lo que quiera. Como el ciclo se
reporta en la fórmula que lo **cierra** y no en la que lo escribió, la celda persigue la cadena de
`dependsOn` hasta la causa real: `ciclo: installmentCharges`.

### Un ancho para todos los controles

`--field-w` en `styles.css`. Antes el monto medía 108px y el porcentaje 74, así que no formaban
columna. Y un valor en **cero** apagaba la fila y le sacaba el borde al input — la caja
desaparecía y el campo parecía deshabilitado. Un cero es un dato como cualquier otro.

El nombre del campo trunca; su nota (`de fianza`, `÷ cuotas`) **no**, porque el label es texto del
usuario y la nota es lo que hace legible el campo.

### La fianza es la prueba: el destino es DÓNDE VIVE

No hay un interruptor que diga a dónde va la fianza. **El bloque entero se muda al nodo que la
recibe** — sus tres perillas y sus cuatro fórmulas — y el botón `mover a la cuota ›` es lo único
que queda, porque el estado ya lo dice el nodo en el que está.

Antes había dos datos que podían contradecirse: un `appliesTo` que decidía dónde se *dibujaba* y
un `guaranteeUpfront` que decidía a dónde iba la *plata*. Y se contradecían **siempre**: el bloque
se dibujaba en `al monto` incluso con la fianza yéndose a la cuota. El nodo decía una cosa y el
cálculo hacía otra. Ahora es un dato: `where: { guarantee: 'amount' }`.

Se mueve **completo**, inputs y fórmulas, y no por prolijidad: mover solo los inputs armaba un
**ciclo** — `al monto` leería `guaranteeRate` de `a la cuota`, y `a la cuota` ya lee
`financedAmount` de `al monto`.

Y como cada punto de inserción es una suma de términos, la fórmula se rearma sola:

```
fianza al monto     financedAmount:     'amount - downPayment + totalGuarantee'
                    installmentCharges: 'lifeInsurance'
fianza a la cuota   financedAmount:     'amount - downPayment'
                    installmentCharges: 'totalGuarantee / installments + lifeInsurance'
```

El término de la fianza aparece **en un lado o en el otro**, no en los dos multiplicado por cero.
Antes era `'... + totalGuarantee * guaranteeUpfront'`, y multiplicar por cero disimulaba que con la
fianza en la cuota el valor financiado no tiene **nada** que ver con la fianza — además de dejar
una dependencia falsa en la arista (el `valor a financiar +2` que ya no está).

El `/ installments` sale de `spread: true` en el término: la fianza es un **total**, así que si
cae en la cuota hay que repartirla. El seguro de vida no lo lleva porque ya viene por cuota.

Con fianza del 5% sobre 10.000.000 a 24 cuotas:

| la fianza va | valor a financiar | cargos por cuota | cuota del crédito | **cuota total** |
|---|---|---|---|---|
| **al monto** | 10.500.000 | 0 | 555.147 | **555.147** |
| **a la cuota** | 10.000.000 | 20.833 | 528.711 | **549.544** |

Los **5.603** de diferencia son el interés que se paga por financiarla: `pmt(2%, 24, 500.000)`
= 26.436 contra `500.000 / 24` = 20.833.

Y con la fianza en la cuota, **`al monto` queda sin un solo input**. Eso es exactamente lo que
tiene que verse: no se le está sumando nada al monto.

### La flecha que baja

`a la cuota` **depende** de `al monto` — el seguro de vida se cobra sobre lo financiado, así que
financiar la fianza también sube el seguro:

| la fianza va | valor a financiar | seguro de vida |
|---|---|---|
| **al monto** | 10.500.000 | **14.700** |
| **a la cuota** | 10.000.000 | **14.000** |

700 por cuota, 16.800 en el crédito. Comparten columna igual porque son la misma clase de cosa, y
esa dependencia se dibuja como una flecha **vertical**, de abajo de una a arriba de la otra. Así
el orden se ve sin que el cable tenga que ir hacia atrás — y sin esconder que existe.

### Ninguna columna está escrita a mano

La disposición sale de las dependencias **reales** del AST (`layout.js`). Lo único que declara la
hoja es semántica, no coordenadas: `group: 'config'` dice *"estas tres son la misma clase"*, y el
layout condensa el grupo en un solo nodo para calcular profundidad — por eso la dependencia
interna no empuja de columna. Cada etapa se alinea centrada contra sus dependencias, y cuando
varias empatan se centra contra el conjunto.

Los altos están **medidos en el DOM**, no estimados: el bloque de tasa (113px) y la tabla
(`min(430, 53 + n × 20)`, comprobado con n = 1 · 2 · 6 · 12 · 24). Sin eso los nodos de una misma
columna se solapan y los clicks caen en el nodo equivocado.

Cada nodo muestra **siempre su resultado**; `showRows: false` esconde los pasos intermedios, nunca
la salida. Un nodo que no dice qué produce obliga a leer la etiqueta del cable.

```bash
npm install
npm run dev     # http://localhost:5196
node verify.mjs # 30 puntos de control contra los archivos fuente
```

## La conversión de tasa, como la conversión que es

```
 ● efectiva  ○ nominal
 DICHA     [anual ▾]      28,17 %   E.A.
 SE COBRA  [mensual ▾]   2,089764 %  M.V.
```

Se lee de arriba hacia abajo: **con qué convención**, de dónde sale el número, y en qué termina.
La convención va **primero y con las dos opciones a la vista**, porque es la elección que decide si
se capitaliza o se divide — y por lo tanto cuánto vale la cuota:

```
efectiva   periodRate = (1 + statedRate) ^ (statedPerYear / periodsPerYear) − 1
nominal    periodRate = statedRate * statedPerYear / periodsPerYear
```

Mismos dos parámetros; solo cambia `×` por `^`. Es un `if()` de **selección de parámetro**, no
lógica de negocio.

El nodo no repite el resultado abajo: el valor ya está al lado de su input y la E.A. en la barra de
arriba (`rows: 'none'` en la hoja — la etapa sigue siendo **dueña** de sus dos fórmulas, que es lo
que la pone en el grafo, pero no las dibuja).

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
