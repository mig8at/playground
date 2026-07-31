# frontend-e2e · reglas de trabajo

Lo descriptivo (arquitectura, cadena panel → `bin/asesor` → spec, tabla de mocks, envs, Node 22.18+) vive
en `README.md`. Acá van **solo** las reglas que ya costaron tiempo.

## Cada corrida destruye la anterior — hacé la forense ANTES

`bin/asesor` arranca siempre con `scrubphone` (`bin/asesor:99`), que borra los users cliente del teléfono
de bypass **y sus `user_requests`**, con `FOREIGN_KEY_CHECKS=0` (`pkg/asesor.ts:178-197`). No hay undo.

- Antes de borrar, el scrub **vuelca lo que está por perderse** a `.runs/ureq-<id>.json` (estado, lender,
  records). Si te falta una corrida vieja, entrá por ahí.
- Si `user_requests` te da vacío para un id que imprimió una corrida vieja, no concluyas "nunca existió":
  lo borró el scrub (F-52). Mirá `.runs/`.
- `user_request_records` **no** está en `childTables` (`pkg/asesor.ts:17-24`) → sobrevive huérfano. Es lo
  único que permite reconstruir a posteriori; entrá por ahí.

## No le creas al verde

Hay **82 `.catch(() => {})`** en `dev/guided.spec.ts`. El único paso blindado es el salto a `/lenders`,
que distingue "ventana cerrada" y **tira** (`dev/guided.spec.ts:538-545`); el resto se traga el error.
`shot()` imprime `📸 <archivo>` aunque el screenshot haya fallado (`dev/guided.spec.ts:63-64`).

- Cada navegación se imprime **contrastada con la BD** (`pkg/trace.ts`): a la izquierda dónde está el
  front, a la derecha el estado real de la solicitud, con `▲` cuando la BD se movió. El navegador muestra
  la *pretensión*; la BD, lo que pasó.
- El guiado cierra con **TRAZA CONTRASTADA** (transiciones + tramos ciegos + alertas) y un **VEREDICTO**.
  Falla si la solicitud terminó Cancelada/Negada sin pedirlo, **o si el front mostró una pantalla de
  éxito con la BD sin sellar** (el patrón exacto de F-50). Leé ese bloque, no el "1 passed".
- Un **tramo ciego** largo (muchas pantallas sin una sola transición) es la firma de un flujo que avanza
  en pantalla sin persistir: la traza lo señala solo.
- Si escribís pasos nuevos, no envuelvas en `.catch` vacío el paso que le da sentido a la corrida (F-03).

## Mocks: arrancá a mano los que nadie levanta

- `bin/asesor` levanta `mock-preapprovals` siempre (`bin/asesor:120`) y, **solo con target `local`**,
  payvalida + mdm + lenders + forms + **ábaco** + **financial-health** (`bin/asesor:189-199`).
  `mock-redirect` lo levanta `bin/ecommerce` (`bin/asesor:56`). Contra `dev` no se levanta ninguno de
  esos seis. `mock-financial-health` es distinto al resto: **no inventa datos** — lee el usuario
  sintético REAL de la BD local (por eso ocupa el `:4000` que el `.env` del wizard ya apunta). Ver F-70.
- **`mock-pdf-mapper` no lo levanta nadie.** Si tu flujo toca la vinculación de Credifamilia, corré
  `bin/mock-pdf-mapper start` vos.

## Dos caminos, y cada uno tiene su dueño

- **Rápido — es TU camino (el del agente), por CLI.** `dev/sweep.ts`: el flujo por API, sin navegador.
  Segundos. Modos `matrix` · `close` · `abaco`. **Exit code = veredicto**: `0` cerró · `1` desenlace malo
  o el front mintió · `2` quedó a mitad. Usalo para analizar contra BD y backend mockeado.
- **Visual — es el camino de MIGUEL, por el panel** (`npm run dev`). `dev/guided.spec.ts`: el wizard
  real con bypasses. Sirve para lo que un mock no puede dar: interactividad, render, comportamiento del
  front.

