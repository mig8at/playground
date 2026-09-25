# UI compartida de CreditOp

Fuente común para `context`, `tablero`, `trazador` y `harness/panel`. Inspirada en la composición de [shadcn/ui](https://ui.shadcn.com/docs/components/button) y la [disposición personalizable de VS Code](https://code.visualstudio.com/docs/configure/custom-layout), adaptada a Vue y HTML nativo.

**No añadimos titlebar ni banners globales.** Las acciones se ubican en el toolbar de la región a la que pertenecen. Los avisos aparecen junto a la operación relevante. No se crea una consola donde no hay salida que seguir.

## Vocabulario

| Nombre | Uso | Herramientas |
| --- | --- | --- |
| `sidebar` | Navegación, árbol o lista | Context, Tablero, Harness; persona en Trazador |
| `editor` | Contenido principal | Documento, tarea, mapa o recorrido |
| `toolbar` | Grupo de acciones dentro del encabezado de una región | Las cuatro |
| `auxiliarybar` | Detalle o propiedades de la selección | Tablero, Harness, Trazador |
| `panel` | Consola inferior: salida que se sigue en el tiempo | Harness (Consola), Tablero (Ramas), Trazador (Recientes) |
| `statusbar` | Estado y controles de disposición | Las cuatro |
| `region-head` | Encabezado fijo, título y acciones | Cualquier región |
| `region-body` | Cuerpo con scroll independiente | Cualquier región |
| `view` / `view-tog` | Vistas en acordeón que se reparten el alto | Sidebars del Tablero |
| `accordion-item` | Sección plegable con `details` / `summary` | Contenido dentro de una región |
| `rsz` | Separador ajustable, enfocable | Entre regiones |

La página no scrollea; cada región sí. Una división usa una línea, no dos marcos. Los encabezados usan mayúscula inicial y la misma jerarquía tipográfica. Las acciones principales conservan texto; las acciones compactas llevan un icono de 16 px con `aria-label` y `title`.

## Fuente y distribución

- `tema.css`: tokens de color, tipografía y radio del tema compartido de ShadcnThemer.
- `taller.css`: regiones, controles, espaciado, foco e iconos vectoriales.
- `workbench.js`: ajuste por puntero y teclado con «mínimo o nada» (`regionSize`, `fitRegions`, `reopenSize`), menús con `bindMenu` y adaptador opcional `vResize` para Vue.
- `RegionMenu.vue`: adaptador Vue del mismo menú usado por el HTML del harness.
- `index.html`: catálogo interactivo que consume estos mismos archivos.

Editar aquí y ejecutar `make estilo-sync`. Las copias locales conservan la independencia de cada aplicación. El harness recibe el módulo incrustado en su HTML; no requiere bundler, una ruta nueva ni reiniciar el servidor. **No editar el bloque generado** entre `workbench-shared`.

`make estilo-check` verifica la fuente canónica, las copias, tokens, contraste estático y estructura. `make estilo-contraste` mide el DOM de las cuatro apps en ejecución. `make estilo-ui` verifica teclado, arrastre, persistencia, acordeones y tres anchos de ventana; el tablero usa datos de prueba y las escrituras de API quedan bloqueadas en ese navegador. `make estilo-tema DE=archivo.css` actualiza tanto la fuente como las cuatro copias.

Para abrir el catálogo: `make estilo-guia`, luego http://127.0.0.1:5198. No requiere los servidores de las herramientas.

## Medidas

| Token | Valores |
| --- | --- |
| `--space-1` … `--space-6` | 4, 8, 12, 16, 20, 24 px |
| `--control-xs/sm/md/lg` | 24, 32, 36, 40 px |
| `--region-head-h` | 40 px mínimo; crece si las acciones envuelven |
| `--statusbar-h` | 30 px |
| `--text-xs/sm/base/body` | 11, 12, 13, 14 px |
| `--icon-size` | 16 px |

El texto secundario usa `--texto-2` y `--texto-3`, medidos sobre las superficies del tema actual. No atenuar filas completas con `opacity`. Los colores semánticos siguen en cada herramienta; no se reemplaza un estado por un gris.

## Disposición y teclado

El pie siempre contiene controles para alternar las regiones visibles. Al reabrir una región recupera la última medida elegida, no una medida “por defecto”. Los anchos y la altura de consola se guardan localmente; no cambian datos de trabajo. Los máximos se ajustan al espacio disponible.

**Mínimo o nada.** Una región que se redimensiona mide 0 o al menos su mínimo (`--sidebar-min` 240, `--panel-min` 124): por debajo se pliega, por cualquier camino —arrastre, teclado, ventana o una medida guardada—. Plegar arrastrando es lo mismo que el botón del pie, y al reabrir vuelve la última medida abierta. Si la ventana no alcanza, `fitRegions` achica las columnas hasta su mínimo, después pliega el sidebar secundario y al final el sidebar; el editor nunca baja de `--editor-min` (360). La herramienta guarda lo que eligió la persona —medida y abierta/plegada— y **deriva** lo que se pinta, así lo plegado por falta de lugar vuelve cuando la ventana crece. `bindResize` pliega por defecto; `collapsible: false` es la excepción y se declara. Una región sin manija que no se redimensiona (un estado vacío fijo) lo declara con `data-size="fixed"`.

En un separador enfocado con Tab: flechas ajustan 16 px, y la que cruza el mínimo pliega; Shift + flecha, 48 px; Home pliega; End amplía; Enter alterna y reabre en la última medida.

`make estilo-minimo` lo verifica: la lógica de `workbench.js` sin navegador (`workbench.test.mjs`) y, en las cuatro apps encendidas, cuatro anchos de ventana y cada paso del teclado sobre cada manija. El arrastre es fluido e inmediato, cancelando limpiamente ante `pointercancel` o pérdida de captura.

## Toolbars y menús

Cada región reserva su toolbar para las acciones frecuentes: copiar, plegar o cerrar. Las opciones secundarias viven en el botón de tres puntos `RegionMenu`. Al abrirlo se ven nombres completos, marcas de selección y conteos; un punto sobre el botón señala opciones activas. Los filtros de consola muestran además «Filtrada». El entorno y canal de una corrida conservan sus valores visibles.

El menú se monta fuera del scroll de la región y se ajusta a la ventana. Se abre con clic, Enter, Espacio o flechas; flechas, Home y End recorren sus acciones. Escape cierra y devuelve el foco al botón. Los checks permanecen abiertos para ajustar varias opciones. Clic fuera, cambio de foco o scroll de la región cierran el menú. Ocultar un panel nunca elimina su control de recuperación en el pie.

En Vue, pasar `items` y manejar `@select`. En HTML, usar `bindMenu(button, { getItems, onSelect, label })`. Cada opción tiene `id`, `label` y opcionalmente `icon`, `disabled`, `count` o `checked`; `{ separador: true }` divide grupos. Ambos adaptadores usan el mismo comportamiento y estilos.

Trazador mantiene su detalle superpuesto al mapa: ajustar su ancho no recalcula el grafo en cada píxel. Tablero conserva sus acordeones y pestañas; los separadores ajustan y los botones del pie ocultan. Harness permite plegar los dos sidebars y la consola. Context permite ampliar el explorador o concentrarse en el documento.

Ejemplo de icono:

```html
<button class="region-action" title="Copiar" aria-label="Copiar">
  <span class="ui-icon" data-icon="copy" aria-hidden="true"></span>
</button>
```

Ejemplo de separador Vue:

```js
import { vResize } from './workbench.js'
const options = {
  label: 'Ancho del explorador', min: 200, max: () => innerWidth - 320,
  defaultValue: 300, get: () => width.value, set: (v) => { width.value = v },
}
```

```html
<div class="rsz" v-resize="options"></div>
```
