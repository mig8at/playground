// RECETA DE SÓLO LECTURA · ¿qué pasó con este pedido? El pedido de VTEX, su pago y lo que contestó el conector de
// Creditop, en una sola salida.
//
//   make jarvis-receta APP=vtex RECETA=pedido                       el último pedido
//   make jarvis-receta APP=vtex RECETA=pedido ARGS='1674560500446-01'
//   make jarvis-receta APP=vtex RECETA=pedido ARGS='--ultimos 10'   la lista, para elegir
//
// En el admin esto es cruzar a mano Orders › All Orders (el pedido), Orders › Transactions (el pago) y el detalle de
// la transacción (su registro). Acá, con la llave de la cuenta:
//   GET /api/oms/pvt/orders?orderBy=creationDate,desc        la lista
//   GET /api/oms/pvt/orders/<pedido>                         estado, total, ítems y la transacción
//   GET /api/payments/pvt/transactions/<transacción>         el pago en el gateway
//   GET /api/payments/pvt/transactions/<transacción>/interactions
//        el registro: cada pedido de autorización al conector de Creditop y lo que contestó, con el link del wizard
//        al que mandó al cliente (`paymentUrl`). Con ese link, `make ecommerce` sigue la solicitud del lado de CreditOp.
// Las horas, en hora de Colombia como el admin. No muestra datos del comprador ni el cuerpo de lo que se le manda al conector (llevan sus datos).
import { must, hosts } from './api.ts';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const out = (s = '') => { if (!JSON_OUT) console.log(s ? `  ${s}` : ''); };
const money = (cents: number) => `$${(cents / 100).toLocaleString('es-CO', { maximumFractionDigits: 2 })}`;
// Hora de Colombia, como el admin. Las del registro del pago vienen en UTC sin la «Z».
const time = (iso?: string | null) => {
    if (!iso) return '—';
    const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
    return d.toLocaleString('sv-SE', { timeZone: 'America/Bogota' }).slice(0, 19);
};

// Los estados del pedido (OMS) en castellano; VTEX los describe en portugués.
const ORDER_STATUS: Record<string, string> = {
    'order-created': 'creado', 'order-completed': 'completado', 'on-order-completed': 'completado',
    'payment-pending': 'esperando el pago', 'waiting-for-order-authorization': 'esperando autorización del pedido',
    'approve-payment': 'aprobando el pago', 'payment-approved': 'pago aprobado', 'payment-denied': 'pago rechazado',
    'request-cancel': 'pidiendo cancelación', 'waiting-for-seller-decision': 'esperando al vendedor',
    'authorize-fulfillment': 'autorizando el despacho', 'window-to-cancel': 'ventana para cancelar',
    'ready-for-handling': 'listo para preparar (pago aprobado)', 'start-handling': 'empezando a preparar',
    handling: 'preparándose', invoiced: 'facturado', canceled: 'cancelado', cancel: 'cancelándose',
};

const base = `${hosts.store}/api`;

if (flag('ultimos')) {
    const l = await must<any>('listar los pedidos', 'GET', `${base}/oms/pvt/orders?orderBy=creationDate,desc&per_page=${Number(flag('ultimos')) || 10}`);
    if (JSON_OUT) console.log(JSON.stringify(l.list.map((o: any) => ({ pedido: o.orderId, creado: o.creationDate, estado: o.status, total: o.totalValue / 100, pago: o.paymentNames }))));
    else for (const o of l.list) out(`${o.orderId}  ${time(o.creationDate)}  ${(ORDER_STATUS[o.status] ?? o.status).padEnd(36)} ${money(o.totalValue).padStart(14)}  ${o.paymentNames}`);
    process.exit(0);
}

let orderId = argv.find((a) => /^\d{6,}(-\d+)?$/.test(a));
if (!orderId) {
    const l = await must<any>('buscar el último pedido', 'GET', `${base}/oms/pvt/orders?orderBy=creationDate,desc&per_page=1`);
    orderId = l.list?.[0]?.orderId;
    if (!orderId) throw new Error('la cuenta no tiene pedidos');
}
if (!/-\d+$/.test(orderId)) orderId += '-01';

