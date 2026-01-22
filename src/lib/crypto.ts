import { gcm } from "@noble/ciphers/aes.js";
import { hkdf as hkdfNoble } from "@noble/hashes/hkdf.js";
import { hmac as hmacNoble } from "@noble/hashes/hmac.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import nacl from "tweetnacl";

import { base64ToBytes, bytesToBase64, stringToBytes } from "@/lib/encoding";

const AES_KEY_LENGTH = 256;
const PBKDF2_ITERATIONS = 120000;

function hasSubtleCrypto(): boolean {
  return typeof globalThis.crypto !== "undefined" && !!globalThis.crypto.subtle;
}

function deriveAesKeyBytes(passphrase: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, stringToBytes(passphrase), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: AES_KEY_LENGTH / 8,
  });
}

export function randomBytes(length: number): Uint8Array {
  return nacl.randomBytes(length);
}

export async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  if (!hasSubtleCrypto()) {
    throw new Error("WebCrypto is not available.");
  }
  const baseKey = await crypto.subtle.importKey(
    "raw",
    stringToBytes(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptWithPassphrase(
  data: Uint8Array,
  passphrase: string,
): Promise<{ ciphertext: string; iv: string; salt: string }> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  if (hasSubtleCrypto()) {
    const key = await deriveAesKey(passphrase, salt);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      data,
    );

    return {
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      iv: bytesToBase64(iv),
      salt: bytesToBase64(salt),
    };
  }

  const keyBytes = deriveAesKeyBytes(passphrase, salt);
  const ciphertext = gcm(keyBytes, iv).encrypt(data);
  return {
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
  };
}

export async function decryptWithPassphrase(
  payload: { ciphertext: string; iv: string; salt: string },
  passphrase: string,
): Promise<Uint8Array> {
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);
  if (hasSubtleCrypto()) {
    const key = await deriveAesKey(passphrase, salt);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    return new Uint8Array(plaintext);
  }

  const keyBytes = deriveAesKeyBytes(passphrase, salt);
  return gcm(keyBytes, iv).decrypt(ciphertext);
}

export async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  if (hasSubtleCrypto()) {
    const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
      "deriveBits",
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info },
      key,
      length * 8,
    );
    return new Uint8Array(bits);
  }

  return hkdfNoble(sha256, ikm, salt, info, length);
}

export async function hmacSha256(
  keyBytes: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  if (hasSubtleCrypto()) {
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, data);
    return new Uint8Array(signature);
  }

  return hmacNoble(sha256, keyBytes, data);
}
