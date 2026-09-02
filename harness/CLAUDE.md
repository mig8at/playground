# harness · reglas de trabajo

> **Para qué existe:** es **la herramienta con la que se valida una tarea contra el código real.** No es
> contexto (eso es `context/`) ni el trabajo en sí (eso es `tablero/`): es lo que se usa para **comprobar
> corriendo** lo que en los otros dos está escrito. Si una afirmación se puede verificar acá, verificala
> antes de escribirla como cierta en un nodo.

Lo descriptivo (arquitectura en detalle, envs, Node 22.18+) vive en `README.md`. Acá van las **reglas
que ya costaron tiempo** — y el mapa mínimo para no perderse.

## Cómo está construido (7 capas, y cada una tiene un trabajo)

| Capa | Qué es | Cuándo la tocás |
|---|---|---|
| `panel/` | La UI del harness (`npm run dev` → **:5195**). Es una cáscara sobre `bin/asesor`, no un segundo motor. | Camino visual: lo maneja Miguel |
| `bin/` | **Plumbing**: launchers (`asesor` · `ecommerce` · `qr` · `panel`), los 11 `mock-*` y utilidades (`dbops.ts` · `envget.ts` · `steps-check.ts` · `preflight.ts`) | Casi nunca directo — el panel los llama |
| `dev/` | **Herramientas por consola**, una por pregunta (abajo) | Camino rápido: es TU camino |
| `pkg/` | La **librería compartida** (25 módulos): `trace.ts` (aserciones) · `db.ts` · `inject.ts` · `cognito.ts` · `qr.ts`+`qr-steps.ts` · `checkout-b64.ts` · `wizard-steps.ts` · `windows.ts` · … | Al agregar capacidad, va acá — no duplicada en dos runners |
| `mock-*/` | **la flota de mocks con launcher** (la tabla de puertos, abajo) + 2 páginas estáticas (`mock-bank/`, `mock-store/`, sin launcher: las sirve el spec) | Cuando el proveedor externo estorba |
| `channel/` | **13 suites de caracterización** (`*.spec.ts`): congelan el comportamiento ACTUAL | Antes de cambiar algo, para tener red |
| `.runs/` · `.auth/` | Forense de la última corrida (volcados, screenshots) | Cuando algo falló y hay que reconstruir |

**La cadena del camino visual:** panel (:5195) → `bin/asesor <comercio>` → `dev/guided.spec.ts`
(Playwright) → wizard real (:5174) → backend del target.

**Los mocks y sus puertos** (el launcher es `bin/<nombre>`):

| | | | |
|---|---|---|---|
| `mock-preapprovals` :8095 | `mock-redirect` :8096 | `mock-payvalida` :8097 | `mock-mdm` :8098 |
| `mock-lenders` :8099 | `mock-pdf-mapper` :8100 | `mock-forms` :8101 | `mock-abaco` :8102 |
| `mock-corbeta` :8103 | `mock-bancolombia` :8104 | `mock-financial-health` :4000 | `mock-centrales` :8105 |
| `mock-deceval` :8106 | `mock-netco` :8107 | `mock-credifamilia` :8108 | |

**Las herramientas de consola, por la pregunta que contestan:**

