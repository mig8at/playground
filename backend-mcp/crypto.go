package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

// laravelEncrypt replica Crypt::encryptString() de Laravel con AES-256-CBC (cipher de config/app.php):
// payload = base64( json{ iv, value, mac, tag } ), donde value = base64(AES-256-CBC(PKCS7(plaintext))),
// iv = base64(16B aleatorios), mac = hmac_sha256(iv_b64 . value_b64, key) en hex, tag = "" (CBC no AEAD).
// Es lo que el cast `encrypted:collection` espera para poder desencriptar `$user->datacredito->data`.
func laravelEncrypt(appKey, plaintext string) (string, error) {
	key, err := laravelKey(appKey)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("aes: %w", err)
	}
	iv := make([]byte, aes.BlockSize) // 16
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	padded := pkcs7Pad([]byte(plaintext), aes.BlockSize)
	ct := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(ct, padded)

	ivB64 := base64.StdEncoding.EncodeToString(iv)
	valueB64 := base64.StdEncoding.EncodeToString(ct) // openssl_encrypt sin RAW_DATA → base64

	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(ivB64 + valueB64))
	macHex := hex.EncodeToString(mac.Sum(nil))

	// orden iv,value,mac,tag (como compact() de PHP); el orden no afecta al decrypt.
	payload := struct {
		IV    string `json:"iv"`
		Value string `json:"value"`
		MAC   string `json:"mac"`
		Tag   string `json:"tag"`
	}{ivB64, valueB64, macHex, ""}
	jb, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(jb), nil
}

// laravelKey decodifica APP_KEY (`base64:…` o base64 crudo) → bytes. AES-256 exige 32 bytes.
func laravelKey(appKey string) ([]byte, error) {
	k := strings.TrimSpace(appKey)
	k = strings.TrimPrefix(k, "base64:")
	raw, err := base64.StdEncoding.DecodeString(k)
	if err != nil {
		return nil, fmt.Errorf("APP_KEY no es base64 válido: %w", err)
	}
	if len(raw) != 32 {
		return nil, fmt.Errorf("APP_KEY decodifica a %d bytes (se esperan 32 para AES-256)", len(raw))
	}
	return raw, nil
}

// laravelVerifyMAC comprueba SOLO el HMAC de un payload Laravel (sin desencriptar → sin tocar texto
// plano/PII). Si el MAC coincide, el APP_KEY es el correcto: la fila se cifró con esta misma llave.
func laravelVerifyMAC(appKey, payloadB64 string) (bool, error) {
	key, err := laravelKey(appKey)
	if err != nil {
		return false, err
	}
	jb, err := base64.StdEncoding.DecodeString(strings.TrimSpace(payloadB64))
	if err != nil {
		return false, fmt.Errorf("payload exterior no es base64: %w", err)
	}
	var p struct{ IV, Value, MAC, Tag string }
	if err := json.Unmarshal(jb, &p); err != nil {
		return false, fmt.Errorf("payload no es json {iv,value,mac}: %w", err)
	}
	macCalc := hmac.New(sha256.New, key)
	macCalc.Write([]byte(p.IV + p.Value))
	return hmac.Equal([]byte(hex.EncodeToString(macCalc.Sum(nil))), []byte(p.MAC)), nil
}

// laravelDecrypt revierte laravelEncrypt (verifica HMAC) — sirve para comprobar que el APP_KEY y el
// formato son correctos contra una fila Experian REAL ya guardada en dev.
func laravelDecrypt(appKey, payloadB64 string) (string, error) {
	key, err := laravelKey(appKey)
	if err != nil {
		return "", err
	}
	jb, err := base64.StdEncoding.DecodeString(strings.TrimSpace(payloadB64))
	if err != nil {
		return "", fmt.Errorf("payload exterior no es base64: %w", err)
	}
	var p struct{ IV, Value, MAC, Tag string }
	if err := json.Unmarshal(jb, &p); err != nil {
		return "", fmt.Errorf("payload no es json {iv,value,mac}: %w", err)
	}
	macCalc := hmac.New(sha256.New, key)
	macCalc.Write([]byte(p.IV + p.Value))
	if !hmac.Equal([]byte(hex.EncodeToString(macCalc.Sum(nil))), []byte(p.MAC)) {
		return "", fmt.Errorf("MAC no coincide (APP_KEY incorrecto o cifrado distinto)")
	}
	iv, err := base64.StdEncoding.DecodeString(p.IV)
	if err != nil || len(iv) != aes.BlockSize {
		return "", fmt.Errorf("iv inválido")
	}
	ct, err := base64.StdEncoding.DecodeString(p.Value)
	if err != nil || len(ct) == 0 || len(ct)%aes.BlockSize != 0 {
		return "", fmt.Errorf("value cifrado inválido")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	pt := make([]byte, len(ct))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(pt, ct)
	pt, err = pkcs7Unpad(pt)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

func pkcs7Unpad(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("vacío")
	}
	pad := int(data[len(data)-1])
	if pad == 0 || pad > len(data) {
		return nil, fmt.Errorf("padding inválido")
	}
	return data[:len(data)-pad], nil
}

func pkcs7Pad(data []byte, blockSize int) []byte {
	pad := blockSize - (len(data) % blockSize)
	if pad == 0 {
		pad = blockSize
	}
	out := make([]byte, len(data)+pad)
	copy(out, data)
	for i := len(data); i < len(out); i++ {
		out[i] = byte(pad)
	}
	return out
}