const order = await must<any>('leer el pedido', 'GET', `${base}/oms/pvt/orders/${orderId}`);
const tx = order.paymentData?.transactions?.[0];
const payment = tx?.payments?.[0];

type Step = { hora: string; quien: string; que: string };
let transaction: any = null;
let steps: Step[] = [];
let wizard: string | undefined;
let creditop: { estado?: string; respuesta?: string }[] = [];
if (tx?.transactionId) {
    transaction = await must<any>('leer la transacción', 'GET', `${base}/payments/pvt/transactions/${tx.transactionId}`);
    // El conector y el estado de cada pago vienen en /payments (en la transacción no está el conector).
    transaction.pagos = await must<any[]>('leer los pagos', 'GET', `${base}/payments/pvt/transactions/${tx.transactionId}/payments`);
    const interactions = await must<any[]>('leer el registro del pago', 'GET', `${base}/payments/pvt/transactions/${tx.transactionId}/interactions`);
    for (const i of [...interactions].reverse()) {
        const msg = String(i.Message ?? '').replace(/\s+/g, ' ');
        // El cuerpo de lo que se le manda al conector lleva los datos del comprador: sólo se anota que se mandó.
        // De la URL sale el WORKSPACE de la app de Creditop en VTEX que atendió (master, develop…): no siempre es el mismo.
        const ws = (u: string) => /https:\/\/([\w-]+)--/.exec(u)?.[1] ?? '?';
        if (/^Sending authorization request/.test(msg)) { steps.push({ hora: time(i.Date), quien: i.Source, que: `VTEX le pide autorización a Creditop (workspace ${ws(msg)})` }); continue; }
        if (/^Sending cancellation request/.test(msg)) { steps.push({ hora: time(i.Date), quien: i.Source, que: `VTEX le pide a Creditop cancelar (workspace ${ws(msg)})` }); continue; }
        const cancel = /Cancellation response received: \[([^\]]+)\] (\{.*)/.exec(msg);
        if (cancel) {
            const code = /"code":"([^"]+)"/.exec(cancel[2])?.[1];
            const meaning = code === 'cancel-manually' ? ' (Creditop no la hace sola: pide cancelarla a mano)' : '';
            steps.push({ hora: time(i.Date), quien: i.Source, que: `Creditop contesta la cancelación ${cancel[1]}${code ? `: ${code}` : ''}${meaning}` });
            continue;
        }
        if (/^An external application called to cancel/.test(msg)) {
            steps.push({ hora: time(i.Date), quien: i.Source, que: `alguien de afuera pidió cancelar (${/RequestId = (\w+)/.exec(msg)?.[1] ?? 'sin motivo'})` });
            continue;
        }
        if (/^Started cancelling/.test(msg) || i.Source === 'CreateTaskAsyncRequest') continue;
        if (i.Source === 'CreateTaskAsyncResponse') {
            const who = /"email":"([^"]+)"/.exec(msg)?.[1];
            steps.push({ hora: time(i.Date), quien: 'gateway', que: `VTEX abre una tarea manual${who ? ` asignada a ${who}` : ''}` });
            continue;
        }
        const resp = /Authorization response received: \[([^\]]+)\] (\{.*)/.exec(msg);
        if (resp) {
            let body: any = {};
            try { body = JSON.parse(resp[2]); } catch { /* respuesta cortada */ }
            if (body.paymentUrl) wizard = body.paymentUrl;
            creditop.push({ estado: body.status, respuesta: resp[1] });
            steps.push({ hora: time(i.Date), quien: i.Source, que: `Creditop contesta ${resp[1]}: ${body.status ?? '?'}${body.paymentUrl ? ' (manda al cliente al wizard)' : ''}` });
            continue;
        }
        if (i.Source === 'Authorization Rules') {
            // Cada cuánto VTEX vuelve a preguntarle a Creditop si nadie le avisa (el reintento de autorización).
            try {
                const r = JSON.parse(msg);
                steps.push({ hora: time(i.Date), quien: 'reglas de reintento', que: `si Creditop no avisa, VTEX vuelve a preguntar cada ${Math.round(r.ProcessingDelay / 60)} min, hasta ${r.MaxEnqueues} veces` });
            } catch { /* otro formato: se omite */ }
            continue;
        }
        if (/^Message: /.test(msg)) continue; // repite la respuesta del conector
        const change = /^Status change: from (\w+) to (\w+)/.exec(msg);
        if (change) {
            const what = i.Source === 'TransactionWorkFlowChangeStatus' ? 'transacción' : i.Source === 'PaymentWorkFlowChangeStatus' ? 'pago' : i.Source;
            steps.push({ hora: time(i.Date), quien: 'gateway', que: `${what}: ${change[1]} → ${change[2]}` });
            continue;
        }
        if (/^Payment pending: user needs to finish payment/.test(msg)) continue; // ya está en la respuesta
        steps.push({ hora: time(i.Date), quien: i.Source, que: msg.replace(/ for [0-9A-F]{32}\.?$/, '').replace(/ for payment [0-9A-F]{32}\.?$/, '').slice(0, 140) });
    }
}