| Comando | Contesta |
|---|---|
| `dev/sweep.ts` | ¿qué desenlace da cada comercio × entidad? (modos `matrix` · `close` · `abaco`) |
| `dev/qr-corbeta.ts` | ¿el canal QR cierra en estado 25 con código? (por API, sin browser) |
| `dev/caminar-qr.ts` | ¿qué pantallas existen de verdad y en qué orden? (clickea solo) |
| `dev/contrato-bancolombia.ts` | ¿el mock cumple los esquemas zod del front? (`npm run contrato:bancolombia`) |
| `dev/sandbox-bancolombia.ts` | **¿el BANCO DE VERDAD acepta lo que mandamos?** el único que pega contra el gateway real (`make harness-sandbox`) |
| `dev/experian-check.ts` · `experian-api.ts` | ¿esta solicitud omitió el buró, y se puede *afirmar*? |
| `dev/loki-trace.ts` | ¿POR QUÉ terminó así? forense en los logs (`make harness-loki UREQ=…`) |
| `make harness-suite-paises` | **¿el cliente nace con el país de su comercio, su documento y su celular?** La internacionalización como aserción declarada (`suites/paises.json`, clave `espera.pais`): la REGLA contra la base + valores fijados por país. Verde/rojo con exit code. ⚠ `requiere: lambda` a propósito: sin usuarios FRESCOS la aserción mide la escritura de una corrida vieja (así apareció un dominicano con `CC` del día anterior) |
| `dev/loki-lineas.ts` | los **CUERPOS crudos** de Loki para un selector y una ventana — cuando no hay uReq que anclar (el flujo murió antes de crear la solicitud). ⚠ La sonda de `trazador-acceso` imprime **labels**, no cuerpos; y el PHP de dev **y de qa** loguea como `service_name="CreditopDev"` (F-179) |
| `dev/pantallas.ts` | **¿por qué PANTALLAS habría pasado el cliente?** el recorrido del wizard derivado del router en `main`, y al revés: `ENDPOINT=confirm-payment-schedule` → qué pantalla es (`make harness-pantallas`) |

### S3 en local: MinIO, o los documentos no existen

Sin esto, **cada subida de documento falla en silencio** y la URL que queda en la base da 404 (F-174).
No es sólo velocidad: es que **no se puede abrir el PDF que produjo una corrida**.

    docker run -d --name creditop-minio --network creditop-network -p 9000:9000 -p 9001:9001 \
      -e MINIO_ROOT_USER=creditop -e MINIO_ROOT_PASSWORD=creditop123 \
      -v creditop-minio-data:/data quay.io/minio/minio server /data --console-address ":9001"

Y en el `.env` de `legacy-backend` — **las tres, no dos**:

    AWS_ENDPOINT=http://host.docker.internal:9000     # a dónde ESCRIBE el contenedor
    AWS_USE_PATH_STYLE_ENDPOINT=true
    AWS_URL=http://localhost:9000/local-mock          # lo que se GUARDA en la base

⚠ `AWS_URL` es la que se olvida: `url()` arma la dirección con el nombre del bucket, **no** con el
endpoint, así que sin ella el archivo se guarda pero el link sigue dando 404. Los hosts son distintos a
propósito — el contenedor no resuelve `localhost` y el navegador no resuelve `host.docker.internal`.

Consola web en `:9001` (usuario y clave `creditop` / `creditop123`) para mirar los documentos.
**Para LocalStack en vez de MinIO: cambia sólo `AWS_ENDPOINT`.**

### Corridas 3× más rápidas — y qué se deja de probar a cambio

**El 86 % del tiempo de una corrida se va en fabricar PDF**, y es un costo **fijo de ~16 s por
documento**: un PDF de 14 KB tarda lo mismo que uno de 142 KB. No son los mocks (contestan en 1 ms) ni
dompdf en sí (28 ms con HTML simple).

El enrutado del generador **ya es configurable por `.env`**, sin tocar código
(`config/documents.php`: `DOC_GEN_{TIPO}` y `DOC_GEN_{TIPO}_LENDER_{ID}`). En el `.env` de
`legacy-backend`:

    DOC_GEN_PAGARE=microservice
    DOC_GEN_CONSENT=microservice
    DOC_GEN_FGA=microservice

Con eso los documentos salen del mock del pdf-mapper (:8100) en vez de renderizarse con dompdf.
**Medido: la suite de Motai baja de 95 s a 32 s; un caso suelto, de 93 s a 27 s.**

⚠ **Pide un dato:** la entidad necesita `lenders.pdf_mapper_project_slug`; sin él el flujo corta con
`Lender N is not configured for pdf-mapper-service`. En local se le pone cualquier valor —el mock acepta
todos—; en producción **sólo Credifamilia lo tiene**, y por eso es la única que hoy va por microservicio
(y por eso es 10× más rápida que Motai en local: su PDF lo hace un mock de 1 ms).

