#!/usr/bin/env node
// steps-check — valida que TODA ruta de panel/steps.json exista en su repo.
//
// POR QUÉ EXISTE: el mapa de pasos del panel dice "este paso toca N archivos". Ese número solo vale si
// los archivos existen de verdad. Si alguien mueve o renombra uno, el panel seguiría mostrando el
// conteo viejo —dato con cara de verdad— y nadie se enteraría. Mismo espíritu que
// el oráculo del árbol de contexto (borrado el 2026-09-21): lo no verificado se cae, y se cae RUIDOSAMENTE.
//
//   node bin/steps-check.ts            → valida y sale 0/1
//   node bin/steps-check.ts --json     → salida JSON (para el panel)
//
// Sale 1 si alguna ruta no resuelve, así se puede encadenar.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOS: Record<string, string> = {
    front: join(homedir(), 'Desktop/CREDITOP/github/frontend-monorepo'),
    back: join(homedir(), 'Desktop/CREDITOP/github/legacy-backend'),
};

type Step = { id: string; label: string; ruta?: string; front?: string[]; back?: string[]; nota?: string };
type Segment = { label: string; cuando?: string; pasos: Step[] };
type StepMap = {
    tronco: Step[];
    ramales: Record<string, Segment>;
    /** desvíos que SALEN del tronco y REINGRESAN (ej. Ábaco: confirmation → first-payment-date) */
    desvios?: Record<string, Segment & { desde: string; hasta: string }>;
    /** lo inverso del desvío: arcos que SALTEAN pasos condicionales (ej. otp → lenders) */
    bypass?: Array<{ label: string; cuando?: string; desde: string; hasta: string }>;
    /** ni desvío ni ramal: CONTINÚAN después de un terminal (ej. la radicación SOAP de Credifamilia) */
    extensiones?: Record<string, Segment & { desde: string }>;
};

const stepMap: StepMap = JSON.parse(readFileSync(join(ROOT, 'panel', 'steps.json'), 'utf8'));
const jsonOut = process.argv.includes('--json');

const broken: Array<{ tramo: string; paso: string; repo: string; ruta: string }> = [];
let total = 0;

function review(segment: string, steps: Step[]) {
    for (const p of steps) {
        for (const [repo, list] of [['front', p.front ?? []], ['back', p.back ?? []]] as const) {
            for (const r of list) {
                total++;
                if (!existsSync(join(REPOS[repo], r))) broken.push({ tramo: segment, paso: p.id, repo, ruta: r });
            }
        }
    }
}

review('tronco', stepMap.tronco);
for (const [id, ram] of Object.entries(stepMap.ramales)) review(id, ram.pasos);
for (const [id, d] of Object.entries(stepMap.desvios ?? {})) review(`desvío:${id}`, d.pasos);
for (const [id, e] of Object.entries(stepMap.extensiones ?? {})) review(`extensión:${id}`, e.pasos);
// `terminales` son pantallas reales que el mapa NO dibuja (se llega desde varios puntos), pero sus
// archivos rotan igual que los demás: si no se validan acá, se pudren en silencio.
review('terminales', (stepMap as any).terminales?.pasos ?? []);

// Un desvío que sale o entra en un paso inexistente dibujaría una curva a la nada: se valida igual
// que las rutas de archivo, porque es el mismo tipo de mentira.
const trunkIds = new Set([...stepMap.tronco, ...Object.values(stepMap.ramales).flatMap((r) => r.pasos)].map((p) => p.id));
const anchors: Array<[string, string, string]> = [
    ...Object.entries(stepMap.desvios ?? {}).flatMap(([id, d]) => [[`desvío:${id}`, 'desde', d.desde], [`desvío:${id}`, 'hasta', d.hasta]] as Array<[string, string, string]>),
    ...(stepMap.bypass ?? []).flatMap((b, i) => [[`bypass:${i}`, 'desde', b.desde], [`bypass:${i}`, 'hasta', b.hasta]] as Array<[string, string, string]>),
    ...Object.entries(stepMap.extensiones ?? {}).map(([id, e]) => [`extensión:${id}`, 'desde', e.desde] as [string, string, string]),
];
for (const [segment, field, val] of anchors) {
    if (!trunkIds.has(val)) broken.push({ tramo: segment, paso: field, repo: 'ancla', ruta: `${val} (no existe como paso)` });
}

const steps = stepMap.tronco.length
    + Object.values(stepMap.ramales).reduce((n, r) => n + r.pasos.length, 0)
    + Object.values(stepMap.desvios ?? {}).reduce((n, d) => n + d.pasos.length, 0)
    + Object.values(stepMap.extensiones ?? {}).reduce((n, e) => n + e.pasos.length, 0)
    // `terminales` cuenta como paso aunque el mapa no lo dibuje: si el total dijera menos pasos de los
    // que el archivo tiene, el número dejaría de servir para notar que se agregó o se perdió uno.
    + ((stepMap as any).terminales?.pasos?.length ?? 0);

if (jsonOut) {
    console.log(JSON.stringify({ ok: broken.length === 0, pasos: steps, archivos: total, rotas: broken }, null, 2));
} else if (broken.length === 0) {
    console.log(`✔ steps.json OK — ${steps} pasos · ${total} rutas, todas resuelven`);
} else {
    console.log(`✗ steps.json: ${broken.length}/${total} rutas NO existen\n`);
    for (const r of broken) console.log(`   [${r.tramo}/${r.paso}] ${r.repo}: ${r.ruta}`);
    console.log('\n  Alguien movió o renombró esos archivos. Actualizá panel/steps.json.');
}

process.exit(broken.length === 0 ? 0 : 1);
