<?php

/**
 * ¿Se puede cancelar esta solicitud, y si no, qué lo frena?
 *
 * Evalúa, SIN CANCELAR, las tres guardas con las que `UserRequestRepository::safeCancel` decide: la solicitud ya
 * autorizada (estado 11), un crédito ya creado en el core (`CREACIÓN` en el historial de CreditopX) y la cuota inicial
 * pagada (`hasApprovedInitialFeePayment`, la que hace que `CancelRequestService` conteste
 * `InitialFeePaidCancellationException`). No llama a `cancelRequest`: además de escribir, borra el QR en S3 y avisa a
 * la tienda.
 *
 * ⚠ Es una copia de las guardas, no la función: si `safeCancel` cambia, hay que cambiar esta receta.
 *
 * Sólo lee.
 *
 * @repo legacy-backend
 * @param ureq el número de la solicitud (user_request_id)
 */

use App\Models\UserRequest;
use Modules\Loans\Contracts\Repositories\InitialFeePaymentStatusRepositoryInterface;

$request = UserRequest::with(['lender', 'alliedBranch'])->find((int) $params['ureq']);
if (! $request) {
    throw new RuntimeException("no hay solicitud {$params['ureq']} en la base local");
}

$authorized = (int) $request->user_request_status_id === 11;
$coreCreation = $request->creditopXRequestHistories()->where('movement_type', 'CREACIÓN')->exists();
$feePaid = app(InitialFeePaymentStatusRepositoryInterface::class)->hasApprovedInitialFeePayment($request->id);

$blockedBy = array_values(array_filter([
    $authorized ? 'ya está autorizada (estado 11)' : null,
    $coreCreation ? 'el crédito ya se creó en el core' : null,
    $feePaid ? 'la cuota inicial está pagada (InitialFeePaidCancellationException)' : null,
]));

return [
    'ureq' => $request->id,
    // `$request->status` es una COLUMNA de user_requests que tapa la relación del mismo nombre: se va por la relación.
    'status' => [(int) $request->user_request_status_id, $request->status()->value('name')],
    'lender' => $request->lender?->name,
    'branch' => $request->alliedBranch?->hash,
    'can_cancel' => $blockedBy === [],
    'blocked_by' => $blockedBy,
];
