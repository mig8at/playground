/**
 * pkg/wizard-steps — helpers ATÓMICOS para cada pantalla del wizard self-service
 * (amount → phone → otp → personal-info → expedition-date → employment-info).
 *
 * Es un módulo "hoja" sin deps internas (solo Playwright). Lo consumen:
 *   - pkg/composer.ts        → arma flujos compuestos por presets
 *   - channel/steps.ts       → expone `runHappyPathUntilLenders` (wrapper sobre el composer)
 *   - specs que necesitan llamar pasos sueltos (ej. ecommerce-local-real con su propia entrada)
 *
 * Lo extrajimos de channel/steps.ts para EVITAR un import circular composer ↔ channel/steps
 * y para que el composer y el helper compartan EXACTAMENTE la misma implementación
 * (un único punto de cambio cuando cambia un selector).
 *
 * Convención de inputs con transformer:
 *   - `docnum-input` y `monthly-income-input` usan react-hook-form con `onChange` que
 *     reformatea el valor. `fill()` salta el transformer y pierde chars. Por eso usamos
 *     `pressSequentially` con delay 50ms.
 *
 * Convención de scroll:
 *   - Algunos botones quedan tapados por el dock móvil de Vite en local; `click()` ya hace
 *     scroll-into-view, no hace falta forzarlo.
 */
/*
 * ⚠⚠ ESTE WIZARD CASI NO PUBLICA `data-testid`: SON SEIS, Y ESTE ARCHIVO LLEGÓ A NOMBRAR 21.
 *
 * Medido el 2026-09-14 contra `origin/qa`, pidiendo el atributo literal y SIN restringir directorios:
 * existen `amount-input`, `amount-submit`, `phone-input`, `phone-submit` (en `modules/`) y
 * `otp-input`, `otp-submit` (en `packages/shared/components/`, que es por qué una primera medición los
 * dio por muertos). Los 15 restantes no están en ninguna rama mergeada: vivían en los stashes
 * `local-e2e: data-testid …`, cuyo propio mensaje dice «NO commitear». Es **F-217**.
 *
 * POR ESO LOS HELPERS DE ABAJO VAN POR ROL Y LABEL, con el testid como PREFERENCIA cuando existe:
 * `getByTestId(x).or(getByRole(...))`. Los nombres accesibles salen del DOM REAL de cada pantalla —se
 * caminó el flujo y se volcaron los controles—, no del código: inferirlos del componente fue
 * exactamente lo que dejó este archivo apuntando a una pantalla que nunca se commiteó.
 *
 * DOS COSAS QUE NO SE VEN LEYENDO EL DOM Y ROMPEN IGUAL:
 *   · en el canal ECOMMERCE varios campos llegan del comercio y BLOQUEADOS — y el bloqueo no es
 *     `disabled` ni `readOnly` sino `pointer-events:none`, que Playwright ve como «enabled». Escribir
 *     ahí no falla: se cuelga 10 s. Por eso las guardas miran el VALOR, no el estado.
 *   · la fecha de expedición es el SEGUNDO paso de `/personal-info`: la URL no cambia, así que esperar
 *     un cambio de URL entre esos dos pasos cuelga el spec.
 */
import { expect, type Page } from '@playwright/test';

