// bin/wally — Wally por consola: los agentes y las conversaciones, para que los arme Claude (Miguel, 2026-11-17: «que
// crear un agente no sea algo que yo haga a mano: lo hace Claude y lo agrega a los agentes de Wally»). Habla con la API
// de Wally (:5229, WALLY_API), así que lo que hace aparece solo en la interfaz.
//
//   bin/wally agents                                   los agentes (nombre, intención, temas, peso de su precarga)
//   bin/wally agent create --name Eevee --intent 'qué hace' [--notes 'lo que tiene que saber' | --notes-file n.md]
//                          [--file doc.pdf]… [--topic kyc-pipeline]… [--skill pruebas]…   uno nuevo: no le pregunta
//                          nada al modelo. --skill: las habilidades que trae precargadas (las de su oficio)
//   bin/wally agent update <nombre> [--intent '…'] [--notes '…' | --notes-file n.md] [--skill s]…   cambia su intención,
//                          sus notas o las habilidades que trae precargadas (--skill ninguna las saca)
//   bin/wally skills                                   las habilidades de Wally (lo que se pide con `help <nombre>`)
//   bin/wally agent delete <nombre>                    lo borra con su conversación y sus archivos
//   bin/wally topics [palabra]                         los temas de knowledge, para elegir los de un agente
//   bin/wally conversations                            las conversaciones (sin la de Wally ni las de los agentes)
//   bin/wally new [--title 'título']                   una conversación vacía
//   bin/wally delete <id>                              borra una conversación (la de Wally no se borra)
//   bin/wally ask [--conv <id> | --agent <nombre>] 'pregunta'   le pregunta (sin --conv ni --agent, a Wally)
//                 [--auto [--rounds 12]]  sin esperar a nadie: la corrida la lleva el servidor (corre los comandos
//                                          de la lista blanca y le manda los resultados) y esto la sigue; Ctrl-C
//                                          la frena; si este proceso se corta, la corrida sigue en Wally
//   bin/wally ask [--conv <id> | --agent <nombre>] --resume   retoma la corrida automática que se cortó (falló el
//                                          proveedor, se reinició Wally): vuelve a hacer la pregunta que quedó sin
//                                          contestar y sigue en Auto
//   bin/wally compact [--conv <id> | --agent <nombre>] [--keep 4]   resume lo viejo de la conversación (los últimos
//                 4 bloques quedan tal cual; el original va a .data/archive). Wally lo hace solo al pasar el tope
//   cualquiera con --json: la salida en JSON
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';

const API = process.env.WALLY_API || 'http://127.0.0.1:5229';
const args = process.argv.slice(2);

// SI WALLY ESTÁ APAGADO, SE LEVANTA SOLO (2026-11-18): una app oculta en Cockpit, o que nadie abrió todavía, no tiene
// servidor. Antes de hablarle se mira si el puerto contesta y, si no, se le pide a Cockpit que la levante (`bin/cockpit
// ensure`, sin traerla al frente). Sólo con la API de siempre: con WALLY_API puesto (una prueba) no se toca nada.
const DOWN = `Wally no contesta en ${API}: ¿está arriba? (make wally, o abrí Wally en Cockpit)`;
const portAnswers = () => new Promise<boolean>((done) => {
    const u = new URL(API);
    const s = net.connect({ host: u.hostname, port: Number(u.port || 80) });
    s.once('connect', () => { s.destroy(); done(true); });
    s.once('error', () => done(false));
    s.setTimeout(1500, () => { s.destroy(); done(false); });
});
async function ensureUp() {
    if (process.env.WALLY_API || await portAnswers()) return;
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    try {
        console.error('  Wally estaba apagado: levantándolo por Cockpit…');
        execFileSync(path.join(root, 'bin', 'cockpit'), ['ensure', 'wally'], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e: any) {
        throw new Error(`${DOWN} · no se pudo levantar solo: ${String(e.stderr || e.message || e).trim()}`);
    }
}
const JSON_OUT = args.includes('--json');
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const flags = (n: string) => args.flatMap((a, i) => (a === `--${n}` && args[i + 1] ? [args[i + 1]] : []));
// Las banderas sin valor (--json, --auto) no se comen la palabra que sigue.
const BOOLEAN_FLAGS = ['--json', '--auto', '--resume'];
const positional = () => args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !BOOLEAN_FLAGS.includes(args[i - 1])));
const resolve = (p: string) => path.resolve(process.env.INIT_CWD || process.cwd(), p);

