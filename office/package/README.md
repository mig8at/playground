# Personajes de Office

Personajes en papel cortado (personas y 20 animales), con la chaqueta de CreditOp y cuatro gestos animados:
**escucha, teclea, piensa y habla**. Todo viene en un solo archivo, `office-characters.js`: el dibujo, el estilo y
el logo. No usa librerías ni framework.

Un personaje es un **JSON** chico (nombre, especie, forma de cara, peinado, barba, gorro, colores…). Lo armás en la
página del editor (`index.html` en my-tools, `example.html` en el paquete) y lo copiás con «Copiar JSON».

## Mostrar un personaje

```html
<script type="module" src="office-characters.js"></script>

<office-character
  gesture="talking"
  config='{"name":"Ana","face":"corazon","hair":"curly","hairColor":"#23171a","skin":"#8a5a3c","hat":"boina","hatColor":"#9b8ec7"}'>
</office-character>
```

- `gesture`: `idle` (escucha) · `typing` (teclea) · `thinking` (piensa) · `talking` (habla); se puede cambiar en
  cualquier momento.
- `background="false"`: sin el paisaje de papel, sólo el personaje.
- `activity`: `coffee` · `music` · `wave` · `thumb` · `celebrate` · `laugh` · `surprise` · `confused`, y `laptop="open|closed"`.
- `look="dx,dy"`: adónde mira (de -1 a 1).
- `mouth="0.6"` (con `gesture="talking"`): la boca la movés vos, de 0 (cerrada) a 1 (abierta), por ejemplo con el volumen de
  un audio cuadro a cuadro. Sin el atributo, la boca hace su vaivén propio.
- El tamaño lo pone tu CSS (`width`); guarda la proporción 4:3.

## Desde JavaScript

```js
import { draw, svg, randomCharacter, OPTIONS } from './office-characters.js'

const me = draw(document.querySelector('#avatar'), { name: 'Miguel', face: 'largo', hair: 'recogido', beardStyle: 'chivera' })
me.gesture = 'thinking'                          // cambia el gesto
me.config = randomCharacter({ name: 'Sorpresa' }) // otro personaje

const text = svg({ species: 'gato' }, { gesture: 'idle', background: false })  // el SVG como texto
console.log(Object.keys(OPTIONS.species))                                     // lo que se puede elegir
```

**Los nombres de antes siguen andando** (eran en español hasta el 2026-11-18): `<office-personaje>` con `gesto`,
`fondo`, `boca`, `actividad`, `portatil` y `mira` (y sus valores en español: `habla`, `cafe`, `cerrado`…), las
funciones `dibujar`, `alAzar`, `personaje` y `OPCIONES`, y el archivo `office-personajes.js` donde se publica.

## Las piezas del JSON

| campo | qué es | valores |
|---|---|---|
| `name` | el nombre | texto |
| `species` | persona o animal | `''` (persona), `mico`, `pato`, `gorila`, `oso`, `panda`, `koala`, `mapache`, `cerdito`, `oveja`, `leon`, `gato`, `zorro`, `perro`, `conejo`, `raton`, `rana`, `pinguino`, `buho`, `tucan`, `loro`, `perezoso`, `capibara`, `jaguar` |
| `face` | forma de la cara | `round`, `soft`, `wide`, `tall`, `largo`, `achatada`, `cuadrada`, `mandibula`, `corazon` |
| `hair` · `hairColor` | peinado y su color | `side`, `short`, `recogido`, `crop`, `bob`, `long`, `curly`, `bun`, `buzz`, `beanie` |
| `beardStyle` | barba | `''`, `corta`, `tupida`, `delgada`, `chivera`, `candado`, `bigote` |
| `hat` · `hatColor` | gorro | `''`, `lana`, `chullo`, `cachucha`, `reves`, `pescador`, `boina` |
| `nose` · `teeth` · `eye` | nariz, dientes, tamaño de ojos | `button`, `bulb`, `long`, `hook` · `''`, `grin`, `buck` · 18–32 |
| `extras` | accesorios | lista: `glasses`, `headphones`, `earrings`, `freckles` |
| `lashes` · `lids` · `glassesRound` | pestañas, párpado caído, lentes redondos | `true` / `false` |
| `skin` · `shirt` · `accent` · `gear` | piel o pelaje, chaqueta, camiseta, audífonos y aretes | color `#rrggbb` |
| `scene` | fondo | `sunset`, `clouds`, `hills`, `sun`, `waves`, `dusk`, `garden`, `ocean`, `candy` |
| `owner` | si es un agente, de quién es | texto (vacío si es una persona) |

Lo que falte toma un valor por defecto, así que `{"name":"Luis"}` ya es un personaje.

## De dónde sale

El paquete se genera desde my-tools, el repo de Miguel, (`make office-package`) a partir de los mismos archivos que usa la
llamada de Office: lo que se ve acá es lo que se ve allá. Los personajes son diseños propios.
