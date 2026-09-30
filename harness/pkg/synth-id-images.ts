import { TARGET } from './db.ts';

// LAS FOTOS DE LA CÉDULA DEL CLIENTE SINTÉTICO. El sintético saltea la validación de identidad, así que
// `users.front_url` / `back_url` quedan en NULL y hay que escribirlas para que la formalización no muera
// con «faltan documentos obligatorios».
//
// ⚠ Qué URL sirve depende de quién las descargue. En local el pdf-mapper es un mock que no descarga
// nada, y basta un string con forma de URL (host `mock-s3.local`). En dev, qa y staging el pdf-mapper es
// el REAL y baja cada URL para armar el PDF unificado: un host que no resuelve hace que /api/merge-urls
// responda 500 y la autorización del crédito falle ANTES de radicar, con el cliente sintético cerrando
// «en 11» como si hubiera terminado.
//
// Para esos ambientes se usa una imagen sintética (un rectángulo gris, sin datos de nadie) que vive en el
// bucket público de dev, bajo `harness/synth/`. `E2E_SYNTH_ID_IMAGE_BASE` la cambia de lugar.
const DEV_BASE = 'https://creditop-app-development-5yctskjv.s3.us-east-2.amazonaws.com/harness/synth';

export type IdFace = 'frontal' | 'reverso';

export function synthIdImageUrl(face: IdFace, doc: string | number, target: string = TARGET): string {
    if (target === 'local') return `https://mock-s3.local/front-web/users/documents/synth/${doc}/${face}.jpg`;
    const base = (process.env.E2E_SYNTH_ID_IMAGE_BASE || DEV_BASE).replace(/\/+$/, '');
    return `${base}/cedula-${face}.png`;
}