⚠⚠ **QUÉ SE PIERDE, Y NO ES POCO.** Con los documentos saliendo del mock, la corrida **deja de ejercitar
las plantillas Blade**. O sea que deja de atrapar exactamente la clase de bug de **F-150**: un builder
que produce claves que la plantilla no espera revienta con «Undefined variable» **en pleno render**, que
no es un documento con huecos sino **una firma caída** — y ya ocurrió en producción. Prenderlo mientras
se itera sobre reglas de negocio es razonable; **dejarlo prendido para validar documentos convierte el
verde en mentira**.

### El desenlace de un rt=1: el webhook, y el monolito viejo corriendo en local

Un rt=1 (Welli, Meddipay, Bancolombia, Prami) **no cierra en plataforma**: la entidad decide afuera y
avisa después. `legacy-backend` **no tiene ninguna ruta que reciba ese aviso** (F-170) — el receptor vive
en `legacy-application`. Y eso **se puede correr en local**, contra la MISMA base:

    cd ~/Desktop/CREDITOP/github/legacy-application && php artisan serve --port=8000

Con eso, un caso pide su desenlace y **el receptor es real**; lo único simulado es la entidad que llama:

    make harness-caso CASOS='#ddc769bd:23@webhook=fulfilled' LAMBDA=1 CERRAR=1

⚠ **Es OPT-IN a propósito.** Nunca pasa solo: el código que corre no es el de `legacy-backend`, y un
desenlace automático se leería como si lo fuera.

⚠ **Tres trampas que ya costaron y no se ven venir:**
- **Rutea por SUBDOMINIO** — el webhook vive en `api.localhost`, las de cliente en `aliados.localhost`.
  Pegarle al host pelado no da 404 sino **405 «Supported methods: GET, HEAD»** (cae en la ruta fallback),
  que manda a revisar el verbo cuando el problema es el Host.
- **`fetch` de Node DESCARTA el header `Host`** —es forbidden en el estándar— sin avisar, así que hay que
  poner el subdominio en la URL. `api.localhost` resuelve solo, sin tocar `/etc/hosts`.
- **Sin `WELLI_WEBHOOK_TOKEN` en el `.env` de application** el guard rechaza con 401 aunque el llamante
  traiga token.

⚠ **Y el desenlace que observes es el de HOY, no el de mañana**: los `STATUS_MAP` de los dos repos
difieren. Medido: `pendiente_desembolso` da **28** (application) y está escrito como **11** en
legacy-backend. El runner lo demuestra corriendo, no leyendo.

#### rt=0 también tiene desenlace, y es la familia más grande

«Redirige a la web de la entidad» describe la ida. La vuelta es un webhook **genérico** —uno solo para
Addi, PayJoy, Brilla, Sistecrédito—, no uno por entidad como en rt=1:

    export SELFMANAGER_TOKEN=<token de Sanctum con habilidad selfManager>
    make harness-caso CASOS='#0b3fef6a:6@webhook=completed' LAMBDA=1 CERRAR=1

El token se emite **una vez** en `legacy-application` —Sanctum guarda el hash, no el texto, así que el
que ya está en la base no sirve—:

    php artisan tinker --execute="echo \App\Models\User::find(<id>)->createToken('harness-local', ['selfManager'])->plainTextToken;"

⚠ **El `lender_id` del payload es el SLUG y no es estable entre ambientes** (el lender 6 es `addi` en
producción y `credifamilia-addi` en el dump local), por eso el runner lo lee de la base.

⚠ **Son DOS pasos**: el webhook no crea nada, busca lo que el flujo real ya dejó. El runner prepara la
transacción invocando `selfManager()` de la entidad por `artisan tinker` —su código real, no un INSERT
nuestro— y recién después dispara el webhook. Ver F-171 para las tres guardas rotas que hay ahí.

**Mapeo comprobado:** `completed`→11 · `failed`→6 · `cancelled`→7.

### El eje que las corridas por API no cubren: qué VEÍA el cliente

`caso.ts` va por API y no abre el navegador — por eso es rápido y paralelizable. Lo que pierde es la
pantalla: una corrida dice «HTTP 500 en `confirm-payment-schedule`» y nadie sabe dónde habría estado
parado el cliente, que es lo que preguntan producto, soporte y QA.

