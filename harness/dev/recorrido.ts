// recorrido.ts — ¿en qué RECORRIDO cae cada entidad de un comercio, o una entidad suelta, en ESTE ambiente?
//
//   node dev/recorrido.ts --merchant sonria          las entidades de la sucursal, agrupadas por riel
//   node dev/recorrido.ts --lender 149,172           entidades sueltas, sin sucursal
//   [--channel advisor|self-service|store|bancolombia] [--json]
//
// Sólo lee. Los nombres salen de `recorridos.json` y el porqué de knowledge/origination-paths. Una variación
// marcada con `?` es POR CLIENTE: la entidad la tiene configurada, pero sólo aparece si la categoría que le toca al
// cliente la pide. El canal no se mide: sale de `channels` del comercio en `harness.json`, si lo declara.
//
// Los imports de la base van DINÁMICOS: `pkg/db.ts` resuelve el ambiente al cargarse (F-187).
export {};
const { readCatalog, measureLenders, measureFields, classify } = await import('../pkg/recorridos.ts');
const { readFlows, baseOf } = await import('../pkg/flows.ts');
const { resolveMerchant } = await import('../pkg/merchants.ts');
const { close } = await import('../pkg/db.ts');

const arg = (n: string, d = ''): string => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const target = process.env.E2E_TARGET || 'dev';
const cat = readCatalog();
const channelArg = arg('channel');
if (channelArg && !cat.channels[channelArg]) {
    console.error(`canal «${channelArg}» fuera del catálogo: ${Object.keys(cat.channels).join(', ')}`);
    process.exit(2);
}

async function main(): Promise<number> {
    const merchantArg = arg('merchant');
    const lenderArg = arg('lender');
    if (!merchantArg && !lenderArg) {
        console.error('falta --merchant <clave de harness.json, hash, slug o nombre> o --lender <id[,id…]>');
        return 2;
    }

    let header = '';
    let channels: string[] = channelArg ? [channelArg] : [];
    let facts;
    let fields: Awaited<ReturnType<typeof measureFields>> = [];
    if (merchantArg) {
        // Primero el registro del harness (la sucursal de ESTE ambiente); si no está, la base.
        const entry = readFlows().merchants?.[merchantArg];
        const branch = entry?.bases?.[baseOf(target)]?.branch?.replace(/^#/, '');
        const hash = branch || (await resolveMerchant(merchantArg)).hash;
        const name = entry?.name || (branch ? merchantArg : (await resolveMerchant(merchantArg)).name);
        if (!channelArg && entry?.channels?.length) channels = entry.channels;
        facts = await measureLenders({ branchHash: hash });
        fields = await measureFields(hash, cat);
        header = `${name} · sucursal ${hash} · ${target} — ${facts.length} entidad(es)`;
    } else {
        facts = await measureLenders({ lenderIds: lenderArg.split(',').map((s) => Number(s.trim())) });
        header = `${facts.length} entidad(es) · ${target}`;
    }

    const paths = facts.map((f) => classify(f, cat, channelArg || undefined));
    if (process.argv.includes('--json')) {
        console.log(JSON.stringify({ target, channels, fields, paths }, null, 2));
        return 0;
    }

    console.log(header);
    const channelNames = channels.map((c) => cat.channels[c]?.name ?? `«${c}» (fuera del catálogo)`);
    console.log(channelNames.length
        ? `canal: ${channelNames.join(', ')}`
        : 'canal: no declarado en harness.json (cada línea vale para los canales del asistente; --channel lo fija)');
    if (fields.length) {
        console.log('formulario:');
        for (const fr of fields) {
            const mark = fr.asked == null ? '?' : fr.asked ? '✔' : '–';
            console.log(`  ${mark} ${fr.name.padEnd(28)} ${fr.why}`);
        }
    }
    if (!paths.length) {
        console.log('\n  sin entidades: la sucursal no tiene ninguna en lenders_by_allied_branches, o los ids no existen en esta base');
        return 1;
    }

    const byRail = new Map<string, typeof paths>();
    for (const p of paths) byRail.set(p.rail, [...(byRail.get(p.rail) ?? []), p]);
    for (const [rail, group] of [...byRail.entries()].sort()) {
        const r = cat.rails[rail];
        const axes = r ? ` (política ${cat.railAxes.policyOwner.values[r.policyOwner]} · se origina ${r.origination.replace('-', ' ')})` : '';
        console.log(`\nriel ${rail} · ${group[0].railName}${axes}`);
        for (const p of group) {
            const off = p.lender.lenderStatus !== 1 ? ' [apagada]' : '';
            console.log(`  #${p.lender.id} ${p.lender.name}${off}`);
            console.log(`      ${p.line}`);
            for (const n of p.notes) console.log(`      · ${n}`);
            for (const w of p.warnings) console.log(`      ⚠ ${w}`);
        }
    }
    console.log('\n`?` = variación por cliente: aparece sólo si la categoría que le toca al cliente la pide.');
    return 0;
}

const code = await main().catch((e) => { console.error(`✗ ${e?.message ?? e}`); return 2; });
await close().catch(() => {});
process.exit(code);