async function api(p: string, init?: RequestInit) {
    let res: Response;
    try {
        res = await fetch(API + p, init);
    } catch {
        throw new Error(`Wally no contesta en ${API}: ¿está arriba? (make wally, o abrí Wally en Cockpit)`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
    return body;
}
const post = (p: string, data: unknown, method = 'POST') => api(p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
// Una pregunta puede tardar más de 5 minutos (el modelo piensa, o va en trozos), y `fetch` de Node corta a los 5 si no
// llegaron los encabezados («Wally no contesta», con la pregunta todavía en curso). Para preguntar, http sin ese tope.
function ask(data: unknown, path = '/api/ask'): Promise<any> {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req = http.request(API + path, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { raw += c; });
            res.on('end', () => {
                let parsed: any = {};
                try { parsed = JSON.parse(raw); } catch { /* sin cuerpo */ }
                if ((res.statusCode || 500) >= 400) reject(new Error(parsed.error || `${res.statusCode}`));
                else resolve(parsed);
            });
        });
        req.on('error', () => reject(new Error(`Wally no contesta en ${API}: ¿está arriba? (make wally, o abrí Wally en Cockpit)`)));
        req.setTimeout(0);
        req.end(body);
    });
}
const out = (obj: unknown, text: string) => console.log(JSON_OUT ? JSON.stringify(obj, null, 2) : text);

async function agentByName(name: string) {
    const { agents } = await api('/api/agents');
    const a = agents.find((x: any) => x.agent.name.toLowerCase() === name.toLowerCase());
    if (!a) throw new Error(`no hay un agente «${name}» (bin/wally agents los lista)`);
    return a;
}

async function upload(file: string) {
    const full = resolve(file);
    const body = new FormData();
    body.append('file', new Blob([fs.readFileSync(full)]), path.basename(full));
    return api('/api/files', { method: 'POST', body });
}

