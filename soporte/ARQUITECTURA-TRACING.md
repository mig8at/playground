# Arquitectura — `tracing-service` (Fase 1 del Trazador de solicitudes)

> **Qué es esto.** Diseño para llevar el [Trazador](./) de un demo con datos mock (Fase 0) a producción:
> un **microservicio agregador** que, dado un documento/cédula, arma **toda la traza** de las solicitudes
> de ese cliente combinando **base de datos + DynamoDB + Loki + re-evaluación**, y la devuelve como un
> JSON que el front consume tal cual (reemplaza a `src/mock.js`).
>
> **Idea central.** El servicio **no es dueño de ningún dato**: es un *read model / BFF de soporte* que
> **lee de las fuentes autoritativas y las compone** en una vista de "hasta dónde llegó y por qué se rompió".
> Grounded en [`flow/MAP.md`](../flow/MAP.md) (dónde vive cada dato) y [`flow/FAQ-SOPORTE.md`](../flow/FAQ-SOPORTE.md).

---

## 1 · Principio de diseño

- **Agregador, no dueño.** No duplica ni cachea el estado de verdad; consulta y compone al vuelo (con cache corta opcional).
- **El front no toca la DB.** La app `soporte` solo habla con este servicio. Todo el acceso a datos, permisos y PII se resuelve **dentro** del servicio.
- **Fuente por capa** (ver §3):
  - *Esqueleto* (hasta dónde llegó) → **estructurado** (DB + DynamoDB).
  - *Porqué fino* (qué regla falló) → **re-evaluación** (rt=2) y/o **Loki** (logs).
- **Provenance visible.** Cada dato de la traza lleva de qué fuente salió (`db` / `dynamodb` / `loki` / `reeval`), para que soporte sepa cuánto confiar y para depurar.

---

## 2 · Arquitectura (hexagonal, Go — igual que `pre-approvals-service` / `kyc-gateway`)

```
                          soporte (Vue)  ── GET /v1/trace?documento=…  ──►  tracing-service
                                                                                  │
   ┌──────────────────────────────────────────────────────────────────────────── ▼ ────────┐
   │  CORE (usecase)   AssembleTrace(documento) → Trace                                       │
   │     1. resuelve documento → user(s) → intentos (user_requests)                           │
   │     2. por intento: arma la línea de estados + cada etapa (ok/warn/fail/skip)            │
   │     3. rellena el "porqué": rt=1 (attempts) · rt=2 (reeval) · enriquece con Loki         │
   │     4. enmascara PII + registra auditoría                                                │
   └───┬───────────────┬────────────────┬──────────────────┬───────────────┬─────────────────┘
       │ ports…        │                │                  │               │
   ┌───▼────┐    ┌─────▼──────┐   ┌─────▼───────┐   ┌───────▼──────┐  ┌─────▼──────┐
   │ Request│    │ RiskData / │   │ PreApproval │   │  LogQuery    │  │ RuleReEval │
   │ Repo   │    │ Displayed  │   │ Attempts    │   │  (Loki)      │  │ (rt=2)     │
   │ (SQL)  │    │ Lenders    │   │ (pre-appr.  │   │              │  │            │
   │        │    │ (SQL)      │   │  service)   │   │              │  │            │
   └───┬────┘    └─────┬──────┘   └─────┬───────┘   └──────┬───────┘  └─────┬──────┘
       │ adapters…     │                │                  │                │
   read-replica    read-replica   HTTP al MS Go      LogQL HTTP        motor de reglas
   (application/    (application)  (list_by_request)  a Loki           (o el simulador)
    legacy)
```

- **Ubicación sugerida:** `github/microservices/tracing-service` (mismo patrón que los otros MS Go). El doc vive en `soporte` porque es quien lo consume.
- **Por qué Go hexagonal:** consistencia con el stack (`pre-approvals-service`, `kyc-gateway`, `customer-service`), y los *ports* permiten empezar con adapters mock e ir cableando fuentes reales una por una.

---

## 3 · Fuentes de datos (qué aporta cada una y cómo se accede)

| Etapa del flujo | Fuente autoritativa | Store | Cómo accederla | Qué aporta |
|---|---|---|---|---|
| **registro / OTP** | `user_requests`, `user_request_records` | SQL | read-replica o API interna | creación, timestamps, estado inicial |
| **formulario** | `user_requests` (estado 9) | SQL | ídem | si completó datos personales/laborales |
| **burós** | `risk_central_user_data` | SQL | ídem | si se consultó datacrédito + score |
| **listado** (rt=2) | `displayed_lenders` (snapshot de perfilamiento) | SQL | ídem | qué entidades se mostraron + clasificación |
| **listado** (rt=1) | `preapproval_attempts` | **DynamoDB** | **HTTP al `pre-approvals-service`** (`list_by_lender` / nuevo `list_by_request`) | intento por lender con **stage + código de error** |
| **selección** | `user_requests.lender_id` (estado 3) | SQL | ídem | entidad elegida |
| **cupo / POS** (rt=2) | *no persistido con razón* → **re-evaluación** o `CreditopXQuotaController` | reeval / SQL | motor de reglas | cupo real + **por qué 0 / no viable** |
| **cupo / POS** (rt=1) | `preapproval_attempts` (approved_amount) | DynamoDB | pre-approvals-service | cupo/veredicto de la API externa |
| **desembolso** | `user_requests` (estado 11) + registro del webhook `lender-result` | SQL | ídem | originado / voucher / si sincronizó |
| **porqué fino (cualquier etapa)** | logs de ejecución (spans, `EXPERIAN_TRIGGERED`, errores) | **Loki** | LogQL por `user_request_id` | enriquece el `reason` cuando no está en tablas |