`make harness-pantallas ENDPOINT=<endpoint>` contesta eso **sin integrar nada**: no maneja el navegador,
no corre nada, no valida. Deriva el recorrido de `apps/loan-request-wizard/app/routes.ts` en `main` —el
router mismo—, así que una pantalla nueva aparece sola y una borrada desaparece sola.

⚠ **Es un techo, no una traza.** Dice qué PUEDE llamar cada pantalla, no qué llamó en tu corrida: sale
de lo que la pantalla importa. La salida distingue los dos niveles —`→` lo llama esa pantalla, `·` está
en un paquete que importa— y no hay que leerlos igual.

## Cuándo cargar una skill

Lo profundo por canal vive en skills, y se carga solo cuando hace falta:

| Skill | Cargala cuando |
|---|---|
| `harness-canal-qr` | trabajés el canal QR / Corbeta / Bancolombia (el más grande: mocks del banco, contrato zod, las 9–10 pantallas) |
| `harness-panel` | toques el panel: el mapa del recorrido, `CAPS`, el selector de comercio, el switch de front/Cognito, `dbops activity` |

> Propuestas para el panel salidas de las corridas de las cinco familias (semáforo de mocks,
> desenlace por familia, webhook de la entidad, entidades que van a reventar, plazos, documentos):
> `panel/MEJORAS-DESDE-LAS-CORRIDAS.md` (2026-08-24). Respetan la regla: el panel corre, no valida.
| `harness-canal-ecommerce` | trabajés la entrada por tienda (URL base64) y su techo actual |

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

Hay **93 `.catch(() => {})`** en `dev/guided.spec.ts` (medido el 2026-09-02; el 31/7 eran 94 y antes 82 —
si el número te importa, contalo: `grep -c 'catch(() => {})' dev/guided.spec.ts`). El único paso blindado
es el salto a `/lenders`,
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

- **Forense de logs — `dev/loki-trace.ts` (`pkg/loki.ts`).** Después de una corrida: ¿por qué terminó
  así? La BD dice el desenlace, los logs dicen la causa — una regla que excluyó un lender **no mueve
  ningún estado**, así que es invisible para la traza contrastada. Colapsa la solicitud a un resumen
  (fallas deduplicadas con `×N`, una fila por entidad evaluada con su regla y veredicto, el recorrido del
  backend, y los silencios entre peticiones) y vuelca todo a `.runs/forense-<ureq>/`.
  **Se dispara solo** al cerrar los dos runners (`forenseAlCerrar`), y **solo si el veredicto salió mal o
  a mitad**: si cerró como se pedía no consulta nada (0 ms). En `guided.spec.ts` va **antes** de los
  `expect` a propósito — `expect` lanza, así que puesto después no correría nunca justo en los fallos que
  vino a explicar. Espera `E2E_LOKI_SETTLE_MS` antes de preguntar (el batch de `LokiHandler` flushea al
  morir el proceso) y se traga cualquier error: un forense que tumba la corrida que venía a explicar es
  peor que no tenerlo.
  ⚠ **NO es una fuente de aserción y no debe entrar en `veredicto()`**: la ausencia de una línea tiene
  cuatro causas indistinguibles (no se logueó · el level la filtró · el batch no hizo flush · lag de
  ingesta). Su exit code dice si se pudo *mirar*, no si el negocio pasó — nunca devuelve 1.
  ⚠ Solo ve **legacy-backend**: el `trace_id` no se propaga entre servicios (los Go no lo emiten), y solo
  encuentra traces que traigan el uReq en su `context` (~8% de las líneas ancla el resto). Lo declara al
  imprimir; leé ese bloque antes de concluir de una ausencia.
  **Tres modos, los elige solo y los anuncia:** *completo* (ancla + expande por trace) · *degradado* (hay
  ancla, no hay trace) · *ventana* (no hay ancla: todo lo de la ventana, **solo con Loki local**, atado a
  la URL y no a una perilla — contra uno compartido serían corridas ajenas).

