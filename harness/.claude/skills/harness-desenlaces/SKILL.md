---
name: harness-desenlaces
description: Llevar un caso del harness hasta su desenlace y saber por qué no cierra. Usala cuando un caso deba cerrar (CLOSE=1) y se quede a mitad, cuando haya que cerrar un rt=1 (Welli, Meddipay, Prami…) o un rt=0 (Addi, PayJoy, Sistecrédito…) por su webhook, pagar la cuota inicial con el mock de Wompi (/down-payment), dictar el buró con LAMBDA=1, o antes de concluir que una entidad «no cierra» (lenders_by_allieds, pagaré 500, IPHONE_UA, timeouts del guiado).
---

# harness · llegar al desenlace

Qué hace falta para que un caso termine, por familia de entidad, y qué mirar antes de concluir que no
cierra. Vivía en `harness/CLAUDE.md` hasta el 2026-09-27.

## Dictar el buró: `LAMBDA=1`

**`harness-walk-wizard` también acepta `LAMBDA=1`, y sin él una compra de CrediPullman no cierra en
  local.** El dictado vive en `pkg/risk-lambda.ts` y lo comparten los dos runners. `synthFill` siembra
  «Empleado» al CARGAR personal-info, pero al ENVIARLA el backend consulta Agildata y Experian y evalúa
  las categorías con lo que contesten; sin dictado, el mock local contesta una persona sin empleo y un
  reporte fijo (score 654, 59 consultas, ninguna tarjeta). Con eso Premium se rechaza, el cliente cae en
  «Segunda oportunidad», que exige cuota inicial, y la corrida pasa por `/down-payment` (ver el punto
  siguiente). Con `LAMBDA=1` se
  dictan el empleo y un perfil de buró (`experian_profile_<cédula>`: score del caso, 1 consulta,
  1 tarjeta activa), una clave que sólo tiene el mock local. Medido el 2026-09-25: 0/2 → 2/2 en estado 11
  (`make harness-walk-wizard CASES='#13874eb6:77;#13874eb6:77' FLOW=ecommerce CLOSE=1 MANUAL=1 PARALLEL=1
  LAMBDA=1 TARGET=local`). Contra dev/qa se ignora: ahí el backend le pregunta a la lambda de la empresa.

## La cuota inicial: el mock de Wompi

**La cuota inicial se paga contra `make harness-wompi` (:8112), el mock de Wompi.** `/down-payment` no
  tiene action: corre en el navegador y abre el widget. El caminador hace lo que haría el cliente
  (`pkg/wompi-down-payment.ts`; no confundir con `pkg/wompi-mock.ts`, que intercepta en Playwright el checkout alojado del asesor): pide el preview y crea el intento por el proxy del wizard, le dice al mock que el
  comprador pagó (`POST /__mock/pay`) y consulta el estado hasta que sea terminal. Después sigue a
  `/first-payment-date`, como el «Continuar» de la pantalla de resultado. El backend no se entera en el
  momento: `PaymentStatusService` le pregunta a Wompi (`GET {WOMPI_HOST}/transactions?reference=`)
  cuando la transacción tiene más de 20 s, así que cada cuota tarda ~21 s. Es el camino que corre en
  producción: medido el 2026-09-25, las 121 cuotas iniciales de 30 días se confirmaron por esa consulta y
  ninguna por webhook, y la forma de la respuesta del mock es la de esas 121. Pide
  `WOMPI_HOST=http://host.docker.internal:8112/v1` en el `.env` del backend y `php artisan config:clear`;
  el `WOMPI_MOCK_ENABLED` que ya estaba no lo lee ningún código. `PAYMENT=DECLINED` prueba el rechazo (la
  solicitud queda en 3 y la fecha de pago la devuelve a `/down-payment`); `DOWN_PAYMENT=` paga más que el
  mínimo. Medido: 2/2 compras de tienda de CrediPullman en «Segunda oportunidad» cerraron en 11 con
  $500.000 de cuota inicial (`make harness-walk-wizard CASES='#13874eb6:77;#13874eb6:77' FLOW=ecommerce
  CLOSE=1 MANUAL=1 PARALLEL=1 TARGET=local`).
  **En el navegador (desde el 2026-09-25) el widget es SIMULADO** (`pkg/wompi-widget.ts`, enganchado en
  `openWindow`): se intercepta `checkout.wompi.co/widget.js` y se sirve un `WidgetCheckout` con el mismo
  contrato que muestra el monto y dos botones, **Pagar** y **Rechazar**. Cada uno registra la transacción
  en el mock (APPROVED o DECLINED) y le devuelve al wizard lo que devolvería Wompi; de ahí sigue el
  camino real (`processing` → estado → el backend le pregunta al mock). Lo único que se acorta es la
  gracia de 20 s: se atrasa el `created_at` de la transacción 25 s en la base local, así la primera
  consulta ya reconcilia. Sólo con target `local`; `E2E_WOMPI_WIDGET=0` deja el widget real.
  El caminador con `ENGINE=browser` lo instala en `openContext` (`pkg/wizard-browser.ts`) en modo
  **automático**: paga solo, sin esperar el clic, y «Registrar pago» / «Elegir fecha de pago» están en
  `ADVANCE`. Medido el 2026-09-25 por la tienda con Compucredit: el pago quedó APPROVED y el backend
  recalculó la solicitud (cuota inicial $400.000, financiado $1.600.000). El `ENGINE=http` la paga con
  `payDownPayment`.
  ⚠ La base local trae la credencial de Wompi de producción de Pullman (`pub_prod_…`): con el mock la
  consulta del backend no sale de la máquina, y el widget simulado evita que el navegador abra el
  checkout real con esa llave.

