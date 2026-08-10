# plantillas — prototipo de onboarding compuesto por el backend

> ⚠ **Esto NO describe cómo funciona CreditOp hoy.** Es un prototipo de una propuesta, aislado a
> propósito: SQLite local, cero dependencias del monorepo, cero conexión a la BD de la compañía.
> No lo cites como fuente. Lo que corre en producción vive en `context/`.

```bash
make plantillas          # Vue :5198 + server Go :8090
make plantillas-check    # go vet + build
```

## Qué está probando

Una sola idea: **que el flujo de onboarding sea un dato y no código.** El backend recibe la llave del
negocio —el par `(comercio, entidad)` más el país, que es la llave que ya decide todo en CreditOp— y
devuelve *qué pasos van*. El frontend tiene un registro `tipo → componente` y renderiza lo que le
digan, sin un solo `if` por comercio.

La demostración está en la pantalla de inicio: dos plantillas con **el mismo código** produciendo
flujos distintos, y la diferencia entre las dos es **una fila en SQLite**.

| plantilla | pasos |
|---|---|
| `pullman / credipullman / CO` | `telefono → otp → datos` |
| `bcp / cuotealo / PE` | `telefono → otp` |

## Las cuatro decisiones que importan

**1. El evento se emite donde se toma la decisión, no escuchando la tabla.** La pregunta de arranque
era si convenía un mecanismo estilo Firebase que reaccione a las escrituras. Existe
([PocketBase](https://pocketbase.io) es Go + SQLite + realtime y se puede embeber como framework; a
bajo nivel está `sqlite3_update_hook`, en Go vía `RegisterUpdateHook` de `mattn/go-sqlite3`), pero un
update hook te da `(tabla, rowid)` y **no el contenido de la fila**, es **por conexión** —no ve
escrituras de otro proceso— y pide CGO. Y el problema de fondo es conceptual: escuchar la tabla te
obliga a reconstruir la *intención* desde el diff de la fila. Acá la intención es el dato:
`otp.verificado`, `paso.avanzado`. Son ~60 líneas en `server/hub.go` y ninguna dependencia.

**2. SSE, no WebSockets.** El tráfico es servidor→cliente (el server dice qué paso viene) y el cliente
contesta con POST normales: es exactamente la forma de SSE. Además es HTTP plano —pasa proxies y WAF,
**funciona dentro de un iframe**, que es cómo el wizard vive en los comercios— y reconecta solo con
`Last-Event-ID` (el server lo respeta: `server/sesion.go`). WebSocket pide upgrade, keepalive y tu
propia reconexión, y el upgrade es lo primero que rompe un WAF corporativo.

**3. El frontend no decide el paso siguiente: lo escucha.** `paso.avanzado` llega por SSE y es lo
único que mueve el cursor. Por eso el segundo dispositivo funciona sin coordinarse con el primero:
entrá a `?sesion=<id>` en otra ventana y el **replay** le manda todo lo que ya pasó.

**4. Cada componente del catálogo tiene DOS contratos: lo que pinta y lo que hace en backend.** El
catálogo (`GET /api/catalogo`) declara el efecto de cada tipo, no solo su nombre. Definir nada más la
mitad de UI es cómo se llega a un renderer que nadie puede servir.

## La costura que falta (a propósito)

El backend ya decide la **secuencia**, pero los **campos** del paso `datos` siguen en el `.vue`. Ese es
el siguiente movimiento, y es exactamente el hueco que el form dinámico real ya llena con su schema.
La otra candidata a mudarse a tabla son las reglas de teléfono por país, hoy un `map` en
`server/pasos.go`.

Y hay dos cosas que este prototipo **no** modela, para no prometer lo que no puede: los handoffs a
entidades externas (un redirect al flujo del banco no es un paso de un formulario) y cualquier noción
de ramas condicionales — hoy la plantilla es una secuencia lineal.

## Mapa

| archivo | qué resuelve |
|---|---|
| `server/db.go` | el esquema, que ES la tesis: catálogo cerrado + variación en filas |
| `server/sesion.go` | el compositor (`crearSesion`), el candado de secuencia (`pasoEsperado`) y el SSE |
| `server/hub.go` | fan-out en proceso + persistencia de eventos + replay |
| `server/pasos.go` | el efecto de backend de cada componente del catálogo |
| `src/App.vue` | el registro `tipo → componente`; el único lugar del front que sabe de tipos |
| `src/pasos/*.vue` | la mitad de UI de cada componente |

## Prototipo, no producto

No hay auth, no hay SMS —el código del OTP viaja en el evento `otp.enviado` para que se vea en el
panel del operador, algo que en algo real **no** se hace— y `plantillas.db` se borra sin consecuencias
(se siembra sola al arrancar). El OTP sí tiene vencimiento (5′), tope de 3 intentos y se guarda
hasheado, porque sin eso la demo miente sobre lo que costaría hacerlo bien.
