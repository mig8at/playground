# Personajes de Office

Personajes en papel cortado (personas y 20 animales), con la chaqueta de CreditOp y cuatro gestos animados:
**escucha, teclea, piensa y habla**. Todo viene en un solo archivo, `office-personajes.js`: el dibujo, el estilo y
el logo. No usa librerías ni framework.

Un personaje es un **JSON** chico (nombre, especie, forma de cara, peinado, barba, gorro, colores…). Lo armás en la
página del editor (`index.html` en el playground, `ejemplo.html` en el paquete) y lo copiás con «Copiar JSON».

## Mostrar un personaje

```html
<script type="module" src="office-personajes.js"></script>

<office-personaje
  gesto="habla"
  config='{"name":"Ana","face":"corazon","hair":"curly","hairColor":"#23171a","skin":"#8a5a3c","hat":"boina","hatColor":"#9b8ec7"}'>
</office-personaje>
```

- `gesto`: `escucha` · `teclea` · `piensa` · `habla` (se puede cambiar en cualquier momento).
- `fondo="false"`: sin el paisaje de papel, sólo el personaje.
- El tamaño lo pone tu CSS (`width`); guarda la proporción 4:3.

## Desde JavaScript

```js
import { dibujar, svg, alAzar, OPCIONES } from './office-personajes.js'

const yo = dibujar(document.querySelector('#avatar'), { name: 'Miguel', face: 'largo', hair: 'recogido', beardStyle: 'chivera' })
yo.gesto = 'piensa'                       // cambia el gesto
yo.config = alAzar({ name: 'Sorpresa' })  // otro personaje

const texto = svg({ species: 'gato' }, { gesto: 'escucha', fondo: false })  // el SVG como texto
console.log(Object.keys(OPCIONES.species))                                  // lo que se puede elegir
```

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

El paquete se genera desde el playground de Miguel (`make office-package`) a partir de los mismos archivos que usa la
llamada de Office: lo que se ve acá es lo que se ve allá. Los personajes son diseños propios.
