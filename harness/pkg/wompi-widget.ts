// El widget de Wompi, reemplazado en el navegador del arnés por uno que sólo pregunta «¿pagó?».
//
// POR QUÉ: la pantalla `/down-payment` del wizard carga `https://checkout.wompi.co/widget.js` y abre el
// checkout de Wompi encima de la página (`wompi-widget.ts` del módulo loan-origination). En local ese
// checkout no sirve: cobra de verdad contra el sandbox, pide datos de pago y no avisa al mock. La corrida
// se quedaba ahí.
//
// QUÉ HACE: intercepta ese script y sirve uno propio que expone el mismo `WidgetCheckout` —mismo
// constructor, mismo `open(onFinish)`—. Al abrirse muestra un recuadro con el monto y dos botones:
//   · Pagar     → registra la transacción APROBADA en el mock de Wompi (`POST /__mock/pay`), igual que
//                 `payDownPayment` en la consola, y le devuelve al wizard lo que devolvería Wompi.
//   · Rechazar  → lo mismo con DECLINED, para recorrer la rama del pago rechazado.
// De ahí en adelante el camino es el REAL: el wizard va a `processing`, consulta el estado, el backend le
// pregunta al mock (`WOMPI_HOST`) y aplica el pago a la solicitud.
//
// ⚠ LO ÚNICO QUE SE ACORTA ES LA ESPERA: el backend no le pregunta a Wompi hasta que la transacción tiene
// 20 s (`PaymentStatusService::GRACE_SECONDS`, pensado para darle tiempo al webhook). Acá se atrasa su
// `created_at` 25 s en la base LOCAL, así la primera consulta del wizard ya reconcilia. Sin esto, cada
// cuota inicial son ~21 s mirando «procesando».
//
// SÓLO EN LOCAL: en dev/staging el widget apunta al sandbox de Wompi y es parte de lo que se prueba.
// Se apaga con `E2E_WOMPI_WIDGET=0`.
import type { BrowserContext } from '@playwright/test';
import { WOMPI_MOCK } from './wompi-down-payment.ts';

const WIDGET_SRC = 'https://checkout.wompi.co/widget.js';
const WOMPI_LENDER_ID = 52;
const GRACE_SKIP_SECONDS = 25;

export interface WidgetPayment { reference: string; amountInCents: number; status: 'APPROVED' | 'DECLINED' }

/** Registra el pago en el mock y le saca la espera de gracia. Devuelve el id de la transacción de Wompi. */
async function payInMock(p: WidgetPayment): Promise<{ ok: boolean; id?: string; error?: string }> {
    let r: Response;
    try {
        r = await fetch(`${WOMPI_MOCK}/__mock/pay`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reference: p.reference, amount_in_cents: p.amountInCents, status: p.status }),
            signal: AbortSignal.timeout(5000),
        });
    } catch {
        return { ok: false, error: `el mock de Wompi no responde en ${WOMPI_MOCK}: levantalo desde la pestaña Mocks del panel` };
    }
    const body: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: `el mock no registró el pago (HTTP ${r.status})` };
    // Import dinámico a propósito: un import estático de `db.ts` resuelve el TARGET al cargar este módulo,
    // antes de que el spec lo fije (F-187).
    try {
        const { exec, isLocalDb } = await import('./db.ts');
        if (isLocalDb()) {
            await exec(
                `UPDATE payment_gateway_transactions SET created_at = DATE_SUB(NOW(), INTERVAL ${GRACE_SKIP_SECONDS} SECOND)
                  WHERE lender_id = ? AND order_id = ?`,
                [WOMPI_LENDER_ID, p.reference],
            );
        }
    } catch { /* sin atrasar, el backend lo ve igual a los ~21 s */ }
    return { ok: true, id: body?.data?.id ?? body?.id };
}

