// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { conversationIdFromPubKeys } from "@/lib/topics";

type WakuHandler = (payload: Uint8Array) => void | Promise<void>;

type Subscriber = {
  ownerId: string | null;
  handler: WakuHandler;
};

function decodePayload(payload: Uint8Array): any | null {
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
}

function createWakuBus() {
  const subscribers = new Map<string, Subscriber[]>();
  const ownerKeys = new Map<string, string>();
  let activeOwner: string | null = null;

  const setActiveOwner = (ownerId: string | null) => {
    activeOwner = ownerId;
  };

  const registerOwnerKey = (ownerId: string, chatKey: string) => {
    ownerKeys.set(ownerId, chatKey);
  };

  const subscribeTopic = async (topic: string, handler: WakuHandler): Promise<void> => {
    const ownerId = activeOwner;
    const wrapped = async (payload: Uint8Array) => {
      const previous = activeOwner;
      activeOwner = ownerId;
      try {
        await handler(payload);
      } finally {
        activeOwner = previous;
      }
    };
    const list = subscribers.get(topic) || [];
    list.push({ ownerId, handler: wrapped });
    subscribers.set(topic, list);
  };

  const publishPayload = async (topic: string, payload: Uint8Array): Promise<void> => {
    const list = subscribers.get(topic) || [];
    const message = decodePayload(payload);
    const fromPubKey = message?.fromPubKey ? String(message.fromPubKey) : null;

    const deliveries = list
      .filter((subscriber) => {
        if (!fromPubKey) {
          return true;
        }
        if (!subscriber.ownerId) {
          return true;
        }
        return ownerKeys.get(subscriber.ownerId) !== fromPubKey;
      })
      .map((subscriber) => subscriber.handler(payload));
    for (const delivery of deliveries) {
      await delivery;
    }
  };

  return {
    subscribeTopic,
    publishPayload,
    setActiveOwner,
    registerOwnerKey,
  };
}

function createMemoryIdb() {
  const state = {
    identity: null as any,
    chats: [] as any[],
    requests: [] as any[],
    requestStates: [] as any[],
    sessions: [] as any[],
    messages: [] as any[],
    reactions: [] as any[],
    attachments: [] as any[],
  };

  const upsert = (list: any[], item: any, key = "id") => {
    const index = list.findIndex((entry) => entry[key] === item[key]);
    if (index >= 0) {
      list[index] = item;
    } else {
      list.push(item);
    }
  };

  return {
    getIdentity: async () => state.identity,
    setIdentity: async (identity: any) => {
      state.identity = identity;
    },
    getAllData: async () => ({
      identity: state.identity,
      chats: state.chats,
      requests: state.requests,
      requestStates: state.requestStates,
      sessions: state.sessions,
      messages: state.messages,
      reactions: state.reactions,
      attachments: state.attachments,
    }),
    setChat: async (chat: any) => {
      upsert(state.chats, chat);
    },
    setRequest: async (request: any) => {
      upsert(state.requests, request);
    },
    setRequestState: async (requestState: any) => {
      upsert(state.requestStates, requestState);
    },
    getSession: async (conversationId: string) =>
      state.sessions.find((session) => session.conversationId === conversationId) || null,
    setSession: async (session: any) => {
      upsert(state.sessions, session, "conversationId");
    },
    setMessage: async (message: any) => {
      upsert(state.messages, message);
    },
    setReaction: async (reaction: any) => {
      upsert(state.reactions, reaction);
    },
    setAttachment: async (attachment: any) => {
      upsert(state.attachments, attachment);
    },
    getAttachment: async (id: string) =>
      state.attachments.find((attachment) => attachment.id === id) || null,
    restoreAllData: async (data: any) => {
      state.identity = data.identity || null;
      state.chats = data.chats || [];
      state.requests = data.requests || [];
      state.requestStates = data.requestStates || [];
      state.sessions = data.sessions || [];
      state.messages = data.messages || [];
      state.reactions = data.reactions || [];
      state.attachments = data.attachments || [];
    },
  };
}

async function createUser(bus: ReturnType<typeof createWakuBus>) {
  vi.resetModules();
  vi.doMock("@/lib/waku", () => ({
    publishPayload: bus.publishPayload,
    subscribeTopic: bus.subscribeTopic,
  }));
  vi.doMock("@/lib/idb", () => createMemoryIdb());

  const { useChatStore } = await import("@/store/chatStore");
  return useChatStore;
}

describe("chatStore integration", () => {
  it("routes chat requests and messages between two users", async () => {
    const bus = createWakuBus();
    const userA = await createUser(bus);
    const userB = await createUser(bus);

    bus.setActiveOwner("userA");
    await userA.getState().createIdentity("pass-a");
    const userAKey = userA.getState().chatKey;
    if (!userAKey) {
      throw new Error("User A chat key missing.");
    }
    bus.registerOwnerKey("userA", userAKey);

    bus.setActiveOwner("userB");
    await userB.getState().createIdentity("pass-b");
    const userBKey = userB.getState().chatKey;
    if (!userBKey) {
      throw new Error("User B chat key missing.");
    }
    bus.registerOwnerKey("userB", userBKey);

    bus.setActiveOwner("userA");
    await userA.getState().sendChatRequest(userBKey, "Hello from A");

    const incoming = userB.getState().requests.find((req: any) => req.fromPubKey === userAKey);
    expect(incoming?.status).toBe("pending");
    if (!incoming) {
      throw new Error("Incoming request missing.");
    }

    bus.setActiveOwner("userB");
    await userB.getState().respondToRequest(incoming.id, "accepted");

    const chatId = conversationIdFromPubKeys(userAKey, userBKey);
    expect(userA.getState().chats.some((chat: any) => chat.id === chatId)).toBe(true);
    expect(userB.getState().chats.some((chat: any) => chat.id === chatId)).toBe(true);

    bus.setActiveOwner("userA");
    await userA.getState().sendMessage(chatId, "Hello B");

    const messagesForB = userB.getState().messages[chatId] || [];
    expect(messagesForB.some((msg: any) => msg.body === "Hello B")).toBe(true);
  });
});