- **Forense — `dev/experian-check.ts`.** Después de una corrida: ¿esta solicitud omitió Experian, y se
  puede *afirmar*? "No hay fila de buró nueva" tiene **tres** causas distintas (flujo firmado · la
  compuerta de frecuencia cortó antes · caché de 1 mes), y hay que descartar dos para creerle a la
  tercera. Mismo contrato que el rápido: **exit code = veredicto** (`0` probada · `1` sí se consultó ·
  `2` no concluyente). Detalle en F-60.

**No metas el modo rápido en el panel.** Ya se intentó y se revirtió: el panel existe para probar el
FRONTEND a mano; el rápido es una herramienta de análisis por consola. Mezclarlos confunde para qué
sirve cada uno. Si necesitás correr el rápido, es `node dev/sweep.ts …`, no un botón.

Los dos usan **la misma** capa de aserción (`pkg/trace.ts`: traza contrastada + `veredicto()` +
`ESTADO_ESPERADO`). No dupliques esa lógica en ninguno de los dos — tener dos definiciones de "pasó" es
como empiezan a derivar, y ahí una divergencia deja de ser diagnóstico y pasa a ser ruido.

**Cómo leer una divergencia:** mismas aserciones, distinto transporte ⇒ si el rápido pasa y el visual
falla, el problema está en el **frontend**. **Pero no al revés:** hay bugs que solo existen en el visual
y el rápido nunca los va a ver — F-50 fue una cancelación disparada por el routing del wizard
(`request-canceled` cancela en el loader), con el backend haciendo todo bien. El rápido valida negocio
y backend; el visual valida el camino real del usuario, que también tiene lógica de negocio.

## El recorrido del wizard en el panel (`panel/steps.json`)

Canvas SVG **vertical** y arrastrable (drag · rueda = zoom · doble clic = encuadrar), estilo grafo de
git: tronco común hasta `/lenders` y de ahí un carril por `response_type`. Dibuja **solo los carriles
que ese comercio tiene** (mira el `rt` y el `product` de sus entidades). El hover de cada nodo lista
los archivos del paso.

**INVARIANTE: el mapa depende del COMERCIO, no del ambiente.** Describe la lógica de CreditOp, así que
el mismo comercio dibuja el mismo recorrido en local, dev y staging. Dos reglas lo sostienen, y si las
rompés el diagrama vuelve a cambiar de forma según el target (F-64):

- **No filtres por `lender_status`.** Prender o apagar una entidad no cambia POR DÓNDE pasa el flujo,
  solo si hoy lista. Eso se anota (`(apagado)` + carril atenuado), no se borra.
- **Un carril por RECORRIDO, no por entidad.** La clave es `rt + product + desvíos + extensiones`: dos
  entidades del mismo producto recorren lo mismo (es la misma razón por la que el color va por
  producto). Usar la identidad del lender ata el dibujo al padrón de cada base.

Y lo que el mapa **no puede** dibujar hay que decirlo en `#trenwarn`: sin entidades, o sin la columna
`lenders.product` (dev todavía no la tiene), un recorrido vacío o achatado se lee como "este comercio
no tiene esos flujos" cuando en realidad faltó el dato.

**Por qué vertical y no horizontal** (ya se probó y se revirtió): en horizontal la bifurcación cae al
final del tronco y los carriles arrancan al principio, así que la curva de unión vuelve cruzando todo el
diagrama. Medido: bifurcación en x=456, carril de 8 nodos ≈900px, contenedor 1238 → no entra. Girando el
eje, el largo se gasta en alto (que se recorre arrastrando) y la curva queda corta.

**Por qué sin librería de grafos** (D3 / vis-network se evaluaron): son ~20 nodos en carriles paralelos,
o sea posiciones que ya conocemos — un motor de layout no tiene nada que resolver. El criterio: *¿puedo
ubicar los nodos a mano sin que se crucen las aristas?* Si sí, CSS/SVG. Donde **sí** habría un grafo real
es el árbol de `context`: 33 nodos, 342 archivos compartidos, 1.578 aristas implícitas.

- **Qué cuenta como archivo del paso** (respetalo si lo editás): la ruta del front + los servicios que su
  loader/action invoca, y el controlador del endpoint + los servicios de dominio que llama. **No** utils,
  ni tipos, ni cierre transitivo de imports. Si el número no significa "lo que este paso toca de verdad",
  es decoración con cara de dato.
