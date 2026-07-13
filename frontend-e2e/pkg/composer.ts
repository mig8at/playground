/**
 * pkg/composer — mapper declarativo {channel, merchant, lender} → Flow ejecutable.
 *
 * IDEA (espejo de backend-e2e/main.go::runOne): la mayoría de los comercios comparten
 * EL MISMO flujo de wizard (amount → phone → otp → personal → employment → /lenders).
 * Lo que cambia entre uno y otro es:
 *   1) la ENTRADA (canal): self-service abierto / merchant Cognito / ecommerce checkout;
 *   2) el WIZARD: estándar self-service / formulario dinámico (SmartPay).
 *
 * En vez de duplicar el wizard en cada spec, lo declaramos UNA VEZ como un "preset"
 * y `composeFlow()` lo enchufa donde el spec lo necesite. Los comercios que comparten
 * combinación apuntan al mismo preset; los que difieren declaran el suyo.
 *
 * Espejo conceptual de backend-e2e: `channel.WebSteps/AsesorSteps + merchant.Verify +
 * lender.CloseSteps` se concatenan en `flow.New(...).Add(entry...).Step(verify).Add(close...)`.
 * Acá el composer hace exactamente eso pero la composición es por preset declarativo.
 */
import type { Page } from '@playwright/test';
import { Ctx, Flow } from './flow';
import {
    fillAmountStep,
    fillEmploymentInfo,
    fillExpeditionDate,
    fillOtpStep,
    fillPersonalInfoIdentification,
    fillPhoneStep,
} from './wizard-steps';
import { cognitoLogin } from './cognito';

export interface ComposeOptions {
    /** Override del monto a solicitar (default 1500000). */
    amount?: string;
    /** Override del teléfono (default: aleatorio del helper). */
    phone?: string;
    /** Override del path de entrada (raro; solo si el canal lo permite). */
    entryPath?: string;
}

/** Nombre canónico de cada preset (los que existen hoy). */
type ChannelKey = 'self-service' | 'merchant-cognito';
type WizardKey = 'standard';

interface MerchantSpec {
    channel: ChannelKey;
    wizard: WizardKey;
}

/**
 * Un "preset" agrega los pasos que le corresponden al Flow dado. Lee/escribe state
 * compartido (phone, loanRequestId) por el `Ctx`. Cada preset es un closure sobre
 * `(page, partnerHash, options)` así que no hace falta plumbing extra.
 */
type Preset = (f: Flow, page: Page, hash: string, opts: ComposeOptions) => void;

// ── PRESETS DE CANAL (ENTRADA) ──────────────────────────────────────────────
// Cada channel deja la página parada en la primera pantalla del wizard.
const channels: Record<ChannelKey, Preset> = {
    'self-service': (f, page, hash, opts) => {
        const path = opts.entryPath ?? `/self-service/${hash}/solicitar`;
        f.step('Entrada al wizard', `goto ${path} (self-service, sin auth)`, async () => {
            await page.goto(path);
            return path;
        });
    },
    'merchant-cognito': (f, page, hash) => {
        const path = `/merchant/${hash}/solicitar`;
        f.step(
            'Entrada + Login Cognito',
            'las rutas /merchant/* exigen sesión (default-layout requireUser); login Hosted UI',
            async () => {
                await page.goto(path);
                await cognitoLogin(page);
                await page.waitForURL(new RegExp(`/merchant/${hash}/solicitar`), { timeout: 20_000 });
                return `sesión iniciada · ${path}`;
            },
        );
    },
};

