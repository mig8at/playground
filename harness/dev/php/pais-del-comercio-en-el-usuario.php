<?php

/**
 * ¿El usuario temporal nace con el país del comercio, o nace afgano?
 *
 * `users.country_id` es `NOT NULL DEFAULT 1` y la fila 1 de `countries` es Afganistán, así que un
 * alta que no escribe la columna produce una afirmación falsa que se lee como verdadera. Esto
 * ejercita los DOS caminos que crean la ficha en blanco, contra los tres países que existen en la
 * base local, y comprueba las tres cosas que importan:
 *
 *   con sucursal    -> la fila nace con el país de ESE comercio
 *   sin sucursal    -> la columna NO se escribe y cae al default de siempre (sin cambio de conducta)
 *   el pago         -> el OTP por correo deja de acuñar a todo el mundo bajo Colombia
 *
 * ⚠ El camino de `RegisterCellPhoneService` se invoca por reflexión: su entrada pública manda un OTP
 * de verdad, y lo que se está probando es qué se guarda, no el envío. El de `UserService` sí entra
 * por la puerta pública (`getOrCreateUser`), que es por donde pasan SmartPay y el OTP del wizard.
 *
 * Escribe en la base LOCAL y borra lo que crea. No sirve contra un ambiente compartido.
 */

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Modules\Onboarding\App\Services\OtpService;
use Modules\Onboarding\App\Services\RegisterCellPhoneService;
use Modules\Onboarding\App\Services\UserService;
use Modules\System\App\Services\PhoneService;

/** La fila 1 de `countries`. No es un país declarado: es el default que nadie escribió. */
const AFGANISTAN = 1;

$creados = [];
$fallas  = 0;

$comprobar = function (string $caso, $esperado, $obtenido) use (&$fallas) {
    $ok = (string) $esperado === (string) $obtenido;
    $fallas += $ok ? 0 : 1;
    printf("  %s  %-44s esperado %-5s obtenido %s%s",
        $ok ? '✓' : '✗', $caso, (string) $esperado, (string) $obtenido, PHP_EOL);
};

/** Una sucursal por país, para no depender de ids quemados. */
$sucursales = DB::table('allied_branches AS b')
    ->join('allieds AS a', 'a.id', '=', 'b.allied_id')
    ->join('countries AS c', 'c.id', '=', 'a.country_id')
    ->selectRaw('MIN(b.hash) AS hash, a.country_id, c.name AS pais, c.iso_code_1 AS iso, c.dial_code')
    ->groupBy('a.country_id', 'c.name', 'c.iso_code_1', 'c.dial_code')
    ->orderBy('a.country_id')
    ->get();

/**
 * Un celular con la forma REAL de cada país: si no, libphonenumber no puede darles la razón.
 *
 * ⚠ En RD no alcanza con «10 dígitos que empiezan en 8»: comparte el +1 con todo el NANP, así que
 * el país sale del ÁREA y sólo 809/829/849 son suyas. Con un `823` inventado, `resolveCountry`
 * devolvía CO — y se leía como que el cambio no funcionaba, cuando el número no existía.
 */
$telefono = fn (?int $countryId = null) => match ($countryId) {
    60      => [809, 829, 849][random_int(0, 2)] . random_int(1000000, 9999999),   // RD: área + 7
    167     => '9' . random_int(10000000, 99999999),                               // Perú: 9, en 9
    default => '3' . random_int(100000000, 999999999),                             // Colombia: 10, en 3
};

echo PHP_EOL . "  CAMINO A · RegisterCellPhoneService (registro de celular)" . PHP_EOL . PHP_EOL;

$registro = app(RegisterCellPhoneService::class);
$crearA = (new ReflectionClass($registro))->getMethod('createTemporalUser');
$crearA->setAccessible(true);

foreach ($sucursales as $s) {
    $u = $crearA->invoke($registro, $telefono((int) $s->country_id), null, null, $s->hash);
    $creados[] = $u->id;
    $comprobar("comercio de {$s->pais}", (int) $s->country_id, (int) $u->fresh()->country_id);
}

foreach (['sin sucursal (cae al default, como hoy)' => null,
          'sucursal inexistente (no inventa país)'  => 'no-existe'] as $caso => $hash) {
    $u = $crearA->invoke($registro, $telefono(), null, null, $hash);
    $creados[] = $u->id;
    $comprobar($caso, AFGANISTAN, (int) $u->fresh()->country_id);
}

echo PHP_EOL . "  CAMINO B · UserService::getOrCreateUser (SmartPay, OTP del wizard)" . PHP_EOL . PHP_EOL;

$servicio = app(UserService::class);

foreach ($sucursales as $s) {
    $u = $servicio->getOrCreateUser($telefono((int) $s->country_id), false, false, '', false, $s->hash);
    $creados[] = $u->id;
    $comprobar("comercio de {$s->pais}", (int) $s->country_id, (int) $u->fresh()->country_id);
}

$u = $servicio->getOrCreateUser($telefono(), false, false);
$creados[] = $u->id;
$comprobar('sin sucursal (cae al default, como hoy)', AFGANISTAN, (int) $u->fresh()->country_id);

echo PHP_EOL . "  EL PAGO · ¿bajo qué país se acuña el OTP por correo?" . PHP_EOL . PHP_EOL;

/**
 * Es lo que el cambio vino a arreglar. El indicativo era el literal '+57' y el teléfono se guarda
 * SIN indicativo, así que el resolvedor no tenía de dónde deducir nada y TODO cliente se acuñaba
 * bajo Colombia. Ahora sale del país que el usuario trae grabado, que es el de su comercio.
 */
$otp = app(OtpService::class);
$dialDelUsuario = (new ReflectionClass($otp))->getMethod('dialCodeDelUsuario');
$dialDelUsuario->setAccessible(true);
$phoneService = app(PhoneService::class);

$bucket = fn (?string $dialCode, string $phone) => $phoneService->resolveCountry(
    '+' . ltrim((string) $dialCode, '+'), $phone
);

foreach ($sucursales as $s) {
    $u = $servicio->getOrCreateUser($telefono((int) $s->country_id), false, false, '', false, $s->hash);
    $creados[] = $u->id;
    $u = $u->fresh();

    $indicativo = $dialDelUsuario->invoke($otp, $u);
    $comprobar("{$s->pais}: indicativo del usuario", $s->dial_code, $indicativo ?? '(ninguno)');
    $comprobar("{$s->pais}: bucket del OTP", $s->iso, $bucket($indicativo, (string) $u->cell_phone));
}

// El usuario histórico: sin país propio y sin solicitudes, cae al indicativo por omisión. Es la
// conducta de HOY y tiene que seguir igual — son 19.618 fichas que nacieron antes de este cambio.
$viejo = $servicio->getOrCreateUser($telefono(), false, false);
$creados[] = $viejo->id;
$comprobar('usuario sin país ni solicitudes (como hoy)', '(ninguno)',
    $dialDelUsuario->invoke($otp, $viejo->fresh()) ?? '(ninguno)');

echo PHP_EOL;
echo $fallas === 0
    ? "  ✓ El usuario nace con el país de su comercio, y el OTP lo usa. Sin comercio, nada cambia." . PHP_EOL
    : "  ✗ {$fallas} comprobación(es) fallaron." . PHP_EOL;

$borrados = User::whereIn('id', $creados)->delete();
printf("%s  (limpieza: %d usuario(s) de prueba borrado(s))%s", PHP_EOL, $borrados, PHP_EOL);