- **Validá siempre después de tocarlo:** `node bin/steps-check.ts` (sale ≠0 si alguna ruta no existe). El
  panel además muestra un aviso si el chequeo falla — un conteo que ya no resuelve es peor que nada.

## El panel no ofrece lo mismo en todos los targets (`CAPS`)

El panel es una UI sobre `bin/asesor`, y **`bin/asesor` no levanta lo mismo en cada target**. Una perilla
que no mueve nada es peor que no tenerla: te deja creyendo que probaste algo que nunca se aplicó.

**La regla del harness: `local` mockea, `dev` y `staging` prueban contra lo real.** Si en dev algo sale
por un mock, dev deja de ser representativo y la prueba no vale.

| | `local` | `dev` | `staging` |
|---|---|---|---|
| pre-aprobaciones | mock `:8095` | **MS real** `pre-approvals-service…:8082` | MS real |
| payvalida · mdm · lenders · forms · ábaco | mocks | reales | reales |
| backend (rama que sirve) | local (sail/Docker) | `legacy-backend` → **develop** | `legacy-backend-qa` → **qa** |
| BD | local (sail/Docker) | dev real (compartida) | **la misma de dev** (compartida) |
| front | local `:5174` | local `:5174` | **desplegado** (`originaciones-qa`) — o local, con el switch |

⚠ **`dev` y `staging` NO son el mismo backend, aunque el cluster se llame igual.** En `inertia-develop`
conviven **dos servicios**: `legacy-backend` (sirve la rama `develop`, workflow `main-dev.yaml`) y
`legacy-backend-qa` (sirve **`qa`**, workflow `main-qa.yaml`). La **BD sí es compartida**, así que un dato
sembrado se ve desde los dos y todo *parece* consistente — lo que cambia es **qué código responde**.
Confundirlos hace medir la rama equivocada: probando Ábaco contra `legacy-backend` (develop) daba
`MOTV1000` porque esa rama todavía decide por los modos deprecados, y se leía como "el feature está roto"
cuando en `qa` respondía `MOTV1001`. Para saber qué rama tenés enfrente, pedí un campo que solo exista en
una: `GET /api/loans/allied/{hash}` trae `allowed_document_types` solo con motai-v2 (o sea, solo en `qa`).

Dos mecanismos, y **no son intercambiables**:

- **`E2E_REAL_PREAPPROVALS`** (en `.env.<target>`, hoy `1` en dev y staging) decide si se usa el mock de
  pre-aprobados. `bin/asesor` lo lee **por la cadena (`envget`)**, no del shell: si lo leyera del shell,
  ponerlo en `.env.dev` no haría nada. El panel pregunta lo mismo al servidor (`/api/lenders` →
  `mockPA`) y muestra el selector de estado por entidad **solo cuando el mock contesta**. Atarlo a una
  lista de targets se desincroniza el día que alguien cambia la variable.
- **`const CAPS`** (en `panel/index.html`) es para lo que **sí** depende del target: hoy solo
  `flotaLocal` (los seis mocks que `bin/asesor:189-199` levanta únicamente en local). Si agregás un target,
  agregalo ahí — el default de `cap()` es el más restrictivo a propósito: enumerar targets a mano fue lo
  que dejó a staging afuera del guard de escrituras cuando se sumó.

**En pantalla se avisa solo lo que está ROTO**, no lo que es normal en ese ambiente. Un cartel que dice
"acá esto no aplica" es ruido y se lee como error. Lo que hay que saber para interpretar la vista vive
en los comentarios del código y acá:

- **sin selector de estado por entidad** → esa corrida usa el MS real; el desenlace lo decide el proveedor.
- **el mapa sin carriles** → esa sucursal no tiene entidades en ese target.
- **los CreditopX en un solo carril `rt2`** → ese ambiente no tiene la columna `lenders.product` (hoy dev)
  y no se pueden separar por producto. Ver **F-64**.

## Comprobación de BD al cerrar la corrida (`dbops activity`)

