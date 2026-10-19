# FUGA · revisión de fachadas en el 3D (2026-10-18)

Cómo se revisó: `node scripts/ver-fachadas.mjs <ciudad> <carpeta> 14`. Saca a mediodía tres fotos —de frente desde la
vereda de enfrente, en diagonal desde la esquina y desde arriba— de un edificio de cada combinación distinta (tipo,
familia, techo, toldos) y de casas del monte y de la ciudad. Se hizo en las ciudades 1 y 2: 46 edificios y casas, 138
fotos, revisadas una por una en hojas de contacto. Los validadores numéricos de piezas (fachada 3D, titileo, huecos,
empalmes, oclusión) están en verde en el probador; esto es lo que ven los ojos.

Prioridad: **A** se nota en cualquier partida y es un error; **B** se nota y empobrece; **C** pulido.

## Lo que se buscó: color de fachada y low poly (2026-10-18)

Antes de corregir, Miguel pidió mirar cómo se ven las fachadas de verdad y si cabe en el low poly una mezcla de 2 a 4
colores por edificio.

- **La regla 60-30-10 de la pintura de fachadas.** Una fachada se pinta con tres colores: el cuerpo (~60 %, el muro), la
  moldura (~30 %: marcos, aleros, cornisas) y un acento (~10 %: puertas, persianas), que es donde se arriesga. En las
  casas históricas, la carpintería (marcos de ventana y puertas) es un tercer color aparte.
  ([JLC](https://www.jlconline.com/how-to/exteriors/best-practices-for-combining-exterior-colors/),
  [Cambridge, colores históricos](https://www.cambridgema.gov/Services/paintinghistoriccolors),
  [Brickworks](https://www.brickworks.com.au/articles/tips-tricks-for-selecting-your-exterior-paint-colour/))
- **Guatapé: el zócalo.** La franja baja de la fachada, pintada de otro color (y en relieve), nació para proteger el muro
  de la humedad. Es lo que más identifica al pueblo antioqueño, junto con balcones, puertas y marcos pintados.
  ([Along Dusty Roads](https://www.alongdustyroads.com/posts/2015/3/15/guatape-colour-zocalos-colombia-photography),
  [El País](https://www.elpais.com.co/turismo/cual-es-el-pueblo-mas-colorido-de-antioquia-sus-fachadas-son-una-joya-de-la-arquitectura-2608.html))
- **La Candelaria (Bogotá).** El IDPC tiene una paleta cromática para el centro histórico, con tonos que van del natural
  del material a los vinilos sobre la cal. La carpintería es de madera (puertas gruesas, ventanas, columnas).
  ([IDPC](https://idpc.gov.co/publicaciones/descargas/candelaria2.pdf),
  [Wikipedia](https://en.wikipedia.org/wiki/La_Candelaria,_Bogot%C3%A1))
- **Cartagena.** Muros de color o encalados con balcones de madera en ocre, terracota, turquesa, verde botella, azul o
  chocolate: el acento oscuro y saturado sobre la pared.
  ([Nomado](https://www.nomadotravel.app/en/guides/cartagena-colonial-architecture-guide),
  [Porsche](https://www.porsche.com/stories/experience/colombia-road-trip-the-colonial-beauty-that-inspired-a-literary-giant))
- **Low poly.** Los paquetes de ciudades estilizadas se ven bien de lejos gracias a una paleta corta y pareja y a formas
  simples. Un fondo desaturado deja leer los acentos saturados, y la legibilidad la da la diferencia de valor (claro u
  oscuro) entre las piezas.
  ([Polyvania](https://emaceart.itch.io/polyvania), [OpenGameArt](https://opengameart.org/content/polygon-world),
  [Mirror's Edge, color](https://www.worldofleveldesign.com/categories/game_environments_design/mirrors-edge-color.php),
  [Widelands, dirección de arte](https://www.widelands.org/forum/post/35555))

**Qué se tomó.** Cabe sin texturas. Al low poly le sobran caras planas y le faltaban zonas de color.

- **Antes.** Cada edificio tenía su pared pastel y la moldura blanca de siempre, así que de lejos todos eran «pastel con
  blanco».
- **Ahora.** Cada fachada lleva un esquema de 4 zonas (`esquemaDe` en color.js, `PALETA.esquemas` en medidas.js):
  - **pared:** el pastel de antes, distinto del vecino;
  - **moldura:** cornisa, alféizar, dintel y banda. Es clara (53 %), crema (34 %), tonal (la misma pared un poco más
    oscura, 7 %) u oscura (6 %);
  - **acento:** puertas, barandas y, en la mitad de los edificios, los marcos de las ventanas. Viene de una lista de
    oscuros saturados (verde botella, azul, vino, ocre, petróleo, chocolate, rojo colonial, grafito, morado); se separa
    de la pared y de la moldura y es más oscuro que la pared. Los marcos de acento van sólo en paredes claras: el 32 % de
    los edificios;
  - **zócalo:** la franja baja de la planta baja, de 0,8 m (antes 0,35 m y de la moldura). Va del acento (47 %), tonal
    (34 %) o gris piedra (20 %).

  Así cada fachada queda con 3 o 4 colores (medido en 4 ciudades: 47 % con 3 y 53 % con 4).
- **Lo que enseñaron las fotos.** La primera versión ponía moldura tonal y marcos oscuros en cualquier pared, y los
  edificios azules, rojos y morados quedaban opacos: el blanco de antes se leía mejor. Lo mismo dicen las referencias:
  el acento oscuro luce sobre una pared clara. Desde entonces, en una pared de luminancia menor a 0,45 (salmón, azul,
  rosa, lila) la moldura es clara o crema y los marcos van de la moldura. En las claras (amarillo, verde, menta,
  naranja, crema, celeste), los marcos de acento son los del 80 %: la pared naranja con marcos chocolate, la verde con
  marcos vino.
- **La prueba en el 2D.** `validar-color.mjs` comprueba:
  - las distancias de color (ΔE) entre acento, pared, moldura y zócalo;
  - que acento y zócalo sean más oscuros que la pared;
  - que cada fachada tenga de 3 a 4 colores;
  - que ninguna opción de moldura o zócalo pase del 60 % de la ciudad;
  - que los marcos de acento nunca vayan sobre una pared oscura, y que al menos el 60 % de las claras los lleven.

  Las pruebas del 3D (fachada, parpadeo, empalmes y huecos) pasan con el zócalo y los marcos nuevos.
- **Falta.** Las casas del monte siguen con sus colores propios (vivienda3d: marco y puerta del plano), sin zócalo. Son
  el caso más Guatapé y van después.

## Las tradiciones: fachadas de otros países en low poly (2026-10-18)

Miguel pidió no guiarse sólo por la arquitectura colombiana y sumar la de otros países que se pueda llevar al low poly.
Lo que se lleva bien es el COLOR por zonas (pared, moldura, acento y zócalo), no el relieve. Cada lugar quedó como una
receta en `PALETA.tradiciones` (medidas.js).

| tradición | pared | moldura | acento (puertas, marcos, barandas) | zócalo |
|---|---|---|---|---|
| Caribe (Cartagena) | pasteles vivos | clara, crema o tonal | verde botella, azul, vino, ocre, chocolate | acento, tonal o piedra |
| Antioqueño (Guatapé) | blanca o marfil | del acento | vivos | otro vivo |
| Mediterráneo (Santorini, Sidi Bou Saïd, Chefchaouen) | encalado blanco o azul | sin moldura | cobalto | sin zócalo o del acento |
| Burano y Bo-Kaap | saturados muy vivos | blanca | verde persiana o madera | sin zócalo o tonal |
| Nórdico (Nyhavn) | ocre, rojo óxido, mostaza, azul gris | blanca | negro o verde oscuro | piedra |
| Holandés (Ámsterdam) | ladrillo oscuro | blanca (marcos blancos) | verde muy oscuro, negro, vino | piedra oscura |
| Haussmann (París) | piedra crema | clara o tonal | hierro grafito (balcones) | tonal o piedra |
| Victoriano (las Painted Ladies) | vivos | otro color de la lista | rojo, azul, morado, ocre, verde | acento o tonal |
| Charleston (Rainbow Row) | pasteles suaves | blanca | verde Charleston o negro | piedra o tonal |
| Lisboa | amarillo, ocre, rosa, celeste | blanca | azul, verde, madera | azulejo azul o piedra |
| La Boca y Valparaíso | primarios fuertes | otro primario | negro, madera | chapa gris |
| Moderno (concreto) | blancos y grises | oscura o clara | un color fuerte (más claro que la pared) | piedra o ninguno |

Cada tradición sale de lo que se buscó:
- **Burano.** El color de cada casa lo aprueba el municipio; van del amarillo limón al rosa, con persianas verdes.
  ([Unearth the Voyage](https://unearththevoyage.com/13-towns-where-every-building-looks-hand-painted/))
- **Bo-Kaap.** Las casas eran blancas y cada dueño las pintó de un color vivo.
  ([Touropia](https://www.touropia.com/cities-with-colorful-houses/))
- **Las Cícladas y Sidi Bou Saïd.** Paredes encaladas y persianas y puertas cobalto. El encalado refleja el sol y
  refresca la casa.
  ([Real Greek Experiences](https://realgreekexperiences.com/?p=1418),
  [Material Bank](https://blog.materialbank.com/bringing-santorini-design-home/))
- **Rainbow Row.** Pasteles de esquema caribeño colonial, pintados desde 1931.
  ([Wikipedia](https://en.wikipedia.org/wiki/Rainbow_Row))
- **Las Painted Ladies.** Victorianas pintadas de tres o más colores, con molduras de otro color.
  ([Wikipedia](https://en.wikipedia.org/wiki/Painted_ladies))
- **Lisboa.** Paredes amarillas, beige, blancas, verdes y azules, y el azulejo azul y blanco.
  ([American Ceramic Society](https://ceramics.org/ceramic-tech-today/azulejos-a-portuguese-tradition-influenced-by-globalization/),
  [Lisbonlux](https://www.lisbonlux.com/magazine/the-10-most-beautifully-tiled-facades-in-lisbon))
- **Caminito.** Chapa y madera pintadas con la pintura que sobraba de los barcos, en bloques de ocre, cobalto, carmín y
  lima. ([Turismo Buenos Aires](https://turismo.buenosaires.gob.ar/en/otros-establecimientos/caminito?page=1),
  [AAA](https://www.aaa.com/tripcanvas/attraction/caminito-VA257))
- **Ámsterdam.** Las casas del canal, con sus frontones.
  ([Museo de los Canales](https://grachten.museum/en/?p=5673))
- **Nyhavn.** Casas de los siglos XVII y XVIII de varios colores. Las búsquedas no dijeron nada de la carpintería de
  Nyhavn ni de la de París, ni de los techos de zinc de París: esos acentos y techos son una elección propia.

**Cómo se reparte.** Cada zona de barrio de la ciudad (la grilla de blueprint) toma una tradición, de las que caben en su
familia de estilos:
- histórico: caribe, nórdico, holandés, Lisboa, La Boca;
- elegante: Haussmann, victoriano, Charleston, Lisboa;
- moderno: moderno, nórdico, caribe.

Dos zonas vecinas no repiten tradición, así que una cuadra es coherente y la ciudad, variada. Cada manzana del monte
toma una entre antioqueño, mediterráneo, Burano, caribe, Charleston y victoriano. Las casas del monte ahora usan el
esquema: pared, marcos de la moldura, puerta del acento y zócalo (vivienda.js lee `colores2d.zocalo`).

**Uniformes.** En el encalado, París, Guatapé y lo moderno, la pared se repite a propósito: es lo que les da carácter. Dos
vecinas se distinguen por el acento y el zócalo, y el pintado evita darle a una el acento de su vecina de la misma
pared.

**Medido (validar-color.mjs, 8 ciudades).**
- Cada ciudad mezcla de 5 a 7 tradiciones.
- Cada fachada lleva de 2 a 4 colores: 2 en el encalado y el blanco de Guatapé, 4 en las victorianas.
- La moldura blanca de siempre quedó en el 46 %.
- Si ningún color de la tradición alcanza para separar a una casa de sus vecinas (pasa con el holandés, que tiene pocos
  ladrillos), se usa el mismo color un poco más claro u oscuro (`TONOS` en color.js). Pasó 2 veces en 1.422 fachadas.
- Las vecinas gemelas (misma pared, zócalo y acento) en las tradiciones uniformes son el 1,4 % de los pares.

## Correcciones

1. **A · Las casas de la ciudad tienen vidriera de local.** El lote «casa» de la ciudad (p. ej. L40 de la ciudad 1, Ak
   28 # 7-28) tiene planta baja de vidrio de piso a techo, como un local: desde la calle se ve el dormitorio, la cocina y
   la sala. Una casa lleva ventanas residenciales (con antepecho, reja o persiana), puerta de madera y, si cabe, un
   antejardín o una escalinata. Dónde: el plano de la planta baja de los lotes «casa» (blueprint: qué módulos son
   «vidriera») y fachada.js, que pone la vidriera de la familia (FAMILIES.shop). Prueba: que ningún módulo de planta baja
   de un lote «casa» sea vidriera.
2. **A · Apartamentos y hotel con muro cortina de vidrio entero (familia «metal»).** En «Residencias Altamira» (L45 de la
   ciudad 2) y el «Hotel La Aurora» (L23) toda la fachada es vidrio de piso a techo y se ve cada cuarto. En un edificio
   de vivienda se espera ventana con antepecho opaco (o vidrio opaco en la franja de la losa) y, en el piso, cortinas.
   Dónde: fachada.js, la familia «metal» (FAMILIES.metal y WINDOWS.metal) para lotes de vivienda u hotel. Prueba: la
   parte vidriada de cada piso de vivienda, a lo sumo un 45 %.
3. **B · La mansarda es una caja.** Con techo «mansarda» (L24 y L26 de la ciudad 1), desde arriba se ve un piso más de
   muro oscuro vertical con techo plano, no una mansarda de pizarra con pendiente y buhardillas. En L55 de la ciudad 2 se
   insinúa con ventanas, pero sigue vertical. Dónde: town3d.js (fs.mansard: el muro de 3 m y el techo plano a L.h+3).
   Ojo: el choque y el salto entre techos se calibraron con esta caja (validar-salto); si se le da pendiente, hay que
   ajustar floorAt sobre la mansarda y volver a validar los saltos.
4. **B · Los árboles de la calle tapan la fachada y la vitrina.** En casi todas las fotos de frente hay una copa justo
   delante de la planta baja (L24, L26 y L49 de la ciudad 1; L46 de la 2), y en el monte las copas cubren la casa entera
   desde arriba. La regla 3-30-300 se cumple, pero la copa empieza bajo y es ancha. Dónde: vegetacion.js (la altura del
   fuste y el radio de copa de los árboles de calle; no poner árbol frente a una vidriera, como ya se hace frente a las
   puertas con frenteAPuerta). Prueba: la parte de cada vidriera tapada por copas, vista a 1,7 m desde la vereda de
   enfrente.
5. **B · El hospital y el hotel no se reconocen.** «Hospital El Sol» y «Hospital Colonial» son edificios de oficinas más
   (la cruz sólo se ve en el techo); el hotel no tiene nombre ni marquesina. Una entrada de urgencias con marquesina y
   letrero y el nombre del hotel sobre la puerta ayudarían a orientarse, y en el juego son lugares (avisos, cámaras).

## Mejoras

1. **B · El material de la familia.** «Ladrillo» se ve como pintura plana del mismo tono (L8, L14 y L27 de la ciudad 1);
   «piedra», igual. Una textura de ladrillo visto o de sillares, aunque sea en la planta baja y las esquinas, haría que
   las familias se distingan de lejos, como dice el diseño.
2. **B · Las culatas.** Los muros laterales donde el vecino es más bajo (esquina de L8 de la ciudad 1) quedan como paños
   ciegos de un color. En Colombia suelen tener ladrillo a la vista, avisos pintados o un mural: un lienzo de
   publicidad, o el ladrillo, les daría vida.
3. **B · Las azoteas, todas iguales.** Losa gris lisa con un pretil fino y, a veces, un aire acondicionado y la caseta de
   la escalera. Faltan tanques de agua, antenas, ropa tendida, materas y alguna cubierta liviana: es lo que más se ve
   desde el dron y desde arriba, y donde corre el ladrón.
4. **B · Los nombres de los locales.** Las vidrieras muestran el interior (bien), pero el giro no se lee desde la calle:
   un letrero sobre el toldo con el nombre (bp.lots shopName ya existe) ayuda a buscar «la panadería» o «la joyería».
5. **C · Las alturas.** En las dos ciudades casi todo es de 4 pisos, y los de 6 se repiten. Una mezcla de 2 a 7 pisos
   rompería la línea de techos (con cuidado: los saltos entre techos y las guaridas dependen de las alturas; recalibrar).
6. **C · Los balcones** se ven como cajas oscuras desde abajo (L26 y L27 de la ciudad 1; L55 de la 2). Una losa más
   delgada y la baranda calada se verían menos pesados.
7. **C · La planta baja de las esquinas.** Las esquinas son vivas; una ochava o un local en la esquina con dos
   vidrieras (lo típico del centro) le daría carácter a los cruces.
8. **C · Las casas del monte** se ven bien (porche, persianas, chimenea, cerca, buzón), pero se repiten mucho los mismos
   dos o tres colores y el mismo techo a dos aguas. Variar el techo (cuatro aguas, teja de barro con alero) y las
   cercas (muro bajo, reja) bastaría.

## Lo hecho el 2026-10-18 (cada corrección con su prueba en el 2D)

- **Las ventanas de las casas del monte, juntas o sobre la puerta.** Miguel lo vio en el juego, y en dos ciudades se
  midieron 169 ventanas encima o pegadas a la puerta, 41 ventanas encimadas y 111 que llegaban a la esquina. Las
  causas:
  - el ancho que se le daba a la ventana no contaba los postigos, de media ventana por lado;
  - tampoco contaba la puerta tal como se dibuja: la doble mide 1,9 m y el plano le guardaba 1;
  - la puerta del patio iba centrada justo donde iba la ventana de la cocina;
  - no había margen en las esquinas.

  Ahora:
  - cada ventana va en su tramo (vivienda.js, `VANO`): el de su cuarto, sin la puerta dibujada, a 0,3 m de las
    esquinas y con 0,25 m de pared entre vanos;
  - si no cabe con postigos, va sin ellos; si no, más angosta; si no, en la pared del costado;
  - la puerta del patio se corre a un extremo (hogar.js) y siempre es sencilla.

  `validar-vanos.mjs` (en el probador, nivel 3): 0 pisadas, el hueco más chico es de 0,25 m y todos los cuartos que
  tenían ventana la conservan.
- **A1, las casas de la ciudad con vidriera.** El 3D le ponía vidriera a toda ventana de planta baja. Ahora la vidriera
  va donde el 2D la decide (`esVidriera` en medidas.js): en un local, y en la planta baja de oficinas, hospital y lobby
  de hotel, donde es lo normal y es su luz. En casas y viviendas, la ventana de su familia. Las ventanas de planta baja
  que no son vidriera también reciben la pieza que les da luz suficiente. `validar-fachada-uso.mjs`: las 692 vidrieras
  de planta baja donde se vive están en locales.
- **A2, el muro cortina en vivienda y hotel.** Donde se vive no hay vidrio entero (`RESIDENCIAL`, `VENTANAS_VIVIENDA`).
  Para las salas grandes hay un ventanal propio, de 1,5 m con antepecho de 0,9 m (fachada3d `VENTANAL`). Ninguna
  ventana pasa del 45 % de su módulo, y ningún cuarto se queda sin la luz mínima. La profundidad de los cuartos sólo
  cambió en las viviendas de familia metal: cambiarla en todas hacía parpadear una pared al caminar (lo atrapó
  validar-visibilidad).
- **B4, los árboles frente a las vitrinas.** Ningún tronco de calle frente al vidrio de una vidriera: se corre hasta la
  columna entre dos (vegetacion.js, `V.vidriera`). La regla 3-30-300 se sigue cumpliendo y la copa de la ciudad queda en
  14 %.
- **B5, el hospital y el hotel.** En el low poly no hay letreros con texto (decisión del 2026-10-16), así que la entrada
  principal lleva una marquesina: la del hospital, blanca con la cruz roja, sobre la puerta de urgencias; la del hotel,
  del color de su acento (blueprint `marcarEntradas`, fachada3d `MARQUESINA`).
- **Mejora 2, las culatas.** El muro ciego que asoma sobre el vecino más bajo va en ladrillo a la vista (`PALETA.culata`),
  salvo en el encalado y Guatapé.

**El probador completo** (niveles 0 a 10) pasa después de estos cambios, salvo «policía» en el nivel 10. Ésa falló una
vez dentro del probador y pasó las dos veces que se corrió sola: es intermitente, por la carga de la máquina. Dos
cosas que el probador atrapó en el camino:
- **La profundidad de los cuartos.** Cambiarla en todas las viviendas hacía parpadear una pared al caminar
  (validar-visibilidad); quedó acotada a las de metal.
- **Comer de noche.** Las ciudades nuevas tienen otras familias, y con trancón y robo unas pocas personas llegaban a la
  hora de acostarse después de las 23:30 y se quedaban sin comer (validar-rutina). Ahora quien está en casa con hambre
  come antes de la medianoche (rutina.js).

**Queda pendiente**, porque cambia por dónde se camina o se salta y hay que calibrarlo primero en el 2D:
- la mansarda con pendiente (B3);
- las azoteas con tanques, antenas y tendederos (mejora 3);
- la mezcla de alturas (mejora 5).

También quedan:
- los letreros de los locales (mejora 4), que chocan con la decisión de no poner texto;
- los balcones calados (mejora 6), las esquinas (mejora 7) y la variedad de techos de las casas del monte (mejora 8).

## La mansarda, las azoteas y el caminar (2026-10-18, segunda tanda)

- **B3, la mansarda.** El techo plano se dibujaba sobre toda la planta y tapaba la pizarra: la mansarda se veía como un
  piso más de muro oscuro, y la física pisaba a 2,8 m también sobre la pendiente.
  - **El 2D** (techos.js, `MANSARDA`) da su perfil, el de la pieza del paquete: 3 m de alto en 1 m de pendiente desde
    cada fachada y la cubierta plana arriba, que se dibuja sólo ahí.
  - **El ascensor:** donde llega a la fachada, la mansarda se interrumpe y el núcleo sube derecho, como una caseta.
  - **La pizarra** toma el color del techo de su tradición: zinc en Haussmann, teja en las demás.
  - **El salto:** por la pendiente de 72° se baja en el aire, así que desde una mansarda se salta desde la cresta, con
    más alcance. validar-azoteas y validar-salto siguen esa regla.
  - **La prueba:** validar-mansarda (perfil, cubierta sin huecos, ascensor en lo plano).
- **Mejora 3, las azoteas.** Las arma el 2D (azoteas.js, `AZOTEA.objetos`):
  - **Qué hay:** el tanque de agua negro sobre su base, la antena, el tendedero con ropa, los equipos de aire (antes el
    3D los ponía al azar y sin choque) y las materas junto al pretil.
  - **Las reglas:** todo choca y queda a 1,5 m del borde (la pista para tomar carrera queda libre); la salida del
    ascensor, libre; los objetos ocupan a lo sumo el 8 % del techo, y el piso libre es una sola pieza desde la que se
    llega a todo el borde.
  - **La prueba:** validar-azoteas-objetos.
- **El caminar de la gente.** Miguel: «saltos bruscos de movimiento». Medido con validar-caminar en el 2D, antes:
  aceleraciones de 12 a 26 m/s², giros de hasta 800°/s y los pies patinando hasta un 35 %. Las causas y los arreglos:
  - **El camino:** el de la grilla de 2 m doblaba 45° de golpe; ahora se redondea.
  - **El carril y los desvíos:** cambiaban de un cuadro a otro. Ahora cada persona sigue su punto con un resorte, con la
    aceleración tope en 2,8 m/s², y los vecinos se empujan como una fuerza, no con un empujón de posición.
  - **La animación:** va a lo que la persona de verdad avanza (`ANIM`).
  - **La pose:** a media distancia se actualizaba cada 2 cuadros; ahora se actualiza en cada uno.

  Ahora: aceleración p99 ≤ 2,8 m/s², giros p99 ≤ 150°/s, los pies no patinan y cada uno mira hacia donde camina.
- **El probador completo** pasa los niveles 0 a 10. Gente y policía fallaron una vez dentro del probador y pasan solas:
  son intermitentes por la carga de la máquina.

## Lo que está bien

Las vidrieras de los locales con su interior a la vista y los toldos por giro; las ventanas con su marco y el interior
visible de noche y de día; las direcciones en placa sobre cada puerta; los pretiles de las azoteas; las casas del monte
con porche, persianas y jardín; la escalinata de los edificios en pendiente; los colores de pintura por fachada.

## Para seguir

Cada corrección debería quedar con su prueba en el 2D (la regla de trabajo): las 1, 2 y 4 se pueden medir sin
pantalla (qué módulos son vidriera, la parte vidriada de cada piso, cuánto tapa la copa).
`node scripts/ver-fachadas.mjs` queda para revisar a ojo antes y después.