> ⚠️ **Strangler (application ↔ legacy).** Varios datos existen en los dos backends. El servicio debe
> saber cuál es autoritativo por campo (lo documenta `MAP.md`) o consultar ambos y priorizar el vivo
> (`application` hoy). Encapsular esto en el `RequestRepo` para que el core no se entere.

---

## 4 · Contrato de salida (JSON) — el mismo shape que `src/mock.js`

Así el front solo cambia el origen (mock → `fetch`), sin tocar la UI.

```jsonc
{
  "documento": "1032•••008",        // SIEMPRE enmascarado en la respuesta
  "nombre": "Cliente 1032•••008",
  "meta": {
    "assembledAt": "2026-07-11T18:20:00-05:00",
    "sources": ["db", "dynamodb", "loki", "reeval"],
    "partial": false,               // true si alguna fuente no respondió (degradación)
    "warnings": []                  // ej. "loki: fuera de retención para UR-8790"
  },
  "intentos": [
    {
      "id": "UR-8842",
      "fecha": "2026-05-07T15:16:00-05:00",
      "comercio": "Dentix", "sucursal": "Plaza de las Américas",
      "producto": "CreditopX", "responseType": 2, "monto": 1200000,
      "outcome": "roto",            // aprobado | roto | abandonado
      "brokeAt": "cupo",            // id de etapa que rompió, o null
      "stages": {
        "registro":   { "status": "ok",   "detail": "OTP validado 15:10", "source": "db" },
        "formulario": { "status": "ok",   "detail": "Datos completos",     "source": "db" },
        "buro":       { "status": "ok",   "detail": "Datacrédito · score 612", "source": "db" },
        "listado":    { "status": "ok",   "detail": "2 entidades mostradas", "source": "db",
          "lenders": [
            { "name": "Dentix (DFS)", "rt": 2, "verdict": "ok",    "reason": "Preaprobado mostrado", "source": "db" },
            { "name": "Welli",        "rt": 1, "verdict": "error", "stage": "api_call",
              "code": "upstream_timeout", "reason": "Timeout consultando su API", "source": "dynamodb" }
          ] },
        "seleccion":  { "status": "ok",   "detail": "Eligió Dentix (DFS)", "source": "db" },
        "cupo":       { "status": "fail", "detail": "Cupo $0",
          "reason": "Crédito CreditopX activo → active_credit excluye el cupo",
          "source": "reeval", "faq": "A1" },
        "desembolso": { "status": "skip", "source": "db" }
      }
    }
  ]
}
```

**Enums** — `status`: `ok | warn | fail | skip` · `outcome`: `aprobado | roto | abandonado` · `verdict` (lender): `ok | lowp | error | excl`.

---

## 5 · El "porqué" — la parte no trivial

| Tipo | Estado hoy | Cómo obtenerlo |
|---|---|---|
| **rt=1 (agregadores)** | ✅ **ya persistido** | `preapproval_attempts` guarda `stage` + `code` → se pide al `pre-approvals-service`. Cero DB, cero Loki. |
| **rt=2 (CreditopX)** | ⚠️ no persiste la razón fina | **(a) Re-evaluar** con el motor de reglas cargando los datos del cliente → reconstruye "qué compuerta lo excluyó" al vuelo, sin logs. *Camino recomendado para empezar.* **(b)** Instrumentar el back para loguear la razón → leerla de **Loki**. |
| **infra (OTP rebota, link no carga)** | logs | **Loki** por `user_request_id` (si está instrumentado). |

### Sobre Loki (para qué sí y para qué no)
- **Sí:** enriquecer `reason` con lo que solo vive en logs (por qué no disparó datacrédito, error crudo del agregador, timeouts de OTP).
- **Consulta:** LogQL filtrando por label/campo, ej. `{app="onboarding"} | json | user_request_id="UR-8842"`.
- **No (límites):**
  1. **Retención** — logs viejos se borran (típico 15–30 días) → casos recientes, no históricos. El servicio marca `meta.warnings` cuando el intento cae fuera de retención.
  2. **Requiere instrumentación** — solo sirve si el back **ya loguea con `user_request_id` como campo consultable**. Si no, primero hay que instrumentar (tarea de back, no de este servicio).