Al **terminar** la corrida (Detener o fin natural — `child.on('close')` en `panel/server.ts`) el panel hace
**UNA** consulta `dbops activity <duración>`, deriva el veredicto (estado final, flujo, si se consultó/inyectó
el buró) y lo vuelca a **la consola de la corrida** (queda ahí como post-mortem) + a `.runs/`. Existe porque
el modo **manual** del panel es ciego: la pantalla muestra la *pretensión* y nadie muestra lo que se persistió
(el patrón de F-50). Complementa a `pkg/trace.ts`, que solo corre en el guiado.

**No se pollea durante la corrida (2026-07-22).** Antes se consultaba cada 2s y se pintaba una grilla de
puntos por tabla; se sacó porque cada tick arrancaba un proceso + una conexión nueva a dev (~700ms) y cargaba
la BD **compartida** casi a la mitad del tiempo, sin aportar mucho. La foto al cierre alcanza y es más barata.
Alinea con [[harness-panel-inyecta-no-valida]]: el panel corre flujos, la lectura/veredicto es al final.

Tres cosas que hay que respetar si lo tocás:

- **La ventana la mide la BD**, no node: `dbops activity <segundos>` filtra con `NOW() - INTERVAL n
  SECOND`. Contra dev la base es remota y comparar contra el reloj local perdería eventos o traería
  basura vieja. Al cierre, `<segundos>` = duración de la corrida.
- **Las 9 tablas van EN PARALELO, cada una en su propio `try`** (`Promise.all` en `bin/dbops.ts`): si una
  columna no existe en ese ambiente se pierde ESA fila, no la vista entera (lección de F-64), y contra dev
  no se pagan 9 round-trips en serie.
- **Alcance declarado, no omnisciencia.** Son 9 tablas curadas y solo filas del usuario de la corrida.
  No es un tail del binlog —dev es compartida y todo el equipo escribe— y **no ve DELETEs** (el scrub
  borra antes de que el usuario exista, así que queda fuera igual). `displayed_lenders` **no existe**:
  verificá contra el esquema antes de sumar una tabla, no contra la memoria.

## Elegir comercio: los curados y el buscador

En el panel conviven dos entradas, y **no son redundantes**:

- **Las tarjetas** (`MERCHANTS` en `panel/index.html`) están curadas por lo que **ejercitan** — Motai =
  renting/RTO, CeluRD = SmartPay/IMEI, Sonría = el listado más rico, Mediarte = rt2 al 0% con
  Credifamilia rt4 al lado. Eso es conocimiento, no comodidad: no las cambies por el buscador.
- **El buscador** va contra la BD del target, en **dos pasos: comercio → SUCURSAL**. El segundo paso no
  es adorno: lo que se lanza es un hash de **sucursal**, y `dbops list` devuelve `MIN(hash)` — buscar
  "motai" da `5cb92b54` (*Motai Boyaca*), no `f0548728` (*PRINCIPAL*). Resolver "una sucursal
  cualquiera" ya causó que la card mostrara una y el flujo corriera contra otra.

Al elegir del buscador, el `slug` **es el hash**: `.flows.json` no conoce esa sucursal, y tanto
`branchHashForSlug` (panel) como `bin/asesor` caen a "si parece hash de 8 hex, es el hash".

**★ Guardar como favorito** lo escribe en `.flows.json` con el nombre que quieras y `fav: true`. No es
cosmético: desde ahí `bin/asesor <slug>` lo reconoce **desde la terminal**, no solo el panel. El `fav`
existe para poder renombrar/borrar **solo los tuyos** — los curados no se tocan desde la UI. Y
**renombrar NO cambia el slug**: es la clave con la que un comando guardado ya funciona.

## El switch de FRONT: el pool de Cognito lo trae el front, no el target

El panel tiene un switch **Frontend**: *Del ambiente* (el desplegado del target) o *Local :5174* (tu
working copy). Existe para ver un cambio del front contra `qa` **sin esperar el deploy**. Por CLI es
`CFE_FRONT=local|ambiente`. La opción "del ambiente" aparece solo si ese target tiene un front desplegado
configurado (`E2E_BASE_URL`), y eso lo resuelve el servidor por la **misma cadena** que `bin/asesor` — no
una lista de targets en el panel, que se desincronizaría.

