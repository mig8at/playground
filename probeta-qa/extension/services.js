// LO QUE PROBETA-QA LEE FUERA DEL NAVEGADOR, sin claves:
//   · el OTP: el servicio de OTP de dev/qa lo expone en dos lecturas de auditoría (`POST /api/otp/latest` y
//     `/api/otp/decrypt`, sin autenticación). Es interno: se llega con la VPN de dev. Es lo mismo que se copia de Slack
//     (#qa-messages), donde lo publica el servicio de mensajes en modo QA.
//   · el servidor de Probeta (opcional): un programa en `localhost` con la conexión a la base de qa de cada persona. Suma la
//     base de la solicitud, comprobar que la cédula esté libre y aprobar la identidad. Su contrato, en el README.

export const OTP_SERVICE = 'http://otp-service.inertia-develop:8083';
export const DEFAULT_SERVER = 'http://localhost:5230';

const post = async (url, body, ms = 8000) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

/** El último OTP del celular: `{ code, at }`, o `{ code: null }` si todavía no se generó. Tira si no hay VPN. */
export async function latestOtp(phone) {
  const last = await post(`${OTP_SERVICE}/api/otp/latest`, { identifier: phone });
  if (last.status === 404 || !last.json?.created_at) return { code: null };
  const dec = await post(`${OTP_SERVICE}/api/otp/decrypt`, { identifier: phone, created_at: last.json.created_at });
  return { code: dec.json?.code ? String(dec.json.code) : null, at: last.json.created_at };
}

/** ¿Se llega al servicio de OTP? Un celular que no existe contesta 404: eso ya es «se llega». */
export async function otpAlive() {
  try { const r = await post(`${OTP_SERVICE}/api/otp/latest`, { identifier: '3000000000' }, 6000); return { ok: true, detail: `contesta (${r.status})` }; }
  catch (e) { return { ok: false, detail: /timeout|abort/i.test(e.message) ? 'no contesta: ¿VPN de dev?' : 'no se llega: ¿VPN de dev?' }; }
}

/** El servidor de Probeta: `GET/POST <server>/api/<path>`. Tira si no contesta. */
export async function server(base, path, body) {
  const r = await fetch(`${base.replace(/\/$/, '')}/api${path}`, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }
    : { signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.detail) throw new Error(j.error || `el servidor contestó ${r.status}`);
  return j;
}

/** El estado del servidor: `{ ok, pieces: [{ name, ok, detail }] }`. Sin servidor, `ok: false` y por qué. */
export async function serverHealth(base) {
  if (!base) return { ok: false, detail: 'sin configurar', pieces: [] };
  try {
    const h = await server(base, '/health');
    return { ok: !!h.ok, detail: h.ok ? 'contesta' : (h.detail || 'contesta con problemas'), pieces: h.pieces || [] };
  } catch (e) { return { ok: false, detail: `no contesta en ${base}`, pieces: [] }; }
}

// UNA PERSONA NUEVA, inventada acá: dos nombres del mismo género y dos apellidos colombianos comunes, sin tildes ni Ñ (el
// nombre se le dicta a las centrales y el KYC lo compara letra por letra con lo escrito). Sin el servidor no se puede
// comprobar que la cédula esté libre: con 10 millones de cédulas posibles, chocar con otra prueba es muy raro.
const MALE = ['ANDRES', 'CARLOS', 'JUAN', 'SANTIAGO', 'SEBASTIAN', 'DANIEL', 'ALEJANDRO', 'DIEGO', 'FELIPE', 'JORGE', 'LUIS',
  'MIGUEL', 'CAMILO', 'NICOLAS', 'DAVID', 'JULIAN', 'MATEO', 'OSCAR', 'RICARDO', 'FERNANDO'];
const FEMALE = ['MARIA', 'LAURA', 'ANDREA', 'CAROLINA', 'NATALIA', 'PAOLA', 'DANIELA', 'VALENTINA', 'CAMILA', 'JULIANA',
  'ALEJANDRA', 'CATALINA', 'DIANA', 'SANDRA', 'LILIANA', 'MONICA', 'ADRIANA', 'PAULA', 'SOFIA', 'MARCELA'];
const LAST = ['RODRIGUEZ', 'GOMEZ', 'GONZALEZ', 'MARTINEZ', 'GARCIA', 'LOPEZ', 'HERNANDEZ', 'SANCHEZ', 'RAMIREZ', 'PEREZ', 'DIAZ',
  'TORRES', 'ROJAS', 'VARGAS', 'MORENO', 'GUTIERREZ', 'JIMENEZ', 'CASTRO', 'RUIZ', 'ALVAREZ', 'ROMERO', 'SUAREZ', 'MEJIA',
  'RESTREPO', 'OSORIO', 'CARDENAS', 'OSPINA', 'ARIAS', 'CASTILLO', 'RIVERA', 'SALAZAR', 'CORTES', 'HERRERA', 'MEDINA',
  'AGUDELO', 'GIRALDO', 'VELASQUEZ', 'QUINTERO', 'BETANCUR', 'ZAPATA'];
const rand = (n) => Math.floor(Math.random() * n);
const two = (xs) => { const a = rand(xs.length); let b = rand(xs.length - 1); if (b >= a) b++; return `${xs[a]} ${xs[b]}`; };

export function inventPerson() {
  const doc = '109' + String(rand(1e7)).padStart(7, '0');
  const phone = '31' + String(rand(1e8)).padStart(8, '0');
  return { doc, phone, firstName: two(Math.random() < 0.5 ? MALE : FEMALE), lastName: two(LAST), email: `ext.prueba+${doc}@creditop.com` };
}
