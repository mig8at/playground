// caso.ts — UN CASO HIPOTÉTICO de punta a punta: decís comercio y entidad, y corre.
//
//   node dev/caso.ts --comercio pullman --lender 77
//   node dev/caso.ts --casos 'pullman;pullman' --paralelo
//   node dev/caso.ts --casos 'pullman@score=700;pullman@score=300,income=900000' --paralelo
//   node dev/caso.ts --casos 'pullman:77;pullman:9' --paralelo
//   node dev/caso.ts --comercio pullman --lender 77 --amount 3000000 --income 1200000 --score 520
//
// QUÉ CORRE: siembra la solicitud en ese comercio, le inyecta datos de riesgo, pide el LISTADO, y
// después SELECCIONA la entidad pedida y clasifica la conducta que devuelve el backend (standBy /
// modal de autogestión / redirect externo / OTP del lender / error). O sea: de cero hasta el punto en
// que el flujo se bifurca por entidad.
//
// ⚠ EL TELÉFONO ES POR CASO, Y ESA ES LA CONDICIÓN DEL PARALELO. Los runners que ya existían
// (`sweep.ts`, `qr-corbeta.ts`, `listado.ts`) comparten el fijo `3131010101` y arrancan llamando a
// `scrubphone`, que **borra todos los usuarios con ese teléfono**. Dos corridas simultáneas se
// borran la una a la otra a mitad de vuelo, y el síntoma no se parece a la causa: la que pierde
// falla más adelante con un 404 o un 500 raro, en un paso que no tiene nada que ver. Acá cada caso
// deriva el suyo del índice, así que no hay dos corridas mirando el mismo usuario.
//
// ⚠ Y POR ESO MISMO `--paralelo` NO es «lo mismo pero más rápido»: cambia qué se puede afirmar. En
// serie, un fallo puede venir de basura que dejó el caso anterior; en paralelo, cada caso tiene su
// usuario y sus solicitudes. Si dos casos se pisan igual, es que comparten algo REAL (un lock de
// comercio, un cupo, un asesor) — y eso es justo lo que uno quiere descubrir.
//
// EL CASO COMPLETO, con `--cerrar`: buró dictado → listado → integración del proveedor dictada →
// pre-aprobación (la que haría el front) → SELECCIÓN del lender CreditopX del comercio y cierre hasta
// estado 11. Si el comercio no tiene rt=2, el caso cierra BIEN diciendo «sin CreditopX»: es un hecho
// del comercio y no un fallo — contarlo como error haría ver rota la mitad del catálogo. Medido:
// Pullman cierra en 11; automarquet, kreditkasa y godentist no tienen CreditopX.
// ⚠ Cerrar cuesta: ~90s por caso contra ~6s hasta el listado. Para barrer muchos comercios conviene
// no pedirlo, y reservarlo para los que se quieren probar de punta a punta.
//
// EL CATÁLOGO ENTERO, medido el 2026-08-22 — 223 comercios (una sucursal por comercio, la de más
// entidades, direccionada por `#hash`), en 8 tandas de 30 en paralelo, ~12 minutos:
//
//     214  ofrecen al menos una entidad     (mediana 3 · máximo 12)
//       6  ofrecen CERO — y no todos por lo mismo:
//            · Crediteame  → su ÚNICA entidad tiene `status=0`. Cero legítimo.
//            · CeluRD Test → una de sus dos entidades es `country_id=60`. Filtro de país.
//            · Vtex, TIENDAS JOSH, Credicesar, Smart Academia → SIN explicar todavía.
//       2  rotos por F-143 (`sort on null`): Creditop y PARQUE SALITRE MÁGICO
//       1  pide ESTRATO (`STRATUM_REQUIRED`) en personal-info, que este runner no manda
//
// ⚠ «Cero entidades» NO es lo mismo que «falló», y el runner los mezcla: marca ✗ cuando la lista
// viene vacía. Seis de los nueve «fallos» de arriba son listados que CORRIERON BIEN. Vale la pena
// separarlos si esto se usa para vigilar el catálogo.
//
// ESCALA MEDIDA (2026-08-18, contra el backend local en Docker):
//     10 casos → 29s     20 → 60s     30 → 90s
// Crece LINEAL, así que el cuello es el backend y no el runner: no hay paralelismo real del lado del
// servidor, pero tampoco degradación. Y lo que importa, la CORRECCIÓN aguanta: a 30 en paralelo los
// dos controles devolvieron su listado conocido, idéntico al de la corrida de a uno.
//     pullman     [77, 100, 39, 68, 6, 9, 32]
//     kreditkasa  [68, 6, 5, 41, 7, 29, 17, 30, 31, 16, 19, 34]
// A 30 fallaron 3 de 30, y los TRES por F-142 (Credifamilia con host nulo se lleva el listado entero).
// Ninguno fue carrera.
//
// VALIDADO A 10 EN PARALELO (2026-08-18). Tres rondas de 10 casos simultáneos con comercios
// distintos, más dos fijos de control en las tres. 28 de 29 cerraron, ~31s por ronda, y los dos
// controles devolvieron el listado **idéntico** en las tres rondas:
//     pullman     [77, 100, 39, 68, 6, 9, 32]
//     kreditkasa  [68, 6, 5, 41, 7, 29, 17, 30, 31, 16, 19, 34]
// O sea que correr diez a la vez no altera el resultado de ninguno. El único fallo (`orthoarte`)
// **también falla corriéndolo solo**: es un comercio roto en local por F-142, no una carrera. Esa
// distinción —volver a correr el caso SOLO— es la que separa un hallazgo de un artefacto, y conviene
// hacerla siempre antes de reportar un fallo de una corrida paralela.
//
// Gotchas heredados, que acá aplican igual: `E2E_TARGET` default es dev → se fuerza local · UA de
// iPhone SIEMPRE (con UA de escritorio, 403) · en `main` sin `H2O_API_HOST` el listado da 500.

// ⚠ Marca de MÓDULO. Al sacar el último `import` estático, node pasó a leer este archivo como CJS y
// `await` de nivel superior dejó de ser válido (lo delató `node --check`). Un `export {}` vacío
// alcanza y no cambia nada más.
export {};

process.env.E2E_TARGET ||= 'local';
process.env.CFE_TARGET ||= 'local';

const { execFile } = await import('node:child_process');
// El desenlace que llega de afuera (rt=0 y rt=1) vive en `pkg/`: lo usan este runner y el panel, y dos
// definiciones de «cómo contesta una entidad» derivarían hacia estados distintos.
const { webhookIntegracion, webhookSelfManager, WELLI_IDS, ESTADOS_WEBHOOK, APP_VIEJA } =
    await import('../pkg/webhook-entidad.ts');
const { one, query, exec, close } = await import('../pkg/db.ts');
const { synthFill } = await import('../pkg/inject.ts');
const { config: e2eConfig } = await import('../pkg/config.ts');
const { appKey } = await import('../pkg/db.ts');
const { encryptLaravelString } = await import('../pkg/laravel-crypt.ts');
const { forenseAlCerrar } = await import('../pkg/loki.ts');

const API = e2eConfig.mockUrl;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

// La lambda de mocks de la empresa. Su `enableAdminApi: true` es TODO el mecanismo: se le PIDE de
// antemano qué tiene que contestar para una cédula (`POST /mockoon-admin/global-vars`) y después el
// flujo corre normal. No hace falta ningún fixture: la respuesta se pide, no se inyecta.
// ⚠ POR DEFECTO, EL MOCK LOCAL — no el lambda de la empresa. El lambda hace lo mismo pero es
// infraestructura de OTRO: a mitad de sesión lo redesplegaron, dejó de honrar lo dictado y empezó a
// devolver datos aleatorios con períodos viejos (F-149). Y además es serverless, así que dictar en
// paralelo pierde escrituras (F-139). El local es un proceso, responde en milisegundos y el estado es
// compartido. Mismo contrato: para volver al lambda alcanza con `RISK_LAMBDA_URL=<su url>`.
const LAMBDA = process.env.RISK_LAMBDA_URL ?? 'http://localhost:8105';


// El mock de integraciones de entidades (`mock-lenders`), donde se dicta qué contesta cada proveedor.
const MOCK_LENDERS = process.env.MOCK_LENDERS_URL ?? 'http://localhost:8099';
/** Los dos externos de Credifamilia (rt=4). El backend los ve por `host.docker.internal`; este runner
 *  corre fuera de Docker, así que acá van por `localhost` — misma caja, otra puerta. */
const DECEVAL = process.env.MOCK_DECEVAL_URL || 'http://localhost:8106/';
const NETCO = process.env.MOCK_NETCO_URL || 'http://localhost:8107/';
const CREDIFAMILIA = process.env.MOCK_CREDIFAMILIA_URL || 'http://localhost:8108/';



// El microservicio de PRE-APROBADOS. Lo llama el FRONT, no el backend (F-141), así que una corrida
// por API lo saltea sin fallar: el listado se ve completo y la etapa no ocurrió. Acá se REPLICA esa
// llamada para poder validarla sin levantar el wizard.
// ⚠ la ruta va COMPLETA: `VITE_PREAPPROVALS_ENDPOINT` del wizard es una URL con path
// (`…:8082/v1/preapprovals/check`), no un host. Apuntando sólo al host, el mock responde 404 a todo
// y las cinco consultas «fallan» por una razón que no tiene nada que ver con el negocio.
const PREAPPROVALS = process.env.PREAPPROVALS_URL ?? 'http://localhost:8095/v1/preapprovals/check';

// El `lending_product_key` NO es el slug siempre — el contrato lo arma
// `fetch-lender-preapproval.ts:148-153` del monorepo, y son tres casos:
const CREDITOP_X_PRODUCT_KEY = 'creditop_x';   // rt 2 y 3 comparten UN producto
const claveDeProducto = (rt: number, id: number, slug: string) =>
    (rt === 2 || rt === 3) ? CREDITOP_X_PRODUCT_KEY : WELLI_IDS.includes(id) ? 'welli' : slug;

/** EL CIERRE rt=2. La secuencia NO se dedujo: es la misma de `dev/sweep.ts close`, que a su vez la
 *  sacó corriendo el wizard. Dos cosas que costaron un 404 y un "PromissoryNote no encontrado" y que
 *  por eso van comentadas allá y acá: las pantallas de fecha y cronograma viven BAJO el prefijo
 *  `promissory-note`, y hay que pedir el `show` del pagaré ANTES de firmar, porque es ese loader el
 *  que genera los documentos.
 *
 *  ⚠ Si el comercio NO tiene una entidad rt=2, esto NO es un fallo: es un hecho del comercio. Se
 *  reporta «sin CreditopX» y el caso cierra bien. Contarlo como error haría que la mitad del catálogo
 *  se viera rota. */
/** ⚠ EL NÚMERO DE CUOTAS NO ES LIBRE: cada entidad acepta los suyos, y pedir uno que no ofrece corta
 *  el cierre con `CP050` («error durante el cálculo del plan de pagos») — un mensaje que no menciona
 *  las cuotas por ningún lado. Medido en producción: Credifamilia va en 24, 36, 48, 12, 6, 18 y 9 —
 *  **nunca en 4**, que es el default histórico de este runner. Se pasa por caso: `@cuotas=24`. */