// ── PRESETS DE WIZARD (PASOS DEL FORMULARIO) ────────────────────────────────
// Cada wizard deja la página parada en /lenders y escribe `phone`/`loanRequestId` al Ctx.
const wizards: Record<WizardKey, Preset> = {
    standard: (f, page, _hash, opts) => {
        const amount = opts.amount ?? '1500000';
        f
            .step('Monto', `solicita ${amount}`, async () => {
                await fillAmountStep(page, amount);
                return `monto ${amount}`;
            })
            .step('Teléfono', 'envía OTP al teléfono ingresado', async (ctx) => {
                const phone = await fillPhoneStep(page, opts.phone);
                ctx.set('phone', phone);
                return `teléfono ${phone}`;
            })
            .step('OTP', 'valida el código contra el backend', async () => {
                await fillOtpStep(page);
                return 'OTP enviado';
            })
            // El destino tras OTP lo decide el FE (otp-verification.tsx): `success:true` → /lenders;
            // `ONB002` → /personal-info. Casos no-temporales: usuario que REGRESA o Corbeta (auto-inject).
            .step(
                'Resolver destino post-OTP',
                'el FE elige /personal-info (temporal/ONB002) o /lenders (no-temporal)',
                async () => {
                    await page.waitForURL(/\/(personal-info|lenders)(\?|$)/, { timeout: 15_000 });
                    return /\/lenders/.test(page.url())
                        ? 'salta a /lenders (no-temporal)'
                        : 'va a /personal-info (temporal)';
                },
            )
            .step('Datos personales + fecha de expedición', 'solo si el FE pidió /personal-info', async () => {
                if (!/\/personal-info(\?|$)/.test(page.url())) return 'omitido (no aplica)';
                await fillPersonalInfoIdentification(page);
                await fillExpeditionDate(page);
                await page.waitForURL(/\/(employment-info|lenders)(\?|$)/, { timeout: 20_000 });
                return 'identificación + fecha enviadas';
            })
            .step('Datos laborales', 'solo si el FE pidió /employment-info', async () => {
                if (!/\/employment-info(\?|$)/.test(page.url())) return 'omitido (no aplica)';
                await fillEmploymentInfo(page);
                await page.waitForURL(/\/lenders(\?|$)/, { timeout: 20_000 });
                return 'empleo registrado';
            })
            .step('Aterrizaje en /lenders', 'captura loanRequestId de la URL', async (ctx) => {
                const loanRequestId = page.url().match(/\/(\d+)\/lenders/)?.[1] ?? '';
                ctx.set('loanRequestId', loanRequestId);
                return `loanRequestId ${loanRequestId} · /lenders`;
            });
    },
};

// ── MATRIZ COMERCIO → PRESETS ───────────────────────────────────────────────
// Los comercios que comparten (channel, wizard) APUNTAN AL MISMO preset; el composer
// no duplica nada. Para un comercio con flujo único, basta agregar su fila aquí.
//
// SmartPay queda FUERA del composer: su wizard `request-amount → request-phone →
// request-otp → request-personal-info → request-financial-info` no comparte pantallas
// con el wizard estándar; vive en su propio spec (merchant/smartpay-dynamic.spec.ts).
const merchantSpecs: Record<string, MerchantSpec> = {
    pullman:         { channel: 'self-service',     wizard: 'standard' },
    corbeta:         { channel: 'self-service',     wizard: 'standard' },
    credifamilia:    { channel: 'self-service',     wizard: 'standard' },
    'cupo-rotativo': { channel: 'self-service',     wizard: 'standard' },
    motai:           { channel: 'merchant-cognito', wizard: 'standard' },
};

const norm = (s: string): string => s.toLowerCase().replace(/-/g, '');
const resolveMerchantSpec = (alias?: string): MerchantSpec | undefined => {
    if (!alias) return undefined;
    const want = norm(alias);
    for (const [k, v] of Object.entries(merchantSpecs)) {
        if (norm(k) === want) return v;
    }
    return undefined;
};

export interface ComposeArgs {
    page: Page;
    partnerHash: string;
    /** Alias del comercio para resolver el spec en la matriz (preferido sobre channel). */
    merchant?: string;
    /** Override directo de canal — útil si `merchant` no está en la matriz. */
    channel?: ChannelKey;
    /** Alias del lender (solo para nombrar el Flow; lender close steps NO se enchufan todavía). */
    lender?: string;
    options?: ComposeOptions;
    /** Override del nombre del Flow (default: ejes concatenados con ' → '). */
    flowName?: string;
    /** Override del resumen del Flow (default: 'channel + wizard · partner X'). */
    summary?: string;
}

/**
 * Devuelve `{flow, ctx}` listo para `await flow.run(ctx)`. Después de correr, el `ctx`
 * tiene `phone` y `loanRequestId` (los pone el preset del wizard). El nombre del Flow
 * se arma con los ejes provistos para que la consola identifique la combinación.
 *
 * Resolución del spec (orden):
 *   1) `merchant` → busca en `merchantSpecs` (la matriz). Recomendado.
 *   2) `channel` explícito → usa ese canal + wizard standard.
 *   3) default → self-service + standard.
 */
export function composeFlow(args: ComposeArgs): { flow: Flow; ctx: Ctx } {
    const { page, partnerHash, options = {} } = args;
    const spec: MerchantSpec =
        resolveMerchantSpec(args.merchant) ??
        { channel: args.channel ?? 'self-service', wizard: 'standard' };

    const nameParts = [args.channel, args.merchant, args.lender].filter(Boolean);
    const name = args.flowName ?? (nameParts.length ? nameParts.join(' → ') : `partner ${partnerHash}`);
    const summary = args.summary ?? `${spec.channel} + ${spec.wizard} · partner ${partnerHash}`;
    const f = new Flow(name, summary);
    const ctx = new Ctx();

    channels[spec.channel](f, page, partnerHash, options);
    wizards[spec.wizard](f, page, partnerHash, options);

    return { flow: f, ctx };
}
