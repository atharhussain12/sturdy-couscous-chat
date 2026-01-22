import { keccak256, stringToHex, toHex } from "viem";

export function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

export function inboxTopic(publicKey: Uint8Array): string {
  const hash = stripHexPrefix(keccak256(toHex(publicKey)));
  return `/app/1/inbox/${hash}`;
}

export function conversationIdFromPubKeys(
  pubKeyA: string,
  pubKeyB: string,
): string {
  const sorted = [pubKeyA, pubKeyB].sort();
  return stripHexPrefix(keccak256(stringToHex(sorted.join(":"))));
}

export function dmTopic(conversationId: string): string {
  return `/app/1/dm/${conversationId}`;
}

export function groupTopic(groupId: string): string {
  return `/app/1/group/${groupId}`;
}

export function groupSessionId(
  groupId: string,
  pubKeyA: string,
  pubKeyB: string,
): string {
  const sorted = [pubKeyA, pubKeyB].sort();
  return stripHexPrefix(keccak256(stringToHex(`${groupId}:${sorted.join(":")}`)));
}