async function cerrarCreditopX(arr: any[], ur: number, tel: string, amount: number,
                               post: any, get: any, pedido: number | null = null, cuotas = 4) {
    // Si el caso pidió una entidad concreta (`#hash:173`), se cierra por ÉSA. Sin pedido, el primer
    // rt=2 — que con varios CreditopX en el mismo comercio es arbitrario y llevaría a cerrar por otro.
    const ctopx = pedido
        ? arr.find((l) => Number(l.id) === pedido)
        : arr.find((l) => Number(l.response_type) === 2);

    // ⚠ ENTIDADES MUERTAS QUE IGUAL LISTAN. El dump local conserva lenders que en producción están
    // apagados, y el listado los muestra igual: pedir uno da un resultado prolijo y sin sentido. Pasó
    // el 2026-08-23 con «Bancolombia (No activo)» (id 8, CERO solicitudes en prod en 90 días): la
    // corrida informó «decide fuera de la plataforma» como si eso dijera algo de Bancolombia, cuando
    // los productos vivos son otros dos y entran por el canal QR, no por el onboarding.
    // ⚠ Y ESTE AVISO NO ALCANZA PARA ESE CASO, aunque parezca: el sufijo «(No activo)» está en el
    // nombre de PRODUCCIÓN y el dump local guarda «Bancolombia» a secas. O sea que lo único que
    // delataría a la entidad muerta no viaja al ambiente donde se prueba. Se deja igual porque cuesta
    // cero y sí atrapa a las que traen la marca, pero no se puede confiar en su silencio (F-173).
    if (ctopx && /no\s*activ|inactiv|deprecad|\(baja\)/i.test(String(ctopx.name ?? ''))) {
        console.log(`      ⚠ «${ctopx.name}» está marcada como INACTIVA en su propio nombre —`
            + ' el dump local la lista igual. Lo que salga de acá probablemente no dice nada del negocio.');
    }
    if (pedido && !ctopx) return { cerro: false, motivo: `la entidad ${pedido} no salió en el listado`, estado: null };
    if (!ctopx) return { cerro: false, motivo: 'sin CreditopX', estado: null as number | null };

    const sel = await post(`/api/onboarding/loan-application/update-user-request/${ur}`, {
        lender_id: Number(ctopx.id), fee_number: cuotas, original_amount: amount, amount,
        initial_fee: 0, rate: '0', transaction_data: null });
    // `standBy` es la marca de in-platform: sin eso el flujo se va por otro lado y el cierre no aplica.
    //
    // ⚠ Y NO ES LO MISMO QUE UN FALLO. En rt=0 (UTM) y rt=1 (integración) la decisión la toma alguien
    // AFUERA —una redirección o la API del banco—, así que la ausencia de `standBy` es el comportamiento
    // CORRECTO, no un tropiezo. Medido el 2026-08-23 corriendo los cinco response_type juntos: el
    // resumen contaba a Sufi (rt=0) y Banco de Bogotá (rt=1) entre los que «se trabaron», y eso manda a
    // buscar una causa donde no hay nada roto. Se marca aparte, con el rt que lo explica.
    if (!sel.json?.data?.standBy) {
        const rt = Number(ctopx.response_type);
        const afuera = rt === 0 || rt === 1;
        return {
            cerro: false, estado: null, fueraDePlataforma: afuera,
            motivo: afuera
                ? `${ctopx.name}: decide FUERA de la plataforma (rt=${rt}) — no hay cierre que probar acá`
                : `${ctopx.name}: no devolvió standBy`,
        };
    }

    const PN = '/api/loans/requests/promissory-note';
    await get(`/api/loans/requests/${ur}`);
    await post('/api/loans/requests/confirm', { user_request_id: ur });

    // ¿ESTA SOLICITUD EXIGE CODEUDOR? Lo decide la POLÍTICA de la categoría en la que cayó el usuario,
    // no que exista un codeudor. Se pregunta a la BD en vez de deducirlo del estado porque el estado
    // recién se mueve cuando el flujo arranca — y arrancarlo «para ver» sobre una solicitud que no lo
    // necesita la mandaría al estado 17 sin motivo.
    const pol = await one<{ rc: number; hash: string }>(
        `SELECT c.requires_cosigner rc, ab.hash
           FROM user_requests r
           JOIN allied_branches ab ON ab.id = r.allied_branch_id
           JOIN users_category_log g ON g.user_id = r.user_id AND g.lender_id = r.lender_id
           JOIN lender_users_categories c ON c.id = g.lender_users_category_id
          WHERE r.id = ? ORDER BY g.id DESC LIMIT 1`, [ur]).catch(() => null);

    let tokenCodeudor: string | undefined;
    if (pol?.rc) {
        const cod = await resolverCodeudor(ur, pol.hash, tel, amount, post, get);
        if (!cod.ok) return { cerro: false, motivo: `${ctopx.name}: ${cod.motivo}`, estado: null };
        tokenCodeudor = cod.token;
    }

    const dates = await get(`${PN}/${ur}/select-payment-date`);
    const dOpts = dates.json?.data?.nextPaymentDates ?? dates.json?.data?.dates ?? [];
    const firstDate = Array.isArray(dOpts) ? (dOpts[0]?.date ?? dOpts[0]) : null;
    await post(`${PN}/${ur}/confirm-payment-date`, { user_request_id: ur, payment_date: firstDate, date: firstDate });

    const sim = await get(`${PN}/${ur}/simulate-payment-schedule`);
    // La clave es `paymentSchedule` (`PaymentScheduleController::simulatePaymentSchedule`). Antes se
    // probaba `cycles` y `simulations` —que no existen— y se caía a `data`, que es el sobre entero y no
    // un arreglo: el runner terminaba con UN objeto sin `fee_number` y creía que la entidad no ofrecía
    // plazos. Nunca leyó los que ofrece.
    const cycles = sim.json?.data?.paymentSchedule ?? sim.json?.data?.payment_schedule ?? [];
    const lista: any[] = Array.isArray(cycles) ? cycles : [cycles].filter(Boolean);
    const plazoDe = (x: any) => Number(x?.fee_number ?? x?.feeNumber ?? 0);

    // ⚠ EL PLAZO QUE QUEDA GUARDADO SALE DE ACÁ, NO DE LA SELECCIÓN DE ENTIDAD. Antes se tomaba
    // `cycles[0]` siempre, así que `@cuotas=36` viajaba en el update de arriba —donde sí decide si el
    // plazo se ofrece— y después este confirm lo PISABA con el primer ciclo de la lista. Medido el
    // 2026-08-23: pedir 12, 24 o 36 dejaba `user_requests.fee_number` en **4** en los tres casos, y el
    // caso igual daba verde. Un runner que informa un plazo que no corrió miente en la dirección más
    // cara: la de creer que se probó algo que no se probó.
    const elegido = lista.find((x) => plazoDe(x) === cuotas);
    const cyc = elegido ?? lista[0];
    if (!elegido && lista.length) {
        const ofrecidos = lista.map(plazoDe).filter(Boolean).join(', ') || '(la simulación no trae plazos)';
        console.log(`      ⚠ el plazo pedido (${cuotas}) NO está entre los que simula la entidad: ${ofrecidos}`);
        console.log(`        se cierra con ${plazoDe(cyc) || '?'} — el resultado NO prueba el plazo pedido`);
    }

    const urRow = await one<{ a: number }>('SELECT allied_id a FROM user_requests WHERE id=?', [ur]).catch(() => null);
    await post(`${PN}/${ur}/confirm-payment-schedule`, {
        user_request_id: ur, amount, lender_id: Number(ctopx.id), allied_id: urRow?.a,
        fee_number: plazoDe(cyc) || cuotas, selected_cycle: cyc ?? {} });

    // GENERA LOS DOCUMENTOS — y hay que MIRAR si salió bien.
    //
    // Sin este chequeo el runner seguía derecho al OTP y a `authorize`, y el fallo aparecía tres
    // llamadas después como `HTTP 500 · PromissoryNote no encontrado`, que se lee como un bug de la
    // aplicación. Medido en una tanda de 12 en paralelo: los casos que fallaron **sí tenían pagaré**
    // en la base al revisarlos —o sea que se generó— pero no cuando `authorize` fue a buscarlo. El
    // paso siguiente sólo tiene sentido si éste terminó.
    const docs = await get(`${PN}/${ur}`);
    if (docs.status !== 200) {
        return { cerro: false, estado: null,
                 motivo: `${ctopx.name}: la generación de documentos `
                     + (docs.status === 0 && (docs as any).motivo
                         ? String((docs as any).motivo)
                         : `devolvió HTTP ${docs.status}`)
                       + ' — sin esto el pagaré no existe y `authorize` falla con otro mensaje' };
    }
    await post('/api/loans/requests/promissory-note/validate/send-otp', { user_request_id: ur });
    await post('/api/loans/requests/promissory-note/validate/verify-otp',
               { user_request_id: ur, otp: tel.slice(-6) });

    // EL CIERRE DEPENDE DEL PATH DE LA ENTIDAD, y no da lo mismo llamar al de al lado.
    //
    // En el canal IMEI la firma NO autoriza: deja la solicitud en «Autorizado pendiente desembolso» y
    // el crédito se desembolsa recién cuando el equipo —que ES la garantía— queda inscrito en el MDM:
    // `device/register` → `device/{ur}/disburse`.
    //
    // ⚠ Llamar al `authorize` estándar acá TAMBIÉN devuelve 200 y TAMBIÉN deja estado 11, pero sin
    // equipo inscrito (medido: la misma entidad cerrada por un camino queda con imei y por el otro con
    // NULL). O sea que el runner reportaba «cerró en 11» sobre un crédito que se saltó la garantía —un
    // verde falso, que es peor que un rojo—. `authorize` no tiene guarda para este path: la tiene para
    // el codeudor y no para esto (F-157).
    const esImei = await one<{ p: string }>(
        `SELECT pa.name p FROM lenders l JOIN paths pa ON pa.id = l.path_id WHERE l.id = ?`,
        [Number(ctopx.id)]).catch(() => null);

    let aut;
    if (esImei?.p === 'IMEI') {
        // IMEI derivado del uReq: 15 dígitos, estable por caso y distinto entre casos paralelos.
        const imei = String(35000000000000 + (ur % 1_000_000_000)).slice(0, 15).padEnd(15, '0');
        const reg = await post('/api/loans/requests/device/register', { user_request_id: ur, imei });
        if (reg.status !== 200) {
            return { cerro: false, motivo: `${ctopx.name}: device/register HTTP ${reg.status}`, estado: null };
        }
        aut = await post(`/api/loans/requests/device/${ur}/disburse`, { user_request_id: ur });
    } else {
        aut = await post('/api/loans/requests/promissory-note/validate/authorize', { user_request_id: ur });
    }

    // EL CIERRE DE VERDAD CUANDO HAY CODEUDOR. `authorize` no autoriza: difiere (HTTP 200 con
    // `deferred_for_cosigner`), y la solicitud queda esperando la segunda firma. Leer sólo el 200 acá
    // es exactamente la trampa que el nodo `codeudor` documenta.
    // ⚠ La marca viene DENTRO de `data.user_request`, no en `data`. Mirar sólo el nivel de arriba deja
    // la solicitud en 29 y el runner reporta «no cerró · HTTP 200» — un mensaje que se contradice solo.
    const difirio = aut.json?.data?.user_request?.deferred_for_cosigner
        ?? aut.json?.data?.deferred_for_cosigner;
    if (tokenCodeudor && difirio) {
        const f = await firmaDelCodeudor(tokenCodeudor, post, get);
        if (!f.ok) {
            const e = await one<{ e: number }>('SELECT user_request_status_id e FROM user_requests WHERE id=?', [ur])
                .catch(() => null);
            return { cerro: false, motivo: `${ctopx.name}: ${f.motivo}`, estado: e?.e ?? null };
        }
    }

    const fin = await one<{ e: number }>(
        'SELECT user_request_status_id e FROM user_requests WHERE id=?', [ur]).catch(() => null);
    // ⚠ El MOTIVO, no sólo el status. Un `HTTP 422` a secas manda a adivinar: puede ser el pagaré, el
    // OTP, el cupo o el cronograma. El cuerpo lo dice, y sin él el diagnóstico cuesta una sesión.
    const porQue = aut.status === 200 ? '' :
        ' · ' + String(aut.json?.errors?.payload
            ? JSON.stringify(aut.json.errors.payload)
            : aut.json?.message ?? aut.json?.raw ?? '').split('\n')[0].slice(0, 90);
    // ⚠ LA RADICACIÓN NO SE VE EN EL ESTADO, y por eso hay que ir a buscarla. «Autorizada» (11) es el
    // final del lado NUESTRO; mandarle el paquete al lender es un paso aparte que puede fallar SIN
    // mover el estado y SIN cambiar el HTTP: el endpoint de autorización devuelve 200 igual. Medido el
    // 2026-08-23: con el SOAP saliendo al sandbox real de Credifamilia y dando 504, la transacción
    // quedaba en `CREDIT_ERROR` y el runner reportaba «CERRÓ en estado 11». El crédito no se radicó y
    // nada lo decía.
    //
    // Sólo lo tienen las entidades que radican por transacción; para el resto no hay fila y se omite.
    const rad = await one<{ n: string }>(
        `SELECT s.name n FROM lender_transactions t
           LEFT JOIN lender_transaction_statuses s ON s.id = t.status_id
          WHERE t.user_request_id = ? ORDER BY t.id DESC LIMIT 1`, [ur]).catch(() => null);

    return {
        cerro: fin?.e === 11,
        motivo: `${ctopx.name} · HTTP ${aut.status}${porQue}`
            + (rad?.n ? ` · radicación ${rad.n}${rad.n === 'CREDIT_COMPLETED' ? '' : ' ⚠'}` : ''),
        estado: fin?.e ?? null,
        radicacion: rad?.n ?? null,
    };
}

/** Lo que el wizard dispara por cada entidad elegible después de recibir el listado.
 *  ⚠ Sólo para `response_type !== 0`: las STANDARD nunca usan el microservicio. */
async function preAprobar(lender: any, ureq: number, userId: number, alliedId: number,
                          hash: string, amount: number, estadoMock?: string) {
    const payload: Record<string, unknown> = {
        applicant_id: userId,
        lending_product_key: claveDeProducto(Number(lender.response_type), Number(lender.id), String(lender.slug ?? '')),
        lending_product_id: String(lender.id),
        merchant_id: alliedId,
        user_request_id: ureq,
        allied_branch_hash: hash,
    };
    // ⚠ el monto va SÓLO si es > 0: welli, meddipay, prami y bancolombia_consumer_loan rechazan la
    // consulta sin monto positivo, y para el resto el MS lo trata como opcional.
    if (amount > 0) payload.amount = amount;
    // ⚠ `?status=` NO es parte del contrato: es una perilla del MOCK (`mock-preapprovals`), que
    // también acepta `x-mock-status` y `body.force_status`. Va en la URL y no en el cuerpo a
    // propósito — el cuerpo tiene que seguir siendo EXACTAMENTE el que manda el front, o la prueba
    // deja de probar el contrato real. Contra el MS de verdad, este parámetro se ignora.
    const url = estadoMock ? `${PREAPPROVALS}?status=${encodeURIComponent(estadoMock)}` : PREAPPROVALS;
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(45_000),
    }).catch((e) => e as Error);
    if (r instanceof Error) return { id: lender.id, estado: `sin respuesta (${String(r.message).slice(0, 40)})` };
    if (r.status === 422) {
        const b: any = await r.json().catch(() => ({}));
        return { id: lender.id, estado: `bajo el mínimo (${b?.minimum_amount ?? '?'})` };
    }
    if (!r.ok) return { id: lender.id, estado: `http_${r.status}` };
    const j: any = await r.json().catch(() => ({}));
    return { id: lender.id, estado: String(j?.status ?? 'sin status'), cupo: j?.approved_amount ?? j?.available ?? null };
}

const arg = (n: string, d = ''): string => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
/** Banderas que una SUITE prende por su cuenta (su campo `requiere`). Existe para que una suite se
 *  baste sola: quien la corre —una persona apurada o un LLM— no tiene que saber que este archivo
 *  necesita `--cerrar` para significar algo. Sin esto, olvidarse del flag no da un resultado falso
 *  (el verificador lo marca como no verificado) pero sí una corrida perdida de dos minutos. */
const implicitos = new Set<string>();
const flag = (n: string) => process.argv.includes(`--${n}`) || implicitos.has(n);

// Base 313 + 7 dígitos. El índice del caso va al final para que dos casos NUNCA compartan usuario;
// se imprime en el reporte porque es lo que hace falta para ir a mirar la solicitud después.
const telefono = (i: number) => `313${String(2_000_000 + i).slice(0, 7)}`;

