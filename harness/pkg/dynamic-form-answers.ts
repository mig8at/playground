// dynamic-form-answers.ts — llena un formulario dinámico de form-service (el «backend-driven») a partir de su
// esquema, como lo haría un cliente que contesta lo mínimo: «no» en las preguntas de sí/no, la primera opción en
// las listas, Bogotá en las ubicaciones y un texto plausible en lo libre.
//
// ⚠ RESPETA LAS DEPENDENCIAS DEL ESQUEMA. Un campo con `parentId` sólo aparece si su padre tiene el valor
// `parentValue` (por ejemplo, las preguntas de empleo dependen de la ocupación, el campo 29, que no está en el
// formulario: viene del cliente). Contestar un campo oculto no rompe nada en el servicio, pero guardaría datos
// que el cliente nunca vio; por eso se contestan sólo los visibles.
//
// ⚠ LOS VALORES. Una pregunta con opciones guarda la CLAVE de la opción (`no`, `regimen_comun`); una ubicación
// guarda el id de la zona o de la ciudad del árbol del país; un país, su id. Es lo que guarda el formulario real.

// Acepta los DOS formatos del esquema: el crudo de form-service (`parentId`/`parentValue`, opciones `{key, name}`) y
// el que devuelve el loader del asistente, ya adaptado (`dependency.parentFormKey`, opciones `{value, label}`,
// `formKey` = `field_<id>`). El caminador recibe el segundo; las pruebas sobre los fixtures, el primero.
type Option = { id?: number; key?: string; name?: string; value?: string; label?: string };
type Field = {
    id: number; type: string; label?: string; dataSource?: string | null;
    parentId?: number | null; parentValue?: string | null; relatedFieldId?: number | null;
    options?: Option[];
    formKey?: string;
    dependency?: { parentFormKey?: string; parentValue?: string } | null;
};
const idOfKey = (k?: string) => (k ? Number(String(k).replace(/^field_/, '')) : null);
type Zone = { id: number; name: string; cities?: Array<{ id: number; name: string }> };

export interface FormContext {
    /** La ocupación del cliente (el campo 29): decide qué preguntas de empleo se ven. */
    occupation: string;
    /** Total de activos y de pasivos (Credifamilia exige activos > 1 SMMLV y pasivos ≤ activos). */
    assets?: number;
    liabilities?: number;
}

/** Las respuestas para el action del formulario (`{ answers }`), con la clave del id de cada campo. */
export function answersFromSchema(loaderData: any, ctx: FormContext): Record<string, string | number> {
    const fields: Field[] = (loaderData?.formDefinition?.sections ?? []).flatMap((s: any) => s.fields ?? []);
    const zones: Zone[] = loaderData?.countryTree?.zones ?? [];
    const countries: Array<{ id: number; name: string }> = Array.isArray(loaderData?.countries)
        ? loaderData.countries : (loaderData?.countries?.countries ?? []);
    const zone = zones.find((z) => /bogot/i.test(z.name)) ?? zones[0];
    const city = zone?.cities?.find((c) => /bogot/i.test(c.name)) ?? zone?.cities?.[0];
    const colombia = countries.find((c) => /colombia/i.test(c.name)) ?? countries[0];

    // Lo que «muestra» cada campo contestado, para resolver las dependencias: el nombre de la opción elegida
    // (`parentValue` compara contra el nombre, «Sí»), o el valor tal cual.
    const shown = new Map<number, string>([[29, ctx.occupation]]);
    const out: Record<string, string | number> = {};

    // Varias pasadas: un campo puede depender de otro que aparece más abajo en el esquema.
    for (let pass = 0; pass < 4; pass++) {
        for (const f of fields) {
            const key = f.formKey ?? String(f.id);
            if (key in out) continue;
            const parent = f.parentId ?? idOfKey(f.dependency?.parentFormKey);
            const parentValue = f.parentValue ?? f.dependency?.parentValue;
            if (parent != null && shown.get(parent) !== parentValue) continue;
            const ds = f.dataSource ?? '';
            const options = f.options ?? [];
            let value: string | number;
            let label: string;
            if (ds === 'field_options.country_tree.zones') { value = String(zone?.id ?? ''); label = zone?.name ?? ''; }
            else if (ds === 'field_options.country_tree.zones.cities') { value = String(city?.id ?? ''); label = city?.name ?? ''; }
            else if (ds === 'field_options.countries') { value = String(colombia?.id ?? ''); label = colombia?.name ?? ''; }
            else if (options.length) {
                const pick = options.find((o) => /^no$/i.test(o.key ?? o.value ?? '') || /^no$/i.test(o.name ?? o.label ?? '')) ?? options[0];
                value = String(pick.key ?? pick.value ?? pick.id ?? '');
                label = pick.name ?? pick.label ?? value;
            } else if (/^field_options\.years/.test(ds)) {
                // Los años del vehículo: la fuente no viaja en el esquema; un año reciente es una respuesta válida.
                value = String(new Date().getFullYear() - 2); label = value;
            } else if (f.type === 'date') {
                // Una fecha a futuro (p. ej. el vencimiento de la licencia), en el formato del input de fecha.
                value = `${new Date().getFullYear() + 3}-01-15`; label = value;
            } else if (f.type === 'currency') {
                value = /pasiv/i.test(f.label ?? '') ? (ctx.liabilities ?? 1_000_000) : (ctx.assets ?? 10_000_000);
                label = String(value);
            } else if (f.type === 'tel') { value = '3000000000'; label = value; }
            else if (f.type === 'number') { value = 0; label = '0'; }
            else { value = /direcc/i.test(f.label ?? '') ? 'CALLE 10 # 20-30' : 'PRUEBA HARNESS'; label = value; }
            out[key] = value;
            shown.set(f.id, label);
        }
    }
    return out;
}
