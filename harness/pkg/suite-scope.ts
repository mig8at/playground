// suite-scope.ts — ¿esta suite es del runner de casos, y vale en ESTE ambiente?
//
// POR QUÉ EXISTE. Una suite asume los datos de una base concreta: qué entidades tiene asignadas cada
// comercio, qué sucursal de prueba existe. Medido el 2026-11-03: corridas en qa, 11 de 18 suites fallaban
// sin regresión, sólo porque en la base compartida los comercios no tienen las mismas entidades que en
// local; y la regresión local marcaba en rojo una suite escrita para qa. Un rojo que no es del código
// entrena a ignorar el rojo. La suite declara dónde vale (`"ambientes": ["local"]`) y los runners la
// SALTAN en otro ambiente, diciéndolo, en vez de correrla y contarla como rota.
//
// Sin la clave, la suite vale en todos (las existentes no cambian). Es lógica pura: sin base, sin red, y se
// prueba en `suite-scope.spec.ts`. La usan `dev/case.ts`, `dev/regression.ts` y `dev/knowledge-suites.ts`.

/** Los ambientes donde corre el runner de casos. `prod` no: el Makefile la frena antes. */
export const SUITE_TARGETS = ['local', 'dev', 'qa', 'staging'] as const;

/**
 * El código de salida de `case.ts` cuando la suite no vale en el target: no corrió nada. Distinto de
 * 0 (verde), 1 (algún caso no cumple) y 2 (el prevuelo o el ambiente frena, o la suite es inválida).
 */
export const EXIT_NOT_FOR_TARGET = 3;

/** Las claves de `espera` que sólo entiende `dev/ecommerce.ts` (`make harness-ecommerce`). */
export const ECOMMERCE_WAIT_KEYS = ['prefill', 'vinculada', 'entidadesMin', 'salaDeEspera', 'returnUrl'] as const;

/**
 * Los ambientes que declara la suite, o `null` si no declara (vale en todos). Tira si la clave está mal
 * escrita: una lista vacía o un ambiente desconocido (`"QA "`, `"develop"`) haría que la suite no corriera en
 * ningún lado sin avisar, que es otra forma de falso verde.
 */
export function suiteTargets(json: any): string[] | null {
    if (!json || typeof json !== 'object' || !('ambientes' in json)) return null;
    const v = json.ambientes;
    if (!Array.isArray(v) || v.length === 0) {
        throw new Error('`ambientes` tiene que ser una lista no vacía de ambientes, p. ej. ["local"] o ["local", "qa"]');
    }
    const unknown = v.filter((t: unknown) => typeof t !== 'string' || !(SUITE_TARGETS as readonly string[]).includes(t));
    if (unknown.length) {
        throw new Error(`\`ambientes\` trae ${unknown.map((t: unknown) => JSON.stringify(t)).join(', ')}: los válidos son ${SUITE_TARGETS.join(', ')}`);
    }
    return [...new Set(v as string[])];
}

export type SuiteScope =
    /** Del runner de casos y vale en el target: se corre. */
    | { kind: 'run' }
    /** Del runner de casos, pero declara otros ambientes: se saltea. */
    | { kind: 'not-for-target'; targets: string[] }
    /** No es del runner de casos (otro runner, o no tiene casos): se saltea, no es rojo. */
    | { kind: 'other-runner'; reason: string };

/**
 * Qué hacer con una suite ya parseada en un target. Una suite del runner de casos con claves mal escritas
 * NO cae acá como «otro runner»: sigue siendo `run` y `case.ts` la rechaza (falla cerrado). Sólo se aparta
 * lo que es reconociblemente de otro runner: sin `casos`, o con las claves de `espera` del de ecommerce.
 */
export function suiteScope(json: any, target: string): SuiteScope {
    if (!Array.isArray(json?.casos) || json.casos.length === 0) {
        return { kind: 'other-runner', reason: 'no tiene `casos`: no es una suite del runner de casos' };
    }
    if (usesEcommerceKeys(json)) {
        return { kind: 'other-runner', reason: 'es del runner del canal ecommerce (dev/ecommerce.ts · make harness-ecommerce)' };
    }
    const targets = suiteTargets(json);
    if (targets && !targets.includes(String(target).toLowerCase())) return { kind: 'not-for-target', targets };
    return { kind: 'run' };
}

function usesEcommerceKeys(json: any): boolean {
    const waits = [json?.porDefecto?.espera, ...(json.casos as any[]).map((c) => c?.espera)];
    return waits.some((e) => e && typeof e === 'object' && ECOMMERCE_WAIT_KEYS.some((k) => k in e));
}
