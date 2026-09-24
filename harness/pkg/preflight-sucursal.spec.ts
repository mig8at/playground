// Qué se fija acá: que el preflight de sucursal AVISE cuando la sucursal que vamos a anunciar no es la
// que el backend le da al asesor, y que se CALLE cuando coinciden. Un chequeo que avisa siempre se
// aprende a ignorar, y uno que nunca avisa es peor que no tenerlo.
//
// El caso que lo motivó, medido contra `qa` el 2026-09-15: el panel anunció las entidades de
// `13874eb6` y la corrida usó las de `ec977139`, dos sucursales del MISMO comercio (Amoblando Pullman)
// con listas distintas. Nadie lo avisó.
//
// ⚠ NO se pega a ningún backend acá: `advisorBranch` sale por red y eso haría la prueba depender
// del ambiente. Lo que se fija es la DECISIÓN —comparar y redactar— que es donde estaba el hueco.
import { expect, test } from '@playwright/test';
import { redirectNotice, mismatchNotice, catalogHash, advisorSubject, type Mismatch } from './preflight-sucursal.ts';

const base = (over: Partial<Mismatch> = {}): Mismatch => ({
      coincide: false, comprobado: true, slug: 'pullman', target: 'qa',
      esperada: '13874eb6', sub: 'sub-x', motivo: '',
      asesor: { userId: 1827238, hash: '1bfb8cd0', nombre: 'CeluRD Santo Domingo', email: 'oscar@creditop.com' },
      ...over,
});

test.describe('el aviso de desajuste', () => {
      test('se calla cuando coinciden', () => {
            expect(mismatchNotice(base({ coincide: true }))).toEqual([]);
      });

      test('avisa, y dice las DOS sucursales y de quién es la real', () => {
            const a = mismatchNotice(base()).join('\n');
            expect(a).toContain('13874eb6');           // la que anunciamos
            expect(a).toContain('1bfb8cd0');           // la que va a usar el wizard
            expect(a).toContain('CeluRD Santo Domingo');
            expect(a).toContain('oscar@creditop.com'); // de quién es esa sucursal: el dato que destapó el caso
      });

      // 🔴 «No se pudo comprobar» NO es «está mal». Si el backend no contesta y esto grita el mismo
      // aviso, el que corre aprende a ignorarlo y el día que SÍ hay desajuste tampoco lo mira.
      test('cuando no se pudo comprobar lo dice así, no como desajuste', () => {
            const a = mismatchNotice(base({ comprobado: false, motivo: 'el backend no contestó' }));
            expect(a).toHaveLength(1);
            expect(a[0]).toContain('sin verificar');
            expect(a.join('\n')).not.toContain('NO ES LA QUE VA A USAR');
      });

      test('un asesor sin sucursal asignada también avisa', () => {
            const a = mismatchNotice(base({ asesor: { userId: 1, hash: '', nombre: '', email: 'x@y.z' } }));
            expect(a.join('\n')).toContain('(ninguna)');
      });
});

test.describe('el aviso de redirección (la mitad que se caza corriendo)', () => {
      test('se calla cuando el wizard te deja donde pediste', () => {
            expect(redirectNotice('13874eb6', '13874eb6')).toEqual([]);
      });

      // Ésta es la red que funciona sin importar cuál de las tres fuentes esté mal: el 302 ya se veía
      // en el log de la corrida como un salto más de navegación, sin decir que invalidaba el anuncio.
      test('avisa cuando te movió, con las dos sucursales', () => {
            const a = redirectNotice('13874eb6', 'ec977139').join('\n');
            expect(a).toContain('13874eb6');
            expect(a).toContain('ec977139');
            expect(a).toContain('MOVIÓ DE SUCURSAL');
      });

      test('no avisa con datos incompletos: sin los dos hashes no hay nada que comparar', () => {
            expect(redirectNotice('', 'ec977139')).toEqual([]);
            expect(redirectNotice('13874eb6', '')).toEqual([]);
      });
});

test.describe('el hash del catálogo', () => {
      test('un hash suelto es su propio hash (el buscador del panel deja elegir sucursales sin catalogar)', () => {
            expect(catalogHash('13874eb6', 'qa')).toBe('13874eb6');
            expect(catalogHash('EC977139', 'qa')).toBe('ec977139');
      });

      test('un slug que el catálogo no conoce no inventa un hash', () => {
            expect(catalogHash('comercio-que-no-existe-xyz', 'qa')).toBe('');
      });
});

test.describe('el sub del asesor', () => {
      // 🔴 Ésta es la que falló en silencio: el caminador leía SÓLO la variable de entorno, y en `local`
      // no está — así que el chequeo se saltaba y parecía que no había desajuste. Un chequeo que se
      // saltea se lee igual que uno que pasó.
      test('cae a .flows.json cuando la variable de entorno no está', () => {
            const prior = process.env.E2E_ASESOR_SUB;
            delete process.env.E2E_ASESOR_SUB;
            try {
                  // El `.flows.json` de esta máquina declara un asesor; lo que se fija es que NO devuelva
                  // vacío por no haber mirado ahí.
                  expect(advisorSubject()).not.toBe('');
            } finally {
                  if (prior !== undefined) process.env.E2E_ASESOR_SUB = prior;
            }
      });

      test('la variable de entorno manda sobre el catálogo', () => {
            const prior = process.env.E2E_ASESOR_SUB;
            process.env.E2E_ASESOR_SUB = 'sub-de-la-variable';
            try {
                  expect(advisorSubject()).toBe('sub-de-la-variable');
            } finally {
                  if (prior === undefined) delete process.env.E2E_ASESOR_SUB;
                  else process.env.E2E_ASESOR_SUB = prior;
            }
      });
});