/** Lo que un caso DECLARA que debería pasar. Sin esto el runner sólo narra; con esto contesta
 *  «¿sigue valiendo?», que es la pregunta que se hace después de tocar código.
 *
 *  ⚠ UNA EXPECTATIVA QUE NO SE PUDO EVALUAR CUENTA COMO FALLA, no como éxito. Si un caso espera un
 *  cierre y la corrida no lleva `--cerrar`, eso es un error de la suite: darlo por bueno sería
 *  exactamente el verde falso que este harness ya se comió una vez. */
type Espera = {
    enListado?: boolean;      // ¿la entidad pedida salió en el listado?
    cierra?: boolean;         // ¿la solicitud llegó a cerrar?
    estado?: number;          // estado final exacto (11 autorizada, 28 pendiente desembolso, …)
    entidades?: number[];     // estas entidades TIENEN que estar en el listado (subconjunto, no igualdad)
    noEntidades?: number[];   // estas entidades NO pueden estar — para «ya tiene un crédito acá»
    /** Estado de la RADICACIÓN al lender (`CREDIT_COMPLETED`, `CREDIT_ERROR`, …). Es un paso posterior
     *  al estado 11 y puede fallar sin moverlo: exigirlo acá es la única forma de que una suite note
     *  que el crédito quedó autorizado pero nunca se radicó. */
    radicacion?: string;
};

type Caso = {
    comercio: string; lender: number | null;
    nombre?: string; espera?: Espera;
    /** `Empleado` (default) | `Independiente`. Se DEDUCE del buró, no se inyecta — ver `respuestaAgildata`. */
    ocupacion?: string;
    /** Cuántas cuotas pedir. ⚠ NO todas las entidades aceptan cualquier número — ver `cerrarCreditopX`. */
    cuotas?: number;
    /** `@webhook=fulfilled` — dispara el webhook REAL de la entidad en `legacy-application` para darle
     *  desenlace a un rt=1. Es OPT-IN a propósito: nunca debe pasar solo, porque el código que corre no
     *  es el de `legacy-backend` (F-170) y un desenlace automático se leería como si lo fuera. */
    webhook?: string;
    /** Este caso es una vuelta POSTERIOR del mismo cliente: ya está registrado. Ver `correrPasos`. */
    recurrente?: boolean;
    /** Solicitudes SUCESIVAS del mismo cliente. Ver `correrPasos`. */
    pasos?: Array<{ nombre?: string; lender?: number | null; amount?: number; espera?: Espera }>;
    amount?: number; income?: number; score?: number;
    // qué debe contestar cada integración PARA ESTE CASO: `pullman@meddipay=rechaza`
    escenarios?: Record<string, string>;
};

/** `pullman` · `pullman:77` · `pullman@score=300,income=900000` · `pullman:77@amount=5000000`
 *
 * Los parámetros van POR CASO y no como flag global porque el paralelo sirve justamente para
 * comparar: dos corridas idénticas sólo prueban que el sistema es determinista (útil una vez), y
 * dos que difieren en UN dato muestran qué mueve ese dato. Medido: con `score=300,income=900000`
 * CrediPullman desaparece del listado y con el default no — el cupo rt=2 filtra de verdad. */
function parseCaso(spec: string, dflt: { amount: number; income: number; score: number }): Caso {
    const [izq, params] = spec.split('@');
    const [comercio, l] = izq.split(':');
    const c: Caso = { comercio, lender: l ? Number(l) : null, ...dflt };
    for (const kv of (params ?? '').split(',').filter(Boolean)) {
        const [k, v] = kv.split('=');
        if (k === 'amount' || k === 'income' || k === 'score') { c[k] = Number(v); continue; }
        if (k === 'ocupacion') { c.ocupacion = v; continue; }
        if (k === 'cuotas') { c.cuotas = Number(v); continue; }
        if (k === 'webhook') { c.webhook = v; continue; }
        // cualquier otra clave es el ESCENARIO de una entidad: `pullman@meddipay=rechaza`.
        // Se dicta al mock de integraciones POR CÉDULA, así que dos casos en paralelo pueden pedir
        // cosas distintas de la misma entidad sin pisarse.
        (c.escenarios ??= {})[k] = v;
    }
    return c;
}
/** Una SUITE en JSON: los mismos casos que la cadena `CASOS`, pero con nombre y expectativa.
 *
 *  POR QUÉ EXISTE. La cadena `pullman:77@score=300` alcanza para preguntar «¿qué pasa?». No alcanza
 *  para «¿esto sigue valiendo después de mi cambio?», que es la pregunta de después de tocar código —
 *  y es la que un archivo versionado puede contestar, porque queda como el registro de lo que se
 *  esperaba y de por qué.
 *
 *  Forma:
 *    {
 *      "nombre": "rt=2 de Motai",
 *      "requiere": ["cerrar", "lambda", "paralelo"],
 *      "porDefecto": { "amount": 2000000, "income": 2500000, "score": 700 },
 *      "casos": [
 *        { "nombre": "el RTO exige codeudor",
 *          "comercio": "motai", "lender": 173,
 *          "espera": { "enListado": true, "estado": 17 } }
 *      ]
 *    }
 *
 *  `porDefecto` de la suite pisa a los flags de la corrida, y lo de cada caso pisa a `porDefecto`:
 *  así una suite es reproducible sin depender de con qué flags la invocaron. */
async function cargarSuite(ruta: string, dflt: { amount: number; income: number; score: number }): Promise<Caso[]> {
    const { readFile } = await import('node:fs/promises');
    let json: any;
    try {
        json = JSON.parse(await readFile(ruta, 'utf8'));
    } catch (e) {
        throw new Error(`no pude leer la suite ${ruta}: ${e}`);
    }
    if (!Array.isArray(json?.casos) || json.casos.length === 0) {
        throw new Error(`la suite ${ruta} no tiene un array \`casos\` con al menos un caso`);
    }
    // `requiere` deja que la suite prenda lo que necesita: `["cerrar", "lambda"]`.
    for (const f of (Array.isArray(json.requiere) ? json.requiere : [])) implicitos.add(String(f));

    // `porDefecto` alimenta TODOS los campos del caso, no sólo los tres numéricos. Al principio sólo
    // cubría `amount`/`income`/`score` y nadie lo notó porque las suites repetían comercio y entidad en
    // cada caso; una suite que los declaraba una vez arriba fallaba con «falta comercio», que suena a
    // suite mal escrita y no a un defecto por defecto que no se aplica.
    const base = { ...dflt, ...(json.porDefecto ?? {}) };
    return json.casos.map((c: any, i: number) => {
        const comercio = c?.comercio ?? (base as any).comercio;
        if (!comercio) throw new Error(`caso ${i} de la suite: falta \`comercio\` (ni en el caso ni en \`porDefecto\`)`);
        if (Array.isArray(c.pasos) && c.pasos.length === 0) {
            throw new Error(`caso ${i} de la suite: \`pasos\` está vacío — un cliente sin solicitudes no prueba nada`);
        }
        // `lender` acepta `null` explícito en el caso —«terminá en el listado»— y eso NO es lo mismo que
        // omitirlo, que sí hereda del default. Por eso se mira la CLAVE, no el valor.
        const lender = 'lender' in (c ?? {}) ? c.lender : (base as any).lender;
        const ocupacion = c.ocupacion ?? (base as any).ocupacion;
        const cuotas = c.cuotas ?? (base as any).cuotas;
        const webhook = c.webhook ?? (base as any).webhook;
        return {
            comercio: String(comercio),
            lender: lender == null ? null : Number(lender),
            nombre: c.nombre ? String(c.nombre) : undefined,
            espera: c.espera,
            ocupacion: ocupacion ? String(ocupacion) : undefined,
            cuotas: cuotas ? Number(cuotas) : undefined,
            webhook: webhook ? String(webhook) : undefined,
            pasos: Array.isArray(c.pasos) ? c.pasos : undefined,
            escenarios: c.escenarios,
            amount: Number(c.amount ?? base.amount),
            income: Number(c.income ?? base.income),
            score: Number(c.score ?? base.score),
        } as Caso;
    });
}

type Res = {
    caso: Caso; ok: boolean; ur?: number; phone: string; nombre?: string;
    enListado?: boolean; listado?: number[]; conducta?: string; detalle?: string;
    com?: string;
    preaprobados?: { id: number; estado: string; cupo?: unknown }[];
    /** `radicacion` sólo existe cuando la entidad radica por transacción y el caso llegó hasta ahí;
     *  en los cortes tempranos no hay fila que consultar. */
    cierre?: { cerro: boolean; motivo: string; estado: number | null; radicacion?: string | null;
               /** rt=0/1: la decisión la toma alguien afuera. NO es un fallo del caso. */
               fueraDePlataforma?: boolean;
               /** Resultado del webhook de la entidad, si el caso lo pidió con `@webhook=`. */
               webhook?: string };
};

async function http(method: string, path: string, body: unknown, phone: string) {
    const r = await fetch(`${API}${path}`, {
        method,
        headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
    }).catch((e) => e as Error);
    if (r instanceof Error) return { status: 0, json: { message: String(r.message).slice(0, 140) } };
    const t = await r.text();
    try { return { status: r.status, json: JSON.parse(t) }; }
    catch { return { status: r.status, json: { raw: t.slice(0, 200) } }; }
}

/** Clasifica por los MISMOS campos que mira el front (mismo criterio que `sweep.ts`). */
function conductaDe(d: any): string {
    if (!d) return 'sin data';
    if (d.standBy) return 'standBy (in-platform)';
    if (d.showModal) return 'modal (autogestión)';
    if (d.url) return `redirect externo`;
    if (d.otp || d.otpId) return 'OTP del lender';
    return 'continúa sin bifurcar';
}

/** Elige un teléfono de bypass LIMPIO (sin usuario) del setting `qa_otp_bypass_phones`. El OTP es
 *  sus últimos 4 dígitos. Se saltea el de `mock_rules`, que iría al fixture. */
// La raíz única de la corrida: de acá salen la cédula y el teléfono de cada caso, así ninguna
// corrida pisa a la anterior.
const BASE_DOC = 1090000000 + ((Date.now() / 100) % 9_000_000 | 0);

/** La sucursal de un caso. Acepta `#hash` —la sucursal EXACTA— o un nombre.
 *
 *  ⚠ Para un CENSO hay que usar hash. Con nombre resuelve por `LIKE %x%` y se queda con la sucursal
 *  de más entidades, así que dos comercios que comparten prefijo se pisan y uno de los dos NUNCA se
 *  prueba: el barrido quedaría corto sin que nada avise. */
async function buscarSucursal(ref: string) {
    const porHash = ref.startsWith('#');
    return one<{ id: number; hash: string; com: string; allied: number }>(
        porHash
            ? `SELECT b.id, b.hash, x.name AS com, x.id AS allied FROM allied_branches b
                 JOIN allieds x ON x.id = b.allied_id WHERE b.hash = ? LIMIT 1`
            : `SELECT b.id, b.hash, x.name AS com, x.id AS allied FROM allied_branches b
                 JOIN allieds x ON x.id = b.allied_id WHERE x.name LIKE ?
                ORDER BY (SELECT COUNT(*) FROM lenders_by_allied_branches l
                           WHERE l.allied_branch_id = b.id) DESC LIMIT 1`,
        [porHash ? ref.slice(1) : `%${ref}%`]).catch(() => null);
}

/** El teléfono de un caso. DERIVADO, como la cédula — no sale de una lista.
 *
 *  Hasta el 2026-08-18 esto elegía uno de los 64 de `settings.qa_otp_bypass_phones`, los reciclaba
 *  con `scrubphone` cuando se agotaban, y necesitaba un candado para que dos casos en paralelo no se
 *  llevaran el mismo. Toda esa maquinaria era INNECESARIA: con `ONBOARDING_DRIVER_OTP=fake`,
 *  `FakeOtpServiceRepository::validateOtp` **ignora el código tecleado** y no exige que el teléfono
 *  esté en ninguna lista. Verificado con un teléfono inventado y el código `9999`: `otp-validate`
 *  devolvió el `uReq` igual.
 *
 *  Lo que se gana no es sólo código menos: desaparece el tope de 64 casos, desaparece el borrado de
 *  usuarios ajenos (`scrubphone` borra TODOS los del teléfono) y desaparece la carrera por reservar.
 *
 *  ⚠ Depende de que el driver de OTP siga en `fake`. Si alguien lo pone en `real`, esto deja de
 *  andar y hay que volver a los de `qa_otp_bypass_phones` —cuyo código son sus últimos 4 dígitos—.
 *  El síntoma sería `otp-validate` rechazando el código, que es explícito y no engaña. */
//  ⚠ El índice va con DOS dígitos, no con `i % 10`: con `% 10` treinta casos comparten diez
//  teléfonos, y tres de ellos pelean por el mismo usuario. Así soporta 100 casos por corrida.
const telefonoDe = (i: number) => `31${String(BASE_DOC).slice(-6)}${String(i % 100).padStart(2, '0')}`;

/** ⚠ PARA CERRAR hace falta que el teléfono esté en `qa_otp_bypass_phones`, y no es capricho: son DOS
 *  mecanismos de OTP distintos y sólo uno acepta cualquier teléfono.
 *    · el OTP del ONBOARDING va por el driver fake (`FakeOtpServiceRepository`), que ignora el código
 *      y no mira el teléfono → cualquiera sirve, y por eso el listado se prueba con derivados.
 *    · el OTP de la FIRMA DEL PAGARÉ va por `OtpBypassService`, que consulta esa lista → un teléfono
 *      fuera de ella hace que `authorize` responda 422 «No se encontró un OTP validado para esta
 *      solicitud» y la solicitud quede en estado 10.
 *
 *  POR QUÉ SE AMPLÍA LA LISTA EN VEZ DE RECICLAR LA QUE HAY. La lista trae ~68 teléfonos fijos, y
 *  reusarlos tiene dos problemas que se ven recién al correr en paralelo:
 *
 *    · **arrastran su historia**. Un teléfono cuyo usuario ya cerró un crédito bloquea el cupo rt=2
 *      —el corte es por entidad— y entonces el listado devuelve las rt=1 y ninguna CreditopX. El
 *      síntoma es «la entidad 169 no salió en el listado», que se lee como una regla de negocio.
 *    · **ponen un techo**: 68 es el máximo de cierres simultáneos, hagas lo que hagas.
 *
 *  La alternativa evidente —borrar los usuarios al arrancar, como hace el spec del canal QR con SU
 *  teléfono— se descartó a propósito: `scrubphone` es una cascada de DELETE sobre `users` y
 *  `user_requests`, y correrla en lote al principio de cada tanda es exactamente la clase de operación
 *  que ya vació una base compartida (CORE-431). Para un teléfono conocido está bien; para una tanda, no.
 *
 *  Acá no hace falta borrar nada: **cada caso ya deriva su propio teléfono** (`telefonoDe`), así que
 *  alcanza con decirle al backend que esos derivados están bypasseados. Usuario virgen por caso, sin
 *  historia que arrastrar, sin techo y sin un solo DELETE.
 *
 *  ⚠ SE REGISTRAN TODOS DE UNA Y EN SERIE, ANTES del paralelo. La lista es UN valor JSON: N escrituras
 *  concurrentes de «leé, agregá el mío, guardá» se pisan y sobreviven unas pocas — la misma trampa que
 *  el dictado a la lambda. Y se restaura al terminar para no dejar la lista creciendo sola. */
