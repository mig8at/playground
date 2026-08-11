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
[{"etapa":"celular","titulo":"Tu celular","pasos":["telefono","otp"]},
 {"etapa":"perfil","titulo":"Tu perfil","pasos":["perfil"]}]
```

La etapa es lo que se le muestra como progreso. El cursor de la solicitud (`paso_actual`) es un
índice **plano** sobre los pasos aplanados; la etapa se deriva.

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
`solicitud.reiniciada`. Son ~60 líneas en `server/hub.go` y ninguna dependencia.

**3. SSE, no WebSockets.** El tráfico es servidor→cliente y el cliente contesta con POST normales: es
exactamente la forma de SSE. Además es HTTP plano —pasa proxies y WAF, **funciona dentro de un
iframe**, que es cómo el wizard vive en los comercios— y reconecta solo con `Last-Event-ID` (el server
lo respeta). ⚠ Los eventos van **sin `event:` nombrado**: si van nombrados, el `onmessage` del browser
no dispara y hace falta un listener por tipo.

**4. El frontend no decide el paso siguiente: lo escucha.** `paso.avanzado` y `solicitud.reiniciada` son
lo único que mueve el cursor. Por eso el segundo dispositivo funciona sin coordinarse con el primero:
abrí el mismo link en otra ventana y el **replay** le manda todo lo que ya pasó.

**5. El atrás es UNA regla, no un contrato por componente:** «volver» reinicia la solicitud, y
**se conserva lo que la persona TIPEÓ y se borra todo lo VERIFICADO o DERIVADO**. Al volver, el número
sigue en el campo para corregirlo y el OTP muere —se validó contra el dato viejo—.

El criterio es de negocio: el motivo real de volver es corregir un dato, así que un campo vacío no
sirve para lo único que la gente hace con la pantalla. Y el teléfono no es la identidad de la
solicitud (eso es la cédula), así que cambiarlo no la convierte en otra.

**La solicitud no se reemplaza por una nueva:** mismo id, misma línea de tiempo. Una solicitud nueva
por corrección dejaría filas huérfanas, partiría en dos la historia que hace falta para dar soporte y,
el día que una etapa consulte un buró, podría significar pagar la consulta otra vez.

Se llegó acá después de probar lo contrario: un `reversible` + `deshace` por componente. Para dos
componentes era maquinaria de más (los dos únicos comportamientos eran «borrá el OTP» y «no hagas
nada»). ⚠ **Cuando aparezca el primer paso irreversible** —una consulta que se cobra, un handoff que
ya salió de tu control— reiniciar deja de ser gratis y hace falta esa marca: es una columna, no un
rediseño.

## Los burós como contrato, no como API

Un buró deja de ser «una API que devuelve datos» y pasa a declarar dos cosas, las dos escritas en las
claves de un **diccionario único**:

```
agildata  pide {docType, docNumber, firstName, lastName}
          da   {monthlyIncome, contributionBase, employmentStatus, employmentContinuity, …15}
