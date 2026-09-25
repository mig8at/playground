// EL SUPERVISOR DE LOS MOCKS LOCALES. El servidor del panel es su dueño: los levanta al arrancar, los
// reinicia si se caen o si cambia su código, guarda sus logs y los expone por `/api/mocks`.
//
// Por qué existe. Hasta el 2026-09-25 cada mock se levantaba por un camino distinto —`bin/advisor` seis o
// siete y sólo en local, otros por su `make`, los cuatro de Credifamilia por nadie— y nadie los vigilaba.
// Ese día el de centrales estaba abajo y la categoría de una corrida la decidió el backend sin avisar; y un
// mock editado sigue sirviendo el código viejo hasta que alguien lo reinicia a mano (F-87).
//
// Tres reglas, y las tres cuidan que el supervisor no pelee con lo que ya existe:
//  1. ADOPTA, no duplica. Si el puerto ya responde (lo levantó `bin/advisor`, un `make` o una terminal), se
//     marca «externo» y no se toca. Al apagarse el panel, sólo mueren los procesos que levantó él.
//  2. Cada mock sigue siendo un proceso aparte, el MISMO `server.mjs` que corre su launcher: si uno se cae no
//     tira el panel, y `bin/mock-<x> start|stop|logs` sigue andando igual. El log va al mismo
//     `/tmp/mock-<x>.log` que usa el launcher.
//  3. Si al morir un hijo el puerto queda tomado por otro proceso, no se lo reinicia: pasó a ser externo.
//     Es el caso de `bin/advisor`, que mata y relanza el de pre-aprobaciones cuando cambia la demora.
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { watch, appendFileSync, writeFileSync, readFileSync, type FSWatcher } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

export type MockDef = {
    id: string;          // el sufijo de `bin/mock-<id>` y de `/tmp/mock-<id>.log`
    label: string;       // el nombre que usa el estado de servicios del panel
    port: number;
    portEnv: string;     // la variable con que el mock lee su puerto
    needs: string;       // a quién le hace falta (misma vara que el estado de servicios del panel)
};

// La lista de mocks locales. Los puertos y las variables son los de cada `bin/mock-*` y `server.mjs`.
export const MOCKS: MockDef[] = [
    { id: 'preapprovals', label: 'pre-aprobaciones', port: 8095, portEnv: 'MOCK_PA_PORT', needs: 'todos' },
    { id: 'redirect', label: 'redirect', port: 8096, portEnv: 'MOCK_REDIRECT_PORT', needs: 'ecommerce' },
    { id: 'payvalida', label: 'payvalida', port: 8097, portEnv: 'MOCK_PV_PORT', needs: 'todos' },
    { id: 'mdm', label: 'mdm/IMEI', port: 8098, portEnv: 'MOCK_MDM_PORT', needs: 'smartpay' },
    { id: 'lenders', label: 'entidades', port: 8099, portEnv: 'MOCK_LENDERS_PORT', needs: 'rt1' },
    { id: 'pdf-mapper', label: 'pdf-mapper', port: 8100, portEnv: 'MOCK_PDFMAP_PORT', needs: 'rt4' },
    { id: 'forms', label: 'forms', port: 8101, portEnv: 'MOCK_FORMS_PORT', needs: 'todos' },
    { id: 'abaco', label: 'ábaco', port: 8102, portEnv: 'MOCK_ABACO_PORT', needs: 'motai' },
    { id: 'corbeta', label: 'corbeta/fondos', port: 8103, portEnv: 'MOCK_CORBETA_PORT', needs: 'qr' },
    { id: 'bancolombia', label: 'bancolombia', port: 8104, portEnv: 'MOCK_BC_PORT', needs: 'qr' },
    { id: 'bureaus', label: 'centrales', port: 8105, portEnv: 'MOCK_BUREAUS_PORT', needs: 'todos' },
    { id: 'deceval', label: 'deceval/pagaré', port: 8106, portEnv: 'MOCK_DECEVAL_PORT', needs: 'rt4' },
    { id: 'netco', label: 'netco/firma', port: 8107, portEnv: 'MOCK_NETCO_PORT', needs: 'rt4' },
    { id: 'credifamilia', label: 'credifamilia/radicación', port: 8108, portEnv: 'MOCK_CREDIFAMILIA_PORT', needs: 'rt4' },
    { id: 'forms-g2', label: 'forms-g2', port: 8109, portEnv: 'MOCK_FORMS_G2_PORT', needs: 'bcp' },
    { id: 'cuotealo', label: 'cuotealo/simulador', port: 8110, portEnv: 'MOCK_CUOTEALO_PORT', needs: 'bcp' },
    { id: 'codes', label: 'códigos', port: 8111, portEnv: 'MOCK_CODES_PORT', needs: 'código de la app' },
    { id: 'wompi', label: 'wompi/cuota inicial', port: 8112, portEnv: 'MOCK_WOMPI_PORT', needs: 'cuota inicial' },
    { id: 'financial-health', label: 'fin-health', port: Number(process.env.MOCK_FINHEALTH_PORT) || 4000, portEnv: 'MOCK_FINHEALTH_PORT', needs: 'todos' },
];

