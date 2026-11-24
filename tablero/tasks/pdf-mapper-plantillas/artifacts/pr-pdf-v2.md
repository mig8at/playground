## v2 — documentos automáticos desde la referencia de la entidad

> **No mergear todavía.** Es la versión 2 del Studio, para validarla con el equipo. Si sirve, se pasa a `main`; si no,
> la v1 sigue igual.

### Qué cambia

Hoy armar un documento de firma es ubicar a mano cada campo sobre el PDF. En la v2 eso desaparece: se carga la
referencia que mandó la entidad y el Studio arma solo la plantilla y el mapper.

1. **Nuevo documento** (en un proyecto): se carga la referencia en PDF.
2. **Preparación**, que corre sola:
   - valida el PDF;
   - encuentra los campos;
   - arma la plantilla: el PDF original con los marcadores tapados, para que el diseño quede idéntico;
   - arma el mapper con la geometría que usa el servicio para escribir.
3. **Revisión página por página**, en tres vistas:
   - *Datos demo*: cómo quedaría lleno, con aviso de lo que no cabe en su espacio;
   - *Campos*: cada uno con su id;
   - *Plantilla*: vacía.

   A la derecha están los campos de la página y los ids que el catálogo no tiene. Abajo hay una caja para pedir
   cambios sobre esa página (todavía sin conectar).
4. **Guardar**: plantilla, mapper y los ids nuevos en el catálogo (sólo se agregan), en el ambiente elegido.

Lo que reconoce en la referencia:

| En la referencia | Qué campo sale |
|---|---|
| `[Marcador]` | texto |
| un blanco `____` | texto, nombrado por el rótulo que tiene al lado (también en columnas y en fechas partidas en dos renglones) |
| `[ ] Opción` / `( ) Opción` | casilla, agrupada por pregunta |
| una fila modelo `[Tabla.Columna]` | tabla, con las filas contadas en la cuadrícula |
| `[Firma…]` / `[Huella]` | zona de firma, que no es un dato |

El espacio de cada dato llega hasta lo próximo a su derecha (otro texto, la raya de un recuadro o el margen).

**Un documento guardado** se abre en sólo lectura, con «Generar con datos demo» (el PDF lleno por el servicio) y la
descarga de la plantilla y el mapper.

**Ambiente, uno a la vez.** Ahora cada ambiente tiene su VPN, así que se elige en la barra de abajo: Local, Develop o
Producción. Cada uno muestra su color, si contesta y qué VPN le falta. Todo se lee y se escribe sólo ahí. Pasar a
producción pide confirmación, y guardar fuera de local también.

**Se quita** el editor manual:
- ubicar campos, guías, tablas a mano y deshacer;
- importar y «Sincronizar» (que escribía en develop y producción a la vez);
- las copias locales en el navegador: el servicio es la única fuente de verdad.

### Para ubicar campos con Claude

`skills/pdf-template/` trae dos herramientas en las coordenadas del mapper:
- `layout.py` da el plano de una página: renglones, rayas y lugares donde va un dato, con la geometría lista.
- `grid.py` dibuja la página con una cuadrícula numerada y el mapper encima.

### Cómo se probó

Contra un `pdf-mapper-service` local, con el catálogo de develop copiado. Se usaron tres referencias de prueba armadas a
propósito (entidad ficticia: un formulario por recuadros, un plan de pagos y un pagaré) y los T&C reales de una
entidad. Las tres de prueba se guardaron y se generaron con el servicio:

| Documento | Detectado | Generado con datos de ejemplo |
|---|---|---|
| Formulario de vinculación (2 páginas) | 34 de texto, 9 grupos de casillas, 2 zonas de firma | cada dato en su recuadro, la X dentro de cada casilla, el id nuevo agregado al catálogo |
| Plan de pagos | 9 de texto y la tabla `payment_plan` (8 columnas del catálogo y 1 nueva, 12 filas) | la tabla con sus 12 filas |
| Pagaré | 24 blancos nombrados por su rótulo, 1 casilla | los 25 blancos llenos, también los de las dos firmas |
| T&C reales (4 páginas) | 19 campos, los mismos del mapa hecho a mano | — (no se guardó) |

`npm run build` pasa.

### Lo que no entra

- Word: no hay conversión a PDF todavía (la preparación lo dice y se detiene).
- La caja de cada página no habla con Claude todavía.
- Una raya de firma dibujada como línea, no con `____`, no se reconoce como zona de firma.
- Un marcador que en la referencia ya se sale de su recuadro deja un espacio donde el dato no cabe: se avisa en la
  revisión, no se corrige solo.

### Ojo al validar

- Los documentos de la v1 no se tocan: se ven en sólo lectura. Lo que alguien tenga guardado sólo en su navegador (sin
  sincronizar) no aparece en la v2.
- Guardar escribe en el servicio del ambiente elegido: para probar, Local o Develop.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
