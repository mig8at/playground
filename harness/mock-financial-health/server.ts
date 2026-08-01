// mock-financial-health — el MS de "salud financiera" que consume la pantalla del ASESOR
// (`financial-profile`, la revisión/decisión de Motai renting) vía `FINANCIAL_HEALTH_API_URL`.
//
// POR QUÉ EXISTE: el wizard (loader SSR de financial-profile.tsx) hace
//   POST {FINANCIAL_HEALTH_API_URL}/v1/financial-profile/me   { userRequestId }
// y en local no corre ningún financial-health → `TypeError: fetch failed` y la pantalla del asesor
// muere. El .env del wizard ya apunta a http://localhost:4000 — este mock ocupa ese puerto.
//
// NO INVENTA DATOS: responde con lo que el usuario sintético tiene DE VERDAD en la BD local —
//   · users: full_name / document_type / document_number / age
//   · user_field_values: 87 = ingreso mensual · 29 = ocupación
//   · user_summaries.datacredito: score + currentNegativeCredits (lo que sembró synthFill)
//   · user_summaries.abaco: average_income → monthlyInformalIncomeAmount (el resultado REAL del
//     flujo gig de Ábaco, si corrió) — así el asesor ve en pantalla lo que Ábaco midió.
// Si la BD local no responde, contesta 503 con el motivo (error honesto, no default silencioso).
//
// Contrato (FinancialProfileResponseSchema del wizard, modules/.../types/financial-profile.ts):
//   { code, message, data: { userData{name,documentType,documentNumber,occupation?,age?},
//     monthlyInformalIncomeAmount?, monthlyIncomeAmount, creditScore?, currentNegativeCredits?,
//     debtCapacityPercentage? } }
//
// Uso:  bin/mock-financial-health start   ·  env: MOCK_FINHEALTH_PORT (4000)
import { createServer } from 'node:http';

process.env.E2E_TARGET ||= 'local';   // el mock lee la BD LOCAL; sin esto db.ts defaultea a dev
process.env.CFE_TARGET ||= 'local';

const { one, scalar } = await import('../pkg/db.ts');

const PORT = Number(process.env.MOCK_FINHEALTH_PORT || 4000);

const json = (res: import('node:http').ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
};

async function perfil(userRequestId: number) {
    const u = await one<{ id: number; full_name: string | null; document_type: string | null; document_number: string | null; age: number | null }>(
        `SELECT u.id, u.full_name, u.document_type, u.document_number, u.age
         FROM user_requests ur JOIN users u ON u.id = ur.user_id WHERE ur.id = ?`,
        [userRequestId],
    );
    if (!u) return null;

    const campo = (fid: number) => scalar<string>(
        'SELECT value FROM user_field_values WHERE user_id=? AND field_id=? ORDER BY id DESC LIMIT 1',
        [u.id, fid],
    );
    const [ingreso, ocupacion, resumen] = await Promise.all([
        campo(87),
        campo(29),
        one<{ datacredito: unknown; abaco: unknown }>(   // mysql2 devuelve las columnas JSON ya parseadas (objeto)
            'SELECT datacredito, abaco FROM user_summaries WHERE user_id=? ORDER BY id DESC LIMIT 1', [u.id],
        ),
    ]);

    // mysql2 parsea las columnas JSON a objeto ÉL SOLO; solo llega string si la columna es TEXT.
    const parse = (s: unknown): Record<string, unknown> => {
        if (s && typeof s === 'object') return s as Record<string, unknown>;
        if (typeof s !== 'string' || s === '') return {};
        try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
    };
    const dc = parse(resumen?.datacredito);
    const abaco = parse(resumen?.abaco);

    const monthlyIncomeAmount = Number(ingreso) || null;
    // el ingreso INFORMAL es el que midió Ábaco (average_income, persistido por AbacoParserService)
    const informal = Number((abaco as { average_income?: unknown }).average_income) || null;
    const creditScore = Number((dc as { score?: unknown }).score) || null;
    const principals = (dc as { data?: { agregatedInfo?: { overview?: { principals?: { currentNegativeCredits?: unknown } } } } })
        .data?.agregatedInfo?.overview?.principals;
    const negativos = principals ? Number(principals.currentNegativeCredits) || 0 : null;
    const vmp = Number((dc as { value_monthly_payment?: unknown }).value_monthly_payment) || null;
    const debtCapacityPercentage = monthlyIncomeAmount && vmp
        ? Math.round((vmp / monthlyIncomeAmount) * 100)
        : null;

    return {
        userData: {
            name: u.full_name ?? '(sin nombre)',
            documentType: u.document_type ?? 'CC',
            documentNumber: u.document_number ?? '',
            occupation: ocupacion ?? null,
            age: u.age ?? null,
        },
        monthlyInformalIncomeAmount: informal,
        monthlyIncomeAmount,
        creditScore,
        currentNegativeCredits: negativos,
        debtCapacityPercentage,
    };
}

createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/') {
        return json(res, 200, { mock: 'financial-health', port: PORT });
    }
    if (req.method === 'POST' && url.pathname === '/v1/financial-profile/me') {
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', async () => {
            let urId = 0;
            try { urId = Number((JSON.parse(body || '{}') as { userRequestId?: unknown }).userRequestId) || 0; } catch { /* body inválido → 400 abajo */ }
            if (!urId) return json(res, 400, { code: 'FHMOCK400', message: 'userRequestId requerido' });
            try {
                const data = await perfil(urId);
                if (!data) return json(res, 404, { code: 'FHMOCK404', message: `user_request ${urId} no existe en la BD local` });
                return json(res, 200, { code: 'FHMOCK200', message: 'ok (mock: datos reales de la BD local)', data });
            } catch (e) {
                // BD local caída/ilegible → error HONESTO (nada de perfiles inventados)
                return json(res, 503, { code: 'FHMOCK503', message: `BD local inaccesible: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` });
            }
        });
        return;
    }
    return json(res, 404, { code: 'FHMOCK404', message: `sin ruta: ${req.method} ${url.pathname}` });
}).listen(PORT, () => console.log(`mock-financial-health :${PORT} (lee la BD ${process.env.E2E_TARGET})`));
