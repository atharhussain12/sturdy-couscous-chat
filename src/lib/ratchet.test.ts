import { describe, expect, it } from "vitest";

import { bytesToBase64 } from "@/lib/encoding";
import { advanceSend, deriveChainKeys, deriveReceiveKey, deriveRootKey } from "@/lib/ratchet";
import type { SessionRecord } from "@/types/chat";

describe("ratchet", () => {
  it("derives stable chain keys from the same root", async () => {
    const sharedSecret = new Uint8Array(32).fill(7);
    const rootKey = await deriveRootKey(sharedSecret, "conversation-id");
    expect(rootKey).toHaveLength(32);

    const keysA = await deriveChainKeys(rootKey, "alice", "bob");
    const keysB = await deriveChainKeys(rootKey, "bob", "alice");

    expect(bytesToBase64(keysA.sendCK)).toBe(bytesToBase64(keysB.recvCK));
    expect(bytesToBase64(keysA.recvCK)).toBe(bytesToBase64(keysB.sendCK));
  });

  it("advances the send chain and increments the counter", async () => {
    const ck = new Uint8Array(32).fill(3);
    const session: SessionRecord = {
      conversationId: "c1",
      kind: "dm",
      peerPubKey: "peer",
      sendCK: bytesToBase64(ck),
      recvCK: bytesToBase64(ck),
      sendN: 0,
      recvN: 0,
      skippedKeys: {},
    };

    const { messageKey, nextSession } = await advanceSend(session);
    expect(messageKey).toHaveLength(32);
    expect(nextSession.sendN).toBe(1);
    expect(nextSession.sendCK).not.toBe(session.sendCK);
  });

  it("caches skipped receive keys for out-of-order delivery", async () => {
    const ck = new Uint8Array(32).fill(9);
    const session: SessionRecord = {
      conversationId: "c2",
      kind: "dm",
      peerPubKey: "peer",
      sendCK: bytesToBase64(ck),
      recvCK: bytesToBase64(ck),
      sendN: 0,
      recvN: 0,
      skippedKeys: {},
    };

    const { nextSession } = await deriveReceiveKey(session, 2, 50);
    expect(nextSession.recvN).toBe(3);
    expect(Object.keys(nextSession.skippedKeys)).toContain("0");
    expect(Object.keys(nextSession.skippedKeys)).toContain("1");

    const cached = await deriveReceiveKey(nextSession, 1, 50);
    expect(cached.fromCache).toBe(true);
    expect(cached.messageKey).toBeDefined();
  });
});
