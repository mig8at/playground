// UNA RECETA POR FLUJO (2026-11-20): antes de escribir una receta desde un flujo, se mira si ya hay una que salió de
// ESE flujo (su cabecera lo dice: «Salió de jarvis/flows/…»). Si la hay, se actualiza ésa —mismo nombre, mismo
// archivo— en vez de dejar dos recetas iguales con nombres distintos. Lo que la persona pulió a mano se pisa, pero las
// recetas están en git: `git diff` lo muestra y se recupera. Módulo de apoyo (sin línea de uso, no es una receta).
import fs from 'node:fs';
import path from 'node:path';

// recipeOfFlow devuelve el nombre de la receta de `kind` (api: por la API con tu sesión · screen: por pantalla) que
// salió del flujo `flowRel` en la herramienta `app`, o undefined.
export function recipeOfFlow(root: string, app: string, flowRel: string, kind: 'api' | 'screen'): string | undefined {
    const dir = path.join(root, 'jarvis/recipes', app);
    if (!fs.existsSync(dir)) return undefined;
    const mark = kind === 'api' ? 'RECETA CON TU SESIÓN' : 'RECETA POR PANTALLA';
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts')).sort()) {
        const head = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').slice(0, 3).join('\n');
        if (head.includes(mark) && (head.includes(`Salió de ${flowRel} `) || head.includes(`Salió del flujo ${flowRel}:`))) return f.replace(/\.ts$/, '');
    }
    return undefined;
}