**Observabilidad en local: `make harness-obs-up`** (Loki + Tempo **reales** en Docker — un mock
obligaría a reimplementar LogQL). La receta completa del `.env` del backend está en `README.md`
§Observabilidad. La trampa que no perdona: **`LOG_CHANNEL=loki`, no `stack`** — `stack` incluye
`dynamodb` con `ignore_exceptions => false` y sin credenciales de AWS la excepción **rompe el request**.

⚠ **NO apuntes el target `local` al Loki de dev.** Con la BD funciona (leés las filas que tu corrida
escribió); con Loki no, porque tu corrida local no escribió allá: leerías la corrida de otro cuyo
`user_request_id` coincide — y coincide, la BD local es un dump de dev y los id avanzan en el mismo rango
(2026-08-04: local 464664, dev 464620). `pkg/loki.ts:porQueNo` lo **bloquea**.

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

⚠ **Y hay un tercer eje que ninguno de los dos cubre:** los **esquemas zod del front**. El runner por
consola pega contra el backend, que es más laxo, así que puede estar **verde con el recorrido visual
roto** (F-88). Si trabajás Bancolombia, cargá `harness-canal-qr` y corré `npm run contrato:bancolombia`.

## `caso.ts`: tres cosas que aprendió el 2026-09-02, y que valen para cualquier runner

- **El veredicto del runner y lo que quedó en la base son DOS cosas.** Al cerrar, `caso.ts` imprime
  `base: quedaron N usuario(s) y M solicitud(es) nuevos` contando desde una línea base tomada al
  arrancar — y si dijo **cero** pero la base creció, lo dice con todas las letras. Motivo: tres veces
  (F-176, F-180, la corrida de 42) reportó «0/N cerraron» con la base llena de usuarios íntegros: el
  guard de escrituras cortó DESPUÉS de que la API ya había escrito, o el gateway devolvió 504 a los 60 s
  mientras PHP seguía y terminaba. **Leé esa línea antes de repetir una corrida «fallida»** contra la
  compartida: repetirla duplica los datos.
- **El comercio se resuelve por `#hash`, por SLUG exacto o por NOMBRE (subcadena), en ese orden.** Antes
  sólo por nombre con `LIKE`: `pullman` andaba porque «Amoblando Pullman» lo contiene, y `viva-tu-credito`
  —el slug real— daba «no encontré el comercio». Una tanda de 40 sacada de la base por slug falló entera.
- **El país del comercio NO se adivina.** `paisDelComercio()` reintenta una vez y si el payload no
  responde, el caso **aborta diciendo por qué**. Antes caía a Colombia en silencio: contra un backend
  saturado el dominicano y el peruano recibían teléfonos de forma colombiana, el peruano ni registraba
  (10 dígitos contra 9) y el fallo se leía como del backend. Un fallback que esconde la saturación es
  peor que fallar. ⚠ La rama del timeout está tipada pero **no ejercitada de punta a punta**: el prevuelo
  frena antes cuando la API está caída, y no encontré forma barata de que sólo el payload del comercio
  tarde. Si la ves disparar, anotalo.

- **Hay UN solo camino de ejecución, y `--lambda` sólo DICTA el buró.** Hasta el 2026-09-02 había dos:
  el flujo real por la API y un «sintético» —default sin `--lambda`— que insertaba la solicitud a mano,
  inyectaba el buró con `synthFill` y pedía el listado v1 que el wizard no usa. Cada bug de esa semana fue
  «arreglé un camino y el otro no» (teléfono por país, país sin adivinar, clave del error). Ahora
  `harness-caso` sin `LAMBDA=1` corre el flujo real con el buró que tenga el ambiente — que es lo que ve
  un cliente—; con `LAMBDA=1`, además, se dicta la respuesta de cada central para esa cédula. `synthFill`
  sólo queda para el cupo del codeudor.

