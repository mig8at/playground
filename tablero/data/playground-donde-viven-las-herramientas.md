---
id: 48
title: "playground: el lugar donde viven las herramientas internas"
stage: work
created: "2026-08-13T16:00:18-05:00"
context_nodes: []
jira: [CORE-421]
jira_title: "Dónde publicar las herramientas internas del equipo"
---

**ESTADO 2026-08-14 · EN PROGRESO** — el repo está armado y verificado de punta a punta. Lo que
falta ya **no es nuestro**: son cuatro cosas que crea infraestructura, listadas en una sola página.

**Jira: [CORE-421]** · CORE Sprint 11 · 5 puntos · «🚧 En progreso».

> Antes esta tarea se llamaba *«cuadrilla: funciona pero no tiene dónde vivir»*. Se renombró porque el
> problema resultó ser el otro: cuadrilla es **una** herramienta, y lo que faltaba era el lugar. Ahora
> cuadrilla vive adentro de `playground` como una más.

## Qué es

`Creditop-SAS/playground` (lo dio Dani) — el repo donde viven las herramientas internas. **No es el
producto.** Cada herramienta es una carpeta, su contenedor y su despliegue: un cambio en una no puede
tumbar otra.

Adentro hay cuatro, y las tres nuevas son **solo el nombre en pantalla** a propósito — primero se
prueba que el camino completo funcione, después se les pone contenido:

| | | |
|---|---|---|
| `home` | la galería y el login unificado | Vue |
| `cuadrilla` | las épicas del equipo | Go |
| `credibot` | el bot de Slack de Duncan | Python |
| `credibrain` | la memoria de la compañía (de Oscar) | Node |

Tres lenguajes a propósito: es la prueba de que nadie tiene que escribir en el que usamos nosotros.

## Las decisiones que aguantan el diseño

Cada una se tomó **sacando** algo, y en todas el empujón fue de Miguel:

1. **No hay código compartido.** Existieron `libs/`, después `login/`, y un `shared/contrato.json`.
   Se borraron los tres. Cada herramienta se lee entera de arriba abajo, con su server adentro. El
   criterio quedó escrito: se comparte lo que, si está mal, **no rompe nada** (le cree a un token
   falso y nadie se entera); se copia lo que, si está mal, **no abre**.
2. **Lo que se le exige a una herramienta no lo declara ningún archivo: lo prueba `task conforme`**,
   por HTTP y sin mirar el código. Escuchar en `0.0.0.0`, `/health` sin consultar nada, `/api/yo` con
   quién entró, y no servir nada fuera de `public/` (24 intentos de salirse). Agregar una regla es
   agregar una prueba, no un campo.
3. **`task ci` es lo que corre el CI** — el workflow del PR llama a esa tarea, no a una lista
   parecida. Dos listas se separan; una sola, no.
4. **Una herramienta no pide recursos.** No hay `necesita:`. Infra provee lo que hay y lo documenta en
   `.env.example`; la herramienta usa lo que le sirve. Sumar Redis mañana es una línea ahí, sin tocar
   ningún manifiesto.
5. **Manifiesto de ocho líneas en YAML**, con defaults (el subdominio es el nombre, el puerto 8080).
   Lo lee un parser propio de ~40 líneas que **rechaza** lo que no entiende: el repo no tiene una sola
   dependencia fuera del front del home.
6. **Local imita a producción donde suele divergir**: la forma del dominio
   (`credibot.pg.localhost:8181` ↔ `credibot.pg.creditop.com`), la cabecera de identidad, y que
   ninguna herramienta publique puertos.

## La apuesta de seguridad, y que está sin confirmar

Nadie escribe un login: el balanceador autentica contra Google y pasa los datos de la persona. Las
herramientas **decodifican** ese JWT y **no verifican la firma** — se sacaron las ~100 líneas por
lenguaje que lo hacían.

Eso mueve la garantía al **security group**: *a las tareas no les puede llegar tráfico que no venga
del balanceador*. Está escrito como requisito arriba de todo en `INFRA.md`, pero **nadie lo
confirmó todavía**. Si Dani dice que cualquier cosa del VPC les llega directo, hay que volver a poner
la verificación — el código estuvo escrito y se recupera del historial.

⚠ Y lo que lo hace delicado: si el requisito no se cumple, **no se rompe nada**. Todo sigue andando y
cualquiera puede decir que es quien quiera. Conviene tener esa respuesta **antes** de que una
herramienta muestre datos de clientes.

## Un error que casi se despliega

Durante todo el armado se dio por cierto que el correo llegaba en `x-amzn-oidc-identity`. La
documentación de AWS dice lo contrario: esa cabecera trae el **`sub`** del proveedor, que en Google es
un número (`109876543210987654321`). El correo viaja en el cuerpo del JWT `x-amzn-oidc-data`.

