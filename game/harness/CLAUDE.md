# harness del juego · reglas de trabajo

El cómo se usa está en `README.md`; acá van las reglas.

- **Las tomas son del juego de verdad.** La cámara, la luz de relleno y la exposición se ponen para la toma; el juego no
  se toca para que la toma salga (si algo del juego se ve mal, se arregla en el juego).
- **Una toma nueva** es un archivo en `promo/tomas/` con `// TOMA · título — qué es…` en la primera línea y
  `// SALE: a, b` (sus carpetas en `.work/tomas`): aparece sola en el panel.
- **Un video nuevo** es un `promo/videos/<video>.json`; el código no cambia. Los cortes apuntan a cuadros de las tomas:
  antes de elegirlos, mirar la hoja de contacto de la toma en el panel.
- **Cada cámara se dibuja justo antes de su captura.** Con varias cámaras por cuadro, capturar después del dibujo del
  juego devolvía la imagen de la cámara anterior (pasó con la persecución: `frente` salía igual a `cara`).
- **Antes de dar una toma por buena, mirar su hoja**, no el registro: en la persecución, los números decían que todo
  estaba bien y las tres cámaras mostraban lo mismo.
- **Lo grabado no va en git** (`promo/.work/`, `promo/out/`).
- El servidor del juego lo enciende el panel aparte (sigue si el panel se cierra).
- **Las pruebas viven en `pruebas/`** (se movieron de `game/scripts/` el 2026-10-30): importan el motor con
  `../../src/…` (y los experimentos con `../../../src/…`). Una prueba nueva entra en `NIVELES` de `pruebas/probar.mjs` y
  aparece sola en el panel.
- **Los ganchos de prueba del juego no se sacan** (`window.__demo`, `?lab=1`, `?prueba=edificio`): los usan el nivel 10
  y las tomas; sólo existen en desarrollo.