- **Un solo helper HTTP con bitácora, y el listado está adentro.** `llamar()` es la única implementación;
  `get`/`post` son dos verbos sobre él. Antes eran dos copias que divergían (timeout 90 s vs 150 s, cómo
  reportaban un cuerpo no-JSON, y sólo una distinguía timeout de caída), más `http()` en el camino
  sintético. Y `lenders-v2` —**la** llamada que da sentido al caso— iba por `fetch` crudo y era la única
  del recorrido que no quedaba en la bitácora. Los tres `fetch` que siguen crudos son lecturas PREVIAS
  al caso (el payload del comercio para el tipo de documento y el país, y la sonda `vivo` del prevuelo):
  ahí no hay bitácora todavía.
- **Los `.catch` silenciosos NO eran 24 deudas.** Censo del 2026-09-02: 23 son lecturas de la base cuyo
  `null` se chequea en la línea siguiente («no encontrado o base caída», y el llamador lo trata igual).
  **Uno** violaba la regla de F-03: el dictado del score de Experian iba con `.catch(() => {})`, así que
  si fallaba el caso corría con el score por defecto del mock y el reporte decía igual «buró dictado» —
  Agildata sí se verificaba, Experian no. Ahora cuenta como dictado fallido. Si el número te importa,
  contalo (`grep -c 'catch(() => ' dev/caso.ts`) y mirá la línea siguiente antes de llamarlo deuda.

⚠ **Y dos límites del entorno que hay que tener presentes al leer tiempos:** local sirve PHP con
`artisan serve`, **monohilo** — mide correctitud, no capacidad (F-181)—; y `qa` es ¼ de vCPU, 512 MB y
una sola tarea, con el ALB cortando a los 60 s: con 6 casos a la vez cierra, con 42 devuelve 504 mientras
PHP sigue escribiendo (F-180). Ninguno de los dos sirve para medir carga.

## Mocks: arrancá a mano los que nadie levanta

- `bin/asesor` levanta `mock-preapprovals` siempre (`bin/asesor:120`) y, **solo con target `local`**,
  payvalida + mdm + lenders + forms + **ábaco** + **financial-health** (`bin/asesor:189-199`).
  `mock-redirect` lo levanta `bin/ecommerce` (`bin/asesor:56`). Contra `dev` no se levanta ninguno de
  esos seis. `mock-financial-health` es distinto al resto: **no inventa datos** — lee el usuario
  sintético REAL de la BD local (por eso ocupa el `:4000` que el `.env` del wizard ya apunta). Ver F-70.
- **Los cuatro de Credifamilia no los levanta nadie.** Si tu flujo toca rt=4, corré vos
  `bin/mock-pdf-mapper start` (:8100, la vinculación **y el merge del paquete**), `bin/mock-deceval start`
  (:8106, el pagaré), `bin/mock-netco start` (:8107, la firma) y `bin/mock-credifamilia start` (:8108, la
  **radicación**). Faltando uno de los tres primeros, la solicitud queda en **estado 28** con un mensaje
  que habla del proveedor y no del mock (F-165).
  ⚠ **El cuarto es distinto y peor**: sin él la solicitud llega igual a **estado 11**, el endpoint
  devuelve **200** y el runner dice «cerró» — pero el backend salió al **sandbox real del lender**, dio
  504, y el crédito **nunca se radicó** (F-168). `dev/caso.ts` ya avisa los cuatro en el prevuelo cuando
  el caso va a cerrar, y ahora reporta el estado de la radicación en cada cierre.
- **Si editás un mock, asegurate de que el proceso que corre sea ese código** (F-87). Node no recarga el
  módulo: `start` veía el puerto respondiendo y salía con `✓ ya arriba`, sirviendo la versión anterior — el
  arreglo no se aplicaba y **nada lo avisaba**. `mock-bancolombia` y `mock-corbeta` ya lo resuelven solos:
  publican en `GET /` la huella `codigo` (mtime de su `server.mjs`) y su launcher reinicia si difiere. Los
  otros mocks **todavía no**: ahí reiniciá a mano (`bin/<mock> stop && bin/<mock> start`). Y cuando un
  arreglo "no hace nada", la primera pregunta es si lo que corre es lo que editaste.

## Qué es real en cada target

**La regla del harness: `local` mockea, `dev` y `staging` prueban contra lo real.** Si en dev algo sale
por un mock, dev deja de ser representativo y la prueba no vale.

