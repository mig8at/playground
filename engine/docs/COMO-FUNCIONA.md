# Cómo funciona una cuota, explicado desde cero

> Sin saber nada de finanzas. Sin fórmulas hasta el final.

## Prestar plata es alquilarla

No comprás la plata: **te la prestan un rato y la devolvés**. Como cualquier alquiler, tiene un
precio por el tiempo que la tengas. Ese precio es el **interés**.

Un carro alquilado se devuelve entero al final. La plata no: **la devolvés de a pedazos**. Ahí
está casi toda la dificultad, porque significa que cada mes alquilás *menos plata que el mes
anterior*.

## El precio siempre viene con un "por"

Si te dicen *"el alquiler del carro son cien mil"*, la primera pregunta es **¿por día o por
semana?** Nadie cotiza un alquiler sin el período.

Con la plata es igual, pero la gente se olvida de decirlo. **"2%" solo, sin período, es como
"cien mil" solo.** No es un dato: es medio dato.

- *2% al mes* sobre un millón → 20.000 al mes
- *2% al año* sobre un millón → 20.000 **en todo el año**

El mismo número, y uno cuesta doce veces el otro.

## Por qué el interés baja mes a mes

Un millón al 2% mensual, en 12 cuotas.

El primer mes tenés el millón entero: el alquiler de ese mes es 20.000. Pero en la cuota no solo
pagás alquiler — también **devolvés un pedazo**, unos 74.560.

El segundo mes ya no debés un millón sino 925.440. Alquilás menos plata, así que **el alquiler
baja**. Y así hasta el final.

**La tasa nunca cambió**: fue 2% los doce meses. Lo que cambia es *sobre cuánto* se aplica.

## Por qué la cuota es siempre igual

Cobrar el alquiler real de cada mes daría cuotas altas al principio y bajas al final. La gente
quiere **un número fijo** para su presupuesto.

Entonces la cuenta va al revés: *¿cuál es el único valor fijo que, pagado 12 veces, alcanza justo
para devolver el millón y pagar todo el alquiler?* Ese cálculo se llama **`pmt`** y es la fórmula
central de todo esto. Da **94.560**.

La cuota no se mueve, pero **por dentro se da vuelta**:

| | alquiler | devolución |
|---|---|---|
| cuota 1 | 20.000 | 74.560 |
| cuota 12 | 1.850 | 92.710 |

Al principio pagás casi puro alquiler; al final casi todo es devolver. Por eso **prepagar temprano
ahorra mucho más que prepagar tarde**.

## Cambiar el "por"

Te dieron el precio por mes y vas a cobrar por semana. Hay que traducir.

El instinto es dividir. **Está mal**, porque el alquiler se acumula sobre el alquiler: en la
semana 2 ya cobrás también sobre lo que se generó en la semana 1.

La pregunta correcta: *¿qué precio semanal, cobrado 52 veces, cuesta lo mismo que el mensual
cobrado 12 veces?* Con 1,8% mensual:

- dividiendo → 0,415385% semanal → **24,05%** al año
- correcto → 0,412539% semanal → **23,87%** al año, empata exacto

Parece nada. Sobre 10,8 millones a dos años son **18.391 pesos**.

Y algo que confunde a todos: **esa traducción se hace UNA vez, antes de empezar.** Como convertir
60 km/h a 37 mph antes del viaje — después manejás a 37 mph todo el camino, no reconvertís cada
minuto. La tasa queda clavada; lo único que se mueve es el saldo.

## La tasa efectiva anual: para comparar, no para pagar

En el supermercado comparás por **precio por kilo**, aunque uno venga en 400 g y otro en 1,2 kg.
La **E.A.** es eso: el precio por kilo de la plata. Un producto cobra semanal y otro mensual, y
solo se comparan llevándolos al mismo año. Por eso la ley obliga a publicarla.

Pero **la E.A. no es lo que vas a pagar.** Un millón al 2% mensual es 26,82% E.A. Y sin embargo:

| | intereses | % del monto |
|---|---|---|
| pago todo al final del año | 268.242 | 26,82% |
| pago en 12 cuotas | 134.715 | **13,47%** |

Misma tasa. En el segundo caso **no tuviste el millón todo el año**: en el mes 6 ya debías la mitad.

> La E.A. mide cuánto cuesta la plata **por año que la tengas**. No mide cuánto vas a pagar — eso
> depende de cuánto tiempo la tengas.

De ahí sale algo que suena raro y es cierto: **pagar más seguido sale más barato.** Con cuotas
semanales devolvés desde la semana 1; con trimestrales te pasás tres meses debiendo todo.

## Al final son tres preguntas

1. **¿Cuánta plata?** → el monto
2. **¿A qué precio, y por cuánto tiempo?** → la tasa **y su período**
3. **¿En cuántos pedazos la devuelvo?** → el número de cuotas

De esas tres sale el resto solo: la cuota, la tabla, los intereses, la E.A.

## Por qué costaba entenderlo

No porque sea complicado: **porque casi nadie dice el período.**

En la BD de CreditOp hay cuatro columnas de tasa y **solo una** declara si es mensual o anual
(`credit_line_by_lenders.rate_suffix = "N.M."`). Las otras tres son números pelados. Y la que se
desincronizó en producción fue justamente una de esas: un crédito documentado al **28,79% E.A.**
se estaba amortizando al **1,82% mensual** (que es 24,16% E.A.). Ver **F-71** en `findings`.

No era difícil porque sea difícil. Era difícil porque **la mitad del dato faltaba**.