## El desenlace de un rt=1: el webhook, y el monolito viejo corriendo en local

Un rt=1 (Welli, Meddipay, Bancolombia, Prami) **no cierra en plataforma**: la entidad decide afuera y
avisa después. `legacy-backend` **no tiene ninguna ruta que reciba ese aviso** (F-170) — el receptor vive
en `legacy-application`. Y eso **se puede correr en local**, contra la MISMA base:

    cd ~/Desktop/CREDITOP/github/legacy-application && php artisan serve --port=8000

Con eso, un caso pide su desenlace y **el receptor es real**; lo único simulado es la entidad que llama:

    make harness-case CASES='#ddc769bd:23@webhook=fulfilled' LAMBDA=1 CLOSE=1

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

### rt=0 también tiene desenlace, y es la familia más grande

«Redirige a la web de la entidad» describe la ida. La vuelta es un webhook **genérico** —uno solo para
Addi, PayJoy, Brilla, Sistecrédito—, no uno por entidad como en rt=1:

    export SELFMANAGER_TOKEN=<token de Sanctum con habilidad selfManager>
    make harness-case CASES='#0b3fef6a:6@webhook=completed' LAMBDA=1 CLOSE=1

El token se emite **una vez** en `legacy-application` —Sanctum guarda el hash, no el texto, así que el
que ya está en la base no sirve—:

    php artisan tinker --execute="echo \App\Models\User::find(<id>)->createToken('harness-local', ['selfManager'])->plainTextToken;"

⚠ **El `lender_id` del payload es el SLUG y no es estable entre ambientes** (el lender 6 es `addi` en
producción y `credifamilia-addi` en el dump local), por eso el runner lo lee de la base.

⚠ **Son DOS pasos**: el webhook no crea nada, busca lo que el flujo real ya dejó. El runner prepara la
transacción invocando `selfManager()` de la entidad por `artisan tinker` —su código real, no un INSERT
nuestro— y recién después dispara el webhook. Ver F-171 para las tres guardas rotas que hay ahí.

**Mapeo comprobado:** `completed`→11 · `failed`→6 · `cancelled`→7.

## Antes de concluir

- **Un lender solo cierra in-platform si está en `lenders_by_allieds` del comercio**: forzar el 77 (de
  Pullman) en otro comercio da **pagaré HTTP 500**. Mirá la oferta primero (`dbops lenders-for`).