- **Conclusión:** Loki es **complemento opcional**, no el backbone. El esqueleto sale de datos estructurados; el porqué de rt=2 se puede resolver **sin Loki** con re-evaluación.

---

## 6 · Ensamblado (pseudocódigo del usecase)

```
AssembleTrace(documento):
  users     = RequestRepo.findUsersByDocument(documento)          # DB (application/legacy)
  intentos  = RequestRepo.listRequests(users)                     # user_requests + records
  for it in intentos:
     records   = RequestRepo.stateHistory(it.id)                  # línea de estados 1→9→3→11
     risk      = RiskDataRepo.byRequest(it.id)                    # buró consultado + score
     shown     = DisplayedLendersRepo.byRequest(it.id)            # qué se mostró (rt=2)
     attempts  = PreApprovalAttempts.byRequest(it.id)             # rt=1: stage+error (DynamoDB)
     stages    = mapToStages(records, risk, shown, attempts)      # → ok/warn/fail/skip por etapa
     if it.responseType == 2 and stages.cupo.needsReason:
         stages.cupo.reason = RuleReEval.explain(it, risk)        # rt=2: por qué 0 / no viable
     enrichFromLoki(stages, it.id)                                # opcional: reason desde logs
     it.stages = mask(stages)                                     # enmascara PII
  audit(actor, documento)                                         # quién consultó qué
  return Trace{ documento: mask(documento), intentos }
```

- **Resiliencia:** si una fuente falla (Loki caído, DynamoDB lento), se devuelve `partial: true` con lo que sí se pudo componer — la herramienta nunca se queda en blanco.
- **Cache:** opcional, TTL corto (ej. 60s) por `documento` para no golpear las fuentes en refrescos.

---

## 7 · Seguridad, PII y gobernanza (no negociable)

- **Auth:** solo rol *soporte* (SSO/JWT). El servicio valida el rol en cada request.
- **Enmascarado:** documentos/teléfonos **siempre enmascarados** en la respuesta (`1032•••008`); el número completo nunca sale del servicio.
- **Auditoría:** cada consulta registra *quién* miró *qué documento* y *cuándo*.
- **Solo lectura:** el servicio no escribe en ningún lado; idealmente lee de **réplicas de lectura**, no de la primaria de prod (aísla carga y riesgo).
- **Sin PII en URL:** el documento va en body/header o parámetro no logueado; nunca en query string que quede en logs.

---

## 8 · Fases de entrega

| Fase | Alcance | Estado |
|---|---|---|
| **0** | Front + grafo con datos **mock** (`src/mock.js`) | ✅ hecho |
| **1** | `tracing-service`: esqueleto real desde **DB + DynamoDB** (sin Loki, rt=2 con re-evaluación). Auth + enmascarado + auditoría. | pendiente |
| **2** | Enriquecer el "porqué" con **Loki** (requiere instrumentar `user_request_id` en logs del back) | pendiente |
| **3** | Endurecer: cache, réplicas de lectura, alertas de fuentes caídas, métricas de uso de soporte | pendiente |

**Recomendación:** entregar **Fase 1 sin Loki** primero — cubre el "hasta dónde llegó" (DB), el porqué de agregadores (DynamoDB, ya listo) y el porqué de CreditopX (re-evaluación). Loki entra en Fase 2 solo si se necesita el detalle de logs.

---

## 9 · Etapas y estados canónicos (referencia)

**Etapas:** `registro → formulario → buro → listado → seleccion → cupo → desembolso`
**Estados de `user_requests`:** `1` creada · `9` formulario · `3` selección · `11` aprobado/desembolso · `25/26` otros
**Mapa estado → etapa alcanzada:** 1→registro · 9→formulario · 3→selección · 11→desembolso (las intermedias se infieren de `records`, `risk_central`, `displayed_lenders`, `attempts`).

## 10 · Riesgos / decisiones abiertas
- **¿Read-replica directa vs endpoints internos?** Replica = más rápido de construir pero acopla al esquema de dos backends; endpoints internos = desacoplado pero hay que crearlos. Recomendado: replica para el esqueleto, servicio para attempts.
- **Instrumentación de Loki:** ¿el back ya loguea `user_request_id` estructurado? Si no, Fase 2 depende de esa tarea previa.
- **rt=2 re-evaluación:** ¿reusamos el motor real del back o el del simulador? El del back es la verdad; el del simulador es más fácil pero puede derivar. Decisión de producto.
- **Retención histórica:** para casos viejos (fuera de Loki), el "porqué" fino puede no estar disponible → mostrar "sin detalle de logs (fuera de retención)".

---

*Diseño para `github/microservices/tracing-service`, consumido por `playground/soporte`. Basado en el mapa verificado del flujo (`flow/MAP.md`) y el barrido de #tech-ops (`flow/FAQ-SOPORTE.md`).*
