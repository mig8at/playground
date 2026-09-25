// case.ts — UN CASO HIPOTÉTICO de punta a punta: decís comercio y entidad, y corre.
//
//   node dev/case.ts --comercio pullman --lender 77
//   node dev/case.ts --casos 'pullman;pullman' --paralelo
//   node dev/case.ts --casos 'pullman@score=700;pullman@score=300,income=900000' --paralelo
//   node dev/case.ts --casos 'pullman:77;pullman:9' --paralelo
//   node dev/case.ts --comercio pullman --lender 77 --amount 3000000 --income 1200000 --score 520
//
// QUÉ CORRE: siembra la solicitud en ese comercio, le inyecta datos de riesgo, pide el LISTADO, y
// después SELECCIONA la entidad pedida y clasifica la conducta que devuelve el backend (standBy /
// modal de autogestión / redirect externo / OTP del lender / error). O sea: de cero hasta el punto en
// que el flujo se bifurca por entidad.
//
// ⚠ EL TELÉFONO ES POR CASO, Y ESA ES LA CONDICIÓN DEL PARALELO. Los runners que ya existían
// (`sweep.ts`, `qr-corbeta.ts`, `listing.ts`) comparten el fijo `3131010101` y arrancan llamando a
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
// LA IDENTIDAD, con `--manual`: deja al titular (y a su codeudor) con la validación manual que un
// humano aprueba en el admin, así el backend contesta `no_validation_required` en vez de mandar a la
// captura de documento y selfie. Sin el flag el runner cierra igual —el camino por API no pasa por esa
// pantalla— así que sirve para dos cosas distintas: probar el flujo COMO SI la identidad estuviera
// resuelta, y no depender de que el paso de identidad esté bien configurado en el ambiente. El detalle
// de las dos columnas y por qué no va por la API: `pkg/inject.ts::manualValidation`.
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

// El desenlace que llega de afuera (rt=0 y rt=1) vive en `pkg/`: lo usan este runner y el panel, y dos
// definiciones de «cómo contesta una entidad» derivarían hacia estados distintos.
const { integrationWebhook, webhookSelfManager, WELLI_IDS, OLD_APP } =
    await import('../pkg/entity-webhook.ts');
const { scalar, one, exec, close } = await import('../pkg/db.ts');
const { synthFill, manualValidation } = await import('../pkg/inject.ts');
const e2eConfigMod = await import('../pkg/config.ts');
const { config: e2eConfig } = e2eConfigMod;
const { appKey } = await import('../pkg/db.ts');
const { encryptLaravelString } = await import('../pkg/laravel-crypt.ts');
const { forensicOnClose } = await import('../pkg/loki.ts');
const { registerBypass, restoreBypass } = await import('../pkg/otp-bypass.ts');
const { syntheticPhone, coSignerPhone } = await import('../pkg/phones.ts');
const { findBranch, merchantDocumentType: documentType } = await import('../pkg/merchants.ts');

const API = e2eConfig.mockUrl;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
const { LAMBDA, dictate, dictateEmployment } = await import('../pkg/risk-lambda.ts');


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
const productKey = (rt: number, id: number, slug: string) =>
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
/** ⚠ EL NÚMERO DE INSTALLMENTS NO ES LIBRE: cada entidad acepta los suyos, y pedir uno que no ofrece corta
 *  el cierre con `CP050` («error durante el cálculo del plan de pagos») — un mensaje que no menciona
 *  las cuotas por ningún lado. Medido en producción: Credifamilia va en 24, 36, 48, 12, 6, 18 y 9 —
 *  **nunca en 4**, que es el default histórico de este runner. Se pasa por caso: `@cuotas=24`. */
