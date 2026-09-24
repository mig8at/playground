// client-code — genera el código de preaprobado de la app para la sucursal que se va a probar.
//
//   E2E_TARGET=<local|dev|qa|staging> node bin/client-code.ts <hash de sucursal> [lender_id] [código]
//
// El código explícito sólo vale en local (se siembra en el mock); fuera de local lo decide el servicio.
//
// Lo llama `bin/advisor` al lanzar. Imprime UNA línea JSON en stdout, que el launcher lee:
//   {"code":"EY5673","lender":"CrediPullman","lenderId":77,"userId":1828532,…}   o   {"skip":"<motivo>"}
// Y sale siempre 0: sin código la corrida sigue igual, sólo que el autorrelleno no tiene qué poner en
// la pantalla del código. Un paso opcional que tumba el lanzamiento es peor que no tenerlo.
//
// La lógica —qué comercio, qué entidad, qué cliente, dónde se genera— vive en `pkg/client-code.ts`.
process.env.E2E_TARGET ||= 'dev';
const target = process.env.E2E_TARGET;
const [hash, lenderArg, codeArg] = process.argv.slice(2);

const { generateClientCode, ClientCodeSkip } = await import('../pkg/client-code.ts');
const { close } = await import('../pkg/db.ts');

let out: Record<string, unknown>;
try {
    if (!hash) throw new ClientCodeSkip('falta el hash de la sucursal');
    out = { ...(await generateClientCode({ target, hash, lenderId: lenderArg ? Number(lenderArg) : undefined, code: codeArg || undefined })) };
} catch (e: any) {
    out = { skip: e instanceof ClientCodeSkip ? e.message : `error inesperado: ${e?.message || e}` };
} finally {
    await close().catch(() => {});
}
process.stdout.write(JSON.stringify(out) + '\n');
process.exit(0);
