---
name: navegador
description: Manejar un navegador real con bin/navegador para cumplir una meta en una página (llenar un formulario, llegar a una pantalla, verificar un texto, reproducir un bug) y dejar el recorrido como script de Playwright. Usala cuando Miguel pida «usá el navegador para…», «entrá a esta página y…», «armá la prueba de Playwright de…», o cuando haya que probar Credidemo (:5204) o el laboratorio. No es para el wizard de CreditOp con datos de dominio: eso es el harness.
---

# navegador · cumplir una meta en una página

`bin/navegador` maneja la sesión EN VIVO de `make navegador` (la API en :5203 tiene que estar arriba): lo que se
hace por consola se ve en el editor de la interfaz y queda como pasos de Playwright.

**El ciclo, los comandos y las reglas son los de [`navegador/cli/ask.md`](../../../navegador/cli/ask.md)** —leelo
antes de empezar: es el mismo texto que recibe `bin/navegador ask`. En corto: `look` para ver los elementos
numerados con su localizador y sus avisos, UNA acción por vez, verificar con `text`/`wait`/`shot`, y terminar
con LISTO / NO PUDE / NECESITO / CONFIRMAR.

## Cuándo usar qué
- **Lo hace Claude en esta conversación:** seguí ask.md con `bin/navegador …` desde Bash. Al final,
  `bin/navegador script` da el recorrido como prueba de Playwright.
- **Que lo haga otro Claude, desde la terminal de Miguel:** `bin/navegador ask [--url U] "<meta>"` lanza
  Claude Code en modo `-p` desde una carpeta neutra, con permiso sólo para el navegador. Necesita que el Claude
  Code de consola tenga sesión propia (`claude setup-token`); si no, lo dice.

## Para practicar
Credidemo (http://127.0.0.1:5204, `navegador/demo`) es nuestro: una solicitud de crédito con reglas (formulario
que habilita, términos que hay que bajar, oferta que tarda, OTP de prueba, login) y un laboratorio (`/lab/`:
tienda con confirm(), tareas SPA, admin, reservas, widgets con iframe, Shadow DOM, hover, archivo, arrastrar).
Ahí se pueden inventar datos de prueba; las credenciales de prueba están en `navegador/demo/credenciales.json`.

## Lo que ya se sabe que pasa
- Un `confirm()`/`alert()` se acepta por defecto y se informa (`dialog dismiss` para rechazar).
- Un elemento [deshabilitado] o [detrás del modal] se niega al instante con la causa: resolvé eso primero.
- Lo que no es un elemento (un texto con doble clic) se alcanza por su texto: `dblclick "…"`.
- Contra prod, sólo mirar. Nunca contraseñas reales ni datos de clientes: el login lo hace Miguel a mano en la
  ventana (`make navegador` › Abrir la ventana).
