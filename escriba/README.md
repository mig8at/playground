# escriba — ortografía del español, por reglas

Herramienta personal de Miguel, **sin ninguna relación con CreditOp**. Está en el playground porque
es donde viven sus herramientas, no porque hable del negocio: no la cites nunca como fuente de
contexto. Es la hermana de `ingles/` — misma idea, otro idioma y otro problema.

    make escriba         # :5188
    make escriba-check   # ¿las reglas están sanas? (esto sí corrélo siempre que agregues una)

Suena una frase con un hueco y escribís la palabra que va. Si fallás te muestra **dónde** —letra por
letra—, **cómo se llama** ese error y **qué regla lo decide**.

**El nombre.** *Escriba* es el que escribe, y también es «escriba usted». Las dos cosas a la vez, que
es justo lo que hace la pantalla.

## Las cinco decisiones que explican todo lo demás

**1. El ítem es una frase con un hueco, no una palabra suelta.** No es comodidad: en español el
dictado de palabras sueltas es **imposible**. «Tuvo» y «tubo» suenan idénticas, «casa» y «caza»
también, y «cayó» y «calló» también — dictadas solas no hay forma de acertar salvo adivinando, y un
ejercicio que se falla por adivinar mal no enseña nada. La frase desambigua. Y el hueco recorta el
examen al tamaño de la pregunta: si tuvieras que escribir la frase entera, la nota se llenaría de
comas y dedazos hasta dejar de decir si sabés la regla o no.

**2. El hueco va marcado en el propio texto: `"Ayer [tuvo] mucha suerte."`** Una sola fuente de
verdad. La alternativa —la frase en un campo y la respuesta en otro— tiene una de más: el día que
alguien corrige la frase y no el campo, el ejercicio empieza a pedir una palabra que ya no está ahí,
y eso no se ve leyendo el `.json`.

**3. Lo que se entrega no es el veredicto, es la corrección.** Que está mal ya lo sabías por el
color. Lo que enseña son tres cosas, en este orden:

- **dónde**: las dos escrituras alineadas, letra debajo de letra, con el hueco justo debajo de la que
  falta. Se alinean con una distancia de edición, no posición por posición — a una palabra a la que
  le falta una letra en el medio se le corren todas las de atrás, y la corrección diría «tenés mal
  media palabra» cuando tenés mal una;
- **cómo se llama**: «es la tilde», «va junto», «acá va b, no v». En español el error casi siempre
  tiene nombre, y el nombre vale para cientos de palabras más. Cuando no hay un nombre corto y
  honesto, no dice nada — inventar una categoría sería peor;
- **por qué**: la regla. Es lo único que te llevás: la palabra suelta se olvida, la regla decide las
  próximas doscientas.

Y la gemela cuando la hay, que es la mitad del asunto: casi nunca el problema es «esto se escribe
así», sino que **existe otra palabra igual de real que significa otra cosa**.

**4. Se dice si el oído sirve, antes de contestar.** Es la lección de fondo y no revela nada — «el
oído no ayuda» vale para seis de las nueve reglas. Pero cambia qué hacés: en *dónde pega la fuerza* y
en los hiatos, escuchar la frase **es media respuesta**; en b/v, en la h y en el seseo, repetir el
audio diez veces no te acerca ni un milímetro, y lo único que queda es la regla o la memoria. Saber
en cuál estás parado vale tanto como la regla misma.

**5. Al final, el desglose POR REGLA.** Saber que fallaste «tuvo» es saber una palabra. Saber que
fallás 3 de cada 4 de la tilde diacrítica es saber qué estudiar el sábado — y eso una lista de
palabras sueltas no lo puede decir. Sale ordenado de peor a mejor, que es el orden accionable.

## ⚠ La voz no es una preferencia: decide si el ejercicio funciona

Acá elegir la voz del navegador no es estética. Dos ejemplos que rompen todo:

- una voz **de España** distingue la /s/ de la /θ/, así que lee «caza» distinto de «casa» y **te canta
  la respuesta** de todo el bloque de seseo. En Colombia esas dos suenan igual, y que suenen igual es
  justamente lo que hay que practicar;
- una voz **argentina** haría lo mismo con «cayó» y «calló».

Por eso la preferencia es **por locale primero y por nombre después**: México, 419, Estados Unidos,
Colombia —todas seseantes y yeístas, como el español de acá— y España al final, sólo si no hay otra.

Medido en esta máquina el 2026-09-14: **180 voces, 18 en español**, repartidas en `es-ES` (Mónica más
ocho voces de personaje) y `es-MX` (Paulina más las mismas ocho). Acá gana **Paulina**, que es la que
corresponde. El nombre de la que va a leer está **a la vista en la cabecera**, y si termina siendo una
de España la app lo dice en pantalla: un ejercicio que se resuelve solo y no avisa es peor que uno
que falta.

## Agregar una regla

Un `.json` en `data/reglas/`. El nombre empieza con el `id` y ordena la lista. No hay índice que
actualizar.

