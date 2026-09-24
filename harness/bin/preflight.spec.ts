// Qué se fija acá: que NADIE resuelva un valor del ambiente por fuera de la cadena
// (`process.env` > `.env.<target>`), y que el chequeo que lo detecta no marque de más.
//
// POR QUÉ ES UNA PRUEBA Y NO SÓLO UN COMANDO. `bin/preflight.ts` mira VALORES RESUELTOS, y ahí tiene un
// punto ciego que costó caro: un call site que nunca le pregunta a la cadena da valores resueltos
// perfectos y pega igual contra el ambiente equivocado. Medido el 2026-09-15, cuatro lugares leían del
// `process.env` pelado una clave que sólo vive en un `.env.<target>`:
//
//   · `pkg/ecommerce.ts`  → posteaba `/vtex/init` a **localhost en los cuatro targets**; con
//                            `E2E_TARGET=qa` leía el token de la base COMPARTIDA y escribía en la local
//   · `dev/sweep.ts` · `dev/qr-corbeta.ts` · `dev/listado.ts`  → `E2E_ASESOR_SUB` sólo existe en
//                            `.env.qa` y `.env.staging`, así que contra esos targets mandaban el asesor
//                            del catálogo local, o ninguno (F-46: eso BORRA el asesor de la solicitud)
//   · `pkg/close.ts`      → el disparo del webhook estaba SIEMPRE apagado: código que parecía vivo
//
// Es la firma de F-59, F-64, F-65 y F-187, y ninguno de los cuatro se veía leyendo el `.env`.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { outsideChain } from './preflight.ts';

test('nadie resuelve el ambiente por fuera de la cadena', () => {
      const outside = outsideChain();
      const detail = outside.map((f) => `${f.archivo}:${f.linea}  process.env.${f.clave}`).join('\n');
      expect(outside, `\n${detail}\n\n`
            + '`env()` mira process.env PRIMERO, así que `env(\'X\')` nunca es peor que `process.env.X` —\n'
            + 'pero sí al revés: `env()` NO escribe en process.env, así que lo que declara .env.<target> es\n'
            + 'invisible ahí y ese valor NO cambia con el target. Usá `env(\'<clave>\')`, o `config.mockUrl`\n'
            + 'si es el backend, o `advisorSubject()` si es el asesor.\n').toEqual([]);
});

// 🔴 Un chequeo que marca de más se aprende a ignorar, y entonces el día que marca de verdad tampoco se
// mira. ESCRIBIR en `process.env` es cómo se pone un override —`env()` lo lee primero—, y la primera
// versión de este chequeo marcaba esas dos asignaciones como si fueran el bug.
test('no marca las ESCRITURAS, que son la forma legítima de un override', () => {
      const files = outsideChain().map((f) => f.archivo);
      expect(files).not.toContain('pkg/ecommerce.ts');   // `process.env.E2E_WEBHOOK_URL = opciones.processUrl`
      expect(files).not.toContain('dev/ecommerce.ts');   // fija sus destinos de prueba
});

// La lista de claves se DERIVA de los `.env.<target>`: si fuera a mano, quedaría vieja el día que
// alguien agrega una variable — y un chequeo que contesta «no hay» sin haber sabido buscar es peor que
// no tenerlo (ya pasó con `git grep` y `\s`).
test('el chequeo sabe de las claves que existen hoy, no de una lista escrita a mano', () => {
      const source = readFileSync(new URL('./preflight.ts', import.meta.url), 'utf8');
      expect(source).toContain('readdirSync(ROOT)');
      expect(source).not.toMatch(/const CLAVES\s*=\s*\[/);
});