const [cmd, sub] = positional();
try {
    if (cmd) await ensureUp(); // sin comando sólo se muestra la ayuda
    if (cmd === 'agents') {
        const { agents } = await api('/api/agents');
        out(agents, agents.length ? agents.map((a: any) =>
            `${a.agent.name.padEnd(12)} ${a.agent.intent}\n${' '.repeat(13)}${[
                a.agent.topics?.length ? `temas: ${a.agent.topics.join(', ')}` : '',
                a.agent.files?.length ? `archivos: ${a.agent.files.map((f: any) => f.name).join(', ')}` : '',
                a.agent.skills?.length ? `habilidades: ${a.agent.skills.join(', ')}` : '',
                a.agent.notes ? 'con notas' : '',
                `~${Math.round(a.preload / 1000)} mil car. de precarga`,
                a.changed ? `${a.changed} fuentes cambiaron en main` : '',
                `conversación ${a.conv}`,
            ].filter(Boolean).join(' · ')}`).join('\n') : 'Todavía no hay agentes.');
    } else if (cmd === 'agent' && sub === 'create') {
        const name = flag('name'), intent = flag('intent');
        if (!name || !intent) throw new Error("falta --name y --intent: bin/wally agent create --name Eevee --intent 'qué hace'");
        const notes = flag('notes-file') ? fs.readFileSync(resolve(flag('notes-file')!), 'utf8') : flag('notes') || '';
        const files = [];
        for (const f of flags('file')) files.push(await upload(f));
        const c = await post('/api/agents', { name, intent, notes, fileIds: files.map((f: any) => f.id), topics: flags('topic'), skills: flags('skill') });
        out(c, `Listo: ${c.agent.name} · ${c.agent.intent}\n  conversación ${c.id}${files.length ? ` · ${files.length} archivo(s)` : ''}${c.agent.topics?.length ? ` · temas: ${c.agent.topics.join(', ')}` : ''}\n  Está en la pestaña «Agentes» de Wally. Abrilo: bin/cockpit open wally '#/c/${c.id}'`);
    } else if (cmd === 'agent' && sub === 'update') {
        const name = positional()[2];
        if (!name) throw new Error("falta el nombre: bin/wally agent update Mew --notes-file n.md");
        const a = await agentByName(name);
        const body: Record<string, string> = {};
        if (flag('intent')) body.intent = flag('intent')!;
        if (flag('notes-file')) body.notes = fs.readFileSync(resolve(flag('notes-file')!), 'utf8');
        else if (flag('notes') !== undefined) body.notes = flag('notes')!;
        if (flags('skill').length) (body as any).skills = flags('skill').filter((s) => s !== 'ninguna');
        if (!Object.keys(body).length) throw new Error('nada que cambiar: --intent, --notes, --notes-file o --skill');
        const c = await post(`/api/agents/${a.conv}`, body, 'PUT');
        out(c, `Listo: ${c.agent.name} · ${Object.keys(body).map((k) => ({ notes: 'notas', intent: 'intención', skills: 'habilidades' } as any)[k]).join(' y ')} al día (vale desde la próxima pregunta).`);
    } else if (cmd === 'agent' && sub === 'delete') {
        const name = positional()[2];
        if (!name) throw new Error('falta el nombre: bin/wally agent delete Eevee');
        const a = await agentByName(name);
        await api(`/api/conversations/${a.conv}`, { method: 'DELETE' });
        out({ deleted: a.agent.name, conv: a.conv }, `Borrado: ${a.agent.name} (y su conversación y sus archivos).`);
    } else if (cmd === 'skills') {
        const { skills } = await api('/api/skills');
        out(skills, skills.map((s: any) => `${s.name.padEnd(18)} ${s.about}`).join('\n'));
    } else if (cmd === 'topics') {
        const q = (sub || '').toLowerCase();
        const { topics } = await api('/api/topics');
        const list = topics.filter((t: any) => !q || t.id.includes(q) || t.title.toLowerCase().includes(q));
        out(list, list.map((t: any) => `${t.id.padEnd(34)} ${t.title}${t.changed ? `  (${t.changed} fuentes cambiaron)` : ''}`).join('\n') || 'Ningún tema.');
    } else if (cmd === 'conversations') {
        const { conversations } = await api('/api/conversations');
        const list = conversations.filter((c: any) => !c.agent && !c.main);
        out(list, list.map((c: any) => `${c.id}  ${c.title.slice(0, 60).padEnd(60)}  ${c.count} bloques · ${new Date(c.updated).toLocaleString('es-CO')}`).join('\n') || 'Ninguna.');
    } else if (cmd === 'new') {
        const c = await post('/api/conversations', { title: flag('title') || '' });
        out(c, `Lista: «${c.title}» (${c.id}). Abrila: bin/cockpit open wally '#/c/${c.id}'`);
    } else if (cmd === 'delete') {
        const id = sub;
        if (!id) throw new Error('falta el id: bin/wally delete <id> (bin/wally conversations los lista)');
        const main = await api('/api/main');
        if (id === main.id) throw new Error('la conversación con Wally no se borra');
        const c = await api(`/api/conversations/${id}`);
        await api(`/api/conversations/${id}`, { method: 'DELETE' });
        out({ deleted: id }, `Borrada: «${c.title}».`);
    } else if (cmd === 'compact') {
        const id = flag('conv') || (flag('agent') ? (await agentByName(flag('agent')!)).conv : (await api('/api/main')).id);
        const { default: provider } = await api('/api/providers');
        const before = await api(`/api/conversations/${id}`);
        const size = (c: any) => c.messages.reduce((n: number, m: any) => n + (m.text || '').length + (m.commands || []).reduce((k: number, x: any) => k + (x.output?.chars || 0), 0) + (m.files || []).reduce((k: number, f: any) => k + (f.chars || 0), 0), 0);
        const r = await ask({ provider, keep: Number(flag('keep') || 0) }, `/api/conversations/${id}/compact`);
        const s = r.conversation.messages[0];
        out({ conv: id, compacted: r.compacted, before: size(before), after: size(r.conversation), archive: s.archive, summary: s.text },
            `Compactada: ${r.compacted} bloques → 1 resumen. De ${size(before).toLocaleString('es-CO')} a ${size(r.conversation).toLocaleString('es-CO')} caracteres (${s.model}).\n  El original: wally/.data/archive/${s.archive}\n\n${s.text}`);
    } else if (cmd === 'ask') {
        const text = positional().slice(1).join(' ').trim();
        const resume = args.includes('--resume');
        if (!text && !resume) throw new Error("falta la pregunta: bin/wally ask 'qué hacemos'");
        const id = flag('conv') || (flag('agent') ? (await agentByName(flag('agent')!)).conv : (await api('/api/main')).id);
        const { default: provider } = await api('/api/providers');
        if (!args.includes('--auto') && !resume) {
            const c = await ask({ id, provider, text });
            const m = c.messages[c.messages.length - 1];
            const pending = (m.commands || []).filter((x: any) => x.status === 'proposed').length;
            out({ conv: c.id, model: m.model, ms: m.ms, answer: m.text, commands: m.commands || [] },
                `${m.text}\n\n  (${m.model}, ${(m.ms / 1000).toFixed(1)} s${pending ? ` · pide ${pending} comando(s): aprobalos en Wally` : ''})`);
        } else {
            // --auto: la corrida la lleva el SERVIDOR (autorun.go): esto la arranca y la sigue. Si este proceso se corta,
            // la corrida sigue igual (se ve en Wally); Ctrl-C la frena.
            const started = Date.now();
            // Al retomar, el proveedor es el de la corrida que se cortó (lo guarda el servidor).
            await post(`/api/conversations/${id}/auto`, resume ? { resume: true, rounds: Number(flag('rounds') || 0) } : { text, provider, rounds: Number(flag('rounds') || 0) });
            let stopping = false;
            process.on('SIGINT', () => {
                if (stopping) process.exit(130);
                stopping = true;
                if (!JSON_OUT) console.error('  ⏹ frenando la corrida…');
                post(`/api/conversations/${id}/auto/stop`, {}).catch(() => {});
            });
            let lastDoing = '';
            let st: any = null;
            for (;;) {
                await new Promise((ok) => setTimeout(ok, 1500));
                st = await api(`/api/conversations/${id}/auto`).catch(() => st);
                if (st && st.doing !== lastDoing && !JSON_OUT && st.doing !== 'terminó') console.error(`  ↻ ${st.doing}`);
                lastDoing = st?.doing || lastDoing;
                if (st && st.ended && !st.ended.startsWith('0001')) break;
            }
            const c = await api(`/api/conversations/${id}`);
            const m = [...c.messages].reverse().find((x: any) => x.role === 'model') || {};
            if (st.stopped && !JSON_OUT) console.error(`  ⚠ terminó sin quedar bien: ${st.stopped}`);
            const secs = ((Date.now() - started) / 1000).toFixed(1);
            out({ conv: id, model: m.model, rounds: st.round, seconds: Number(secs), stopped: st.stopped || '', byUser: !!st.byUser, answer: m.text, commands: m.commands || [] },
                `${m.text || ''}\n\n  (${m.model || ''}, ${st.round} vuelta(s), ${secs} s${st.byUser ? ' · la frenaste' : ''})`);
            if (st.stopped) process.exitCode = 1;
        }
    } else {
        console.error(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 25).map((l) => l.slice(3)).join('\n'));
        process.exit(cmd ? 2 : 0);
    }
} catch (e: any) {
    console.error(`  ✗ ${e.message || e}`);
    process.exit(1);
}
