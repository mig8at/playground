// trace.ts — traza CONTRASTADA frontend ↔ base de datos.
//
// POR QUÉ EXISTE:
//   El navegador muestra la PRETENSIÓN del flujo; la BD tiene lo que realmente pasó. Toda la clase de
//   bugs más cara de esta sesión vive exactamente en esa brecha: la uReq 464498 recorrió Ábaco entero,
//   llegó a una pantalla de éxito y estaba CANCELADA en la BD (findings F-50). Un log que solo dice
//   `nav → /loan-approved` no distingue eso de un cierre real.
//
//   Acá cada navegación del wizard se acompaña del estado REAL de la solicitud en ese instante, y se
//   marca cuándo la BD se movió y cuándo no. Un tramo largo de pantallas sin una sola transición de
//   estado es la firma de un flujo que avanza en pantalla sin persistir nada.
//
// DISEÑO:
//   · Una sola query por paso (local ~2-5ms). Serializada en una cadena de promesas para que las
//     líneas salgan EN ORDEN — `framenavigated` es sync y dispararla suelta mezclaba la salida.
//   · Best-effort: si la BD falla, la traza se degrada a "—" y NUNCA tumba la corrida.
//   · La solicitud todavía no existe en los primeros pasos: eso se muestra, no se oculta.

import { one } from './db.ts';

const useColor = process.env.FORCE_COLOR !== '0' && (!!process.stdout.isTTY || !!process.env.FORCE_COLOR);
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c('32', s);
const red = (s: string) => c('31', s);
const yellow = (s: string) => c('33', s);
const gray = (s: string) => c('90', s);
const bold = (s: string) => c('1', s);

/** Estados que sellan un desenlace: llegar acá es el objetivo. */
const SELLADOS = new Set([11, 28]);
/** Estados de muerte: llegar acá sin pedirlo es un fallo, no un matiz. */
const MALOS = new Set([6, 8]);
/** Rutas que el front presenta como éxito — si la BD no acompaña, es F-50. */
const RUTA_EXITO = /loan-approved|credito-aprobado|solicitud-aprobada/i;

type Snap = { st: number | null; estado: string | null; lender: string | null; ctpx: number };
type Paso = { n: number; ventana: string; ruta: string; st: number | null; estado: string | null; cambio: boolean };

let uReq = 0;
let n = 0;
let previo: Snap | null = null;
const linea: Paso[] = [];
const alertas: string[] = [];
let cola: Promise<void> = Promise.resolve();

const log = (s: string) => console.log(`  ▸ ${s}`);

export function trazarUReq(id: number | string): void {
    const v = Number(id);
    if (v && v !== uReq) {
        uReq = v;
        log(gray(`traza: a partir de acá cada paso se contrasta contra la BD (uReq ${v})`));
    }
}

async function snap(): Promise<Snap | null> {
    if (!uReq) return null;
    try {
        const r = await one<Snap>(
            `SELECT ur.user_request_status_id AS st, s.name AS estado, l.name AS lender,
                    (SELECT COUNT(*) FROM creditop_x_user_requests_records x WHERE x.user_request_id = ur.id) AS ctpx
               FROM user_requests ur
               LEFT JOIN user_request_statuses s ON s.id = ur.user_request_status_id
               LEFT JOIN lenders l ON l.id = ur.lender_id
              WHERE ur.id = ?`, [uReq]);
        return r ? { ...r, ctpx: Number(r.ctpx) || 0 } : null;
    } catch {
        return null;   // la traza es un extra: nunca frena la corrida
    }
}

/** Registra una navegación y la contrasta con la BD. Se llama desde `framenavigated`; no hay que await-earla. */
export function paso(ventana: string, ruta: string): void {
    cola = cola.then(async () => {
        n += 1;
        const s = await snap();
        const idx = String(n).padStart(2, '0');
        const izq = `${idx} ${bold(ventana)} ${ruta}`.padEnd(useColor ? 62 : 54);

        if (!uReq) { log(`${izq}${gray('│ BD  —  (sin solicitud todavía)')}`); linea.push({ n, ventana, ruta, st: null, estado: null, cambio: false }); return; }
        if (!s) {
            log(`${izq}${red('│ BD  ✗ la solicitud no está en la BD')}`);
            linea.push({ n, ventana, ruta, st: null, estado: null, cambio: false });
            return;
        }

        const cambio = !previo || previo.st !== s.st;
        const etiqueta = `${s.st} «${s.estado ?? '?'}»`;
        let der: string;
        if (!previo) der = `│ BD  ${etiqueta}`;
        else if (cambio) der = `│ BD  ${green(`${previo.st} → ${etiqueta}`)}  ▲`;
        else der = gray(`│ BD  ${etiqueta}`);

        // ── detectores en caliente (no esperan al final) ──
        if (s.st !== null && MALOS.has(s.st) && (!previo || !MALOS.has(previo.st ?? -1))) {
            const a = `la solicitud pasó a estado ${s.st} «${s.estado}» en el paso ${n} (${ventana} ${ruta})`;
            alertas.push(a);
            der += red('  ← DESENLACE MALO');
        }
        if (RUTA_EXITO.test(ruta) && s.st !== null && !SELLADOS.has(s.st)) {
            const a = `pantalla de ÉXITO (${ruta}) con la BD en estado ${s.st} «${s.estado}» — el front miente (ver F-50)`;
            alertas.push(a);
            der += red('  ← ÉXITO SIN RESPALDO EN BD');
        }

        log(`${izq}${der}`);
        linea.push({ n, ventana, ruta, st: s.st, estado: s.estado, cambio });
        previo = s;
    }).catch(() => { /* nunca romper la corrida por la traza */ });
}

/** Espera a que la cola de trazas termine (antes de imprimir el resumen). */
export async function drenar(): Promise<void> { await cola; }

/** Resumen final: solo las TRANSICIONES + los tramos ciegos + las alertas. */
export async function resumen(): Promise<{ alertas: string[]; transiciones: number }> {
    await drenar();
    const trans = linea.filter((p) => p.cambio);
    console.log('');
    log(bold('── TRAZA CONTRASTADA · resumen ──'));
    log(`   ${linea.length} pasos de front · ${trans.length} transiciones de estado en BD`);

    if (trans.length) {
        for (const t of trans) log(`   ${String(t.n).padStart(2, '0')} ${t.ventana} ${t.ruta}  ⇒  ${t.st} «${t.estado}»`);
    } else if (uReq) {
        log(yellow('   ⚠ ninguna transición: el flujo avanzó en pantalla sin mover la BD'));
    }

    // Tramo ciego = pantallas seguidas sin ninguna transición. Un tramo largo suele ser un flujo que
    // "se ve bien" pero no persiste, o un muro donde el usuario da vueltas.
    let racha = 0, peor = 0, peorDesde = '';
    for (const p of linea) {
        if (p.cambio) { racha = 0; continue; }
        racha += 1;
        if (racha > peor) { peor = racha; peorDesde = p.ruta; }
    }
    if (peor >= 5) log(yellow(`   ⚠ tramo ciego más largo: ${peor} pantallas sin transición (hasta ${peorDesde})`));

    if (alertas.length) {
        console.log('');
        log(red(bold(`── ${alertas.length} ALERTA(S) ──`)));
        for (const a of alertas) log(red(`   ✗ ${a}`));
    }
    return { alertas, transiciones: trans.length };
}