export type MockState = 'up' | 'starting' | 'down' | 'stopped' | 'failing';
type Runtime = {
    state: MockState;
    owner: 'panel' | 'external' | null;
    child: ChildProcess | null;
    pid: number | null;
    startedAt: number | null;
    restarts: number[];          // cuándo se reinició solo, para cortar un bucle de caídas
    stopping: boolean;           // lo apagó alguien a propósito: no se reinicia
    codeChangedAt: number | null;
    staleCode: boolean;          // cambió su código y el que corre es el viejo (sólo si no es nuestro)
    lastExit: string | null;
    log: string[];
};

const LOG_LINES = 300;
const entryOf = (root: string, id: string) => join(root, `mock-${id}`, id === 'financial-health' ? 'server.ts' : 'server.mjs');
const logFileOf = (id: string) => `/tmp/mock-${id}.log`;

/** ¿Algo escucha en el puerto? Por TCP y no por HTTP: no todos los mocks contestan `GET /`. */
function listening(port: number): Promise<boolean> {
    return new Promise((ok) => {
        const s = connect({ host: '127.0.0.1', port });
        const done = (v: boolean) => { s.destroy(); ok(v); };
        s.setTimeout(400, () => done(false));
        s.once('connect', () => done(true));
        s.once('error', () => done(false));
    });
}

/** El proceso que escucha en un puerto, por `lsof` (sólo para apagar a pedido uno externo). */
function pidOnPort(port: number): Promise<number | null> {
    return new Promise((ok) => execFile('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], (err, out) => {
        const pid = Number(String(out).trim().split('\n')[0]);
        ok(err || !pid ? null : pid);
    }));
}

export class MockSupervisor {
    private readonly rt = new Map<string, Runtime>();
    private readonly watchers: FSWatcher[] = [];

    private readonly root: string;

    constructor(root: string) {
        this.root = root;
        for (const m of MOCKS) this.rt.set(m.id, {
            state: 'down', owner: null, child: null, pid: null, startedAt: null, restarts: [], stopping: false,
            codeChangedAt: null, staleCode: false, lastExit: null, log: [],
        });
    }

    private push(id: string, line: string): void {
        const r = this.rt.get(id)!;
        r.log.push(line);
        if (r.log.length > LOG_LINES) r.log.splice(0, r.log.length - LOG_LINES);
        try { appendFileSync(logFileOf(id), line + '\n'); } catch { /* el log en archivo es de conveniencia */ }
    }