export async function fillAmountStep(
    page: Page,
    amount = '1500000',
    confirmQuota: 'yes' | 'no' = 'no',
): Promise<void> {
    // En self-service el paso de monto NO usa `amount-form.tsx` (que sí lleva testid en el flujo
    // dinámico): usa otro componente sin testid. Por eso caemos a un selector semántico por label.
    const input = page
        .getByTestId('amount-input')
        .or(page.getByRole('textbox', { name: /monto/i }));
    await expect(input).toBeVisible({ timeout: 15_000 });
    // ⚠ El canal ECOMMERCE fija el monto desde el carrito: el input llega con valor y BLOQUEADO.
    // No se escribe, sólo se confirma.
    //
    // Y el bloqueo NO se ve con `isEnabled()` / `isEditable()`: medido el 2026-09-14 contra qa, tras
    // hidratar el input queda `disabled=false`, `readOnly=false` y **`pointer-events: none`**. Para
    // Playwright está «visible, enabled and stable», así que intenta el click — y el click se lo
    // come el `<div>` padre. El spec muere con un timeout de 10 s tras «done scrolling», que no se
    // parece en nada a su causa. Por eso la guarda mira el VALOR, que es además lo semántico:
    // si el monto ya vino, no hay nada que escribir.
    const alreadyBringsAmount = ((await input.inputValue().catch(() => '')) ?? '').trim() !== '';
    if (!alreadyBringsAmount) {
        // Currency-masked input rejects `.fill()` intermittently. Type chars one
        // by one so the masking layer receives each keystroke event.
        await input.click();
        await input.pressSequentially(amount, { delay: 30 });
    }
    // "Confirmación de cupo" (feature omit-Experian): selector OBLIGATORIO en comercios habilitados
    // (check-if-able-to-omit → RKV26000). Si está presente hay que elegir para habilitar el submit;
    // default 'no' = flujo estándar (preserva el comportamiento de los specs previos).
    const quota = page.getByRole('radio', { name: confirmQuota === 'yes' ? 'Sí' : 'No', exact: true });
    if (await quota.isVisible().catch(() => false)) {
        await quota.click();
    }
    const submit = page
        .getByTestId('amount-submit')
        .or(page.getByRole('button', { name: /activar mi cr[ée]dito|iniciar solicitud|continuar/i }));
    // Wait until the submit button leaves the disabled state — the mask only
    // accepts the value after its internal state settles.
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    await submit.click();
}

export async function fillPhoneStep(page: Page, phone?: string): Promise<string> {
    const value =
        phone ?? `300${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`;
    const input = page.getByTestId('phone-input');
    await expect(input).toBeVisible({ timeout: 15_000 });
    // Igual que el monto: en ECOMMERCE el celular viene del contrato del carrito y el input llega
    // `readonly`. Escribir ahí no falla con un mensaje útil — se cuelga. Si ya trae valor se respeta
    // y se DEVUELVE ése, que es el que quedará en la solicitud.
    const alreadyBrings = ((await input.inputValue().catch(() => '')) ?? '').trim();
    if (alreadyBrings === '') await input.fill(value);
    await page.getByTestId('phone-submit').click();
    return alreadyBrings === '' ? value : alreadyBrings;
}

export async function fillOtpStep(page: Page, code = '1234'): Promise<void> {
    // `otp-input`/`otp-submit` SÍ existen: los publica el componente compartido
    // `packages/shared/components/src/components/otp.tsx`. (Vivían fuera de `modules`/`apps`, que es
    // por qué una medición de 2026-09-14 los dio por muertos — ver F-217.)
    const input = page.getByTestId('otp-input').or(page.getByRole('textbox', { name: /c[óo]digo|otp/i }));
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.click();
    // Tecleado, no `fill()`: el campo reparte los dígitos entre casillas y `fill` las saltea.
    await page.keyboard.type(code, { delay: 30 });
    const submit = page.getByTestId('otp-submit').or(page.getByRole('button', { name: /confirmar|validar|verificar|continuar/i }));
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await submit.click();
}

export async function fillPersonalInfoIdentification(page: Page): Promise<void> {
    // POR LABEL, no por testid: esta pantalla no publica ninguno (F-217). Los nombres salen del DOM
    // real, medido el 2026-09-14: «Número de identificación *», «Nombres (Como aparecen en tu
    // documento)», «Apellidos (…)» y «Correo electrónico *».
    const field = (re: RegExp, testid: string) =>
        page.getByTestId(testid).or(page.getByRole('textbox', { name: re }));
    const doc = field(/n[úu]mero de identificaci[óo]n/i, 'docnum-input');
    await expect(doc).toBeVisible({ timeout: 15_000 });

    // ⚠ EN EL CANAL ECOMMERCE ESTOS FIELDS LLEGAN DEL COMERCIO Y BLOQUEADOS (`readonly`, y el bloqueo
    // real es por CSS: `pointer-events:none`). Escribir encima no falla con un mensaje útil: se cuelga
    // 10 s y culpa a la pantalla. Igual que en el monto y el celular, la guarda mira el VALOR: si el
    // dato ya vino, no hay nada que escribir. En self-service/asesor llegan vacíos y sí se escriben.
    const writeIfNeeded = async (loc: ReturnType<typeof field>, fieldValue: string) => {
        if (!(await loc.count())) return;
        if (((await loc.inputValue().catch(() => '')) ?? '').trim() !== '') return;
        await loc.click();
        await loc.pressSequentially(fieldValue, { delay: 30 });
    };
    await writeIfNeeded(doc, Math.floor(Math.random() * 2_899_999_999 + 100_000_000).toString());
    await writeIfNeeded(field(/nombres/i, 'name-input'), 'JUAN');
    await writeIfNeeded(field(/apellidos/i, 'surname-input'), 'PEREZ');
    await writeIfNeeded(field(/correo|email/i, 'email-input'), `juan${Date.now()}@example.com`);

    const submit = page.getByTestId('identification-submit').or(page.getByRole('button', { name: /^siguiente$/i }));
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await submit.click();
}

