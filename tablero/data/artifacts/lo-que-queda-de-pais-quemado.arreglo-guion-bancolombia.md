# El `-` del tipo de documento rompe Bancolombia — qué arreglar, dónde y por qué

> Anexo de la tarea **#68** (`lo-que-queda-de-pais-quemado`), que es donde se decidió poner `'-'`
> (sección «2026-08-27 · la ficha en blanco ya no dice «colombiano»»). Esto **no revierte** esa
> decisión: era correcta. Arregla el caso que la auditoría previa no cubrió.
>
> Todas las rutas y líneas son contra **`origin/main`** de cada repo, verificadas el 2026-09-09.

## En una línea

La ficha temporal nace con `document_type = '-'`, y en el canal de **autogestión** el alta ya conoce el
número de documento real — así que queda una fila incoherente (documento real + tipo «pendiente») que la
compuerta de preaprobación le manda a Bancolombia **antes** de que la persona llene sus datos. El banco
rechaza el parámetro y la solicitud muere.

## La evidencia

**El banco lo dice textual.** Fila `logs.id = 12141701` de producción (uReq 552082, K-TRONIX Fusagasugá):

```
controller  App\Actions\Lenders\BancolombiaConsumerLoan
method      ...::validate
request     {"data":{"customer":{"identification":{"type":"-","number":"1014257745"}},
                     "totalPurchaseAmount":{"purchaseAmount":1000000}}}
response    400 Bad Request
            errors[0] = { "code": "SA400",
                          "detail": "El valor del parámetro type no hace parte de los valores válidos" }
```

**El daño, en `user_requests` (lender 68, desde el 2026-09-03):**

| cohorte | solicitudes | llegaron a estado 11 | % |
|---|---|---|---|
| tipo real | 173 | 81 | **46,8 %** |
| con `-` | 96 | 0 | **0 %** |

Del cohorte con `-`: 68 canceladas (estado 8), 21 trabadas en «Formulario de perfil» (9), 7 llegaron a
facturación (25). Entre el 2026-08-20 y el 2026-09-02 la tasa del lender era **51 %** (393 de 766).

**Eso cierra la causalidad, no es coincidencia de fechas:** el cohorte que sí tiene tipo real sigue
rindiendo igual que antes (46,8 % vs 51 %), así que **todo el bajón lo pone el cohorte del guion**.

**Y el subconjunto exacto que hay que arreglar:**

```sql
SELECT COUNT(*)                                    AS fichas_con_guion,      -- 1.108
       SUM(document_number NOT LIKE 'TEMP-%')      AS con_documento_real,    --   178  ← incoherentes
       SUM(document_number LIKE 'TEMP-%')          AS sin_documento          --   930  ← el `-` está BIEN
FROM users WHERE document_type = '-';
```

**930 de 1.108 están bien.** El `-` es exactamente lo que corresponde: no sabemos nada de esa persona.
Las **178** con documento real son las que rompen, y son las del canal de autogestión.

## Por qué la auditoría previa no lo vio (la lección, que vale más que el parche)

La tarea #68 verificó el cambio antes de mergearlo, y escribió:

> «lo que compara `users.document_type` contra un valor —TusDatos, las reglas de Datacrédito, la
> categoría del lender, los PDF de consentimiento, el PEP del backoffice— corre **después** de los datos
> personales, o sea que ve el tipo real, nunca el relleno»

Dos huecos, los dos razonables y los dos falsos:

1. **Se auditó quién COMPARA el tipo, no quién lo TRANSMITE.** Los sitios que comparan se enumeraron bien
   y ninguno rompe. Pero el tipo también **viaja crudo a la API de una entidad**, y eso no se buscó. Un
   `grep` por `document_type ==` no encuentra `'type' => $user->document_type`.
2. **«Corre después de los datos personales» es cierto en el wizard y falso en autogestión.** En el canal
   de autogestión el alta pide teléfono **y documento** en la primera pantalla, y la compuerta de
   preaprobación corre antes del formulario. Ahí el relleno sí se ve.

Y un tercero: #68 dice «`legacy-application` **no crea la ficha** […] **Un solo lugar que arreglar**».
Es verdad para *crearla* — pero `legacy-application` sí la **consume** en el payload del lender, y es el
gemelo por el que salió la llamada que falló.

## El arreglo, en orden

### Paso 1 · La causa raíz — un solo archivo

**`legacy-backend/Modules/Onboarding/App/Services/RegisterCellPhoneService.php`**

