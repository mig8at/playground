<?php

/**
 * ¿Un DNI peruano puede registrarse si el mismo número ya existe como cédula colombiana?
 *
 * `users.document_number` tiene un índice ÚNICO **sobre la columna sola** —`idx_users_document_number_unique`,
 * sin `document_type` ni país—. El DNI peruano son 8 dígitos y la cédula colombiana también los tiene
 * en ese rango, así que los dos espacios de numeración se pisan. Medido en producción el 2026-09-01:
 * **119.188 documentos de 8 dígitos ya ocupados**.
 *
 * Se ejercita el recorrido real contra un comercio PERUANO, con un número que ya existe como `CC`, y
 * se mira dónde corta y con qué mensaje. Hay TRES guardas y cada una se comporta distinto:
 *
 *   1. `register`       -> busca por número SIN mirar el tipo   (falso positivo)
 *   2. `personal-info`  -> busca por número Y tipo              (correcto)
 *   3. el índice de la BD -> número solo                        (el muro final)
 *
 * Escribe en la base LOCAL y borra lo que crea. No sirve contra un ambiente compartido.
 */

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

$base = rtrim(config('app.url') ?: 'http://localhost', '/');

/** El comercio peruano y uno colombiano, para contrastar. */
$sucursales = DB::table('allied_branches AS b')
    ->join('allieds AS a', 'a.id', '=', 'b.allied_id')
    ->selectRaw('MIN(b.hash) AS hash, a.country_id')
    ->whereIn('a.country_id', [47, 167])->where('b.status', 1)
    ->groupBy('a.country_id')->pluck('hash', 'country_id');

/** Una cédula colombiana de 8 dígitos que YA existe: el número que el peruano no va a poder usar. */
$ocupado = DB::table('users')->where('document_type', 'CC')
    ->whereRaw('CHAR_LENGTH(document_number) = 8')
    ->whereRaw("document_number REGEXP '^[1-47]'")
    ->value('document_number');

$duenio = User::where('document_number', $ocupado)->first();

echo PHP_EOL;
printf("  El número en disputa: %s — hoy es la cédula de %s (id %d)%s%s",
    $ocupado, substr($duenio->full_name ?? '?', 0, 24), $duenio->id ?? 0, PHP_EOL, PHP_EOL);

$creados = [];

/** GUARDA 1 · el registro. Manda el documento junto con el celular. */
$telefono = ['47' => '3' . random_int(100000000, 999999999), '167' => '9' . random_int(10000000, 99999999)];

foreach ([167 => 'comercio PERUANO (el DNI es legítimo allá)', 47 => 'comercio colombiano (control)'] as $pais => $etiqueta) {
    $hash = $sucursales[$pais] ?? null;
    if (! $hash) { printf("  —  %s: sin comercio en local%s", $etiqueta, PHP_EOL); continue; }

    $r = Http::acceptJson()->post("{$base}/api/onboarding/phone/register", [
        'phone_number' => $telefono[(string) $pais],
        'document_number' => $ocupado,
        'otp_length' => 4, 'terms' => true, 'policies' => true,
        'partner_branch_hash' => $hash,
    ]);

    $j = $r->json();
    $codigo = $j['errors']['error_code'] ?? ($j['success'] ?? null ? 'OK' : '?');
    $mensaje = $j['message'] ?? '';

    printf("  GUARDA 1 · register   %-42s HTTP %d · %s%s", $etiqueta, $r->status(),
        substr($mensaje ?: $codigo, 0, 60), PHP_EOL);

    $nuevo = User::where('cell_phone', $telefono[(string) $pais])->first();
    if ($nuevo) $creados[] = $nuevo->id;
}

/** GUARDA 3 · el índice. Se intenta la escritura directa, que es lo que hace el alta al final. */
echo PHP_EOL;
try {
    $u = User::create([
        'first_name' => 'PRUEBA', 'surname' => 'PERU', 'full_name' => 'PRUEBA PERU',
        'password' => bcrypt('x'), 'document_type' => 'DNI', 'document_number' => $ocupado,
        'cell_phone' => '9' . random_int(10000000, 99999999),
    ]);
    $creados[] = $u->id;
    printf("  GUARDA 3 · el índice  %-42s ✓ dejó insertar el DNI%s", '', PHP_EOL);
} catch (\Throwable $e) {
    $duplicado = str_contains($e->getMessage(), '1062') || str_contains($e->getMessage(), 'Duplicate');
    printf("  GUARDA 3 · el índice  %-42s %s%s", 'DNI con el mismo número, otro tipo',
        $duplicado ? '✗ RECHAZADO por el unique de la columna' : '✗ ' . substr($e->getMessage(), 0, 50), PHP_EOL);
}

// ⚠ Se listan TODOS los únicos que tocan la columna, no uno por nombre: el nombre cambia con el
// arreglo (`idx_users_document_number_unique` → `idx_users_document_type_number_unique`) y buscarlo
// fijo hacía que el bloque saliera vacío justo cuando el arreglo funcionaba.
echo PHP_EOL . "  Los índices únicos sobre el documento:" . PHP_EOL;
$ixs = DB::select("
    SELECT INDEX_NAME AS nombre, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND NON_UNIQUE = 0
    GROUP BY INDEX_NAME HAVING columnas LIKE '%document_number%'");
foreach ($ixs as $ix) {
    printf("    %-40s → %s%s", $ix->nombre, $ix->columnas, PHP_EOL);
}

User::whereIn('id', $creados)->delete();
printf("%s  (limpieza: %d usuario(s) de prueba borrado(s))%s", PHP_EOL, count($creados), PHP_EOL);