```json
{
  "id": "10-lo-que-sea",
  "titulo": "Nombre corto",
  "resumen": "una línea: sale debajo del título en la barra",
  "regla": "El porqué, escrito para entenderlo y no para memorizarlo. Dos o cuatro líneas.",
  "oido": "Qué aporta escuchar, y por qué.",
  "seOye": "decide | ayuda | no",
  "items": [
    { "frase": "Ayer [tuvo] mucha suerte.",
      "porque": "Del verbo tener, con v.",
      "ojo": "«tubo» con b es el caño." }
  ]
}
```

| campo | qué es |
|---|---|
| `frase` | la oración entera con **un** `[hueco]`. Se dicta completa, con la palabra puesta |
| `porque` | la regla que decide ESTE caso, en una línea. **Es el producto**: sin esto el ítem corrige sin enseñar |
| `ojo` | opcional: la palabra gemela, o la excepción que conviene saber |
| `seOye` | `decide` si escuchar resuelve, `ayuda` si sólo en parte, `no` si da igual |

⚠ **La regla de autoría que ninguna herramienta puede comprobar: la frase tiene que admitir UNA sola
escritura.** «Dime [qué] quieres» parece un buen ítem y no lo es —«dime que quieres» también es
español—, así que el que lo responde bien pierde igual. Antes de dar por buena una frase, leela con
la otra opción puesta: si las dos se entienden, la frase está mal, no la respuesta.

Después, siempre:

    make escriba-check

Da verde cuando cada ítem tiene su hueco y su porqué. Lo que busca:

- **sin hueco `[ ]`** — el ítem no se cae: **desaparece**. No hay error, hay una pregunta menos;
- **sin porqué** — lo más caro y lo más invisible: en pantalla se ve perfecto, pero la herramienta
  dejó de ser la que te dice qué regla rompiste y pasó a ser un juego de adivinar palabras;
- **respuesta con algo que no es una letra** — puntuación colada dentro del hueco (imposible de
  acertar) o el mojibake de un archivo mal guardado («canciÃ³n»);
- **frase repetida** entre archivos;
- *misma palabra en dos frases* — informativo, está bien: se practica dos veces y suman al mismo
  contador, porque lo que se aprende es la palabra y no la oración.

## Dos cosas chicas que se ven cuando faltan

**El ancho del hueco es mínimo fijo y crece con lo TUYO, no con la respuesta.** Si arrancara del
tamaño de lo que va, te estaría diciendo cuántas letras tiene — y en «porque / por qué» eso es media
respuesta.

**Al comparar se quita sólo el acento agudo, no «los diacríticos».** Descomponer y borrar todo el
rango `0300-036F` —que es lo que uno copia de internet— **se come la ñ** (n + U+0303) y **la ü**
(u + U+0308): «año» pasaría a «ano» y «pingüino» a «pinguino», dos letras del español convertidas en
otra. Acá la ñ y la ü son letras; la tilde es lo que se compara. Y todo pasa por `NFC` antes, porque
una «á» puede venir del teclado como un carácter o como dos y en pantalla se ven idénticas.

## Lo que se hereda de `ingles/`

El ritmo del ejercicio es el mismo, y por las mismas razones ya medidas allá: **acertar no frena** y
**fallar sí**, esperando un ⏎ para que dé tiempo de leer la corrección; **la que fallás vuelve a
salir** hasta tres veces, que es lo que separa la práctica de un examen; **⏎ con el hueco vacío
repite** en vez de contarlo como fallo; y **tocar `shift` repite la frase**, `⌥` la repite lenta —
las dos miran el *keyup* y no el *keydown*, porque al escribir una mayúscula el Shift baja antes que
la letra y si no sonaría cada vez que empezás una respuesta con mayúscula, que acá pasa seguido.

La comparación y el alineado son **una copia**, no un import: `ingles/` y `escriba/` son dos
herramientas independientes y no quiero que una se rompa por tocar la otra. Además no son idénticas —
la de acá no puede tocar las tildes, que allá daría igual.

⚠ **Y el costado sigue teniendo las respuestas a un clic.** Es a propósito, igual que en `ingles`: lo
que estas herramientas evitan es la ayuda que llega **sin pedirla**, no la que buscás a mano.

## Cómo está hecho

| archivo | qué hace |
|---|---|
| `src/ejercicio.js` | parte el hueco, arma la tanda, alinea y **nombra el error**. Sin Vue adentro: se prueba con `node` |
| `src/voz.js` | elige la voz, que acá es media herramienta (arriba está el porqué) |
| `src/memoria.js` | la cuenta, por ítem **y por regla** — que son dos preguntas distintas |
| `src/piezas/Correccion.vue` | la pieza por la que existe esto |
| `herramientas/check.js` | el oráculo de los `.json` |

Vue 3 y nada más. Sin backend, sin red: los datos son archivos y el estado es del navegador.
