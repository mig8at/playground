# FUGA · mejoras pendientes (2026-10-17)

Lo que queda para rendimiento y para calibrar objetos y movimientos, por prioridad. Cada punto dice qué se vio y dónde
tocar. Lo medido está en GENERADOR.md.

## Rendimiento

1. **La carga de una ciudad es lenta.** El plano tardó 37 s en el navegador del panel, y en uno sin ventana
   ~15-25 s. La misma ciudad se arma varias veces: blueprint, prepararCiudad (guaridas), mapaDeJuego (grilla de rutas,
   ~0,9 s), sociedadDe y puertasDeLugares. Guardar el resultado por semilla (IndexedDB) y armarlo en un worker; en /inicio
   el plano de «Crear mundo» también regenera la ciudad.
2. **Los caminos de la gente.** Cada campo de distancias cuesta ~50 ms y se adelantan de a 3 ms por cuadro: los
   primeros segundos hay gente que no aparece. Precalcular los campos de los destinos (hogares y lugares) en un worker
   al cargar, o guardarlos con la ciudad.
3. **Separar a la gente es O(n²)** (hasta 120 por cuadro, 6 pasadas). Una grilla espacial lo baja a casi lineal.
4. **Quién está adentro de los lugares** recorre a toda la ciudad (~1.000 personas) cada medio segundo con dondeEsta.
   Indexar las estancias por lugar y por hora.
5. **Los muñecos.** Cada persona es un clon con esqueleto, y el pozo de muñecos guardados no se libera nunca. Cuadros
   por segundo medidos: 50-85 al salir, 45-75 con el dron, 500-1.100 llamadas de dibujo. Muñecos de lejos en
   instancias (impostores), menos sombras y juntar geometría estática por lote.
6. **ocupacionSociedad** muestrea cada segundo de la ronda para todas las viviendas al empezar: hacerlo por vivienda
   cuando se mira (el visor, la llamada).
7. **El probador de pantalla en paralelo da falsas fallas** (salto y 3D, por cuadros por segundo con la máquina
   cargada). Correr el nivel 10 de a una prueba, o medir por tiempo y no por cuadro.

## Calibración del juego

1. **«Otra ciudad» siempre da la 1 en /demo**: el análisis de City no aprueba ninguna ciudad con parques (0 de 59).
   Revisar sus criterios para el diseño con parques; /inicio lo esquiva con una semilla al azar sin validar.
2. **El ladrón se esconde en cualquier interior**, también en vestíbulos, escaleras y pasillos, donde la policía sí
   entra. Debería contar sólo una vivienda o una guarida.
3. **Los ladrones bots salen de su guarida a los ~2,5 s**: «Registrar la guarida» casi nunca encuentra a alguien. Que
   a veces se queden escondidos un rato (A.quedarse).
4. **Los policías bots casi no piden papeles** (0,1 por ronda): el censo pesa sólo con un policía humano. Darles una
   regla para pedírselos a los sospechosos de la zona de un aviso.
5. **La ocupación de las viviendas**: entre semana de día tiene gente el 55-74 %, de noche ~100 %, el fin de semana
   86-97 %. Si robar casas resulta muy difícil, subir el empleo o el informal (SOCIEDAD).
6. **De ladrón, el retrato se difunde solo a los 45 s** (no hay un policía que decida): con multijugador lo decide el
   policía.
7. **Cambiarse de ropa frente a una cámara** está permitido; la regla dice que no.
8. **El equilibrio** (meta 8 por ladrón): los ladrones ganan 38/57/53/63 % con 2/3/5/8 por equipo; con 8 por equipo
   se inclina a los ladrones.

## Movimiento y objetos

1. **El paso de la animación contra la velocidad** (patinan los pies): calibrar la zancada de moveCharacter con los
   pasos de CAMINAR (1,0-1,65 m/s).
2. **La gente aparece y desaparece en las puertas**: falta la animación de entrar y salir, y que la puerta se abra
   para ella.
3. **Adentro todos están de pie**: sentarlos en las sillas y escritorios de su cuarto (ya existe sentarse en
   acciones3d) y que el empleado atienda detrás del mostrador.
4. **Los vendedores de esquina** están quietos en un punto: darles un puesto (un carrito o una mesa) y gente que
   compra.
5. **La patrulla**: velocidad máxima 16 m/s, giro 0,55, freno 11; calibrarlos manejando. Se sube a la vereda (el
   cordón es bajo), y con el tránsito sólo frena, no choca.
6. **Los saltos entre techos**: con la mansarda ya arreglada, revisar los otros techos (pretiles, casetas, cornisas)
   con validar-salto sobre más ciudades (hoy, 4 pares de la ciudad 1).
7. **El dron sobre las casas del monte** usa un alto supuesto de 7 m (casas3d no dice su alto).
8. **La noche automática** pisa la tecla N cuando cambia la hora (de 19 a 6).
9. **Los niños** son la misma plantilla achicada: proporciones de niño (cabeza más grande, piernas cortas).

## La rutina (2026-10-18)

1. **Metas de verdad**: reemplazar las metas provisorias (scripts/datos/objetivos-rutina.json) por las de la ENUT del
   DANE y volver a calibrar.
2. **Eventos desde el juego**: un robo, un trancón o un local cerrado en el 3D tienen que volver a planear el resto del
   día de la gente que alcanzan (rutina.js, desde la hora del evento), no sólo en la prueba.
3. **El bus en el 3D**: la gente esperando en el paradero y subiendo y bajando de un bus que pase a su hora (hoy el
   tránsito tiene buses decorativos, sin horario).
4. **El mercado del fin de semana** queda bajo (la tienda no abre el domingo): revisar los horarios o el peso de la
   despensa.
5. **El calibrador**: guardar cada corrida con su fecha (hoy se pisa el archivo), y una vista web que compare las curvas
   de hoy, las calibradas y las metas.