Las cuatro herramientas habrían mostrado un número en vez de una persona — y el día que credibot
registre quién pidió un cambio, el registro habría dicho un número. Corregido en las cuatro, y **la
prueba de conformidad ahora comprueba las dos caras**: que se lea el correo del sobre, y que no se
confunda el `sub` con el correo. No se arregló pensando mejor: se arregló leyendo la documentación.

## Lo que falta, y es de infraestructura

Todo está en `INFRA.md`, una página que no obliga a entrar al código:

1. **La puerta con Google** — `authenticate-oidc` en el listener, con la app de OAuth **interna** (así
   solo entran cuentas de la compañía). Los cuatro endpoints están escritos, y `email` en el scope
   **no es opcional**. Ojo con el paso manual: Google **no acepta comodines** en las URL de retorno,
   así que cada herramienta nueva suma una línea (`https://<nombre>.pg.creditop.com/oauth2/idpresponse`).
2. **DNS y certificado** que cubran **las dos** formas: `pg.creditop.com` y `*.pg.creditop.com` — el
   home vive en la raíz.
3. **Tres variables del repo** (`AWS_DEPLOY_ROLE`, `AWS_REGION`, `ECS_CLUSTER`) y, por herramienta, su
   repositorio de imágenes y su servicio.
4. **La respuesta sobre el security group** (arriba).

Mientras nada de eso exista, el deploy **se saltea solo y lo dice**: el repo no arranca en rojo.

## Lo que sigue siendo mentira en cuadrilla

El estado de cada rama (PR abierto, días esperando, mergeada) y quién aprobó **se siguen simulando**.
Salen de verdad con una **GitHub App de la organización** (`Contents: read` + `Pull requests: read`).
Va con App y no con el token de cada persona: así todos ven el mismo tablero y no se guarda un token
por persona. Ya está anotado en `.env.example` como `GITHUB_APP_ID` / `GITHUB_PRIVATE_KEY`.

Dato que salió al revisarlo: la organización está en plan **Team**, así que **no hay SSO** — entrar a
GitHub con la cuenta de Google no es posible hoy, y nada vincula `miguel@creditop.com` con
`mig-creditop`. Por eso el vínculo con GitHub es un paso manual de una sola vez, y por eso hay que
guardarlo.

## Preguntas abiertas

- **¿Las tareas aceptan tráfico solo desde el balanceador?** Es la única que cambia código.
- **¿Cómo se sabe si alguien es de Tech?** Google dice quién sos, no a qué grupo pertenecés: hoy llega
  `tech: null` («no sé», que no es «no es») y cada herramienta muestra lo que todos pueden ver. Las
  opciones son GitHub, Cognito en el medio o la API de Cloud Identity. No es urgente, pero deja de no
  serlo el día que una herramienta esconda algo.
- **¿Cómo se hablan las herramientas entre sí en producción?** El home preguntándole a cada una queda
  para cuando haya algo que preguntar; se sacó del código por ahora.

## Estado del repo

Un solo commit (la historia detallada quedó en una rama local), 49 archivos, **nunca pusheado** — el
push lo decide Miguel. Revisado antes de publicar: ni un secreto, `.env.example` sin valores, el
remoto vacío (o sea, push limpio sin forzar) y los dos workflows verdes en el primer push.

## Tarea (publicable)

Las herramientas internas que hace el equipo —tableros, bots, utilidades de soporte— hoy corren en el
computador de quien las escribió. Nadie más las alcanza, así que el trabajo de uno no le sirve al
resto, y cada persona que quiere hacer una tiene que resolver de cero cómo se publica, cómo se
identifica a quien entra y cómo se despliega.

Se armó el lugar donde pueden vivir todas. Cada herramienta es una carpeta independiente: su propio
programa, su propio despliegue, y en el lenguaje que sepa quien la escribe (hay tres distintos
funcionando, justamente para probar que no obliga a ninguno). Agregar una nueva es copiar una carpeta
y cambiarle el nombre; el resto —publicarla, identificar a la persona que entra, revisar que cumpla lo
mínimo— ya está resuelto y se comprueba solo en cada cambio.

Quien entre se identifica una sola vez con su cuenta de la compañía y ve el catálogo de todo lo que
hay disponible. Ninguna herramienta maneja contraseñas ni guarda credenciales de nadie.

Estado: el esqueleto está terminado y probado de punta a punta. Las herramientas que hay adentro
todavía no tienen contenido —muestran solo su nombre— a propósito: primero se verificó que el camino
completo funcione.

**Lo que falta ya no es de desarrollo, es de infraestructura**, y está en una sola página: la conexión
con el login de la compañía, el dominio con su certificado, y los permisos de despliegue. Hay una
decisión pendiente sobre cómo se aísla la red, que conviene responder antes de que alguna herramienta
maneje datos de clientes.
