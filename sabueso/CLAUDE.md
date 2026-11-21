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

**Por país** (Miguel, 2026-11-21): el sidebar va en secciones, Colombia y Perú (`COUNTRIES` en `src/App.vue`, `countries`
en `server/model.go`). En **Colombia** los comercios salen del registro mercantil abierto (exacto y gratis). En **Perú**
no hay un registro abierto con la actividad y los locales (el padrón de SUNAT es una descarga masiva sin la actividad),
así que los encuentra **Claude por internet** (`server/web_find.go`, `bin/sabueso hunt --country PE --sector cars`): las
cadenas del sector con sus locales y la fuente; cada búsqueda gasta el asiento del plan. En Perú carros encaja del todo
(BCP Vehicular financia el vehículo entero; `ticketFor` en `server/fit.go`). Las entidades de CreditOp Colombia que
operan en otros países: `tablero/tasks/sabueso/artifacts/entidades-por-pais.json`.

**Las entidades, al fondo del sidebar** (Miguel, 2026-11-21: «sólo para tenerlas pendientes»): las que llevarían a
CreditOp a otros países, de la que más países activa a la que menos; en gris las que todavía no trabajan con CreditOp.
Salen de `sabueso/lenders.json` (dónde opera cada una en América Latina, con su fuente, buscado por Claude) cruzado con
prod (`server/lenders.go`): si ya la tenemos (por sus nombres en `lenders`) y qué países activaría (donde opera y
CreditOp todavía no; hoy CreditOp está en Colombia, Perú y República Dominicana). Las que no activan ningún país no van.
Al pasar el mouse, el detalle. Para sumar una, se agrega a `lenders.json` con su fuente.

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

## Quién decide

`bin/sabueso people <nombre> [--free]` (`server/people.go`): el nombre y el cargo de quien decidiría sobre la propuesta
(comercial, financiero, canales, alianzas, gerencia general), con la fuente y la frase que lo respalda. **Sin escribirle a
nadie.**

1. **En Colombia, el representante legal del registro mercantil abierto** (`legalRep`): público por ley y gratis; en una
   empresa mediana suele ser el gerente general. `--free` trae sólo eso, sin Claude.
2. **Claude, sólo con lo público** (el sitio de la empresa, noticias, directorios y los resultados del buscador), con el
   representante legal como pista. **No abre linkedin.com**: lo niega el permiso (`--disallowedTools
   "WebFetch(domain:linkedin.com)"…`, comprobado en `permission_denials`), no sólo la instrucción, porque las condiciones
   de LinkedIn prohíben el acceso automatizado y una cuenta personal no se arriesga. De un perfil público toma el nombre,
   el cargo y el enlace tal como salen en el buscador.

Sólo se guarda lo que la persona publica profesionalmente; nunca correos o celulares personales. ⚠ Los directorios de
terceros (RocketReach, por ejemplo) pueden estar desactualizados: por eso la fuente se ve junto a cada nombre. Medido
con Dismerca el 2026-11-21: sin la pista no encontró a nadie (96 s, US$0,75); con el registro, el representante legal
gratis, y Claude sumó un gerente financiero y dos jefes comerciales de RocketReach (140 s, US$0,70).

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
  cliente» y por defecto los oculta. ⚠ La razón social del registro no siempre se parece a la marca (Inversiones Crear
  Rama vende como Dentisalud; Organización Dental Planet, como Odontofamily: las dos ya son clientes): por eso Claude
  devuelve también las **marcas** y el sitio, y después de buscar el contacto se cruzan con los clientes
  (`clientByBrand`, también el sitio con algo adelante: `clinicasodontofamily` contiene `odontofamily`). Si resulta
  cliente, `hunt` lo saca y queda anotado con su nombre en CreditOp (`noChannel` con `client`).
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
| el contacto: Claude por internet y el mejor canal | `server/contact.go` (y `runClaude`, la llamada compartida) |
| encontrar comercios en un país sin registro abierto | `server/web_find.go` |
| las entidades que activarían otros países | `lenders.json` (los datos) y `server/lenders.go` |
| el sitio de la empresa, leído sin modelo | `server/site.go` (`SABUESO_LIVE=1 go test -run Live` va a internet) |
| quién decide: el registro y Claude, sin abrir LinkedIn | `server/people.go` |
| la consola | `sabueso/cli` (`bin/sabueso`, compilado en `~/.cache/my-tools/sabueso`) |
| la API | `server/main.go` (encabezado `X-Sabueso: 1` y Host local, como el Llavero) |
| la interfaz | `src/App.vue`, con la base de `tools/ui` (`make style-sync`) |
