import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';

/**
 * CANAL QR — las PANTALLAS de autogestión, con navegador. Es el camino VISUAL del canal.
 *
 * QUÉ PRUEBA QUE EL CAMINO POR API NO PUEDE:
 *   `dev/qr-corbeta.ts` habla directo con los endpoints, así que demuestra que el BACKEND orquesta bien
 *   — pero no que las pantallas los llamen, ni en ese orden, ni con esos payloads. Esta suite recorre las
 *   dos pantallas reales del self-service (`solicitar` → `{phone}/otp`) y verifica que el OTP resuelva el
 *   producto, que es **el punto de decisión del canal**: de ahí sale bnpl, consumo o no-preapproved
 *   (`routes/bancolombia/onboarding/otp.tsx:182` vs `:121`).
 *
 * Y de paso valida los selectores de `pkg/qr-steps.ts`, que son lo más frágil del harness: el módulo
 * `bancolombia-origination` **no tiene un solo `data-testid`**, así que se selecciona por rol y etiqueta
 * accesible. Si alguien cambia un copy, este test es el que avisa.
 *
 * REQUISITOS (se saltan con motivo, no fallan opacos):
 *   · el wizard en :5174 apuntando al backend del target (lo levanta `bin/asesor`/`bin/qr`);
 *   · `mock-bancolombia` (:8104) + `BANCOLOMBIA_HOST`/`_AUTH_HOST` apuntados ahí — sin eso la
 *     pre-aprobación del OTP no resuelve y el canal cae en `no-preapproved`;
 *   · el teléfono en `qa_otp_bypass_phones` (el OTP son sus últimos 4 dígitos).
 */

// El target se fija ANTES de importar pkg/db (que lo lee al cargar). Con imports estáticos esto no
// alcanzaría: se hoistean y `pkg/db` quedaría apuntando al default, que es **dev** — y ahí
// `corbetaBranch()` se cuelga o falla sin VPN y la suite se salta entera sin decir por qué.
process.env.E2E_TARGET ||= 'local';

const { fillQrRegister, fillQrOtp, otpDeTelefono, autorrellenarQr } = await import('../pkg/qr-steps.ts');
const { qrEntryUrl, corbetaBranch } = await import('../pkg/qr.ts');
const { close } = await import('../pkg/db.ts');

const PHONE = '3131010101';
const WIZARD = process.env.E2E_BASE_URL || 'http://localhost:5174';
const MOCK_BC = `http://localhost:${process.env.MOCK_BC_PORT || 8104}`;

// Serial: comparte el teléfono de bypass y la BD local con el resto del harness.
test.describe.configure({ mode: 'serial' });

