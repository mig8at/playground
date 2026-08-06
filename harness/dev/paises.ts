#!/usr/bin/env node
// paises — ¿de qué país es cada entidad? Inferencia DRY-RUN desde el cableado por sucursal.
//
//   node dev/paises.ts              informe
//   node dev/paises.ts --sql        además imprime los UPDATE propuestos (NO los ejecuta)
//
// NO ESCRIBE NADA. Es el paso 1 de la internacionalización: hoy `lenders.country_id` es
// `NOT NULL DEFAULT 1` y casi todas las filas se quedaron en ese default — o sea que la columna
// no dice de qué país es la entidad, dice "nadie la tocó". Antes de poblarla hay que saber si el
// dato se puede INFERIR y dónde va a doler.
//
// De dónde sale la inferencia: una entidad se ofrece en las sucursales donde está cableada
// (`lenders_by_allied_branches`), y la sucursal pertenece a un comercio que SÍ tiene país
// (`allieds.country_id`). Si todas las sucursales de una entidad son del mismo país, ese es su país.
//
// Las tres cosas que este informe tiene que contestar antes de tocar la BD:
//
//   1. ¿SE PUEDE INFERIR?  Una entidad cableada en sucursales de UN país → propuesta directa.
//      Cableada en VARIOS países → conflicto: no es una entidad, son dos (la economía de un lender
//      está denominada en moneda y cuelga de `lender_id` sin dimensión de país, así que el modelo
//      real es una FILA POR PAÍS). Sin cablear → no hay de dónde inferir.
//
//   2. ¿QUÉ SE ROMPE AL POBLARLA?  Tres consultas filtran por el LITERAL 1
//      (`LenderRetrievalService:458`, `OnboardingService:1782`, `Identity/LenderRepository:52`).
//      Hoy "funcionan" porque leen el default. Al poner el país real, toda entidad que salga de 1
//      DESAPARECE del listado. Ese número es el que decide si el backfill va antes o después del
//      arreglo de los filtros — y la respuesta correcta es: primero los filtros.
//
//   3. ¿EL PAÍS DE LA SUCURSAL ES CONFIABLE?  `allied_branches` no tiene columna de país: se toma
//      el del comercio. Pero la sucursal sí tiene ciudad, y la ciudad tiene país. Cuando los dos
//      no coinciden, la inferencia se apoya en un dato sucio → se listan aparte.
//
// Exit: 0 todo inferible y consistente · 1 hay conflictos o huérfanos que exigen decisión · 2 error.
import { query, close, TARGET, env } from '../pkg/db.ts';

const EMIT_SQL = process.argv.includes('--sql');

/** El default de las migraciones (`allieds`/`lenders`/`users`): id 1 = Afghanistan en `countries`. */
const DEFAULT_PAIS = 1;

type Pais = { id: number; name: string; iso: string | null };
type FilaCableado = {
    lender_id: number;
    pais_comercio: number;
    pais_ciudad: number | null;
    cableado_activo: number;
    n: number;
};
type Lender = { id: number; name: string; country_id: number; status: number; response_type: number };

type Veredicto = 'ok' | 'propuesto' | 'conflicto' | 'huerfano';

type Resultado = {
    lender: Lender;
    paises: Map<number, number>; // país → cuántas sucursales
    veredicto: Veredicto;
    propuesto: number | null;
};

