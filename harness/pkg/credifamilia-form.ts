// LOS CAMPOS DEL FORMULARIO QUE EXIGE EL SOAP DE CREDIFAMILIA. La radicación (`transaccionConsumo`) los lee
// del formulario dinámico (`user_field_values`, por `field_id`) en `TransactionRequest`, y el servicio de
// pruebas del proveedor —el real— responde 400 si falta alguno: activos, pasivos, dirección y las tres
// ciudades. El cliente sintético no pasa por ese formulario, así que hay que sembrarlos.
//
// ⚠ Cuál valor es «el primero que lee» sale de las listas de prioridad de `TransactionRequest` (p. ej.
// activos = [216, 49]): acá se escribe el PRIMER id de cada lista, que es el que gana.
// ⚠ Las ciudades se resuelven por NOMBRE contra `country_cities` (mayúsculas, sin margen): tiene que ser
// el nombre exacto de la tabla («Bogotá D.C.» → 11001), no el de la ciudad como se escribiría a mano.
// ⚠ Credifamilia valida activos > 1 SMLMV, pasivos <= activos y egresos < ingresos.
const CITY = 'Bogotá D.C.';

export const CREDIFAMILIA_FORM_FIELD = {
    activos: 216,
    pasivos: 217,
    egresosMensuales: 90,
    direccionResidencia: 186,
    ciudadResidencia: 185,
    ciudadNacimiento: 228,
    ciudadExpedicion: 219,
} as const;

export function isCredifamilia(lenderName: string): boolean {
    return /credifamilia/i.test(lenderName);
}

/** Los campos del formulario que el SOAP de Credifamilia exige, con valores que cumplen sus reglas. */
export function credifamiliaFormFields(income: number): Record<number, string> {
    const f = CREDIFAMILIA_FORM_FIELD;
    return {
        [f.activos]: '30000000',
        [f.pasivos]: '5000000',
        [f.egresosMensuales]: String(Math.max(1, Math.min(1_000_000, Math.floor(income * 0.4)))),
        [f.direccionResidencia]: 'Calle 74 # 02 - 10',
        [f.ciudadResidencia]: CITY,
        [f.ciudadNacimiento]: CITY,
        [f.ciudadExpedicion]: CITY,
    };
}
