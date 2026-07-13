// Mock del MS de pre-aprobaciones (github/pre-approvals-service · POST /v1/preapprovals/check).
// Devuelve respuestas DETERMINISTAS para un happy path: todas las cards pre-aprobadas con
// cupo + cuotas, sin depender de los proveedores externos (tars-dev/welli intermitentes) ni
// de la frontera synth (rechazos reales). Cero dependencias.
//
// Contrato (LenderPreApprovalResultSchema del wizard + openapi del MS):
//   req:  { applicant_id, merchant_id, lending_product_key, lending_product_id, amount?, allied_branch_hash?, user_request_id? }
//   resp: { id, applicant_id, lending_product_key, lending_product_id, status, approved_amount?, available?,
//           probability?, probability_color?, sort?, pre_approved_lender?, transaction_id?, checked_at, transaction_data }
//
// Estado: por defecto "approved". Override global por env MOCK_PA_STATUS, o por request
// (?status=rejected|pending|approved  ·  header x-mock-status  ·  body.force_status).
//
// Uso:  node mock-preapprovals/server.mjs   (o  bin/mock-preapprovals start)
//   env: MOCK_PA_PORT (8095) · MOCK_PA_STATUS (approved) · MOCK_PA_CUPO (25000000) · MOCK_PA_RATE (0.0188)

import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.MOCK_PA_PORT || 8095);
const FORCE = (process.env.MOCK_PA_STATUS || "approved").toLowerCase();
const CUPO = Number(process.env.MOCK_PA_CUPO || 25_000_000);
const RATE = Number(process.env.MOCK_PA_RATE || 0.0188); // 1.88% M.V — lo que muestran las cards
const TERMS = [12, 24, 36, 48];

// cuota mensual por amortización francesa (mismo formato que muestran las cards)
const cuota = (amount, term) => Math.round((amount * RATE) / (1 - Math.pow(1 + RATE, -term)));

// transaction_data por-lender (lo que leen los extractores del marketplace). Para el resto,
// null → la card usa el camino genérico (credit_lines + CalculateLoanFinancialsUc).
function txData(key, amount) {
      const k = String(key || "").toLowerCase();
      if (k === "welli" || k.includes("welli")) {
            const plan = {};
            for (const t of TERMS) plan[t] = { resultado: true, cuota_asignacion: cuota(amount, t) };
            return { plan_de_cuotas: plan }; // extractWelliInstallments
      }
      if (k === "meddipay") {
            // extractMeddipayTermOptions: [{term:minTerm, installment:maxInstallment}, {term:maxTerm, installment:minInstallment}]
            return {
                  commercialOffer: [
                        {
                              idGroup: "MOCK_STD",
                              displayTextGroup: "Oferta mock",
                              minTerm: 12,
                              maxTerm: 36,
                              minInstallment: cuota(amount, 36), // término largo → cuota baja
                              maxInstallment: cuota(amount, 12), // término corto → cuota alta
                        },
                  ],
            };
      }
      if (k === "prami") {
            return { quotas: TERMS.map((t) => ({ term: t, quotaValue: cuota(amount, t) })) }; // extractPramiQuotas
      }
      return null; // genérico
}

function build(req, status) {
      const amount = Number(req.amount) > 0 ? Number(req.amount) : 600_000;
      const base = {
            id: randomUUID(),
            applicant_id: String(req.applicant_id ?? ""),
            lending_product_key: String(req.lending_product_key ?? ""),
            lending_product_id: String(req.lending_product_id ?? ""),
            status,
            checked_at: new Date().toISOString(),
            transaction_id: `mock-${req.lending_product_key ?? "x"}-${Date.now()}`,
      };
      if (status === "pending") {
            return { ...base, approved_amount: null, available: null, transaction_data: null };
      }
      if (status === "rejected") {
            return {
                  ...base,
                  approved_amount: null,
                  available: 0,
                  pre_approved_lender: false,
                  probability: "Rechazado",
                  probability_color: "text-info",
                  sort: 2,
                  transaction_data: null,
            };
      }
      // approved
      return {
            ...base,
            approved_amount: String(amount),
            available: CUPO,
            pre_approved_lender: true,
            probability: "Pre aprobado",
            probability_color: "text-success",
            sort: 1,
            transaction_data: txData(req.lending_product_key, amount),
      };
}

function norm(s) {
      const v = String(s || "").toLowerCase();
      return v === "rejected" || v === "pending" || v === "approved" ? v : "approved";
}

const server = http.createServer((r, res) => {
      if (r.method === "GET") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, service: "mock-preapprovals", force: FORCE, cupo: CUPO }));
            return;
      }
      if (r.method === "POST" && r.url.startsWith("/v1/preapprovals/check")) {
            let body = "";
            r.on("data", (c) => (body += c));
            r.on("end", () => {
                  let req = {};
                  try {
                        req = JSON.parse(body || "{}");
                  } catch {
                        /* payload vacío/ inválido → defaults */
                  }
                  const u = new URL(r.url, "http://x");
                  const status = norm(
                        u.searchParams.get("status") || r.headers["x-mock-status"] || req.force_status || FORCE,
                  );
                  const payload = build(req, status);
                  console.log(
                        `[mock-pa] ${payload.lending_product_key}#${payload.lending_product_id} amount=${req.amount ?? "-"} ur=${req.user_request_id ?? "-"} → ${payload.status}`,
                  );
                  res.writeHead(200, { "content-type": "application/json" });
                  res.end(JSON.stringify(payload));
            });
            return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found", details: `${r.method} ${r.url}` }));
});

server.listen(PORT, () => {
      console.log(
            `mock-preapprovals → http://localhost:${PORT}/v1/preapprovals/check  (force=${FORCE} · cupo=${CUPO} · rate=${RATE})`,
      );
});
