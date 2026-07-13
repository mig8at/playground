<?php
/*
* Plugin Name: Creditop
* Plugin URI: https://creditop.com
* Description: El plugin Creditop permite añadir <strong>Creditop</strong> como método de pago en tu tienda online. Esto proporciona a tus clientes diferentes opciones de financiación para completar sus compras.
* Version: 1.0.20
* Author: Creditop
* License: GPL v2 or later
* License URI: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
*/
if ( ! defined( 'ABSPATH' ) ) {
    exit; // Exit if accessed directly
}
add_action('plugins_loaded', 'creditop_init', 0);
function creditop_init(){
    if (!class_exists('WC_Payment_Gateway'))
        return; 

    include(plugin_dir_path(__FILE__) . 'class-creditop-gateway.php');
}


add_filter('woocommerce_payment_gateways', 'creditop_add_gateway');

function creditop_add_gateway($gateways) {
  $gateways[] = 'creditop_gateway';
  return $gateways;
}


function creditop_checkout_blocks_compatibility() {
    // Check if the required class exists
    if (class_exists('\Automattic\WooCommerce\Utilities\FeaturesUtil')) {
        // Declare compatibility for 'cart_checkout_blocks'
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('cart_checkout_blocks', __FILE__, true);
    }
}
// Hook the custom function to the 'before_woocommerce_init' action
add_action('before_woocommerce_init', 'creditop_checkout_blocks_compatibility');

// Hook the custom function to the 'woocommerce_blocks_loaded' action
add_action( 'woocommerce_blocks_loaded', 'creditop_register_order_approval_payment_method_type' );


function creditop_register_order_approval_payment_method_type() {
    // Check if the required class exists
    if ( ! class_exists( 'Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType' ) ) {
        return;
    }

    // Include the custom Blocks Checkout class
    require_once plugin_dir_path(__FILE__) . 'class-creditop-block.php';

    // Hook the registration function to the 'woocommerce_blocks_payment_method_type_registration' action
    add_action(
        'woocommerce_blocks_payment_method_type_registration',
        function( Automattic\WooCommerce\Blocks\Payments\PaymentMethodRegistry $payment_method_registry ) {
            // Register an instance of Creditop_Gateway_Blocks
            $payment_method_registry->register( new Creditop_Gateway_Blocks );
        }
    );
}
?>