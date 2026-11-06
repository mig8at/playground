---
name: navegador
description: Manejar un navegador real con bin/navegador para hacer o aprender algo en una herramienta compleja (un panel admin, un backoffice) y dejarlo como flujo reproducible (navegador/flujos) y script de Playwright. Usala cuando Miguel pida «usá el navegador para…», «entrá a esta página y…», «enseñame cómo se hace X en…», «armá el flujo de…», o cuando haya que practicar en las apps locales (navegador/apps, Panel Andino :5206). No es para el wizard de CreditOp con datos de dominio: eso es el harness.
---

# navegador · cumplir una meta en una página

`bin/navegador` maneja la sesión EN VIVO de `make navegador` (la API en :5203 tiene que estar arriba): lo que se
hace por consola se ve en el editor de la interfaz y queda como pasos de Playwright.

**El ciclo, los comandos y las reglas son los de [`navegador/cli/ask.md`](../../../navegador/cli/ask.md)** —leelo
antes de empezar: es el mismo texto que recibe `bin/navegador ask`. En corto: `look` para ver los elementos
numerados con su localizador y sus avisos, UNA acción por vez, verificar con `text`/`wait`/`shot`, y terminar
con LISTO / NO PUDE / NECESITO / CONFIRMAR.

## Cuándo usar qué
- **Lo hace Claude en esta conversación** (lo normal): seguí ask.md con `bin/navegador …` desde Bash, a la vista de
  Miguel en el panel de la interfaz:
  1. `bin/navegador empezar --url <url de la app> '<la meta>'` abre la sesión en el panel (y el navegador).
  2. Antes de cada acción, `bin/navegador pienso '<por qué, en una línea>'`: es lo que Miguel lee en el panel y
     el subtítulo del paso en el video del flujo. Cada comando aparece solo en el panel.
  3. `bin/navegador terminar 'LISTO: …'` (o `NO PUDE: …`): guarda la corrida y, con LISTO, el flujo en
     `navegador/flujos/<proyecto>/`.
  `bin/navegador script` da el recorrido como prueba de Playwright.
- **Varias cosas en paralelo: pestañas.** Cada una es una sesión aparte (su página, sus pasos, su flujo).
  `empezar` abre una nueva si en la actual ya trabaja otro Claude y dice su número; desde ahí, cada comando de esa
  meta va con `--sesion N` (si no, cae en la última que se abrió, que puede ser otra). `bin/navegador pestanas`
  las lista; `pestanas nueva [url]` abre una (con la página, p. ej. una app de tu localhost) y `pestanas cerrar N` cierra una. Dos pestañas del mismo sitio comparten el login.
- **Que te enseñe:** `bin/navegador ask --guia [--url U] "<meta>"` (o «Enseñame» en la interfaz): Claude marca
  cada paso en la página en vivo y Miguel lo hace. Sin `--guia` es automático: lo hace Claude y sólo frena antes
  de algo irreversible (eliminar, desactivar, pagar, enviar); el CLI niega ese clic sin el sí.
- **Lo que termina en LISTO queda como flujo** en `navegador/flujos/<app>/` (o desde la interfaz, «Guardar como
  flujo» sobre una corrida): se reproduce sin Claude, con sus datos precargados o abiertos.
- **Que lo haga otro Claude, desde la terminal de Miguel:** `bin/navegador ask [--url U] "<meta>"` lanza
  Claude Code en modo `-p` desde una carpeta neutra, con permiso sólo para el navegador. Necesita que el Claude
  Code de consola tenga sesión propia (`claude setup-token`); si no, lo dice.

## Para practicar
Las apps de `navegador/apps/` (cada una con su `app.json`; `make navegador` las levanta). Panel Andino
(http://127.0.0.1:5206/?restaurar) es un admin de tienda ficticio, tratado como sitio REAL: medios de pago (con
una app en iframe donde está el ID de pruebas), envíos, impuestos y usuarios. `?restaurar` lo deja como nuevo.

## Lo que ya se sabe que pasa
- Un `confirm()`/`alert()` se acepta por defecto y se informa (`dialog dismiss` para rechazar).
- Un elemento [deshabilitado] o [detrás del modal] se niega al instante con la causa: resolvé eso primero.
- Lo que no es un elemento (un texto con doble clic) se alcanza por su texto: `dblclick "…"`.
- Contra prod, sólo mirar. Nunca contraseñas reales ni datos de clientes: el login lo hace Miguel a mano en la
  página en vivo de la interfaz (el perfil de Chromium lo guarda).
