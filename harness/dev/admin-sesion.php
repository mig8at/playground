<?php

/**
 * Emite una sesión autenticada del admin de `legacy-application` SIN contraseña.
 *
 * Corre dentro de `php artisan tinker` de ese repo, así que tiene la app booteada: usa el mismo
 * `SessionGuard` y el mismo `Encrypter` que usaría un login real. Lo único que se saltea es el
 * formulario — la sesión resultante es indistinguible de una hecha a mano.
 *
 * Por qué existe: para VER el selector de ciudades en la pantalla hacía falta entrar al admin, y entrar
 * exigía una contraseña que (a) es de staging y puede no corresponder al hash del dump local, y (b) no
 * tiene por qué andar dando vueltas en scripts. Autenticar por id resuelve las dos cosas.
 *
 * ⚠ **Sólo local.** Aborta si `APP_ENV` no es `local`: mintar sesiones contra un ambiente compartido es
 * exactamente lo que no se debe poder hacer por accidente.
 *
 * Uso (lo invoca `bin/admin-sesion`; imprime UNA línea JSON con la cookie):
 *   php artisan tinker --execute="\$__uid=1827259; require '/ruta/admin-sesion.php';"
 */

if (app()->environment() !== 'local') {
    fwrite(STDERR, "admin-sesion: APP_ENV es «" . app()->environment() . "», no «local». Abortado.\n");
    exit(1);
}

$uid = isset($__uid) ? (int) $__uid : 0;

// Sin id explícito: el primer usuario con rol Administrador. Es lo que hace falta para el admin, y así
// el script sirve en cualquier dump sin que nadie tenga que averiguar un id.
if ($uid === 0) {
    $uid = (int) DB::table('users')
        ->join('model_has_roles as mr', function ($j) {
            $j->on('mr.model_id', '=', 'users.id')->where('mr.model_type', 'App\\Models\\User');
        })
        ->join('roles as r', 'r.id', '=', 'mr.role_id')
        ->where('r.name', 'Administrador')
        ->orderBy('users.id')
        ->value('users.id');
}

$user = \App\Models\User::find($uid);

if (! $user) {
    fwrite(STDERR, "admin-sesion: no existe un usuario con rol Administrador en esta base.\n");
    exit(1);
}

// El guard `web` escribe en la sesión la clave `login_web_<sha1>` con el id. Se usa el guard de verdad
// en vez de armar la clave a mano: si Laravel cambia el formato, esto sigue andando.
session()->start();
auth()->guard('web')->login($user);
session()->save();

$sessionId = session()->getId();
$nombre = config('session.cookie');

// El valor de la cookie no es el id pelado: `EncryptCookies` lo envuelve con un prefijo atado al nombre
// de la cookie y a la APP_KEY, y lo encripta SIN serializar. Replicarlo con las clases de Laravel evita
// tener que imitar el formato.
$encrypter = app('encrypter');
$valor = $encrypter->encrypt(
    \Illuminate\Cookie\CookieValuePrefix::create($nombre, $encrypter->getKey()) . $sessionId,
    false
);

echo json_encode([
    'cookie' => $nombre,
    'value' => $valor,
    'domain' => config('session.domain') ?: 'localhost',
    'user_id' => $user->id,
    'email' => $user->email,
    'roles' => method_exists($user, 'getRoleNames') ? $user->getRoleNames()->all() : [],
], JSON_UNESCAPED_SLASHES) . "\n";
