import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Mutex entre procesos (filesystem) + re-apuntado de la cuenta de prueba Cognito.
 *
 * La cuenta merchant de prueba (`users.id = 1827080`) es un SINGLETON compartido: distintos specs la
 * necesitan ligada a comercios distintos (Motai vs SmartPay). El wizard solo deja entrar al comercio del
 * usuario (default-layout redirige si el hash de la URL ≠ el del usuario), así que cada spec debe RE-APUNTAR
 * la cuenta. Con `fullyParallel`, dos specs que la mutan a la vez se pisan → este lock los serializa.
 *
 * Patrón: en beforeAll → `acquireAccountLock()` + `pointAccount(allied, branch)`; en afterAll →
 * `pointAccount(MOTAI…)` (restaurar) + `releaseAccountLock()`.
 */

const ACCOUNT_ID = 1827080;
const LOCK_DIR = join(tmpdir(), 'creditop-e2e-account.lock');

/** Comercio Motai (estado "por defecto" de la cuenta; donde la dejamos al terminar). */
export const MOTAI_MERCHANT = { allied: 158, branch: 682 }; // hash f0548728
/** Comercio SmartPay (allied 24, con productos para el paso amount del flujo dinámico). */
export const SMARTPAY_MERCHANT = { allied: 24, branch: 570 }; // hash bb534d6a

export function pointAccount(alliedId: number, branchId: number): void {
    execFileSync('docker', [
        'exec', 'legacy-backend-mysql-1', 'mysql', '-ucreditop', '-ppassword', 'creditop',
        '-e', `UPDATE users SET allied_id=${alliedId}, allied_branch_id=${branchId} WHERE id=${ACCOUNT_ID};`,
    ], { stdio: 'pipe' });
}

/** Adquiere el mutex (mkdir atómico). Reintenta hasta ~150s (un test Cognito completo dura ~30–60s). */
export async function acquireAccountLock(): Promise<void> {
    for (let i = 0; i < 750; i++) {
        try {
            mkdirSync(LOCK_DIR); // falla si ya existe → otro spec lo tiene
            return;
        } catch {
            await new Promise((r) => setTimeout(r, 200));
        }
    }
    throw new Error('acquireAccountLock: timeout esperando el mutex de la cuenta de prueba');
}

export function releaseAccountLock(): void {
    try {
        rmSync(LOCK_DIR, { recursive: true, force: true });
    } catch {
        /* noop */
    }
}
