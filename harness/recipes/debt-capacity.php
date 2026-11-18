<?php

/**
 * ¿Qué capacidad de endeudamiento tiene el cliente de una solicitud, con su desglose, y qué monto le da Finandina?
 *
 * Es `DebtCapacityReviewService::forUserRequest`, lo mismo que muestra el detalle de la solicitud en el backoffice:
 * ingreso, gastos, cuotas del buró, la capacidad que queda y, si el perfil es de Finandina, el monto de su política con
 * el mismo cálculo del motor (`FinandinaAmountCalculator::calculateFor`). Se recalcula con los datos de hoy: si hubo
 * una consulta al buró después de la decisión, `engine.report_is_newer` lo marca.
 *
 * Sólo lee.
 *
 * @repo legacy-backend
 * @param ureq el número de la solicitud (user_request_id)
 */

use Modules\Loans\App\Services\DebtCapacity\DebtCapacityReviewService;

$review = app(DebtCapacityReviewService::class)->forUserRequest((int) $params['ureq']);
if ($review === null) {
    throw new RuntimeException("la solicitud {$params['ureq']} no tiene revisión de capacidad (¿existe en la base local? ¿pasó por el motor?)");
}

return $review;
