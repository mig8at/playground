# harness · las pruebas, la promo y el panel del juego

Como el harness de LocalMart (`apps/localmart/harness`), para FUGA: las **pruebas** (el probador por niveles y sus
validadores, que antes vivían en `game/scripts/`), la **promo** —videos hechos con tomas grabadas del juego de verdad— y
un **panel visual** para las dos. Sin dependencias: Node, el Chromium de la caché de Playwright y `ffmpeg`.

## Arranque

```bash
cd my-tools/game/harness
npm run panel
```

Abre http://localhost:5197. Si el servidor del juego (`http://127.0.0.1:5181`) no está encendido, la barra de abajo lo
dice y **Encender el juego** lo enciende (`npm run dev -- --port 5181` en `game/`, aparte del panel).

## El panel

- **A la izquierda**, el árbol de Promo: **Videos** (cada uno con su punto verde si ya está armado), **Tomas** (verde si
  están todas grabadas), **Banda sonora** y **Textos** (de cada video).
- **Arriba**, la banda: las acciones de la página (Armar, Grabar, Generar) y el trabajo que corre, con **Detener**.
- **Al centro**, la página: el video con su reproductor y sus escenas y textos; cada toma en hojas de contacto (24 cuadros
  repartidos) y, mientras se graba, **en vivo**; la banda con su reproductor; los textos sobre fondo de cuadros.
- **Abajo**, la consola (Ctrl+J) y la barra de estado. Ctrl+B pliega las secciones. Un trabajo a la vez.

Las rutas: `/promo/videos/<video>`, `/promo/tomas/<toma>`, `/promo/banda`, `/promo/textos/<video>` (atrás y adelante
funcionan).

## Las pruebas (`pruebas/`)

El método del juego: **todo se prueba en el 2D**, por niveles, de lo más grande a lo más chico (0 medidas … 10 pantalla);
si un nivel falla, los de abajo no se corren. En el panel, **Pruebas → Probador**: Rápido (1 ciudad, sin las lentas: el
del día a día), Completo (4 ciudades, todas) o un nivel; cada prueba con su resultado, lo que midió y su peor caso, en
vivo. El último resultado de cada una queda en `promo/.work/pruebas-ultima.json`.

Desde la terminal (en `game/`): `node harness/pruebas/probar.mjs [--rapido] [--nivel=3-5] [--seguir]`, el calibrador
`node harness/pruebas/calibrar.mjs <experimento>` y `node harness/pruebas/ver-fachadas.mjs`. `--lista` y `--eventos` son
para el panel (la lista de niveles en JSON y una línea `PRUEBA {json}` al terminar cada prueba).

## La promo (`promo/`)

| | qué es |
|---|---|
| `videos/<video>.json` | **un video**: sus escenas con sus cortes (de qué toma, desde qué cuadro, cuántos, con qué color) y sus textos con sus tiempos. Para otro video, otro archivo |
| `tomas/<toma>.mjs` | **una toma**: juega el juego con la cámara de cine y guarda los cuadros (`.work/tomas/<salida>/`). La primera línea (`// TOMA · título — qué es`) y `// SALE: …` las lee el panel |
| `textos.mjs` + `textos.html` | los textos de un video en PNG transparentes, con las letras del juego (Bungee y Rubik) |
| `audio.mjs` | la banda sonora del tráiler, sintetizada (sin música con derechos) |
| `montaje.mjs` | arma `out/<video>.mp4`: los cortes con su color, los textos con sus fundidos y la banda |
| `rutas.mjs` | dónde queda cada cosa |

`.work/` (lo grabado) y `out/` (los videos) no van en git: se rehacen con el panel.

Desde la terminal: `node promo/tomas/persecucion.mjs`, `node promo/textos.mjs trailer`, `node promo/audio.mjs`,
`node promo/montaje.mjs trailer`.

### Las tomas

- `ciudad`: la ciudad de noche (el vuelo, un auto, el giro alrededor de un edificio).
- `persecucion`: una persecución **real** de la ronda de la ciudad 2 (el policía bot tras el ladrón bot, del segundo 134
  al 182 de juego), desde tres cámaras a la vez: `frente`, `tras` y `cara`. Es determinista: sale siempre la misma. El
  cuadro *f* es el segundo 128 + *f*/30 (`T0=`, `T1=` la cambian).
- `mecanicas`: de día, en el edificio de prueba, jugadas con las teclas (W, Shift, E): la puerta con E y la vista
  cenital, el ascensor, la azotea y una vuelta sobre el piso cortado (`SOLO=<una>`).

## El arnés (`lib/arnes.mjs`)

El juego en un Chromium **sin ventana con la tarjeta de video** (Vulkan: ~0,06 s por cuadro a 1920×1080; por software,
~1,2 s) y un **reloj controlado**: `performance.now` y `requestAnimationFrame` avanzan 1/30 s por cuadro, así el
movimiento sale fluido aunque el dibujo tarde. La cámara de cine es `window.__cam(camara, d)`, que corre antes de cada
dibujado; `window.__norender` adelanta la partida sin dibujar. Cada cuadro se **dibuja de nuevo justo antes de
capturarlo** (el del juego no siempre llega a la captura).
