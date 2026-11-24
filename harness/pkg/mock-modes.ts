// QUIÉN CONTESTA: EL MOCK O EL SERVICIO DE VERDAD. Algunos mocks tienen detrás un microservicio que también corre en
// la Mac (el del pdf-mapper, el pdf-mapper-service del PDF Mapper Studio). Para esos, el mock tiene tres modos:
//
//   mock  → contesta siempre él (el PDF de demo): rápido y sin depender de nada.
//   auto  → el servicio real si tiene lo pedido; si no, el demo. Es el de siempre.
//   real  → todo va al servicio real, sin red de demo: si un documento no existe o el servicio falla, la corrida lo ve.
//
// El modo vive en `harness/.mock-modes.json` (fuera de git): el panel y `bin/mock-<id> mode` lo escriben, y el mock lo
// lee en CADA pedido, así que cambiarlo no pide reiniciar nada (ni el mock ni el backend, que sigue apuntando al mismo
// puerto). Sin archivo o con un valor raro, cada mock usa su modo por defecto.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MOCK_MODES = ['mock', 'auto', 'real'] as const;
export type MockMode = (typeof MOCK_MODES)[number];

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '.mock-modes.json');

function readAll(): Record<string, string> {
    try {
        const v = JSON.parse(readFileSync(FILE, 'utf8'));
        return v && typeof v === 'object' ? v : {};
    } catch {
        return {};
    }
}

export const isMockMode = (v: unknown): v is MockMode => typeof v === 'string' && (MOCK_MODES as readonly string[]).includes(v);

/** El modo de un mock; `fallback` si nadie lo eligió. */
export function mockMode(id: string, fallback: MockMode = 'auto'): MockMode {
    const v = readAll()[id];
    return isMockMode(v) ? v : fallback;
}

export function setMockMode(id: string, mode: MockMode): void {
    const all = readAll();
    all[id] = mode;
    writeFileSync(FILE, JSON.stringify(all, null, 2) + '\n');
}

/** ¿El servicio real contesta? Por su sonda de salud, 1,5 s como mucho. */
export async function realUp(health: string): Promise<boolean> {
    try {
        const r = await fetch(health, { signal: AbortSignal.timeout(1500) });
        return r.ok;
    } catch {
        return false;
    }
}
