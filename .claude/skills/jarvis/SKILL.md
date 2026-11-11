---
name: jarvis
description: Jarvis — manejar el Chrome de Miguel con bin/jarvis (la extensión Jarvis) para hacer o aprender algo en una herramienta compleja (un panel admin, un backoffice) y dejarlo como flujo reproducible (jarvis/flows) y script de Playwright. Usala cuando Miguel pida «usá Jarvis…», «usá el navegador para…», «hacelo en mi Chrome», «entrá a esta página y…», «enseñame cómo se hace X en…», «armá el flujo de…», o cuando haya que practicar en las apps locales (jarvis/apps, Panel Andino :5206). No es para el wizard de CreditOp con datos de dominio: eso es el harness.
---

# Jarvis · cumplir una meta en una página

`bin/jarvis` maneja la sesión EN VIVO de `make jarvis` (la API en :5203 tiene que estar arriba): lo que se
hace por consola se ve en el editor de la interfaz y queda como pasos de Playwright.

**El ciclo, los comandos y las reglas son los de [`jarvis/cli/ask.md`](../../../jarvis/cli/ask.md)** —leelo
antes de empezar: es el mismo texto que recibe `bin/jarvis ask`. En corto: `look` para ver los elementos
numerados con su localizador y sus avisos, UNA acción por vez, verificar con `text`/`wait`/`shot`, y terminar
con LISTO / NO PUDE / NECESITO / CONFIRMAR.

## Cuándo usar qué
- **Lo hace Claude en esta conversación** (lo normal): seguí ask.md con `bin/jarvis …` desde Bash, a la vista de
  Miguel en el panel de la interfaz:
  1. `bin/jarvis start --url <url de la app> '<la meta>'` abre la sesión en el panel (y el navegador).
  2. Antes de cada acción, `bin/jarvis think '<por qué, en una línea>'`: es lo que Miguel lee en el panel y
     el subtítulo del paso en el video del flujo. Cada comando aparece solo en el panel.
  3. `bin/jarvis finish 'LISTO: …'` (o `NO PUDE: …`): guarda la corrida y, con LISTO, el flujo en
     `jarvis/flows/<proyecto>/`.
  `bin/jarvis script` da el recorrido como prueba de Playwright.
- **Varias cosas en paralelo: pestañas.** Cada una es una sesión aparte (su página, sus pasos, su flujo).
  `start` abre una nueva si en la actual ya trabaja otro Claude y dice su número; desde ahí, cada comando de esa
  meta va con `--session N` (si no, cae en la última que se abrió, que puede ser otra). `bin/jarvis tabs`
  las lista; `tabs nueva [url]` abre una (con la página, p. ej. una app de tu localhost) y `tabs cerrar N` cierra una. Dos pestañas del mismo sitio comparten el login.
- **Que te enseñe:** `bin/jarvis ask --guide [--url U] "<meta>"` (o «Enseñame» en la interfaz): Claude marca
  cada paso en la página en vivo y Miguel lo hace. Sin `--guide` es automático: lo hace Claude y sólo frena antes
  de algo irreversible (eliminar, desactivar, pagar, enviar); el CLI niega ese clic sin el sí.
- **Lo que termina en LISTO queda como flujo** en `jarvis/flows/<app>/` (o desde la interfaz, «Guardar como
  flujo» sobre una corrida): se reproduce sin Claude, con sus datos precargados o abiertos.
- **Que lo haga otro Claude, desde la terminal de Miguel:** `bin/jarvis ask [--url U] "<meta>"` lanza
  Claude Code en modo `-p` desde una carpeta neutra, con permiso sólo para el navegador. Necesita que el Claude
  Code de consola tenga sesión propia (`claude setup-token`); si no, lo dice.

- **Corre SÓLO en el Chrome de Miguel** (la extensión Jarvis; el Chromium se sacó el 2026-11-07): `start` y `open`
  abren una pestaña real de su Chrome (grupo «Jarvis»), con su login, así Cloudflare no frena. `bin/jarvis chrome`
  dice si está conectada; si no, no se abre nada (que abra Chrome o recargue la extensión). Para ver un sitio como en
  un teléfono, `bin/jarvis ua iphone`. Sólo toca las pestañas que él comparte desde la pestaña Jarvis y las que abre
  Claude. Un captcha lo resuelve él.

- **Una tarea de una herramienta, de una vez** (crear un producto en VTEX, …): primero mirá si hay **receta**
  (`jarvis/recipes/README.md`, `make jarvis-recipe`). Si hay que hacerla por pantalla, el **mapa** de la herramienta
  (`make jarvis-map APP=vtex`) dice dónde está cada campo y botón: usá sus localizadores en vez de buscar con `look`.
  Al pasar por una pantalla nueva, guardala en el mapa (`A=save SCREEN=…`).
- **Cualquier caso del harness en su Chrome, en LOCAL** (lo preferido: sin qa ni copias de comercios):
  `make jarvis-walk CASES='#13874eb6:77' FLOW=ecommerce` (CrediPullman por la tienda). Mismas variables que
  `harness-walk-wizard`; `HANDS=1` para que él toque los botones. Canal de asesor con dos pestañas (asesor y
  cliente): `FLOW=merchant ASESOR=c036610aa-fake@creditop.com` (la sesión de prueba de Amoblando Pullman).
- **Una compra VTEX entera, sola, en su Chrome**: `make jarvis-vtex-purchase TARGET=qa` (≈3 min, hasta el crédito en 11
  y VTEX aprobado). Con `HANDS=1` el motor rellena y él toca cada botón (marcado en violeta). Para flujos largos de
  Creditop éste es el camino, no `start` + `look`/`act`, que es para herramientas que el harness no conoce.

## Para practicar
Las apps de `jarvis/apps/` (cada una con su `app.json`; `make jarvis` las levanta). Panel Andino
(http://127.0.0.1:5206/?reset) es un admin de tienda ficticio, tratado como sitio REAL: medios de pago (con
una app en iframe donde está el ID de pruebas), envíos, impuestos y usuarios. `?reset` lo deja como nuevo.

## Lo que ya se sabe que pasa
- Un `confirm()`/`alert()` se acepta por defecto y se informa (`dialog dismiss` para rechazar).
- Un elemento [deshabilitado] o [detrás del modal] se niega al instante con la causa: resolvé eso primero.
- Lo que no es un elemento (un texto con doble clic) se alcanza por su texto: `dblclick "…"`.
- Contra prod, sólo mirar. Nunca contraseñas reales ni datos de clientes: el login lo hace Miguel a mano en la
  página en vivo, en su Chrome.
