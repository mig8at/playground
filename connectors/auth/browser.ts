import { createRequire } from 'node:module';
import type { Browser, Page, Locator } from '../../harness/node_modules/playwright-core/index.js';
export type { Browser, Page, Locator };

/** Runtime compartido ya instalado: no lee configuración, DB ni credenciales del harness. */
export async function launchChrome(headless: boolean): Promise<Browser> {
    const require = createRequire(new URL('../../harness/package.json', import.meta.url));
    const { chromium } = require('playwright-core') as typeof import('../../harness/node_modules/playwright-core/index.js');
    try { return await chromium.launch({ channel: 'chrome', headless }); }
    catch { return chromium.launch({ headless }); }
}
