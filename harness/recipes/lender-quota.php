<?php

/**
 * ¿Cuánto cupo le queda a una entidad CreditopX este mes, por perfil, y está en alerta?
 *
 * Es `LenderQuotaService::forLender`, la página de cupos del backoffice: por cada perfil, el cupo del mes, lo usado,
 * lo que queda, si está «en alerta» (lo que queda no alcanza para el monto mínimo de un crédito) y desde cuándo
 * rechaza. Sólo aplica a las entidades CreditopX de consumo con política genérica; con otra, lo dice.
 *
 * Sólo lee.
 *
 * @repo legacy-backend
 * @param lender el id de la entidad (lenders.id)
 */

use Modules\Backoffice\App\Exceptions\LenderQuotaNotApplicableException;
use Modules\Backoffice\App\Services\LenderQuotaService;

try {
    $page = app(LenderQuotaService::class)->forLender((int) $params['lender']);
} catch (LenderQuotaNotApplicableException $e) {
    return ['lender' => (int) $params['lender'], 'applies' => false, 'why' => $e->getMessage() ?: 'no es una entidad CreditopX de consumo con política genérica'];
}

return $page ?? ['lender' => (int) $params['lender'], 'applies' => false, 'why' => 'no hay entidad con ese id, o no es CreditopX de consumo'];
