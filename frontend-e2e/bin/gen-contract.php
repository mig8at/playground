<?php
// cfe contract generator: builds the base64 ecommerce contract for a partner hash, with REAL random
// billing (so the prefill shows real data and repeated runs don't hit "documento/teléfono duplicado").
// Usage: php gen-contract.php <partner_hash>   → prints the wizard checkout URL.
ob_start();
require __DIR__ . '/../../../github/generate_checkout_url.php';
ob_end_clean(); // discard the file's own default print

$hash = $argv[1] ?? (getenv('CFE_PARTNER_HASH') ?: '17f7b360');
$rand = substr((string) mt_rand(100000000, 2899999999), 0, 10);
$sfx  = substr(md5(uniqid('', true)), 0, 6);

echo generate_creditop_url(
    'wc_cfe_' . $sfx,
    [
        'first_name'      => 'MIGUEL',
        'last_name'       => 'OCHOA',
        'email'           => "cfe+{$sfx}@creditop.com",
        'phone'           => '30' . mt_rand(10000000, 99999999),
        'document_type'   => 'CC',
        'document_number' => $rand,
    ],
    600000,
    mt_rand(5000, 9999),
    $hash
) . "\n";
