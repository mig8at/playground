style(CORE-845): el formulario dinámico se acerca al diseño de Figma, con un CSS que se quita fácil

## Qué cambia

El formulario dinámico del wizard («Completa tu solicitud») no se veía como el diseño de Figma. Se agrega un CSS aparte, `app/css/dynamic-form-figma.css`, que sólo cambia estilos:

- **Rótulos:** semibold y sin el asterisco rojo (el diseño no lo usa). Esto aplica a **todos** los formularios dinámicos: ninguno marca los obligatorios con «*». La validación sigue igual y avisa al continuar.
- **Cajas de texto y listas:** 48 px de alto, con bordes de 12 px.
- **Subtítulo de la sección:** 15 px.
- **Preguntas de dos opciones (Sí / No):** van en una tarjeta blanca, con las opciones en una sola fila. La opción marcada es un aro grueso del color principal, en vez del chulo. Una opción larga baja de línea en vez de desbordar.

No cambia ningún componente, validación ni dato. Todo cuelga del atributo `data-figma-form`, que se pone en el contenedor de la ruta `routes/dynamic-form.tsx`.

**Para quitarlo**, si no encaja en otros flujos, se borran dos líneas de esa ruta: el import del CSS y el atributo.

Es un atributo y no una clase porque el lint de diseño (`no-unknown-classes`) sólo acepta clases que Tailwind conoce.

Aplica a todos los formularios dinámicos. La tarjeta y la fila son sólo para las preguntas de dos opciones; una con más opciones se queda como estaba.

Es otro PR que el #1515 (base `main`, también de CORE-845), que corrige la garantía de la originación delegada en `lenders-marketplace`: no se tocan.

## Cómo se probó

En el wizard local a 430 px de ancho, con el formulario de Finandina (residencia, actividad, empresa y las dos preguntas PEP con sus datos de vinculación). Se comparó contra las pantallas de Figma de información laboral y declaraciones. Con el atributo puesto, el estilo calculado da:

- rótulo: `font-weight` 600;
- caja: `border-radius` 12px y 48 px de alto.

No aparecieron errores nuevos en consola.

Lo que el CSS no alcanza (es texto o estructura, no estilo):

- la ayuda gris bajo una pregunta de opciones, que ese campo no pinta;
- el «*» dentro de los selectores de fecha;
- el orden de los datos de la vinculación PEP, que van debajo de cada pregunta.
