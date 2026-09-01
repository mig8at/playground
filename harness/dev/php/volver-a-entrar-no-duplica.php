<?php

/**
 * El caso de José: el cliente llega a `/lenders`, se sale, y vuelve a entrar con el MISMO número.
 * ¿Retoma su solicitud o le nace un usuario nuevo?
 *
 * Se ejercita `POST register` —el mismo endpoint que llama el wizard— dos veces con el mismo teléfono,
 * y se cuenta qué quedó en la base. Va por HTTP y no por el servicio a propósito: la pregunta es sobre
 * el recorrido, no sobre una función.
 *
 * Se prueban las DOS formas en que el mismo número puede llegar, que es de donde salían los duplicados:
 *
 *   pelado la primera vez, pelado la segunda        -> el caso simple
 *   pelado la primera vez, con `+57` la segunda     -> el que rompía (F-175)
 *
 * ⚠ Y una tercera que NO se arregla y conviene tener presente: el alta por asesor le pega
 * `-comadv-<timestamp>` al teléfono para que varias solicitudes del mismo asesor convivan bajo el
 * índice único. Ese valor nunca coincide con el número pelado, y es a propósito.
 *
 * Escribe en la base LOCAL y borra lo que crea. No sirve contra un ambiente compartido.
 */

use App\Models\User;
use App\Models\UserRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

$base = rtrim(config('app.url') ?: 'http://localhost', '/');

/** Una sucursal colombiana viva. */
$sucursal = DB::table('allied_branches AS b')
    ->join('allieds AS a', 'a.id', '=', 'b.allied_id')
    ->where('a.country_id', 47)->where('b.status', 1)
    ->value('b.hash');

$fallas = 0;

$registrar = function (string $telefono, string $hash) use ($base) {
    // La ruta lleva el prefijo `phone/`: `api/onboarding` lo pone el provider del módulo y `phone`
    // el grupo del archivo de rutas. Sin él la respuesta es 404, que se lee como «el endpoint falló»
    // cuando lo que falló es la URL.
    $r = Http::acceptJson()->post("{$base}/api/onboarding/phone/register", [
        'phone_number' => $telefono,
        'otp_length' => 4,
        'terms' => true,
        'policies' => true,
        'partner_branch_hash' => $hash,
    ]);
    return ['http' => $r->status(), 'body' => $r->json()];
};

$escenario = function (string $etiqueta, callable $segundaForma) use ($registrar, $sucursal, &$fallas) {
    $telefono = '3' . random_int(100000000, 999999999);

    $a = $registrar($telefono, $sucursal);
    $b = $registrar($segundaForma($telefono), $sucursal);

    // Todo lo que exista para ese número, en cualquiera de sus formas.
    $usuarios = User::where('cell_phone', 'like', '%' . $telefono . '%')->pluck('id');
    $solicitudes = UserRequest::whereIn('user_id', $usuarios)->count();

    $ok = $usuarios->count() === 1;
    $fallas += $ok ? 0 : 1;

    printf("  %s  %-46s usuarios: %d · solicitudes: %d   (HTTP %d, %d)%s",
        $ok ? '✓' : '✗', $etiqueta, $usuarios->count(), $solicitudes, $a['http'], $b['http'], PHP_EOL);

    User::whereIn('id', $usuarios)->delete();
    return $usuarios;
};

echo PHP_EOL . "  VOLVER A ENTRAR CON EL MISMO NÚMERO · ¿retoma o duplica?" . PHP_EOL . PHP_EOL;

$escenario('vuelve escribiendo igual',            fn ($t) => $t);
$escenario('vuelve y el front le pega el "+57"',  fn ($t) => '+57' . $t);
$escenario('vuelve y llega con "57" pegado',      fn ($t) => '57' . $t);

echo PHP_EOL . "  ¿Y RETOMA LA SOLICITUD? (lo que José describe: que salte a /lenders)" . PHP_EOL . PHP_EOL;

/**
 * No alcanza con no duplicar el usuario: el cliente que vuelve espera encontrar SU solicitud. Se hace
 * el recorrido entero dos veces —registro + validación del OTP, que es la que crea la solicitud— y se
 * compara el `user_request_id` que devuelve cada vuelta.
 *
 * ⚠ El uReq viaja en tres lugares distintos de la respuesta según cómo terminó la validación. Con un
 * usuario temporal llega como ERROR `ONB002 "temporal user found"`, dentro de `errors.payload`.
 */
$recorrido = function (string $telefono, string $hash) use ($base, $registrar) {
    $registrar($telefono, $hash);
    $r = Http::acceptJson()->post("{$base}/api/onboarding/loan-application/otp-validate/{$hash}", [
        'cell_phone' => $telefono,
        'otp_code' => substr($telefono, -4),
        'original_amount' => 2000000,
        'amount' => 2000000,
    ])->json();

    return $r['errors']['payload']['user_request_id']
        ?? $r['data']['payload']['user_request_id']
        ?? $r['payload']['user_request_id']
        ?? null;
};

$telefono = '3' . random_int(100000000, 999999999);
$primera = $recorrido($telefono, $sucursal);
$segunda = $recorrido($telefono, $sucursal);

$usuarios = User::where('cell_phone', 'like', '%' . $telefono . '%')->pluck('id');
$solicitudes = UserRequest::whereIn('user_id', $usuarios)->pluck('id');

$mismaSolicitud = $primera !== null && $primera === $segunda;
$fallas += $mismaSolicitud ? 0 : 1;

printf("  %s  %-46s solicitud 1ª: %s · 2ª: %s%s",
    $mismaSolicitud ? '✓' : '✗', 'vuelve y retoma la MISMA solicitud',
    $primera ?? '—', $segunda ?? '—', PHP_EOL);
printf("     └ en la base quedaron %d usuario(s) y %d solicitud(es): %s%s",
    $usuarios->count(), $solicitudes->count(), $solicitudes->implode(', '), PHP_EOL);

UserRequest::whereIn('id', $solicitudes)->delete();
User::whereIn('id', $usuarios)->delete();

echo PHP_EOL;
echo $fallas === 0
    ? "  ✓ Volver a entrar RETOMA: mismo usuario y misma solicitud." . PHP_EOL
    : "  ✗ {$fallas} escenario(s) no retomaron." . PHP_EOL;