async function registrarBypass(tels: string[]): Promise<string | null> {
    const row = await one<{ value: string }>(
        "SELECT value FROM settings WHERE `key`='qa_otp_bypass_phones'").catch(() => null);
    if (!row) return null;                       // sin la fila no hay bypass que ampliar: se avisa arriba
    const original = row.value;
    const actuales: string[] = JSON.parse(original ?? '[]').map(String);
    // Con el comodín puesto no hay nada que ampliar: cualquier teléfono pasa. Tocar la lista igual
    // sería escribir en la BD sin motivo, y dejaría la corrida creyendo que hizo algo que no hizo.
    if (actuales.includes('*')) return original;
    const faltan = tels.filter((t) => !actuales.includes(t));
    if (!faltan.length) return original;
    await exec("UPDATE settings SET value=? WHERE `key`='qa_otp_bypass_phones'",
               [JSON.stringify([...actuales, ...faltan])]);
    return original;
}

/** Lo que había en la lista antes de que esta corrida la ampliara. De módulo y no local a `main()`
 *  para poder restaurarla aunque la corrida termine mal: una lista que crece sola con teléfonos de
 *  tandas viejas es basura que después nadie sabe de dónde salió. */
let bypassOriginal: string | null = null;

async function restaurarBypass(original: string | null): Promise<void> {
    if (original === null) return;
    await exec("UPDATE settings SET value=? WHERE `key`='qa_otp_bypass_phones'", [original])
        .catch(() => { /* restaurar es higiene, no puede tumbar la corrida */ });
}

/** Le dicta a la lambda qué contesta cada central PARA ESA CÉDULA. Es el paso que vuelve el caso
 *  hipotético: se pide de antemano la respuesta que se quiere recibir. */
/** ⚠ LEE DESPUÉS DE ESCRIBIR, y reintenta. La lambda es serverless y sus global-vars viven en la
 *  MEMORIA DEL CONTENEDOR: el POST puede caer en un contenedor y la lectura del backend en otro, y
 *  entonces se sirve la respuesta POR DEFECTO como si nada. No es sólo un problema de concurrencia
 *  —medido el 2026-08-18 con UN caso solo— y el síntoma no se parece a la causa: la default trae
 *  períodos de hace diez meses, así que el backend calcula `employed: false` y `personal-info`
 *  responde `ONB004 laboral information is required`. Uno sale a buscar por qué el comercio pide
 *  información laboral y el problema es que el buró nunca contestó lo que se le pidió.
 *
 *  Confirmar cuesta una petición y convierte un fallo intermitente en uno que no ocurre. */