Éste es el único de los dos caminos de alta que recibe un número de documento. El otro
(`Modules/Onboarding/App/Services/UserService.php:184`) **no se toca**: su
`createTemporalUser()` (`:149`) no tiene parámetro de documento y siempre escribe un
`TEMP-…`, así que ahí el `-` es correcto por construcción.

**Línea 417** — `'document_type' => self::DOCUMENT_TYPE_PENDIENTE,`

```php
// antes
'document_type' => self::DOCUMENT_TYPE_PENDIENTE,

// después
'document_type' => $this->documentTypeForNewUser($documentNumber, $partnerBranchHash),
```

**Método nuevo**, al lado de `createTemporalUser()` (que empieza en `:400`):

```php
/**
 * El tipo con el que nace la ficha.
 *
 * `-` significa «todavía no sabemos», y es lo correcto para las 930 fichas que nacen sin documento.
 * Cuando el alta YA trae el número —el canal de autogestión lo pide en su primera pantalla— eso deja
 * de ser cierto: hay un documento real, y el `-` lo describe mal.
 *
 * Y no es cosmético. La compuerta de preaprobación corre ANTES del formulario de datos personales y
 * le manda el tipo a la API de la entidad: Bancolombia lo valida contra su propia lista y responde
 * `SA400`. El `-` no llega a ser un dato sucio, llega a ser una solicitud muerta.
 *
 * El tipo sale del MISMO resolvedor que arma el selector, así que la ficha nace con el tipo que el
 * formulario le habría preseleccionado a esa persona en ese punto de venta —el front elige
 * `opciones[0]` de la misma lista, en `resolveDefaultDocumentType`—. No es un default colombiano
 * quemado: es la configuración del país del comercio.
 *
 * Un punto de venta que no declara ningún tipo vuelve al `-`: es mejor no saber que inventar.
 */
private function documentTypeForNewUser(?string $documentNumber, ?string $partnerBranchHash): string
{
    if ($documentNumber === null) {
        return self::DOCUMENT_TYPE_PENDIENTE;
    }

    return $this->documentTypes->paraSucursal($partnerBranchHash)[0]
        ?? self::DOCUMENT_TYPE_PENDIENTE;
}
```

**Inyección** — el constructor (`:40`–`:54`) ya inyecta seis dependencias explícitas, entre ellas
`MerchantCountryService`, que se resuelve por el mismo hash. Se agrega una séptima igual:

```php
protected \App\Services\DocumentTypesService $documentTypes;   // junto a las otras propiedades (:33-:38)
// … y el parámetro correspondiente en __construct, asignado como los demás
```

**Por qué `paraSucursal` y no `catalogForCountry`:** `paraSucursal` es la cascada completa —lo que
declaran las entidades activas del punto de venta, recortado por el catálogo del país— y es
**literalmente el mismo array que el backend le sirve al front como `allowed_document_types`**. Usar
otra fuente reintroduciría el problema que #68 vino a borrar: dos definiciones de la misma regla.

**Por qué tolera el hash:** la versión de `legacy-backend` acepta `int|string|null` y busca por hash
primero (hay 63 sucursales de producción con hash de puros dígitos). `$partnerBranchHash` entra tal cual.

### Paso 2 · La guarda en el borde — el mismo archivo en los dos gemelos

Que ninguna entidad vuelva a recibir un valor que no es un tipo de documento. Sin esto, el próximo país
o el próximo relleno sale por la misma grieta.

- **`legacy-backend/app/Services/ApiBancolombiaLoanRequestBuilder.php:57`**
- **`legacy-application/app/Services/ApiBancolombiaLoanRequestBuilder.php:62`**

Los dos, dentro de la op `'validate'` del `match ($service)`:

```php
// antes
'identification' => [
    'type'   => $user->document_type,
    'number' => $config['customer_number'] ?? $user->document_number,
],

// después
'identification' => [
    'type'   => $this->documentTypeForLender($user, $request),
    'number' => $config['customer_number'] ?? $user->document_number,
],
```

