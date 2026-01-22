import { DBSchema, IDBPDatabase, openDB } from "idb";

import type {
  AttachmentRecord,
  ChatRecord,
  IdentityRecord,
  MessageRecord,
  PeerRecord,
  ReactionRecord,
  RequestRecord,
  RequestStateRecord,
  SessionRecord,
} from "@/types/chat";

interface ChatDB extends DBSchema {
  identity: {
    key: string;
    value: IdentityRecord;
  };
  peers: {
    key: string;
    value: PeerRecord;
  };
  requests: {
    key: string;
    value: RequestRecord;
    indexes: { "by-status": string };
  };
  requestStates: {
    key: string;
    value: RequestStateRecord;
  };
  chats: {
    key: string;
    value: ChatRecord;
    indexes: { "by-updated": number };
  };
  sessions_dm: {
    key: string;
    value: SessionRecord;
  };
  messages: {
    key: string;
    value: MessageRecord;
    indexes: { "by-chat": string; "by-timestamp": number };
  };
  reactions: {
    key: string;
    value: ReactionRecord;
    indexes: { "by-message": string };
  };
  attachments: {
    key: string;
    value: AttachmentRecord;
    indexes: { "by-message": string };
  };
}

let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<ChatDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ChatDB>("waku-chat", 1, {
      upgrade(db) {
        db.createObjectStore("identity", { keyPath: "id" });
        db.createObjectStore("peers", { keyPath: "pubKey" });
        const requests = db.createObjectStore("requests", { keyPath: "id" });
        requests.createIndex("by-status", "status");
        db.createObjectStore("requestStates", { keyPath: "id" });
        const chats = db.createObjectStore("chats", { keyPath: "id" });
        chats.createIndex("by-updated", "lastMessageAt");
        db.createObjectStore("sessions_dm", { keyPath: "conversationId" });
        const messages = db.createObjectStore("messages", { keyPath: "id" });
        messages.createIndex("by-chat", "chatId");
        messages.createIndex("by-timestamp", "timestamp");
        const reactions = db.createObjectStore("reactions", { keyPath: "id" });
        reactions.createIndex("by-message", "messageId");
        const attachments = db.createObjectStore("attachments", { keyPath: "id" });
        attachments.createIndex("by-message", "messageId");
      },
    });
  }
  return dbPromise;
}

export async function getIdentity(): Promise<IdentityRecord | undefined> {
  const db = await getDb();
  return db.get("identity", "local");
}

export async function setIdentity(identity: IdentityRecord): Promise<void> {
  const db = await getDb();
  await db.put("identity", identity);
}

export async function getAllRequests(): Promise<RequestRecord[]> {
  const db = await getDb();
  return db.getAll("requests");
}

export async function setRequest(request: RequestRecord): Promise<void> {
  const db = await getDb();
  await db.put("requests", request);
}

export async function setRequestState(state: RequestStateRecord): Promise<void> {
  const db = await getDb();
  await db.put("requestStates", state);
}

export async function getAllChats(): Promise<ChatRecord[]> {
  const db = await getDb();
  return db.getAll("chats");
}

export async function setChat(chat: ChatRecord): Promise<void> {
  const db = await getDb();
  await db.put("chats", chat);
}

export async function getSession(
  conversationId: string,
): Promise<SessionRecord | undefined> {
  const db = await getDb();
  return db.get("sessions_dm", conversationId);
}

export async function setSession(session: SessionRecord): Promise<void> {
  const db = await getDb();
  await db.put("sessions_dm", session);
}

export async function getMessagesByChat(
  chatId: string,
): Promise<MessageRecord[]> {
  const db = await getDb();
  return db.getAllFromIndex("messages", "by-chat", chatId);
}

export async function setMessage(message: MessageRecord): Promise<void> {
  const db = await getDb();
  await db.put("messages", message);
}

export async function getReactionsByMessage(
  messageId: string,
): Promise<ReactionRecord[]> {
  const db = await getDb();
  return db.getAllFromIndex("reactions", "by-message", messageId);
}

export async function setReaction(reaction: ReactionRecord): Promise<void> {
  const db = await getDb();
  await db.put("reactions", reaction);
}

export async function getAttachment(
  attachmentId: string,
): Promise<AttachmentRecord | undefined> {
  const db = await getDb();
  return db.get("attachments", attachmentId);
}

export async function setAttachment(attachment: AttachmentRecord): Promise<void> {
  const db = await getDb();
  await db.put("attachments", attachment);
}

export async function getAllData(): Promise<{
  identity: IdentityRecord[];
  peers: PeerRecord[];
  requests: RequestRecord[];
  requestStates: RequestStateRecord[];
  chats: ChatRecord[];
  sessions: SessionRecord[];
  messages: MessageRecord[];
  reactions: ReactionRecord[];
  attachments: AttachmentRecord[];
}> {
  const db = await getDb();
  return {
    identity: await db.getAll("identity"),
    peers: await db.getAll("peers"),
    requests: await db.getAll("requests"),
    requestStates: await db.getAll("requestStates"),
    chats: await db.getAll("chats"),
    sessions: await db.getAll("sessions_dm"),
    messages: await db.getAll("messages"),
    reactions: await db.getAll("reactions"),
    attachments: await db.getAll("attachments"),
  };
}

export async function restoreAllData(payload: {
  identity: IdentityRecord[];
  peers: PeerRecord[];
  requests: RequestRecord[];
  requestStates: RequestStateRecord[];
  chats: ChatRecord[];
  sessions: SessionRecord[];
  messages: MessageRecord[];
  reactions: ReactionRecord[];
  attachments: AttachmentRecord[];
}): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    [
      "identity",
      "peers",
      "requests",
      "requestStates",
      "chats",
      "sessions_dm",
      "messages",
      "reactions",
      "attachments",
    ],
    "readwrite",
  );
  await Promise.all([
    tx.objectStore("identity").clear(),
    tx.objectStore("peers").clear(),
    tx.objectStore("requests").clear(),
    tx.objectStore("requestStates").clear(),
    tx.objectStore("chats").clear(),
    tx.objectStore("sessions_dm").clear(),
    tx.objectStore("messages").clear(),
    tx.objectStore("reactions").clear(),
    tx.objectStore("attachments").clear(),
  ]);

  await Promise.all(payload.identity.map((item) => tx.objectStore("identity").put(item)));
  await Promise.all(payload.peers.map((item) => tx.objectStore("peers").put(item)));
  await Promise.all(payload.requests.map((item) => tx.objectStore("requests").put(item)));
  await Promise.all(
    payload.requestStates.map((item) => tx.objectStore("requestStates").put(item)),
  );
  await Promise.all(payload.chats.map((item) => tx.objectStore("chats").put(item)));
  await Promise.all(payload.sessions.map((item) => tx.objectStore("sessions_dm").put(item)));
  await Promise.all(payload.messages.map((item) => tx.objectStore("messages").put(item)));
  await Promise.all(payload.reactions.map((item) => tx.objectStore("reactions").put(item)));
  await Promise.all(
    payload.attachments.map((item) => tx.objectStore("attachments").put(item)),
  );
  await tx.done;
}
