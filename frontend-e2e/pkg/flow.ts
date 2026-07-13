/**
 * pkg/flow — runner de "flujos de pasos" autodocumentados para el frontend-e2e.
 *
 * Es el espejo en TypeScript de backend-e2e/pkg/flow/flow.go: la consola muestra
 * el paso a paso igual que el backend. Cada flujo es una secuencia de pasos
 * {título, descripción, acción}; el runner:
 *   - numera los pasos automáticamente ([i/N], sin totales hardcodeados),
 *   - imprime QUÉ hace cada paso (la descripción, `↳`) antes de ejecutarlo,
 *   - ejecuta la acción y muestra el resultado (✓ detalle / ✗ error),
 *   - se detiene en el primer paso que falle (run) o los corre todos (runAll), y
 *   - imprime un resumen final (N/N pasos · tiempo).
 *
 * Cada paso se envuelve en `test.step(...)`, así que ADEMÁS aparece agrupado en
 * el HTML report y el trace de Playwright (algo que el backend no tiene).
 *
 * Salida limpia y paralelismo: el `playwright.config.ts` corre con
 * `fullyParallel: true`, así que si varios flujos imprimen a la vez sus líneas se
 * entremezclan. Para la narración paso-a-paso legible (igual que el CLI serial del
 * backend) usá `npm run e2e:steps`, que fuerza `--workers=1`.
 *
 * Los datos que un paso necesita de otro (p.ej. el loanRequestId que produce el
 * submit) viajan por el `Ctx`. Las dependencias estáticas (page, hashes) las
 * captura cada closure de paso.
 */
import { test } from '@playwright/test';

// Colores ANSI — mismos códigos que backend-e2e/pkg/client/client.go.
// Se desactivan fuera de TTY o con FORCE_COLOR=0 para no ensuciar logs de CI.
const useColor = process.env.FORCE_COLOR !== '0' && (!!process.stdout.isTTY || !!process.env.FORCE_COLOR);
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const blue = (s: string) => c('34', s);
const green = (s: string) => c('32', s);
const red = (s: string) => c('31', s);
const cyan = (s: string) => c('36', s);
const gray = (s: string) => c('90', s);

/** Ctx transporta valores entre pasos del mismo flujo (espejo de flow.Ctx). */
export class Ctx {
    private vals = new Map<string, unknown>();
    set(k: string, v: unknown): void {
        this.vals.set(k, v);
    }
    get(k: string): unknown {
        return this.vals.get(k);
    }
    str(k: string): string {
        const v = this.vals.get(k);
        return typeof v === 'string' ? v : '';
    }
    int(k: string): number {
        const v = this.vals.get(k);
        return typeof v === 'number' ? v : Number(v) || 0;
    }
}

/**
 * Acción de un paso. Devuelve un detalle corto del resultado (se imprime junto
 * al ✓); `void`/`undefined` => no imprime detalle. Lanza para fallar el paso.
 */
export type StepRun = (ctx: Ctx) => Promise<string | void> | string | void;

interface Step {
    title: string;
    desc: string;
    run: StepRun;
}

const banner = (t: string): void => {
    const bar = '='.repeat(70);
    console.log(cyan(`${bar}\n ${t} \n${bar}`));
};
const printStep = (i: number, total: number, title: string): void =>
    console.log(blue(`\n[${i}/${total}] ${title}`));
const printRule = (rule: string): void => console.log(`  ↳ ${gray(rule)}`);
const printOK = (msg: string): void => console.log(green(`  ✓ ${msg}`));
const printFail = (msg: string): void => console.log(red(`  ✗ ${msg}`));
const secs = (startMs: number): string => `${((Date.now() - startMs) / 1000).toFixed(1)}s`;

/** Flow es una secuencia de pasos autodocumentada (espejo de flow.Flow). */
export class Flow {
    private steps: Step[] = [];
    constructor(
        private name: string,
        private summary = '',
    ) {}

    /** Agrega un paso (encadenable). */
    step(title: string, desc: string, run: StepRun): this {
        this.steps.push({ title, desc, run });
        return this;
    }

    /** Cantidad de pasos. */
    get length(): number {
        return this.steps.length;
    }

    private header(): void {
        banner(this.name);
        if (this.summary) console.log(`  ${gray(this.summary)}`);
    }

    /** Imprime el paso a paso DOCUMENTADO sin ejecutar ninguna acción (espejo de Explain). */
    explain(): void {
        this.header();
        this.steps.forEach((s, i) => {
            printStep(i + 1, this.steps.length, s.title);
            if (s.desc) printRule(s.desc);
        });
        console.log(gray('\n(explain: documentación del flujo; no se ejecutó nada)'));
    }

    /** Ejecuta el flujo; se detiene y lanza en el primer paso que falle. */
    async run(ctx: Ctx = new Ctx()): Promise<void> {
        this.header();
        const start = Date.now();
        for (let i = 0; i < this.steps.length; i++) {
            const s = this.steps[i];
            printStep(i + 1, this.steps.length, s.title);
            if (s.desc) printRule(s.desc);
            try {
                const detail = await test.step(s.title, () => s.run(ctx));
                if (detail) printOK(detail);
            } catch (err) {
                printFail(`${s.title}: ${(err as Error).message}`);
                console.log(
                    red(`\n🔴 FLUJO DETENIDO en el paso ${i + 1}/${this.steps.length} (${s.title}) · ${secs(start)}`),
                );
                throw err;
            }
        }
        console.log(green(`\n🟢 FLUJO OK · ${this.steps.length}/${this.steps.length} pasos · ${secs(start)}`));
    }

    /**
     * Ejecuta TODOS los pasos SIN detenerse en el primer fallo (para baterías de
     * aserciones independientes, p.ej. rutas negativas). Imprime ✓/✗ por paso y un
     * resumen N/M; lanza al final si alguno falló (espejo de RunAll).
     */
    async runAll(ctx: Ctx = new Ctx()): Promise<void> {
        this.header();
        const start = Date.now();
        let failed = 0;
        for (let i = 0; i < this.steps.length; i++) {
            const s = this.steps[i];
            printStep(i + 1, this.steps.length, s.title);
            if (s.desc) printRule(s.desc);
            try {
                const detail = await test.step(s.title, () => s.run(ctx));
                if (detail) printOK(detail);
            } catch (err) {
                failed++;
                printFail(`${s.title}: ${(err as Error).message}`);
            }
        }
        const ok = this.steps.length - failed;
        if (failed > 0) {
            console.log(red(`\n🔴 ${ok}/${this.steps.length} pasos OK · ${failed} fallaron · ${secs(start)}`));
            throw new Error(`${failed}/${this.steps.length} pasos fallaron`);
        }
        console.log(green(`\n🟢 FLUJO OK · ${ok}/${this.steps.length} pasos · ${secs(start)}`));
    }
}
