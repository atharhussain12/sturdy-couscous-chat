import { describe, expect, it } from "vitest";

import { conversationIdFromPubKeys, groupSessionId, inboxTopic } from "@/lib/topics";

describe("topics", () => {
  it("generates stable conversation ids regardless of key order", () => {
    const a = "key-a";
    const b = "key-b";
    const id1 = conversationIdFromPubKeys(a, b);
    const id2 = conversationIdFromPubKeys(b, a);
    expect(id1).toBe(id2);
  });

  it("generates stable group session ids regardless of member order", () => {
    const id1 = groupSessionId("group-1", "alice", "bob");
    const id2 = groupSessionId("group-1", "bob", "alice");
    expect(id1).toBe(id2);
  });

  it("formats inbox topics with the expected prefix", () => {
    const topic = inboxTopic(new Uint8Array([1, 2, 3]));
    expect(topic.startsWith("/app/1/inbox/")).toBe(true);
  });
});