async function main(): Promise<number> {
    const host = env('E2E_DB_HOST', '127.0.0.1');
    console.log(`\n  paises · target=${TARGET} · ${host}  ·  SOLO LECTURA\n`);

    const paises = new Map<number, Pais>(
        (await query<Pais>('SELECT id, name, iso_code_1 AS iso FROM countries')).map((p) => [p.id, p]),
    );
    const nombrePais = (id: number | null): string => {
        if (id === null) return 'sin ciudad';
        const p = paises.get(id);
        if (!p) return `país ${id} (no existe)`;
        return id === DEFAULT_PAIS ? `default ${id}` : `${p.iso ?? p.name} (${id})`;
    };

    const lenders = await query<Lender>(
        'SELECT id, name, country_id, status, response_type FROM lenders ORDER BY id',
    );

    // El país de la sucursal se toma del COMERCIO (la sucursal no tiene columna); la ciudad se trae
    // en paralelo solo para detectar el desacuerdo, no para inferir.
    const cableado = await query<FilaCableado>(`
        SELECT lab.lender_id,
               a.country_id  AS pais_comercio,
               cz.country_id AS pais_ciudad,
               lab.status    AS cableado_activo,
               COUNT(*)      AS n
          FROM lenders_by_allied_branches lab
          JOIN allied_branches ab ON ab.id = lab.allied_branch_id
          JOIN allieds a          ON a.id  = ab.allied_id
     LEFT JOIN country_cities cc  ON cc.id = ab.country_city_id
     LEFT JOIN country_zones cz   ON cz.id = cc.country_zone_id
      GROUP BY 1, 2, 3, 4
    `);

    // ── 1. Inferencia por entidad ────────────────────────────────────────────────────────────────
    const porLender = new Map<number, Map<number, number>>();
    for (const f of cableado) {
        const m = porLender.get(f.lender_id) ?? new Map<number, number>();
        m.set(f.pais_comercio, (m.get(f.pais_comercio) ?? 0) + Number(f.n));
        porLender.set(f.lender_id, m);
    }

    const resultados: Resultado[] = lenders.map((lender) => {
        const p = porLender.get(lender.id) ?? new Map<number, number>();
        // Un comercio en el default 1 no aporta país: no se puede inferir de algo que tampoco se sabe.
        const reales = [...p.keys()].filter((id) => id !== DEFAULT_PAIS);
        let veredicto: Veredicto;
        let propuesto: number | null = null;
        if (p.size === 0) veredicto = 'huerfano';
        else if (reales.length > 1) veredicto = 'conflicto';
        else if (reales.length === 0) veredicto = 'huerfano'; // cableado solo a comercios sin país
        else {
            propuesto = reales[0];
            veredicto = lender.country_id === propuesto ? 'ok' : 'propuesto';
        }
        return { lender, paises: p, veredicto, propuesto };
    });

    const de = (v: Veredicto) => resultados.filter((r) => r.veredicto === v);
    const ok = de('ok'), propuestos = de('propuesto'), conflictos = de('conflicto'), huerfanos = de('huerfano');

    console.log(`  ENTIDADES: ${lenders.length}   ya correctas ${ok.length} · a poblar ${propuestos.length} · en conflicto ${conflictos.length} · sin cablear ${huerfanos.length}\n`);

    if (propuestos.length) {
        console.log(`  ── A POBLAR (${propuestos.length}) — cableadas en un solo país ─────────────────`);
        for (const r of propuestos) {
            const suc = r.paises.get(r.propuesto!) ?? 0;
            console.log(
                `    ${String(r.lender.id).padStart(4)} ${r.lender.name.slice(0, 30).padEnd(30)}` +
                ` rt${r.lender.response_type} ${r.lender.status ? '  ' : 'off'}` +
                `  ${nombrePais(r.lender.country_id).padEnd(14)} → ${nombrePais(r.propuesto)}   (${suc} sucursales)`,
            );
        }
        console.log('');
    }

    if (conflictos.length) {
        console.log(`  ── ⚠ CONFLICTO (${conflictos.length}) — cableadas en VARIOS países ────────────`);
        console.log('     Una fila de lender no puede estar en dos monedas: hay que partirla en una por país.');
        for (const r of conflictos) {
            const detalle = [...r.paises.entries()]
                .map(([id, n]) => `${nombrePais(id)}×${n}`)
                .join(' · ');
            console.log(`    ${String(r.lender.id).padStart(4)} ${r.lender.name.slice(0, 30).padEnd(30)} ${detalle}`);
        }
        console.log('');
    }

    if (huerfanos.length) {
        const vivos = huerfanos.filter((r) => r.lender.status === 1);
        console.log(`  ── SIN CABLEAR (${huerfanos.length}, ${vivos.length} activas) — no hay de dónde inferir ──`);
        console.log(`     ${huerfanos.map((r) => r.lender.id).join(', ')}`);
        console.log('     Se resuelven a mano (o se apagan, si están muertas).\n');
    }

    // ── 2. El radio de explosión de los filtros literales ────────────────────────────────────────
    const saldriaDelUno = propuestos.filter((r) => r.lender.country_id === DEFAULT_PAIS && r.lender.status === 1);
    console.log('  ── ⚠ RADIO DE EXPLOSIÓN ───────────────────────────────────────────────────────');
    console.log(`     ${saldriaDelUno.length} entidades ACTIVAS saldrían del default 1 al poblar la columna.`);
    console.log('     Tres consultas filtran por el literal 1 y las dejarían FUERA DEL LISTADO, sin error:');
    console.log('       LenderRetrievalService:458 · OnboardingService:1782 · Identity/LenderRepository:52');
    console.log('     → arreglar los filtros PRIMERO, el backfill después.\n');

    // ── 3. ¿El país de la sucursal es confiable? ─────────────────────────────────────────────────
    const desacuerdo = await query<{ n: number; pais_comercio: number; pais_ciudad: number | null }>(`
        SELECT a.country_id AS pais_comercio, cz.country_id AS pais_ciudad, COUNT(*) AS n
          FROM allied_branches ab
          JOIN allieds a         ON a.id = ab.allied_id
     LEFT JOIN country_cities cc ON cc.id = ab.country_city_id
     LEFT JOIN country_zones cz  ON cz.id = cc.country_zone_id
      GROUP BY 1, 2
    `);
    const malas = desacuerdo.filter((d) => d.pais_ciudad !== null && d.pais_ciudad !== d.pais_comercio);
    const sinCiudad = desacuerdo.filter((d) => d.pais_ciudad === null).reduce((a, d) => a + Number(d.n), 0);
    console.log('  ── SUCURSALES: ¿el país del comercio coincide con el de su ciudad? ────────────');
    if (malas.length) {
        for (const d of malas) {
            console.log(`     ⚠ ${d.n} sucursal(es): comercio ${nombrePais(d.pais_comercio)} vs ciudad ${nombrePais(d.pais_ciudad)}`);
        }
    } else {
        console.log('     sin desacuerdos');
    }
    if (sinCiudad) console.log(`     ${sinCiudad} sucursal(es) sin ciudad → el país solo se sabe por el comercio`);
    console.log('');

    // ── SQL propuesto (NO se ejecuta) ────────────────────────────────────────────────────────────
    if (EMIT_SQL) {
        console.log('  ── UPDATE PROPUESTOS (revisar y correr a mano; este script NO escribe) ────────');
        console.log('  -- Ojo: correr DESPUÉS de quitar los tres filtros literales `country_id = 1`.');
        for (const r of propuestos) {
            console.log(`  UPDATE lenders SET country_id = ${r.propuesto} WHERE id = ${r.lender.id}; -- ${r.lender.name}`);
        }
        console.log('');
    } else if (propuestos.length) {
        console.log('  (corré con --sql para ver los UPDATE propuestos; igual no los ejecuta)\n');
    }

    return conflictos.length || huerfanos.some((r) => r.lender.status === 1) ? 1 : 0;
}

main()
    .then(async (code) => {
        await close();
        process.exit(code);
    })
    .catch(async (e) => {
        console.error('  error:', e instanceof Error ? e.message : e);
        await close();
        process.exit(2);
    });
