import bs58 from "bs58";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return globalThis.btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToBase58(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}

export function base58ToBytes(value: string): Uint8Array {
  return bs58.decode(value);
}

export function stringToBytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function bytesToString(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}
