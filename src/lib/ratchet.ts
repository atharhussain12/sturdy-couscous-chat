import { base64ToBytes, bytesToBase64, stringToBytes } from "@/lib/encoding";
import { hkdf, hmacSha256 } from "@/lib/crypto";
import type { SessionRecord } from "@/types/chat";

const MSG_LABEL = stringToBytes("msg");
const CK_LABEL = stringToBytes("ck");

export async function deriveRootKey(
  sharedSecret: Uint8Array,
  conversationId: string,
): Promise<Uint8Array> {
  return hkdf(sharedSecret, stringToBytes(conversationId), stringToBytes("root"), 32);
}

export async function deriveChainKeys(
  rootKey: Uint8Array,
  myPubKey: string,
  otherPubKey: string,
): Promise<{ sendCK: Uint8Array; recvCK: Uint8Array }> {
  const sendCK = await hmacSha256(rootKey, stringToBytes(`send:${myPubKey}`));
  const recvCK = await hmacSha256(rootKey, stringToBytes(`send:${otherPubKey}`));
  return { sendCK, recvCK };
}

export async function advanceSend(
  session: SessionRecord,
): Promise<{ messageKey: Uint8Array; nextSession: SessionRecord }> {
  const currentCK = base64ToBytes(session.sendCK);
  const messageKey = await hmacSha256(currentCK, MSG_LABEL);
  const nextCK = await hmacSha256(currentCK, CK_LABEL);
  return {
    messageKey,
    nextSession: {
      ...session,
      sendCK: bytesToBase64(nextCK),
      sendN: session.sendN + 1,
    },
  };
}

export async function deriveReceiveKey(
  session: SessionRecord,
  n: number,
  maxSkipped: number,
): Promise<{
  messageKey?: Uint8Array;
  nextSession: SessionRecord;
  fromCache: boolean;
}> {
  const skipped = { ...session.skippedKeys };
  if (n < session.recvN) {
    const cached = skipped[String(n)];
    if (!cached) {
      return { nextSession: session, fromCache: false };
    }
    delete skipped[String(n)];
    return {
      messageKey: base64ToBytes(cached),
      nextSession: { ...session, skippedKeys: skipped },
      fromCache: true,
    };
  }

  let ck = base64ToBytes(session.recvCK);
  let derivedKey: Uint8Array | undefined;
  for (let index = session.recvN; index <= n; index += 1) {
    const messageKey = await hmacSha256(ck, MSG_LABEL);
    ck = await hmacSha256(ck, CK_LABEL);
    if (index === n) {
      derivedKey = messageKey;
    } else if (Object.keys(skipped).length < maxSkipped) {
      skipped[String(index)] = bytesToBase64(messageKey);
    }
  }

  const nextSession: SessionRecord = {
    ...session,
    recvCK: bytesToBase64(ck),
    recvN: n + 1,
    skippedKeys: trimSkipped(skipped, maxSkipped),
  };

  return { messageKey: derivedKey, nextSession, fromCache: false };
}

function trimSkipped(
  skipped: Record<string, string>,
  maxSkipped: number,
): Record<string, string> {
  const entries = Object.entries(skipped);
  if (entries.length <= maxSkipped) {
    return skipped;
  }
  const sorted = entries.sort((a, b) => Number(a[0]) - Number(b[0]));
  return Object.fromEntries(sorted.slice(sorted.length - maxSkipped));
}
