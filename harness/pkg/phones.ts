// pkg/phones.ts — la forma del celular sintético, en UN solo lugar.
//
// POR QUÉ EXISTE. Había DOS derivaciones del mismo teléfono, cada una con media lección:
//
//   · `pkg/merchants.ts::branchPhone` sacaba el LARGO del país (`countries.cell_phone_lenght`),
//     que es lo correcto — pero armaba el prefijo con el primer dígito de la semilla, y su comentario
//     decía que «lo que importa para pasar la validación es el LARGO, no que el número sea plausible».
//   · `dev/case.ts::phoneOf` sacaba las dos cosas de una tabla por país, y había aprendido que eso
//     ES FALSO para República Dominicana: comparte el +1 con todo el NANP, así que el país sale del
//     ÁREA y sólo 809/829/849 son suyas. Con un dígito cualquiera, libphonenumber la ubica en otro
//     país y el país resuelto sale mal — sin fallar, que es lo peor.
//
// O sea que los cuatro runners que usaban la primera (`caminar-wizard`, `sweep`, `listado`,
// `bcp-volver`) venían armando dominicanos con prefijo equivocado, y ninguno podía enterarse. Es el
// caso de manual de «dos derivaciones que tienen que coincidir son una que en algún momento no
// coincide» — frase que, con toda la ironía, ya estaba escrita en `case.ts` sobre OTRO teléfono.
//
// Acá se juntan las dos mitades: el LARGO se le pregunta al país (dato, no regla del código) y el
// PREFIJO sale de la tabla, que es donde vive lo que el largo no captura.

const { query } = await import('./db.ts');
const { syntheticDocument } = await import('./documents.ts');

/**
 * La forma del móvil por país. Es chica a propósito: sólo los países donde el arnés corre.
 *
 * ⚠ El `largo` de acá es el de respaldo. El que manda es `countries.cell_phone_lenght`, porque es un
 * DATO del ambiente y no una regla del código — si mañana un país cambia, cambia en la base y nadie
 * tiene que tocar esta tabla. El `prefijo`, en cambio, no está en ninguna columna: eso sí vive acá.
 */
export const PHONE_SHAPE: Record<string, { prefijo: string; largo: number }> = {
    // ⚠ '31' Y NO '3': el front valida con `COLOMBIAN_PHONE_REGEX = /^3[0-5][0-9]{8}$/`, o sea que el
    // SEGUNDO dígito tiene que ser 0-5. Con el prefijo en '3' ese dígito salía de la base de la corrida
    // y podía caer 6-9: el número se veía perfectamente colombiano, la corrida moría en la PRIMERA
    // pantalla con «Ingresa un número de teléfono colombiano válido», y como depende de la base, fallaba
    // unas corridas sí y otras no. Medido el 2026-09-18: `3609420000` mató el canal de asesor entero.
    // `31` es además un prefijo real (Claro). La regla la fija `phones.spec.ts` contra la MISMA
    // expresión del front, que este archivo ya reexporta.
    COL: { prefijo: '31', largo: 10 },
    DOM: { prefijo: '809', largo: 10 },   // 809/829/849 — ver el encabezado: el área ES el país
    PER: { prefijo: '9', largo: 9 },
};

/**
 * Un móvil sintético con la forma de ese país.
 *
 * Los DOS ÚLTIMOS DÍGITOS son el índice del caso: es lo que garantiza uno distinto por caso, que es la
 * condición para correr en paralelo. El resto se rellena con la base de la corrida.
 *
 * `largo` pisa el de la tabla cuando el país lo declara (lo trae `branchShape`).
 */
export function syntheticPhone(iso: string, index: number, base: number, length?: number): string {
    const f = PHONE_SHAPE[(iso || '').toUpperCase()] ?? PHONE_SHAPE.COL;
    const total = length && length > 0 ? length : f.largo;
    const idx = String(index % 100).padStart(2, '0');
    // Si el país fuera tan corto que no entran prefijo + índice, el índice manda: sin él dos casos
    // en paralelo comparten teléfono, que es el único error que rompe la tanda entera y no un caso.
    const filled = Math.max(total - f.prefijo.length - idx.length, 0);
    // ⚠ Los ÚLTIMOS dígitos de la base, no los primeros, y no es indistinto: la base arranca con una
    // constante (`109…`) y lo que varía entre corridas está al final. Rellenando desde el principio,
    // dos tandas del mismo día producen casi el mismo número y terminan chocando de usuario.
    const digits = String(base).replace(/\D/g, '').repeat(2);
    const body = filled === 0 ? '' : digits.slice(digits.length - filled);
    return (f.prefijo + body + idx).slice(0, total);
}