acierta   da   {creditScore, monthlyDebtPayment, totalDebt, creditCards, liabilities, …33}
```

Ocho servicios: **acierta** (buró Experian: score, comportamiento y deuda — el decisivo para el
listado), **agildata** y **mareigua** (ingreso y empleo desde seguridad social, uno fallback del
otro), **quanto** (estimación de ingreso, también Experian), **tusdatosId** y **tusdatosAml** (KYC:
identidad y listas restrictivas), **ado** (biometría) y **deceval** (firma del pagaré).

⚠ **deceval no es un buró** y entra igual: el modelo —entrada → salida sobre el diccionario— sirve
para cualquier servicio externo, no solo para los que devuelven datos de riesgo. Y los dos de KYC
devuelven **veredictos** (`amlHit`, `identityMatch`, `biometricStatus`), no atributos: son datos que
deciden, no que describen.

## La clase: qué ES el dato, y si un fallback es legal

Cada clave declara una **clase**, y no es cosmética — decide si se puede sustituir:

| clase | qué es | ¿fallback? |
|---|---|---|
| `atributo` (51) | describe a la persona o su historia | **sí**: se toma de quien lo tenga, eso es una cascada |
| `veredicto` (4) | el resultado de una verificación: decide, no describe | **no**: dos chequeos de listas no se sustituyen, cubren cosas distintas |
| `evidencia` (2) | el respaldo de un veredicto | no: una regla lee el veredicto, no ramifica sobre la evidencia |
| `artefacto` (1) | algo que el flujo produce, no que averigua (el pagaré) | no aplica |
| `operativo` (1) | metadata de la llamada, no del solicitante (`amlJob`) | no aplica |

La consecuencia que importa: **un default para un atributo que falta es una decisión de negocio; un
default para un veredicto que falta es un bug.** Si el chequeo de listas no corrió no hay valor
alternativo — hay una ausencia, y una ausencia se resuelve cerrado. Es exactamente por qué el `0` al
final de la cascada de ingreso es discutible y un `amlHit=false` por omisión sería grave.

`/api/plan` lo dice en la respuesta: para `monthlyIncome` contesta «fallback permitido» y tres
opciones; para `amlHit`, «NO permitido: un veredicto no tiene sustituto».

⚠ `operativo` es una **clase de uno**, y eso es la señal: `amlJob` no es un dato del solicitante, es
plumbing de la llamada. Probablemente no debería estar en el diccionario.

En la página, cada clave muestra **entre paréntesis** qué servicios la traen, y el buscador también
busca por servicio. **19 de 59 claves las trae más de uno** —`docNumber` cuatro, `monthlyIncome` tres—
y ahí es donde una cascada tiene sentido. `creditScore` lo da **uno solo**, y eso es un dato de
negocio: si acierta no contesta, no hay score.

⚠ **ADO necesita además una CAPTURA** (selfie + foto del documento) que no es una clave del
diccionario. Es el límite del modelo: la `entrada` asume que todo insumo es un dato con nombre, y hay
insumos que son un archivo.

**Las claves van en inglés, camelCase, sin guiones bajos ni prefijos redundantes** (`docType`, no
`documento_tipo` ni `document_type`), y una guarda de arranque lo obliga además de la de pertenencia.
Es la forma que ya usa la capa de datos real y la que evita que en tres meses convivan
`salario_mensual`, `monthly_income` y `monthlyIncome` como si fueran tres cosas distintas. El flujo
usa **el mismo** vocabulario: lo que captura el paso `telefono` se guarda como `phone` / `phoneE164`,
que son claves del diccionario.

Con eso la pregunta se invierte: en vez de «llamá a agildata y sacá el salario» —que es lo que hoy
está cableado en la cascada de `getSalary`— se puede preguntar **«¿quién me da `ingreso_mensual`, y qué
le tengo que pasar?»**. Y como la entrada también está declarada, se puede encadenar: `GET
/api/plan?quiero=ingreso_mensual&tengo=documento_tipo,documento_numero` contesta que ninguno de los
tres se puede llamar todavía y que faltan `primer_nombre` y `primer_apellido`.

**La guarda es lo que lo hace real:** ningún proveedor puede nombrar una clave que no esté en el
diccionario — el server no arranca y dice cuál. Sin eso, cada proveedor vuelve a inventar su
vocabulario y el diccionario queda de adorno.

El diccionario tiene **página propia** (`/diccionario`, link en el header): clave, descripción en
español y tipo, agrupado y con buscador. La descripción va en español a propósito — se busca en el
idioma en el que uno piensa («ingreso») y salen las claves en inglés (`monthlyIncome`,
`contributionBase`, `incomeMin`…).

Los **tipos** salen de un set cerrado y una tercera guarda lo obliga: `string` · `number` · `float` ·
`date` · `boolean` · `list` · `object`. `date` todavía no lo usa ninguna clave, pero está declarado
para el día que entre una; `boolean`, `list` y `object` están porque el dato realmente es eso —
aplastarlos a `string` sería mentir sobre lo que va a guardar la columna.

`GET /api/claves` · `/api/proveedores` · `/api/claves/{clave}/quien-la-da` · `/api/plan`

Pasar a inglés destapó tres cosas que valía la pena arreglar antes de que se multiplicaran:
**`empleador_nit` → `employerTaxId`** (NIT es de Colombia; en Perú es RUC, y todo esto existe para que
Perú entre sin fork), **`estadisticas_ingreso_mareigua` → `incomeStats`** (un diccionario canónico no
puede llevar el nombre de un proveedor en una clave) y **`afp_eps` → `socialSecurity`**, que en
realidad son dos cosas conflacionadas —fondo de pensión y prestador de salud— y en algún momento hay
que separarlas.

Y una que no se puede arreglar renombrando: **`declaredNegativeReports` lleva la procedencia en el
nombre**. Eso es el campo `fuente` que falta, asomando como parche de nomenclatura.

⚠ **`experian_combinado` quedó afuera a propósito.** Su rol dice «Acierta + Quanto», pero el mapeo
solo registró 9 campos suyos, todos subconjunto de acierta — falta lo de Quanto. Sembrarlo con lo que
*debería* devolver sería inventar; entra cuando se verifique contra el código.

⚠ **Las `salida` salen del mapeo real** (`docs/codigo/mapeo-datos-buros.json`, hoy solo recuperable con
`git show ef1d473^:…`, porque se fue con `docs/`). **Las `entrada` NO están verificadas**: ese mapeo
nunca declaró qué pide cada proveedor. Están sembradas con el mínimo razonable y hay que confirmarlas
contra `pre-approvals-service`. Es la mitad más valiosa —es la que permite encadenar— y es la que
falta comprobar.

Falta también lo que el mapeo viejo ya insinuaba y este modelo todavía no cubre: **la procedencia**. La
cascada real de ingreso mezcla el IBC de nómina con el valor *declarado por el usuario* en la misma
lista. Si solo sobrevive el número, el sistema sustituye uno por otro en silencio. El resolver debería
devolver `{valor, fuente}`, no un número.

## Lo que ya nos enseñó el prototipo

Poner el paso en el URL destapó que `otp/enviar` se llamaba en cada montaje de la pantalla: **6
códigos para una sola solicitud**. Inocuo mientras a esa pantalla solo se llegaba avanzando; con
refrescos es un SMS pagado por refresco y un usuario con tres mensajes de los que sirve uno. Hoy
`otp/enviar` es idempotente salvo que se pida `{"reenviar":true}` explícito.

## Las costuras que faltan (a propósito)

- **No hay transacción** entre borrar el OTP, mover el cursor y emitir. Es lo próximo: si el proceso muere
  en el medio de un reinicio, el OTP quedó borrado y el cursor no volvió. La salida conocida es meter
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
| `server/solicitud.go` | el compositor, el aplanado de etapas, el candado de secuencia, `reiniciar` y el SSE |
| `server/hub.go` | fan-out en proceso + persistencia de eventos + replay |
| `server/pasos.go` | el efecto de backend de cada componente |
| `src/App.vue` | el registro `tipo → componente`; el único lugar del front que sabe de tipos |
| `src/pasos/*.vue` | la mitad de UI de cada componente |

## Prototipo, no producto

No hay auth, no hay SMS —el código del OTP viaja en el evento `otp.enviado` para que se vea en el
cajón de eventos, algo que en algo real **no** se hace— y `solicitudes.db` se borra sin consecuencias
(se siembra sola al arrancar). El OTP sí tiene vencimiento (5′), tope de 3 intentos y se guarda
hasheado, porque sin eso la demo miente sobre lo que costaría hacerlo bien.

⚠ Puede quedar un `plantillas.db*` viejo en `server/`: es el archivo del esquema anterior (cuando esto
se llamaba «sesión» y la plantilla era una lista plana de pasos). No se migró a propósito — borralo.
