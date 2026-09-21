# inglés — leer con las 100 palabras más usadas

Herramienta personal de Miguel, **sin ninguna relación con CreditOp**. Está en el playground porque
es donde viven sus herramientas, no porque hable del negocio: no la cites nunca como fuente de
contexto.

⚠ **Y desde el 2026-09-21 hay un segundo inglés, que NO es éste.** `cuadrilla` tiene un juego de
dictado en `/games/english` (repo compartido, `tools/cuadrilla/games/english`): tres niveles, banco
de palabras en Postgres y progreso por persona. Se quedó **sólo con el dictado** — sin lector, sin
glosario y sin historias — así que los dos no se pisan: acá se lee un cuento con el glosario al lado,
allá se practica ortografía con el equipo. La corrección letra por letra es la misma idea y está
escrita dos veces; si una de las dos cambia, la otra no se entera.

    make ingles          # :5189
    make ingles-check    # ¿los .json están sanos? (esto sí corrélo siempre que agregues una historia)

Un texto en inglés a la izquierda… perdón, a la derecha; el glosario a la izquierda. Pasás el mouse
por encima de cualquier palabra o expresión y sale la traducción. El método es **transcribir la
historia a mano** y pedir otra con el mismo vocabulario — y antes de transcribir, **dictado**:
el botón de arriba cambia de modo y te dicta las palabras del cuento para escribirlas sin tenerlas
delante.

## Las tres decisiones que explican todo lo demás

**1. El JSON no lleva posiciones, lleva texto plano y un glosario.** El front reconoce las entradas
dentro del texto —conjugadas («went» encuentra «go») y separadas («took all the things out» encuentra
«take ~ out»)—. Alternativa descartada: marcar rangos con índices. Se rompen solos: los genera mal un
modelo, y los invalida cualquier coma que agregues después.

**2. Por defecto sólo se marca lo nuevo.** Salió de mirar la pantalla: las 100 cubren la mayor parte
de cualquier texto, así que subrayarlas también convierte el párrafo en un campo de rayas y lo que
estás aprendiendo hoy deja de saltar. Las 100 **siguen respondiendo al mouse**, sólo que sin
anunciarse. El selector de arriba tiene los otros dos niveles: marcar todo, y modo ciego.

**3. Se cuenta cuántas veces mirás cada palabra.** Es lo que evita que el hover sea sólo una muleta:
con la traducción siempre a un píxel el cerebro no hace el esfuerzo, pero el contador convierte cada
consulta en diagnóstico. La pestaña **Repasar** las ordena por cuántas veces te costaron. Vive en
`localStorage`, se acumula entre historias y no sale de tu navegador.

**4. El párrafo entero en español, pero sólo si lo pedís.** `⌘+clic` (o `Ctrl+clic`) sobre el
párrafo, o el `es` del margen, despliega la traducción debajo. Contesta otra pregunta que el
glosario: no *qué quiere decir esta palabra* sino *qué está diciendo esta frase* — que es lo que
queda cuando entendés todas las palabras y aun así no entendés la oración, porque el inglés ordena
distinto. **Hover no**, y es a propósito: el mouse siempre está sobre algún párrafo, así que el hover
te daría la traducción sin habérsela pedido y ahí se termina el esfuerzo de entender. Los párrafos
que pediste quedan con un punto en el margen: al releer, dice cuáles no se entendieron solos.

**5. Y el párrafo en voz alta, con `▶`.** Escuchar la oración entera enseña algo que oír palabra por
palabra no puede: dónde se pegan unas con otras y dónde sube el tono. **Éste sí se queda en modo
ciego**, al revés que el `es`: es la única ayuda que no da la respuesta — oír el inglés no lo
traduce, y leer escuchando sin marcas es ejercicio. Usa el sintetizador del navegador, sin
dependencias ni red.

