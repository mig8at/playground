import type { Page, Route } from '@playwright/test';

/**
 * Mock de los DOCUMENTOS del cierre (consentimiento, pagaré, garantía) en LOCAL.
 *
 * EL PROBLEMA (visto en una corrida real, 2026-07-18):
 *   La pantalla `sign-documents` —el ÚLTIMO paso antes de "crédito aprobado"— previsualiza 3 PDFs que el
 *   backend genera y sube a S3. En local no hay S3: el bucket es `local-mock`, así que las URLs quedan como
 *   `https://local-mock.s3.amazonaws.com/front-web/users/documents/.../preview_consent_<ur>_<ally>_<ts>.pdf`
 *   y el host NO EXISTE. El navegador las bloquea y el visor (pdf.js) muestra "Error al cargar el documento"
 *   tres veces → no se puede firmar → el crédito no se puede cerrar.
 *
 * LA SOLUCIÓN:
 *   Interceptamos SOLO las URLs de S3 que apuntan a un bucket inexistente y respondemos un PDF mínimo válido
 *   (generado acá, sin dependencias) con los headers CORS que el fetch del visor necesita. El documento es
 *   decorativo: lo que importa es que el visor cargue algo y habilite el botón de firmar.
 *
 * ALCANCE: pensado para `E2E_TARGET=local`. En dev/staging los documentos viven en un S3 real y funcionan;
 * por eso el llamador decide cuándo aplicarlo (ver `mockClosingDocuments`).
 */

/** PDF mínimo VÁLIDO (con xref bien calculado) de una página con un texto. Sin dependencias. */
export function minimalPdf(text = 'DEMO - documento simulado por el harness'): Buffer {
    const esc = (s: string) => s.replace(/([\\()])/g, '\\$1');
    const stream = `BT /F1 14 Tf 40 500 Td (${esc(text)}) Tj ET`;
    const objs = [
        '<</Type/Catalog/Pages 2 0 R>>',
        '<</Type/Pages/Kids[3 0 R]/Count 1>>',
        '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
        `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
        '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    ];

    // Cuerpo: cada objeto numerado, anotando el offset EXACTO en bytes (el xref lo exige).
    let body = '%PDF-1.4\n';
    const offsets: number[] = [];
    objs.forEach((o, i) => {
        offsets.push(Buffer.byteLength(body, 'latin1'));
        body += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });

    // Tabla xref: entradas de EXACTAMENTE 20 bytes ("%010d %05d n \n").
    const xrefAt = Buffer.byteLength(body, 'latin1');
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;

    const tail = `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`;
    return Buffer.from(body + xref + tail, 'latin1');
}

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,HEAD,OPTIONS',
    'access-control-allow-headers': '*',
};

/**
 * Intercepta en `page` los PDFs del cierre servidos desde un bucket S3 INEXISTENTE y devuelve un PDF válido.
 * Matchea por host de S3 + extensión .pdf; por defecto solo si el bucket contiene `local-mock` (el de local),
 * para no tocar documentos reales cuando se corre contra dev.
 */
export async function mockClosingDocuments(page: Page, opts: { onlyFakeBucket?: boolean } = {}): Promise<void> {
    const onlyFake = opts.onlyFakeBucket ?? true;
    const pdf = minimalPdf();

    const isFakeS3Pdf = (url: URL): boolean => {
        if (!/\.s3[.-][^/]*amazonaws\.com$/i.test(url.hostname)) return false;
        if (!/\.pdf($|\?)/i.test(url.pathname + url.search)) return false;
        return onlyFake ? /local-mock|localhost|fake|dummy/i.test(url.hostname) : true;
    };

    await page.route(isFakeS3Pdf, async (route: Route) => {
        // El visor puede mandar un preflight (Range/headers propios) → hay que contestarlo o el fetch muere.
        if (route.request().method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: CORS });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/pdf',
            headers: { ...CORS, 'accept-ranges': 'none', 'cache-control': 'no-store' },
            body: pdf,
        });
    });
}
