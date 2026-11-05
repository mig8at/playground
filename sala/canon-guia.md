# Guía: poner canon al día con main, en paralelo

Canon cuenta lo que hoy está en `main` de CreditOp. Cada tema declara en su mapa los archivos que lo
respaldan, con el hash contra el que se verificó. La **ronda** compara esos hashes con `main` y marca
los archivos que cambiaron o desaparecieron. Poner un tema al día es contestar, archivo por archivo:
¿la prosa sigue siendo cierta? Lo que se escribe pasa por la guía de estilo de canon (`skills/dictar.md`
del repo de canon). Esta guía agrega el método y el reparto.

## Qué entra a canon, y qué no

Entra lo que **no se deduce leyendo un archivo**, o lo que sólo se entiende uniendo varios:

- por qué existe una regla, o qué la vuelve distinta de lo que se espera;
- dónde se decide algo y qué condición cambia el resultado;
- lo que pasa entre dos sistemas: los dos monolitos, el front y el backend, un servicio y su llamador;
- las diferencias entre caminos que parecen iguales: por ejemplo, el monolito viejo hace una cosa y el nuevo otra;
- la trampa que hace perder una tarde.

No entra:

- lo que se lee en un archivo en un minuto;
- lo que todavía no está en `main`: un PR abierto o una rama;
- mediciones del ambiente, cifras de producción o fechas de cuándo se descubrió algo;
- la crónica de cómo se comprobó.

Un cambio de código que no altera ninguna regla de la prosa no pide prosa nueva: pide un `verificado`.

## Qué hacer con cada archivo de la ronda

| lo que encontrás | la pieza |
|---|---|
| cambió, y la prosa que depende de él **sigue siendo cierta** | `verificado` con ese archivo: sube el hash |
| cambió, y una frase de la prosa **dejó de ser cierta** | la **sección entera reescrita** (mismo `node` y `section`, `kind: correction`), y **después** un `verificado` con los mismos archivos |
| cambió, y agregó una regla que **no está en ninguna sección** y entra según lo de arriba | una sección nueva (`kind: addition`) con sus `archivos` |
| **desapareció** de `main` | `verificado` con esa ruta: canon la retira del mapa. Si la prosa hablaba de él, primero la sección corregida |
| se **renombró o movió** | `verificado` con la ruta vieja (la retira) y `operacion: "declarar"` con la nueva |
| un archivo **nuevo** que la prosa necesita y el mapa no declara | `operacion: "declarar"` con un `objetivo` que diga qué respalda |

Tres reglas que la ronda no perdona:

- **Una sección reescrita no mueve hashes**: queda enlazada al área que ya declara esos archivos. Lo que saca un archivo de la ronda es el `verificado`.
- **Un `verificado` es una afirmación**: «releí lo que la prosa dice de esto, y es cierto». Antes, leé las secciones que dependen del archivo, no sólo el diff. Si una frase quedó falsa, no va `verificado`: va la corrección.
- **`declarar` nunca sube hashes**, y `verificado` sólo sube los de archivos que el mapa ya declara.

## Cómo se comprueba antes de escribir

1. **El cambio:** `git -C <repo> log/diff/show origin/main -- <ruta>`, desde el hash declarado hasta hoy.
2. **Los dos monolitos:** si la regla existe en `legacy-backend` y en `legacy-application`, mirá los dos. Escribí «los dos» sólo si lo viste en los dos. El error más común es una regla de un solo monolito escrita como si valiera para los dos.
3. **Los absolutos:** «nunca», «sólo», «siempre», «ningún otro» y una lista cerrada (los siete campos, los cuatro estados) piden buscar la excepción. Casi siempre hay un camino más: otro endpoint, otra entidad, un país, el canal de tienda.
4. **Las tablas:** cada una de `tablas` tiene que existir en producción: `bin/pg sql --target prod --query "SELECT table_name FROM information_schema.tables WHERE table_name LIKE '<prefijo>%'"`. No inventes el plural ni el sufijo.
5. **El largo:** hasta 550 palabras por sección. Canon corta en 600 y cuenta distinto.
6. **Lo que no pudiste comprobar** no se escribe como cierto. Va como `PREGUNTA:` al final.
7. **Lo que el lint de canon rechaza:** nombres de función con paréntesis en la prosa (`lenderId()`; se nombra la regla, no la función), mediciones, fechas de descubrimiento y secciones de más de 600 palabras. Una tabla que todavía no está en el índice de canon (por ejemplo, la del congelamiento de cuotas, `creditop_x_lender_freeze_periods`) no va en `tablas`, aunque exista en producción.
8. **`declarar` es sólo para archivos que el mapa NO declara.** Si ya están declarados y la prosa sigue siendo cierta, la pieza es un `verificado`.

## El reparto en paralelo

- **Un agente por tema.** Recibe la prosa vigente, sus archivos de la ronda y las notas de los archivos compartidos. No toca otros temas.
- **Un agente por archivo compartido.** Si un archivo está en varios temas, lo lee una sola vez un agente propio y deja una **nota del cambio**: qué cambió en `main` desde el hash más viejo declarado, qué reglas toca y qué no cambió. No escribe piezas. Cada agente de tema parte de esa nota, y no de releer el diff, para que diez temas no cuenten el mismo cambio de diez maneras. La nota no lo exime de leer su propia prosa.
- **Un verificador por tema**, que no escribió nada. Las piezas de un tema se publican **juntas y en orden**: un `verificado` que va después de una corrección del mismo lote se juzga contra la prosa YA corregida por esa pieza, no contra la vigente. Comprueba cada pieza contra `main` con el método de arriba, afirmación por afirmación. Una pieza con una parte falsa es ✗.
- **Un integrador al final**, que mira juntas las piezas de **distintos temas** que tocan los mismos archivos. Busca reglas contadas distinto, la misma regla escrita dos veces (una debería enlazar a la otra), enlaces a secciones que una pieza renombró y un `verificado` de un tema que contradice la corrección de otro.
- **Nada se publica solo.** El resultado es un lote de piezas ensayadas en canon (borrador abandonado). La publicación la decide una persona, con `make canon-write`.