- **Muro Wompi (cierre rt=2 por UI) — VOLTEADO (`bin/close-lender`)**: el muro NO era el checkout de
  Wompi (`pkg/wompi-mock.ts` lo intercepta, verificado) sino el **scoring**: un perfil aprobado cae en
  categoría con `min_initial_fee=0` → cuota $0 → botón «Pagar» disabled → nunca llega a Wompi. El fix
  siembra un rt=2 sintético con `min_initial_fee>0` en TODAS las categorías. El cierre backend sigue
  siendo `asesor 3e67eade 77` (fuerza `initial_fee=0`).
- **`IPHONE_UA` obligatorio**: el wizard gatea validación y `loan-approved` por `onlyMobileValidation` —
  con UA de escritorio responde **403** y el loader queda en blanco. A y B usan UA de iPhone.
- **Reuse de puertos**: `bin/advisor` reusa el wizard :5174 y lo reinicia **solo si apuntaba a otro
  backend**; `mock-preapprovals` reusa solo si `MOCK_PA_DELAY_MS` coincide (el env se hornea al bootear).
- **El eje ecommerce se ejercita contra dev, no local** (la entrada del front está PENDIENTE DE MERGE →
  nodo `ecommerce`; F-54). En local el checkout SSR se degrada.
- **Timeouts**: el wizard usa lenders-v1 (pre-aprobación sincrónica lenta) → «Server Timeout» del
  `streamTimeout` (fix por env). `PICK_TIMEOUT` (default 300 s) espera tu click por pantalla del guiado — ⚠ la constante se llama así en el código pero **la variable de entorno que la mueve es `E2E_PICK_TIMEOUT_MS`** (`harness/dev/guided.spec.ts:79`); exportar `PICK_TIMEOUT` no hace nada. El test entero tiene su propio tope de 900 s (`:196`).
- **`MoneyInput` pierde `fill()` por hidratación**: `seedField` reintenta tecla a tecla.
- **Mutex de la cuenta 1827080**: Motai y SmartPay la necesitan ligada a comercios distintos;
  `pkg/account-lock.ts` (mkdir atómico) los serializa bajo `fullyParallel` y restaura a Motai al final.
- **SmartPay teléfono internacional** (`+57…`): `create-temporary-user` guarda el phone crudo pero
  `check-user-exists` normaliza a `+`+dígitos — sin el `+` da `BDUS004` (usuario no encontrado).
- **`X-Dev-Session`/`DEV_SESSION_KEY` obsoletos, y más muertos de lo que esto decía**: el gate de
  `/merchant/*` hoy es Cognito, y —medido el 2026-09-19— esos nombres aparecen **cero veces en
  `legacy-backend` y cero en `legacy-application`**. No es «existe sin consumidor»: **del lado del
  backend no existe**. Lo único que sobrevive es el comentario en el `.env.local` del arnés y las dos
  menciones de `harness/docs/` que ya lo marcan como obsoleto.

## Lo que NO está verificado

- El flujo ecommerce por UI en local sigue degradado (SSR `process.env.VITE_API_URL`); el cierre Motai
  por UI (marketplace ofreciendo el 158 + testids) sigue pendiente — validado solo por API.

## El forense de logs, en detalle

- **Forense de logs — `dev/loki-trace.ts` (`pkg/loki.ts`).** Después de una corrida: ¿por qué terminó
  así? ⚠ **Y si contesta «cero anclas», eso NO es «no se sabe hasta dónde llegó»**: las etapas salen de
  la BD y las arma `make trazador-ureq UREQ=… TARGET=…`, que no depende de que haya logs. Este runner lo
  imprime en los tres finales. La BD dice el desenlace, los logs dicen la causa — una regla que excluyó un lender **no mueve
  ningún estado**, así que es invisible para la traza contrastada. Colapsa la solicitud a un resumen
  (fallas deduplicadas con `×N`, una fila por entidad evaluada con su regla y veredicto, el recorrido del
  backend, y los silencios entre peticiones) y vuelca todo a `.runs/forense-<ureq>/`.
  **Se dispara solo** al cerrar los dos runners (`forensicOnClose`), y **solo si el veredicto salió mal o
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
