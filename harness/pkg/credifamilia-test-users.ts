import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// LOS CLIENTES DE PRUEBA QUE ENTREGÓ CREDIFAMILIA. Su QA aprueba o niega a estas personas por cédula, así
// que un cliente sintético cualquiera (la cédula de la corrida) no sirve para llegar a un «aprobado» real:
// la pre-aprobación devuelve «Fallo en el análisis - Listas restrictivas». Los datos viven en
// `harness/lender/credifamilia-usuarios-de-prueba.json`; se piden con `cliente=<cédula>` en un caso.
export interface CredifamiliaTestUser {
    documento: string;
    nombres: string;
    apellidos: string;
    nacimiento: string;      // ISO yyyy-mm-dd
    ocupacion: string;
    ingresoDesde: string;    // ISO
    correo: string;
    celular: string;
    otpInicial: string;
    otpFirma: string | null;
    resultado: 'aprobado' | 'negado';
}

const FILE = fileURLToPath(new URL('../lender/credifamilia-usuarios-de-prueba.json', import.meta.url));

export function credifamiliaTestUsers(file: string = FILE): CredifamiliaTestUser[] {
    return (JSON.parse(readFileSync(file, 'utf8')) as { usuarios: CredifamiliaTestUser[] }).usuarios;
}

/** Busca por cédula. Lanza con la lista de las que existen: una cédula mal escrita no debe caer a la sintética. */
export function credifamiliaTestUser(documento: string, users: CredifamiliaTestUser[] = credifamiliaTestUsers()): CredifamiliaTestUser {
    const u = users.find((x) => x.documento === documento.trim());
    if (!u) throw new Error(`cliente de prueba «${documento}» no está en la lista de Credifamilia (${users.map((x) => x.documento).join(', ')})`);
    return u;
}

/** Partes de la fecha ISO para el formulario de personal-info (día, mes, año). */
export function dateParts(iso: string): { day: number; month: number; year: number } {
    const [y, m, d] = iso.split('-').map(Number);
    return { day: d, month: m, year: y };
}