/**
 * Qué forma pide el país de ESTA sucursal: su ISO-3 y el largo que declara.
 *
 * ⚠ EL ISO-3 VIVE EN `countries.iso_code_2`, y no es un typo de este archivo: la columna está mal
 * nombrada en el esquema. `iso_code_1` trae el de DOS letras (`CO`) y `iso_code_2` el de TRES (`COL`);
 * `iso_code_3` existe y está VACÍA en los cuatro países que miré. Verificado el 2026-09-17 contra la
 * base compartida. Quien vaya a usar `iso_code_3` porque el nombre suena bien, no va a encontrar nada.
 */
export async function branchShape(branchHash: string): Promise<{ iso: string; largo: number }> {
    const [row]: any[] = await query(
        `SELECT c.cell_phone_lenght AS largo, c.iso_code_2 AS iso
           FROM allied_branches b JOIN allieds a ON a.id=b.allied_id
           JOIN countries c ON c.id=a.country_id WHERE b.hash=? LIMIT 1`, [branchHash]);
    return { iso: String(row?.iso ?? '').trim().toUpperCase() || 'COL', largo: Number(row?.largo) || 0 };
}

/**
 * El TELÉFONO que acepta el comercio: largo de su país, prefijo de su país.
 *
 * El arnés traía un móvil colombiano fijo, y contra un comercio de otro país el registro se cae con un
 * 422 —«el número de celular debe tener 9 dígitos» con Perú— antes de llegar a nada interesante.
 *
 * La firma no cambió (`semilla` es un número entero del que salen los dígitos de relleno y, en sus dos
 * últimas posiciones, el índice del caso), así que los cuatro runners que ya la llamaban siguen igual.
 * Lo que cambió es que ahora el número también es PLAUSIBLE en su país, no sólo del largo correcto.
 */
export async function branchPhone(branchHash: string, seedValue = 3131010101): Promise<string> {
    const { iso, largo: length } = await branchShape(branchHash);
    const digits = String(seedValue).replace(/\D/g, '');
    return syntheticPhone(iso, Number(digits.slice(-2)), Number(digits) || 3131010101, length);
}

/**
 * El DOCUMENT con la forma del país de esa sucursal. Vive acá —al lado del teléfono y no dentro de un
 * runner— por el mismo motivo: los dos se derivan del país y los dos rompieron ya una vez por no hacerlo
 * (F-231 el teléfono, el documento el 2026-09-18 contra CeluRD).
 */
export async function branchDocument(branchHash: string, index: number, base: number): Promise<string> {
    const { iso } = await branchShape(branchHash);
    return syntheticDocument(iso, index, base);
}

/**
 * El teléfono del CODEUDOR, derivado del titular: distinto y reproducible.
 *
 * Vive acá y no dentro de quien resuelve el codeudor porque hacen falta DOS cosas con él y en momentos
 * distintos —registrarlo en el bypass de OTP antes de arrancar la tanda, y usarlo al unir al codeudor—,
 * y dos derivaciones que tienen que coincidir son una que en algún momento no coincide. Es justo lo que
 * pasaba: la lista de bypass sólo llevaba los teléfonos de los TITULARES, así que el OTP del codeudor
 * no estaba bypasseado, su `otp-validate` no devolvía solicitud, y el runner lo reportaba como «el
 * codeudor abrió otra solicitud (—) en vez de unirse» — que manda a buscar un problema de vínculo donde
 * había uno de OTP. Medido contra qa el 2026-09-02 con Rent to Own (#205).
 */
export const coSignerPhone = (holderPhone: string): string => `${holderPhone.slice(0, -2)}99`;
