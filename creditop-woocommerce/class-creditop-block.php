<?php
/*
 ******************************************************
 *  Creditop
 *
 *  Copyright (c) 2024 Creditop
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License version 2 as published by
 *  the Free Software Foundation.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see https://www.gnu.org/licenses/old-licenses/gpl-2.0.html.
 ******************************************************
 */
use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;
if ( ! defined( 'ABSPATH' ) ) {
    exit; // Exit if accessed directly
}

final class Creditop_Gateway_Blocks extends AbstractPaymentMethodType {

    private $gateway;
    protected $name = 'creditop_gateway';

    public function initialize() {
        $this->settings = get_option( 'woocommerce_creditop_gateway_settings', [] );
        $this->gateway = new Creditop_Gateway();
    }

    public function is_active() {
        return $this->gateway->is_available();
    }

    public function get_payment_method_script_handles() {

        wp_register_script(
            'creditop_gateway-blocks-integration',
            plugin_dir_url(__FILE__) . 'checkout.js',
            [
                'wc-blocks-registry',
                'wc-settings',
                'wp-element',
                'wp-html-entities',
                'wp-i18n',
            ],
            '1.0.0',
            true
        );
        if( function_exists( 'wp_set_script_translations' ) ) {            
            wp_set_script_translations( 'creditop_gateway-blocks-integration');
            
        }
        return [ 'creditop_gateway-blocks-integration' ];
    }

    public function get_payment_method_data() {
        return [
            'title' => 'Creditop',
            'description' => '¡Revisa acá las diferentes opciones de financiamiento!',
            'icon'=>$this->gateway->icon
        ];
    }

}
?>