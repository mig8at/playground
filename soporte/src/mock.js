// ============================================================================
// DATOS MOCK (Fase 0) — NO tocan producción. Casos inspirados en #tech-ops,
// con cédulas enmascaradas. En Fase 1 esto lo reemplaza un endpoint de tracing
// que arma el timeline real desde: user_requests + user_request_records +
// risk_central_user_data + displayed_lenders + preapproval_attempts (DynamoDB).
// ============================================================================

// Etapas canónicas del flujo (la "tubería"). Cada intento reporta el estado de cada una.
export const STAGES = [
  { id: 'registro',   label: 'Registro + OTP',        hint: 'Alta de celular y validación OTP' },
  { id: 'formulario', label: 'Formulario',            hint: 'Datos personales y laborales' },
  { id: 'buro',       label: 'Burós',                 hint: 'Datacrédito / KYC' },
  { id: 'listado',    label: 'Listado / pre-aprob.',  hint: 'Entidades ofrecidas al cliente' },
  { id: 'seleccion',  label: 'Selección',             hint: 'El cliente elige una entidad' },
  { id: 'cupo',       label: 'Cupo / punto de venta', hint: 'Cupo real y condiciones' },
  { id: 'desembolso', label: 'Desembolso',            hint: 'Originación y voucher' },
]

