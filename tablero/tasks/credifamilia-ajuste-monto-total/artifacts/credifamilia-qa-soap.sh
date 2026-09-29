#!/usr/bin/env bash
# Manda UN transaccionConsumo firmado al SOAP de PRUEBAS de Credifamilia, con el SoapClient real de
# legacy-backend, corriendo dentro del contenedor laravel.test. No lleva claves: las lee de KEYS.
#
#   KEYS=/ruta/a/temp/keys NIT=830108482 MONTO_TOTAL=2428673.60 FIANZA=Anticipada \
#     artifacts/credifamilia-qa-soap.sh
#
# 200 = "Se guardó la transacción…" (queda una transacción de prueba en el QA de Credifamilia).
# 500 "nit no existe" = el NIT de convenio no está dado de alta allá: se valida ANTES de guardar.
# Requiere: docker con legacy-backend-laravel.test arriba y el checkout de legacy-backend con SoapClient.
set -euo pipefail
KEYS="${KEYS:?falta KEYS=<carpeta con clientQA2026.cert y clientQA2026.key>}"
NIT="${NIT:?falta NIT=<allieds.nit de un convenio que Credifamilia conozca>}"
MONTO_TOTAL="${MONTO_TOTAL:-2428673.60}"
MONTO="${MONTO:-2000000}"
FIANZA="${FIANZA:-Anticipada}"
CODE="${CODE:-99$(date +%y%m%d%H%M%S)}"
WSDL="${WSDL:-https://pruebas.credifamilia.com.mx/proptech-ws-sec/services/consumoEndPoint?wsdl}"
C="$(docker ps --format '{{.Names}}' | grep legacy-backend-laravel | head -1)"
[ -n "$C" ] || { echo "✗ no hay contenedor legacy-backend-laravel"; exit 1; }
TMP="$(mktemp)"; trap 'docker exec "$C" sh -c "rm -f /tmp/kt-* /tmp/cf-send.php" 2>/dev/null; rm -f "$TMP"' EXIT
docker cp "$KEYS/clientQA2026.cert" "$C:/tmp/kt-cert"; docker cp "$KEYS/clientQA2026.key" "$C:/tmp/kt-key"
cat > "$TMP" <<PHP
<?php
\$c = new \App\Actions\Lenders\CredifamiliaConsumo\SoapClient('$WSDL', '/tmp/kt-cert', '/tmp/kt-key', 60, null);
\$p = [
 'tipoDocumento'=>1,'numeroDocumento'=>'1052365999','nombre'=>'Juan','apellido'=>'Perez','correo'=>'juan@example.com','celular'=>'3000000000',
 'direccionResidencia'=>'Calle 74 # 02 - 10','codigoCiudadResidencia'=>'11001','codigoPaisResidencia'=>'170','codigoCiudadNacimiento'=>'11001','codigoPaisNacimiento'=>'170','codigoCiudadExpedicion'=>'11001','codigoPaisExpedicion'=>'170',
 'fechaExpedicion'=>'01/01/2010','fechaNacimiento'=>'15/06/1990','genero'=>1,
 'activos'=>10000000,'pasivos'=>2000000,'ingresosMensuales'=>3000000,'egresosMensuales'=>1500000,'ingresosValidados'=>0,'patrimonio'=>8000000,
 'actividadEconomica'=>'1052','tipoOcupacion'=>'1','profesion'=>'100','nombreEmpresa'=>'Empresa de Prueba','fechaIngreso'=>'01/01/2020','tipoContrato'=>'1','cargoActual'=>'Analista','direccionEmpresa'=>'Calle 100 # 15 - 20','telefonoEmpresa'=>'6011234567','ciudadEmpresa'=>'11001',
 'obligacionesFiscalesPaisDiferente'=>'false','manejoRPPoderPublico'=>'false',
 'tipoProducto'=>'Libranza','detalleProducto'=>'Libranza privada','origen'=>'Linxe','montoSolicitado'=>$MONTO,'montoTotalCredito'=>'$MONTO_TOTAL','plazo'=>12,'periodicidadPago'=>'Mensual','destinoPrestamo'=>'Salud','nitConvenio'=>'$NIT','cuotaProtegida'=>'false','tasaMensual'=>1.80,'tasaEfectivaAnual'=>23.87,'codigoPagare'=>'1234567890','verticalComercio'=>'Salud','DiaPago'=>16,'codigoSolicitud'=>'$CODE','tipoFianza'=>'$FIANZA','score'=>500,
 'tipoCuenta'=>'1','numeroCuenta'=>'12345678901','entidadBancaria'=>'7'];
try { \$r = \$c->call('transaccionConsumo', \$p);
 echo "codigoSolicitud=$CODE\nstatusCode=".var_export(\$r['statusCode'],true)."\nmsg=".mb_substr((string)\$r['message'],0,500)."\n";
 preg_match('#<[^>]*montoTotalCredito[^>]*>[^<]*<#', (string)\$c->lastTrace()['request'], \$m); echo "enviado: ".(\$m[0] ?? '(no encontrado)')."\n"; }
catch (\Throwable \$e) { echo get_class(\$e).": ".mb_substr(\$e->getMessage(),0,400)."\n"; }
PHP
docker cp "$TMP" "$C:/tmp/cf-send.php"
docker exec "$C" php -r 'require "/var/www/html/vendor/autoload.php"; $app=require "/var/www/html/bootstrap/app.php"; $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap(); include "/tmp/cf-send.php";' 2>&1 | tail -6
