package main

// El cifrado de Laravel (`Crypt::encryptString`): AES-256-CBC con un MAC HMAC-SHA256. El sobre es base64 de un JSON
// `{iv, value, mac, tag}`; el MAC es sobre los TEXTOS base64 de iv y value concatenados. Es como guarda legacy-backend la
// respuesta de cada central en `risk_central_user_data.data`. Mismo algoritmo que `harness/pkg/laravel-crypt.ts`.

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// laravelKey decodifica APP_KEY (`base64:…` o base64 crudo) a los 32 bytes de AES-256.
func laravelKey(appKey string) ([]byte, error) {
	k, err := base64.StdEncoding.DecodeString(strings.TrimSpace(strings.TrimPrefix(appKey, "base64:")))
	if err != nil {
		return nil, err
	}
	if len(k) != 32 {
		return nil, fmt.Errorf("decodifica a %d bytes (se esperan 32)", len(k))
	}
	return k, nil
}

type envelope struct {
	IV    string `json:"iv"`
	Value string `json:"value"`
	MAC   string `json:"mac"`
}

func parseEnvelope(payload string) (envelope, error) {
	var e envelope
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return e, errors.New("no es un sobre de Laravel")
	}
	if err := json.Unmarshal(raw, &e); err != nil || e.IV == "" || e.Value == "" {
		return e, errors.New("sobre de Laravel inválido")
	}
	return e, nil
}

// verifyMAC: ¿el APP_KEY es el que cifró este sobre?
func verifyMAC(payload string, key []byte) bool {
	e, err := parseEnvelope(payload)
	if err != nil || e.MAC == "" {
		return false
	}
	m := hmac.New(sha256.New, key)
	m.Write([]byte(e.IV + e.Value))
	want, _ := hex.DecodeString(e.MAC)
	return hmac.Equal(m.Sum(nil), want)
}

var phpString = regexp.MustCompile(`(?s)^s:\d+:"(.*)";$`)

// decryptLaravel devuelve el texto plano. `encrypt()` de Laravel lo serializa en PHP (`s:123:"…";`): se saca la envoltura.
func decryptLaravel(payload string, key []byte) (string, error) {
	e, err := parseEnvelope(payload)
	if err != nil {
		return "", err
	}
	if e.MAC != "" && !verifyMAC(payload, key) {
		return "", errors.New("el MAC no coincide (APP_KEY de otro ambiente)")
	}
	iv, err1 := base64.StdEncoding.DecodeString(e.IV)
	ct, err2 := base64.StdEncoding.DecodeString(e.Value)
	if err1 != nil || err2 != nil || len(iv) != aes.BlockSize || len(ct)%aes.BlockSize != 0 || len(ct) == 0 {
		return "", errors.New("sobre de Laravel inválido")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	plain := make([]byte, len(ct))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(plain, ct)
	pad := int(plain[len(plain)-1])
	if pad == 0 || pad > aes.BlockSize || pad > len(plain) {
		return "", errors.New("relleno inválido")
	}
	out := string(plain[:len(plain)-pad])
	if m := phpString.FindStringSubmatch(out); m != nil {
		out = m[1]
	}
	return out, nil
}
