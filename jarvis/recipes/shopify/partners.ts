// LO QUE SE LEE DEL PARTNER DASHBOARD DE SHOPIFY, por pantalla (no tiene API pública para esto): las apps de la
// organización y, de cada una, cómo se distribuye y en qué estado está como app de pagos. Lo usan `payments-app-status`
// y `payments-app-setup`. La sesión es la del Chrome de la persona (hoy, la de Juan: es el dueño de la cuenta Partner).
//
// Qué dice la pantalla de Distribución (medido el 2026-11-13, en español y en inglés):
//   - sin elegir: «Selecciona un método de distribución» / «Select a distribution method»
//   - personalizada: «Distribución personalizada» con «Generar enlace» (no pasa por revisión, no cambia)
//   - pública: «Publicación en la Shopify App Store» / «Shopify App Store listing» (va a revisión)
//   - de una app de pagos: «Estado de la app de pagos» + Development | Hidden | Generally Available

/** La organización Partner de CreditOp (CREDITOP) y la del Dev Dashboard. */
export const PARTNER_ORG = '4296643';
export const DEV_ORG = '167881494';

export type Distribution = 'sin elegir' | 'personalizada' | 'pública' | 'desconocida';
export type PartnerApp = { id: string; name: string; distribution: Distribution; paymentsStatus: string | null; url: string };

/** Las apps de la organización (id y nombre), de la lista de Partners. */
export async function listApps(page: any, org = PARTNER_ORG): Promise<{ id: string; name: string }[]> {
    await page.goto(`https://partners.shopify.com/${org}/apps`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    // La lista llega después de la página (es una app de una sola página): se espera un enlace a una app con id.
    await page.waitForFunction(() => [...document.querySelectorAll('a[href*="/apps/"]')].some((a) => /\/apps\/\d+/.test(a.getAttribute('href') || '')), null, { timeout: 60_000 })
        .catch(() => {});
    if (/accounts\.shopify\.com|\/login/.test(page.url())) throw new Error('Partners pide iniciar sesión: entrá en tu Chrome y volvé a correrla');
    const links: { id: string; name: string }[] = await page.$$eval('a[href*="/apps/"]', (as: any[]) =>
        as.map((a) => ({ href: a.getAttribute('href') || '', name: (a.textContent || '').trim() })))
        .then((xs: any[]) => xs.map((x) => ({ id: (/\/apps\/(\d+)/.exec(x.href) || [])[1] || '', name: x.name })));
    const seen = new Map<string, string>();
    for (const l of links) if (l.id && l.name && !/dev dashboard|ver en/i.test(l.name) && !seen.has(l.id)) seen.set(l.id, l.name);
    return [...seen].map(([id, name]) => ({ id, name }));
}

/** Cómo se distribuye una app y su estado como app de pagos, de su página de Distribución. */
export async function readDistribution(page: any, id: string, name = '', org = PARTNER_ORG): Promise<PartnerApp> {
    const url = `https://partners.shopify.com/${org}/apps/${id}/distribution`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.getByText(/Distribución|Distribution/).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500); // la tarjeta del estado de pagos llega después
    const text: string = await page.evaluate(() => document.body.innerText);
    let distribution: Distribution = 'desconocida';
    if (/Selecciona un método de distribución|Select a distribution method/i.test(text)) distribution = 'sin elegir';
    else if (/Publicación en la Shopify App Store|Shopify App Store listing|envía la app para revisión|submit (your|the) app for review/i.test(text)) distribution = 'pública';
    else if (/Distribución personalizada|Custom distribution|Generar enlace|Generate link|enlace de instalación|install link/i.test(text)) distribution = 'personalizada';
    const m = /(?:Estado de la app de pagos|Payments app status)\s*\n\s*([^\n]+)/i.exec(text);
    // El nombre, del menú de la izquierda (abajo de «Todas las apps»): el título de la pestaña es sólo «Shopify Partners».
    const appName = name || (/(?:TODAS LAS APPS|ALL APPS)\s*\n\s*([^\n]+)/i.exec(text) || [])[1]?.trim() || id;
    return { id, name: appName, distribution, paymentsStatus: m ? m[1].trim() : null, url };
}
