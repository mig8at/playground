---
id: 89
clase: proyecto
title: "Un solo lenguaje visual para las herramientas del playground"
stage: work
created: "2026-09-18T21:05:00-05:00"
context_nodes: []
jira: []
jira_title: ""
ramas: []
---

## Para qué sirve, en una línea

Las cuatro UIs del playground se ven y se leen igual, y cambiarles el aspecto cuesta reemplazar un
archivo — no tocar cuatro.

## Si retomás esto sin contexto, empezá acá

`context` (:5193), `harness/panel` (:5195), `tablero` (:5191) y `trazador` (:5192) tenían cuatro
paletas escritas a mano y **cuatro nombres para el mismo concepto**: el texto apagado era `--dim`,
`--mut` y `--mut`; el acento `--accent`, `--acc` y `--acc`; el rojo `--fail`, `--bad` y `--danger`.
No había forma de cambiarles el aspecto sin tocar las cuatro, y no había forma de leer una sabiendo la
otra.

Hoy comparten **dos archivos idénticos**, y la identidad se verifica (no se confía):

- **`tema.css`** — el COLOR. Un export de [tweakcn](https://tweakcn.com/) tal cual; se reemplaza
  entero con `make estilo-tema DE=<archivo>`, que lo reparte a las cuatro.
- **`taller.css`** — la ESTRUCTURA. Las regiones con los nombres de VS Code (`titlebar`,
  `activitybar`, `sidebar`, `editor`, `panel`, `auxiliarybar`, `statusbar`, `region-head`,
  `region-body`, `view`), sus medidas y el contrato de scroll.

Al lado, cada herramienta tiene su hoja con el PUENTE (sus nombres viejos apuntando a los tokens) y lo
semántico. `make estilo-check` compara los md5, prohíbe las mezclas `in oklch`, mide contraste, caza
variables usadas sin declarar y lista qué región usa cada una.

El detalle vive en el `CLAUDE.md` raíz, §«Las cuatro UIs comparten UN tema» y §«Y cómo se DIVIDE la
pantalla».

## Objetivo

Que una herramienta nueva del playground arranque copiando dos archivos, y que un cambio de aspecto
sea reemplazar uno — no una tarde de sincronizar cuatro.

## Dónde se toca

- `tools/estilo.py` + `make estilo-check` · `make estilo-tema`
- `{context,tablero,trazador}/src/{tema,taller}.css` · `harness/panel/{tema,taller}.css`
- la hoja propia de cada herramienta (el puente y lo semántico)
- `tablero/src/` — es la que más lejos llegó: workbench completo

## Cómo se ataca

**Adoptar una región es SOLTARLE a la herramienta lo que la regla compartida ya dice**, no ponerle una
clase encima. Si el nombre no cambia nada, es el que alguien borra el mes que viene. Y al revés: una
región existe cuando tiene contenido propio Y scroll propio — un `activitybar` vacío porque «está en
la lista» es peor que no tenerlo.

## Lo que se evaluó y NO se eligió

- **un paquete npm compartido para los estilos** — descartado por pedido explícito: cada proyecto
  tiene su copia y `estilo-check` garantiza que no deriven;
- **etiquetar el mapa del trazador como `.editor`** — probado y revertido: su regla propia ya decía
  todo, y lo único que sumaba era un `display:flex` que no tenía;
- **convertir los ocho `<details>` del panel del harness a `.view`** — sería cambiar algo que anda
  sin JS por algo que lo necesita. `.view` es para vistas que se REPARTEN el alto de una región fija.

## Lo que está decidido

- el color semántico (verde=bien, rojo=roto, los carriles, el semáforo) va AFUERA de `tema.css`: un
  export no lo trae y pegar uno nuevo lo borraría;
- los tintes se mezclan `in oklab`, nunca `in oklch`;
- el acordeón del sidebar derecho del tablero es exclusivo; el del izquierdo no.

## Riesgos

- el par `destructive`/`destructive-foreground` del tema mide **3,35:1** (lo reporta `estilo-check`).
  Es del tema, no del cableado: la palanca está en `tema.css`;
- el tablero quedó muy por delante de las otras tres. `context` y `trazador` usan el vocabulario a
  medias, y el panel del harness no tiene bundler (sin Tailwind, sólo los tokens por `<link>`).

## Lo que NO entra

- rehacer `context` ni `trazador` como workbench: son vistas de lectura y está bien así;
- arrastrar para reordenar las pestañas del editor del tablero, y `Ctrl+W` (lo captura el navegador).

## Cómo se comprueba

```bash
make estilo-check          # md5 de los dos compartidos · oklch · contraste · variables · regiones
cd tablero && npm run build && node --test tests/*.test.js
```

Y mirándolo: `make tablero` · `make trazador` · `make context` · `make panel`.

**El próximo paso es:** decidir si la ficha del tablero arranca plegada abajo de ~1100px — hoy el
editor nace en 287px en una ventana de 927, porque los anchos por defecto no miran la ventana.

## Pendientes

- [ ] el editor del tablero arranca en 287px con la ventana en 927 — los *defaults* (300+340) no miran
      la ventana, sólo el arrastre. Decidir si la ficha arranca plegada abajo de ~1100px
- [ ] `context` y `trazador` usan el vocabulario a medias: `context` finge el contrato de scroll con
      dos `max-height: 82vh` y `trazador` sólo declara `auxiliarybar`
- [ ] barrer «tarjeta» en `tablero/CLAUDE.md`: quedó la tabla de regiones y la traducción arriba, pero
      el texto viejo sigue nombrando la grilla que ya no existe

## Registro

### 2026-09-18 · el estándar, de punta a punta

> **MEDICIÓN · 2026-09-18** — un mismo concepto tenía CUATRO nombres entre las cuatro herramientas
> (texto apagado: `--dim`/`--mut`; acento: `--accent`/`--acc`; rojo: `--fail`/`--bad`/`--danger`).
> ```
> grep -rhoE 'var\(--[a-z0-9-]+' <tool>/src --include='*.vue' --include='*.css' | sort | uniq -c
> ```

Salió del restyle del trazador y terminó siendo el estándar de las cuatro. **Catorce commits**, de
`b9336a0` a `788293d`.

Cuatro trampas medidas, las cuatro silenciosas (ninguna hace fallar nada):

1. **`color-mix` `in oklch` tiñe de rojo.** Los neutros de tweakcn son `oklch(L 0 0)` —hue 0, que es
   el rojo— y en un espacio polar el mix interpola ese hue: verde 20% sobre la card daba **#4d3530**
   donde `in oklab` da **#2d4132**. Pasa con los cuatro colores. `estilo-check` lo frena.
2. **Una variable sin declarar hace que el navegador tire la declaración ENTERA, sin decir nada.**
   `scorecards/` del tablero usaba diez nombres de otra paleta: **60 declaraciones muertas**, o sea esa
   vista venía sin superficies, sin bordes y sin semáforo. Se ve como un diseño feo, no como un error.
3. **El panel del harness tenía TRES `:root`**, cada restyle apilando el suyo al final. Funcionaba por
   «gana el último» pero no coincidían: `--bg` era #09090b y #000, `--acc` verde y casi blanco.
4. **La rampa de texto no puede colgar de `--muted-foreground`**: en este tema es #808080, que ya mide
   4,4:1 contra el fondo — es el escalón MÁS BAJO legible, no el del medio. Colgando de él, el tercero
   daba 2,8:1 y los rótulos de 10,5px del mapa quedaban ilegibles.

Y una que no es de estilos: el escáner de dependencias de Vite saca el `<script>` del `.vue` con una
regex de HTML, así que el `'<!--'` de `App.vue` se comía trece líneas y tiraba *Unterminated string
literal* en una línea correcta. Escapado como `\x3C!--`.

**El tablero fue de página con cajón a workbench completo**: árbol de tareas en el sidebar, la tarea en
el editor, pestañas con previsualización (recorrer 35 tareas deja UNA pestaña, no 35), la ficha y las
siete vistas en el acordeón derecho, y los dos sidebars arrastrables con el tope calculado contra la
ventana — sin eso, la ficha en 463px dejaba el editor en **164px**.

⚠ Y una de método, para mí: cuatro veces corté markup a mitad de bloque moviéndolo por rango de
líneas. Las cuatro las cazó el build. **Un rango corta donde el rango dice, no donde el bloque
termina** — la próxima, parser.
