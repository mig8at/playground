<?php

/**
 * ¿Qué continuidad laboral le da el perfilamiento al cliente de una solicitud, y de qué central sale?
 *
 * `LenderUserCategoryService::getContinuity` lee `user_summaries` y toma Ágil Data y, si es null, Mareigua
 * (`agildata ?? mareigua`). Una lista VACÍA no es null: con Ágil Data sin información el servicio da 0 aunque
 * Mareigua traiga 6 o 12 (la incidencia de la continuidad, 2026-11-03). Esta receta muestra lo que trae cada
 * central, lo que daría cada una por separado y lo que dice el servicio de verdad, llamado por reflexión porque
 * el método es privado.
 *
 * Sólo lee.
 *
 * @repo legacy-backend
 * @param ureq el número de la solicitud (user_request_id)
 */

use App\Models\UserRequest;
use Modules\Loans\App\Services\LenderUserCategoryService;

$request = UserRequest::find((int) $params['ureq']);
if (! $request) {
    throw new RuntimeException("no hay solicitud {$params['ureq']} en la base local");
}
$user = $request->user;
$summary = $user?->userSummary;

$months = function ($data): int {
    $data ??= [];

    return ($data['continuity_12_months'] ?? false) ? 12
        : (($data['continuity_6_months'] ?? false) ? 6
            : (($data['continuity_3_months'] ?? false) ? 3 : 0));
};
$describe = fn ($data) => [
    'present' => $data !== null,
    'empty' => $data !== null && empty($data),
    'months' => $months($data),
];

$service = app(LenderUserCategoryService::class);
$method = new ReflectionMethod($service, 'getContinuity');
$method->setAccessible(true);
$says = $user ? $method->invoke($service, $user) : null;

$agildata = $summary?->agildata;
$mareigua = $summary?->mareigua;
$best = max($months($agildata), $months($mareigua));

return [
    'ureq' => $request->id,
    'user_id' => $user?->id,
    'has_summary' => (bool) $summary,
    'agildata' => $describe($agildata),
    'mareigua' => $describe($mareigua),
    'service_says' => $says,
    // El caso de la incidencia: el servicio da menos de lo que trae alguna de las dos centrales.
    'lost_months' => $says !== null && $says < $best ? $best - $says : 0,
];
