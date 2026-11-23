# FUGA · las reglas (2026-10-17)

Acordadas con Miguel. Una página: si una regla no se puede decir en una frase, sobra. El detalle técnico y lo medido
está en GENERADOR.md; las ideas sin hacer, en IDEAS.md.

## El juego en una frase

**Los ladrones juntan la meta en plata en sus guaridas; la policía los atrapa antes.** Dos bandos con objetivos
distintos y las mismas chances, como en Age of Empires. Sin armas: simple como un juego de patio.

## Lo central: robar, huir, atrapar

**Los ladrones**
- Cada cosa del mundo que se puede robar dice cuánto vale al acercarse (un televisor, un cuadro, las joyas, la caja
  fuerte). Robarla la pone en la mochila: no frena, cabe todo.
- La meta es en plata y es de todo el equipo. Lo que vale es lo guardado en las guaridas, no lo que se lleva encima.
- Las guaridas las elige el sistema cada ronda (apartamentos de la ciudad y casas del monte, repartidas y parejas). Cada
  ladrón sabe su dirección exacta (calle, número, edificio, piso, apartamento) y adentro hay una caja donde se guarda.
- Para robar una vivienda ajena se fuerza la chapa. Antes se puede mirar por el visor si hay gente. Si hay gente
  adentro, llaman a la policía.
- Se huye con el cuerpo: correr, saltar, subir a las azoteas, saltar a otro techo, bajar por la escalera o el
  ascensor, meterse a una casa vacía. Hay una barra de vida: una caída fuerte lastima y desde muy alto mata.
- Se puede cambiar de ropa (lo que lleva en la mochila); nunca la piel, los ojos ni el cuerpo.

**La policía**
- Cada robo pone un punto en su mapa, donde pasó.
- El rastro (2026-10-18): apenas alguien roba, la policía ve a ese ladrón EN VIVO en su mapa, como un «?» (nunca su
  nombre), por un tiempo corto (RASTRO.robo, 20 s). Lo mismo si se le piden los papeles y sale corriendo
  (RASTRO.huyePapeles, 15 s). Es el tiempo para alcanzarlo; al acabarse, el «?» queda donde se lo vio por última vez y
  la zona donde puede estar crece con los minutos (los edificios se pintan de amarillo). El ladrón ve en su mapa que lo
  están siguiendo y cuánto le falta para perderse.
- El allanamiento (2026-10-18): guardar el botín con la policía encima —con el rastro encendido o perseguido— DELATA la
  guarida: la policía la ve en su mapa y, pasada la espera (ALLANAMIENTO.espera, 30 s: la orden), puede entrar. Lo que
  encuentra —todo lo guardado ahí, de cualquiera de la banda— se incauta y se descuenta de lo de la banda, aunque no
  agarre a nadie; la guarida queda cerrada el resto de la ronda. Antes de que entren, la banda puede volver a sacar lo
  guardado (a la mochila: el riesgo vuelve a estar encima). En el 3D, el policía ve en la puerta cuánto falta para la
  orden y, con ella, «Allanar la guarida»; si el jugador es ladrón, la policía bot va a la puerta, la vigila y entra
  pasada la espera. Los bots ladrones no guardan con la policía encima (siguen de largo hasta perderla) y, si una
  guarida suya quedó delatada, uno va a sacar el botín antes de la orden. Lo prueban validar-allanamiento (el 2D: la
  ronda y el motor de los bots) y validar-allanar3d (el 3D, de policía y de ladrón).
- En el lugar del robo, las cámaras tienen la foto del que robó: hay que ir a verla (o, más adelante, en el menú). Con eso
  se busca a alguien con ese aspecto entre la gente: la ropa puede cambiar, los rasgos no.
- Se le pueden pedir los papeles a cualquiera: dice quién es, en qué trabaja y dónde vive. El ladrón sin botín da un
  nombre que no está en el censo y queda marcado; con botín, va a la cárcel.
- El nombre sólo se sabe pidiendo los papeles (2026-10-18, Miguel: «que la policía no siga los nombres»). Al acercarse
  a alguien se ve sólo lo que se ve —«Mujer de camiseta turquesa · jean azul oscuro · pelo castaño»—, igual para la
  gente y para los ladrones, y nunca el nombre, el oficio ni la edad. El ladrón tiene una identidad falsa con la misma
  forma que la de cualquiera (nombre y apellido, la edad y el oficio de alguien que trabaja en la ciudad); lo único que
  la delata es que su nombre no está en el censo, y eso sólo se descubre pidiéndole los papeles: los dos quedan quietos
  y el ladrón se da cuenta. Con los papeles ya pedidos, el cartel muestra el nombre. El nombre de la cuenta del jugador
  no aparece en la partida (sólo en la sala de espera). Lo prueba validar-identidad (engine/juego/identidad.js).
