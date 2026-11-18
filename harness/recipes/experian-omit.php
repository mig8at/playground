<?php

/**
 * ¿Esta sucursal se puede saltar una consulta de Experian, según el código?
 *
 * Es `CheckIfAbleToOmitService` (el `GET /api/v2/risk/check-if-able-to-omit/{central}/{sucursal}` de RiskV2): mira si
 * el comercio de la sucursal está en el setting `allowed_to_omit_experian_allieds` para esa variación de Experian.
 * RKV26000 = puede omitirla; RKV26001 = no; RKV26003 = la configuración está mal. Sin `--central`, contesta para todas
 * las variaciones. `bin/pg experian check` lo deduce leyendo la base: si esta receta y ése no dicen lo mismo, hay un bug.
 *
 * Sólo lee.
 *
 * @repo legacy-backend
 * @param hash el hash público de la sucursal
 * @param central? la variación de Experian (p. ej. experian-acierta); sin ella, todas
 */

use Modules\CommonsV1\App\Utils\StringUtils;
use Modules\RiskV2\App\Commands\CheckIfAbleToOmitCommand;
use Modules\RiskV2\App\Constants\RiskCentral;
use Modules\RiskV2\App\Services\CheckIfAbleToOmitService;

$service = app(CheckIfAbleToOmitService::class);
$centrals = isset($params['central']) ? [$params['central']] : RiskCentral::experianSlugs();
$meaning = ['RKV26000' => 'puede omitirla', 'RKV26001' => 'no puede omitirla', 'RKV26003' => 'la configuración está mal'];

$out = [];
foreach ($centrals as $central) {
    $command = CheckIfAbleToOmitCommand::build($central, (string) $params['hash'], StringUtils::kebabToCamel($central));
    $body = $service->checkIfAbleToOmitOrchestrator($command)->getData(true);
    $code = $body['code'] ?? null;
    $out[$central] = [$code, $meaning[$code] ?? ($body['message'] ?? 'sin código')];
}

return ['hash' => $params['hash'], 'centrals' => $out];