```php
/**
 * El tipo que se le manda a la entidad. NUNCA el marcador de pendiente.
 *
 * Bancolombia valida el parámetro contra su lista y responde `SA400` ante cualquier cosa que no
 * reconozca. Esta llamada es la compuerta de preaprobación: lo PRIMERO que le habla al banco, antes
 * de que la persona haya elegido su tipo.
 *
 * Se deja FALLAR en vez de mandar el `-` o de inventar un `CC`. Un 400 del banco se traduce en la
 * pantalla como «Bancolombia no te da cupo», que es una respuesta falsa que el cliente se cree; una
 * excepción acá deja el motivo real en el rastro. Es la misma decisión que la guarda del split de
 * desembolso de este archivo (`:37`-`:41`), y el `match` ya cierra así su rama `default` (`:179`).
 */
private function documentTypeForLender(User $user, Request $request): string
{
    $tipo = strtoupper(trim((string) $user->document_type));

    if ($tipo !== '' && $tipo !== TemporalUserConstants::DOCUMENT_TYPE_PENDIENTE) {
        return $tipo;
    }

    throw new \InvalidArgumentException(
        "El usuario {$user->id} no tiene tipo de documento elegido todavía "
        . "(document_type = '{$user->document_type}'), y la entidad lo valida. "
        . "user_request_id: {$request->user_request_id}."
    );
}
```

**Quién la ve fallar:** `legacy-application/app/Services/lenders/PreApprovedLenderService.php:203`
atrapa `\Exception` y notifica por correo, así que la excepción **no tumba el listado** — Bancolombia
simplemente no se ofrece, con el motivo escrito. Eso es lo correcto: mejor no ofrecer una entidad que
ofrecerla y que el banco conteste un 400 que la UI traduce mal.

⚠ **Ojo con `legacy-application`:** su `DocumentTypesService` es una copia **parcial** —sólo
`paraSucursal(?int $branchId)` y `sucursalDeLaSesion()`, y lee `countries.document_types` (la columna
JSON) en vez de la tabla `document_types`—. Para la guarda no hace falta resolver nada, así que **no hay
que portar el servicio**: alcanza con la constante. Si se decidiera que la guarda *resuelva* en vez de
fallar, ahí sí hay que igualar los gemelos primero.

### Paso 3 · Las 178 fichas ya creadas — necesita tu decisión

El Paso 1 arregla a quien entre desde el deploy. Las **178** personas que ya están guardadas con
documento real + `-` siguen rotas si vuelven a intentar (y vuelven: `LAURA PATRICIA`, cédula
`1014257745`, hizo **5 solicitudes en 40 minutos**). Un backfill acotado:

```sql
-- DRY RUN primero: cuántas y de qué comercios
SELECT ab.allied_id, COUNT(*) FROM users u
JOIN user_requests ur ON ur.user_id = u.id
JOIN allied_branches ab ON ab.id = ur.allied_branch_id
WHERE u.document_type = '-' AND u.document_number NOT LIKE 'TEMP-%'
GROUP BY ab.allied_id;
```

Y la escritura, **por sucursal**, con el mismo resolvedor del Paso 1 — no un `UPDATE … = 'CC'` global,
que sería volver a hornear Colombia en los datos. Es una escritura en producción: no la hago sin que lo
pidas explícitamente.

**Las 930 sin documento no se tocan.** Su `-` es correcto.

## Lo que NO se cambia, y por qué

| | por qué se queda |
|---|---|
| `TemporalUserConstants::DOCUMENT_TYPE_PENDIENTE = '-'` | La decisión de #68 es correcta. El `-` sigue siendo el valor para las 930 fichas que de verdad no tienen documento. |
| `UserService.php:184` | Ese camino nunca tiene número real (`createTemporalUser` en `:149` no lo recibe). El `-` es correcto por construcción. |
| `SendOtpCodeRequest` (aceptar un `document_type`) | La pantalla de alta de autogestión pide **sólo** teléfono y documento (`frontend-monorepo/apps/loan-request-wizard/app/routes/bancolombia/onboarding/register.tsx:108`-`:118`). Agregarle un selector es cambio de producto, no arreglo de bug. Por eso el tipo se resuelve en el backend. |
| El validador de `PersonalInfoRequest` | Su «puente de transición» ya excluye al temporal por `first_name`, no por tipo. Con el Paso 1 la ficha nace con un tipo del catálogo del punto de venta, así que el puente ni se activa. |

## Cómo se verifica — y por qué ningún ambiente lo reproduce hoy

⚠ **Esto no se puede probar corriendo el flujo fuera de producción.**
`legacy-application/app/Actions/Lenders/BancolombiaBnpl.php:707`:

```php
'documentType' => app()->environment() === 'production' ? $user->document_type : 'CC',
```

