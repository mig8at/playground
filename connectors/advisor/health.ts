export interface SessionHealth {
    hay: boolean;
    ruta: string;
    /** `true` si las cookies que llevan la sesión siguen vivas. */
    sirve: boolean;
    /** Minutos que le quedan a la que vence primero, o `null` si no se pudo saber. */
    minutos: number | null;
    /**
     * `true` si la cookie del refresh token NO venció.
     *
     * ⚠ NO PROMETE QUE SE PUEDA RENOVAR, y la diferencia costó una hipótesis. La fecha de la cookie y
     * la validez del token son cosas distintas: el proveedor puede haberlo revocado o rotado y la
     * cookie sigue diciendo 30 días. Medido el 2026-09-17 contra qa — con `_rt` «vivo» por un mes, el
     * wizard intentó renovar, falló, y contestó `Set-Cookie: _at=; _rt=; Max-Age=0`, o sea borrando
     * la sesión. Esto dice «todavía hay de dónde intentarlo», no «va a funcionar».
     */
    renovable: boolean;
    /** Listo para imprimir. */
    motivo: string;
}

/**
 * Las cookies que LLEVAN la sesión, por nombre.
 *
 * `_at` es el token de acceso del wizard y `cognito` el del proveedor: si cualquiera de las dos venció,
 * la corrida termina en `/login` por más que el archivo esté. Las demás del archivo son idioma, CSRF,
 * analítica y el `post-auth` efímero del handshake — ninguna decide si hay sesión.
 */
const SESSION_COOKIES = new Set(['_at', 'cognito']);
/** El refresh token: no autentica por sí solo, pero dice si se puede recuperar sin clave. */
const REFRESH_COOKIE = '_rt';

export function cookiesHealth(
    cookies: Array<{ name: string; expires?: number }>,
    path = 'sesión de asesor',
    nowSec = Date.now() / 1000,
): SessionHealth {
    const base = { hay: true, ruta: path, minutos: null as number | null };
    // Una cookie sin `expires` (o con -1) es «de sesión»: muere al cerrar el navegador, y en un
    // storageState replayado eso equivale a que no caduca. No se cuenta como vencida.
    const remainingCount = (c: { expires?: number }) => (!c.expires || c.expires < 0 ? Infinity : (c.expires - nowSec) / 60);
    const round = (m: number) => (Number.isFinite(m) ? Math.round(m) : null);

    const fromSession = cookies.filter((c) => SESSION_COOKIES.has(c.name));
    const refresh = cookies.find((c) => c.name === REFRESH_COOKIE);
    const renewable = !!refresh && remainingCount(refresh) > 0;

    if (!fromSession.length) {
        return { ...base, sirve: false, renovable: renewable,
            motivo: `${path} no trae ninguna cookie de sesión (${[...SESSION_COOKIES].join(', ')}) — está incompleto` };
    }

    const expiredOnes = fromSession.filter((c) => remainingCount(c) <= 0);
    const minutes = Math.min(...fromSession.map(remainingCount));

    if (expiredOnes.length) {
        const howMuch = Math.round(-Math.min(...expiredOnes.map(remainingCount)));
        return { ...base, sirve: false, minutos: round(minutes), renovable: renewable,
            motivo: `la sesión de ${path} venció hace ${howMuch} min (${expiredOnes.map((c) => c.name).join(', ')})`
                + (renewable
                    ? ' — la cookie del refresh no venció, pero eso NO garantiza que sirva: hay que volver a entrar igual'
                    : '') };
    }

    return { ...base, sirve: true, renovable: renewable, minutos: round(minutes),
        motivo: Number.isFinite(minutes) ? `sesión válida por ${Math.round(minutes)} min más` : 'sesión válida' };
}

