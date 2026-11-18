<?php

/**
 * ¿Qué ingreso mensual toma el perfilamiento para el cliente de una solicitud, y de qué fuente sale?
 *
 * Es el `MonthlyIncomeResolver`: formal (la primera central con monto > 0: Ágil Data, Mareigua, Quanto) más el
 * informal (Ábaco, campo 235), y si los dos dan 0, lo declarado (campo 87). Un 0 cuenta como «sin dato»: antes ganaba
 * y dejaba a unos 36.800 usuarios con salario 0. Muestra además el ingreso VERIFICADO de Finandina (sólo Ágil Data o
 * Mareigua) y lo que trae cada central, para ver por qué ganó la que ganó.
 *
 * Sólo lee.
 *
 * @repo legacy-backend
 * @param ureq el número de la solicitud (user_request_id)
 */

use App\Models\UserRequest;
use Modules\Loans\App\Services\Income\MonthlyIncomeResolver;
use Modules\Onboarding\App\Constants\IncomeFieldsConstants;

$request = UserRequest::find((int) $params['ureq']);
if (! $request) {
    throw new RuntimeException("no hay solicitud {$params['ureq']} en la base local");
}
$user = $request->user;
$resolver = app(MonthlyIncomeResolver::class);
$summary = $user?->userSummary;

// Lo que trae cada central formal, con la clave de monto que lee el resolvedor.
$centrals = [];
foreach (IncomeFieldsConstants::FORMAL_INCOME_SOURCES as $column => $amountKey) {
    $payload = $summary?->{$column};
    $centrals[$column] = $payload === null ? 'sin dato' : ($payload[$amountKey] ?? 'sin monto');
}

[$verifiedSource, $verified] = $resolver->verifiedIncome($user, ['agildata', 'mareigua']);

return [
    'ureq' => $request->id,
    'user_id' => $user?->id,
    'breakdown' => $resolver->breakdown($user),
    'resolve' => $resolver->resolve($user),
    'centrals' => $centrals,
    'finandina_verified' => ['source' => $verifiedSource, 'amount' => $verified],
];
