// EL DESENLACE QUE LLEGA DE AFUERA — el webhook con el que rt=0 y rt=1 terminan.
//
// POR QUÉ ESTÁ ACÁ Y NO EN UN RUNNER. Lo usan dos: el runner de casos (`dev/caso.ts`, con `@webhook=`)
// y el panel (el botón «la entidad responde»). Tener dos definiciones de «cómo contesta una entidad»
// es como empiezan a derivar, y acá derivar significa que uno de los dos mueva un estado distinto.
//
// QUÉ ES REAL Y QUÉ NO, porque es todo el valor de esto. **El receptor es real**: se llama al webhook
// de verdad en `legacy-application`, que resuelve la transacción, aplica su propio `STATUS_MAP` y
// escribe en la base compartida. Lo único simulado es **la entidad que llama** — que es exactamente lo
// que un mock debe simular. No se toca ningún estado a mano.
//
// ⚠ POR ESO NO PRUEBA `legacy-backend`. Ese código vive en el monolito viejo; en el nuevo la mitad
// receptora está escrita pero **sin ruta que la reciba y con la clave del token sin declarar**, así que
// su guard rechaza siempre (F-170). Un verde acá dice «el flujo del cliente llega a su desenlace»,
// nunca «legacy-backend recibe webhooks».
//
// ⚠ Y LAS DOS FAMILIAS NO SON INTERCAMBIABLES: rt=1 tiene un webhook POR ENTIDAD (`welli/webhook`) y
// rt=0 uno GENÉRICO para todas (`self-manager/webhook`). Mandar el payload de una al endpoint de la
// otra da 404 o 422, que se lee como «el webhook no funciona» y no como «te equivocaste de familia».
//
// ⚠ TRES TRAMPAS DEL CAMINO, las tres silenciosas:
//   · el monolito viejo rutea por SUBDOMINIO —el webhook vive en `api.localhost`— y pegarle al host
//     pelado da **405 «Supported methods: GET, HEAD»** por la ruta fallback, no 404;
//   · `fetch` de Node DESCARTA el header `Host` sin avisar, así que el subdominio va en la URL;
//   · sin el token en el `.env` de application, el guard rechaza con 401 aunque el llamante traiga uno.

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { one } from './db.ts';

/** ⚠ VA CON EL SUBDOMINIO EN LA URL, no con un header `Host` (ver arriba). `api.localhost` resuelve
 *  solo a 127.0.0.1, así que no hace falta tocar `/etc/hosts`. */
export const APP_VIEJA = process.env.LEGACY_APPLICATION_URL || 'http://api.localhost:8000';
export const WELLI_TOKEN = process.env.WELLI_WEBHOOK_TOKEN || 'token-de-pruebas-solo-local';
/** Token de Sanctum con habilidad `selfManager`, para el webhook GENÉRICO de rt=0. Se emite a mano una
 *  vez: en `legacy-application`, `$user->createToken('harness-local', ['selfManager'])`. No se puede
 *  reusar el que ya está en la base porque Sanctum guarda el hash, no el texto. */
/** ⚠ TAMBIÉN SE LEE DE UN ARCHIVO, no sólo del entorno. El runner de consola puede pedir un `export`;
 *  el panel no —se usa a botones, y exigir una variable de shell para apretar uno es la clase de
 *  fricción que hace que la función no se use—. Mismo trato que `.cognito.json`: local y gitignoreado.
 *  Se emite una vez en `legacy-application`:
 *      php artisan tinker --execute="echo \App\Models\User::find(<id>)
 *          ->createToken('harness-local', ['selfManager'])->plainTextToken;" > harness/.selfmanager-token */
export const SELFMANAGER_TOKEN = process.env.SELFMANAGER_TOKEN || (() => {
    try {
        return readFileSync(new URL('../.selfmanager-token', import.meta.url), 'utf8').trim();
    } catch { return ''; }
})();
export const APP_VIEJA_DIR = process.env.LEGACY_APPLICATION_DIR
    || `${process.env.HOME}/Desktop/CREDITOP/github/legacy-application`;
/** La familia Welli, quemada en el propio handler del webhook (`WelliController::webhook`:
 *  `whereIn('lender_id', [23,141,142,166])`). Si aparece una quinta variante, no basta con darla de
 *  alta: hay que tocar código en los dos lados o su webhook no encuentra la transacción. */
export const WELLI_IDS = [23, 141, 142, 166];

/** LOS ARRANQUES DE LARAVEL VAN DE A UNO, Y ESTÁ MEDIDO. La preparación del webhook de rt=0 corre
 *  `artisan tinker`, que bootea el monolito viejo ENTERO. Con nueve casos en paralelo esos arranques le
 *  comieron la CPU al servidor local y **tres casos que cierran siempre fallaron con `HTTP 0`** en la
 *  generación de documentos — el runner se saboteaba a sí mismo y el síntoma aparecía en OTROS casos. */
