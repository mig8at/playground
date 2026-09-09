# inglés — leer con las 100 palabras más usadas

Herramienta personal de Miguel, **sin ninguna relación con CreditOp**. Está en el playground porque
es donde viven sus herramientas, no porque hable del negocio: no la cites nunca como fuente de
contexto.

    make ingles          # :5189
    make ingles-check    # ¿los .json están sanos? (esto sí corrélo siempre que agregues una historia)

Un texto en inglés a la izquierda… perdón, a la derecha; el glosario a la izquierda. Pasás el mouse
por encima de cualquier palabra o expresión y sale la traducción. El método es **transcribir la
historia a mano** y pedir otra con el mismo vocabulario.

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
| `nombres` | nombres propios. Sin declararlos, el chequeo los reporta como «sin traducción» en cada corrida |

Después, siempre:

    make ingles-check

Da verde cuando **cada palabra del texto tiene traducción disponible**. Lo que busca:

- **en el texto y SIN traducción** — lo importante. Es una palabra que al pasar el mouse no responde,
  y no hay forma de enterarse leyendo el JSON.
- **en el glosario y NO en el texto** — casi siempre un typo en la clave.
- *sueltas pero cubiertas por una frase* — informativo, está bien: `right` no se marca dentro de
  `all right` porque ganó la frase, que es lo correcto.

### Cómo pedirle una a Claude

> «creá una historia nueva con las mismas 100 palabras, máximo 12 palabras nuevas»

El tope importa y sos vos quien lo pone: las 100 son casi todas palabras de función —*the, of, to,
would*— y entre ellas no hay casi ningún sustantivo concreto (sólo *time, day, year, way, people*).
Una historia hecha **sólo** con ellas no se puede escribir sin que suene a manual de lógica, así que
cada historia agrega algunas; cuántas, lo decidís vos según cuánto quieras transcribir.

## Cómo está hecho

| archivo | qué hace |
|---|---|
| `src/lex.js` | lo único no trivial: reconoce el glosario dentro del texto, conjugado y separado |
| `src/memoria.js` | el contador de consultas y el «ya la sé» (localStorage) |
| `src/voz.js` | pronunciación con el sintetizador del navegador, sin dependencias |
| `herramientas/check.js` | el oráculo de los `.json` |

Vue 3 y nada más. Sin backend, sin red: los datos son archivos y el estado es del navegador.
