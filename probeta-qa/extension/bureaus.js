// LAS CENTRALES DE QA, dictadas desde el navegador. El backend de qa le pregunta a Ágil Data y a Experian a un lambda de
// mocks de la empresa (risk-services-mockery-lambda, un Mockoon con su API de administración prendida): se le PIDE de
// antemano qué contestar para una cédula (`POST /mockoon-admin/global-vars`) y después el flujo corre normal. El lambda es
// público y su token (`mock-admin`) también: Mockoon no arranca la API de administración sin uno. No hay secretos acá.
//
// Es la misma lógica que usa el harness de my-tools para qa (`harness/pkg/risk-lambda.ts`, `dictateCompanyLambda`),
// copiada para que la extensión ande sola. Si una cambia, la otra también.
//
// ⚠ El lambda es serverless y lo dictado vive en la memoria de CADA contenedor: un POST llega a uno solo. Por eso se dicta
// varias veces a la vez y se confirma leyendo varias veces a la vez (`spread`); hasta que todas las lecturas contestan lo
// dictado, no se da por hecho.
// ⚠ En qa sólo se dicta «contesta»: una central vacía o caída es cosa del mock local del harness, no de este lambda.

export const LAMBDA_QA = 'https://9b6r8ticg0.execute-api.us-east-2.amazonaws.com/development';

/** Lo que no se dice va así: un cliente que aprueba (el mismo de la consola del harness). */
export const DEFAULTS = { income: 2500000, occupation: 'Empleado', months: 13, score: 700, consulted: 1, creditCards: 1,
  delinquencies: 0, negatives: 0, maturationSince: '2015-01-01' };

const timeout = (ms) => AbortSignal.timeout(ms);

/** Escribe lo que la central contesta para esa cédula. */
async function dictate(base, doc, central, value) {
  const r = await fetch(`${base}/mockoon-admin/global-vars`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-admin' },
    body: JSON.stringify({ key: `${central}_${doc}`, value: JSON.stringify(value) }), signal: timeout(25000),
  }).catch(() => null);
  return !!r?.ok;
}

/** La respuesta de Ágil Data: un empleo con `periods` pagos mensuales hasta este mes. El EMPLEADOR decide la ocupación:
 *  si es la misma persona, el backend la toma como Independiente; si no, Empleado. El período es `YYYYMM` contado en
 *  meses (restarle 1 a 202601 no da diciembre). */
export function agildataAnswer(doc, ibc, occupation, periods, name) {
  const today = new Date();
  const payments = Array.from({ length: periods }, (_, k) => {
    const months = today.getFullYear() * 12 + today.getMonth() - k;
    const y = Math.floor(months / 12), mm = String((months % 12) + 1).padStart(2, '0');
    return { id: k + 1, ibc, periodo: Number(`${y}${mm}`), fechaPago: `${y}-${mm}-15 00:00:00`, diasCotizados: 30,
      valorCotizacionObligatoria: Math.round(ibc * 0.115) };
  });
  return {
    usuario: null, codRespuesta: '01', observaciones: 'Consulta Exitosa.', codConsulta: 14744568681490196,
    respuesta: {
      type: 'aorg.asofondos.agildata.domain.AfiliadoDetalladoa', fechaVinculacion: null,
      datosBasicos: { edad: 25, type: 'org.asofondos.agildata.domain.AfiliadoDatosBasicos', genero: 'M', nombre: name, tipoId: 'CC', numeroId: doc, viabilidad: null },
      detalladoEmpleos: [{ id: 1, pagos: payments,
        nombreEmpleador: String(occupation || '').toLowerCase() === 'independiente' ? name : 'STANGERSON SAS',
        telefonoEmpleador: null, direccionEmpleador: null, identifiacionEmpleador: '900101010', tipoIdentifiacionEmpleador: 'NI' }],
    },
  };
}