async function confirmarDictado(doc: string, central: string, esperado: string): Promise<boolean> {
    const rutas: Record<string, string> = {
        agildata: `/agildata/agildata-services/rest/afiliado/historicoDetalladoEmpleo/1/${doc}`,
    };
    const ruta = rutas[central];
    if (!ruta) return true;                       // sin ruta conocida no se puede confirmar: no se bloquea
    const r = await fetch(`${LAMBDA}${ruta}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!r?.ok) return false;
    return (await r.text()).includes(esperado);
}

async function dictar(doc: string, central: string, valor: unknown): Promise<boolean> {
    // ⚠ Mockoon NO valida el JSON que se le dicta: lo emite tal cual con 200, y un JSON roto se lee
    // después como «respuesta inválida del proveedor». Se serializa acá y se falla acá si no es válido.
    const v = typeof valor === 'string' ? valor : JSON.stringify(valor);
    try { JSON.parse(v); } catch { return false; }
    const r = await fetch(`${LAMBDA}/mockoon-admin/global-vars`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: `${central}_${doc}`, value: v }),
        signal: AbortSignal.timeout(25_000),
    }).catch(() => null);
    return !!r?.ok;
}

/**
 * Qué tipo de documento aceptar en `personal-info`, preguntándoselo al comercio.
 *
 * El backend ya publica `allowed_document_types` en el payload del comercio, resuelto por sus entidades
 * y recortado por el país. Pedirlo acá es lo que hace que este runner sirva para un comercio que no sea
 * colombiano: con `'CC'` quemado, contra el dominicano el backend contesta —bien— «El tipo de documento
 * no está habilitado en este punto de venta», y el caso moría por culpa del runner, no del código.
 *
 * Se cachea por hash porque un barrido corre el mismo comercio muchas veces.
 */
const tiposPorComercio = new Map<string, string>();
async function tipoDeDocumentoDelComercio(hash: string): Promise<string> {
    const cacheado = tiposPorComercio.get(hash);
    if (cacheado) return cacheado;

    let tipo = 'CC';   // lo que había: si el backend no publica la lista, no se cambia el comportamiento
    try {
        const r = await fetch(`${API}/api/loans/allied/${hash}`, { signal: AbortSignal.timeout(20_000) });
        const j = await r.json() as { data?: { allowed_document_types?: string[] } };
        const lista = j?.data?.allowed_document_types;
        if (Array.isArray(lista) && lista.length > 0 && typeof lista[0] === 'string') tipo = lista[0];
    } catch { /* sin payload, queda 'CC' */ }

    tiposPorComercio.set(hash, tipo);
    return tipo;
}

/** El camino REAL: register → otp-validate → personal-info. No usa `synthFill` — justamente porque
 *  synthFill escribe la fila de `risk_central_user_data` y entonces el backend la reusa (caché de un
 *  mes) y NO llama a la central. Es la trampa 1 del documento de la tarea. */
/** La cédula de un caso. Única POR CORRIDA, no sólo por caso: derivarla de (índice, score) hacía que
 *  la segunda vez que se corría el mismo comando repitiera cédula, y el flujo moría con «El correo
 *  electrónico ya se encuentra registrado» — un error que no se parece a su causa. Peor: la caché de
 *  un mes de `risk_central_user_data` habría servido la consulta anterior en vez de llamar a la
 *  central, que es justo lo que se quiere ejercitar. */
const cedulaDe = (i: number) => String(BASE_DOC + i);

/** La respuesta que se le pide a la central para este caso. El ingreso del caso se vuelve el `ibc`
 *  (Ingreso Base de Cotización) de los pagos: el backend NO lo recibe inyectado, lo descubre
 *  consultando. Se emiten 8 períodos para que las reglas de continuidad (3/6/12 meses) tengan de
 *  dónde calcular — con menos, «no continuo» sería un artefacto del mock y no del caso planteado. */
/** ⚠ LA OCUPACIÓN NO SE INYECTA: SE DEDUCE DE ESTE PAYLOAD, y de una comparación de nombres.
 *
 *  `AgildataService::validateContractType` compara el nombre del EMPLEADOR contra el de la persona —los
 *  dos salen de esta misma respuesta— y si coinciden devuelve `2` (**Independiente**); si no, `1`
 *  (**Empleado**). Tiene sentido de negocio: quien se cotiza a sí mismo es independiente.
 *
 *  Y esto NO es un detalle de laboratorio: la regla de Credifamilia exige `ocupación = Independiente`,
 *  así que con el empleador por defecto esa entidad **nunca sale en el listado** — y el síntoma es una
 *  ausencia silenciosa, no un rechazo visible. */
function respuestaAgildata(doc: string, ibc: number, ocupacion?: string) {
    // ⚠ EL PERÍODO ES `YYYYMM` Y NO SE PUEDE RESTAR COMO ENTERO. `202603 - k` parece razonable y a
    // partir del cuarto pago da 202599, 202598… meses que no existen. El backend calcula la
    // continuidad (3/6/12 meses) contando períodos, así que con basura ahí devuelve `employed: false`,
    // continuidad en cero y `approximate_real_salary: 0` — el ingreso llega y NO SIRVE. El caso que
    // uno creyó plantar («alguien que gana 15M») termina siendo «alguien sin empleo», y el listado no
    // cambia por la razón equivocada.
    const pagos = Array.from({ length: 8 }, (_, k) => {
        // ⚠ RELATIVO A HOY, no a una fecha fija. `validateContractType` compara el último período
        // contra la fecha de la solicitud: una serie que termina hace cinco meses da `employed:false`
        // por vieja, no por el caso que se quiso plantear. Una fecha horneada acá envejece sola y
        // rompe el runner en silencio unos meses después.
        const hoy = new Date();
        const meses = hoy.getFullYear() * 12 + hoy.getMonth() - k;
        const [y, m] = [Math.floor(meses / 12), (meses % 12) + 1];
        const mm = String(m).padStart(2, '0');
        return {
            id: k + 1, ibc, periodo: Number(`${y}${mm}`),
            fechaPago: `${y}-${mm}-15 00:00:00`,
            diasCotizados: 30, valorCotizacionObligatoria: Math.round(ibc * 0.115),
        };
    });
    return {
        usuario: null, codRespuesta: '01', observaciones: 'Consulta Exitosa.',
        codConsulta: 14744568681490196,
        respuesta: {
            type: 'aorg.asofondos.agildata.domain.AfiliadoDetalladoa', fechaVinculacion: null,
            datosBasicos: { edad: 25, type: 'org.asofondos.agildata.domain.AfiliadoDatosBasicos',
                            genero: 'M', nombre: 'CARLOS RUIZ MENDOZA', tipoId: 'CC',
                            numeroId: doc, viabilidad: null },
            detalladoEmpleos: [{
                id: 1, pagos,
                // Empleador = la persona → Independiente. Distinto → Empleado. Ver la cabecera.
                nombreEmpleador: String(ocupacion ?? '').toLowerCase() === 'independiente'
                    ? 'CARLOS RUIZ MENDOZA'
                    : 'STANGERSON SAS',
                telefonoEmpleador: null,
                direccionEmpleador: null, identifiacionEmpleador: '900101010',
                tipoIdentifiacionEmpleador: 'NI' }],
        },
    };
}

const dictados = new Set<string>();

/** ⚠ DICTAR VA EN SERIE, AUNQUE LOS CASOS CORRAN EN PARALELO. La lambda es serverless y sus
 *  global-vars viven en la MEMORIA DEL CONTENEDOR: tres POST concurrentes caen en contenedores
 *  distintos y dos de los tres dictados se pierden — medido el 2026-08-17, y no es una carrera que se
 *  resuelva sola: la cédula perdida devuelve la respuesta por defecto para siempre. El síntoma es
 *  cruel, porque el flujo TERMINA BIEN con datos que nadie pidió, y uno concluye «el ingreso no
 *  cambia el listado» cuando en realidad el ingreso nunca llegó. En serie, las tres quedan. */
async function dictarTodos(casos: Caso[]): Promise<string[]> {
    const fallos: string[] = [];
    for (let i = 0; i < casos.length; i++) {
        const doc = cedulaDe(i);
        // el escenario de cada integración va acá también: es preparación del caso, y se dicta
        // POR CÉDULA para que dos casos en paralelo puedan pedir cosas opuestas de la misma entidad
        for (const [lender, modo] of Object.entries(casos[i].escenarios ?? {})) {
            // ⚠ `preaprobado` NO es una entidad: es el estado que debe devolver el MICROSERVICIO de
            // pre-aprobados, y se aplica en su propia llamada. Mandarlo al admin API del mock de
            // integraciones lo rechaza y hace fallar la preparación del caso entero.
            if (lender === 'preaprobado') continue;
            const r = await fetch(`${MOCK_LENDERS}/__mock/escenario`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ lender, modo, doc }), signal: AbortSignal.timeout(8_000),
            }).catch(() => null);
            if (!r?.ok) fallos.push(`${lender}=${modo}`);
        }
        // ⚠ EL `score` DEL CASO NO LLEGABA A NINGÚN LADO en este camino: el buró lo sirve el mock y
        // devolvía siempre el del fixture (707). O sea que `score=750` era un **no-op silencioso** —el
        // caso corría, terminaba bien, y uno concluía «el score no mueve el listado» cuando el score
        // nunca cambió. Es la misma familia que F-139. El mock ya sabe pisarlo por cédula.
        if (casos[i].score) {
            await dictar(doc, 'experian_score', String(casos[i].score)).catch(() => {});
        }

        // hasta 4 intentos: cada POST puede caer en un contenedor distinto, así que reintentar
        // NO es supersticioso — es lo que hace que alguno pegue en el que después atiende la lectura
        let ok = false;
        for (let intento = 0; intento < 4 && !ok; intento++) {
            await dictar(doc, 'agildata', respuestaAgildata(doc, casos[i].income!, casos[i].ocupacion));
            ok = await confirmarDictado(doc, 'agildata', String(casos[i].income!));
        }
        if (ok) dictados.add(doc); else fallos.push(doc);
    }
    return fallos;
}

/** Envoltorio: corre el caso y SIEMPRE deja su bitácora, salga como salga. Está separado del motor
 *  porque el motor tiene una docena de salidas tempranas —cada una es un diagnóstico distinto— y
 *  envolverlas de a una era la forma de que alguna quedara sin volcar. */
async function correrLambda(c: Caso, i: number): Promise<Res> {
    const r = await correrLambdaMotor(c, i);
    await volcarBitacora(r, bitacoras.get(r.phone) ?? []);
    bitacoras.delete(r.phone);

    // LAS DOS MITADES DE UNA CORRIDA FALLIDA. La bitácora dice qué SE PIDIÓ —es nuestra y no tiene
    // ambigüedad—; la forense de Loki dice qué DECIDIÓ el backend, que es lo que la bitácora no puede
    // saber: una regla que excluyó una entidad no mueve ningún estado ni cambia ningún status HTTP.
    //
    // ⚠ Se dispara SÓLO si el caso salió mal, y eso no es tacañería: `forenseAlCerrar` paga un settle
    // más una consulta, y explicar un éxito no le sirve a nadie. Se traga cualquier error a propósito.
    if (!r.ok && r.ur) {
        await forenseAlCerrar(r.ur, { existe: true, ok: false, malo: false, miente: [] })
            .catch(() => { /* un forense que tumba la corrida que vino a explicar es peor que no tenerlo */ });
    }
    return r;
}

async function correrLambdaMotor(c: Caso, i: number): Promise<Res> {
    const doc = cedulaDe(i);
    const base: Res = { caso: c, ok: false, phone: '' };

    const tel = telefonoDe(i);   // el mismo para listar y para cerrar (ver `registrarBypass`)
    base.phone = tel;

    // ⚠ `x.id AS allied` NO es cosmético: `preAprobar` lo manda como `merchant_id` y este lookup no
    // lo seleccionaba, así que viajaba `undefined`. El mock no valida ese campo y por eso el bug
    // sobrevivió — contra el microservicio real habría fallado. Los mocks permisivos esconden
    // exactamente esta clase de error (misma lección que F-140).
    const br = await buscarSucursal(c.comercio);
    if (!br) return { ...base, detalle: `no encontré el comercio «${c.comercio}»` };
    base.com = br.com;

    if (!dictados.has(doc)) return { ...base, detalle: 'la respuesta del buró no quedó dictada' };

    const H = { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA };
    // Cada llamada queda anotada (ver `volcarBitacora`). El costo es un push a un array; el beneficio
    // es no tener que repetir una corrida de 90 s para ver qué se pidió.
    const bitacora: Llamada[] = [];
    bitacoras.set(tel, bitacora);
    const t0Caso = Date.now();
    const anotar = (metodo: string, ruta: string, status: number, ms: number, cuerpo?: string) => {
        bitacora.push({ t: Date.now() - t0Caso, metodo, ruta, status, ms,
            // El cuerpo entero SÓLO cuando falló: es cuando hace falta, y evita volcar datos
            // personales de las respuestas buenas.
            ...(status >= 200 && status < 300 ? {} : { cuerpo: (cuerpo ?? '').slice(0, 600) }) });
    };

    // `extra` existe para el CODEUDOR: su credencial es un header (`X-Cosigner-Token`), no una sesión.
    const get = async (ruta: string, extra: Record<string, string> = {}) => {
        const t0 = Date.now();
        const r = await fetch(`${API}${ruta}`, { headers: { ...H, ...extra }, signal: AbortSignal.timeout(90_000) })
            .catch((e) => e as Error);
        // ⚠ UN TIMEOUT NO ES UNA CAÍDA, Y `HTTP 0` LOS CONFUNDE. Medido el 2026-08-23: con nueve casos
        // en paralelo, la generación de documentos de Motai y Pullman tardó **90.002 ms** —clavó el
        // límite— y el runner reportó «devolvió HTTP 0», que se lee como que el backend se murió. No se
        // murió: tardó, por la misma razón de F-166 (llamadas remotas dentro de una transacción
        // abierta, que bajo concurrencia se serializan). Decir cuál de las dos cosas fue cambia dónde
        // se busca la causa.
        if (r instanceof Error) {
            const expiro = /timeout|abort/i.test(String(r));
            const ms = Date.now() - t0;
            anotar('GET', ruta, 0, ms, String(r).slice(0, 200));
            return { status: 0, json: {} as any,
                     motivo: expiro ? `se pasó de los ${Math.round(ms / 1000)} s de espera (no falló: tardó)`
                                    : String(r.message).slice(0, 120) };
        }        const t = await r.text();
        anotar('GET', ruta, r.status, Date.now() - t0, t);
        try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: {} as any }; }
    };
    const post = async (ruta: string, body: unknown, extra: Record<string, string> = {}) => {
        const t0 = Date.now();
        const r = await fetch(`${API}${ruta}`, { method: 'POST', headers: { ...H, ...extra },
            body: JSON.stringify(body), signal: AbortSignal.timeout(150_000) }).catch((e) => e as Error);
        if (r instanceof Error) {
            anotar('POST', ruta, 0, Date.now() - t0, String(r).slice(0, 200));
            return { status: 0, json: { message: String(r.message).slice(0, 120) } };
        }
        const t = await r.text();
        anotar('POST', ruta, r.status, Date.now() - t0, t);
        try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: { raw: t.slice(0, 200) } }; }
    };

    const reg = await post('/api/onboarding/phone/register', {
        phone_number: tel, phoneNumber: tel, terms: true, policies: true,
        otp_length: 4, otpLength: 4, partner_branch_hash: br.hash, partnerBranchHash: br.hash });
    const uid = reg.json?.data?.user?.id;
    if (!uid) return { ...base, detalle: `register HTTP ${reg.status}` };

    const otp = await post(`/api/onboarding/loan-application/otp-validate/${br.hash}`, {
        cell_phone: tel, otp_code: tel.slice(-4),
        original_amount: c.amount, amount: c.amount });
    // ⚠ el uReq viene en `errors.payload`, NO en `payload`: el usuario es temporal y la respuesta
    // llega como error `ONB002 "temporal user found"`. Es la trampa 3 del documento de la tarea.
    // ⚠ EL uReq VIENE EN TRES LUGARES DISTINTOS según cómo terminó la validación, y mirar sólo dos
    // hace fallar el caso con «otp-validate sin uReq (HTTP 200)» — un mensaje que se contradice solo:
    // HTTP 200 y sin dato. Se vio a 30 en paralelo, con el comercio `creditop`.
    //   · usuario TEMPORAL  → llega como ERROR `ONB002 "temporal user found"` en `errors.payload`
    //   · usuario ya válido → llega como éxito en `data.payload`
    //   · variante suelta   → `payload` a secas
    const ur = otp.json?.errors?.payload?.user_request_id
        ?? otp.json?.data?.payload?.user_request_id
        ?? otp.json?.payload?.user_request_id;
    if (!ur) return { ...base, detalle: `otp-validate sin uReq (HTTP ${otp.status})` };
    base.ur = ur;

    // EL CLIENTE QUE VUELVE NO SE REGISTRA DE NUEVO.
    //
    // `personal-info` es el paso que CREA la persona: cédula, nombre, correo, fechas. En la segunda
    // solicitud del mismo cliente esos datos ya existen, y mandarlos otra vez hace que el backend
    // conteste «El correo electrónico ya se encuentra registrado» — correctamente. La solicitud NO se
    // pierde por saltearlo: la crea `otp-validate`, dos llamadas antes.
    //
    // ⚠ Que sea un `if` y no un camino aparte es a propósito: el resto del recorrido —listado,
    // selección, cierre— es EL MISMO. Si un cliente recurrente viera un listado distinto, eso es
    // justamente lo que se quiere medir, y sólo se puede medir si lo demás no cambia.
    if (!c.recurrente) {
        // EL TIPO DE DOCUMENTO SALE DEL COMERCIO, no de acá.
        //
        // ⚠ Estaba quemado en `'CC'`, y por eso este runner no podía probar un comercio que no fuera
        // colombiano: contra el dominicano el backend contesta —bien— «El tipo de documento no está
        // habilitado en este punto de venta». El backend ya publica la lista en el payload del comercio,
        // así que se pide y se usa la primera. Si no la publica (backend viejo), se cae a `CC`, que es lo
        // que había.
        const tipoDoc = await tipoDeDocumentoDelComercio(br.hash);
        const pi = await post(`/api/onboarding/loan-application/personal-info/${br.hash}/${ur}`, {
            document_type: tipoDoc, document_number: doc, name: 'CARLOS', surname: 'RUIZ',
            email: `qa${doc}@gmail.com`,
            expedition_day: 10, expedition_month: 5, expedition_year: 2019,
            birth_day: 10, birth_month: 5, birth_year: 2001,
            // ⚠ El ESTRATO no lo pide todo comercio, pero cuando lo pide corta el flujo con
            // `STRATUM_REQUIRED` en el tercer paso — y sin él quedaban fuera del barrido comercios
            // enteros, entre ellos los de Credifamilia. Va siempre: los que no lo piden lo ignoran.
            stratum: 3 });
        if (pi.json?.success !== true) {
            return { ...base, conducta: 'personal-info rechazó',
                     detalle: `${pi.json?.errors?.error_subcode ?? ''} ${JSON.stringify(pi.json?.errors?.payload ?? pi.json?.message ?? '').slice(0, 90)}` };
        }
    }

    // LAS DOS FOTOS DE LA CÉDULA, que este camino nunca deja. En un flujo real las escribe la
    // validación de identidad; acá se saltea, así que quedan en NULL — y el hueco NO se ve hasta el
    // final: la solicitud llega igual a estado 11 y recién la FORMALIZACIÓN muere con «faltan
    // documentos obligatorios: Cédula frontal, Cédula reverso». Como el runner ya reportó «CERRÓ en
    // 11», se lee como si el flujo hubiera terminado entero, y no terminó: el paquete nunca se radicó.
    //
    // Un string cualquiera alcanza —la validación es sólo que la URL no esté vacía
    // (`CredifamiliaLegalizationDocumentService::isUsableUrl`) y el merge lo resuelve el pdf-mapper, que
    // en local es un mock y no descarga nada—. Se les da forma de URL de S3 para reconocerlas como
    // sintéticas al mirar la base.
    await exec(
        'UPDATE users SET front_url=?, back_url=?, updated_at=NOW() WHERE id=?',
        [`https://mock-s3.local/front-web/users/documents/synth/${doc}/frontal.jpg`,
         `https://mock-s3.local/front-web/users/documents/synth/${doc}/reverso.jpg`, uid],
    ).catch(() => null);

    // ⚠ EL MONTO VA EN LA QUERY, y sin él el backend usa 180.000 por default
    // (`ListLenderController::index:39` — `$request->query('amount', 180000)`), NO el monto de la
    // solicitud. Todo lo medido hasta el 2026-08-22 se calculó con 180 mil sin que nada avisara: los
    // tramos y las categorías se evalúan contra ESE número, así que un lender cuyo mínimo es más alto
    // desaparece del listado por una razón que no tiene que ver con el caso planteado.
    // ⚠ EL BURÓ SE CONSULTA DURANTE EL LISTADO, no antes — así que la fila que el perfilamiento
    // necesita (F-159) recién existe DESPUÉS de la primera llamada. Se espeja y se vuelve a pedir: la
    // primera crea el buró, la segunda es la que corre la etapa completa. Cuesta una petición y es la
    // diferencia entre simular el listado y simularlo entero.
    // ⚠ `lenders-v2`, NO `lenders`. SON DOS LISTADOS DISTINTOS Y NO DEVUELVEN LO MISMO.
    //
    // La ruta vieja (`lenders`) va a `ListLenderController` → `LenderRetrievalService::getLenders`; la
    // v2 va a `LenderListingController` → `LenderListingService::getLenders`. Las dos clases existen,
    // están emparentadas y definen el MISMO método — pero la v1 arrastra cortes que la v2 no tiene,
    // entre ellos una lista de ids quemada (`[12, 23, 141, 142, 166]`) y las salidas de la
    // pre-aprobación.
    //
    // Medido sobre la MISMA solicitud: v1 devuelve 3 entidades y v2 devuelve 5 — las dos que faltaban
    // eran Welli y Credifamilia. **El wizard usa v2**, así que pegarle a v1 mide un listado que ningún
    // cliente ve, y una ausencia ahí se lee como regla de negocio cuando es el endpoint equivocado.
    const pedirListado = () =>
        fetch(`${API}/api/onboarding/loan-application/lenders-v2/${ur}?amount=${c.amount}`, { headers: H })
            .then((r) => r.json()).catch(() => null);

    let lis = await pedirListado();
    if (await espejarBuroParaPerfilamiento(ur)) lis = (await pedirListado()) ?? lis;
    // ⚠ «CERO ENTIDADES» Y «LA LLAMADA FALLÓ» NO SON LO MISMO, y hasta el 2026-08-18 esto los
    // reportaba igual: un comercio cuyo listado reventaba salía como «0 entidades», que se lee como
    // un hecho de negocio («no ofrece nada») cuando es una excepción de PHP. Pasó de verdad — un
    // lender con host nulo tira `PendingRequest::baseUrl(): Argument #1 must be of type string, null
    // given` y se lleva el listado ENTERO del comercio, no sólo esa card.
    if (lis?.exception || (lis?.success === false) || (lis?.message && !lis?.data)) {
        return { ...base, ok: false, nombre: `doc ${doc}`, conducta: 'el LISTADO falló',
                 detalle: String(lis.message ?? lis.exception).split('\n')[0].slice(0, 110) };
    }
    const crudo = lis?.data ?? lis;
    const arr: any[] = Array.isArray(crudo) ? crudo : Array.isArray(crudo?.lenders) ? crudo.lenders : [];
    base.listado = arr.map((x) => Number(x.id ?? x.lender_id)).filter(Boolean);

    // LO QUE HARÍA EL FRONT. Sin esto la corrida termina en el listado y la pre-aprobación NO ocurre
    // —sin fallar, que es lo peor (F-141)—. Se dispara una por entidad elegible y en paralelo, igual
    // que el loader del wizard, con el payload de `fetch-lender-preapproval.ts:154-170`.
    if (flag('preaprobados')) {
        const elegibles = arr.filter((l) => Number(l.response_type) !== 0);
        base.preaprobados = await Promise.all(elegibles.map((l) =>
            preAprobar(l, ur, uid, br.allied, br.hash, c.amount!, c.escenarios?.preaprobado)));
    }

    // ⚠ El camino con lambda NO calculaba esto y el reporte decía SIEMPRE «la pedida NO estaba»,
    // incluso cuando la entidad estaba en el listado impreso dos palabras antes. Un runner que se
    // contradice a sí mismo en la misma línea es peor que uno que calla: manda a buscar una causa de
    // negocio para un bug del reporte. (El otro camino sí lo calculaba — quedaron dos implementaciones
    // y sólo una completa.)
    if (c.lender !== null) base.enListado = base.listado!.includes(c.lender);

    let cierre = '';
    if (flag('cerrar')) {
        const r = await cerrarCreditopX(arr, ur, tel, c.amount!, post, get, c.lender, c.cuotas ?? 4);
        base.cierre = r;
        cierre = r.cerro ? ` · CERRÓ en estado ${r.estado} (${r.motivo})`
                         : ` · NO cerró: ${r.motivo}${r.estado ? ` (quedó en estado ${r.estado})` : ''}`;

        // El desenlace de un rt=1 llega DESPUÉS y por otro lado: la entidad avisa por webhook. Sólo se
        // dispara si el caso lo pidió, y sólo tiene sentido cuando el cierre en plataforma no aplica.
        if (c.webhook) {
            // CADA FAMILIA AVISA POR SU LADO, y no son intercambiables: rt=1 tiene un webhook POR
            // ENTIDAD (`welli/webhook`, `prami/webhook`, …) y rt=0 uno GENÉRICO para todas
            // (`self-manager/webhook`). Mandar el payload de una al endpoint de la otra da 404 o 422,
            // que se lee como «el webhook no funciona» y no como «te equivocaste de familia».
            const fam = await one<{ rt: number }>(
                'SELECT response_type rt FROM lenders WHERE id=?', [c.lender]).catch(() => null);
            const w = fam?.rt === 0 ? await webhookSelfManager(ur, c.lender!, c.webhook)
                : fam?.rt === 1 && WELLI_IDS.includes(c.lender!) ? await webhookIntegracion(ur, c.webhook)
                : { ok: false, detalle: fam?.rt === 1
                        ? `rt=1 fuera de la familia Welli: su webhook existe pero este runner sólo maneja el de Welli`
                        : `\`@webhook=\` no aplica a rt=${fam?.rt ?? '?'}: esa familia cierra en plataforma` };
            base.cierre = { ...r, webhook: w.detalle };
            cierre += `\n        ${w.ok ? '↩' : '⚠'} ${w.detalle}`;
        }
    }

    return { ...base, ok: arr.length > 0, nombre: `doc ${doc}`,
             conducta: `listado con ${arr.length} entidades · buró dictado: ibc ${c.income!.toLocaleString('es-CO')}${cierre}` };
}

