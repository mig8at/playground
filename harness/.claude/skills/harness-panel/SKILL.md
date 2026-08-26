---
name: harness-panel
description: Tocar el panel del harness harness (:5195, panel/index.html + panel/server.ts). Usala cuando la tarea toque el mapa del recorrido del wizard (panel/steps.json), el gate de perillas por target (CAPS), el selector de comercio y sucursal, el switch de Frontend local vs desplegado y su pool de Cognito, la comprobación de BD al cerrar la corrida (dbops activity), o los internals de bin/asesor.
---

# El panel del harness

**Qué es:** una UI sobre `bin/asesor` (`npm run dev` → **:5195**). No es un segundo motor: todo lo que
hace, lo hace lanzando el mismo launcher que usás por terminal. Si algo se puede resolver en `bin/asesor`,
va ahí y el panel lo consume — duplicar la lógica en la UI es como empiezan a derivar.

**Su límite, y es una decisión:** el panel **corre flujos** (inyecta + bypass) y nada más. Validar negocio
va aparte, por consola. **No metas el modo rápido (`dev/sweep.ts`) en el panel** — ya se intentó y se
revirtió: mezclarlos confunde para qué sirve cada uno.

⚠ **No te quedes con el puerto :5195.** Si dejás una instancia tuya corriendo, el `npm run dev` de Miguel
no arranca. Ya pasó dos veces. Levantalo solo si lo vas a usar, y bajalo.

## El mapa del recorrido (`panel/steps.json`)

Canvas SVG **vertical** y arrastrable (drag · rueda = zoom · doble clic = encuadrar), estilo grafo de
git: tronco común hasta `/lenders` y de ahí un carril por `response_type`. Dibuja **solo los carriles
que ese comercio tiene** (mira el `rt` y el `product` de sus entidades). El hover de cada nodo lista los
archivos del paso.

**INVARIANTE: el mapa depende del COMERCIO, no del ambiente.** Describe la lógica de CreditOp, así que el
mismo comercio dibuja el mismo recorrido en local, dev y staging. Dos reglas lo sostienen, y si las rompés
el diagrama vuelve a cambiar de forma según el target (F-64):

- **No filtres por `lender_status`.** Prender o apagar una entidad no cambia POR DÓNDE pasa el flujo, solo
  si hoy lista. Eso se anota (`(apagado)` + carril atenuado), no se borra.
- **Un carril por RECORRIDO, no por entidad.** La clave es `rt + product + desvíos + extensiones`: dos
  entidades del mismo producto recorren lo mismo (es la misma razón por la que el color va por producto).
  Usar la identidad del lender ata el dibujo al padrón de cada base.

Y lo que el mapa **no puede** dibujar hay que decirlo en `#trenwarn`: sin entidades, o sin la columna
`lenders.product` (dev todavía no la tiene), un recorrido vacío o achatado se lee como "este comercio no
tiene esos flujos" cuando en realidad faltó el dato.

**Por qué vertical y no horizontal** (ya se probó y se revirtió): en horizontal la bifurcación cae al final
del tronco y los carriles arrancan al principio, así que la curva de unión vuelve cruzando todo el
diagrama. Medido: bifurcación en x=456, carril de 8 nodos ≈900px, contenedor 1238 → no entra. Girando el
eje, el largo se gasta en alto (que se recorre arrastrando) y la curva queda corta.

**Por qué sin librería de grafos** (D3 / vis-network se evaluaron): son ~20 nodos en carriles paralelos, o
sea posiciones que ya conocemos — un motor de layout no tiene nada que resolver. El criterio: *¿puedo
ubicar los nodos a mano sin que se crucen las aristas?* Si sí, CSS/SVG.

- **Qué cuenta como archivo del paso** (respetalo si lo editás): la ruta del front + los servicios que su
  loader/action invoca, y el controlador del endpoint + los servicios de dominio que llama. **No** utils,
  ni tipos, ni cierre transitivo de imports. Si el número no significa "lo que este paso toca de verdad",
  es decoración con cara de dato.
- **Validá siempre después de tocarlo:** `node bin/steps-check.ts` (sale ≠0 si alguna ruta no existe). El
  panel además muestra un aviso si el chequeo falla — un conteo que ya no resuelve es peor que nada.

## El panel no ofrece lo mismo en todos los targets (`CAPS`)