| | `local` | `dev` | `staging` | `qa` |
|---|---|---|---|---|
| pre-aprobaciones | mock `:8095` | **MS real** `pre-approvals-service…:8082` | MS real | MS real |
| payvalida · mdm · lenders · forms · ábaco | mocks | reales | reales | reales |
| backend (rama que sirve) | local (sail/Docker) | `legacy-backend` → **develop** | `legacy-backend-stg` → **staging** | `legacy-backend-qa` → **qa** |
| BD | local (sail/Docker) | dev real (compartida) | **la misma de dev** | **la misma de dev** |
| front | local `:5174` | local `:5174` | **desplegado** (`originaciones-stg`) | **desplegado** (`originaciones-qa`) |

⚠ Hasta el 2026-08-19, `.env.staging` apuntaba a **qa** (backend `-qa` + `originaciones-qa`) y el
target `staging` medía la rama equivocada. Se partió en dos: `.env.staging` (ahora sí `legacy-backend-stg`
+ `originaciones-stg`) y `.env.qa` (lo que el archivo viejo siempre fue). Para saber qué rama tenés
enfrente sin adivinar: `allowed_document_types` en `GET /api/loans/allied/{hash}` **solo** lo trae `qa`.

⚠ **`dev` y `staging` NO son el mismo backend, aunque el cluster se llame igual.** En `inertia-develop`
conviven **dos servicios**: `legacy-backend` (sirve la rama `develop`, workflow `main-dev.yaml`) y
`legacy-backend-qa` (sirve **`qa`**, workflow `main-qa.yaml`). La **BD sí es compartida**, así que un dato
sembrado se ve desde los dos y todo *parece* consistente — lo que cambia es **qué código responde**.
Confundirlos hace medir la rama equivocada: probando Ábaco contra `legacy-backend` (develop) daba
`MOTV1000` porque esa rama todavía decide por los modos deprecados, y se leía como "el feature está roto"
cuando en `qa` respondía `MOTV1001`. Para saber qué rama tenés enfrente, pedí un campo que solo exista en
una: `GET /api/loans/allied/{hash}` trae `allowed_document_types` solo con motai-v2 (o sea, solo en `qa`).

## Reglas sueltas

- **No corras `npm test` pelado**: colecta 98 tests en 35 archivos e incluye `dev/guided.spec.ts`, que es
  interactivo (`testIgnore` solo saca `_scratch/` y los reportes — `playwright.config.ts:28`). Pasá rutas.
- **En toda llamada por API mandá `x-cognito-identity-id`**: sin ese header `update-user-request` pone
  `corporate_user_id = NULL` y te borra el asesor de la solicitud en silencio (F-46).
- **El scrub por consola va con `E2E_TARGET=local` EXPLÍCITO** en el env del hijo: `bin/dbops.ts` es otro
  proceso, su default es **dev**, y ahí el guard de escrituras compartidas lo bloquea (F-53) sin que se note.
- El panel lanza `bin/asesor <slug>` **sin `auto`** (`panel/server.ts:153`) → siempre modo manual. El
  guiado es solo por terminal, y ahí el **comercio va primero**: `bin/asesor <comercio> auto`.
- Si matás `bin/asesor` con `kill -9`, verificá que el wizard recuperó su `.env.local`: queda en
  `.env.local.asesor-bak` y solo lo restaura el `trap EXIT` (`bin/asesor:198-201`).
- **No te quedes con el puerto del panel (:5195).** Si dejás una instancia tuya corriendo, el
  `npm run dev` de Miguel no arranca. Ya pasó dos veces: levantalo solo si lo vas a usar, y bajalo.
- **El wizard local no arranca sin instalar el monorepo con pnpm.** Da
  `Cannot find module '@radix-ui/react-collapsible'` (declarado en `packages/ui/package.json` y en el
  lock, pero no materializado). ⚠ El monorepo usa **pnpm** (hay `node_modules/.pnpm`): un `npm install`
  falla con `Cannot read properties of null (reading 'name')` — sin tocar el lock, pero sin instalar nada.
  Es `pnpm install` en la raíz del monorepo.