const HDCPLUS = '/experian/cs/credit-history/v1/hdcplus';
const hdcplus = (base, doc) => fetch(`${base}${HDCPLUS}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifyingUser: { person: { personId: { personIdNumber: doc } } } }), signal: timeout(25000),
}).then((r) => (r.ok ? r.json() : null)).catch(() => null);

/** Una tarjeta activa con la forma que leen las categorías de la entidad. */
const activeCard = (i) => ({
  idNumber: `CC-SYNTH-${i + 1}`,
  status: { account: { businessAccountStatus: '01' }, payment: { businessBureauEvent: '01' } },
  creditCardAccount: { businessBehaviourVectorProduct: 'NNNNNNNNNNNN' },
  values: [{ availableBalance: 1000, debtBalance: 0, valueMonthlyPayment: 0 }],
});

/** Dicta `writes` veces a la vez y lee `reads` veces a la vez, hasta `rounds` rondas. Una lectura que no contesta (null) no
 *  cuenta; queda dictado cuando ninguna contesta otra cosa y al menos la mitad contestó. */
async function spread(write, read, { writes = 12, reads = 12, rounds = 6 } = {}) {
  let hits = 0, answered = 0;
  for (let round = 1; round <= rounds; round++) {
    await Promise.all(Array.from({ length: writes }, () => write().catch(() => false)));
    const got = await Promise.all(Array.from({ length: reads }, () => read().catch(() => null)));
    answered = got.filter((g) => g !== null).length;
    hits = got.filter((g) => g === true).length;
    if (hits === answered && answered * 2 >= reads) return { ok: true, hits, reads: answered };
  }
  return { ok: false, hits, reads: answered };
}

/**
 * Le dicta al lambda de qa el empleo (Ágil Data) y el buró (Experian) de ESA cédula, con el nombre de la persona. Experian
 * sólo sirve un reporte entero (~250 KB): se le pide el suyo, se le cambia lo que miran las categorías y se le dicta de
 * vuelta. Devuelve `{ ok, lines }`, una línea por central.
 */
export async function dictateQa(doc, c, base = LAMBDA_QA) {
  const k = { ...DEFAULTS, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== '' && !Number.isNaN(v))) };
  k.months = Math.min(k.months, 24);
  const lines = [];

  const agilPath = `${base}/agildata/agildata-services/rest/afiliado/historicoDetalladoEmpleo/CC/${doc}`;
  const agil = await spread(
    () => dictate(base, doc, 'agildata', agildataAnswer(doc, k.income, k.occupation, k.months, k.name)),
    async () => { const t = await fetch(agilPath, { signal: timeout(15000) }).then((x) => (x.ok ? x.text() : null)).catch(() => null);
      return t === null ? null : t.includes(k.name) && t.includes(String(k.income)); });
  lines.push(agil.ok ? `Ágil Data ✓ ${k.occupation} · ${k.income} · ${k.months} meses` : `Ágil Data ✗ ${agil.hits}/${agil.reads} lecturas con lo dictado`);

  let report = null;
  for (let i = 0; i < 4 && !report; i++) {
    const got = await hdcplus(base, doc);
    const r = got?.ReportHDCplus;
    if (!r?.models?.[0] || !r.agregatedInfo?.overview?.principals) continue;
    r.models[0].scoreValue = k.score;
    Object.assign(r.agregatedInfo.overview.principals, { consultedLast6Months: k.consulted, currentNegativeCredits: k.delinquencies,
      negativeHistoricalLast12Months: k.negatives, maturationSince: k.maturationSince });
    r.creditCard = Array.from({ length: Math.min(k.creditCards, 10) }, (_, j) => activeCard(j));
    // Quanto (el ingreso estimado) sale del mismo reporte: los productCode 62, en miles.
    const quanto = (r.productValueList?.[0] ?? []).filter((p) => Number(p.productCode) === 62);
    const avg = Math.round(k.income / 1000);
    [avg, Math.round(avg * 0.7), Math.round(avg * 1.3)].forEach((v, j) => { if (quanto[j]) quanto[j].value = v; });
    report = got;
  }
  const exp = report
    ? await spread(() => dictate(base, doc, 'experian', report), async () => {
      const back = await hdcplus(base, doc);
      if (!back) return null;
      const r = back.ReportHDCplus;
      return r?.models?.[0]?.scoreValue === k.score && r?.agregatedInfo?.overview?.principals?.consultedLast6Months === k.consulted;
    }, { writes: 4, reads: 4 })
    : { ok: false, hits: 0, reads: 0 };
  lines.push(exp.ok ? `Experian ✓ score ${k.score} · ${k.consulted} consulta(s) · moras ${k.negatives}`
    : report ? `Experian ✗ ${exp.hits}/${exp.reads} lecturas con lo dictado` : 'Experian ✗ no pude leer su reporte');
  return { ok: agil.ok && exp.ok, lines };
}

/** ¿Contesta el lambda? Para el chequeo de ⚙. */
export async function lambdaAlive(base = LAMBDA_QA) {
  try {
    const r = await fetch(`${base}/agildata/agildata-services/rest/afiliado/historicoDetalladoEmpleo/CC/1`, { signal: timeout(10000) });
    return { ok: r.ok, detail: r.ok ? 'contesta' : `contestó ${r.status}` };
  } catch (e) { return { ok: false, detail: `no contesta (${e.message})` }; }
}