`bin/asesor` **no levanta lo mismo en cada target**, así que el panel no puede ofrecer las mismas
perillas. Una perilla que no mueve nada es peor que no tenerla: te deja creyendo que probaste algo que
nunca se aplicó. (La matriz de qué es real en cada target está en el `CLAUDE.md`.)

Dos mecanismos, y **no son intercambiables**:

- **`E2E_REAL_PREAPPROVALS`** (en `.env.<target>`, hoy `1` en dev y staging) decide si se usa el mock de
  pre-aprobados. `bin/asesor` lo lee **por la cadena (`envget`)**, no del shell: si lo leyera del shell,
  ponerlo en `.env.dev` no haría nada. El panel pregunta lo mismo al servidor (`/api/lenders` → `mockPA`)
  y muestra el selector de estado por entidad **solo cuando el mock contesta**. Atarlo a una lista de
  targets se desincroniza el día que alguien cambia la variable.
- **`const CAPS`** (en `panel/index.html`) es para lo que **sí** depende del target: hoy solo `flotaLocal`
  (los seis mocks que `bin/asesor:189-199` levanta únicamente en local). Si agregás un target, agregalo
  ahí — el default de `cap()` es el más restrictivo **a propósito**: enumerar targets a mano fue lo que
  dejó a staging afuera del guard de escrituras cuando se sumó.

**En pantalla se avisa solo lo que está ROTO**, no lo que es normal en ese ambiente. Un cartel que dice
"acá esto no aplica" es ruido y se lee como error. Lo que hay que saber para interpretar la vista:

- **sin selector de estado por entidad** → esa corrida usa el MS real; el desenlace lo decide el proveedor.
- **el mapa sin carriles** → esa sucursal no tiene entidades en ese target.
- **los CreditopX en un solo carril `rt2`** → ese ambiente no tiene la columna `lenders.product` (hoy dev)
  y no se pueden separar por producto. Ver **F-64**.

## Elegir comercio: los curados y el buscador

Conviven dos entradas, y **no son redundantes**:

- **Las tarjetas** (`MERCHANTS` en `panel/index.html`) están curadas por lo que **ejercitan** — Motai =
  renting/RTO, CeluRD = SmartPay/IMEI, Sonría = el listado más rico, Mediarte = rt2 al 0% con Credifamilia
  rt4 al lado, Alkosto = el canal QR. Eso es conocimiento, no comodidad: no las cambies por el buscador.
- **El buscador** va contra la BD del target, en **dos pasos: comercio → SUCURSAL**. El segundo paso no es
  adorno: lo que se lanza es un hash de **sucursal**, y `dbops list` devuelve `MIN(hash)` — buscar "motai"
  da `5cb92b54` (*Motai Boyaca*), no `f0548728` (*PRINCIPAL*). Resolver "una sucursal cualquiera" ya causó
  que la card mostrara una y el flujo corriera contra otra.

Al elegir del buscador, el `slug` **es el hash**: `.flows.json` no conoce esa sucursal, y tanto
`branchHashForSlug` (panel) como `bin/asesor` caen a "si parece hash de 8 hex, es el hash".

**★ Guardar como favorito** lo escribe en `.flows.json` con el nombre que quieras y `fav: true`. No es
cosmético: desde ahí `bin/asesor <slug>` lo reconoce **desde la terminal**, no solo el panel. El `fav`
existe para poder renombrar/borrar **solo los tuyos** — los curados no se tocan desde la UI. Y
**renombrar NO cambia el slug**: es la clave con la que un comando guardado ya funciona.

## El switch de FRONT: el pool de Cognito lo trae el front, no el target

Switch **Frontend**: *Del ambiente* (el desplegado del target) o *Local :5174* (tu working copy). Existe
para ver un cambio del front contra `qa` **sin esperar el deploy**. Por CLI es `CFE_FRONT=local|ambiente`.
La opción "del ambiente" aparece solo si ese target tiene un front desplegado configurado
(`E2E_BASE_URL`), y eso lo resuelve el servidor por la **misma cadena** que `bin/asesor` — no una lista de
targets en el panel, que se desincronizaría.

⚠ **Con front local, el pool de Cognito es el de DEV aunque el backend sea el de qa.** El wizard local trae
su propia config de Cognito en el `.env` del monorepo (`login.creditop.com` + su `client_id`) y
`bin/asesor` solo le pisa las URLs de API. Consecuencias, las dos ya cableadas:

- la corrida se loguea con la cuenta de **`.cognito.json`** (`a.arismendy`, pool de dev), no con la de
  `.env.staging` (`oscar+dentix`, otro pool) — `bin/asesor` vacía `E2E_COGNITO_USER/PASS` para que caiga
  ahí sola, y lo canta en el log (`● cognito  front local → pool de dev`);
- el cache de sesión se llama por **front**, no por target (`pkg/cognito.ts`): `staging + front local` usa
  `cognito-state.dev.json`. Cachearlo como 'staging' hacía replayar cookies de OTRO origen y re-loguear
  con la cuenta del pool equivocado — se ve como un login que se queda en `verifyPassword` hasta el
  timeout, que es lo que pasó la primera vez que se probó el switch.

Funciona porque **dev y staging comparten la BD**: el `sub` del asesor es el mismo para los dos backends,
así que el permiso a la sucursal vale igual. Si algún día dejaran de compartirla, esto se rompe.

## `CFE_FRONT` es un SWITCH, no una ruta (y el log del wizard mentía)

Dos bugs de `bin/asesor` que juntos costaban 8 minutos por corrida, arreglados el 2026-07-31 — si tocás
esa zona, **no los deshagas**:

- **`CFE_FRONT` tenía dos sentidos.** Abajo es el switch de front (`local|ambiente`, que es **lo que manda
  el panel**) y arriba se usaba como la RUTA del monorepo. Con `CFE_FRONT=local` la ruta quedaba en
  `local/apps/loan-request-wizard` → `cd: No such file or directory`, el wizard nunca arrancaba **y el
  script igual esperaba 480 s "compilando"** antes de rendirse. Ahora se resuelve por valor: `local` y
  `ambiente` son modos; cualquier otro valor sigue siendo una ruta (compat), y `CFE_FRONT_PATH` la fija
  explícita. Se agregó un guard: si el directorio no existe, corta al instante con el path a la vista.
- **El log del wizard no se truncaba antes de lanzar.** Si el arranque fallaba sin llegar a escribir, el
  `tail -15` mostraba el log de la corrida ANTERIOR: un `Cannot find module '@radix-ui/react-collapsible'`
  ya resuelto seguía apareciendo como si fuera el fallo actual y mandó a buscar donde no era. Ahora se
  trunca (`: > /tmp/asesor-wizard.log`) antes del `nohup`.

**Lección transferible:** cuando el arnés espera minutos y después culpa a un log, sospechá del log antes
que del producto. Un error viejo presentado como actual es peor que no tener log.

## Comprobación de BD al cerrar la corrida (`dbops activity`)

Al **terminar** la corrida (Detener o fin natural — `child.on('close')` en `panel/server.ts`) el panel hace
**UNA** consulta `dbops activity <duración>`, deriva el veredicto (estado final, flujo, si se
consultó/inyectó el buró) y lo vuelca a **la consola de la corrida** (queda ahí como post-mortem) + a
`.runs/`. Existe porque el modo **manual** del panel es ciego: la pantalla muestra la *pretensión* y nadie
muestra lo que se persistió (el patrón de F-50). Complementa a `pkg/trace.ts`, que solo corre en el guiado.

**No se pollea durante la corrida (2026-07-22).** Antes se consultaba cada 2s y se pintaba una grilla de
puntos por tabla; se sacó porque cada tick arrancaba un proceso + una conexión nueva a dev (~700ms) y
cargaba la BD **compartida** casi a la mitad del tiempo, sin aportar mucho. La foto al cierre alcanza y es
más barata.

Tres cosas que hay que respetar si lo tocás:

- **La ventana la mide la BD**, no node: `dbops activity <segundos>` filtra con `NOW() - INTERVAL n
  SECOND`. Contra dev la base es remota y comparar contra el reloj local perdería eventos o traería basura
  vieja. Al cierre, `<segundos>` = duración de la corrida.
- **Las 9 tablas van EN PARALELO, cada una en su propio `try`** (`Promise.all` en `bin/dbops.ts`): si una
  columna no existe en ese ambiente se pierde ESA fila, no la vista entera (lección de F-64), y contra dev
  no se pagan 9 round-trips en serie.
- **Alcance declarado, no omnisciencia.** Son 9 tablas curadas y solo filas del usuario de la corrida. No
  es un tail del binlog —dev es compartida y todo el equipo escribe— y **no ve DELETEs** (el scrub borra
  antes de que el usuario exista, así que queda fuera igual). `displayed_lenders` **no existe**: verificá
  contra el esquema antes de sumar una tabla, no contra la memoria.

