# sabueso — encontrar comercios y entidades, y llevar la relación

**Para qué existe** (Miguel, 2026-11-21): capturar clientes del negocio. Encuentra **comercios** que todavía no venden a
crédito con CreditOp (y **entidades** que no están integradas), dice por qué encajan y lleva la relación con cada uno
hasta que entra, o hasta que Miguel se la pasa a alguien del equipo comercial. Es **sólo de Miguel**: no tiene usuarios
ni login y no reemplaza el CRM del equipo. El planteamiento, lo descartado y lo medido: la tarea 136 del tablero
(`tablero/tasks/sabueso`).

`make sabueso` (UI :5244 · API :5245) o la app **Sabueso** de Cockpit. Rutas: `#/` (embudo), `#/registro`, `#/nueva`,
`#/c/<id>`. **Por consola, `bin/sabueso`** (lo que más usa Miguel): habla con la misma API, así que lo que hace se ve en
la app.

    bin/sabueso hunt --sector motorcycles [--count 1] [--tries 3] [--min 5]   encontrar y conseguir el contacto
    bin/sabueso contact <nombre|id>                                            el contacto de uno que ya está
    bin/sabueso find --sector dental                                           los del registro, sin agregar nada
    bin/sabueso list · sectors

**Por ahora sólo comercios** (Miguel, 2026-11-21: «empecemos por comercio; oculta, no elimines»): las entidades están
ocultas en la interfaz con `SHOW_LENDERS = false` (`src/App.vue`); el servidor y los datos las siguen sabiendo llevar.

## El contacto para la propuesta

Lo que importa de un prospecto es **por dónde recibe una propuesta**: el correo o el teléfono del área de alianzas,
proveedores, compras o comercial, no un contacto cualquiera. Lo busca `server/contact.go` en dos capas:

1. **Claude por internet**: `claude -p` desde una carpeta neutra, con SÓLO WebSearch y WebFetch y salida en JSON
   (`--json-schema`): cada canal con su área, si recibe propuestas (`proposals`), es comercial o general, y la URL donde
   está. Prohibido: inventar, el correo de notificación judicial, celulares personales. Es la sesión de Miguel: **gasta el
   asiento del plan**, entre 80 y 130 s y el equivalente a US$0,40–0,48 por empresa (medido el 2026-11-21).
2. **El sitio de la empresa, leído sin modelo** (`server/site.go`): la página de inicio y hasta 6 de contacto, sedes o
   proveedores del mismo dominio, de donde salen los `mailto:`, `wa.me` / `api.whatsapp.com` (también dentro del JSON de
   un plugin, con las barras escapadas) y `tel:`. Es exacto y gratis, y va primero. Hizo falta: dos búsquedas de
   Claude sobre Dismerca dieron resultados distintos (una trajo el WhatsApp comercial, la otra un usuario de Instagram).

Lo que trae Claude se valida (`validContact`): un correo tiene que ser un correo y un teléfono tener dígitos; lo que no
pasa se descarta. El mejor canal (`best`): el de propuestas, después el comercial, después el general; a igual nivel,
correo, WhatsApp, teléfono y formulario. Queda en la bitácora y en el secundario, con sus fuentes. Una empresa sin sitio
ni canal publicado (Todomotos VS, el 2026-11-21) queda «sin canal público»: `hunt` sigue con la siguiente y no repite
una que ya se buscó.

## Qué hay en la pantalla

**Hoy, la vista simple** (Miguel, 2026-11-21: «hagamos lo simple»; `SIMPLE = true` en `src/App.vue`): a la izquierda
**sólo los comercios que tienen por dónde contactarlos** (teléfono, WhatsApp, correo o formulario), al centro **de qué
es** el comercio (lo que dijo Claude, sector, ciudad, puntos, sitio y por qué encaja) y a la derecha **cómo
contactarlo**, cada canal con su área y su fuente. **Sólo se lee**: no hay campos para escribir; lo que cambia lo hace la
consola (`bin/sabueso`) con Claude y la app lo muestra. Un comercio que se buscó y no tiene canal sale de Sabueso y
queda en `noChannel` (el estado), para que `hunt` no lo vuelva a buscar; el registro lo marca «ya se buscó».

