// Compatibilidad de los runners: el conector de asesor posee login, estado y renovación.
import { advisorSession } from '../../connectors/advisor/session.ts';
import { config } from './config.ts';
import { TARGET } from './env.ts';
// La cuenta: el asesor de prueba del COMERCIO de la corrida (`c<hash>-fake@`), que resuelve `bin/advisor` y
// exporta en `E2E_ADVISOR_ACCOUNT`; entra con la clave compartida del ambiente (`connectors/`). Sin ella, la
// cuenta de la persona configurada en el conector.
export const ADVISOR_ACCOUNT = process.env.E2E_ADVISOR_ACCOUNT?.trim() || undefined;
const session = advisorSession(TARGET, config.feBaseUrl, ADVISOR_ACCOUNT);
export const COGNITO_STATE_PATH = session.path;
export const cognitoStorageState = session.storageState;
export const cognitoLogin = session.login;
export const persistCognitoState = session.persist;
export const sessionHealth = session.sessionHealth;
export const refreshSession = session.refreshSession;
export const renewSession = session.renewSession;
export { cookiesHealth, type SessionHealth } from '../../connectors/advisor/health.ts';
import type { SessionHealth } from '../../connectors/advisor/health.ts';
export function howToRenewSession(s: SessionHealth): string {
    return `${s.motivo}\n     entra con: make harness-login TARGET=${TARGET} (abre una ventana)`;
}