- Atrapar es alcanzarlo. Si lleva botín encima, va a la cárcel y lo pierde; si no lleva nada, es una detención corta
  por sospecha.
- La policía no entra a las viviendas ni a las guaridas, sí a las zonas comunes (vestíbulo, escaleras, ascensor,
  pasillos, azotea). Si viene persiguiendo a un ladrón y él se mete a su guarida, sí puede entrar; y a una guarida
  delatada, pasada la espera del allanamiento (ver arriba).
- Uniformada: se la reconoce de lejos.

**El final**
- Ganan los ladrones si lo guardado llega a la meta.
- Gana la policía si tiene a todos los ladrones presos a la vez, o si se acaba el tiempo.
- Un ladrón libre puede rescatar a los presos en la comisaría.

**La ciudad**
- Vive sola: cada vivienda tiene su familia, cada uno su oficio y su semana (trabajo, colegio, gimnasio, compras), y
  cada lugar su horario. Un minuto real es una hora: la ronda dura 5 horas de la ciudad y empieza a cualquier hora.
- Una vivienda tiene gente si su familia está en casa a esa hora: de noche casi todas; entre semana de día, menos.
- La gente que se cruza dice su nombre y en qué trabaja. El ladrón dice un oficio de verdad, pero su nombre no es de
  ninguna familia.
- Sólo el dueño abre su casa. Los locales se trancan cuando cierran; los portales de los edificios con vecinos, nunca.

## Las ayudas (se usan si uno quiere)

- **El menú (Tab):** el de cada bando (2026-10-17: en vez del celular). El ladrón ve su botín, se cambia de ropa y ve
  su retrato en las noticias; la policía ve los avisos, los retratos, el censo y su equipo. Mientras lo mira, no ve la
  calle. Las reglas para el jugador: src/lib/reglasJuego.js («Cómo se juega» en /inicio).
- (Los drones de la comisaría se sacaron el 2026-10-18, Miguel: «el dron sobra con el mapa y los puntos de ayuda». Un
  ojo permanente en el cielo le quitaba el sentido al rastro corto; el código quedó en before/dron/.)
- **Las patrullas:** sólo para la policía, se sacan de la comisaría (cuántas, según el mapa), se manejan y se dejan
  estacionadas donde sea. Los ladrones no usan carros.
- **El hackeo:** un ladrón lee la placa de una patrulla en la calle (la clave de la policía es siempre la placa de
  alguna) y se la pasa por voz a un compañero que está en un computador; si entra, ve las cámaras. La
  policía recibe el aviso y cambiar la clave le toma un minuto; después se corta el acceso.
- **La ropa en la mochila** para cambiar de aspecto.

## Lo que ya está medido

Con bots, sobre el mundo de verdad: con la meta en 8 por ladrón, el juego queda parejo (los ladrones ganan entre el
45 y el 50 % de las rondas, de 2 a 8 por equipo). El mapa da para correr, saltar, esconderse y perseguir.

## El orden para hacerlo jugable (en el 3D)

1. ✓ La ronda como ladrón: el precio de cada cosa, robar con E, la mochila y la meta en pantalla, forzar, mirar por el
   visor, guardar en la caja de la guarida, el punto del robo.
2. ✓ (falta probar el salto entre techos en el 3D) La huida con el cuerpo: saltos entre techos, la barra de vida, las caídas.
3. ✓ La policía contra los ladrones
   bots del motor («Papel: policía»): el punto de cada robo en el mapa, revisar la cámara en el lugar (el retrato: piel y
   pelo), la marca sobre el retratado a la vista, atrapar con E (con botín, a la cárcel; sin nada, detenido), pedir
   papeles al que no tiene retrato, entrar a la guarida persiguiendo y registrarla, el uniforme y el final de la ronda.
4. ✓ Las patrullas: estacionadas frente a la comisaría, subir con E, manejar con W/S y A/D, chocar, estacionar donde
   sea al bajarse. Sólo la policía.
5. El multijugador con voz; después, el celular, el hackeo y el cambio de ropa.