async function correr(c: Caso, i: number): Promise<Res> {
    if (flag('lambda')) return correrLambda(c, i);
    const phone = telefono(i);
    const base: Res = { caso: c, ok: false, phone };

    const br = await buscarSucursal(c.comercio);
    if (!br) return { ...base, detalle: `no encontré el comercio «${c.comercio}»` };
    base.com = br.com;

    if (c.lender !== null) {
        const len = await one<{ name: string }>('SELECT name FROM lenders WHERE id=?', [c.lender]).catch(() => null);
        base.nombre = len?.name ?? `lender ${c.lender}`;
    }

    const reg = await http('POST', '/api/onboarding/phone/register', {
        phone_number: phone, phoneNumber: phone, terms: true, policies: true,
        otp_length: 4, otpLength: 4, partner_branch_hash: br.hash, partnerBranchHash: br.hash,
    }, phone);
    const uid = reg.json?.data?.user?.id;
    if (!uid) return { ...base, detalle: `register HTTP ${reg.status}` };

    const asesor = (await one<{ id: number }>(
        'SELECT id FROM users WHERE allied_branch_id=? AND cognito_id IS NOT NULL LIMIT 1', [br.id])
        .catch(() => null))?.id ?? null;
    const amount = c.amount!;
    const ins = await exec(
        `INSERT INTO user_requests (user_id, allied_id, allied_branch_id, lender_id, amount,
           original_amount, user_request_status_id, corporate_user_id, credit_line_id, fee_number,
           fee_value, rate, created_at, updated_at) VALUES (?,?,?,NULL,?,?,1,?,1,0,0,0,NOW(),NOW())`,
        [uid, br.allied, br.id, amount, amount, asesor]).catch(() => null);
    if (!ins?.insertId) return { ...base, detalle: 'no se pudo crear la solicitud' };
    const ur = ins.insertId;
    base.ur = ur;

    await synthFill(ur, { income: c.income!, score: c.score! });

    const lis = await http('GET', `/api/onboarding/loan-application/lenders/${ur}`, undefined, phone);
    const crudo = lis.json?.data ?? lis.json;
    const arr: any[] = Array.isArray(crudo) ? crudo : Array.isArray(crudo?.lenders) ? crudo.lenders : [];
    base.listado = arr.map((x) => Number(x.id ?? x.lender_id)).filter(Boolean);
    base.enListado = c.lender !== null && base.listado.includes(c.lender);

    // Sin entidad pedida, el caso TERMINA en el listado. Es el recorrido más corto que ya prueba
    // algo real —monto → solicitud → datos de riesgo → qué se le ofrece— y no arrastra la bifurcación
    // por entidad, que es donde el flujo se vuelve N flujos distintos.
    if (c.lender === null) {
        return { ...base, ok: arr.length > 0, conducta: `listado con ${arr.length} entidades`,
                 detalle: arr.length ? '' : 'el listado vino VACÍO' };
    }

    // Se selecciona AUNQUE no esté en el listado: que el backend acepte una entidad que no ofreció
    // es en sí un resultado, y callarlo lo escondería.
    const sel = await http('POST', `/api/onboarding/loan-application/update-user-request/${ur}`, {
        lender_id: c.lender, fee_number: 4, original_amount: amount, amount,
        initial_fee: 0, rate: '0', transaction_data: null,
    }, phone);
    if (sel.status !== 200 || sel.json?.success === false) {
        return { ...base, ok: false, conducta: 'ERROR al seleccionar',
                 detalle: String(sel.json?.message ?? sel.json?.raw ?? `HTTP ${sel.status}`).split('\n')[0].slice(0, 100) };
    }
    return { ...base, ok: true, conducta: conductaDe(sel.json?.data) };
}

/** Contrasta lo que cada caso DECLARA contra lo que pasó.
 *
 *  ⚠ FALLA CERRADO. Una expectativa que no se pudo evaluar —porque la corrida no llegó hasta ahí, o
 *  porque le faltó un flag— cuenta como desvío, no como éxito. Es la diferencia entre «lo verifiqué»
 *  y «no lo verifiqué», y confundirlas es lo que produce un verde que no significa nada.
 *
 *  Devuelve una línea por desvío, nombrando el caso y diciendo esperado vs obtenido — porque un
 *  «falló» pelado manda a reproducir a mano lo que el runner ya sabe. */
function verificarEsperas(res: Res[]): Array<{ res: Res; linea: string }> {
    const out: Array<{ res: Res; linea: string }> = [];
    for (const r of res) {
        const e = r.caso.espera;
        if (!e) continue;
        const quien = r.caso.nombre ?? `${r.caso.comercio}${r.caso.lender ? ':' + r.caso.lender : ''}`;

        if (e.enListado !== undefined) {
            if (r.caso.lender === null) {
                out.push({ res: r, linea: `${quien}: espera \`enListado\` pero el caso no pide ninguna entidad` });
            } else if (r.listado === undefined) {
                out.push({ res: r, linea: `${quien}: espera \`enListado\` y el listado ni se obtuvo (${r.detalle ?? 'sin detalle'})` });
            } else if (!!r.enListado !== e.enListado) {
                out.push({ res: r, linea: `${quien}: esperaba que la entidad ${r.caso.lender} ${e.enListado ? 'SÍ' : 'NO'}`
                    + ` estuviera en el listado, y ${r.enListado ? 'sí' : 'no'} estaba — listado: [${(r.listado ?? []).join(', ')}]` });
            }
        }

        if (e.entidades?.length) {
            if (r.listado === undefined) {
                out.push({ res: r, linea: `${quien}: espera entidades en el listado y el listado ni se obtuvo` });
            } else {
                const faltan = e.entidades.filter((x) => !r.listado!.includes(x));
                if (faltan.length) {
                    out.push({ res: r, linea: `${quien}: faltaron en el listado [${faltan.join(', ')}] — vino [${r.listado.join(', ')}]` });
                }
            }
        }

        if (e.noEntidades?.length) {
            if (r.listado === undefined) {
                out.push({ res: r, linea: `${quien}: espera entidades AUSENTES y el listado ni se obtuvo` });
            } else {
                const colados = e.noEntidades.filter((x) => r.listado!.includes(x));
                if (colados.length) {
                    out.push({ res: r, linea: `${quien}: no debían estar [${colados.join(', ')}] y aparecieron`
                        + ` — vino [${r.listado.join(', ')}]` });
                }
            }
        }

        if (e.cierra !== undefined || e.estado !== undefined || e.radicacion !== undefined) {
            if (!r.cierre) {
                out.push({ res: r, linea: `${quien}: declara algo del cierre pero la corrida no cerró nada`
                    + ' — ¿faltó `CERRAR=1`? (sin eso, esto NO está verificado)' });
            } else {
                if (e.cierra !== undefined && r.cierre.cerro !== e.cierra) {
                    out.push({ res: r, linea: `${quien}: esperaba que ${e.cierra ? 'CERRARA' : 'NO cerrara'} y ${r.cierre.cerro ? 'cerró' : 'no cerró'}`
                        + ` — ${r.cierre.motivo}` });
                }
                if (e.estado !== undefined && r.cierre.estado !== e.estado) {
                    out.push({ res: r, linea: `${quien}: esperaba estado ${e.estado} y quedó en ${r.cierre.estado ?? '—'}`
                        + ` — ${r.cierre.motivo}` });
                }
                // La radicación se exige aparte del estado a propósito: son dos preguntas y la
                // segunda puede fallar con la primera en verde (ver el comentario en `cerrarCreditopX`).
                if (e.radicacion !== undefined && r.cierre.radicacion !== e.radicacion) {
                    out.push({ res: r, linea: `${quien}: esperaba radicación \`${e.radicacion}\` y quedó en `
                        + `\`${r.cierre.radicacion ?? 'sin transacción'}\` — el crédito puede estar autorizado y NO radicado`
                        + ` — ${r.cierre.motivo}` });
                }
            }
        }
    }
    return out;
}

/** LA BITÁCORA DE UNA CORRIDA: qué hizo el runner, paso por paso.
 *
 *  POR QUÉ NO ALCANZA CON LOS LOGS DEL BACKEND. Ya existe una forense de Loki muy buena
 *  (`pkg/loki.ts`) y este runner ahora la dispara — pero tiene techos declarados: sólo ve
 *  `legacy-backend`, apenas una fracción de las líneas trae el `user_request_id` en su contexto, y la
 *  ausencia de una línea tiene cuatro causas indistinguibles. Sirve para entender **por qué el backend
 *  decidió algo**; no para saber **qué se le pidió**.
 *
 *  Y esa mitad —la nuestra— hoy no quedaba en ningún lado. Cuando un caso falla, la única forma de ver
 *  la secuencia era volver a correrlo, que con 90 s por caso y fallos intermitentes es exactamente lo
 *  que no se puede hacer. Esta bitácora es la mitad **sin ambigüedad**: la escribimos nosotros, cubre
 *  cada llamada, y no depende de que nadie haya logueado nada.
 *
 *  QUÉ GUARDA Y QUÉ NO. Ruta, método, status y milisegundos de cada llamada, siempre. Del cuerpo, sólo
 *  un extracto — y **completo únicamente cuando la respuesta no fue 2xx**, que es cuando hace falta.
 *  Guardar todos los cuerpos multiplicaría el archivo por veinte y metería datos personales en disco
 *  sin necesidad.
 *
 *  ⚠ Los milisegundos son de la LLAMADA, no del backend: incluyen la red y la cola del servidor de
 *  desarrollo. Con un solo worker, un número alto puede ser espera y no trabajo. */
type Llamada = { t: number; metodo: string; ruta: string; status: number; ms: number; cuerpo?: string };

/** Bitácora por caso. La clave es el TELÉFONO porque es lo único único por caso desde el primer
 *  instante — el `uReq` recién existe a la tercera llamada, y para entonces ya hay cosas que anotar. */
const bitacoras = new Map<string, Llamada[]>();

async function volcarBitacora(res: Res, llamadas: Llamada[]): Promise<void> {
    if (!llamadas.length) return;
    try {
        const { mkdir, writeFile } = await import('node:fs/promises');
        const dir = new URL('../.runs/', import.meta.url);
        await mkdir(dir, { recursive: true });
        const nombre = `caso-${res.ur ?? 'sin-ureq'}-${res.phone}.json`;
        await writeFile(new URL(nombre, dir), JSON.stringify({
            caso: res.caso.nombre ?? `${res.caso.comercio}${res.caso.lender ? ':' + res.caso.lender : ''}`,
            comercio: res.caso.comercio, lender: res.caso.lender,
            parametros: { amount: res.caso.amount, income: res.caso.income, score: res.caso.score },
            uReq: res.ur ?? null, telefono: res.phone,
            resultado: { ok: res.ok, conducta: res.conducta ?? null, detalle: res.detalle ?? null,
                         listado: res.listado ?? null, cierre: res.cierre ?? null },
            llamadas,
        }, null, 2) + '\n', 'utf8');
    } catch { /* la bitácora nunca puede tumbar la corrida que vino a explicar */ }
}