⚠ **Con front local, el pool de Cognito es el de DEV aunque el backend sea el de qa.** El wizard local
trae su propia config de Cognito en el `.env` del monorepo (`login.creditop.com` + su `client_id`) y
`bin/asesor` solo le pisa las URLs de API. Consecuencias, las dos ya cableadas:

- la corrida se loguea con la cuenta de **`.cognito.json`** (`a.arismendy`, pool de dev), no con la de
  `.env.staging` (`oscar+dentix`, otro pool) — `bin/asesor` vacía `E2E_COGNITO_USER/PASS` para que caiga
  ahí sola, y lo canta en el log (`● cognito  front local → pool de dev`);
- el cache de sesión se llama por **front**, no por target (`pkg/cognito.ts`): `staging + front local`
  usa `cognito-state.dev.json`. Cachearlo como 'staging' hacía replayar cookies de OTRO origen y
  re-loguear con la cuenta del pool equivocado — se ve como un login que se queda en `verifyPassword`
  hasta el timeout, que es lo que pasó la primera vez que se probó el switch.

Funciona porque **dev y staging comparten la BD**: el `sub` del asesor es el mismo para los dos backends,
así que el permiso a la sucursal vale igual. Si algún día dejaran de compartirla, esto se rompe.

## `CFE_FRONT` es un SWITCH, no una ruta (y el log del wizard mentía)

Dos bugs de `bin/asesor` que juntos cuestan 8 minutos por corrida, arreglados el 2026-07-31 — si tocás
esa zona, no los deshagas:

- **`CFE_FRONT` tenía dos sentidos.** Abajo es el switch de front (`local|ambiente`, que es **lo que manda
  el panel**) y arriba se usaba como la RUTA del monorepo. Con `CFE_FRONT=local` la ruta quedaba en
  `local/apps/loan-request-wizard` → `cd: No such file or directory`, el wizard nunca arrancaba **y el
  script igual esperaba 480 s "compilando"** antes de rendirse. Ahora se resuelve por valor: `local` y
  `ambiente` son modos; cualquier otro valor sigue siendo una ruta (compat), y `CFE_FRONT_PATH` la fija
  explícita. Se agregó además un guard: si el directorio no existe, corta al instante con el path a la vista.
- **El log del wizard no se truncaba antes de lanzar.** Si el arranque fallaba sin llegar a escribir, el
  `tail -15` mostraba el log de la corrida ANTERIOR: un `Cannot find module '@radix-ui/react-collapsible'`
  ya resuelto seguía apareciendo como si fuera el fallo actual y mandó a buscar donde no era. Ahora se
  trunca (`: > /tmp/asesor-wizard.log`) antes del `nohup`.

**Lección transferible:** cuando el arnés espera minutos y después culpa a un log, sospechá del log antes
que del producto. Un error viejo presentado como actual es peor que no tener log.

## Canal de entrada: asesor · ecommerce · qr

**El panel GATEA los canales por comercio, y la regla la decide el servidor** (`/api/canales?slug=`),
no la UI: si la UI re-derivara "esto es Corbeta" habría dos definiciones de la misma cosa. El servidor
resuelve con `bin/dbops.ts is-corbeta <hash>`, que lee el **mismo `Setting('corbeta_allieds')`** que usa
el producto en sus 3 sitios — no la lista `[24,209,210,211]` a mano, que sería el hardcode número 25 de
`hardcodes-entidades` y se desincronizaría el día que negocio agregue un comercio.

| Comercio | Canales que ofrece | Por qué |
|---|---|---|
| **Corbeta** (`corbeta_allieds`) | qr · asesor · ecommerce | los tres aplican |
| Cualquier otro | asesor · ecommerce | **el QR no aplica**: `oldIndex` sólo redirige al self-service a los allieds del setting; para el resto cae en `registrar-celular/{hash}`, que es el mismo tronco del asesor → ofrecerlo sería una perilla que no mueve nada |

Dos decisiones a respetar si lo tocás:

- **El canal que no aplica se DESHABILITA, no se esconde** (con `title` explicando por qué). Verlo apagado
  dice que existe y que acá no corresponde; esconderlo hace creer que no existe.