let fila: Promise<unknown> = Promise.resolve();
export function enFila<T>(tarea: () => Promise<T>): Promise<T> {
    const proximo = fila.then(tarea, tarea);
    fila = proximo.catch(() => {});
    return proximo;
}

/** Los estados que cada familia puede responder, con el estado de solicitud al que mapean HOY.
 *  ⚠ Es el mapa de `legacy-application`, que NO coincide con el que ya está escrito en
 *  `legacy-backend`: `pendiente_desembolso` da 28 acá y está como 11 allá. Cuando el webhook migre,
 *  ese desenlace cambia. */
export const ESTADOS_WEBHOOK = {
    rt1: [['fulfilled', 11], ['pendiente_desembolso', 28], ['rejected', 6], ['dismissed', 8]],
    rt0: [['completed', 11], ['failed', 6], ['cancelled', 7]],
} as const;

/** ¿Esta entidad puede recibir un webhook, y de cuál de las dos formas? */
export async function familiaWebhook(lenderId: number): Promise<'rt0' | 'rt1' | null> {
    const l = await one<{ rt: number; a: string | null }>(
        'SELECT response_type rt, action a FROM lenders WHERE id=?', [lenderId]).catch(() => null);
    if (!l) return null;
    if (Number(l.rt) === 1 && WELLI_IDS.includes(lenderId)) return 'rt1';
    // ⚠ La mayoría de los rt=0 NO tienen integración: de 20 entidades con solicitudes en 90 días, sólo
    // 3 tienen clase `action` —y se llevan el 88 % del volumen—; las otras 17 son redirección pura y
    // no reciben webhook (F-170).
    if (Number(l.rt) === 0 && l.a) return 'rt0';
    return null;
}

/** DISPARA EL WEBHOOK DE LA ENTIDAD — el desenlace de un rt=1, que `legacy-backend` no puede dar.
 *
 *  QUÉ ES REAL ACÁ Y QUÉ NO, porque la diferencia es todo el valor de esto. **El receptor es real**: se
 *  llama al webhook de verdad en `legacy-application`, que resuelve la transacción, aplica su propio
 *  `STATUS_MAP` y escribe en la base compartida. Lo único simulado es **la entidad que llama** — que es
 *  exactamente lo que un mock debe simular. No se toca ningún estado a mano.
 *
 *  ⚠ POR ESO NO PRUEBA `legacy-backend`. El código que corre acá vive en el monolito viejo; en el nuevo
 *  la mitad receptora está escrita (el `STATUS_MAP` de `Welli`, su `authorize()`) pero **sin ruta que la
 *  reciba y con la clave del token sin declarar**, así que su guard rechaza siempre (F-170). Un verde
 *  acá dice «el flujo del cliente llega a su desenlace», nunca «legacy-backend recibe webhooks».
 *
 *  ⚠ Y LOS DOS `STATUS_MAP` NO COINCIDEN. Medido el 2026-08-23: `pendiente_desembolso` es **28** en
 *  application y **11** en legacy-backend, y `fraud`/`risk_in_process` sólo existen en el nuevo. O sea
 *  que el desenlace que se observe acá es el de HOY; cuando el webhook migre, uno de esos tres cambia.
 */
export async function webhookIntegracion(ur: number, estado: string): Promise<{ ok: boolean; detalle: string }> {
    const tx = await one<{ o: string }>(
        `SELECT order_id o FROM lender_transactions
          WHERE user_request_id = ? AND lender_id IN (${WELLI_IDS.join(',')})
          ORDER BY id DESC LIMIT 1`, [ur]).catch(() => null);
    if (!tx?.o) {
        return { ok: false, detalle: 'sin transacción de la entidad: el webhook no tendría a qué apuntar' };
    }

    const r = await fetch(`${APP_VIEJA}/welli/webhook`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            authorization: `Bearer ${WELLI_TOKEN}`,
        },
        body: JSON.stringify({ timestamp: new Date().toISOString(), application_id: tx.o, status: estado }),
        signal: AbortSignal.timeout(20_000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) } as any));

    const cuerpo = (await r.text().catch(() => '')).slice(0, 120);
    if (r.status === 401) {
        return { ok: false, detalle: 'el webhook devolvió 401 — falta WELLI_WEBHOOK_TOKEN en el .env de legacy-application' };
    }
    if (r.status !== 200) return { ok: false, detalle: `el webhook devolvió HTTP ${r.status}: ${cuerpo}` };

    const fin = await one<{ e: number }>(
        'SELECT user_request_status_id e FROM user_requests WHERE id=?', [ur]).catch(() => null);
    return { ok: true, detalle: `webhook \`${estado}\` → estado ${fin?.e ?? '?'} (lo aplicó legacy-application, no legacy-backend)` };
}