Más adelante (idea de Miguel, sin hacer): si una empresa sólo tiene un formulario, Jarvis lo llena y queda registrado
el camino —formulario, correo, llamada—, sin suponer que siempre es el mismo.

La vista completa sigue en el código (con `SIMPLE = false`):

- **Sidebar:** Comercios y Entidades, vistas apiladas, agrupadas por etapa en el orden del embudo. Prospectos por encaje;
  en negociación, por próximo paso (lo vencido arriba, en rojo); entidades, por días en su etapa. Si se la pasaste a
  alguien, la fila dice a quién.
- **Editor:** la pestaña **Embudo** (conteos por etapa, próximos pasos, y los sectores con lo que originan hoy en
  CreditOp), la de **Registro** (buscar en el registro mercantil) y una pestaña por empresa: la barra de etapas, el
  próximo paso, la bitácora y abajo el campo para registrar una llamada, un correo, una reunión o una nota. La que se
  abre con un clic reemplaza a la vista previa (itálica); doble clic la fija.
- **Secundario:** los datos (se guardan al salir del campo), el encaje con sus razones, el contacto PÚBLICO de la
  empresa y de dónde salió.
- **Panel:** la actividad de todas. **Pie:** conteos y pasos vencidos.

## Cómo decide

- **El encaje** (`server/fit.go`) se explica solo y sale de lo medido en prod el 2026-11-21: los **puntos de venta**
  pesan más que todo (una cadena de 21 o más origina ~40 veces lo de un solo punto), después el **ticket del sector**
  (carros encaja sólo en parte) y **vender en línea**, en cualquier plataforma. A una entidad no se le mide encaje.
- **El registro mercantil** es el abierto de Confecámaras en datos.gov.co (`server/sources.go`): cuenta los
  establecimientos activos por NIT del dueño (los puntos de venta) para los CIIU del sector y les pone la razón social.
  Gratis, sin llave, licencia CC BY-SA 4.0 (se cita la fuente). No trae contacto ni municipio: el contacto se busca en el
  sitio de la empresa.
- **Quién ya es cliente**: los comercios activos de CreditOp, leídos en prod por `bin/pg sql` (sólo lectura). Se cruza
  por NIT **y por nombre**, porque 139 de 213 comercios activos no tienen NIT en CreditOp. El registro los marca «ya es
  cliente» y por defecto los oculta.
- **Lo medido en prod** (cuánto origina cada sector y los clientes) se guarda 6 horas en `.data/measured.json`;
  «Volver a medir» lo fuerza. Sin VPN o sin la sesión del conector, el embudo lo dice y sigue con lo último medido.
- **Pasar a una persona** marca «lo retoma <persona>» en la bitácora: desde ahí la conversación sigue en persona, fuera
  de Sabueso. Descartar deja la empresa con su historia; «Sacar» la borra.

## Lo que NO hace

- Escribirle a nadie: encuentra el canal; el mensaje lo manda Miguel, a mano.
- Escribir en una base de CreditOp: prod se lee.
- Guardar datos personales en masa: el correo y la línea son los públicos de la empresa (ventas@, contacto@).

## Dónde queda

`sabueso/.data/state.json` (las empresas, su etapa, próximo paso y bitácora) y `.data/measured.json`, fuera de git.

| pieza | dónde |
|---|---|
| las empresas, las etapas y la bitácora | `server/model.go` |
| los sectores y el encaje | `server/fit.go` |
| prod (por `bin/pg`) y el registro mercantil | `server/sources.go` |
| el contacto: Claude por internet y el mejor canal | `server/contact.go` |
| el sitio de la empresa, leído sin modelo | `server/site.go` (`SABUESO_LIVE=1 go test -run Live` va a internet) |
| la consola | `sabueso/cli` (`bin/sabueso`, compilado en `~/.cache/my-tools/sabueso`) |
| la API | `server/main.go` (encabezado `X-Sabueso: 1` y Host local, como el Llavero) |
| la interfaz | `src/App.vue`, con la base de `tools/ui` (`make style-sync`) |
