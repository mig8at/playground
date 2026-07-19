#!/usr/bin/env node
// steps-check — valida que TODA ruta de panel/steps.json exista en su repo.
//
// POR QUÉ EXISTE: el mapa de pasos del panel dice "este paso toca N archivos". Ese número solo vale si
// los archivos existen de verdad. Si alguien mueve o renombra uno, el panel seguiría mostrando el
// conteo viejo —dato con cara de verdad— y nadie se enteraría. Mismo espíritu que
// `context/tools/oracle.py`: lo no verificado se cae, y se cae RUIDOSAMENTE.
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

type Paso = { id: string; label: string; ruta?: string; front?: string[]; back?: string[]; nota?: string };
type Tramo = { label: string; cuando?: string; pasos: Paso[] };
type Mapa = {
    tronco: Paso[];
    ramales: Record<string, Tramo>;
    /** desvíos que SALEN del tronco y REINGRESAN (ej. Ábaco: confirmation → first-payment-date) */
    desvios?: Record<string, Tramo & { desde: string; hasta: string }>;
    /** lo inverso del desvío: arcos que SALTEAN pasos condicionales (ej. otp → lenders) */
    bypass?: Array<{ label: string; cuando?: string; desde: string; hasta: string }>;
    /** ni desvío ni ramal: CONTINÚAN después de un terminal (ej. la radicación SOAP de Credifamilia) */
    extensiones?: Record<string, Tramo & { desde: string }>;
};

const mapa: Mapa = JSON.parse(readFileSync(join(ROOT, 'panel', 'steps.json'), 'utf8'));
const jsonOut = process.argv.includes('--json');

const rotas: Array<{ tramo: string; paso: string; repo: string; ruta: string }> = [];
let total = 0;

function revisar(tramo: string, pasos: Paso[]) {
    for (const p of pasos) {
        for (const [repo, lista] of [['front', p.front ?? []], ['back', p.back ?? []]] as const) {
            for (const r of lista) {
                total++;
                if (!existsSync(join(REPOS[repo], r))) rotas.push({ tramo, paso: p.id, repo, ruta: r });
            }
        }
    }
}

revisar('tronco', mapa.tronco);
for (const [id, ram] of Object.entries(mapa.ramales)) revisar(id, ram.pasos);
for (const [id, d] of Object.entries(mapa.desvios ?? {})) revisar(`desvío:${id}`, d.pasos);
for (const [id, e] of Object.entries(mapa.extensiones ?? {})) revisar(`extensión:${id}`, e.pasos);

// Un desvío que sale o entra en un paso inexistente dibujaría una curva a la nada: se valida igual
// que las rutas de archivo, porque es el mismo tipo de mentira.
const idsTronco = new Set([...mapa.tronco, ...Object.values(mapa.ramales).flatMap((r) => r.pasos)].map((p) => p.id));
const anclas: Array<[string, string, string]> = [
    ...Object.entries(mapa.desvios ?? {}).flatMap(([id, d]) => [[`desvío:${id}`, 'desde', d.desde], [`desvío:${id}`, 'hasta', d.hasta]] as Array<[string, string, string]>),
    ...(mapa.bypass ?? []).flatMap((b, i) => [[`bypass:${i}`, 'desde', b.desde], [`bypass:${i}`, 'hasta', b.hasta]] as Array<[string, string, string]>),
    ...Object.entries(mapa.extensiones ?? {}).map(([id, e]) => [`extensión:${id}`, 'desde', e.desde] as [string, string, string]),
];
for (const [tramo, campo, val] of anclas) {
    if (!idsTronco.has(val)) rotas.push({ tramo, paso: campo, repo: 'ancla', ruta: `${val} (no existe como paso)` });
}

const pasos = mapa.tronco.length
    + Object.values(mapa.ramales).reduce((n, r) => n + r.pasos.length, 0)
    + Object.values(mapa.desvios ?? {}).reduce((n, d) => n + d.pasos.length, 0)
    + Object.values(mapa.extensiones ?? {}).reduce((n, e) => n + e.pasos.length, 0);

if (jsonOut) {
    console.log(JSON.stringify({ ok: rotas.length === 0, pasos, archivos: total, rotas }, null, 2));
} else if (rotas.length === 0) {
    console.log(`✔ steps.json OK — ${pasos} pasos · ${total} rutas, todas resuelven`);
} else {
    console.log(`✗ steps.json: ${rotas.length}/${total} rutas NO existen\n`);
    for (const r of rotas) console.log(`   [${r.tramo}/${r.paso}] ${r.repo}: ${r.ruta}`);
    console.log('\n  Alguien movió o renombró esos archivos. Actualizá panel/steps.json.');
}

process.exit(rotas.length === 0 ? 0 : 1);