/** EL DESENLACE DE UN rt=0 — la familia MÁS GRANDE, y la que parecía no tener vuelta.
 *
 *  «Redirige a la web de la entidad y nadie decide en plataforma» describe la IDA. La vuelta existe y es
 *  un webhook **genérico** —uno solo para todas: Addi, PayJoy, Brilla, Sistecrédito—, no uno por
 *  entidad como en rt=1. Medido en producción: rt=0 son 15.339 solicitudes en 90 días (46 % del total)
 *  y 4.196 autorizadas, con Addi llevándose 3.529. Ver F-170.
 *
 *  DOS PASOS, porque el webhook no crea nada: busca lo que el flujo real ya dejó.
 *    1. la `LenderTransaction` y el código de compra, que en producción los crea el navegador del
 *       cliente al finalizar la compra (`FinalizePurchaseQrController`, en el monolito viejo);
 *    2. el webhook, que los encuentra por `order_id` y cierra.
 *
 *  ⚠ EL PASO 1 SE INVOCA POR `artisan tinker`, no por SQL a mano. Cuesta un segundo más y vale la pena:
 *  la transacción la crea `selfManager()` de la entidad —su código real, con su propio estado
 *  `Pending`— en vez de un INSERT nuestro que quedaría viejo en cuanto ese método cambie. El código de
 *  compra sí es un insert, porque el controlador lo hace inline y no hay método que llamar.
 *
 *  ⚠ `lender_id` EN EL PAYLOAD ES EL SLUG, no el número. Y el slug NO es estable entre ambientes: el
 *  lender 6 es `addi` en producción y `credifamilia-addi` en el dump local. Por eso se lee de la base.
 */
export async function webhookSelfManager(ur: number, lender: number, estado: string): Promise<{ ok: boolean; detalle: string }> {
    if (!SELFMANAGER_TOKEN) {
        return { ok: false, detalle: 'falta SELFMANAGER_TOKEN (Sanctum con habilidad `selfManager`) — ver harness/CLAUDE.md' };
    }
    const l = await one<{ s: string; a: string | null }>(
        'SELECT slug s, action a FROM lenders WHERE id=?', [lender]).catch(() => null);
    if (!l?.s) return { ok: false, detalle: `la entidad ${lender} no tiene slug: el webhook busca por slug` };
    // ⚠ LA MAYORÍA DE LOS rt=0 NO TIENEN INTEGRACIÓN. Medido en producción: de 20 entidades rt=0 con
    // solicitudes en 90 días, sólo **3** tienen clase `action` —y se llevan el 88 % del volumen—; las
    // otras 17 son redirección pura y **no reciben webhook**. Sin este aviso, pedirle `@webhook=` a una
    // de ésas fallaba con un mensaje vacío, que se lee como que el webhook está roto.
    if (!l.a) {
        return { ok: false, detalle: `la entidad ${lender} no tiene clase de integración (\`action\` en NULL):`
            + ' es redirección pura y NO recibe webhook. Sólo 3 de las rt=0 lo reciben (F-170)' };
    }

    const orderId = `SYNTH-${ur}-${Date.now().toString(36)}`;
    const php = `
        $l = \\App\\Models\\Lender::find(${lender});
        $r = new \\Illuminate\\Http\\Request();
        $r->merge(['user_request_id' => ${ur}, 'order_id' => '${orderId}']);
        $r->lender = $l;
        (new $l->action())->selfManager($r);
        \\App\\Models\\PurchaseCode::firstOrCreate(['user_request_id' => ${ur}],
            ['barcode_url' => 'https://mock-s3.local/barcodes/synth-${ur}.png']);
        echo 'listo';`;
    const prep = await enFila(() => new Promise<string>((res) => {
        execFile('php', ['artisan', 'tinker', '--execute', php], { cwd: APP_VIEJA_DIR, timeout: 60_000 },
            (e, out, err) => res(e ? `ERROR ${String(err || e).slice(0, 130)}` : String(out)));
    }));
    if (!prep.includes('listo')) return { ok: false, detalle: `no se pudo preparar la transacción: ${prep.slice(0, 110)}` };

    const r = await fetch(`${APP_VIEJA}/self-manager/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json',
                   authorization: `Bearer ${SELFMANAGER_TOKEN}` },
        body: JSON.stringify({
            lender_id: l.s, order_id: orderId, code_id: `COD-${ur}`,
            available_amount: 2_000_000, purchase_amount: 2_000_000,
            invoice_number: `FAC-${ur}`, status: estado,
        }),
        signal: AbortSignal.timeout(30_000),
    }).catch((e) => ({ status: 0, text: async () => String(e) } as any));

    const cuerpo = (await r.text().catch(() => '')).slice(0, 110);
    if (r.status === 401) return { ok: false, detalle: 'el webhook devolvió 401 — el token de Sanctum no sirve o le falta la habilidad' };
    if (r.status !== 200) return { ok: false, detalle: `el webhook devolvió HTTP ${r.status}: ${cuerpo}` };

    const fin = await one<{ e: number }>('SELECT user_request_status_id e FROM user_requests WHERE id=?', [ur]).catch(() => null);
    return { ok: true, detalle: `webhook self-manager \`${estado}\` → estado ${fin?.e ?? '?'} (lo aplicó legacy-application)` };
}