- **En Corbeta el asesor SÍ se ofrece.** Se verificó que ahí no está roto (F-85): al elegir Bancolombia el
  asesor no cierra nada — el flujo se **entrega al celular del cliente** (`explicacion-de-flujo` + modal de
  WhatsApp, estado 1→3) y aterriza en las mismas pantallas del canal QR. Es un paso previo, no un recorrido
  alternativo, y el hint del panel lo dice. Esconderlo sería esconder algo que sí hace algo.
  ⚠ Se intentó justificar esconderlo con "el marketplace no lista para Corbeta" y **eso es falso**:
  `lenders-v2` da 404 igual en un comercio no-Corbeta. No reuses esa inferencia.
- Si cambiás de comercio y el canal elegido deja de aplicar, se cae al primero permitido; si sigue
  aplicando, **no se toca** (verificado en el navegador).

**Los ARRANQUES («saltar a») también se gatean, y por CANAL** (`applyPasoGate()`): el salto es del tronco
`/merchant/*`, y no todos los canales lo recorren. La regla sale del spec, no de una opinión:

| Canal | Inicio | Lenders | Por qué |
|---|---|---|---|
| `asesor` | sí | sí (con buró Sintético) | recorre el tronco |
| `ecommerce` | sí | **no** | `DIRECT_LENDERS` exige `ENTRY !== 'ecommerce'` → elegirlo no haría nada |
| `qr` | **no** | **no** | recorrido propio (registro → OTP → producto): ni monto ni marketplace. Y el consumidor del salto matchea URLs `/(merchant\|ecommerce)/…`, que en este canal nunca ocurren |

Se apilan con el gate que ya existía por modo de buró (Lenders siembra un sintético → con buró Real no hay
nada que sembrar). Cuando un arranque deja de aplicar, `step` cae a `monto` solo.

La tarjeta **Alkosto** es la del canal QR: retail Corbeta con sólo 68/100 habilitados, el único que
ejercita la venta que cierra en CAJA. Los otros tres del grupo ya están en `.flows.json` y se alcanzan por
nombre: `k-tronix`, `alkomprar` y `creditop` (este último es la cuenta propia de la casa: está en el gate
pero **no** es un retail Corbeta).


El panel tiene un selector de **canal** (junto al del buró). Cambia la PUERTA, no el caso: el usuario
sintético es el mismo y viaja **adentro** de la URL base64, así podés correr la misma identidad entrando
por asesor y por tienda y comparar.

- `asesor` → `bin/asesor`, login Cognito, wizard en `/merchant`.
- `ecommerce` → `bin/ecommerce` + `E2E_ENTRY=ecommerce`; el spec arma la URL con `pkg/checkout-b64.ts`.
- `qr` → `bin/qr` + `E2E_ENTRY=qr`; el spec entra con `pkg/qr.ts`. Es la caja de un comercio **Corbeta**
  (Alkosto 209 / K-TRONIX 210 / Alkomprar 211): **autogestión pura**, sin asesor y sin Cognito.

⚠ **El canal `qr` NO PASA POR `/lenders` — y esa es su diferencia estructural**, no un límite del harness.
El QR salta a `/bancolombia/self-service/{hash}/solicitar` y **el OTP es el punto de decisión**: resuelve
la pre-aprobación y manda a `/bancolombia/{bnpl|consumo}/start/{encryptCode}` (`otp.tsx:182`) o a
`no-preapproved` (`:121`). No hay marketplace que mostrar, así que "saltar a lenders" no existe acá — por
eso `DIRECT_LENDERS` lo excluye igual que a `ecommerce`, pero por otro motivo.

Tres cosas que hay que saber para que el canal llegue al final:

- **La sucursal necesita los DOS lenders de Bancolombia (68 y 100) habilitados.** Sin eso el OTP resuelve
  `no_preapproved` y el flujo muere antes de empezar. `corbetaBranch()` sólo devuelve sucursales que
  cumplen (default la **946**, Alkosto Bogotá: es la de las 4 solicitudes reales que llegaron al estado 25
  en marzo de 2026) y el spec avisa si el hash del panel no es una de ellas.
