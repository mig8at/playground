<?php

/**
 * ¿Dos altas del MISMO teléfono, una sin indicativo y otra con `+57`, crean dos usuarios?
 *
 * Es el escenario que produce las cuentas duplicadas: el wizard registra el número pelado y el
 * consumer-hub el mismo número con `+57`, y la búsqueda por igualdad exacta no reconoce al que ya
 * existe. Se ejercita `UserService::getOrCreateUser`, que es donde se decide buscar o crear — el mismo
 * punto por el que pasan el OTP, el backdoor, el móvil y el alta por asesor.
 *
 * Escribe en la base LOCAL y borra lo que crea. No sirve contra un ambiente compartido.
 */

use App\Models\User;
use Modules\Onboarding\App\Services\UserService;

$telefono = '3009' . random_int(100000, 999999);   // uno que no exista
$servicio = app(UserService::class);

echo PHP_EOL . "  teléfono de prueba: {$telefono}" . PHP_EOL . PHP_EOL;

// Alta 1 — como la hace el wizard de originación: el número pelado, sin indicativo.
$primero = $servicio->getOrCreateUser($telefono, false);
printf("  1. alta sin indicativo      -> usuario id=%d  guardado como '%s'%s", $primero->id, $primero->cell_phone, PHP_EOL);

// Alta 2 — como la hace el consumer-hub: el MISMO número, con el indicativo por delante.
$segundo = $servicio->getOrCreateUser($telefono, false, true, '+57');
printf("  2. alta con '+57' delante   -> usuario id=%d  guardado como '%s'%s", $segundo->id, $segundo->cell_phone, PHP_EOL);

// El veredicto.
$creados = User::where('cell_phone', 'like', '%' . $telefono)->count();
$mismo = $primero->id === $segundo->id;

echo PHP_EOL;
printf("  usuarios en la base para ese número: %d%s", $creados, PHP_EOL);
printf("  ¿la segunda alta reusó la primera?:  %s%s", $mismo ? 'SÍ' : 'NO', PHP_EOL);
echo PHP_EOL;
echo $mismo
    ? "  ✓ ARREGLADO: una sola cuenta para la misma persona." . PHP_EOL
    : "  ✗ BUG REPRODUCIDO: la misma persona quedó con DOS cuentas." . PHP_EOL;

// Limpieza: se borra lo creado por esta prueba, sea una cuenta o dos.
$borrados = User::where('cell_phone', 'like', '%' . $telefono)->delete();
printf("%s  (limpieza: %d usuario(s) de prueba borrado(s))%s", PHP_EOL, $borrados, PHP_EOL);
