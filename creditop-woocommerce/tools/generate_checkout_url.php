<?php
/**
 * generate_checkout_url.php — arma la URL base64 del checkout FUERA de WordPress.
 *
 * QUÉ ES: un clon manual de `class-creditop-gateway.php:470-512` (el plugin real), con las clases de
 * WooCommerce falsificadas arriba (`WC_DateTime`, `WC_Order_Item_Shipping`) para poder generar la URL
 * sin levantar una tienda. Estaba suelto en `~/Desktop/CREDITOP/github/`, sin control de versiones;
 * se movió acá el 2026-07-19 para que quede al lado del plugin del que salió.
 *
 * ESTADO: **referencia, no herramienta.** Para simular la entrada por ecommerce usá el harness —
 * `frontend-e2e/pkg/checkout-b64.ts` (o el selector de Canal del panel), que además arma la URL con el
 * usuario sintético que definís y sigue el redirect. Lo que este script sabía ya está absorbido ahí:
 * la forma fiel de la orden (ojo: `total` va como STRING) y el mapa de serialización por campo:
 *
 *     o, u    → base64(serialize(...))              p      → base64(json_encode(...))
 *     config  → base64(serialize(json_encode(...))) t, ps  → base64(string crudo)
 *
 * Se conserva porque es la única muestra de una orden WooCommerce COMPLETA que tenemos escrita.
 */
if (!class_exists('WC_DateTime')) {
    class WC_DateTime {
        protected $utc_offset = 0;
        protected $date;
        protected $timezone_type = 1;
        protected $timezone = '+00:00';
        public function __construct($date_string = null) {
            $this->date = $date_string ?? date('Y-m-d H:i:s.000000');
        }
    }
}

if (!class_exists('WC_Order_Item_Shipping')) {
    class WC_Order_Item_Shipping {
        protected $id = 1896;
    }
}

function generate_creditop_url($orderKey, $userData, $total = 100000, $orderId = 365, $partnerHash = '17f7b360') {

    // Configuración del entorno
    $baseUrl = 'http://localhost:5174';
    $tokenRaw = '3230393766393838643938323032352d30392d3234'; 
    
    $returnUrlRaw = 'https://tienda-prueba.com/checkout/order-received/';
    $processUrlRaw = 'https://tienda-prueba.com/wp-json/wc/v3/orders/';

    $dateObj = new WC_DateTime();

    // Valores por defecto si no se envían documentos
    $docType = $userData['document_type'] ?? 'CC';
    $docNum  = $userData['document_number'] ?? '';

    // Construcción del objeto de orden
    $orderData = [
        'id' => $orderId,
        'parent_id' => 0,
        'status' => 'pending',
        'currency' => 'COP',
        'version' => '9.4.4',
        'prices_include_tax' => false,
        'date_created' => $dateObj,
        'date_modified' => $dateObj,
        'discount_total' => '0',
        'discount_tax' => '0',
        'shipping_total' => '0',
        'shipping_tax' => '0',
        'cart_tax' => '0',
        'total' => (string)$total,
        'total_tax' => '0',
        'customer_id' => 0,
        'order_key' => $orderKey,
        'billing' => [
            'first_name' => $userData['first_name'],
            'last_name'  => $userData['last_name'],
            'company'    => 'Empresa Test',
            'address_1'  => 'Calle Falsa 123',
            'address_2'  => 'Apto 101',
            'city'       => 'bogota',
            'state'      => 'CO-CUN',
            'postcode'   => '1110111',
            'country'    => 'CO',
            'email'      => $userData['email'],
            'phone'      => $userData['phone'],
            // AGREGADOS: Tipo y número de documento en billing
            'document_type'   => $docType,
            'document_number' => $docNum
        ],
        'shipping' => [
            'first_name' => $userData['first_name'],
            'last_name'  => $userData['last_name'],
            'company'    => '',
            'address_1'  => 'Calle Falsa 123',
            'city'       => 'bogota',
            'country'    => 'CO',
            'phone'      => '',
        ],
        'payment_method' => 'creditop_gateway',
        'payment_method_title' => 'Paga a cuotas con Creditop',
        'transaction_id' => '',
        'customer_ip_address' => '127.0.0.1',
        'customer_user_agent' => 'Mozilla/5.0 (Simulation)',
        'created_via' => 'checkout',
        'customer_note' => '',
        'date_completed' => null,
        'date_paid' => null,
        'cart_hash' => md5(uniqid()),
        'order_stock_reduced' => false,
        'download_permissions_granted' => false,
        'new_order_email_sent' => false,
        'recorded_sales' => false,
        'recorded_coupon_usage_counts' => false,
        'number' => (string)$orderId,
        'tax_lines' => [],
        'shipping_lines' => [ 1896 => new WC_Order_Item_Shipping() ],
        'fee_lines' => [],
        'coupon_lines' => [],
    ];

    $products = [[
        'product_id' => 101,
        'name' => 'Producto de Prueba',
        'sku' => 'SKU-001',
        'price' => (string)($total)
    ]];

    $configArray = [
        'first_name' => '', 'surname' => '', 
        'document_number' => '',
        'address' => '', 'city' => '', 'phone' => ''
    ];

    $params = [
        'o'      => base64_encode(serialize($orderData)),
        'p'      => base64_encode(json_encode($products)),
        'u'      => base64_encode(serialize($returnUrlRaw)),
        'ps'     => base64_encode($processUrlRaw),
        't'      => base64_encode($tokenRaw),
        'config' => base64_encode(serialize(json_encode($configArray)))
    ];

    return "{$baseUrl}/ecommerce/{$partnerHash}/checkout?" . http_build_query($params);
}


$url2 = generate_creditop_url(
    'wc_order_MIG456', 
    [
        'first_name' => '---',
        'last_name'  => '---',
        'email'      => '---',
        'phone'      => '---',
        'document_type'   => 'CC',
        'document_number' => '----'
    ],
    600000, 
    5002
);
echo $url2 . "\n\n";

// php generate_checkout_url.php