    /** Levanta el mock si su puerto está libre; si ya responde, lo adopta como externo. */
    async start(id: string): Promise<void> {
        const m = MOCKS.find((x) => x.id === id);
        const r = this.rt.get(id);
        if (!m || !r) throw new Error(`no conozco el mock «${id}»`);
        if (r.child) return;
        r.stopping = false;
        if (await listening(m.port)) {
            r.state = 'up'; r.owner = 'external'; r.pid = await pidOnPort(m.port);
            return;
        }
        r.state = 'starting'; r.owner = 'panel'; r.staleCode = false;
        try { writeFileSync(logFileOf(id), ''); } catch { /* idem */ }
        const child = spawn(process.execPath, [entryOf(this.root, id)], {
            cwd: this.root, env: { ...process.env, [m.portEnv]: String(m.port) }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        r.child = child; r.pid = child.pid ?? null; r.startedAt = Date.now();
        const feed = (b: Buffer) => { for (const l of b.toString().split('\n')) if (l.trim()) this.push(id, l); };
        child.stdout?.on('data', feed);
        child.stderr?.on('data', feed);
        child.on('exit', (code, signal) => { void this.onExit(id, code, signal); });
        // Arriba cuando el puerto responde; si en 8 s no respondió, queda como caído con su log a la vista.
        for (let i = 0; i < 40 && r.child === child; i++) {
            if (await listening(m.port)) { r.state = 'up'; return; }
            await new Promise((w) => setTimeout(w, 200));
        }
        if (r.child === child && r.state === 'starting') r.state = 'failing';
    }

    private async onExit(id: string, code: number | null, signal: NodeJS.Signals | null): Promise<void> {
        const m = MOCKS.find((x) => x.id === id)!;
        const r = this.rt.get(id)!;
        r.child = null; r.pid = null;
        r.lastExit = signal ? `señal ${signal}` : `código ${code}`;
        this.push(id, `── el proceso terminó (${r.lastExit})`);
        if (r.stopping) { r.state = 'stopped'; r.owner = null; return; }
        // Otro tomó el puerto (bin/advisor relanzando el de pre-aprobaciones): es externo, no se pelea.
        if (await listening(m.port)) { r.state = 'up'; r.owner = 'external'; r.pid = await pidOnPort(m.port); return; }
        // Se cayó solo: se reinicia, salvo que ya se haya caído tres veces en un minuto.
        const now = Date.now();
        r.restarts = r.restarts.filter((t) => now - t < 60_000);
        if (r.restarts.length >= 3) { r.state = 'failing'; r.owner = null; this.push(id, '── tres caídas en un minuto: no se reinicia solo'); return; }
        r.restarts.push(now);
        r.owner = null;
        await new Promise((w) => setTimeout(w, 500));
        await this.start(id);
    }

    /** Lo apaga a pedido. Uno externo se apaga por su puerto: es una acción explícita desde el panel. */
    async stop(id: string): Promise<void> {
        const m = MOCKS.find((x) => x.id === id);
        const r = this.rt.get(id);
        if (!m || !r) throw new Error(`no conozco el mock «${id}»`);
        r.stopping = true;
        if (r.child) {
            const child = r.child;
            child.kill('SIGTERM');
            await new Promise<void>((ok) => { const t = setTimeout(() => { child.kill('SIGKILL'); ok(); }, 2000); child.once('exit', () => { clearTimeout(t); ok(); }); });
        } else {
            const pid = await pidOnPort(m.port);
            if (pid) { try { process.kill(pid, 'SIGTERM'); } catch { /* ya no estaba */ } }
            for (let i = 0; i < 15 && (await listening(m.port)); i++) await new Promise((w) => setTimeout(w, 200));
        }
        r.state = 'stopped'; r.owner = null; r.pid = null; r.staleCode = false;
    }

    async restart(id: string): Promise<void> {
        await this.stop(id);
        this.rt.get(id)!.restarts = [];
        await this.start(id);
    }

    /** Arranca todos los que no estén arriba, y vigila el código de cada uno. */
    async startAll(): Promise<void> {
        for (const m of MOCKS) {
            await this.start(m.id).catch((e) => this.push(m.id, `── no arrancó: ${e instanceof Error ? e.message : String(e)}`));
            this.watchCode(m.id);
        }
    }

    /* Si cambia el código de un mock que es NUESTRO, se reinicia solo (F-87: el proceso viejo seguía
     * sirviendo la versión anterior y nada lo avisaba). Si es externo, no se toca: se marca que el código
     * que corre es viejo, y el panel lo dice. */
    private watchCode(id: string): void {
        let timer: NodeJS.Timeout | null = null;
        try {
            this.watchers.push(watch(join(this.root, `mock-${id}`), { recursive: true }, (_event, filename) => {
                // Sólo el CÓDIGO: hay mocks que escriben en su carpeta (capturas, estado), y mirar todo
                // los dejaría reiniciándose por lo que ellos mismos escriben.
                if (!filename || !/\.(mjs|ts|js)$/.test(String(filename))) return;
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    const r = this.rt.get(id)!;
                    r.codeChangedAt = Date.now();
                    if (r.owner === 'panel' && r.child) { this.push(id, '── cambió el código: reinicio'); void this.restart(id); }
                    else if (r.owner === 'external') r.staleCode = true;
                }, 400);
            }));
        } catch { /* sin vigilancia de código: el mock igual corre */ }
    }

    /** Lo que ve el panel. Se re-sondea el puerto de cada uno: un externo pudo caerse sin avisar. */
    async list(): Promise<any[]> {
        return Promise.all(MOCKS.map(async (m) => {
            const r = this.rt.get(m.id)!;
            if (!r.child && r.state !== 'stopped' && r.state !== 'failing') {
                const up = await listening(m.port);
                if (up && r.owner !== 'external') { r.state = 'up'; r.owner = 'external'; r.pid = await pidOnPort(m.port); }
                if (!up && r.state === 'up') { r.state = 'down'; r.owner = null; r.pid = null; }
            }
            return {
                id: m.id, label: m.label, port: m.port, needs: m.needs, state: r.state, owner: r.owner, pid: r.pid,
                startedAt: r.startedAt, restarts: r.restarts.length, staleCode: r.staleCode, lastExit: r.lastExit,
                lastLine: r.log[r.log.length - 1] ?? '',
            };
        }));
    }

    /** Las últimas líneas. Uno externo no pasa por acá: se lee el archivo que escribe su launcher. */
    log(id: string, n = 200): string[] {
        const r = this.rt.get(id);
        if (!r) return [];
        if (r.owner === 'external') {
            try { return readFileSync(logFileOf(id), 'utf8').split('\n').filter(Boolean).slice(-n); }
            catch { return ['(lo levantó otro proceso y no dejó log en ' + logFileOf(id) + ')']; }
        }
        return r.log.slice(-n);
    }

    /** Al apagarse el panel: sólo los que levantó él. Los externos siguen. */
    shutdown(): void {
        for (const w of this.watchers) w.close();
        for (const r of this.rt.values()) { r.stopping = true; r.child?.kill('SIGTERM'); }
    }
}