async function closeCreditopX(arr: any[], ur: number, tel: string, amount: number,
                               post: any, get: any, order: number | null = null, installments = 4) {
    // Si el caso pidió una entidad concreta (`#hash:173`), se cierra por ÉSA. Sin pedido, el primer
    // rt=2 — que con varios CreditopX en el mismo comercio es arbitrario y llevaría a cerrar por otro.
    const ctopx = order
        ? arr.find((l) => Number(l.id) === order)
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
    if (order && !ctopx) return { cerro: false, motivo: `la entidad ${order} no salió en el listado`, estado: null };
    if (!ctopx) return { cerro: false, motivo: 'sin CreditopX', estado: null as number | null };

    const sel = await post(`/api/onboarding/loan-application/update-user-request/${ur}`, {
        lender_id: Number(ctopx.id), fee_number: installments, original_amount: amount, amount,
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
        const outside = rt === 0 || rt === 1;
        return {
            cerro: false, estado: null, fueraDePlataforma: outside,
            motivo: outside
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

    let coSignerToken: string | undefined;
    if (pol?.rc) {
        const codeValue = await resolveCoSigner(ur, pol.hash, tel, amount, post, get);
        if (!codeValue.ok) return { cerro: false, motivo: `${ctopx.name}: ${codeValue.motivo}`, estado: null };
        coSignerToken = codeValue.token;
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
    const list: any[] = Array.isArray(cycles) ? cycles : [cycles].filter(Boolean);
    const termOf = (x: any) => Number(x?.fee_number ?? x?.feeNumber ?? 0);

    // ⚠ EL PLAZO QUE QUEDA GUARDADO SALE DE ACÁ, NO DE LA SELECCIÓN DE ENTIDAD. Antes se tomaba
    // `cycles[0]` siempre, así que `@cuotas=36` viajaba en el update de arriba —donde sí decide si el
    // plazo se ofrece— y después este confirm lo PISABA con el primer ciclo de la lista. Medido el
    // 2026-08-23: pedir 12, 24 o 36 dejaba `user_requests.fee_number` en **4** en los tres casos, y el
    // caso igual daba verde. Un runner que informa un plazo que no corrió miente en la dirección más
    // cara: la de creer que se probó algo que no se probó.
    const chosen = list.find((x) => termOf(x) === installments);
    const cyc = chosen ?? list[0];
    if (!chosen && list.length) {
        const offered = list.map(termOf).filter(Boolean).join(', ') || '(la simulación no trae plazos)';
        console.log(`      ⚠ el plazo pedido (${installments}) NO está entre los que simula la entidad: ${offered}`);
        console.log(`        se cierra con ${termOf(cyc) || '?'} — el resultado NO prueba el plazo pedido`);
    }

    const urRow = await one<{ a: number }>('SELECT allied_id a FROM user_requests WHERE id=?', [ur]).catch(() => null);
    await post(`${PN}/${ur}/confirm-payment-schedule`, {
        user_request_id: ur, amount, lender_id: Number(ctopx.id), allied_id: urRow?.a,
        fee_number: termOf(cyc) || installments, selected_cycle: cyc ?? {} });

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
    const isImei = await one<{ p: string }>(
        `SELECT pa.name p FROM lenders l JOIN paths pa ON pa.id = l.path_id WHERE l.id = ?`,
        [Number(ctopx.id)]).catch(() => null);

    let aut;
    if (isImei?.p === 'IMEI') {
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
    const differed = aut.json?.data?.user_request?.deferred_for_cosigner
        ?? aut.json?.data?.deferred_for_cosigner;
    if (coSignerToken && differed) {
        const f = await coSignerSignature(coSignerToken, post, get);
        if (!f.ok) {
            const e = await one<{ e: number }>('SELECT user_request_status_id e FROM user_requests WHERE id=?', [ur])
                .catch(() => null);
            return { cerro: false, motivo: `${ctopx.name}: ${f.motivo}`, estado: e?.e ?? null };
        }
    }

    const end = await one<{ e: number }>(
        'SELECT user_request_status_id e FROM user_requests WHERE id=?', [ur]).catch(() => null);
    // ⚠ El MOTIVO, no sólo el status. Un `HTTP 422` a secas manda a adivinar: puede ser el pagaré, el
    // OTP, el cupo o el cronograma. El cuerpo lo dice, y sin él el diagnóstico cuesta una sesión.
    const why = aut.status === 200 ? '' :
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
        cerro: end?.e === 11,
        motivo: `${ctopx.name} · HTTP ${aut.status}${why}`
            + (rad?.n ? ` · radicación ${rad.n}${rad.n === 'CREDIT_COMPLETED' ? '' : ' ⚠'}` : ''),
        estado: end?.e ?? null,
        radicacion: rad?.n ?? null,
    };
}

/** Lo que el wizard dispara por cada entidad elegible después de recibir el listado.
 *  ⚠ Sólo para `response_type !== 0`: las STANDARD nunca usan el microservicio. */
async function preApprove(lender: any, ureq: number, userId: number, alliedId: number,
                          hash: string, amount: number, mockStatus?: string) {
    const payload: Record<string, unknown> = {
        applicant_id: userId,
        lending_product_key: productKey(Number(lender.response_type), Number(lender.id), String(lender.slug ?? '')),
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
    const url = mockStatus ? `${PREAPPROVALS}?status=${encodeURIComponent(mockStatus)}` : PREAPPROVALS;
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
const implicit = new Set<string>();
const flag = (n: string) => process.argv.includes(`--${n}`) || implicit.has(n);

// Base 313 + 7 dígitos. El índice del caso va al final para que dos casos NUNCA compartan usuario;
// se imprime en el reporte porque es lo que hace falta para ir a mirar la solicitud después.
/** La forma del celular de cada país donde se opera. */
// `PHONE_SHAPE` vive en `pkg/phones.ts`: la compartían este runner y `branchPhone`,
// cada uno con media lección. Ver el encabezado de ese archivo.


/** Lo que un caso DECLARA que debería pasar. Sin esto el runner sólo narra; con esto contesta
 *  «¿sigue valiendo?», que es la pregunta que se hace después de tocar código.
 *
 *  ⚠ UNA EXPECTATIVA QUE NO SE PUDO EVALUAR ACCOUNT COMO FALLA, no como éxito. Si un caso espera un
 *  cierre y la corrida no lleva `--cerrar`, eso es un error de la suite: darlo por bueno sería
 *  exactamente el verde falso que este harness ya se comió una vez. */
type Wait = {
    enListado?: boolean;      // ¿la entidad pedida salió en el listado?
    cierra?: boolean;         // ¿la solicitud llegó a cerrar?
    estado?: number;          // estado final exacto (11 autorizada, 28 pendiente desembolso, …)
    entidades?: number[];     // estas entidades TIENEN que estar en el listado (subconjunto, no igualdad)
    noEntidades?: number[];   // estas entidades NO pueden estar — para «ya tiene un crédito acá»
    /** Estado de la RADICACIÓN al lender (`CREDIT_COMPLETED`, `CREDIT_ERROR`, …). Es un paso posterior
     *  al estado 11 y puede fallar sin moverlo: exigirlo acá es la única forma de que una suite note
     *  que el crédito quedó autorizado pero nunca se radicó. */
    radicacion?: string;
    /** LA INTERNACIONALIZACIÓN, como aserción. `true` exige la REGLA contra el país del comercio leído
     *  de la base: el cliente nace con el país de su comercio, su documento es uno del catálogo de ese
     *  país y su celular tiene el largo de ese país. Un objeto además FIJA valores —`iso` (3 letras),
     *  `documento`, `celular` (largo), `moneda`— para que la suite grite si un comercio cambia de país
     *  sin que nadie lo haya decidido. Se evalúa contra la BASE, no contra la respuesta: es lo que quedó. */
    pais?: boolean | { iso?: string; documento?: string | string[]; celular?: number; moneda?: string };
};

type Case = {
    comercio: string; lender: number | null;
    nombre?: string; espera?: Wait;
    /** `Empleado` (default) | `Independiente`. Se DEDUCE del buró, no se inyecta — ver `agildataAnswer`. */
    ocupacion?: string;
    /** Cuántas cuotas pedir. ⚠ NO todas las entidades aceptan cualquier número — ver `closeCreditopX`. */
    cuotas?: number;
    /** `@webhook=fulfilled` — dispara el webhook REAL de la entidad en `legacy-application` para darle
     *  desenlace a un rt=1. Es OPT-IN a propósito: nunca debe pasar solo, porque el código que corre no
     *  es el de `legacy-backend` (F-170) y un desenlace automático se leería como si lo fuera. */
    webhook?: string;
    /** Este caso es una vuelta POSTERIOR del mismo cliente: ya está registrado. Ver `runSteps`. */
    recurrente?: boolean;
    /** Solicitudes SUCESIVAS del mismo cliente. Ver `runSteps`. */
    pasos?: Array<{ nombre?: string; lender?: number | null; amount?: number; espera?: Wait }>;
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
function parseCase(spec: string, dflt: { amount: number; income: number; score: number }): Case {
    const [left, params] = spec.split('@');
    const [merchant, l] = left.split(':');
    const c: Case = { comercio: merchant, lender: l ? Number(l) : null, ...dflt };
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
 *      "byDefault": { "amount": 2000000, "income": 2500000, "score": 700 },
 *      "casos": [
 *        { "nombre": "el RTO exige codeudor",
 *          "comercio": "motai", "lender": 173,
 *          "espera": { "inListing": true, "estado": 17 } }
 *      ]
 *    }
 *
 *  `byDefault` de la suite pisa a los flags de la corrida, y lo de cada caso pisa a `byDefault`:
 *  así una suite es reproducible sin depender de con qué flags la invocaron. */
async function loadSuite(path: string, dflt: { amount: number; income: number; score: number }): Promise<Case[]> {
    const { readFile } = await import('node:fs/promises');
    let json: any;
    try {
        json = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
        throw new Error(`no pude leer la suite ${path}: ${e}`);
    }
    if (!Array.isArray(json?.casos) || json.casos.length === 0) {
        throw new Error(`la suite ${path} no tiene un array \`casos\` con al menos un caso`);
    }
    // `requiere` deja que la suite prenda lo que necesita: `["cerrar", "lambda"]`.
    for (const f of (Array.isArray(json.requiere) ? json.requiere : [])) implicit.add(String(f));

    // `byDefault` alimenta TODOS los campos del caso, no sólo los tres numéricos. Al principio sólo
    // cubría `amount`/`income`/`score` y nadie lo notó porque las suites repetían comercio y entidad en
    // cada caso; una suite que los declaraba una vez arriba fallaba con «falta comercio», que suena a
    // suite mal escrita y no a un defecto por defecto que no se aplica.
    const base = { ...dflt, ...(json.porDefecto ?? {}) };
    return json.casos.map((c: any, i: number) => {
        const merchant = c?.comercio ?? (base as any).comercio;
        if (!merchant) throw new Error(`caso ${i} de la suite: falta \`comercio\` (ni en el caso ni en \`porDefecto\`)`);
        if (Array.isArray(c.pasos) && c.pasos.length === 0) {
            throw new Error(`caso ${i} de la suite: \`pasos\` está vacío — un cliente sin solicitudes no prueba nada`);
        }
        // `lender` acepta `null` explícito en el caso —«terminá en el listado»— y eso NO es lo mismo que
        // omitirlo, que sí hereda del default. Por eso se mira la CLAVE, no el valor.
        const lender = 'lender' in (c ?? {}) ? c.lender : (base as any).lender;
        const occupation = c.ocupacion ?? (base as any).ocupacion;
        const installments = c.cuotas ?? (base as any).cuotas;
        const webhook = c.webhook ?? (base as any).webhook;
        return {
            comercio: String(merchant),
            lender: lender == null ? null : Number(lender),
            nombre: c.nombre ? String(c.nombre) : undefined,
            espera: c.espera,
            ocupacion: occupation ? String(occupation) : undefined,
            cuotas: installments ? Number(installments) : undefined,
            webhook: webhook ? String(webhook) : undefined,
            pasos: Array.isArray(c.pasos) ? c.pasos : undefined,
            escenarios: c.escenarios,
            amount: Number(c.amount ?? base.amount),
            income: Number(c.income ?? base.income),
            score: Number(c.score ?? base.score),
        } as Case;
    });
}

type Res = {
    caso: Case; ok: boolean; ur?: number; phone: string; nombre?: string;
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
type BaseLine = { users: number; ureqs: number } | null;

/** Los MAX(id) de `users` y `user_requests` antes de arrancar. Null si la base no contesta: la
 *  conciliación es información, no puede frenar la corrida. */
async function dbBaseline(): Promise<BaseLine> {
    try {
        const users = Number(await scalar<number>('SELECT MAX(id) FROM users')) || 0;
        const ureqs = Number(await scalar<number>('SELECT MAX(id) FROM user_requests')) || 0;
        return { users, ureqs };
    } catch { return null; }
}

/**
 * ⚠ LO QUE EL RUNNER DICE Y LO QUE LA BASE TIENE SON DOS COSAS, y esto imprime la segunda.
 *
 * Tres veces (F-176, F-180 y la corrida de 42 del 2026-09-02) el runner reportó «0/N cerraron» con la
 * base llena de usuarios íntegros: el guard de escrituras cortó DESPUÉS de que la API ya había escrito,
 * o el gateway devolvió 504 a los 60 s mientras PHP seguía y terminaba. Leer ese «0» como «no pasó
 * nada» lleva a repetir la corrida y duplicar los datos. Acá se cuenta lo que quedó desde la línea base,
 * y si el runner dijo cero pero la base creció, se dice con todas las letras.
 */
async function reconcileWithDb(lb: BaseLine, okPerRunner: number): Promise<void> {
    if (!lb) return;
    try {
        const users = Number(await scalar<number>('SELECT COUNT(*) FROM users WHERE id > ?', [lb.users])) || 0;
        const ureqs = Number(await scalar<number>('SELECT COUNT(*) FROM user_requests WHERE id > ?', [lb.ureqs])) || 0;
        console.log(`  base: quedaron ${users} usuario(s) y ${ureqs} solicitud(es) nuevos (desde user ${lb.users} · ureq ${lb.ureqs})`);
        if (okPerRunner === 0 && (users > 0 || ureqs > 0)) {
            console.log('  ⚠ el runner dice CERO pero la base creció: el fallo fue DESPUÉS de escribir (gateway o guard).'
                + ' No repitas la corrida sin mirar esos usuarios — ver F-176 y F-180.');
        }
    } catch { /* conciliar es información: si la base no contesta, no se inventa un número */ }
}

/**
 * Resuelve un comercio por `#hash` de sucursal, por SLUG exacto o por NOMBRE (subcadena), en ese orden.
 *
 * ⚠ Hasta el 2026-09-02 sólo miraba el NOMBRE con `LIKE`: `pullman` andaba porque «Amoblando Pullman» lo
 * contiene, y `viva-tu-credito` —el slug real del comercio— daba «no encontré el comercio». Una tanda de
 * 40 comercios sacada de la base por slug falló entera por eso, y el mensaje mandaba a dudar del dato.
 * El slug es el identificador estable del comercio; el nombre es lo que uno recuerda. Se aceptan los dos.
 *
 * Entre varias sucursales del mismo comercio gana la que más entidades tiene: es la que más flujo cubre.
 */
// `findBranch` vive en `pkg/merchants.ts` — ver ahí las TRES resoluciones que había.

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
/**
 * ⚠ LA FORMA DEL TELÉFONO SALE DEL PAÍS DEL COMERCIO, no de acá. Estaba quemada en la colombiana
 * —10 dígitos que empiezan en 3— y por eso este runner **no podía ni registrar** un comercio peruano:
 * su país pide 9 y el backend rechazaba con 422 en el primer paso. Es el mismo error que ya se había
 * corregido para el tipo de documento, en el otro campo del mismo formulario.
 *
 * El prefijo importa además del largo: República Dominicana comparte el +1 con todo el NANP, así que
 * su país sale del ÁREA y sólo 809/829/849 son suyas. Con un `8` cualquiera, libphonenumber la ubica
 * en otro lado y el país resuelto sale mal — sin fallar, que es lo peor.
 */
/** Los dos últimos dígitos son el índice del caso: es lo que garantiza uno distinto por caso, que es
 *  la condición del paralelo. El resto se rellena con la base de la corrida, recortada al largo. */
const phoneOf = (i: number, iso = 'COL'): string => syntheticPhone(iso, i, BASE_DOC);

// `coSignerPhone` vive en `pkg/phones.ts`, con el porqué de que esté separado.

/** El ISO-3 del país del comercio, del mismo payload del que ya sale el tipo de documento. */
const isoByMerchant = new Map<string, string>();
/**
 * ⚠ SI NO PUEDE RESOLVER EL PAÍS, DEVUELVE null — NO ADIVINA. Hasta el 2026-09-02 caía a Colombia en
 * silencio cuando el payload tardaba más de 20 s. Contra un backend saturado eso hizo que el comercio
 * dominicano y el peruano recibieran teléfonos de forma COLOMBIANA: el peruano ni registró (10 dígitos
 * contra un país de 9) y el fallo se leyó como del backend. Un fallback que esconde la saturación es
 * peor que fallar: el llamador aborta el caso diciendo por qué, y la saturación queda a la vista.
 *
 * Reintenta UNA vez antes de rendirse: un timeout aislado no debería tumbar un caso, dos seguidos sí.
 */
async function merchantCountry(hash: string): Promise<string | null> {
    const cached = isoByMerchant.get(hash);
    if (cached) return cached;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const r = await fetch(`${API}/api/loans/allied/${hash}`, { signal: AbortSignal.timeout(20_000) });
            const j = await r.json() as { data?: { country?: { iso_code?: string } } };
            const published = j?.data?.country?.iso_code;
            if (typeof published === 'string' && published.length === 3) {
                const iso = published.toUpperCase();
                isoByMerchant.set(hash, iso);     // sólo se cachea lo que sí se resolvió
                return iso;
            }
            return null;                          // respondió, pero sin país: no es un timeout, no se reintenta
        } catch { /* timeout o red: al segundo intento se rinde */ }
    }
    return null;
}

const NO_COUNTRY = 'no pude resolver el país del comercio: su payload no respondió dos veces (¿backend saturado?)';

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
 *  Acá no hace falta borrar nada: **cada caso ya deriva su propio teléfono** (`phoneOf`), así que
 *  alcanza con decirle al backend que esos derivados están bypasseados. Usuario virgen por caso, sin
 *  historia que arrastrar, sin techo y sin un solo DELETE.
 *
 *  ⚠ SE REGISTRAN TODOS DE UNA Y EN SERIE, ANTES del paralelo. La lista es UN valor JSON: N escrituras
 *  concurrentes de «leé, agregá el mío, guardá» se pisan y sobreviven unas pocas — la misma trampa que
 *  el dictado a la lambda. Y se restaura al terminar para no dejar la lista creciendo sola. */
// La implementación vive en `pkg/otp-bypass.ts` — la comparten los dos runners.

/** Lo que ESTA corrida agregó a la lista. De módulo y no local a `main()` para poder limpiarlo aunque
 *  la corrida termine mal: una lista que crece sola con teléfonos de tandas viejas es basura que
 *  después nadie sabe de dónde salió. */
let bypassSet: { agregados: string[]; comodin: boolean } | null = null;


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
const merchantDocumentType = (hash: string) => documentType(API, hash);

/** EL recorrido: register → otp-validate → personal-info. No usa `synthFill` — justamente porque
 *  synthFill escribe la fila de `risk_central_user_data` y entonces el backend la reusa (caché de un
 *  mes) y NO llama a la central. Es la trampa 1 del documento de la tarea. */
/** La cédula de un caso. Única POR CORRIDA, no sólo por caso: derivarla de (índice, score) hacía que
 *  la segunda vez que se corría el mismo comando repitiera cédula, y el flujo moría con «El correo
 *  electrónico ya se encuentra registrado» — un error que no se parece a su causa. Peor: la caché de
 *  un mes de `risk_central_user_data` habría servido la consulta anterior en vez de llamar a la
 *  central, que es justo lo que se quiere ejercitar. */
const idNumberOf = (i: number) => String(BASE_DOC + i);


const dictatedOnes = new Set<string>();

/** ⚠ DICTAR VA EN SERIE, AUNQUE LOS CASOS CORRAN EN PARALELO. La lambda es serverless y sus
 *  global-vars viven en la MEMORIA DEL CONTAINER: tres POST concurrentes caen en contenedores
 *  distintos y dos de los tres dictados se pierden — medido el 2026-08-17, y no es una carrera que se
 *  resuelva sola: la cédula perdida devuelve la respuesta por defecto para siempre. El síntoma es
 *  cruel, porque el flujo TERMINA BIEN con datos que nadie pidió, y uno concluye «el ingreso no
 *  cambia el listado» cuando en realidad el ingreso nunca llegó. En serie, las tres quedan. */
async function dictateAll(cases: Case[]): Promise<string[]> {
    const failures: string[] = [];
    for (let i = 0; i < cases.length; i++) {
        const doc = idNumberOf(i);
        // el escenario de cada integración va acá también: es preparación del caso, y se dicta
        // POR CÉDULA para que dos casos en paralelo puedan pedir cosas opuestas de la misma entidad
        for (const [lender, mode] of Object.entries(cases[i].escenarios ?? {})) {
            // ⚠ `preaprobado` NO es una entidad: es el estado que debe devolver el MICROSERVICIO de
            // pre-aprobados, y se aplica en su propia llamada. Mandarlo al admin API del mock de
            // integraciones lo rechaza y hace fallar la preparación del caso entero.
            if (lender === 'preaprobado') continue;
            const r = await fetch(`${MOCK_LENDERS}/__mock/escenario`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ lender, modo: mode, doc }), signal: AbortSignal.timeout(8_000),
            }).catch(() => null);
            if (!r?.ok) failures.push(`${lender}=${mode}`);
        }
        // ⚠ EL `score` DEL CASO NO LLEGABA A NINGÚN LADO en este camino: el buró lo sirve el mock y
        // devolvía siempre el del fixture (707). O sea que `score=750` era un **no-op silencioso** —el
        // caso corría, terminaba bien, y uno concluía «el score no mueve el listado» cuando el score
        // nunca cambió. Es la misma familia que F-139. El mock ya sabe pisarlo por cédula.
        if (cases[i].score) {
            // ⚠ Antes iba con `.catch(() => {})`: si el dictado del score fallaba, el caso seguía con el
            // score por defecto del mock y el reporte decía igual «buró dictado». Agildata sí se
            // verificaba; Experian no. Un caso que declara score 700 y corre con otro no prueba lo que
            // dice — y nada avisaba. Ahora cuenta como dictado fallido, igual que Agildata.
            const okScore = await dictate(doc, 'experian_score', String(cases[i].score)).catch(() => false);
            if (!okScore) failures.push(`${doc}:experian_score`);
        }

        // hasta 4 intentos: cada POST puede caer en un contenedor distinto, así que reintentar
        // NO es supersticioso — es lo que hace que alguno pegue en el que después atiende la lectura
        const ok = await dictateEmployment(doc, cases[i].income!, cases[i].ocupacion);
        if (ok) dictatedOnes.add(doc); else failures.push(doc);
    }
    return failures;
}

/** Envoltorio: corre el caso y SIEMPRE deja su bitácora, salga como salga. Está separado del motor
 *  porque el motor tiene una docena de salidas tempranas —cada una es un diagnóstico distinto— y
 *  envolverlas de a una era la forma de que alguna quedara sin volcar. */
/**
 * UN SOLO CAMINO. Hasta el 2026-09-02 había dos: éste —el flujo REAL por la API: register → otp-validate →
 * personal-info → listado v2 → selección → cierre— y otro «sintético» que insertaba la solicitud a mano en
 * la base, inyectaba el buró con `synthFill` y pedía el listado v1 que el wizard no usa. El sintético era el
 * default sin `--lambda`, y cada bug de esa semana fue «arreglé un camino y el otro no»: el teléfono por
 * país, el país sin adivinar, la clave del error. Dos implementaciones de lo mismo no son redundancia, son
 * dos versiones de la verdad.
 *
 * `--lambda` ya no elige camino: sólo DICTA el buró (la respuesta de cada central para esa cédula). Sin el
 * flag, el buró contesta lo que el ambiente tenga —el mock local o el de qa—, que es lo que ve un cliente.
 */
async function correr(c: Case, i: number): Promise<Res> {
    const r = await traverse(c, i);
    await dumpLogbook(r, logbooks.get(r.phone) ?? []);
    logbooks.delete(r.phone);

    // LAS DOS MITADES DE UNA CORRIDA FALLIDA. La bitácora dice qué SE PIDIÓ —es nuestra y no tiene
    // ambigüedad—; la forense de Loki dice qué DECIDIÓ el backend, que es lo que la bitácora no puede
    // saber: una regla que excluyó una entidad no mueve ningún estado ni cambia ningún status HTTP.
    //
    // ⚠ Se dispara SÓLO si el caso salió mal, y eso no es tacañería: `forensicOnClose` paga un settle
    // más una consulta, y explicar un éxito no le sirve a nadie. Se traga cualquier error a propósito.
    if (!r.ok && r.ur) {
        await forensicOnClose(r.ur, { existe: true, ok: false, malo: false, miente: [] })
            .catch(() => { /* un forense que tumba la corrida que vino a explicar es peor que no tenerlo */ });
    }
    return r;
}

async function traverse(c: Case, i: number): Promise<Res> {
    const doc = idNumberOf(i);
    const base: Res = { caso: c, ok: false, phone: '' };

    // ⚠ El teléfono ya no se puede armar antes de conocer el comercio: su forma sale del país. Por eso
    // la sucursal se resuelve PRIMERO y el teléfono después — al revés de como estaba.
    const br = await findBranch(c.comercio);
    if (!br) return { ...base, detalle: `no encontré el comercio «${c.comercio}»` };

    const iso = await merchantCountry(br.hash);
    if (iso === null) return { ...base, detalle: NO_COUNTRY };
    const tel = phoneOf(i, iso);   // el mismo para listar y para cerrar
    base.phone = tel;

    // ⚠ `x.id AS allied` NO es cosmético: `preApprove` lo manda como `merchant_id` y este lookup no
    // lo seleccionaba, así que viajaba `undefined`. El mock no valida ese campo y por eso el bug
    // sobrevivió — contra el microservicio real habría fallado. Los mocks permisivos esconden
    // exactamente esta clase de error (misma lección que F-140).
    base.com = br.com;

    // Sólo si se pidió dictar: sin `--lambda` el buró contesta lo del ambiente, y eso es un resultado válido.
    if (flag('lambda') && !dictatedOnes.has(doc)) return { ...base, detalle: 'la respuesta del buró no quedó dictada' };

    const H = { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA };
    // Cada llamada queda anotada (ver `dumpLogbook`). El costo es un push a un array; el beneficio
    // es no tener que repetir una corrida de 90 s para ver qué se pidió.
    const logbook: Call[] = [];
    logbooks.set(tel, logbook);
    const t0Case = Date.now();
    const annotate = (method: string, path: string, status: number, ms: number, reqBody?: string) => {
        logbook.push({ t: Date.now() - t0Case, metodo: method, ruta: path, status, ms,
            // El cuerpo entero SÓLO cuando falló: es cuando hace falta, y evita volcar datos
            // personales de las respuestas buenas.
            ...(status >= 200 && status < 300 ? {} : { cuerpo: (reqBody ?? '').slice(0, 600) }) });
    };

    // UN SOLO HELPER HTTP, y `get`/`post` son dos verbos sobre él. Hasta el 2026-09-02 eran dos
    // implementaciones casi iguales —y una tercera, `http()`, en el camino sintético ya retirado—:
    // divergían en el timeout (90 s vs 150 s), en cómo reportaban el fallo de parseo (`{}` vs `raw`) y en
    // que sólo `get` distinguía timeout de caída. Un helper es un solo lugar donde estar bien.
    //
    // ⚠ UN TIMEOUT NO ES UNA CAÍDA, Y `HTTP 0` LOS CONFUNDE. Medido el 2026-08-23: con nueve casos en
    // paralelo, la generación de documentos de Motai y Pullman tardó **90.002 ms** —clavó el límite— y
    // el runner reportó «devolvió HTTP 0», que se lee como que el backend se murió. No se murió: tardó,
    // por la misma razón de F-166 (llamadas remotas dentro de una transacción abierta, que bajo
    // concurrencia se serializan). Decir cuál de las dos cosas fue cambia dónde se busca la causa.
    //
    // `extra` existe para el CODEUDOR: su credencial es un header (`X-Cosigner-Token`), no una sesión.
    const call = async (method: 'GET' | 'POST', path: string, body?: unknown,
                          extra: Record<string, string> = {}, timeoutMs = method === 'POST' ? 150_000 : 90_000) => {
        const t0 = Date.now();
        const r = await fetch(`${API}${path}`, { method: method, headers: { ...H, ...extra },
            body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
            .catch((e) => e as Error);
        if (r instanceof Error) {
            const ms = Date.now() - t0;
            const expiredIt = /timeout|abort/i.test(String(r));
            annotate(method, path, 0, ms, String(r).slice(0, 200));
            const reason = expiredIt ? `se pasó de los ${Math.round(ms / 1000)} s de espera (no falló: tardó)`
                                  : String(r.message).slice(0, 120);
            return { status: 0, json: { message: reason } as any, motivo: reason };
        }
        const t = await r.text();
        annotate(method, path, r.status, Date.now() - t0, t);
        try { return { status: r.status, json: JSON.parse(t) as any }; }
        catch { return { status: r.status, json: { raw: t.slice(0, 200) } as any }; }
    };
    const get = (path: string, extra: Record<string, string> = {}) => call('GET', path, undefined, extra);
    const post = (path: string, body: unknown, extra: Record<string, string> = {}) => call('POST', path, body, extra);

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

    // EL CUSTOMER QUE VUELVE NO SE REGISTRA DE NUEVO.
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
        // EL TIPO DE DOCUMENT SALE DEL COMERCIO, no de acá.
        //
        // ⚠ Estaba quemado en `'CC'`, y por eso este runner no podía probar un comercio que no fuera
        // colombiano: contra el dominicano el backend contesta —bien— «El tipo de documento no está
        // habilitado en este punto de venta». El backend ya publica la lista en el payload del comercio,
        // así que se pide y se usa la primera. Si no la publica (backend viejo), se cae a `CC`, que es lo
        // que había.
        const docKind = await merchantDocumentType(br.hash);
        const pi = await post(`/api/onboarding/loan-application/personal-info/${br.hash}/${ur}`, {
            document_type: docKind, document_number: doc, name: 'CARLOS', surname: 'RUIZ',
            email: `qa${doc}@gmail.com`,
            expedition_day: 10, expedition_month: 5, expedition_year: 2019,
            birth_day: 10, birth_month: 5, birth_year: 2001,
            // ⚠ El ESTRATO no lo pide todo comercio, pero cuando lo pide corta el flujo con
            // `STRATUM_REQUIRED` en el tercer paso — y sin él quedaban fuera del barrido comercios
            // enteros, entre ellos los de Credifamilia. Va siempre: los que no lo piden lo ignoran.
            stratum: 3 });
        // ⚠ ONB004 NO es un rechazo: es enrutamiento. Significa «el usuario no tiene información
        // laboral, pedísela en la pantalla siguiente», y llega con HTTP 200. El front hace justo eso,
        // y hasta ahora este runner lo leía como fallo y abandonaba el caso.
        //
        // Y aparece SIEMPRE en un país sin centrales de riesgo, no por casualidad: en Colombia los
        // datos laborales los deriva el buró, así que cuando el gate de país salta el buró —Perú, RD—
        // no hay de dónde derivarlos y sólo puede ponerlos la persona. O sea que el paso laboral no es
        // opcional fuera de Colombia: es EL camino. Cerrar un flujo internacional sin esto es imposible.
        // ⚠ La clave es `error_code`, NO `error_subcode`: el runner venía leyendo la segunda para armar
        // el detalle del fallo, y por eso ONB004 se imprimía sin código —«personal-info rechazó · {…}»—
        // que es un mensaje que no dice nada y manda a leer logs.
        if (pi.json?.errors?.error_code === 'ONB004') {
            const lab = await post(`/api/onboarding/loan-application/laboral-info/${br.hash}/${ur}`, {
                income_amount: c.income, employment_situation: 'Empleado',
                original_amount: c.amount, amount: c.amount });

            if (lab.json?.success !== true) {
                return { ...base, conducta: 'laboral-info rechazó',
                         detalle: `${lab.json?.errors?.error_code ?? ''} ${JSON.stringify(lab.json?.errors?.payload ?? lab.json?.message ?? '').slice(0, 90)}` };
            }
        } else if (pi.json?.success !== true) {
            return { ...base, conducta: 'personal-info rechazó',
                     detalle: `${pi.json?.errors?.error_code ?? pi.json?.errors?.error_subcode ?? ''} ${JSON.stringify(pi.json?.errors?.payload ?? pi.json?.message ?? '').slice(0, 90)}` };
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

    // LA IDENTIDAD, cuando el caso la pide aprobada. Sin `--manual` el paso queda como lo dicte la
    // entidad (hoy, para las rt=2 con AWS, `aws_validation`) y este runner igual cierra porque el
    // camino por API no pasa por esa pantalla. Con `--manual` la solicitud queda en el estado en el
    // que la deja un humano del admin, y ahí `no_validation_required` sale del backend y no de que el
    // runner se salteó un paso. Es la diferencia entre esquivar la identidad y resolverla.
    if (flag('manual')) await manualValidation(uid);

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
    // Va por el helper y no por `fetch` crudo: es LA llamada que da sentido al caso y hasta el 2026-09-02
    // era la única del recorrido que no quedaba en la bitácora — la que uno más quería ver al fallar.
    const requestListing = async () => (await get(`/api/onboarding/loan-application/lenders-v2/${ur}?amount=${c.amount}`)).json;

    let lis = await requestListing();
    if (await mirrorBureauForProfiling(ur)) lis = (await requestListing()) ?? lis;
    // ⚠ «CERO ENTIDADES» Y «LA LLAMADA FALLÓ» NO SON LO MISMO, y hasta el 2026-08-18 esto los
    // reportaba igual: un comercio cuyo listado reventaba salía como «0 entidades», que se lee como
    // un hecho de negocio («no ofrece nada») cuando es una excepción de PHP. Pasó de verdad — un
    // lender con host nulo tira `PendingRequest::baseUrl(): Argument #1 must be of type string, null
    // given` y se lleva el listado ENTERO del comercio, no sólo esa card.
    if (lis?.exception || (lis?.success === false) || (lis?.message && !lis?.data)) {
        return { ...base, ok: false, nombre: `doc ${doc}`, conducta: 'el LISTADO falló',
                 detalle: String(lis.message ?? lis.exception).split('\n')[0].slice(0, 110) };
    }
    const raw = lis?.data ?? lis;
    const arr: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.lenders) ? raw.lenders : [];
    base.listado = arr.map((x) => Number(x.id ?? x.lender_id)).filter(Boolean);

    // LO QUE HARÍA EL FRONT. Sin esto la corrida termina en el listado y la pre-aprobación NO ocurre
    // —sin fallar, que es lo peor (F-141)—. Se dispara una por entidad elegible y en paralelo, igual
    // que el loader del wizard, con el payload de `fetch-lender-preapproval.ts:154-170`.
    if (flag('preaprobados')) {
        const eligible = arr.filter((l) => Number(l.response_type) !== 0);
        base.preaprobados = await Promise.all(eligible.map((l) =>
            preApprove(l, ur, uid, br.allied, br.hash, c.amount!, c.escenarios?.preaprobado)));
    }

    // ⚠ Cuando había dos caminos (hasta el 2026-09-02), éste NO calculaba esto y el reporte decía SIEMPRE «la pedida NO estaba»,
    // incluso cuando la entidad estaba en el listado impreso dos palabras antes. Un runner que se
    // contradice a sí mismo en la misma línea es peor que uno que calla: manda a buscar una causa de
    // negocio para un bug del reporte. (El camino sintético sí lo calculaba — eran dos implementaciones
    // y sólo una completa.)
    if (c.lender !== null) base.enListado = base.listado!.includes(c.lender);

    let closing = '';
    if (flag('cerrar')) {
        const r = await closeCreditopX(arr, ur, tel, c.amount!, post, get, c.lender, c.cuotas ?? 4);
        base.cierre = r;
        closing = r.cerro ? ` · CERRÓ en estado ${r.estado} (${r.motivo})`
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
                : fam?.rt === 1 && WELLI_IDS.includes(c.lender!) ? await integrationWebhook(ur, c.webhook)
                : { ok: false, detalle: fam?.rt === 1
                        ? `rt=1 fuera de la familia Welli: su webhook existe pero este runner sólo maneja el de Welli`
                        : `\`@webhook=\` no aplica a rt=${fam?.rt ?? '?'}: esa familia cierra en plataforma` };
            base.cierre = { ...r, webhook: w.detalle };
            closing += `\n        ${w.ok ? '↩' : '⚠'} ${w.detalle}`;
        }
    }

    return { ...base, ok: arr.length > 0, nombre: `doc ${doc}`,
             conducta: `listado con ${arr.length} entidades · buró dictado: ibc ${c.income!.toLocaleString('es-CO')}${closing}` };
}

/** Contrasta lo que cada caso DECLARA contra lo que pasó.
 *
 *  ⚠ FALLA CERRADO. Una expectativa que no se pudo evaluar —porque la corrida no llegó hasta ahí, o
 *  porque le faltó un flag— cuenta como desvío, no como éxito. Es la diferencia entre «lo verifiqué»
 *  y «no lo verifiqué», y confundirlas es lo que produce un verde que no significa nada.
 *
 *  Devuelve una línea por desvío, nombrando el caso y diciendo esperado vs obtenido — porque un
 *  «falló» pelado manda a reproducir a mano lo que el runner ya sabe. */
/**
 * La aserción de PAÍS se evalúa contra la base, por eso va aparte del evaluador sincrónico.
 *
 * Nació el 2026-09-02 de comprobar a mano, con SQL, lo mismo tres veces: que el cliente quedara con el
 * país de su comercio, con un documento de ese país y con el celular del largo de ese país. Cada vez
 * salió bien y cada vez costó escribir la consulta. Acá queda declarada, y falla CERRADO: si la
 * solicitud no se creó, «no lo verifiqué» cuenta como desvío, igual que en `verifyWaits`.
 */
async function verifyCountries(res: Res[]): Promise<Array<{ res: Res; linea: string }>> {
    const out: Array<{ res: Res; linea: string }> = [];
    for (const r of res) {
        const e = r.caso.espera?.pais;
        if (e === undefined || e === false) continue;
        const who = r.caso.nombre ?? `${r.caso.comercio}${r.caso.lender ? ':' + r.caso.lender : ''}`;
        if (!r.ur) { out.push({ res: r, linea: `${who}: espera \`pais\` y la solicitud ni se creó (${r.detalle ?? 'sin detalle'})` }); continue; }

        const rowItem = await one<{ uc: number; ac: number; iso3: string; doc: string; tel: string; largo: number; moneda: string; docs: string }>(
            `SELECT u.country_id AS uc, a.country_id AS ac, c.iso_code_2 AS iso3, u.document_type AS doc,
                    u.cell_phone AS tel, c.cell_phone_lenght AS largo, c.currency AS moneda, c.document_types AS docs
               FROM user_requests r JOIN users u ON u.id = r.user_id JOIN allieds a ON a.id = r.allied_id
               JOIN countries c ON c.id = a.country_id WHERE r.id = ?`, [r.ur]).catch(() => null);
        if (!rowItem) { out.push({ res: r, linea: `${who}: espera \`pais\` y no pude leer la solicitud ${r.ur} de la base` }); continue; }

        // ⚠ mysql2 devuelve una columna JSON ya PARSEADA (array), no un string: un `JSON.parse` encima
        // revienta y el catálogo sale «vacío» para todos los países. Costó una corrida en verde falso.
        let catalog: string[] = [];
        const raw: unknown = (rowItem as any).docs;
        if (Array.isArray(raw)) catalog = raw.map(String);
        else if (typeof raw === 'string') { try { catalog = JSON.parse(raw); } catch { /* sin catálogo: desvío abajo */ } }
        const phoneLength = String(rowItem.tel ?? '').replace(/\D/g, '').length;

        // La REGLA, siempre que se pidió `pais` (true u objeto).
        if (Number(rowItem.uc) !== Number(rowItem.ac)) out.push({ res: r, linea: `${who}: el cliente quedó con country_id ${rowItem.uc} y su comercio es ${rowItem.ac} (${rowItem.iso3}) — nació con otro país` });
        if (!catalog.length) out.push({ res: r, linea: `${who}: el país ${rowItem.iso3} no tiene catálogo de documentos en \`countries.document_types\`: la regla no se puede evaluar` });
        else if (!catalog.includes(String(rowItem.doc))) out.push({ res: r, linea: `${who}: documento \`${rowItem.doc}\` no está en el catálogo de ${rowItem.iso3} [${catalog.join(', ')}]` });
        if (Number(rowItem.largo) > 0 && phoneLength !== Number(rowItem.largo)) out.push({ res: r, linea: `${who}: el celular tiene ${phoneLength} dígitos y ${rowItem.iso3} pide ${rowItem.largo}` });

        // Los valores FIJADOS, si los hay.
        if (typeof e === 'object') {
            if (e.iso && String(rowItem.iso3).toUpperCase() !== e.iso.toUpperCase()) out.push({ res: r, linea: `${who}: esperaba país ${e.iso} y el comercio es ${rowItem.iso3}` });
            if (e.documento) { const ok = ([] as string[]).concat(e.documento); if (!ok.includes(String(rowItem.doc))) out.push({ res: r, linea: `${who}: esperaba documento ${ok.join('|')} y quedó \`${rowItem.doc}\`` }); }
            if (e.celular && phoneLength !== e.celular) out.push({ res: r, linea: `${who}: esperaba celular de ${e.celular} dígitos y tiene ${phoneLength}` });
            if (e.moneda && String(rowItem.moneda).toUpperCase() !== e.moneda.toUpperCase()) out.push({ res: r, linea: `${who}: esperaba moneda ${e.moneda} y el país tiene ${rowItem.moneda}` });
        }
    }
    return out;
}

function verifyWaits(res: Res[]): Array<{ res: Res; linea: string }> {
    const out: Array<{ res: Res; linea: string }> = [];
    for (const r of res) {
        const e = r.caso.espera;
        if (!e) continue;
        const who = r.caso.nombre ?? `${r.caso.comercio}${r.caso.lender ? ':' + r.caso.lender : ''}`;

        if (e.enListado !== undefined) {
            if (r.caso.lender === null) {
                out.push({ res: r, linea: `${who}: espera \`enListado\` pero el caso no pide ninguna entidad` });
            } else if (r.listado === undefined) {
                out.push({ res: r, linea: `${who}: espera \`enListado\` y el listado ni se obtuvo (${r.detalle ?? 'sin detalle'})` });
            } else if (!!r.enListado !== e.enListado) {
                out.push({ res: r, linea: `${who}: esperaba que la entidad ${r.caso.lender} ${e.enListado ? 'SÍ' : 'NO'}`
                    + ` estuviera en el listado, y ${r.enListado ? 'sí' : 'no'} estaba — listado: [${(r.listado ?? []).join(', ')}]` });
            }
        }

        if (e.entidades?.length) {
            if (r.listado === undefined) {
                out.push({ res: r, linea: `${who}: espera entidades en el listado y el listado ni se obtuvo` });
            } else {
                const missing = e.entidades.filter((x) => !r.listado!.includes(x));
                if (missing.length) {
                    out.push({ res: r, linea: `${who}: faltaron en el listado [${missing.join(', ')}] — vino [${r.listado.join(', ')}]` });
                }
            }
        }

        if (e.noEntidades?.length) {
            if (r.listado === undefined) {
                out.push({ res: r, linea: `${who}: espera entidades AUSENTES y el listado ni se obtuvo` });
            } else {
                const leaked = e.noEntidades.filter((x) => r.listado!.includes(x));
                if (leaked.length) {
                    out.push({ res: r, linea: `${who}: no debían estar [${leaked.join(', ')}] y aparecieron`
                        + ` — vino [${r.listado.join(', ')}]` });
                }
            }
        }

        if (e.cierra !== undefined || e.estado !== undefined || e.radicacion !== undefined) {
            if (!r.cierre) {
                out.push({ res: r, linea: `${who}: declara algo del cierre pero la corrida no cerró nada`
                    + ' — ¿faltó `CERRAR=1`? (sin eso, esto NO está verificado)' });
            } else {
                if (e.cierra !== undefined && r.cierre.cerro !== e.cierra) {
                    out.push({ res: r, linea: `${who}: esperaba que ${e.cierra ? 'CERRARA' : 'NO cerrara'} y ${r.cierre.cerro ? 'cerró' : 'no cerró'}`
                        + ` — ${r.cierre.motivo}` });
                }
                if (e.estado !== undefined && r.cierre.estado !== e.estado) {
                    out.push({ res: r, linea: `${who}: esperaba estado ${e.estado} y quedó en ${r.cierre.estado ?? '—'}`
                        + ` — ${r.cierre.motivo}` });
                }
                // La radicación se exige aparte del estado a propósito: son dos preguntas y la
                // segunda puede fallar con la primera en verde (ver el comentario en `closeCreditopX`).
                if (e.radicacion !== undefined && r.cierre.radicacion !== e.radicacion) {
                    out.push({ res: r, linea: `${who}: esperaba radicación \`${e.radicacion}\` y quedó en `
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
type Call = { t: number; metodo: string; ruta: string; status: number; ms: number; cuerpo?: string };

/** Bitácora por caso. La clave es el TELÉFONO porque es lo único único por caso desde el primer
 *  instante — el `uReq` recién existe a la tercera llamada, y para entonces ya hay cosas que anotar. */
const logbooks = new Map<string, Call[]>();

async function dumpLogbook(res: Res, calls: Call[]): Promise<void> {
    if (!calls.length) return;
    try {
        const { mkdir, writeFile } = await import('node:fs/promises');
        const dir = new URL('../.runs/', import.meta.url);
        await mkdir(dir, { recursive: true });
        const name = `caso-${res.ur ?? 'sin-ureq'}-${res.phone}.json`;
        await writeFile(new URL(name, dir), JSON.stringify({
            caso: res.caso.nombre ?? `${res.caso.comercio}${res.caso.lender ? ':' + res.caso.lender : ''}`,
            comercio: res.caso.comercio, lender: res.caso.lender,
            parametros: { amount: res.caso.amount, income: res.caso.income, score: res.caso.score },
            uReq: res.ur ?? null, telefono: res.phone,
            resultado: { ok: res.ok, conducta: res.conducta ?? null, detalle: res.detalle ?? null,
                         listado: res.listado ?? null, cierre: res.cierre ?? null },
            llamadas: calls,
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
async function mirrorBureauForProfiling(ur: number): Promise<boolean> {
    try {
        const orig = await one<{ id: number; user_id: number; score: number; data: string; info: string }>(
            `SELECT d.id, d.user_id, d.score, d.data, d.additional_info info
               FROM risk_central_user_data d
               JOIN risk_centrals rc ON rc.id = d.risk_central_id
               JOIN user_requests r ON r.user_id = d.user_id
              WHERE r.id = ? AND rc.name = 'Experian - Acierta+Quanto'
              ORDER BY d.id DESC LIMIT 1`, [ur]);
        if (!orig) return false;

        const target = await one<{ id: number }>(
            "SELECT id FROM risk_centrals WHERE name = 'Experian - Acierta' LIMIT 1");
        if (!target) return false;

        await exec('DELETE FROM risk_central_user_data WHERE user_id=? AND risk_central_id=?',
                   [orig.user_id, target.id]);
        await exec(
            'INSERT INTO risk_central_user_data (uuid, user_id, risk_central_id, score, data, additional_info, created_at, updated_at) '
            + 'VALUES (UUID(), ?, ?, ?, ?, ?, NOW(), NOW())',
            // ⚠ `additional_info` es una columna JSON y el driver la devuelve YA parseada como objeto.
            // Reinsertarla tal cual da «Invalid JSON text» — hay que volver a serializarla.
            [orig.user_id, target.id, orig.score, orig.data,
             typeof orig.info === 'string' ? orig.info : JSON.stringify(orig.info ?? {})]);
        return true;
    } catch (e) {
        // ⚠ NO se traga el error en silencio: un espejo que no ocurre deja el perfilamiento sin correr
        // y la corrida sale plausible e incompleta — exactamente lo que F-159 describe.
        console.log(`      ⚠ no se pudo espejar el buró para el perfilamiento: ${String(e).slice(0, 120)}`);
    }
    return false;
}

/** EL SUB-FLOW DEL CODEUDOR, de punta a punta.
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
 *     `dev/inject-aml.ts`; el `data` va CIFRADO como el cast de Laravel o el backend no lo lee.
 *
 *  ⚠ Y el buró del codeudor se inyecta con `userId`, no derivándolo de la solicitud: **comparte la
 *  `user_request` del titular**, así que sin eso los datos irían al titular y el codeudor quedaría sin
 *  buró — con su elegibilidad fallando al LEER en vez de al decidir (F-153). */
async function resolveCoSigner(
    ur: number, hash: string, holderPhone: string, amount: number, post: any, get: any,
): Promise<{ ok: boolean; motivo: string; token?: string; tel?: string }> {

    const tel = coSignerPhone(holderPhone);
    const doc = String(2_900_000_000 + ur);

    const ini = await post(`/api/v1/user-request/${ur}/cosigner-flow/start`, {});
    if (ini.status !== 200) return { ok: false, motivo: `cosigner-flow/start HTTP ${ini.status}` };

    const reg = await post(`/api/v1/user-request/${ur}/cosigner`, { cellPhone: tel });
    if (reg.status !== 200) return { ok: false, motivo: `registrar codeudor HTTP ${reg.status}` };

    const rowItem = await one<{ t: string }>(
        'SELECT invitation_token t FROM cosigners WHERE user_request_id=? AND is_active=1 ORDER BY id DESC LIMIT 1',
        [ur]).catch(() => null);
    if (!rowItem?.t) return { ok: false, motivo: 'el codeudor no quedó con token de invitación' };
    const token = rowItem.t;

    // A partir de acá TODO va con el token: es la credencial del codeudor, no hay sesión.
    const withToken = (extra: Record<string, string> = {}) => ({ 'X-Cosigner-Token': token, ...extra });

    const inv = await get(`/api/v1/user-request/cosigner/invitation/${token}`, withToken());
    if (inv.status !== 200) return { ok: false, motivo: `el token de invitación no resolvió (HTTP ${inv.status})` };

    await post('/api/onboarding/phone/register', {
        phone_number: tel, phoneNumber: tel, terms: true, policies: true,
        otp_length: 4, otpLength: 4, partner_branch_hash: hash, partnerBranchHash: hash }, withToken());

    // ⚠ Esto NO crea una solicitud nueva: con el token, el backend devuelve la del TITULAR. Es la
    // señal de que el codeudor se está uniendo y no abriendo su propio crédito.
    const otp = await post(`/api/onboarding/loan-application/otp-validate/${hash}`, {
        cell_phone: tel, otp_code: tel.slice(-4), original_amount: amount, amount }, withToken());
    const urCode = otp.json?.errors?.payload?.user_request_id ?? otp.json?.data?.payload?.user_request_id;
    if (Number(urCode) !== ur) {
        return { ok: false, motivo: `el codeudor abrió otra solicitud (${urCode ?? '—'}) en vez de unirse a ${ur}` };
    }

    const pi = await post(`/api/onboarding/loan-application/personal-info/${hash}/${ur}`, {
        document_type: 'CC', document_number: doc, name: 'ANA', surname: 'GOMEZ',
        email: `qa${doc}@gmail.com`,
        expedition_day: 10, expedition_month: 5, expedition_year: 2019,
        birth_day: 10, birth_month: 5, birth_year: 2001 }, withToken());
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

    // El codeudor tiene su PROPIA identidad que resolver: la elegibilidad la evalúa por él, no por el
    // titular. Con `--manual` se le aprueba igual que al titular — si no, `evaluate-eligibility` puede
    // devolverlo sin evaluar y el motivo que imprime este runner ya sospecha de esto.
    if (flag('manual')) await manualValidation(uid.u);

    const ele = await post(`/api/v1/user-request/${ur}/cosigner/evaluate-eligibility`, {}, withToken());
    const est = ele.json?.data ?? {};
    if (est.cosignerStatus !== 'approved') {
        return { ok: false, motivo: `el codeudor quedó ${est.cosignerStatus ?? '—'}`
            + (est.evaluated === false ? ' y NO se evaluó (¿le falta AML o identidad?)' : '') };
    }

    const stage = await post(`/api/v1/user-request/${ur}/cosigner/enter-signature-stage`, {}, withToken());
    if (stage.status !== 200) return { ok: false, motivo: `enter-signature-stage HTTP ${stage.status}` };

    return { ok: true, motivo: 'codeudor aprobado y en etapa de firma', token, tel };
}

/** La firma del codeudor, DESPUÉS de la del titular. Cierra el crédito de verdad. */
async function coSignerSignature(token: string, post: any, get: any): Promise<{ ok: boolean; motivo: string }> {
    const withToken = { 'X-Cosigner-Token': token };
    const V = '/api/v1/user-request/cosigner/signature';

    await get(`${V}/context`, withToken);
    await get(`${V}/documents`, withToken);

    const env = await post(`${V}/otp`, {}, withToken);
    if (env.status !== 200) {
        return { ok: false, motivo: `el OTP de firma del codeudor falló (${env.json?.code ?? env.status})`
            + ' — si es URV25003, mirá `OTP_SERVICE_HOST` (F-151)' };
    }
    // ⚠ El campo se llama `otp`, no `code`: con `code` responde URV27002 «datos de entrada».
    const see = await post(`${V}/otp/verify`, { otp: '123456' }, withToken);
    if (see.json?.code !== 'URV27000') {
        return { ok: false, motivo: `verify del codeudor: ${see.json?.code ?? see.status} ${String(see.json?.message ?? '').slice(0, 50)}` };
    }
    return { ok: true, motivo: `firmado · ${see.json?.data?.cosignerStatus ?? ''}` };
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
async function runSteps(c: Case, i: number): Promise<Res[]> {
    const out: Res[] = [];
    for (let k = 0; k < c.pasos!.length; k++) {
        const step = c.pasos![k];
        const baseName = c.nombre ?? c.comercio;
        const sub: Case = {
            ...c,
            pasos: undefined,
            nombre: `${baseName} · paso ${k + 1}${step.nombre ? ` (${step.nombre})` : ''}`,
            recurrente: k > 0,
            lender: step.lender === undefined ? c.lender : step.lender,
            amount: step.amount ?? c.amount,
            espera: step.espera,
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
async function preflightCheck(cases: Case[] = []): Promise<string[]> {
    const missing: string[] = [];
    const alive = async (url: string) =>
        !!(await fetch(url, { signal: AbortSignal.timeout(5_000) }).catch(() => null));

    if (!(await alive(`${API}/`))) missing.push(`el backend no responde en ${API}`);
    if (!(await alive(`${MOCK_LENDERS}/`))) {
        missing.push(`mock de integraciones caído (${MOCK_LENDERS}) → las rt=1 desaparecen del listado`
            + ' y parece regla de negocio (F-140). Levantalo: node mock-lenders/server.mjs');
    }
    if (flag('preaprobados') && !(await alive(PREAPPROVALS.replace(/\/v1\/.*$/, '/')))) {
        missing.push(`mock de pre-aprobados caído (${PREAPPROVALS}). Levantalo: node mock-preapprovals/server.mjs`);
    }
    if (flag('lambda') && !(await alive(`${LAMBDA}/agildata/agildata-services/rest/afiliado/historicoDetalladoEmpleo/1/1`))) {
        missing.push(`la lambda de centrales no responde (${LAMBDA})`);
    }
    // Los dos de Credifamilia (rt=4). No se piden siempre porque sólo su cierre los toca, pero cuando
    // faltan el síntoma es el MISMO que un rechazo del negocio: la solicitud queda en estado 28 con
    // «Error de comunicación con Deceval» o con un secreto ausente, y ninguno de los dos mensajes
    // nombra al mock. Ver F-165.
    if (flag('cerrar')) {
        if (!(await alive(DECEVAL))) {
            missing.push(`mock de Deceval caído (${DECEVAL}) → Credifamilia se traba en estado 28 y parece`
                + ' un rechazo del pagaré (F-165). Levantalo: bin/mock-deceval start');
        }
        if (!(await alive(NETCO))) {
            missing.push(`mock de Netco caído (${NETCO}) → la firma de Credifamilia falla en estado 28`
                + ' (F-165). Levantalo: bin/mock-netco start');
        }
        // Éste NO traba la solicitud: sin él el backend sale al sandbox REAL del lender, la
        // solicitud llega igual a estado 11 y sólo la RADICACIÓN queda en CREDIT_ERROR. O sea que
        // faltando este mock el runner dice «cerró» y el crédito nunca se radicó.
        if (!(await alive(CREDIFAMILIA))) {
            missing.push(`mock de radicación de Credifamilia caído (${CREDIFAMILIA}) → el backend sale al`
                + ' sandbox REAL del lender y la radicación queda en CREDIT_ERROR con la solicitud igual en'
                + ' estado 11. Levantalo: bin/mock-credifamilia start');
        }
    }
    // El monolito viejo, y SÓLO si algún caso pidió el webhook: es una dependencia pesada (otro Laravel
    // entero) y exigirla siempre volvería obligatorio levantarla para correr cualquier cosa.
    if (cases.some((c) => c.webhook)) {
        if (!(await alive(`${OLD_APP}/`))) {
            missing.push(`un caso pidió \`@webhook=\` y \`legacy-application\` no responde en ${OLD_APP}.`
                + ' Es el ÚNICO que recibe los webhooks de rt=1 (F-170). Levantalo:'
                + ' cd ~/Desktop/CREDITOP/github/legacy-application && php artisan serve --port=8000');
        }
    }
    return missing;
}



/** POSTVUELO del buró: ¿el ingreso que se DICTÓ llegó de verdad? Es la única comprobación que
 *  distingue «el parámetro no influye» de «el parámetro nunca llegó», y las dos se ven igual en el
 *  listado. Si los drivers KYC están en `fake`, acá salta. */
async function bureauArrived(res: Res[]): Promise<string | null> {
    const withUr = res.filter((r) => r.ur && r.caso.income);
    if (!withUr.length) return null;
    const seen = new Set<number>();
    for (const r of withUr) {
        const row = await one<{ a: string }>(
            'SELECT s.agildata a FROM user_requests u JOIN user_summaries s ON s.user_id=u.user_id WHERE u.id=?',
            [r.ur]).catch(() => null);
        const m = /"last_payment_value":\s*(\d+)/.exec(row?.a ?? '');
        if (m) seen.add(Number(m[1]));
    }
    const orders = new Set(withUr.map((r) => r.caso.income!));
    if (seen.size === 1 && orders.size > 1) {
        return `el buró devolvió SIEMPRE ${[...seen][0].toLocaleString('es-CO')} pese a que se`
            + ` dictaron ${orders.size} ingresos distintos → los drivers KYC están en \`fake\` e`
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
    const cases: Case[] = arg('suite')
        ? await loadSuite(arg('suite'), dflt)
        : arg('casos')
            ? arg('casos').split(';').map((x) => parseCase(x, dflt))
            : [parseCase(`${arg('comercio', 'pullman')}${arg('lender') ? ':' + arg('lender') : ''}`, dflt)];
    const par = flag('paralelo');

    console.log(`\n  CASOS · ${cases.length} · ${par ? 'EN PARALELO' : 'en serie'} · ${API}\n`);
    // La línea base para conciliar al final: qué había en la base ANTES de que este runner tocara nada.
    // Son dos lecturas, así que pasan sin el permiso de escritura (que sólo cubre lo que escribe).
    const baseline = await dbBaseline();
    { const wired = await e2eConfigMod.wireMockDocProjects((process.env.E2E_TARGET || 'local').toLowerCase()).catch((e: any) => `⚠ no pude cablear los proyectos del pdf-mapper: ${e?.message ?? e}`); if (wired) console.log(`  ${wired}\n`); }
    const missing = await preflightCheck(cases);
    if (missing.length) {
        console.log('  ⚠ PREVUELO — falta algo, y sin esto el resultado MIENTE:\n');
        for (const f of missing) console.log(`      · ${f}`);
        console.log('');
        return 2;
    }
    if (flag('lambda')) {
        const failures = await dictateAll(cases);
        console.log(`  respuestas del buró pedidas a la lambda: ${cases.length - failures.length}/${cases.length}`
            + (failures.length ? `  ⚠ fallaron ${failures.join(', ')}` : '') + '\n');
    }
    // Los teléfonos de esta tanda entran a la lista de bypass ANTES de arrancar, de una y en serie
    // (ver `registerBypass`). Sólo si se va a cerrar: para el listado el driver fake no mira el
    // teléfono, así que ampliar la lista sería tocar la BD sin necesidad.
    if (flag('cerrar')) {
        // ⚠ Tiene que resolver el país ANTES, igual que el motor: si acá se arma el teléfono con la
        // forma colombiana y allá con la del comercio, la lista de bypass queda con números que nadie
        // usa — y la firma del pagaré falla con 422 en un país que sí estaba bien configurado.
        // ⚠ Acá no hay caso que abortar: la lista de bypass se escribe ANTES de correr. Si el país no
        // resuelve, un teléfono con la forma equivocada entraría a `qa_otp_bypass_phones` y la firma
        // fallaría después con un 422 que no se parece a la causa. Mejor frenar la corrida entera.
        // ⚠ Y VA EL DEL CODEUDOR TAMBIÉN. No se sabe de antemano qué caso va a necesitar uno —lo
        // decide la POLÍTICA de la categoría en la que caiga el usuario, no el caso—, así que se
        // registran los dos siempre: el par cuesta una entrada en una lista que se restaura al
        // terminar, y su ausencia trababa el cierre de toda entidad con codeudor.
        const tels = (await Promise.all(cases.map(async (c, i) => {
            const br = await findBranch(c.comercio);
            if (!br) return phoneOf(i, 'COL');            // el caso va a fallar solo con «no encontré»
            const iso = await merchantCountry(br.hash);
            if (iso === null) throw new Error(`${c.comercio}: ${NO_COUNTRY}`);
            return phoneOf(i, iso);
        }))).flatMap((t) => [t, coSignerPhone(t)]);
        // ⚠ El aviso NOMBRA la causa. Sin eso, la corrida no muere acá: muere en la firma, con 422 y la
        // solicitud en estado 10 — un síntoma que no se parece en nada a «faltó un permiso de escritura».
        const r = await registerBypass(tels).catch((e) => ({ ok: false as const, motivo: e instanceof Error ? e.message : String(e) }));
        if (r.ok) bypassSet = r.puesto;
        else {
            console.log(`  ⚠ no se pudo ampliar \`qa_otp_bypass_phones\`, así que la firma del pagaré va a fallar`
                + ` con 422 y la solicitud va a quedar en estado 10, que no se parece a la causa: ${r.motivo}\n`);
        }
    }

    const t0 = Date.now();
    // Un caso con `pasos` devuelve VARIOS resultados; uno normal, uno. Se aplana para que el resto del
    // reporte —y el verificador— no tengan que saber de la diferencia.
    const oneCase = (c: Case, i: number): Promise<Res[]> =>
        (c.pasos?.length ? runSteps(c, i) : correr(c, i).then((r) => [r]))
            .catch((e) => [{ caso: c, ok: false, phone: '', detalle: String(e).slice(0, 90) } as Res]);

    const res = par
        ? (await Promise.all(cases.map((c, i) => oneCase(c, i)))).flat()
        : await (async () => {
            const out: Res[] = [];
            for (let i = 0; i < cases.length; i++) {
                out.push(...await oneCase(cases[i], i));
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
    const withListing = res.filter((r) => r.listado?.length);
    if (withListing.length > 1) {
        const sets = withListing.map((r) => new Set(r.listado!));
        const common = [...sets[0]].filter((x) => sets.every((s) => s.has(x)));
        console.log(`\n  EN QUÉ SE DIFERENCIAN\n`);
        console.log(`    en TODOS los casos : ${common.length ? common.join(', ') : '(ninguna)'}`);
        for (let k = 0; k < withListing.length; k++) {
            const only = withListing[k].listado!.filter((x) => !sets.every((s) => s.has(x)));
            const c = withListing[k].caso;
            const lbl = `${c.comercio}${c.lender === null ? '' : ':' + c.lender}`;
            console.log(`    sólo en ${lbl.padEnd(18)}: ${only.length ? only.join(', ') : '(nada propio)'}`);
        }
        // ⚠ listados IDÉNTICOS no significan «el parámetro no influye»: puede significar que el
        // parámetro nunca llegó. Con `--lambda`, la comprobación es que `approximate_real_salary` en
        // `user_summaries` sea distinto por caso (ver F-139).
        if (withListing.every((r) => r.listado!.length === common.length)) {
            console.log(`\n    ⚠ todos idénticos. Antes de concluir «no influye», verificá que el dato`);
            console.log(`      LLEGÓ: SELECT agildata FROM user_summaries WHERE user_id=… (F-139)`);
        }
    }

    // El recuento del cierre va aparte del de casos: «sin CreditopX» NO es un fallo, es un hecho del
    // comercio, y mezclarlos haría ver rota la mitad del catálogo.
    const withClosing = res.filter((r) => r.cierre);
    if (withClosing.length) {
        const closedOnes = withClosing.filter((r) => r.cierre!.cerro).length;
        const withoutCtopx = withClosing.filter((r) => r.cierre!.motivo === 'sin CreditopX').length;
        // Los que deciden AFUERA (rt=0/1) no se cuentan como trabados: no hay cierre que probar acá.
        const outside = withClosing.filter((r) => r.cierre!.fueraDePlataforma).length;
        const stuck = withClosing.length - closedOnes - withoutCtopx - outside;
        // El encabezado decía «CIERRE rt=2» siempre, incluso corriendo rt=3 y rt=4 — un rótulo que
        // contradice a la línea de abajo y hace dudar de cuál de las dos es la cierta.
        // Un caso que cerró POR WEBHOOK no cerró «en plataforma», pero tampoco se quedó sin desenlace:
        // contarlo sólo como «decide afuera» lo esconde, que es el error contrario al que se arregló
        // antes. Se cuenta aparte, con su propia palabra.
        const byWebhook = withClosing.filter((r) => r.cierre!.webhook?.startsWith('webhook')).length;
        console.log(`\n  CIERRE — ${closedOnes} cerraron en estado 11 · ${withoutCtopx} sin CreditopX`
            + (outside ? ` · ${outside} deciden afuera (rt=0/1)` : '')
            + (byWebhook ? ` · ${byWebhook} con desenlace por webhook` : '')
            + (stuck ? ` · ⚠ ${stuck} se trabaron` : ''));
        for (const r of withClosing.filter((x) => !x.cierre!.cerro && x.cierre!.motivo !== 'sin CreditopX'
                                               && !x.cierre!.fueraDePlataforma)) {
            console.log(`      ⚠ ${r.caso.comercio}: ${r.cierre!.motivo}`
                + (r.cierre!.estado ? ` · quedó en estado ${r.cierre!.estado}` : ''));
        }
    }

    const lie = await bureauArrived(res);
    if (lie) console.log(`\n  ⚠ ${lie}`);

    const badList = res.filter((r) => !r.ok).length;
    console.log(`\n  ${res.length - badList}/${res.length} cerraron · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    await reconcileWithDb(baseline, res.length - badList);

    const deviations = [...verifyWaits(res), ...await verifyCountries(res)];
    if (deviations.length) {
        console.log('\n  ⚠ NO CUMPLIERON LO QUE DECLARAN:\n');
        for (const d of deviations) console.log(`      · ${d.linea}`);
        console.log('');

        // Y para los que se desviaron, la otra mitad: qué DECIDIÓ el backend. «La entidad no salió en
        // el listado» es el desvío más común, y una regla que excluye una entidad **no mueve ningún
        // estado ni cambia ningún status HTTP** — así que la bitácora no puede explicarlo y el log de
        // reglas sí. Se pide una sola vez por solicitud aunque haya varios desvíos del mismo caso.
        for (const ur of new Set(deviations.map((d) => d.res.ur).filter(Boolean))) {
            await forensicOnClose(ur!, { existe: true, ok: false, malo: false, miente: [] }).catch(() => {});
        }
        return 1;
    }
    if (res.some((r) => r.caso.espera)) {
        const withWait = res.filter((r) => r.caso.espera).length;
        console.log(`  ✓ ${withWait} ${withWait === 1 ? 'caso cumplió' : 'casos cumplieron'} lo que declaran\n`);
    }
    // ⚠ uReq REPETIDO entre casos sería la señal de que se pisaron. Con teléfono por caso no debería
    // pasar nunca; si pasa, hay un recurso compartido de verdad y hay que ir a buscarlo.
    const urList = res.map((r) => r.ur).filter(Boolean);
    if (new Set(urList).size !== urList.length) console.log('  ⚠ DOS CASOS COMPARTIERON SOLICITUD — se pisaron');
    console.log();
    await annotate(res, badList);
    return badList ? 1 : 0;
}

/**
 * LA CORRIDA COMO ANOTACIÓN, con `MD=1`. El porqué completo en `pkg/annotation.ts`.
 *
 * ⚠ LO QUE SE RESUME ES EL DESENLACE, NO EL CONTEO. «3/3 cerraron» no dice nada que sirva dentro de una
 * tarea tres semanas después: lo que se pega tiene que decir QUÉ entidades salieron y DÓNDE terminó
 * cada caso, que es lo que alguien va a querer contrastar. El conteo va igual, pero de segundo.
 */
async function annotate(res: Res[], badList: number): Promise<void> {
    if (process.env.MD !== '1' && !process.env.BLOQUE) return;
    const { emit, cmdMake } = await import('../pkg/annotation.ts');
    // El target sale del env, que es donde este runner lo fija (arriba, con `||=`): no hay una
    // constante que importar, y leer otra cosa sería inventar un segundo lugar donde vive el ambiente.
    const TARGET = process.env.E2E_TARGET || 'local';
    const withClosing = res.filter((r) => r.cierre);
    const closedOnes = withClosing.filter((r) => r.cierre!.cerro).length;

    const summary = `${res.length - badList}/${res.length} caso(s) en \`${TARGET}\``
        + (withClosing.length ? ` · ${closedOnes}/${withClosing.length} cerraron en estado 11` : ' (sin `CERRAR`: llega al listado)')
        + '.';
    // Una línea por caso: qué se pidió, qué le salió y dónde terminó. El listado va con los ids porque
    // es la respuesta a «¿por qué a este comercio le sale ESA entidad?», que es para lo que se corre.
    const evidence = res.map((r) => {
        const parts = [`${r.ok ? '✔' : '✘'} ${r.caso.comercio}`];
        if (r.caso.lender) parts.push(`entidad ${r.caso.lender}`);
        if (r.ur) parts.push(`uReq ${r.ur}`);
        if (r.listado?.length) parts.push(`listado [${r.listado.join(', ')}]`);
        if (r.cierre) {
            parts.push(r.cierre.cerro
                ? `cerró${r.cierre.estado ? ` en estado ${r.cierre.estado}` : ''}`
                : `NO cerró: ${r.cierre.motivo}`);
        }
        if (!r.ok && r.detalle) parts.push(r.detalle);
        return parts.join(' · ');
    });
    emit(summary, cmdMake('harness-caso', TARGET, {
        SUITE: arg('suite'), CASOS: arg('casos'), COMERCIO: arg('comercio'), LENDER: arg('lender'),
        MONTO: arg('amount'), PAR: flag('paralelo') ? 1 : '', LAMBDA: flag('lambda') ? 1 : '',
        PRE: flag('preaprobados') ? 1 : '', CERRAR: flag('cerrar') ? 1 : '', MANUAL: flag('manual') ? 1 : '',
    }), evidence);
}

const code = await main().catch((e) => { console.error('\n  ✗', e); return 1; });
await restoreBypass(bypassSet);
await close().catch(() => {});
process.exit(code);