export async function fillExpeditionDate(page: Page): Promise<void> {
    // La fecha de expedición es el SEGUNDO paso de `/personal-info` — la URL no cambia— y sus tres
    // selectores son combobox de Radix SIN testid, con nombre accesible «Día*», «Mes*» y «Año*»
    // (medido en el DOM el 2026-09-14). El ORDEN importa: mes y año nacen `disabled` hasta que hay día.
    // ⚠ POR TEXTO Y NO POR `{ name }`: estos combobox NO tienen nombre accesible. En el árbol de
    // Playwright salen como `- combobox: Día*` (sin comillas), y las comillas son justamente lo que
    // marca el nombre; «Día*» es sólo su contenido. `{ name: /día/i }` no encuentra nada y el spec
    // muere con «element(s) not found» señalando a la pantalla en vez de al locator.
    const combo = (re: RegExp, testid: string) =>
        page.getByTestId(testid).or(page.getByRole('combobox').filter({ hasText: re }).first());
    const choose = async (re: RegExp, testid: string, option: RegExp) => {
        const c = combo(re, testid);
        await expect(c).toBeEnabled({ timeout: 15_000 });
        await c.click();
        // La opción es un `option` del listbox que Radix abre en un portal, así que se busca en la
        // PÁGINA y no dentro del combo.
        await page.getByRole('option', { name: option }).first().click();
    };
    await choose(/d[íi]a/i, 'date-selector-day', /^15$/);
    await choose(/mes/i, 'date-selector-month', /^junio$/i);
    await choose(/a[ñn]o/i, 'date-selector-year', /^2010$/);

    // El checkbox de «confirmo que los datos son correctos» no tiene label accesible: es el primero de
    // la pantalla. `force` porque Radix lo pinta sobre un input oculto.
    const check = page.getByRole('checkbox').first();
    if (await check.count()) await check.check({ force: true }).catch(() => {});

    const submit = page.getByTestId('expedition-date-submit').or(page.getByRole('button', { name: /^continuar$/i }));
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await submit.click();
}

export async function fillEmploymentInfo(
    page: Page,
    options: { status?: string; monthlyIncome?: string } = {},
): Promise<void> {
    const { status = 'Empleado', monthlyIncome = '2500000' } = options;
    // Sin testids (F-217): el selector es un Radix con placeholder «Selecciona tu situación laboral» y
    // el monto un input con placeholder «Ingresos mensuales» (`employment-info-form.tsx`).
    // Por TEXTO, igual que la fecha de expedición: los combobox del wizard no publican nombre accesible.
    const trigger = page.getByTestId('employment-status-trigger')
        .or(page.getByRole('combobox').filter({ hasText: /situaci[óo]n laboral|selecciona/i }).first())
        .or(page.getByRole('combobox').first());
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();
    await page.getByRole('option', { name: new RegExp(`^${status}$`, 'i') }).first().click();

    const income = page.getByTestId('monthly-income-input')
        .or(page.getByRole('textbox', { name: /ingresos mensuales/i }))
        .or(page.getByPlaceholder(/ingresos mensuales/i));
    await income.click();
    // Tecleado: el campo lleva máscara de moneda y `fill()` la saltea de a ratos.
    await income.pressSequentially(monthlyIncome, { delay: 30 });

    const submit = page.getByTestId('employment-submit').or(page.getByRole('button', { name: /^(continuar|siguiente)$/i }));
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await submit.click();
}
