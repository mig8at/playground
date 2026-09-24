// pkg/otp-bypass.ts — los teléfonos de prueba del bypass de OTP: UN solo lugar, y sin el permiso grueso.
//
// POR QUÉ EXISTE ESTE ARCHIVO. La función vivía DUPLICADA en `dev/walk-wizard.ts` y `dev/case.ts`,
// con dos textos distintos del mismo comentario y dos oportunidades de arreglar una sola. Es plumbing
// compartido: va en `pkg/`, como el resto de lo que usan los dos runners.
//
// QUÉ RESUELVE, ADEMÁS DE LA DUPLICACIÓN — tres cosas que costaron una tanda entera el 2026-09-17:
//
// 1 · EL PERMISO ERA DEMASIADO GRUESO. Escribir acá pedía `I_KNOW_THIS_TOUCHES_SHARED_DEV=1`, que abre
//     CUALQUIER escritura contra la base compartida durante toda la shell — para meter dos teléfonos en
//     una lista de pruebas. Ahora esta escritura lleva su propio permiso angosto (`permiso: 'otp-bypass'`
//     en `exec`), que la guarda concede SÓLO si la sentencia es exactamente ésta. La etiqueta no alcanza:
//     el SQL tiene que matchear, así que no se puede usar de contrabando para otra escritura. F-53 sigue
//     entero para todo lo demás.
//
// 2 · LA FALLA ERA MUDA. El llamador hacía `.catch(() => null)` y avisaba «no se pudo ampliar», sin decir
//     por qué. Con la guarda rechazando, esos nueve casos murieron DOS pantallas más adelante, en el OTP,
//     con el mensaje genérico del front — y la causa real sólo se veía en los logs del backend. Por eso
//     acá no se devuelve `null` pelado: se devuelve el MOTIVO, para que el aviso lo pueda nombrar.
//
// 3 · DOS CORRIDAS A LA VEZ SE PISABAN. Era leer, agregar lo mío, guardar: dos procesos leen la misma
//     lista y el segundo guarda encima del primero. Peor era la restauración, que reponía la lista
//     ENTERA como la vio esa corrida: el primero en terminar le borraba los teléfonos a los otros, que
//     seguían caminando. Ahora la suma es UNA sentencia que se resuelve en la base (`JSON_MERGE_PRESERVE`)
//     y la limpieza saca SÓLO los teléfonos que puso esta corrida (`JSON_REMOVE` sobre `JSON_SEARCH`).
//     Sin ventana entre leer y escribir, no hay nada que pisarse.
//
// ⚠ Y NO SE TOCA SI ESTÁ EL COMODÍN. Con `"*"` en la lista cualquier teléfono pasa: ampliarla sería
// escribir en la base sin motivo y dejar a la corrida creyendo que hizo algo que no hizo.

const { exec, one } = await import('./db.ts');

/** La clave del ajuste. Una constante porque aparece en cuatro sentencias y en el permiso de la guarda. */
export const BYPASS_KEY = 'qa_otp_bypass_phones';

/** Lo que ESTA corrida agregó. Se devuelve para poder sacar exactamente eso y nada más. */
export interface BypassSet {
    /** Los teléfonos que esta corrida sumó a la lista. Vacío = no hizo falta tocar nada. */
    agregados: string[];
    /** `true` si la lista tenía el comodín: no se escribió, y no hay nada que limpiar. */
    comodin: boolean;
}

/** Por qué no se pudo. Se devuelve en vez de tirar para que el llamador AVISE con la causa y siga. */
export interface BypassRejected {
    motivo: string;
}

export type BypassResult = { ok: true; puesto: BypassSet } | { ok: false; motivo: string };

/**
 * Suma estos teléfonos a la lista del bypass, sin pisar lo que haya puesto otra corrida.
 *
 * La suma es una sola sentencia y se resuelve DENTRO de la base: no hay un «leé / modificá / guardá»
 * que dos procesos puedan entrelazar. El `WHERE` lleva la condición del comodín, así que la decisión de
 * no escribir también la toma la base y no una lectura previa que ya podría estar vieja.
 */
export async function registerBypass(tels: string[]): Promise<BypassResult> {
    const uniqueOnes = [...new Set(tels.map(String).filter(Boolean))];
    if (!uniqueOnes.length) return { ok: true, puesto: { agregados: [], comodin: false } };

    const row = await one<{ value: string; comodin: number; ya: number }>(
        'SELECT value, JSON_CONTAINS(value, \'"*"\') AS comodin, JSON_VALID(value) AS ya'
        + ' FROM settings WHERE `key`=?', [BYPASS_KEY],
    ).catch((e) => { throw new Error(`no se pudo leer \`${BYPASS_KEY}\`: ${message(e)}`); });

    if (!row) return { ok: false, motivo: `no existe la fila \`${BYPASS_KEY}\` en \`settings\`` };
    if (!row.ya) return { ok: false, motivo: `\`${BYPASS_KEY}\` no es JSON válido — alguien lo dejó a medias` };
    if (row.comodin) return { ok: true, puesto: { agregados: [], comodin: true } };

    // Los que YA están no se vuelven a agregar: `JSON_MERGE_PRESERVE` conserva duplicados, y una lista
    // con el mismo teléfono ocho veces funciona pero es basura que después nadie sabe de dónde salió.
    const current: string[] = JSON.parse(row.value ?? '[]').map(String);
    const missing = uniqueOnes.filter((t) => !current.includes(t));
    if (!missing.length) return { ok: true, puesto: { agregados: [], comodin: false } };

    try {
        await exec(
            'UPDATE settings SET value = JSON_MERGE_PRESERVE(value, CAST(? AS JSON))'
            + ' WHERE `key`=? AND JSON_CONTAINS(value, \'"*"\') = 0',
            [JSON.stringify(missing), BYPASS_KEY],
            { permiso: 'otp-bypass' },
        );
    } catch (e) {
        return { ok: false, motivo: message(e) };
    }
    return { ok: true, puesto: { agregados: missing, comodin: false } };
}

/**
 * Saca de la lista SÓLO lo que puso esta corrida.
 *
 * ⚠ Acá estaba el bug entre procesos: la versión vieja reponía el valor entero que había leído al
 * arrancar, o sea que el primero en terminar dejaba afuera a los teléfonos de las corridas que seguían
 * vivas — y ésas morían en el OTP sin ninguna pista. Una sentencia por teléfono, cada una condicionada
 * a que ese teléfono siga estando.
 *
 * Limpiar es higiene: si falla, se traga. Dejar un teléfono de prueba de más no rompe nada; tumbar la
 * corrida por no haber podido limpiarla, sí.
 */
export async function restoreBypass(set: BypassSet | null): Promise<void> {
    if (!set || set.comodin || !set.agregados.length) return;
    for (const tel of set.agregados) {
        await exec(
            'UPDATE settings SET value = JSON_REMOVE(value, JSON_UNQUOTE(JSON_SEARCH(value, \'one\', ?)))'
            + ' WHERE `key`=? AND JSON_SEARCH(value, \'one\', ?) IS NOT NULL',
            [tel, BYPASS_KEY, tel],
            { permiso: 'otp-bypass' },
        ).catch(() => { /* higiene, no puede tumbar la corrida */ });
    }
}

function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
