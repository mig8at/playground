// dev-overlays.ts — lo que el wizard pinta encima en modo desarrollo, apagado en los navegadores del arnés.
//
// En `import.meta.env.DEV` el wizard inyecta `react-scan` desde unpkg (`app/entry.client.tsx`), sin una
// variable que lo apague: una barra flotante con selector, campana, interruptor y FPS que tapa el pie de
// cada pantalla y sale en todas las capturas. El arnés lo bloquea en la RED del contexto, así no se toca
// el repo del equipo y vale para cualquier página que lo pida.
import type { BrowserContext } from '@playwright/test';

const DEV_OVERLAYS = /^https:\/\/unpkg\.com\/react-scan(@[^/]+)?\//;

export async function blockDevOverlays(context: BrowserContext): Promise<void> {
    await context.route(DEV_OVERLAYS, (route) => route.abort());
}