- **El `encryptCode` de las rutas `/bancolombia/…/{code}` NO es cifrado**: es
  `base36((user_request_id << 32) | hexdec(branch.hash))` — la fórmula sale del propio backend
  (`PurchaseCodeService::sendPurchaseCodeSms`). O sea **el harness puede mintear el código de cualquier
  solicitud que siembre** y saltar directo a la pantalla que quiera, `purchase-code` incluida
  (`bancolombiaEncryptCode` en `pkg/qr.ts`). Ojo con el techo: del lado PHP `base_convert` va por float, así
  que arriba de `user_request_id ≈ 2^21` (2.097.152) el link del SMS y el decoder del front dejarían de
  coincidir. Hoy los ids van por ~400.000.
- **En el canal QR el harness AUTORRELLENA y no clickea.** `autorrellenarQr()` (pkg/qr-steps.ts) se
  engancha a **cada navegación** en los dos modos (manual y guiado) y llena lo que reconozca en la pantalla
  actual: celular, documento, OTP, monto, nombre/apellido/correo/dirección, los numéricos del formulario
  financiero, los selects (primera opción real), los radios y los checkboxes. **Nunca aprieta Continuar** —
  si lo hiciera, el camino visual dejaría de ser visual. Va por navegación y no como secuencia fija porque
  el recorrido tiene **7 formularios** y su orden depende del producto que resuelva el OTP.
- **⚠ El input VISIBLE no siempre tiene `name`.** Es al revés de lo intuitivo: react-hook-form lo controla
  por `Controller` y el atributo queda sólo en el `<input type=hidden name=X>` espejo. Verificado en el
  registro, donde `[name=phoneNumber]` matchea **sólo** el hidden y llenarlo no cambia nada en pantalla. Por
  eso cada campo se busca **primero por etiqueta** y sólo después por `name` excluyendo hidden. Y por eso el
  helper **devuelve qué llenó**: un campo que no aparece en esa lista es un campo que no encontró.
- **Verificá que el valor QUEDÓ, no que el `fill()` no tiró.** Un `fill()` exitoso no garantiza nada: si la
  hidratación llega después, React lo pisa con sus defaults. El autorrelleno re-lee el input, reintenta una
  vez y si tampoco queda lo marca `⚠no quedó` en el log en vez de darlo por hecho.
- **El canal QR NO entra en la rama manual del tronco.** Antes sí, y el log decía "manejá desde monto" y
  después "no pude leer el uReq en personal-info" — ruido puro: esa lógica espera monto → phone →
  personal-info y matchea URLs `/(merchant|ecommerce)/…` que en este canal nunca ocurren.
- **Tres trampas del formulario de autogestión** (las tres cazadas corriendo, las tres resueltas en
  `pkg/qr-steps.ts` — si tocás ese archivo, no las deshagas):
  1. **Hay que esperar la HIDRATACIÓN antes de escribir.** La pantalla llega por SSR y react-hook-form
     toma el control al hidratar: si llenás antes, React monta con sus defaults vacíos, el form queda
     inválido y **el botón nunca se habilita — sin un solo mensaje de error en pantalla**. Es el síntoma
     más engañoso posible: parece un selector roto. Y `waitFor({state:'visible'})` **no sirve** como
     señal, porque los campos y los checkboxes vienen en el HTML del SSR. La sonda real es el **toggle**
     de un checkbox: que un click cambie `data-state` a `checked` sólo pasa si el JS ya está atado.
  2. **Los checkboxes NO están dentro del `<form>`** (`closest('form')` da null) y en la página hay un
     tercer `role=checkbox` que es un `<input>` del overlay de React Router devtools. El selector que los
     separa exacto es **`button[role="checkbox"]`** (Radix los renderiza como BUTTON). Sus ids son
     generados (`_R_1j4j5_-form-item`): no sirven.
  3. **El botón de envío nace `disabled`** y se habilita cuando el form valida. Clickearlo antes tira
     timeout y se lee como selector mal escrito.
- **El registro valida unicidad teléfono↔documento.** Si el teléfono de bypass quedó con el usuario de
  otra corrida (por ejemplo del runner por API), responde «El número de celular ya se encuentra
  registrado con otra cédula» en el campo `documentNumberError` y **no avanza**. Hay que scrubbear antes
  — y el scrub va con `E2E_TARGET=local` EXPLÍCITO en el env del hijo: `bin/dbops.ts` es otro proceso, su
  default es dev y ahí el guard de escrituras compartidas lo bloquea (F-53) sin que se note.
