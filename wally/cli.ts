// bin/wally — Wally por consola: los agentes y las conversaciones, para que los arme Claude (Miguel, 2026-11-17: «que
// crear un agente no sea algo que yo haga a mano: lo hace Claude y lo agrega a los agentes de Wally»). Habla con la API
// de Wally (:5229, WALLY_API), así que lo que hace aparece solo en la interfaz.
//
//   bin/wally agents                                   los agentes (nombre, intención, temas, peso de su precarga)
//   bin/wally agent create --name Eevee --intent 'qué hace' [--notes 'lo que tiene que saber' | --notes-file n.md]
//                          [--file doc.pdf]… [--topic kyc-pipeline]…     uno nuevo: no le pregunta nada al modelo
//   bin/wally agent update <nombre> [--intent '…'] [--notes '…' | --notes-file n.md]   cambia su intención o sus notas
//   bin/wally agent delete <nombre>                    lo borra con su conversación y sus archivos
//   bin/wally topics [palabra]                         los temas de knowledge, para elegir los de un agente
//   bin/wally conversations                            las conversaciones (sin la de Wally ni las de los agentes)
//   bin/wally new [--title 'título']                   una conversación vacía
//   bin/wally delete <id>                              borra una conversación (la de Wally no se borra)
//   bin/wally ask [--conv <id> | --agent <nombre>] 'pregunta'   le pregunta (sin --conv ni --agent, a Wally)
//                 [--auto [--rounds 6]]   sin esperar a nadie: corre los comandos que pida (sólo los de la lista
//                                          blanca, que valida el servidor) y le manda los resultados, hasta que
//                                          conteste sin pedir nada o se acaben las vueltas
//   cualquiera con --json: la salida en JSON
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.WALLY_API || 'http://127.0.0.1:5229';
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const flags = (n: string) => args.flatMap((a, i) => (a === `--${n}` && args[i + 1] ? [args[i + 1]] : []));
// Las banderas sin valor (--json, --auto) no se comen la palabra que sigue.
const BOOLEAN_FLAGS = ['--json', '--auto'];
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
    if (cmd === 'agents') {
        const { agents } = await api('/api/agents');
        out(agents, agents.length ? agents.map((a: any) =>
            `${a.agent.name.padEnd(12)} ${a.agent.intent}\n${' '.repeat(13)}${[
                a.agent.topics?.length ? `temas: ${a.agent.topics.join(', ')}` : '',
                a.agent.files?.length ? `archivos: ${a.agent.files.map((f: any) => f.name).join(', ')}` : '',
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
        const c = await post('/api/agents', { name, intent, notes, fileIds: files.map((f: any) => f.id), topics: flags('topic') });
        out(c, `Listo: ${c.agent.name} · ${c.agent.intent}\n  conversación ${c.id}${files.length ? ` · ${files.length} archivo(s)` : ''}${c.agent.topics?.length ? ` · temas: ${c.agent.topics.join(', ')}` : ''}\n  Está en la pestaña «Agentes» de Wally. Abrilo: bin/cockpit open wally '#/c/${c.id}'`);
    } else if (cmd === 'agent' && sub === 'update') {
        const name = positional()[2];
        if (!name) throw new Error("falta el nombre: bin/wally agent update Mew --notes-file n.md");
        const a = await agentByName(name);
        const body: Record<string, string> = {};
        if (flag('intent')) body.intent = flag('intent')!;
        if (flag('notes-file')) body.notes = fs.readFileSync(resolve(flag('notes-file')!), 'utf8');
        else if (flag('notes') !== undefined) body.notes = flag('notes')!;
        if (!Object.keys(body).length) throw new Error('nada que cambiar: --intent, --notes o --notes-file');
        const c = await post(`/api/agents/${a.conv}`, body, 'PUT');
        out(c, `Listo: ${c.agent.name} · ${Object.keys(body).map((k) => (k === 'notes' ? 'notas' : 'intención')).join(' y ')} al día (vale desde la próxima pregunta).`);
    } else if (cmd === 'agent' && sub === 'delete') {
        const name = positional()[2];
        if (!name) throw new Error('falta el nombre: bin/wally agent delete Eevee');
        const a = await agentByName(name);
        await api(`/api/conversations/${a.conv}`, { method: 'DELETE' });
        out({ deleted: a.agent.name, conv: a.conv }, `Borrado: ${a.agent.name} (y su conversación y sus archivos).`);
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
    } else if (cmd === 'ask') {
        const text = positional().slice(1).join(' ').trim();
        if (!text) throw new Error("falta la pregunta: bin/wally ask 'qué hacemos'");
        const id = flag('conv') || (flag('agent') ? (await agentByName(flag('agent')!)).conv : (await api('/api/main')).id);
        const { default: provider } = await api('/api/providers');
        let c = await post('/api/ask', { id, provider, text });
        let m = c.messages[c.messages.length - 1];
        // --auto: el agente sigue solo. Lo que corre lo decide el servidor (la lista blanca, sólo lectura); el tope
        // de vueltas evita que pida y pida sin terminar, y cada vuelta reenvía todo el contexto al proveedor.
        const rounds: Array<{ ms: number; ran: string[]; refused: string[] }> = [{ ms: m.ms, ran: [], refused: [] }];
        if (args.includes('--auto')) {
            const max = Number(flag('rounds') || 6);
            while ((m.commands || []).some((x: any) => x.status === 'propuesto') && rounds.length <= max) {
                const ran: string[] = [], refused: string[] = [];
                for (const cmd of m.commands) {
                    if (cmd.status === 'no-permitido') { refused.push(cmd.cmd); continue; }
                    if (cmd.status !== 'propuesto') continue;
                    // Si otra ventana ya lo tomó (409 «ya está corriendo»), se espera a que termine.
                    let done: any;
                    try {
                        const r = await post(`/api/conversations/${c.id}/messages/${m.id}/commands/${cmd.id}`, { action: 'run' });
                        done = r.messages?.flatMap((x: any) => x.commands || []).find((x: any) => x.id === cmd.id);
                    } catch (e: any) {
                        if (!/ya está/.test(e.message)) throw e;
                        for (let i = 0; i < 120 && (!done || done.status === 'corriendo' || done.status === 'propuesto'); i++) {
                            await new Promise((ok) => setTimeout(ok, 2000));
                            done = (await api(`/api/conversations/${c.id}`)).messages.flatMap((x: any) => x.commands || []).find((x: any) => x.id === cmd.id);
                        }
                    }
                    (done?.status === 'corrido' ? ran : refused).push(cmd.cmd);
                }
                if (!JSON_OUT) console.error(`  ↻ vuelta ${rounds.length}: corrí ${ran.length}${refused.length ? `, no permitidos ${refused.length} (${refused.join(' · ')})` : ''}`);
                const next = ran.length
                    ? `Listo: corrí ${ran.length === 1 ? 'el comando' : `los ${ran.length} comandos`} (la salida va arriba)${refused.length ? `; ${refused.length} no están en la lista: ${refused.join(' · ')}` : ''}. Seguí.`
                    : `Ninguno de esos comandos está en la lista de sólo lectura (${refused.join(' · ')}). Seguí con lo que tenés o pedí otro.`;
                c = await post('/api/ask', { id: c.id, provider, text: next });
                m = c.messages[c.messages.length - 1];
                rounds.push({ ms: m.ms, ran, refused });
            }
        }
        const pending = (m.commands || []).filter((x: any) => x.status === 'propuesto').length;
        const total = rounds.reduce((s, r) => s + r.ms, 0);
        out({ conv: c.id, model: m.model, ms: m.ms, totalMs: total, rounds, answer: m.text, commands: m.commands || [] },
            `${m.text}\n\n  (${m.model}, ${rounds.length > 1 ? `${rounds.length} vueltas, ${(total / 1000).toFixed(1)} s en el modelo` : `${(m.ms / 1000).toFixed(1)} s`}${pending ? ` · pide ${pending} comando(s)${args.includes('--auto') ? ': se acabaron las vueltas' : ': aprobalos en Wally'}` : ''})`);
    } else {
        console.error(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 20).map((l) => l.slice(3)).join('\n'));
        process.exit(cmd ? 2 : 0);
    }
} catch (e: any) {
    console.error(`  ✗ ${e.message || e}`);
    process.exit(1);
}