// status por etapa: ok (verde) · warn (ámbar) · fail (rojo) · skip (no alcanzada)
// Cada intento: outcome (aprobado|roto|abandonado) + brokeAt (id de la etapa que rompió)
export const CASES = {
  // ── Caso 1: preaprobado en app, cupo 0 en el punto de venta (crédito activo) ──
  '1032424008': {
    nombre: 'Cliente 1032•••008',
    intentos: [
      {
        id: 'UR-8842', fecha: '2026-05-07 15:16', comercio: 'Dentix', sucursal: 'Plaza de las Américas',
        producto: 'CreditopX', monto: 1200000, outcome: 'roto', brokeAt: 'cupo',
        stages: {
          registro:   { status: 'ok', detail: 'OTP validado a las 15:10' },
          formulario: { status: 'ok', detail: 'Datos personales y laborales completos' },
          buro:       { status: 'ok', detail: 'Datacrédito consultado · score 612' },
          listado:    { status: 'ok', detail: '2 entidades mostradas al cliente en la app', lenders: [
            { name: 'Dentix (DFS)', rt: 2, verdict: 'ok',    reason: 'Preaprobado mostrado en la app (aún no re-validado)' },
            { name: 'Welli',        rt: 1, verdict: 'error', stage: 'api_call', reason: 'Timeout consultando su API (upstream_timeout)' },
          ] },
          seleccion:  { status: 'ok', detail: 'El cliente eligió Dentix (DFS)' },
          cupo:       { status: 'fail', detail: 'Cupo calculado: $0', faq: 'A1',
            reason: 'El cliente YA tiene un crédito CreditopX activo → la compuerta active_credit excluye el cupo. En la app veía un preaprobado porque esa validación no se re-corre hasta el punto de venta.' },
          desembolso: { status: 'skip', detail: 'No se alcanzó' },
        },
      },
      {
        id: 'UR-8790', fecha: '2026-05-02 10:03', comercio: 'Dentix', sucursal: 'Plaza de las Américas',
        producto: 'CreditopX', monto: 900000, outcome: 'abandonado', brokeAt: 'formulario',
        stages: {
          registro:   { status: 'ok', detail: 'OTP validado a las 10:01' },
          formulario: { status: 'warn', detail: 'Quedó a medias', faq: 'G1',
            reason: 'El cliente no completó el formulario laboral; la solicitud queda reciclable y el usuario ya existe (por eso luego aparece "ya creado").' },
          buro:       { status: 'skip' }, listado: { status: 'skip' }, seleccion: { status: 'skip' },
          cupo:       { status: 'skip' }, desembolso: { status: 'skip' },
        },
      },
    ],
  },

  // ── Caso 2: recorrido completo aprobado (agregador rt=1, Bancolombia) ──
  '1000637753': {
    nombre: 'Cliente 1000•••753',
    intentos: [
      {
        id: 'UR-9120', fecha: '2026-06-18 12:40', comercio: 'Tripleten', sucursal: 'Venta asistida',
        producto: 'Agregador', monto: 3500000, outcome: 'aprobado', brokeAt: null,
        stages: {
          registro:   { status: 'ok', detail: 'OTP validado a las 12:35' },
          formulario: { status: 'ok', detail: 'Datos personales y laborales completos' },
          buro:       { status: 'ok', detail: 'Datacrédito consultado · score 705' },
          listado:    { status: 'ok', detail: '3 entidades mostradas', lenders: [
            { name: 'Bancolombia', rt: 1, verdict: 'ok',   reason: 'Preaprobado por su API · cupo $3.500.000' },
            { name: 'Welli',       rt: 1, verdict: 'lowp', reason: 'Probabilidad baja (no excluye, queda al fondo)' },
            { name: 'Prami',       rt: 1, verdict: 'ok',   reason: 'Preaprobado por su API' },
          ] },
          seleccion:  { status: 'ok', detail: 'El cliente eligió Bancolombia' },
          cupo:       { status: 'ok', detail: 'Cupo $3.500.000 confirmado por su API' },
          desembolso: { status: 'ok', detail: 'Originado · voucher generado' },
        },
      },
    ],
  },

  // ── Caso 3: lender desembolsó pero el estado no sincronizó (webhook) ──
  '98137181': {
    nombre: 'Cliente 98•••181',
    intentos: [
      {
        id: 'UR-9333', fecha: '2026-07-11 11:05', comercio: 'Credimovil', sucursal: 'Principal',
        producto: 'Agregador', monto: 1500000, outcome: 'roto', brokeAt: 'desembolso',
        stages: {
          registro:   { status: 'ok', detail: 'OTP validado a las 11:00' },
          formulario: { status: 'ok', detail: 'Datos completos' },
          buro:       { status: 'ok', detail: 'Datacrédito consultado · score 640' },
          listado:    { status: 'ok', detail: '2 entidades mostradas', lenders: [
            { name: 'Prami',    rt: 1, verdict: 'ok', reason: 'Preaprobado por su API' },
            { name: 'Meddipay', rt: 1, verdict: 'ok', reason: 'Preaprobado por su API' },
          ] },
          seleccion:  { status: 'ok', detail: 'El cliente eligió Prami' },
          cupo:       { status: 'ok', detail: 'Cupo confirmado por su API' },
          desembolso: { status: 'warn', detail: 'Estado sigue "en proceso"', faq: 'D1',
            reason: 'Prami confirmó el desembolso pero CreditOp no cambió el estado: el webhook lender-result no llegó / falló (es best-effort). Por eso no genera voucher ni aparece "gestionar".' },
        },
      },
    ],
  },

  // ── Caso 4: preaprobado en app, no viable en el POS (no pasa reglas de la sucursal) ──
  '1000218988': {
    nombre: 'Cliente 1000•••988',
    intentos: [
      {
        id: 'UR-9012', fecha: '2026-04-28 15:30', comercio: 'Amoblando Pullman', sucursal: 'CC Florida Parque',
        producto: 'CreditopX', monto: 2500000, outcome: 'roto', brokeAt: 'cupo',
        stages: {
          registro:   { status: 'ok', detail: 'OTP validado a las 15:25' },
          formulario: { status: 'ok', detail: 'Datos completos' },
          buro:       { status: 'ok', detail: 'Datacrédito consultado · score 548' },
          listado:    { status: 'ok', detail: 'CrediPullman mostrado como preaprobado', lenders: [
            { name: 'CrediPullman', rt: 2, verdict: 'ok', reason: 'Preaprobado mostrado en la app' },
          ] },
          seleccion:  { status: 'ok', detail: 'El cliente eligió CrediPullman' },
          cupo:       { status: 'fail', detail: 'No viable en el punto de venta', faq: 'A1',
            reason: 'En el POS corre la 2ª capa (reglas de la sucursal + datacrédito): el cliente no pasa el score mínimo de esa sucursal (548 < 550). El preaprobado de la app no incluía esa validación.' },
          desembolso: { status: 'skip' },
        },
      },
    ],
  },

  // ── Caso 5: OTP correcto que rebota (corta al inicio) ──
  '1002959408': {
    nombre: 'Cliente 1002•••408',
    intentos: [
      {
        id: 'UR-9401', fecha: '2026-07-10 09:38', comercio: 'Dentix', sucursal: 'Bucaramanga',
        producto: 'CreditopX', monto: 800000, outcome: 'roto', brokeAt: 'registro',
        stages: {
          registro:   { status: 'fail', detail: 'OTP correcto pero rebota', faq: 'E1',
            reason: 'El código es correcto y aun así no deja pasar. Síntoma típico de timeout del wizard o pérdida de sesión al validar. Requiere reproducir (no es entrega: el SMS sí llegó).' },
          formulario: { status: 'skip' }, buro: { status: 'skip' }, listado: { status: 'skip' },
          seleccion:  { status: 'skip' }, cupo: { status: 'skip' }, desembolso: { status: 'skip' },
        },
      },
    ],
  },
}

// Cédulas de ejemplo para los "chips" de acceso rápido en la UI del demo.
export const SAMPLE_IDS = Object.keys(CASES)
