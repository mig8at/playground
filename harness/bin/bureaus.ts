#!/usr/bin/env node
// LOS BURÓS DE UNA PRUEBA, POR CONSOLA — lo mismo que la pestaña «Burós» del panel, para que un agente configure
// en una línea qué contesta cada central de riesgo para la cédula de su caso.
//
//   node bin/bureaus.ts                                   ayuda y valores por defecto
//   node bin/bureaus.ts show  <cédula>                    qué contesta HOY cada central (leído del mock)
//   node bin/bureaus.ts set   <cédula> [clave=valor …]    aplica la configuración; LO NO DICHO = POR DEFECTO
//   node bin/bureaus.ts reset <cédula>                    todas responden con los valores por defecto
//   --json                                                salida en JSON
//
// Claves: `<buró>=ok|empty|fail` (responde · sin información · falla HTTP 500) y `<buró>.<campo>=valor`:
//   agildata.income · agildata.occupation (Empleado|Independiente) · agildata.months
//   mareigua.income · mareigua.months
//   experian.score · experian.negatives · experian.consulted · experian.delinquencies · experian.creditCards (Acierta)
//   experian.quantoIncome — el ingreso estimado de QUANTO (0 = no estima). En el backend PISA el ingreso de la
//   cascada si el comercio dispara Experian (setting `experian_trigger_allieds`).
// Ej.: node bin/bureaus.ts set 1032456789 agildata=fail mareigua.income=3800000 experian.score=580
//
// ⚠ SÓLO EL MOCK LOCAL (:8105, `make harness-bureaus`): el lambda de la empresa no conoce estos estados y
// dictarle una falla afectaría a cualquiera que use esa cédula en dev, qa o staging. Por eso se niega si
// `RISK_LAMBDA_URL` no es local. Y sólo cuenta cuando el backend CONSULTA (no con el buró inyectado).

import { LAMBDA, BUREAUS, BUREAU_DEFAULTS, applyBureauConfig, readBureauConfig, type BureauConfig } from '../pkg/risk-lambda.ts';

const args = process.argv.slice(2);
const json = args.includes('--json');
const [cmd, doc, ...pairs] = args.filter((a) => a !== '--json');
const out = (data: unknown, text: string) => console.log(json ? JSON.stringify(data, null, 2) : text);
const fail = (msg: string): never => { console.error(json ? JSON.stringify({ ok: false, error: msg }) : `✗ ${msg}`); process.exit(1); };

const MODES = new Set(['ok', 'empty', 'fail']);
const FIELDS: Record<string, string[]> = {
    agildata: ['income', 'occupation', 'months'], mareigua: ['income', 'months'], tusdatos: [],
    experian: ['score', 'negatives', 'consulted', 'delinquencies', 'creditCards', 'quantoIncome'],
};

function help(): void {
    const d = BUREAU_DEFAULTS;
    out({ defaults: BUREAU_DEFAULTS }, [
        'Burós de una prueba (mock local :8105). Lo no dicho queda POR DEFECTO:',
        `  agildata  ${d.agildata.mode} · income ${d.agildata.income} · occupation ${d.agildata.occupation} · months ${d.agildata.months}`,
        `  mareigua  ${d.mareigua.mode} · income ${d.mareigua.income} · months ${d.mareigua.months}`,
        `  tusdatos  ${d.tusdatos.mode}`,
        `  experian  ${d.experian.mode} · Acierta: score ${d.experian.score} · negatives ${d.experian.negatives} · consulted ${d.experian.consulted} · delinquencies ${d.experian.delinquencies} · creditCards ${d.experian.creditCards} · Quanto: quantoIncome ${d.experian.quantoIncome} (0 = no estima)`,
        '',
        'Identidad: agildata → mareigua → tusdatos, la primera que responde. Ingreso y ocupación: agildata → mareigua',
        '(TusDatos no los trae); sin ninguna de las dos, el wizard le pide al cliente su información laboral.',
        'Después, si el comercio dispara Experian, Quanto (quantoIncome > 0) PISA el ingreso y deja la ocupación en Empleado.',
        'Estados: ok (responde) · empty (sin información, sólo agildata y mareigua) · fail (HTTP 500).',
        '',
        '  node bin/bureaus.ts show  <cédula>',
        '  node bin/bureaus.ts set   <cédula> agildata=fail mareigua.income=3800000 experian.score=580',
        '  node bin/bureaus.ts reset <cédula>',
    ].join('\n'));
}

