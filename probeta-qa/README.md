# Probeta-qa

Las pruebas a mano del wizard **en qa**, en una extensión de Chrome que se puede compartir con el equipo: no usa el harness
ni las claves de my-tools. Es hermana de Probeta (`harness/extension`), que sigue siendo la de Miguel y habla con el panel
del harness.

## Qué hace sola

| parte | cómo | qué necesita |
|---|---|---|
| persona nueva | se inventa en el navegador: cédula `109…`, celular `31…`, dos nombres y dos apellidos, correo `ext.prueba+<cédula>@creditop.com` | nada |
| dictar las centrales | al lambda de mocks de qa (`bureaus.js`, la misma lógica que `harness/pkg/risk-lambda.ts`): Ágil Data y Experian, varias veces a la vez y confirmando | nada: el lambda es público y su token (`mock-admin`) también |
| el OTP | el servicio de OTP (`/api/otp/latest` y `/api/otp/decrypt`) | la VPN de dev. Sin ella, el código está en Slack `#qa-messages` |
| rellenar, «Continuar aquí», el botón en la página, el recorrido | en la página y en el panel (`content.js`) | el wizard de qa abierto (`originaciones…-qa.dev.creditop.com`) |

⚙ en el encabezado muestra cada pieza en verde o en rojo, con lo que falta.

## Lo que necesita el servidor de Probeta (opcional)

Chrome no abre conexiones a MySQL, así que la base va por un programa en `localhost` (por defecto `http://localhost:5230`,
se cambia en ⚙) con la conexión de cada persona. Sin él, esas partes no aparecen y lo demás anda. Con él:

- la **consola de la base**: las tablas de la solicitud, sus catálogos y las centrales descifradas;
- comprobar que la **cédula y el celular estén libres** al armar la persona;
- **«Aprobar identidad»**, que escribe en la base. No se usa el botón de validación manual del admin de dev: manda un
  WhatsApp real por Twilio al celular del cliente (medido en `twilio_logs` el 2026-11-20), y acá los celulares se inventan.

El contrato que espera la extensión (todo JSON):

| ruta | devuelve |
|---|---|
| `GET /api/health` | `{ ok, detail?, pieces: [{ name, ok, detail? }] }`: una pieza por cosa que el servidor sabe hacer (la base, descifrar) |
| `GET /api/person?doc=&phone=` | `{ free, detail? }`: `free: false` si alguno tiene cliente activo |
| `GET /api/tables?ureq=` | `{ tables: [{ table, rows, error? }], labels: { columna: { valor: nombre } } }`, lo mismo que `dbops request-tables` del harness |
| `GET /api/decrypt?ureq=&id=` | `{ ok, plain?, detail? }`: la `data` de una fila de `risk_central_user_data` |
| `POST /api/identity` `{ ureq, phone }` | `{ ok, detail }`: `manual_validation = 1` del cliente de la solicitud |

Las guardas van en el servidor, no en la extensión: sólo qa (nunca prod), sólo clientes de prueba (por su correo) y sólo
la solicitud del celular de la prueba.

## Instalarla

1. `chrome://extensions` → «Modo de desarrollador» → «Cargar descomprimida» → esta carpeta `probeta-qa/extension`.
2. Fijá el ícono azul y abrilo sobre una pestaña del wizard de qa.

Puede convivir con Probeta: cada una inyecta lo suyo, con su propio botón flotante.

## Probarla sin abrir Chrome

`sidepanel.html#tab=<id>` ata el panel a una pestaña en vez de seguir a la activa: así se maneja con Playwright cargando
la extensión (`--load-extension`). Así se probó el 2026-11-20: «Nueva solicitud» dictó en ~4 s, el wizard llegó del monto
al OTP rellenando, y el OTP salió del servicio y se escribió en la página.