Fuera de prod **siempre manda `CC`**. Y en la op `validate` de Consumo, que sí manda el tipo real en
todos los ambientes, contesta el mock local, que no valida el parámetro. Por eso el bug llegó a
producción sin que ningún ambiente lo levantara.

Lo que sí se puede verificar, y alcanza:

1. **El Paso 1, contra la base local.** El alta con documento tiene que dejar un tipo del catálogo del
   punto de venta, y el alta sin documento tiene que seguir dejando `-`. Ya hay un runner con esa forma
   exacta: `make harness-pais-usuario` cubre los dos caminos de alta y limpia lo que escribe.
   `make harness-suite-paises` es la suite de internacionalización contra la base.
2. **El Paso 2, con un test unitario del builder.** Es una clase pura (`build($service, $user, $request)`):
   un `User` con `document_type = '-'` tiene que tirar la excepción, y uno con `CC` tiene que armar el
   payload igual que hoy. Sin base y sin banco.
3. **El *freeze* de `RegisterCellPhoneService`**, que #68 ya dejó actualizado — hay que volver a pasarlo
   con la dependencia nueva mockeada, porque el constructor cambia de firma. Con ruta explícita, **nunca
   la suite entera** (⛔ CORE-431):

   ```bash
   ./vendor/bin/sail artisan test Modules/Onboarding/tests/Unit/RegisterCellPhoneServiceFreezeTest.php
   ```

   Antes de correr esa carpeta, el chequeo de siempre — que no arrastre `RefreshDatabase` en ninguna de
   sus tres formas:

   ```bash
   grep -rlE '^\s*use RefreshDatabase;|uses\(.*RefreshDatabase::class' Modules/Onboarding/tests
   ls Modules/Onboarding/tests/Pest.php Modules/Onboarding/tests/Unit/Pest.php 2>/dev/null
   ```
4. **Después del deploy, contra prod:** que dejen de nacer fichas con documento real y `-`, y que la tasa
   del lender 68 vuelva al ~50 %.

```sql
-- tiene que dar 0 para las fichas nuevas
SELECT COUNT(*) FROM users
WHERE document_type = '-' AND document_number NOT LIKE 'TEMP-%' AND created_at >= '<fecha del deploy>';
```

## Minas adyacentes del mismo canal

Verificadas en `main`, **no las vi disparar**, pero están armadas con el mismo `-`:

- **`legacy-backend/app/Actions/Allieds/Corbeta.php:82`** —
  `'IdTipoDocumento' => static::DOCUMENT_TYPES[$user->document_type],` sobre el mapa de `:18`. Con `-` es
  clave inexistente al generar la orden en Corbeta. El Paso 1 la desarma de hecho, pero el acceso sigue
  sin respaldo.
- **`legacy-backend/Modules/Onboarding/App/Http/Controllers/CorbetaCheckoutController.php:1174`** —
  `createUserFromBilling` recibe `$documentType` como parámetro (`:1153`) y escribe `'document_type' => 'CC'`
  quemado. Es un bug pre-existente e independiente: el `billing` sí trae el tipo (`:357`).
- **La búsqueda por (número, tipo)** — `:997`-`:998` usa `findByDocumentAndType($documentNumber, $documentType)`.
  #68 ya cambió los chequeos de duplicados del alta a `findByDocument($doc)` por esta misma razón (el
  número ya es UNIQUE); este camino del checkout quedó con el filtro por tipo.
- **`legacy-application/app/Actions/Lenders/BancolombiaBnpl.php:707`** — el ternario de arriba. Que el
  payload de producción difiera del de todos los demás ambientes es la razón por la que esto no se pudo
  cazar antes; merece su propia discusión.

## Lo que necesito de vos

1. **¿Lo implemento?** Los repos reales trabajan en ramas y no armo PR sin permiso. Pasos 1 y 2 son
   chicos y van juntos en una rama; toca `legacy-backend` (2 archivos) y `legacy-application` (1 archivo).
2. **¿La guarda falla o resuelve?** Propongo que **falle** (arriba está el por qué). Si preferís que
   resuelva, hay que igualar antes el `DocumentTypesService` de `legacy-application`.
3. **¿El backfill de las 178?** Escritura en producción, con tu visto bueno y por sucursal.
4. **¿Va como F-192 en `findings` y como anotación fechada en #68?** Corresponde a los dos lugares: la
   trampa es del sistema (síntoma → causa → evidencia → arreglo) y la decisión vive en #68.
