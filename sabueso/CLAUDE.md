# sabueso — encontrar comercios y entidades, y llevar la relación

**Para qué existe** (Miguel, 2026-11-21): capturar clientes del negocio. Encuentra **comercios** que todavía no venden a
crédito con CreditOp (y **entidades** que no están integradas), dice por qué encajan y lleva la relación con cada uno
hasta que entra, o hasta que Miguel se la pasa a alguien del equipo comercial. Es **sólo de Miguel**: no tiene usuarios
ni login y no reemplaza el CRM del equipo. El planteamiento, lo descartado y lo medido: la tarea 136 del tablero
(`tablero/tasks/sabueso`).

`make sabueso` (UI :5244 · API :5245) o la app **Sabueso** de Cockpit. Rutas: `#/` (embudo), `#/registro`, `#/nueva`,
`#/c/<id>`.

## Qué hay en la pantalla

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

- Escribirle a nadie: el correo lo redacta (pendiente de la tarea) y lo envía Miguel, a mano.
- Escribir en una base de CreditOp: prod se lee.
- Guardar datos personales en masa: el correo y la línea son los públicos de la empresa (ventas@, contacto@).

## Dónde queda

`sabueso/.data/state.json` (las empresas, su etapa, próximo paso y bitácora) y `.data/measured.json`, fuera de git.

| pieza | dónde |
|---|---|
| las empresas, las etapas y la bitácora | `server/model.go` |
| los sectores y el encaje | `server/fit.go` |
| prod (por `bin/pg`) y el registro mercantil | `server/sources.go` |
| la API | `server/main.go` (encabezado `X-Sabueso: 1` y Host local, como el Llavero) |
| la interfaz | `src/App.vue`, con la base de `tools/ui` (`make style-sync`) |