test.describe('canal QR — pantallas de autogestión', () => {
    let hash = '';
    let wizardArriba = false;
    let mockArriba = false;

    test.beforeAll(async () => {
        // ⚠ SCRUB DEL TELÉFONO, obligatorio: el registro del self-service valida la unicidad
        // teléfono↔documento y responde «El número de celular ya se encuentra registrado con otra
        // cédula» (campo `documentNumberError`) si el teléfono de bypass quedó con el usuario de otra
        // corrida — por ejemplo las del runner por API. Mismo mecanismo que usa `bin/asesor` al arrancar.
        // El target va EXPLÍCITO en el env del hijo: `bin/dbops.ts` es otro proceso y su default es
        // **dev**, donde el guard de escrituras compartidas lo bloquea (F-53) y el scrub falla en silencio.
        const scrub = spawnSync('node', ['bin/dbops.ts', 'scrubphone', PHONE], {
            cwd: new URL('..', import.meta.url).pathname,
            env: { ...process.env, E2E_TARGET: 'local' },
            encoding: 'utf8',
        });
        if (/error|bloqueada/i.test(scrub.stdout || scrub.stderr || '')) {
            console.log(`  ⚠ el scrub del teléfono falló: ${(scrub.stdout || scrub.stderr).slice(0, 160)}`);
        }

        const br = await corbetaBranch();
        hash = br?.hash ?? '';
        wizardArriba = await fetch(`${WIZARD}/`, { signal: AbortSignal.timeout(10_000) })
            .then((r) => r.status > 0).catch(() => false);
        mockArriba = await fetch(MOCK_BC, { signal: AbortSignal.timeout(3_000) }).then(() => true).catch(() => false);
    });

    test.afterAll(async () => { await close(); });

    test.beforeEach(() => {
        test.skip(!hash, `sin sucursal Corbeta con 68 y 100 habilitados (target ${process.env.E2E_TARGET})`);
        test.skip(!wizardArriba, `el wizard no responde en ${WIZARD} → levantalo con bin/qr <hash>`);
    });

    test('la entrada del QR renderiza el registro con sus campos', async ({ page }) => {
        await page.goto(qrEntryUrl(hash), { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/self-service\/[^/]+\/solicitar/);
        // Los dos campos y los dos checkboxes obligatorios: es el contrato que asume pkg/qr-steps.ts.
        await expect(page.getByLabel(/Número celular/i)).toBeVisible();
        await expect(page.getByLabel(/Número de documento/i)).toBeVisible();
        expect(await page.getByRole('checkbox').count(), 'se esperan 2 checkboxes (términos + política)').toBeGreaterThanOrEqual(2);
    });

    test('autorrelleno: deja todo puesto y NO clickea — el submit queda habilitado y la URL igual', async ({ page }) => {
        // Es el contrato del modo MANUAL del canal: el harness escribe, el usuario sólo da Continuar.
        // Si esto empezara a clickear, el camino visual dejaría de ser visual.
        await page.goto(qrEntryUrl(hash), { waitUntil: 'domcontentloaded' });
        const urlAntes = page.url();

        const hechos = await autorrellenarQr(page, {
            phone: PHONE, document: String(2_900_000_000 + (Date.now() % 90_000_000)),
            amount: 1_500_000, firstName: 'SYNTH', lastName: 'TEST USER',
            email: 'synth.qr@gmail.com', address: 'Cal 123 # 12-122', income: 2_500_000,
        });

        expect(hechos.length, `no llenó nada: ${JSON.stringify(hechos)}`).toBeGreaterThan(0);
        expect(await page.getByLabel(/Número celular/i).inputValue()).toBe(PHONE);
        expect(await page.getByLabel(/Número de documento/i).inputValue()).not.toBe('');
        // Los dos checkboxes de Radix, marcados.
        const estados = await page.locator('button[role="checkbox"]').evaluateAll(
            (els) => els.map((e) => e.getAttribute('data-state')));
        expect(estados.every((e) => e === 'checked'), `checkboxes: ${JSON.stringify(estados)}`).toBe(true);
        // Y lo que define el contrato: el botón quedó HABILITADO (o sea el form valida) pero NADIE lo tocó.
        const submit = page.locator('form').first().getByRole('button', { name: /continuar/i }).first();
        await expect(submit).toBeEnabled();
        expect(page.url(), 'el autorrelleno no debe navegar').toBe(urlAntes);
    });

    test('registro + OTP: el OTP resuelve el producto', async ({ page }) => {
        test.skip(!mockArriba, `mock-bancolombia no responde en ${MOCK_BC} → bin/mock-bancolombia start`);

        // Documento único por corrida: el checkout rebota si el teléfono ya tiene usuario con otra identidad.
        const doc = String(2_900_000_000 + (Date.now() % 90_000_000));
        await page.goto(qrEntryUrl(hash), { waitUntil: 'domcontentloaded' });

        const avanzo = await fillQrRegister(page, { phone: PHONE, document: doc });
        // Si no avanzó, el motivo casi siempre está EN LA PANTALLA (validación del form o error del
        // backend, ej. la unicidad teléfono↔documento). Volcarlo acá convierte un fallo opaco en un
        // diagnóstico: sin esto el mensaje culpa a los selectores incluso cuando el problema es el dato.
        if (!avanzo) {
            const msgs = (await page.locator('[role=alert], [data-slot=form-message], .text-destructive').allTextContents())
                .map((x) => x.trim()).filter(Boolean);
            console.log(`  ⚠ el registro no avanzó · URL=${page.url()}`);
            console.log(`  ⚠ mensajes en pantalla: ${JSON.stringify(msgs.slice(0, 4))}`);
        }
        expect(avanzo, 'el registro no avanzó al OTP — mirá los mensajes de pantalla del log').toBe(true);
        await expect(page).toHaveURL(/\/otp/);

        const donde = await fillQrOtp(page, { phone: PHONE, code: otpDeTelefono(PHONE) });
        // El OTP tiene que RESOLVER: cualquiera de los tres es un desenlace legítimo del canal, lo que no
        // vale es quedarse en la pantalla (eso sería el OTP sin validar).
        expect(['bnpl', 'consumo', 'no-preapproved'], `quedó en ${page.url()}`).toContain(donde);
        // Con el mock arriba y la sucursal con 68/100, lo esperable es un producto — si sale
        // `no-preapproved` es señal de que el mock no está apuntado o la sucursal no tiene cupo.
        expect(donde, 'con mock-bancolombia arriba debería pre-aprobar').not.toBe('no-preapproved');
    });
});
