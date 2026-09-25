// Los flags de los scripts del harness en inglés, y los nombres viejos (en español) que siguen andando.
//
// POR QUÉ LOS VIEJOS NO SE BORRAN: las tareas del tablero guardan el comando EXACTO de cada medición —es
// lo que permite volver a correrla y desmentirla—, y esos comandos dicen `--casos`, `--cerrar`… Si el
// nombre viejo dejara de existir, cada medición vieja quedaría sin forma de repetirse, y nada lo avisaría.
// Así que se traduce y se avisa, una vez por flag.
//
// CÓMO SE USA: es lo PRIMERO que importa cada script que lee flags (`import '../pkg/cli-aliases.ts'`).
// Los imports se evalúan en orden y antes del cuerpo del módulo, así que cuando el script lee
// `process.argv` ya dice el nombre nuevo. No importa nada: tiene que poder ir primero sin arrastrar
// `env.ts`, que resuelve el TARGET al cargarse (F-187).

/** Nombre viejo → nombre nuevo. Sin los dos guiones. */
export const OLD_FLAGS: Readonly<Record<string, string>> = {
    casos: 'cases',
    cerrar: 'close',
    comercio: 'merchant',
    paralelo: 'parallel',
    preaprobados: 'preapprovals',
    'cuota-inicial': 'down-payment',
    cuotas: 'installments',
    pago: 'payment',
    motor: 'engine',
    ocupacion: 'occupation',
    tope: 'timeout',
    'sin-warm': 'no-warm',
    monto: 'amount',
    producto: 'product',
    escenario: 'scenario',
    documento: 'document',
    facturar: 'invoice',
    inicial: 'down-payment',
    bono: 'bonus',
    niega: 'deny',
    grupo: 'group',
    desde: 'since',
    pantallas: 'screens',
    dias: 'days',
    filtro: 'filter',
    'sin-endpoints': 'no-endpoints',
    'con-hallazgos': 'with-findings',
};

/** Valores viejos de un flag → el valor nuevo. `--engine navegador` sigue siendo `--engine browser`. */
const OLD_VALUES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    engine: { navegador: 'browser' },
    gate: { aprobado: 'approved', rechazado: 'rejected' },
};

/** El nombre nuevo de un flag, se lo den viejo o nuevo. Lo usan también las suites (`requiere`). */
export function canonicalFlag(name: string): string {
    return OLD_FLAGS[name] ?? name;
}

/** Reescribe `argv` al vocabulario nuevo y avisa por stderr qué nombres viejos se usaron. */
export function normalizeArgv(argv: string[], warn: (s: string) => void = (s) => process.stderr.write(s)): string[] {
    const out: string[] = [];
    const used = new Set<string>();
    let prevFlag: string | null = null;
    for (const a of argv) {
        const m = /^--([a-z][a-z0-9-]*)(=(.*))?$/.exec(a);
        if (m) {
            const name = canonicalFlag(m[1]);
            if (name !== m[1]) used.add(`--${m[1]} → --${name}`);
            const inline = m[3] !== undefined ? `=${OLD_VALUES[name]?.[m[3]] ?? m[3]}` : '';
            out.push(`--${name}${inline}`);
            prevFlag = m[3] === undefined ? name : null;
            continue;
        }
        // El valor que sigue a un flag: se traduce sólo si ese flag tiene valores viejos conocidos.
        const value = prevFlag ? OLD_VALUES[prevFlag]?.[a] : undefined;
        if (value) used.add(`--${prevFlag} ${a} → ${value}`);
        out.push(value ?? a);
        prevFlag = null;
    }
    if (used.size) warn(`  ⚠ nombres viejos (siguen andando): ${[...used].join(' · ')}\n`);
    return out;
}

process.argv = normalizeArgv(process.argv);
