import { lookup } from 'node:dns/promises';

/**
 * ¿Está prendida la VPN de dev?
 *
 * Los ambientes que NO son local (dev, qa, staging) comparten una base y unos servicios internos que sólo
 * se alcanzan por esa VPN. Sin ella el síntoma no se parece a la causa: el asesor "no se puede verificar",
 * el `assign` da timeout, la corrida muere en su primer paso y la BD dice «no llegó a crear ninguna
 * solicitud» (2026-09-29, visto dos veces antes de mirar la VPN). La pregunta es barata —una resolución
 * de nombres— y el nombre sólo existe DENTRO de esa red, así que sirve de sonda.
 *
 * El nombre es el mismo que usa `make keyring` para decir «VPN dev ✔/✗».
 */
export const VPN_DEV_HOST = process.env.VPN_DEV_PROBE_HOST || 'self-manager-api.inertia-develop';

export interface VpnStatus {
    arriba: boolean;
    detalle: string;
}

/** La decisión, separada de la red: se fija con pruebas sin depender de que la VPN esté (o no). */
export function classifyVpn(address: string | null, error?: string): VpnStatus {
    if (address) return { arriba: true, detalle: `${VPN_DEV_HOST} → ${address}` };
    return { arriba: false, detalle: `${VPN_DEV_HOST} no resuelve${error ? ` (${error})` : ''}: sin la VPN de dev no se alcanzan la base ni los servicios de dev, qa y staging` };
}

export async function vpnDev(resolver: (host: string) => Promise<{ address: string }> = lookup, timeoutMs = 3000): Promise<VpnStatus> {
    try {
        const r = await Promise.race([
            resolver(VPN_DEV_HOST),
            new Promise<never>((_, no) => setTimeout(() => no(new Error(`timeout ${timeoutMs} ms`)), timeoutMs)),
        ]);
        return classifyVpn(r.address);
    } catch (e) {
        return classifyVpn(null, (e as NodeJS.ErrnoException).code || (e as Error).message);
    }
}
