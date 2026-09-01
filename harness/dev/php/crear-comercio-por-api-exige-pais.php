<?php

/**
 * ¿El `POST` de comercios de la API exige país, y lo guarda?
 *
 * Es el segundo creador de comercios —el otro es el admin de la aplicación, que ya lo exige—, y es al
 * que apunta la migración. Sin la regla, un comercio creado por acá cae al `DEFAULT` de la columna,
 * que es Afganistán: no queda «sin país», queda DICIENDO que es afgano.
 *
 * Se ejercita la validación y el guardado por sus tres puertas:
 *
 *   sin país            -> 422, y el mensaje nombra el campo
 *   país que no opera   -> 422 (la regla mira `countries.is_operating`, no una lista escrita a mano)
 *   país válido         -> se crea, y la fila trae ESE país (no el default)
 *
 * ⚠ Se invoca el request y el servicio directamente, sin HTTP: la ruta va detrás de `auth.cognito` y
 * lo que se está probando es la regla y el guardado, no el candado.
 *
 * Escribe en la base LOCAL y borra lo que crea. No sirve contra un ambiente compartido.
 */

use App\Http\Requests\Admin\Allied\StoreRequest;
use App\Models\Allied;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Modules\Partner\App\Services\AlliedManagementService;

const AFGANISTAN = 1;

$fallas = 0;
$creados = [];

$comprobar = function (string $caso, $esperado, $obtenido) use (&$fallas) {
    $ok = (string) $esperado === (string) $obtenido;
    $fallas += $ok ? 0 : 1;
    printf("  %s  %-44s esperado %-12s obtenido %s%s",
        $ok ? '✓' : '✗', $caso, (string) $esperado, (string) $obtenido, PHP_EOL);
};

/** Corre SÓLO las reglas del request, sin levantar HTTP. */
$validar = function (array $payload) {
    $reglas = (new StoreRequest())->rules();
    $v = Validator::make($payload, $reglas);
    return $v->fails() ? $v->errors()->keys() : [];
};

$base = [
    'name' => 'Comercio de prueba',
    'description' => 'creado por la prueba del harness',
    'allied_type_id' => 1,
    'allied_industry_id' => 1,
    'price' => 0,
    'image' => 'x',
];

echo PHP_EOL . "  LA REGLA · ¿qué rechaza el request?" . PHP_EOL . PHP_EOL;

$comprobar('sin país → rechaza y nombra el campo', 'country_id',
    implode(',', $validar($base)));

/** Un país que existe pero NO opera: la regla tiene que mirar `is_operating`, no sólo la existencia. */
$noOpera = DB::table('countries')->where('is_operating', false)->orWhereNull('is_operating')->value('id');
$comprobar("país que no opera (id {$noOpera}) → rechaza", 'country_id',
    implode(',', $validar($base + ['country_id' => $noOpera])));

$comprobar('país inexistente (id 99999) → rechaza', 'country_id',
    implode(',', $validar($base + ['country_id' => 99999])));

foreach (DB::table('countries')->where('is_operating', true)->limit(3)->get(['id', 'name']) as $p) {
    $comprobar("{$p->name} (opera) → acepta", '', implode(',', $validar($base + ['country_id' => $p->id])));
}

echo PHP_EOL . "  EL GUARDADO · ¿la fila nace con ese país o con el default?" . PHP_EOL . PHP_EOL;

// El disco falso evita depender de MinIO: lo que se está probando es qué se guarda en la FILA, no la
// subida del logo. Sin esto el servicio corta antes de llegar al insert y el fallo no dice nada útil.
Storage::fake('s3');

/** Un logo de verdad: el servicio hace `putFile`, así que un string no sirve. */
$logo = function () {
    $ruta = tempnam(sys_get_temp_dir(), 'logo') . '.png';
    file_put_contents($ruta, base64_decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    ));
    return new UploadedFile($ruta, 'logo.png', 'image/png', null, true);
};

$servicio = app(AlliedManagementService::class);

foreach (DB::table('countries')->whereIn('id', [47, 60, 167])->get(['id', 'name']) as $p) {
    $r = $servicio->storeAllied(array_merge($base, [
        'name' => 'Prueba harness ' . $p->id . '-' . random_int(1000, 9999),
        'country_id' => $p->id,
        'image' => $logo(),
    ]));

    if (! ($r['success'] ?? false)) {
        $comprobar("{$p->name}: se crea", 'creado', 'ERROR: ' . ($r['error'] ?? '?'));
        continue;
    }

    $creados[] = $r['allied']->id;
    $enLaBase = (int) Allied::whereKey($r['allied']->id)->value('country_id');
    $comprobar("{$p->name}: la fila trae su país", (int) $p->id, $enLaBase);
}

echo PHP_EOL;
echo $fallas === 0
    ? "  ✓ La API exige país, valida contra los que operan, y lo guarda." . PHP_EOL
    : "  ✗ {$fallas} comprobación(es) fallaron." . PHP_EOL;

$borrados = Allied::whereIn('id', $creados)->delete();
printf("%s  (limpieza: %d comercio(s) de prueba borrado(s))%s", PHP_EOL, $borrados, PHP_EOL);