/** ESPEJA LA FILA DE BURÓ QUE EL PERFILAMIENTO BUSCA, y que en local nadie escribe (F-159).
 *
 *  `ProfilingRulesService` busca la central por **nombre exacto** —`Experian - Acierta`— y sólo si
 *  encuentra una fila con score para ese usuario corre `validateRulesByRiskCentral`. El recorrido de
 *  este runner persiste bajo `Experian - Acierta+Quanto`, que es OTRA fila del catálogo. Sin
 *  coincidencia, **una etapa entera de validación se saltea sin un solo log**, y uno razona sobre
 *  reglas de datacrédito que nunca llegaron a correr.
 *
 *  ⚠ Esto NO inventa datos: en **producción existen las dos filas** —medido: ~117 mil de una y ~35 mil
 *  de la otra, las dos vigentes—. Espejar la que falta hace que local se parezca a producción, que es
 *  justamente lo que un ambiente de pruebas tiene que hacer.
 *
 *  Se copia la fila tal cual (mismo score, mismo `data`, mismo `additional_info`) porque el objetivo es
 *  que la etapa CORRA con los datos del caso, no cambiar lo que la etapa vería. */
async function espejarBuroParaPerfilamiento(ur: number): Promise<boolean> {
    try {
        const orig = await one<{ id: number; user_id: number; score: number; data: string; info: string }>(
            `SELECT d.id, d.user_id, d.score, d.data, d.additional_info info
               FROM risk_central_user_data d
               JOIN risk_centrals rc ON rc.id = d.risk_central_id
               JOIN user_requests r ON r.user_id = d.user_id
              WHERE r.id = ? AND rc.name = 'Experian - Acierta+Quanto'
              ORDER BY d.id DESC LIMIT 1`, [ur]);
        if (!orig) return false;

        const destino = await one<{ id: number }>(
            "SELECT id FROM risk_centrals WHERE name = 'Experian - Acierta' LIMIT 1");
        if (!destino) return false;

        await exec('DELETE FROM risk_central_user_data WHERE user_id=? AND risk_central_id=?',
                   [orig.user_id, destino.id]);
        await exec(
            'INSERT INTO risk_central_user_data (uuid, user_id, risk_central_id, score, data, additional_info, created_at, updated_at) '
            + 'VALUES (UUID(), ?, ?, ?, ?, ?, NOW(), NOW())',
            // ⚠ `additional_info` es una columna JSON y el driver la devuelve YA parseada como objeto.
            // Reinsertarla tal cual da «Invalid JSON text» — hay que volver a serializarla.
            [orig.user_id, destino.id, orig.score, orig.data,
             typeof orig.info === 'string' ? orig.info : JSON.stringify(orig.info ?? {})]);
        return true;
    } catch (e) {
        // ⚠ NO se traga el error en silencio: un espejo que no ocurre deja el perfilamiento sin correr
        // y la corrida sale plausible e incompleta — exactamente lo que F-159 describe.
        console.log(`      ⚠ no se pudo espejar el buró para el perfilamiento: ${String(e).slice(0, 120)}`);
    }
    return false;
}

/** EL SUB-FLUJO DEL CODEUDOR, de punta a punta.
 *
 *  POR QUÉ ESTÁ ACÁ Y NO SE HACE A MANO. Es el camino más frágil de rt=2 —de acá salieron F-150, F-151
 *  y F-153— y hasta hoy era el único que pedía manos: ocho endpoints, dos actores y un token que no
 *  viaja por la respuesta. Un camino que sólo se prueba a mano se prueba una vez.
 *
 *  EL ORDEN NO ES NEGOCIABLE: el codeudor tiene que quedar `approved` y en etapa de firma ANTES de que
 *  el titular firme, porque el juego de documentos que se genera depende de la política. Firmar primero
 *  y registrar después produce documentos de la rama equivocada.
 *
 *  DOS COSAS QUE SÓLO PASAN EN LOCAL, y por eso están acá y no en el producto:
 *   · **El token de invitación no vuelve en la respuesta** — viaja por WhatsApp, que en local no sale
 *     (`invitationSent: false`). Se lee de `cosigners.invitation_token`.
 *   · **El AML no corre para nadie en local** (cero filas de `TusDatos - AML` en toda la base), y sin
 *     esa fila `evaluate-eligibility` devuelve `evaluated: false` para siempre. Se forja igual que en
 *     `dev/inyectar-aml.ts`; el `data` va CIFRADO como el cast de Laravel o el backend no lo lee.
 *
 *  ⚠ Y el buró del codeudor se inyecta con `userId`, no derivándolo de la solicitud: **comparte la
 *  `user_request` del titular**, así que sin eso los datos irían al titular y el codeudor quedaría sin
 *  buró — con su elegibilidad fallando al LEER en vez de al decidir (F-153). */
async function resolverCodeudor(
    ur: number, hash: string, telTitular: string, amount: number, post: any, get: any,
): Promise<{ ok: boolean; motivo: string; token?: string; tel?: string }> {

    const tel = `${telTitular.slice(0, -2)}99`;          // derivado del titular: distinto y reproducible
    const doc = String(2_900_000_000 + ur);

    const ini = await post(`/api/v1/user-request/${ur}/cosigner-flow/start`, {});
    if (ini.status !== 200) return { ok: false, motivo: `cosigner-flow/start HTTP ${ini.status}` };

    const reg = await post(`/api/v1/user-request/${ur}/cosigner`, { cellPhone: tel });
    if (reg.status !== 200) return { ok: false, motivo: `registrar codeudor HTTP ${reg.status}` };

    const fila = await one<{ t: string }>(
        'SELECT invitation_token t FROM cosigners WHERE user_request_id=? AND is_active=1 ORDER BY id DESC LIMIT 1',
        [ur]).catch(() => null);
    if (!fila?.t) return { ok: false, motivo: 'el codeudor no quedó con token de invitación' };
    const token = fila.t;

    // A partir de acá TODO va con el token: es la credencial del codeudor, no hay sesión.
    const conToken = (extra: Record<string, string> = {}) => ({ 'X-Cosigner-Token': token, ...extra });

    const inv = await get(`/api/v1/user-request/cosigner/invitation/${token}`, conToken());
    if (inv.status !== 200) return { ok: false, motivo: `el token de invitación no resolvió (HTTP ${inv.status})` };

    await post('/api/onboarding/phone/register', {
        phone_number: tel, phoneNumber: tel, terms: true, policies: true,
        otp_length: 4, otpLength: 4, partner_branch_hash: hash, partnerBranchHash: hash }, conToken());

    // ⚠ Esto NO crea una solicitud nueva: con el token, el backend devuelve la del TITULAR. Es la
    // señal de que el codeudor se está uniendo y no abriendo su propio crédito.
    const otp = await post(`/api/onboarding/loan-application/otp-validate/${hash}`, {
        cell_phone: tel, otp_code: tel.slice(-4), original_amount: amount, amount }, conToken());
    const urCod = otp.json?.errors?.payload?.user_request_id ?? otp.json?.data?.payload?.user_request_id;
    if (Number(urCod) !== ur) {
        return { ok: false, motivo: `el codeudor abrió otra solicitud (${urCod ?? '—'}) en vez de unirse a ${ur}` };
    }

    const pi = await post(`/api/onboarding/loan-application/personal-info/${hash}/${ur}`, {
        document_type: 'CC', document_number: doc, name: 'ANA', surname: 'GOMEZ',
        email: `qa${doc}@gmail.com`,
        expedition_day: 10, expedition_month: 5, expedition_year: 2019,
        birth_day: 10, birth_month: 5, birth_year: 2001 }, conToken());
    if (pi.json?.success !== true) {
        return { ok: false, motivo: `personal-info del codeudor: ${String(pi.json?.message ?? '').slice(0, 60)}` };
    }

    const uid = await one<{ u: number }>(
        'SELECT cosigner_user_id u FROM cosigners WHERE user_request_id=? AND is_active=1', [ur]).catch(() => null);
    if (!uid?.u) return { ok: false, motivo: 'el codeudor no quedó linkeado a un usuario' };

    // Las dos inyecciones que local exige (ver la cabecera).
    const rc = await one<{ id: number }>("SELECT id FROM risk_centrals WHERE name='TusDatos - AML' LIMIT 1").catch(() => null);
    if (rc) {
        await exec('DELETE FROM risk_central_user_data WHERE user_id=? AND risk_central_id=?', [uid.u, rc.id]);
        await exec('INSERT INTO risk_central_user_data (uuid, user_id, risk_central_id, score, data, created_at, updated_at) '
            + 'VALUES (UUID(), ?, ?, 0, ?, NOW(), NOW())',
            [uid.u, rc.id, encryptLaravelString(JSON.stringify({ estado: 'finalizado', hallazgos: [] }), appKey())]);
    }
    await synthFill(ur, { userId: uid.u, income: 4_000_000, score: 780 });

    const ele = await post(`/api/v1/user-request/${ur}/cosigner/evaluate-eligibility`, {}, conToken());
    const est = ele.json?.data ?? {};
    if (est.cosignerStatus !== 'approved') {
        return { ok: false, motivo: `el codeudor quedó ${est.cosignerStatus ?? '—'}`
            + (est.evaluated === false ? ' y NO se evaluó (¿le falta AML o identidad?)' : '') };
    }

    const etapa = await post(`/api/v1/user-request/${ur}/cosigner/enter-signature-stage`, {}, conToken());
    if (etapa.status !== 200) return { ok: false, motivo: `enter-signature-stage HTTP ${etapa.status}` };

    return { ok: true, motivo: 'codeudor aprobado y en etapa de firma', token, tel };
}

/** La firma del codeudor, DESPUÉS de la del titular. Cierra el crédito de verdad. */
async function firmaDelCodeudor(token: string, post: any, get: any): Promise<{ ok: boolean; motivo: string }> {
    const conToken = { 'X-Cosigner-Token': token };
    const V = '/api/v1/user-request/cosigner/signature';

    await get(`${V}/context`, conToken);
    await get(`${V}/documents`, conToken);

    const env = await post(`${V}/otp`, {}, conToken);
    if (env.status !== 200) {
        return { ok: false, motivo: `el OTP de firma del codeudor falló (${env.json?.code ?? env.status})`
            + ' — si es URV25003, mirá `OTP_SERVICE_HOST` (F-151)' };
    }
    // ⚠ El campo se llama `otp`, no `code`: con `code` responde URV27002 «datos de entrada».
    const ver = await post(`${V}/otp/verify`, { otp: '123456' }, conToken);
    if (ver.json?.code !== 'URV27000') {
        return { ok: false, motivo: `verify del codeudor: ${ver.json?.code ?? ver.status} ${String(ver.json?.message ?? '').slice(0, 50)}` };
    }
    return { ok: true, motivo: `firmado · ${ver.json?.data?.cosignerStatus ?? ''}` };
}

/** PASOS: varias solicitudes SUCESIVAS del MISMO cliente.
 *
 *  POR QUÉ. El caso más interesante que este harness no podía expresar es el cliente que **vuelve**:
 *  ya tiene un crédito y pide otro. Y no es hipotético — es lo que descubrimos por accidente cuando el
 *  runner reciclaba teléfonos: **un crédito activo bloquea el cupo rt=2, y el corte es por entidad**,
 *  así que la segunda solicitud del mismo cliente ve un listado distinto. Eso se leía como una regla
 *  de negocio rara; declarado como pasos, es una afirmación que se verifica sola.
 *
 *  EL MODELO: **paralelo entre clientes, secuencial dentro de un cliente.** Un `caso` es una persona;
 *  sus `pasos` son sus solicitudes en orden. Los casos siguen corriendo todos a la vez.
 *
 *  Cómo funciona, y por qué es tan poco código: el teléfono y la cédula se derivan del ÍNDICE del
 *  caso, no de la solicitud. Correr el mismo índice dos veces es, para el backend, la misma persona
 *  pidiendo de nuevo — que es exactamente lo que se quiere simular.
 *
 *  ⚠ Los pasos NO se paralelizan entre sí, y no es una limitación: el segundo paso sólo significa algo
 *  si el primero YA terminó. Paralelizarlos probaría una carrera, no un cliente recurrente.
 *
 *  ⚠ EL SEGUNDO PASO NO SE REGISTRA. Este runner arranca cada caso por el onboarding, y `personal-info`
 *  es el paso que CREA la persona; en la segunda vuelta el backend contesta —bien— «El correo
 *  electrónico ya se encuentra registrado». Por eso los pasos posteriores al primero viajan con
 *  `recurrente`, que saltea ese paso: la solicitud la crea `otp-validate`, antes. Es la diferencia
 *  real entre un cliente nuevo y uno que vuelve, y hasta hoy este harness sólo sabía probar el
 *  primero. */
async function correrPasos(c: Caso, i: number): Promise<Res[]> {
    const out: Res[] = [];
    for (let k = 0; k < c.pasos!.length; k++) {
        const paso = c.pasos![k];
        const nombreBase = c.nombre ?? c.comercio;
        const sub: Caso = {
            ...c,
            pasos: undefined,
            nombre: `${nombreBase} · paso ${k + 1}${paso.nombre ? ` (${paso.nombre})` : ''}`,
            recurrente: k > 0,
            lender: paso.lender === undefined ? c.lender : paso.lender,
            amount: paso.amount ?? c.amount,
            espera: paso.espera,
        };
        out.push(await correr(sub, i));
    }
    return out;
}

/** PREVUELO. Todo lo que este runner necesita vive FUERA del repo —el `.env` del backend y dos mocks
 *  levantados a mano— y cuando falta algo, el flujo NO se rompe: devuelve un resultado plausible y
 *  equivocado. Las tres formas ya documentadas:
 *    · drivers KYC en `fake` → el buró contesta siempre lo mismo → «el ingreso no cambia nada» (F-139)
 *    · mock de integraciones caído → la entidad desaparece → «la excluye una regla» (F-140)
 *    · `CREDIFAMILIA_HOST_OAUTH` ausente → el listado revienta → «el comercio no ofrece nada» (F-142)
 *  Las tres se leen como hechos del negocio. Por eso esto avisa ANTES, en vez de dejar que el próximo
 *  las descubra una por una como pasó el 2026-08-18. */
