import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Mirror de `\Illuminate\Encryption\Encrypter` de Laravel (AES-256-CBC, cipher de config/app.php).
// El envelope es base64( json{ iv, value, mac, tag } ):
//   value = base64( AES-256-CBC( PKCS7(plaintext) ) )      (openssl_encrypt sin RAW_DATA → ya base64)
//   iv    = base64( 16 bytes aleatorios )
//   mac   = hex( hmac_sha256( iv_b64 . value_b64 , key ) )  (concatena los STRINGS base64, no bytes)
//   tag   = "" (CBC no es AEAD)
// Es lo que el cast `encrypted:collection` de legacy-backend espera para desencriptar
// `$user->datacredito->data` (la fila Experian en risk_central_user_data). Paridad 1:1 con
// backend-mcp/crypto.go (laravelEncrypt/laravelDecrypt).

/** Decodifica APP_KEY (`base64:…` o base64 crudo) → 32 bytes (AES-256). */
function laravelKey(appKey: string): Buffer {
    const raw = appKey.startsWith('base64:') ? appKey.slice('base64:'.length) : appKey;
    const key = Buffer.from(raw.trim(), 'base64');
    if (key.length !== 32) {
        throw new Error(`APP_KEY decodifica a ${key.length} bytes (se esperan 32 para AES-256).`);
    }
    return key;
}

function pkcs7Pad(data: Buffer, blockSize = 16): Buffer {
    let pad = blockSize - (data.length % blockSize);
    if (pad === 0) pad = blockSize;
    return Buffer.concat([data, Buffer.alloc(pad, pad)]);
}

function pkcs7Unpad(data: Buffer): Buffer {
    if (data.length === 0) throw new Error('padding inválido (vacío)');
    const pad = data[data.length - 1];
    if (pad <= 0 || pad > data.length) throw new Error('padding inválido');
    return data.subarray(0, data.length - pad);
}

/**
 * Encripta `plaintext` con la misma envoltura que `Crypt::encryptString()`. El MAC es OBLIGATORIO:
 * legacy lo verifica al desencriptar, así que un MAC inválido = fila ilegible. Espejo de crypto.go.
 */
export function encryptLaravelString(plaintext: string, appKey: string): string {
    const key = laravelKey(appKey);
    const iv = randomBytes(16);

    const cipher = createCipheriv('aes-256-cbc', key, iv);
    cipher.setAutoPadding(false); // padeamos PKCS7 a mano (igual que Go) para control byte-exacto
    const ct = Buffer.concat([cipher.update(pkcs7Pad(Buffer.from(plaintext, 'utf8'))), cipher.final()]);

    const ivB64 = iv.toString('base64');
    const valueB64 = ct.toString('base64');
    const mac = createHmac('sha256', key).update(ivB64 + valueB64).digest('hex');

    const envelope = { iv: ivB64, value: valueB64, mac, tag: '' };
    return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
}

/** Verifica SOLO el HMAC de un payload (sin desencriptar). MAC ok ⇒ el APP_KEY es el correcto. */
export function verifyLaravelMac(payload: string, appKey: string): boolean {
    const key = laravelKey(appKey);
    const env = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (!env.iv || !env.value || !env.mac) return false;
    const calc = createHmac('sha256', key).update(env.iv + env.value).digest('hex');
    const a = Buffer.from(calc), b = Buffer.from(String(env.mac));
    return a.length === b.length && timingSafeEqual(a, b);
}

/** Revierte encryptLaravelString. Verifica el MAC primero (APP_KEY correcto / mismo cifrado). */
export function decryptLaravelString(payload: string, appKey: string): string {
    const key = laravelKey(appKey);

    const envelope = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (!envelope.iv || !envelope.value) {
        throw new Error('Envelope Laravel inválido: falta iv/value');
    }
    if (envelope.mac && !verifyLaravelMac(payload, appKey)) {
        throw new Error('MAC no coincide (APP_KEY incorrecto o cifrado distinto)');
    }

    const iv = Buffer.from(envelope.iv, 'base64');
    const cipherText = Buffer.from(envelope.value, 'base64');

    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    decipher.setAutoPadding(false);
    const padded = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return pkcs7Unpad(padded).toString('utf8');
}