## El gate de canales

El panel gatea los canales por comercio y **la regla la decide el servidor** (`/api/canales?slug=`), no la
UI: si la UI re-derivara "esto es Corbeta" habría dos definiciones de la misma cosa. El servidor resuelve
con `bin/dbops.ts is-corbeta <hash>`, que lee el **mismo `Setting('corbeta_allieds')`** que usa el producto
en sus 3 sitios.

- **Corbeta → solo `qr`.** Detalle y el motivo exacto (que NO es "asesor está roto"): skill
  `harness-canal-qr`.
- **Cualquier otro → `asesor` · `ecommerce`.** El QR no aplica: `oldIndex` solo redirige al self-service a
  los allieds del setting; para el resto cae en `registrar-celular/{hash}`, que es el mismo tronco del
  asesor → ofrecerlo sería una perilla que no mueve nada.
- **El canal que no aplica se DESHABILITA, no se esconde** (con `title` explicando por qué). Verlo apagado
  dice que existe y que acá no corresponde; esconderlo hace creer que no existe.
- Si cambiás de comercio y el canal elegido deja de aplicar, se cae al primero permitido; si sigue
  aplicando, **no se toca** (verificado en el navegador).

**Los arranques («saltar a») también se gatean, y por CANAL** (`applyPasoGate()`): el salto es del tronco
`/merchant/*` y no todos los canales lo recorren.

| Canal | Inicio | Lenders | Por qué |
|---|---|---|---|
| `asesor` | sí | sí (con buró Sintético) | recorre el tronco |
| `ecommerce` | sí | **no** | `DIRECT_LENDERS` exige `ENTRY !== 'ecommerce'` → elegirlo no haría nada |
| `qr` | **no** | **no** | recorrido propio (registro → OTP → producto): ni monto ni marketplace |

Se apilan con el gate por modo de buró (Lenders siembra un sintético → con buró Real no hay nada que
sembrar). Cuando un arranque deja de aplicar, `step` cae a `monto` solo.

El selector de **canal** cambia la PUERTA, no el caso: el usuario sintético es el mismo y viaja **adentro**
de la URL base64, así podés correr la misma identidad entrando por asesor y por tienda y comparar.

- `asesor` → `bin/asesor`, login Cognito, wizard en `/merchant`.
- `ecommerce` → `bin/ecommerce` + `E2E_ENTRY=ecommerce` (ver skill `harness-canal-ecommerce`).
- `qr` → `bin/qr` + `E2E_ENTRY=qr` (ver skill `harness-canal-qr`).

## El botón `admin ↗` — y por qué local es distinto de los remotos

Abre el admin de `legacy-application` **del target que esté elegido** (`dev/abrir-admin.ts <ruta> <target>`),
en su propia ventana. Es un atajo de MIRAR: la mitad de la config que el flujo lee —comercios, entidades,
puntos de venta— se toca ahí.

| target | qué hace |
|---|---|
| `local` | levanta `artisan serve` y `vite` si hacen falta, y **entra sin contraseña** |
| `dev` · `staging` | abre la URL con un **perfil persistente** en `.auth/admin-<target>` |
| `qa` | no tiene admin propio (`admin.qa.creditop.com` no resuelve) — usá `dev`, comparten base |
| producción | **no está, a propósito** |

**Local entra sin contraseña** porque `bin/admin-sesion` emite la sesión con el guard real de Laravel — hay
`artisan` a mano, y el PHP aborta si `APP_ENV` no es `local`.

**Los remotos no, y no es una limitación a resolver:** no hay shell en esos contenedores, y meter una
contraseña de admin en un script del harness sería peor que la molestia que ahorra. Lo que sí se hace es
darle a cada target su perfil de navegador, así te logueás **una vez** y las siguientes ya entra. Son
cookies en disco, el mismo mecanismo con el que un navegador te recuerda.

⚠ **`.auth/` está gitignoreado** y ahí queda una sesión de admin viva. No lo commitees ni lo compartas.

⚠ **Producción queda afuera a propósito.** Esto es el panel con el que se corren flujos de prueba; un click
al admin de producción al lado del botón de correr un caso es un accidente esperando. Si hace falta entrar,
se entra por el navegador de siempre.

⚠ Y **`vite` sólo se levanta en local**: sin él Laravel sirve el bundle COMPILADO, que puede tener meses, y
verías la pantalla vieja pensando que tu cambio no funcionó.