async function prevuelo(casos: Caso[] = []): Promise<string[]> {
    const faltan: string[] = [];
    const vivo = async (url: string) =>
        !!(await fetch(url, { signal: AbortSignal.timeout(5_000) }).catch(() => null));

    if (!(await vivo(`${API}/`))) faltan.push(`el backend no responde en ${API}`);
    if (!(await vivo(`${MOCK_LENDERS}/`))) {
        faltan.push(`mock de integraciones caído (${MOCK_LENDERS}) → las rt=1 desaparecen del listado`
            + ' y parece regla de negocio (F-140). Levantalo: node mock-lenders/server.mjs');
    }
    if (flag('preaprobados') && !(await vivo(PREAPPROVALS.replace(/\/v1\/.*$/, '/')))) {
        faltan.push(`mock de pre-aprobados caído (${PREAPPROVALS}). Levantalo: node mock-preapprovals/server.mjs`);
    }
    if (flag('lambda') && !(await vivo(`${LAMBDA}/agildata/agildata-services/rest/afiliado/historicoDetalladoEmpleo/1/1`))) {
        faltan.push(`la lambda de centrales no responde (${LAMBDA})`);
    }
    // Los dos de Credifamilia (rt=4). No se piden siempre porque sólo su cierre los toca, pero cuando
    // faltan el síntoma es el MISMO que un rechazo del negocio: la solicitud queda en estado 28 con
    // «Error de comunicación con Deceval» o con un secreto ausente, y ninguno de los dos mensajes
    // nombra al mock. Ver F-165.
    if (flag('cerrar')) {
        if (!(await vivo(DECEVAL))) {
            faltan.push(`mock de Deceval caído (${DECEVAL}) → Credifamilia se traba en estado 28 y parece`
                + ' un rechazo del pagaré (F-165). Levantalo: bin/mock-deceval start');
        }
        if (!(await vivo(NETCO))) {
            faltan.push(`mock de Netco caído (${NETCO}) → la firma de Credifamilia falla en estado 28`
                + ' (F-165). Levantalo: bin/mock-netco start');
        }
        // Éste NO traba la solicitud: sin él el backend sale al sandbox REAL del lender, la
        // solicitud llega igual a estado 11 y sólo la RADICACIÓN queda en CREDIT_ERROR. O sea que
        // faltando este mock el runner dice «cerró» y el crédito nunca se radicó.
        if (!(await vivo(CREDIFAMILIA))) {
            faltan.push(`mock de radicación de Credifamilia caído (${CREDIFAMILIA}) → el backend sale al`
                + ' sandbox REAL del lender y la radicación queda en CREDIT_ERROR con la solicitud igual en'
                + ' estado 11. Levantalo: bin/mock-credifamilia start');
        }
    }
    // El monolito viejo, y SÓLO si algún caso pidió el webhook: es una dependencia pesada (otro Laravel
    // entero) y exigirla siempre volvería obligatorio levantarla para correr cualquier cosa.
    if (casos.some((c) => c.webhook)) {
        if (!(await vivo(`${APP_VIEJA}/`))) {
            faltan.push(`un caso pidió \`@webhook=\` y \`legacy-application\` no responde en ${APP_VIEJA}.`
                + ' Es el ÚNICO que recibe los webhooks de rt=1 (F-170). Levantalo:'
                + ' cd ~/Desktop/CREDITOP/github/legacy-application && php artisan serve --port=8000');
        }
    }
    return faltan;
}



/** POSTVUELO del buró: ¿el ingreso que se DICTÓ llegó de verdad? Es la única comprobación que
 *  distingue «el parámetro no influye» de «el parámetro nunca llegó», y las dos se ven igual en el
 *  listado. Si los drivers KYC están en `fake`, acá salta. */
async function buroLlego(res: Res[]): Promise<string | null> {
    const conUr = res.filter((r) => r.ur && r.caso.income);
    if (!conUr.length) return null;
    const vistos = new Set<number>();
    for (const r of conUr) {
        const row = await one<{ a: string }>(
            'SELECT s.agildata a FROM user_requests u JOIN user_summaries s ON s.user_id=u.user_id WHERE u.id=?',
            [r.ur]).catch(() => null);
        const m = /"last_payment_value":\s*(\d+)/.exec(row?.a ?? '');
        if (m) vistos.add(Number(m[1]));
    }
    const pedidos = new Set(conUr.map((r) => r.caso.income!));
    if (vistos.size === 1 && pedidos.size > 1) {
        return `el buró devolvió SIEMPRE ${[...vistos][0].toLocaleString('es-CO')} pese a que se`
            + ` dictaron ${pedidos.size} ingresos distintos → los drivers KYC están en \`fake\` e`
            + ' interceptan antes que la lambda (F-139). No concluyas nada de estas corridas.';
    }
    return null;
}

async function main(): Promise<number> {
    const dflt = {
        amount: Number(arg('amount', '2000000')),
        income: Number(arg('income', '2500000')),
        score: Number(arg('score', '700')),
    };
    const casos: Caso[] = arg('suite')
        ? await cargarSuite(arg('suite'), dflt)
        : arg('casos')
            ? arg('casos').split(';').map((x) => parseCaso(x, dflt))
            : [parseCaso(`${arg('comercio', 'pullman')}${arg('lender') ? ':' + arg('lender') : ''}`, dflt)];
    const par = flag('paralelo');

    console.log(`\n  CASOS · ${casos.length} · ${par ? 'EN PARALELO' : 'en serie'} · ${API}\n`);
    const faltan = await prevuelo(casos);
    if (faltan.length) {
        console.log('  ⚠ PREVUELO — falta algo, y sin esto el resultado MIENTE:\n');
        for (const f of faltan) console.log(`      · ${f}`);
        console.log('');
        return 2;
    }
    if (flag('lambda')) {
        const fallos = await dictarTodos(casos);
        console.log(`  respuestas del buró pedidas a la lambda: ${casos.length - fallos.length}/${casos.length}`
            + (fallos.length ? `  ⚠ fallaron ${fallos.join(', ')}` : '') + '\n');
    }
    // Los teléfonos de esta tanda entran a la lista de bypass ANTES de arrancar, de una y en serie
    // (ver `registrarBypass`). Sólo si se va a cerrar: para el listado el driver fake no mira el
    // teléfono, así que ampliar la lista sería tocar la BD sin necesidad.
    if (flag('cerrar')) {
        const tels = casos.map((_, i) => telefonoDe(i));
        bypassOriginal = await registrarBypass(tels).catch(() => null);
        if (bypassOriginal === null) {
            console.log('  ⚠ no se pudo ampliar `qa_otp_bypass_phones`: la firma del pagaré va a fallar'
                + ' con 422 y la solicitud va a quedar en estado 10, que no se parece a la causa.\n');
        }
    }

    const t0 = Date.now();
    // Un caso con `pasos` devuelve VARIOS resultados; uno normal, uno. Se aplana para que el resto del
    // reporte —y el verificador— no tengan que saber de la diferencia.
    const unCaso = (c: Caso, i: number): Promise<Res[]> =>
        (c.pasos?.length ? correrPasos(c, i) : correr(c, i).then((r) => [r]))
            .catch((e) => [{ caso: c, ok: false, phone: telefono(i), detalle: String(e).slice(0, 90) } as Res]);

    const res = par
        ? (await Promise.all(casos.map((c, i) => unCaso(c, i)))).flat()
        : await (async () => {
            const out: Res[] = [];
            for (let i = 0; i < casos.length; i++) {
                out.push(...await unCaso(casos[i], i));
            }
            return out;
        })();

    for (const r of res) {
        const c = r.caso;
        const cab = `${c.comercio} → ${c.lender === null ? 'listado' : (r.nombre ?? c.lender)}`
            + `   [monto ${(c.amount ?? 0).toLocaleString('es-CO')} · ingreso `
            + `${(c.income ?? 0).toLocaleString('es-CO')} · score ${c.score}]`;
        console.log(`  ${r.ok ? '✓' : '✗'} ${cab}`);
        console.log(`      uReq ${r.ur ?? '—'} · tel ${r.phone}`
            + (r.listado ? ` · listado: [${r.listado.join(', ')}]`
                + (r.caso.lender === null ? '' : ` · la pedida ${r.enListado ? 'SÍ' : '**NO**'} estaba`) : ''));
        console.log(`      ${r.conducta ?? '—'}${r.detalle ? ` · ${r.detalle}` : ''}`);
        if (r.preaprobados?.length) {
            console.log(`      PRE-APROBADOS (lo que dispara el front · ${r.preaprobados.length} entidades):`);
            for (const q of r.preaprobados) {
                console.log(`          ${String(q.id).padStart(4)}  ${q.estado}`
                    + (q.cupo ? `  cupo ${Number(q.cupo).toLocaleString('es-CO')}` : ''));
            }
        }
    }
    // EL CONTRASTE, que es para lo que sirve correr varios. Una lista por caso obliga a diffear a
    // ojo, y el ojo se equivoca justo cuando los conjuntos son parecidos — que es el caso interesante.
    const conListado = res.filter((r) => r.listado?.length);
    if (conListado.length > 1) {
        const sets = conListado.map((r) => new Set(r.listado!));
        const comun = [...sets[0]].filter((x) => sets.every((s) => s.has(x)));
        console.log(`\n  EN QUÉ SE DIFERENCIAN\n`);
        console.log(`    en TODOS los casos : ${comun.length ? comun.join(', ') : '(ninguna)'}`);
        for (let k = 0; k < conListado.length; k++) {
            const solo = conListado[k].listado!.filter((x) => !sets.every((s) => s.has(x)));
            const c = conListado[k].caso;
            const etiq = `${c.comercio}${c.lender === null ? '' : ':' + c.lender}`;
            console.log(`    sólo en ${etiq.padEnd(18)}: ${solo.length ? solo.join(', ') : '(nada propio)'}`);
        }
        // ⚠ listados IDÉNTICOS no significan «el parámetro no influye»: puede significar que el
        // parámetro nunca llegó. Con `--lambda`, la comprobación es que `approximate_real_salary` en
        // `user_summaries` sea distinto por caso (ver F-139).
        if (conListado.every((r) => r.listado!.length === comun.length)) {
            console.log(`\n    ⚠ todos idénticos. Antes de concluir «no influye», verificá que el dato`);
            console.log(`      LLEGÓ: SELECT agildata FROM user_summaries WHERE user_id=… (F-139)`);
        }
    }

    // El recuento del cierre va aparte del de casos: «sin CreditopX» NO es un fallo, es un hecho del
    // comercio, y mezclarlos haría ver rota la mitad del catálogo.
    const conCierre = res.filter((r) => r.cierre);
    if (conCierre.length) {
        const cerraron = conCierre.filter((r) => r.cierre!.cerro).length;
        const sinCtopx = conCierre.filter((r) => r.cierre!.motivo === 'sin CreditopX').length;
        // Los que deciden AFUERA (rt=0/1) no se cuentan como trabados: no hay cierre que probar acá.
        const afuera = conCierre.filter((r) => r.cierre!.fueraDePlataforma).length;
        const trabados = conCierre.length - cerraron - sinCtopx - afuera;
        // El encabezado decía «CIERRE rt=2» siempre, incluso corriendo rt=3 y rt=4 — un rótulo que
        // contradice a la línea de abajo y hace dudar de cuál de las dos es la cierta.
        // Un caso que cerró POR WEBHOOK no cerró «en plataforma», pero tampoco se quedó sin desenlace:
        // contarlo sólo como «decide afuera» lo esconde, que es el error contrario al que se arregló
        // antes. Se cuenta aparte, con su propia palabra.
        const porWebhook = conCierre.filter((r) => r.cierre!.webhook?.startsWith('webhook')).length;
        console.log(`\n  CIERRE — ${cerraron} cerraron en estado 11 · ${sinCtopx} sin CreditopX`
            + (afuera ? ` · ${afuera} deciden afuera (rt=0/1)` : '')
            + (porWebhook ? ` · ${porWebhook} con desenlace por webhook` : '')
            + (trabados ? ` · ⚠ ${trabados} se trabaron` : ''));
        for (const r of conCierre.filter((x) => !x.cierre!.cerro && x.cierre!.motivo !== 'sin CreditopX'
                                               && !x.cierre!.fueraDePlataforma)) {
            console.log(`      ⚠ ${r.caso.comercio}: ${r.cierre!.motivo}`
                + (r.cierre!.estado ? ` · quedó en estado ${r.cierre!.estado}` : ''));
        }
    }

    const mentira = await buroLlego(res);
    if (mentira) console.log(`\n  ⚠ ${mentira}`);

    const malos = res.filter((r) => !r.ok).length;
    console.log(`\n  ${res.length - malos}/${res.length} cerraron · ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const desvios = verificarEsperas(res);
    if (desvios.length) {
        console.log('\n  ⚠ NO CUMPLIERON LO QUE DECLARAN:\n');
        for (const d of desvios) console.log(`      · ${d.linea}`);
        console.log('');

        // Y para los que se desviaron, la otra mitad: qué DECIDIÓ el backend. «La entidad no salió en
        // el listado» es el desvío más común, y una regla que excluye una entidad **no mueve ningún
        // estado ni cambia ningún status HTTP** — así que la bitácora no puede explicarlo y el log de
        // reglas sí. Se pide una sola vez por solicitud aunque haya varios desvíos del mismo caso.
        for (const ur of new Set(desvios.map((d) => d.res.ur).filter(Boolean))) {
            await forenseAlCerrar(ur!, { existe: true, ok: false, malo: false, miente: [] }).catch(() => {});
        }
        return 1;
    }
    if (res.some((r) => r.caso.espera)) {
        const conEspera = res.filter((r) => r.caso.espera).length;
        console.log(`  ✓ ${conEspera} ${conEspera === 1 ? 'caso cumplió' : 'casos cumplieron'} lo que declaran\n`);
    }
    // ⚠ uReq REPETIDO entre casos sería la señal de que se pisaron. Con teléfono por caso no debería
    // pasar nunca; si pasa, hay un recurso compartido de verdad y hay que ir a buscarlo.
    const urs = res.map((r) => r.ur).filter(Boolean);
    if (new Set(urs).size !== urs.length) console.log('  ⚠ DOS CASOS COMPARTIERON SOLICITUD — se pisaron');
    console.log();
    return malos ? 1 : 0;
}

const code = await main().catch((e) => { console.error('\n  ✗', e); return 1; });
await restaurarBypass(bypassOriginal);
await close().catch(() => {});
process.exit(code);