function parsePairs(list: string[]): BureauConfig {
    const cfg: any = {};
    for (const p of list) {
        const m = /^([a-z]+)(?:\.([A-Za-z]+))?=(.+)$/.exec(p);
        if (!m) fail(`no entiendo «${p}»: se espera buró=estado o buró.campo=valor`);
        const [, bureau, field, raw] = m!;
        if (!(BUREAUS as readonly string[]).includes(bureau)) fail(`buró desconocido «${bureau}» (${BUREAUS.join(', ')})`);
        cfg[bureau] ??= {};
        if (!field) {
            if (!MODES.has(raw)) fail(`estado desconocido «${raw}» para ${bureau}: ok | empty | fail`);
            if (raw === 'empty' && !['agildata', 'mareigua'].includes(bureau)) fail(`${bureau} no tiene una respuesta «sin información» verificada: usá ok o fail`);
            cfg[bureau].mode = raw;
        } else {
            if (!FIELDS[bureau].includes(field)) fail(`${bureau} no tiene el campo «${field}» (${FIELDS[bureau].join(', ') || 'ninguno'})`);
            cfg[bureau][field] = field === 'occupation' ? raw : Number(raw.replace(/[^\d.-]/g, ''));
        }
    }
    return cfg;
}

if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') { help(); process.exit(0); }
if (!/^(https?:\/\/)?(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?/.test(LAMBDA)) {
    fail(`RISK_LAMBDA_URL apunta a ${LAMBDA}: estos estados sólo se dictan al mock LOCAL (el lambda es de la empresa y compartido)`);
}
if (!['show', 'set', 'reset'].includes(cmd)) fail(`comando desconocido «${cmd}»: show | set | reset (sin argumentos, la ayuda)`);
const cedula = String(doc || '').replace(/\D/g, '');
if (!cedula) fail('falta la cédula del caso');

if (cmd === 'show') {
    const now = await readBureauConfig(cedula).catch((e) => fail((e as Error).message));
    out({ ok: true, doc: cedula, bureaus: now }, [`Burós para ${cedula}:`, ...BUREAUS.map((c) => `  ${c.padEnd(9)} ${now[c]}`)].join('\n'));
} else {
    const r = await applyBureauConfig(cedula, cmd === 'reset' ? {} : parsePairs(pairs));
    // Dos cascadas distintas (verificado en `main`): la IDENTIDAD la resuelve la primera de agildata → mareigua →
    // tusdatos; el INGRESO y la ocupación sólo agildata o mareigua (TusDatos no los trae). Sin ninguna de las dos,
    // el wizard le pide al cliente su información laboral (lo DECLARADO).
    const identity = (['agildata', 'mareigua', 'tusdatos'] as const).find((c) => r.config[c].mode === 'ok');
    const income = (['agildata', 'mareigua'] as const).find((c) => r.config[c].mode === 'ok');
    out({ ok: r.ok, doc: cedula, config: r.config, identity: identity ?? null, income: income ?? 'declared',
          quantoOverrides: r.config.experian.mode === 'ok' && r.config.experian.quantoIncome > 0, lines: r.lines },
        [`${r.ok ? '✓' : '✗'} Burós para ${cedula}:`, ...r.lines.map((l) => '  ' + l),
         `  → identidad: ${identity ?? 'ninguna central la resuelve'}`,
         `  → ingreso y ocupación: ${income ?? 'ninguna central — el wizard le pide al cliente su información laboral (lo declarado)'}`,
         ...(r.config.experian.mode === 'ok' && r.config.experian.quantoIncome > 0
             ? [`  → y Quanto PISA el ingreso con $${Math.round(r.config.experian.quantoIncome).toLocaleString('es-CO')} (ocupación Empleado) si el comercio dispara Experian`] : []),
        ].join('\n'));
    if (!r.ok) process.exit(1);
}
