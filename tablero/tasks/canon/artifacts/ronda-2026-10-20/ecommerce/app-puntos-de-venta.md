**La App sólo recibe la posición de un punto de venta confirmado, con la misma dirección que se confirmó y con la caché vigente.** El mapa de puntos de venta del cliente lista los de los comercios que ese cliente ve en su catálogo, con el punto de venta y el comercio activos, visibles en la App y con al menos una entidad CreditopX prendida en el punto de venta, de tipo 2 o de cupo rotativo (tipo 3). Las sucursales sin ciudad real quedan fuera.

Cada punto de venta sale con su nombre, dirección, ciudad, tipo y contactos públicos. La App acepta además un tercer tipo, «ambos», que el panel y el backend todavía no permiten guardar: hoy sólo llega físico o venta asistida. El lugar y las coordenadas se agregan sólo si se cumplen todas estas condiciones:

- alguien confirmó la ubicación, y la versión vigente del historial también está confirmada;
- el lugar guardado en el punto de venta es el de esa versión;
- la dirección actual es la misma que se consultó, y el país coincide;
- la caché todavía tiene las coordenadas.

Si falla alguna, el punto de venta aparece sin posición. Por eso, cuando la caché vence, la App deja de poder ordenarlo por cercanía hasta que se vuelva a resolver.

Cambiar la dirección rompe la coincidencia. El panel nuevo, al guardar otra dirección, además retira la confirmación. El admin viejo guarda la dirección sin tocar la confirmación, pero igual deja al punto de venta sin posición para la App.