Dos cosas que no se ven y sostienen esto: el párrafo se **parte en oraciones** antes de hablar
porque Chrome corta en seco cualquier audio de más de ~15 s (un párrafo de treinta palabras ronda los
trece: el problema no es teórico); y la **voz se elige con lista negra**, porque macOS registra como
`en-US` sus voces de broma —Bells, Boing, Zarvox— y un `find` por idioma, que es lo obvio, elige un
cencerro. Para ver con cuál va a leer, sin escucharla: `vozElegida()` en `src/voz.js`.

## El dictado

El botón **dictado**, arriba al lado del selector de historia. Suena una palabra del cuento, la
escribís, y si fallás te muestra **dónde** —letra por letra— antes de seguir.

Existe por lo que le falta a transcribir: con el texto delante, la mano puede copiar letra por letra
sin que nadie aprenda a escribir nada, y uno termina el cuento entero sin saber si sabe. El dictado
saca el modelo de la pantalla y deja sólo el sonido, que es justo donde el inglés no se deja
deducir — *neighbour* no se escribe como suena y *though* no se parece a nada.

**Qué se dicta.** Un selector, con la cantidad al lado para saber a qué te estás metiendo:

| conjunto | qué trae |
|---|---|
| lo que esta historia agrega | `nuevas` + `frases` + `sentidos`: lo que estás aprendiendo hoy. Es el default |
| las 100 que salen en ésta | las del núcleo que **de verdad** aparecen en este cuento, no las 100 |
| todas las de esta historia | las dos juntas |
| las que te vienen costando | sale del uso y cruza **todas** las historias: lo que consultaste leyendo más lo que fallaste acá, y esto último pesa doble — mirar la traducción es no acordarte del significado; fallar el dictado es no reconocerla ni oyéndola |

**Lo que enseña es la corrección, no el veredicto.** Decir «está mal» es gratis; lo que sirve es
dónde. Las dos escrituras se alinean con una distancia de edición y se pintan una debajo de la otra,
en columnas del mismo ancho, así que el hueco cae justo debajo de la letra que falta:

    escribiste   n e i g · b o u r
    va           n e i g h b o · r

Comparar posición por posición —lo obvio— no sirve: a «neigbor» le falta una letra en el medio y
desde ahí **todas** quedan corridas, o sea que la corrección diría «tenés mal media palabra» cuando
tenés mal una.

**El ritmo es la otra mitad del ejercicio**, y son tres decisiones:

- **acertar no frena** (se ve el ✓ y sigue sola) y **fallar sí**, y espera un ⏎: la corrección es lo
  único que enseña y hay que darle tiempo a que se lea. Parar a celebrar cada acierto convierte una
  vuelta de cuarenta palabras en un trámite;
- **la que fallás vuelve a salir**, hasta tres veces. Sin eso el dictado es un examen —te dice lo que
  no sabés y se acabó—; con eso es práctica, que era el punto;
- **⏎ con el campo vacío la repite** en vez de contarla como fallo. No entender lo que sonó no es el
  error que esto quiere medir.

**Y sin soltar el teclado: tocar `shift` repite la palabra, `⌥` la repite a media velocidad.** Es lo
que más se usa del ejercicio, y tenerlo sólo en un botón obliga a ir al mouse en mitad de escribir.

⚠ Las dos miran el **keyup**, no el keydown, y no es un detalle: al escribir una mayúscula el Shift
baja **antes** que la letra, así que disparar al bajar haría sonar la palabra cada vez que escribís
un nombre propio. Anotando si hubo otra tecla en el medio, *tocar Shift* y *escribir en mayúscula* se
distinguen sin ambigüedad — comprobado con los dos gestos, más el Shift sostenido, Shift+⏎ y perder
el foco con la tecla abajo.

Al comparar se perdonan mayúsculas, espacios de más y la comilla tipográfica —ésa la pone el teclado,
no vos—. El apóstrofo **no** se perdona: en «don't» es la lección. Los separables se dictan y se
escriben sin el hueco (*pick up*), que vuelve a aparecer en la corrección, donde sí explica algo.

⚠ **El glosario del costado sigue ahí, con las respuestas a un clic.** Es a propósito: lo que esta
herramienta evita es la ayuda que llega **sin pedirla** —por eso el hover no traduce párrafos—, no la
que buscás a mano. Taparlo sería tratarte como a un alumno vigilado, y el que se sopla en su propia
práctica ya sabe lo que está haciendo.