// Qué dice todo junto, en una línea.
let verdict: string;
if (!tx) verdict = 'el pedido no tiene transacción de pago';
else if (transaction?.status === 'Approved' || transaction?.status === 'Finished') verdict = `pago APROBADO por Creditop (${time(transaction.authorizationDate)})`;
else if (/cancel/i.test(transaction?.status ?? '')) verdict = `pago CANCELADO (${time(transaction?.cancelationDate)})`;
else if (creditop.length && creditop.every((c) => c.estado === 'undefined')) verdict = 'pago PENDIENTE: Creditop mandó al cliente al wizard y todavía no aprobó (el cliente no terminó, o la solicitud no llegó a 11)';
else if (creditop.some((c) => c.estado === 'denied')) verdict = 'pago RECHAZADO por Creditop';
else verdict = `pago en «${transaction?.status ?? '?'}»`;

const result = {
    pedido: orderId, creado: order.creationDate, estado: order.status, estadoTexto: ORDER_STATUS[order.status] || order.statusDescription || order.status || 'sin estado en el OMS todavía',
    total: order.value / 100, items: (order.items ?? []).map((i: any) => ({ nombre: i.name, cantidad: i.quantity, precio: i.sellingPrice / 100 })),
    pago: payment ? { sistema: payment.paymentSystemName, conector: transaction?.pagos?.[0]?.connector, transaccion: tx.transactionId, estado: transaction?.status } : null,
    cancelacion: order.cancellationData?.Reason ?? null, veredicto: verdict, wizard, registro: steps,
};
if (JSON_OUT) { console.log(JSON.stringify(result)); process.exit(0); }

out(`pedido ${orderId} · ${time(order.creationDate)} · ${result.estadoTexto}`);
if (order.cancellationData?.Reason) out(`motivo de la cancelación: ${String(order.cancellationData.Reason).replace(/\s+/g, ' ').slice(0, 160)}`);
out(`total ${money(order.value)} · ${result.items.map((i: any) => `${i.cantidad}× ${i.nombre}`).join(', ')}`);
if (payment) out(`pago ${payment.paymentSystemName} (${transaction?.pagos?.[0]?.connector ?? '?'}) · transacción ${tx.transactionId} · ${transaction?.status}`);
out();
out(`→ ${verdict}`);
if (wizard) {
    out(`  wizard: ${wizard}`);
    out(`  del lado de CreditOp: make ecommerce, pegando ese link (o go run ./ecommerce/server -target qa -q '<link>')`);
}
out();
out('registro del pago (lo más viejo arriba):');
for (const s of steps) out(`  ${s.hora}  ${s.quien.padEnd(32)} ${s.que}`);
out();
out(`admin: ${hosts.admin}/orders/${orderId}`);