/** El script que reemplaza a `widget.js`. Se sirve como texto: corre en la página, no en Node. */
function widgetScript(auto: boolean): string {
    return `(() => {
  const AUTO = ${auto ? 'true' : 'false'};
  const fmt = (c) => '$' + Math.round(c / 100).toLocaleString('es-CO');
  class WidgetCheckout {
    constructor(config) { this.config = config || {}; }
    open(onFinish) {
      const cfg = this.config;
      const host = document.createElement('div');
      host.id = '__harness_wompi';
      // El anfitrión ocupa la pantalla: con tamaño cero, un runner lo ve «oculto» aunque el recuadro se vea.
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483646';
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = \`
        <style>
          .back { position: absolute; inset: 0; background: rgba(0,0,0,.45);
                  display: flex; align-items: center; justify-content: center; font: 14px/1.4 system-ui, sans-serif }
          .box  { background: #fff; color: #111; width: min(340px, calc(100vw - 32px)); border-radius: 12px;
                  padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,.35) }
          .tag  { font-size: 11px; font-weight: 600; letter-spacing: .02em; color: #6b21a8 }
          h2    { margin: 4px 0 2px; font-size: 18px }
          .ref  { font: 12px ui-monospace, monospace; color: #555; word-break: break-all }
          .amt  { font-size: 28px; font-weight: 700; margin: 12px 0 }
          .row  { display: flex; gap: 8px; margin-top: 8px }
          button { flex: 1; height: 40px; border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer }
          .pay  { background: #111; color: #fff; border: 0 }
          .no   { background: #fff; color: #111; border: 1px solid #ccc }
          .err  { color: #b91c1c; font-size: 12px; margin-top: 8px }
        </style>
        <div class="back"><div class="box" role="dialog" aria-label="Pago simulado">
          <div class="tag">HARNESS · pago simulado</div>
          <h2>Cuota inicial con Wompi</h2>
          <div class="ref"></div>
          <div class="amt"></div>
          <div class="row"><button class="pay" type="button">Pagar</button><button class="no" type="button">Rechazar</button></div>
          <div class="err" hidden></div>
        </div></div>\`;
      root.querySelector('.ref').textContent = cfg.reference || '';
      root.querySelector('.amt').textContent = fmt(Number(cfg.amountInCents) || 0);
      document.body.appendChild(host);
      const finish = async (status) => {
        for (const b of root.querySelectorAll('button')) b.disabled = true;
        const r = await window.__harnessWompiPay({ reference: cfg.reference, amountInCents: Number(cfg.amountInCents), status });
        if (!r || !r.ok) {
          const e = root.querySelector('.err'); e.hidden = false; e.textContent = (r && r.error) || 'no se pudo registrar el pago';
          for (const b of root.querySelectorAll('button')) b.disabled = false;
          return;
        }
        host.remove();
        onFinish({ transaction: { id: r.id || 'mock-' + cfg.reference, status } });
      };
      root.querySelector('.pay').onclick = () => finish('APPROVED');
      root.querySelector('.no').onclick = () => finish('DECLINED');
      // Sin nadie mirando (el caminador sin ventana), paga solo: el recuadro queda en la traza igual.
      if (AUTO) setTimeout(() => finish('APPROVED'), 300);
    }
  }
  window.WidgetCheckout = WidgetCheckout;
})();`;
}

/** Engancha el widget simulado en un contexto del navegador. No hace nada fuera de local.
 *  `auto`: paga solo, sin esperar el clic — para el caminador sin ventana, donde no hay quién apriete. */
export async function installWompiWidget(context: BrowserContext, opts: { auto?: boolean } = {}): Promise<void> {
    if ((process.env.E2E_TARGET || 'dev').toLowerCase() !== 'local') return;
    if (process.env.E2E_WOMPI_WIDGET === '0') return;
    await context.exposeBinding('__harnessWompiPay', (_source, p: WidgetPayment) => payInMock(p));
    await context.route(WIDGET_SRC, (route) =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: widgetScript(!!opts.auto) }));
}