El campo va con el corrector y el autocompletado del navegador **apagados**: el subrayado rojo de
Chrome es exactamente la respuesta que estamos preguntando.

## Agregar una historia

Un `.json` en `data/historias/`. El nombre empieza con el `id` y ordena el selector. No hay índice
que actualizar.

```json
{
  "id": "03-lo-que-sea",
  "titulo": "Whatever",
  "resumen": "Una línea en español: sale en la barra de arriba.",
  "nombres": ["Tom", "Ana"],
  "texto": "Párrafos separados por línea en blanco.\n\nComillas tipográficas “así”, que en JSON no hay que escapar.",
  "traduccion": ["Párrafos separados por línea en blanco.",
                 "Uno por párrafo, en el mismo orden."],
  "nuevas":   { "key": "llave",
                "leave": { "es": "irse; dejar", "nota": "los dos sentidos en un verbo. Pasado: left" } },
  "frases":   { "look for": "buscar",
                "pick ~ up": "recoger" },
  "sentidos": { "left": "dejó (pasado de «leave») — no es «izquierda»" }
}
```

| campo | qué es |
|---|---|
| `nuevas` | lo que **no** está en las 100. Un string, o `{es, nota}` cuando hace falta explicar |
| `frases` | phrasal verbs y expresiones. **`~` es el hueco**: `pick ~ up` reconoce *pick up*, *pick it up* y *pick the key up* |
| `sentidos` | una palabra de las 100 usada con otro significado. Gana sobre el glosario general — es el caso donde el general miente |
| `traduccion` | el párrafo entero en español, **un elemento por párrafo y en orden**. Natural, no literal: la gracia es entender la frase. Se indexa por posición, así que uno de más o de menos corre todos los siguientes |
| `nombres` | nombres propios. Sin declararlos, el chequeo los reporta como «sin traducción» en cada corrida |

Después, siempre:

    make ingles-check

Da verde cuando **cada palabra del texto tiene traducción disponible**. Lo que busca:

- **en el texto y SIN traducción** — lo importante. Es una palabra que al pasar el mouse no responde,
  y no hay forma de enterarse leyendo el JSON.
- **traducción desalineada** — otro fallo que enseña mal en vez de no enseñar: con un párrafo de
  más o de menos te muestra tranquilamente el español del párrafo equivocado, y no se ve leyendo el
  `.json` porque hay que contar los dos arreglos.
- **en el glosario y NO en el texto** — casi siempre un typo en la clave.
- *sueltas pero cubiertas por una frase* — informativo, está bien: `right` no se marca dentro de
  `all right` porque ganó la frase, que es lo correcto.

### Cómo pedirle una a Claude

> «creá una historia nueva con las mismas 100 palabras, máximo 12 palabras nuevas»

Va con su `traduccion` incluida — sin ella la historia funciona, pero le falta la mitad de la ayuda.

El tope importa y sos vos quien lo pone: las 100 son casi todas palabras de función —*the, of, to,
would*— y entre ellas no hay casi ningún sustantivo concreto (sólo *time, day, year, way, people*).
Una historia hecha **sólo** con ellas no se puede escribir sin que suene a manual de lógica, así que
cada historia agrega algunas; cuántas, lo decidís vos según cuánto quieras transcribir.

## Cómo está hecho

| archivo | qué hace |
|---|---|
| `src/lex.js` | lo único no trivial: reconoce el glosario dentro del texto, conjugado y separado |
| `src/dictado.js` | arma la tanda y **alinea** lo que escribiste con lo que iba. Sin Vue adentro, a propósito: así se prueba con `node` y sin navegador |
| `src/memoria.js` | el contador de consultas, el «ya la sé» y la cuenta del dictado (localStorage) |
| `src/voz.js` | pronunciación con el sintetizador del navegador, sin dependencias |
| `herramientas/check.js` | el oráculo de los `.json` |

Vue 3 y nada más. Sin backend, sin red: los datos son archivos y el estado es del navegador.