- **Las pantallas `bancolombia/*` no tienen un solo `data-testid`** (verificado:
  `git grep 'data-testid' modules/loan-request-wizard/bancolombia-origination` no devuelve nada). Por eso
  `pkg/qr-steps.ts` selecciona por **rol y etiqueta accesible**, con el string exacto y la ruta del
  componente en cada selector: si cambia un copy, se rompe, y así se sabe dónde mirar. La deuda real es
  agregar testids a ese módulo — es un habilitador del harness, no un cambio de producto.
- **El wizard local no arranca sin instalar el monorepo con pnpm.** Da
  `Cannot find module '@radix-ui/react-collapsible'` (declarado en `packages/ui/package.json` y en el
  lock, pero no materializado). ⚠ El monorepo usa **pnpm** (hay `node_modules/.pnpm`): un `npm install`
  falla con `Cannot read properties of null (reading 'name')` — sin tocar el lock, pero sin instalar nada.
  Es `pnpm install` en la raíz del monorepo.
- **Para llegar al CÓDIGO DE COMPRA hace falta `mock-corbeta` (:8103)** y apuntar el backend:
  `CORBETA_HOST=http://host.docker.internal:8103`. `bin/asesor` lo levanta en `local`, pero el `.env` del
  backend lo tenés que tocar vos (igual que ábaco/payvalida). Ese mock reproduce **la sutileza que el
  reemplazo Corbeta→Bancolombia va a cambiar**: `validateCurrentOrder()` no evalúa el estado de la orden,
  pide las de ayer→mañana con `EstadoOrden=2` y sólo busca el PIN en la lista — o sea "si ya facturó no
  mostrar" sale del **filtro**, no de una regla escrita. `POST /_control/facturar {pin}` mueve la orden a
  estado 3 y con eso el código deja de mostrarse: es el caso que el test de caracterización tiene que
  congelar. Contexto completo en el nodo `bancolombia` de `context` y en findings **F-79..F-82**.

⚠ **Hoy el canal ecommerce NO cierra un crédito CreditopX.** Aterriza en `resolve-ecommerce-flow`, que es
el resolvedor de **Bancolombia**, y para un comercio CreditopX el flowType sale `no_preapproved` y su
loader **cancela** (F-54). Sirve para ejercitar el contrato base64 —que funciona y crea la solicitud—, no
para llegar a Aprobado. Falta portar la landing genérica (`checkout-redirection.tsx`), que vive solo en
`feat/ecommerce-checkout-integration`.

La fuente autoritativa del contrato es el plugin real: `playground/creditop-woocommerce`
(`class-creditop-gateway.php:470-512`). Está reconciliado en la cabecera de `pkg/checkout-b64.ts`.

## Reglas sueltas

- **No corras `npm test` pelado**: colecta 98 tests en 35 archivos e incluye `dev/guided.spec.ts`, que es
  interactivo (`testIgnore` solo saca `_scratch/` y los reportes — `playwright.config.ts:28`). Pasá rutas.
- **En toda llamada por API mandá `x-cognito-identity-id`**: sin ese header `update-user-request` pone
  `corporate_user_id = NULL` y te borra el asesor de la solicitud en silencio (F-46).
- **El eje ecommerce está a medias, y hay que saber hasta dónde llega** (corrige a F-40, ver F-54): el
  contrato base64 **sí funciona** y crea la solicitud, pero la landing `checkout` no existe en esta rama,
  así que se aterriza en el resolvedor de Bancolombia. Ver la sección "Canal de entrada" arriba. Los
  `channel/ecommerce-*.spec.ts` viejos sí dan 404.
- El panel lanza `bin/asesor <slug>` **sin `auto`** (`panel/server.ts:153`) → siempre modo manual. El
  guiado es solo por terminal, y ahí el **comercio va primero**: `bin/asesor <comercio> auto`.
- Si matás `bin/asesor` con `kill -9`, verificá que el wizard recuperó su `.env.local`: queda en
  `.env.local.asesor-bak` y solo lo restaura el `trap EXIT` (`bin/asesor:198-201`).
