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
devuelve qué etapas van. El frontend tiene un registro `tipo → componente` y renderiza lo que le
digan, sin un solo `if` por comercio.

## Etapas, no pantallas

La unidad de la plantilla es la **etapa**: un objetivo de la persona, que por debajo puede necesitar
varios componentes. «Validá tu celular» es UNA cosa aunque sean dos pantallas (pedir el número y
verificar el código).

```json
[{"etapa":"celular","titulo":"Tu celular","pasos":["telefono","otp"],
  "al_volver":"¿Querés cambiar el número de teléfono? Vas a tener que verificarlo otra vez."},
 {"etapa":"perfil","titulo":"Tu perfil","pasos":["perfil"],"al_volver":""}]
```

Eso es lo que hace que **volver atrás desde el perfil devuelva al número y no al código**: se
retrocede de etapa, no de pantalla. Y `al_volver` —la pregunta que se le hace a la persona— también
es dato: no está cableada en el front.

El cursor de la solicitud (`paso_actual`) es un índice **plano** sobre los pasos aplanados; la etapa
se deriva. Avanzar mueve un paso, retroceder salta al primer paso de una etapa.

## Las decisiones que importan

**1. En el URL va solo el id de la SOLICITUD** (`/solicitud/<id>`), que es el equivalente de
`user_requests`. No va el paso: el paso lo contesta el server, así no hay nada en la barra de
direcciones que se pueda cambiar a mano para saltearse una validación. Sobrevive el refresco porque
lo único que hace falta para reconstruir todo es ese id. Consecuencia: sin historial por pantalla, el
botón *atrás del browser* sale del flujo — el atrás **del flujo** es el botón de la pantalla.

**2. El evento se emite donde se toma la decisión**, no escuchando la tabla. La pregunta de arranque
era si convenía un mecanismo estilo Firebase que reaccione a las escrituras. Existe
([PocketBase](https://pocketbase.io) es Go + SQLite + realtime y se puede embeber como framework; a
bajo nivel está `sqlite3_update_hook`, en Go vía `RegisterUpdateHook` de `mattn/go-sqlite3`), pero un
update hook da `(tabla, rowid)` y **no el contenido de la fila**, es **por conexión** —no ve
escrituras de otro proceso— y pide CGO. Y el problema de fondo es conceptual: escuchar la tabla
obliga a reconstruir la *intención* desde el diff. Acá la intención es el dato: `otp.verificado`,
`etapa.retrocedida`. Son ~60 líneas en `server/hub.go` y ninguna dependencia.

**3. SSE, no WebSockets.** El tráfico es servidor→cliente y el cliente contesta con POST normales: es
exactamente la forma de SSE. Además es HTTP plano —pasa proxies y WAF, **funciona dentro de un
iframe**, que es cómo el wizard vive en los comercios— y reconecta solo con `Last-Event-ID` (el server
lo respeta). ⚠ Los eventos van **sin `event:` nombrado**: si van nombrados, el `onmessage` del browser
no dispara y hace falta un listener por tipo.

**4. El frontend no decide el paso siguiente: lo escucha.** `paso.avanzado` y `etapa.retrocedida` son
lo único que mueve el cursor. Por eso el segundo dispositivo funciona sin coordinarse con el primero:
abrí el mismo link en otra ventana y el **replay** le manda todo lo que ya pasó.

**5. Cada componente tiene TRES contratos:** lo que pinta (su `.vue`), lo que hace en backend
(`efecto`) y lo que deshace si alguien retrocede por encima suyo (`reversible` + `deshace`, en la
tabla `componentes`). El tercero es el que hace posible el atrás sin dejar basura: al volver al
teléfono, el OTP viejo **se borra** —se emitió contra el número viejo— y el número **se conserva** para
que el campo venga lleno.

Ese flag es también el freno: un componente irreversible (consultar un buró ya se cobró; un handoff a
la entidad ya salió de tu control) hace que el server rechace el retroceso.

## Lo que ya nos enseñó el prototipo

Poner el paso en el URL destapó que `otp/enviar` se llamaba en cada montaje de la pantalla: **6
códigos para una sola solicitud**. Inocuo mientras a esa pantalla solo se llegaba avanzando; con
refrescos es un SMS pagado por refresco y un usuario con tres mensajes de los que sirve uno. Hoy
`otp/enviar` es idempotente salvo que se pida `{"reenviar":true}` explícito.

## Las costuras que faltan (a propósito)

- **No hay transacción** entre deshacer, mover el cursor y emitir. Es lo próximo: si el proceso muere
  en el medio de un retroceso, el OTP quedó borrado y el cursor no volvió. La salida conocida es meter
  estado + evento en un solo commit (*outbox*).
- El backend decide la secuencia, **no el contenido**: los campos de un paso siguen en su `.vue`. Ese
  hueco es el que el form dinámico real ya llena con su schema.
- Las reglas de teléfono por país son un `map` en `server/pasos.go` (hoy solo `CO`). Deberían ser
  tabla, igual que las plantillas.
- La plantilla es una **secuencia lineal**: no hay ramas condicionales. Y no modela los handoffs a
  entidades externas — un redirect al flujo del banco no es un paso de un formulario.

## Mapa

| archivo | qué resuelve |
|---|---|
| `server/db.go` | el esquema, que ES la tesis: catálogo cerrado + variación en filas |
| `server/solicitud.go` | el compositor, el aplanado de etapas, el candado de secuencia y el SSE |
| `server/hub.go` | fan-out en proceso + persistencia de eventos + replay |
| `server/pasos.go` | el efecto de backend de cada componente, y su `deshacer` |
| `src/App.vue` | el registro `tipo → componente`; el único lugar del front que sabe de tipos |
| `src/pasos/*.vue` | la mitad de UI de cada componente |

## Prototipo, no producto

No hay auth, no hay SMS —el código del OTP viaja en el evento `otp.enviado` para que se vea en el
cajón de eventos, algo que en algo real **no** se hace— y `solicitudes.db` se borra sin consecuencias
(se siembra sola al arrancar). El OTP sí tiene vencimiento (5′), tope de 3 intentos y se guarda
hasheado, porque sin eso la demo miente sobre lo que costaría hacerlo bien.

⚠ Puede quedar un `plantillas.db*` viejo en `server/`: es el archivo del esquema anterior (cuando esto
se llamaba «sesión» y la plantilla era una lista plana de pasos). No se migró a propósito — borralo.
