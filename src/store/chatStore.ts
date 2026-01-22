import nacl from "tweetnacl";
import { create } from "zustand";

import {
  base58ToBytes,
  base64ToBytes,
  bytesToBase58,
  bytesToBase64,
  bytesToString,
  stringToBytes,
} from "@/lib/encoding";
import { decryptWithPassphrase, encryptWithPassphrase, randomBytes } from "@/lib/crypto";
import {
  getAllData,
  getAttachment,
  getIdentity,
  getSession,
  restoreAllData,
  setAttachment,
  setChat,
  setIdentity,
  setMessage,
  setReaction,
  setRequest,
  setRequestState,
  setSession,
} from "@/lib/idb";
import { advanceSend, deriveChainKeys, deriveReceiveKey, deriveRootKey } from "@/lib/ratchet";
import {
  conversationIdFromPubKeys,
  dmTopic,
  groupSessionId,
  groupTopic,
  inboxTopic,
} from "@/lib/topics";
import { publishPayload, subscribeTopic } from "@/lib/waku";
import type {
  AttachmentRecord,
  ChatKind,
  ChatRecord,
  IdentityRecord,
  MessageRecord,
  ReactionRecord,
  RequestRecord,
  SessionRecord,
} from "@/types/chat";

const MAX_SKIPPED_KEYS = 50;
const ATTACHMENT_CHUNK_SIZE = 20000;

type TypingState = Record<string, Record<string, boolean>>;

interface ChatState {
  identity: IdentityRecord | null;
  unlockedSecretKey: Uint8Array | null;
  chatKey: string | null;
  inboxTopic: string | null;
  requests: RequestRecord[];
  chats: ChatRecord[];
  messages: Record<string, MessageRecord[]>;
  reactions: Record<string, ReactionRecord[]>;
  attachments: Record<string, AttachmentRecord>;
  sessions: Record<string, SessionRecord>;
  typing: TypingState;
  activeChatId: string | null;
  wakuReady: boolean;
  errors: string[];
  init: () => Promise<void>;
  createIdentity: (passphrase: string) => Promise<void>;
  unlockIdentity: (passphrase: string) => Promise<boolean>;
  exportIdentity: () => Promise<string>;
  importIdentity: (payload: string) => Promise<void>;
  setActiveChat: (chatId: string | null) => void;
  sendChatRequest: (toChatKey: string, intro: string) => Promise<void>;
  respondToRequest: (
    requestId: string,
    response: "accepted" | "declined" | "blocked",
  ) => Promise<void>;
  sendMessage: (
    chatId: string,
    body: string,
    replyTo?: string,
  ) => Promise<void>;
  sendReaction: (chatId: string, messageId: string, emoji: string) => Promise<void>;
  sendEdit: (chatId: string, messageId: string, body: string) => Promise<void>;
  sendDelete: (chatId: string, messageId: string) => Promise<void>;
  sendTyping: (chatId: string, isTyping: boolean) => Promise<void>;
  sendAttachment: (chatId: string, file: File) => Promise<void>;
  createGroup: (name: string, members: string[]) => Promise<void>;
  rekeySession: (chatId: string) => Promise<void>;
  backupData: (passphrase: string) => Promise<string>;
  restoreData: (payload: string, passphrase: string) => Promise<void>;
}

const subscribedTopics = new Set<string>();

function now(): number {
  return Date.now();
}

function randomId(): string {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function addError(setState: (partial: Partial<ChatState>) => void, message: string) {
  setState((state) => ({ errors: [...state.errors, message].slice(-5) }));
}

function encodePayload(payload: object): Uint8Array {
  return stringToBytes(JSON.stringify(payload));
}

function decodePayload(bytes: Uint8Array): any | null {
  try {
    return JSON.parse(bytesToString(bytes));
  } catch {
    return null;
  }
}

function messageListForChat(
  messages: Record<string, MessageRecord[]>,
  chatId: string,
): MessageRecord[] {
  return messages[chatId] ? [...messages[chatId]] : [];
}

function updateMessageList(
  messages: Record<string, MessageRecord[]>,
  chatId: string,
  next: MessageRecord,
): Record<string, MessageRecord[]> {
  const list = messageListForChat(messages, chatId);
  list.push(next);
  return { ...messages, [chatId]: list.sort((a, b) => a.timestamp - b.timestamp) };
}

function mergeMessageUpdate(
  messages: Record<string, MessageRecord[]>,
  chatId: string,
  messageId: string,
  updater: (message: MessageRecord) => MessageRecord,
): Record<string, MessageRecord[]> {
  const list = messageListForChat(messages, chatId).map((item) =>
    item.id === messageId ? updater(item) : item,
  );
  return { ...messages, [chatId]: list };
}

async function ensureSubscription(
  topic: string,
  handler: (payload: Uint8Array) => Promise<void>,
): Promise<void> {
  if (subscribedTopics.has(topic)) {
    return;
  }
  await subscribeTopic(topic, handler);
  subscribedTopics.add(topic);
}


function createSystemMessage(
  chatId: string,
  body: string,
  timestamp = now(),
): MessageRecord {
  return {
    id: randomId(),
    chatId,
    type: "system",
    fromPubKey: "system",
    body,
    timestamp,
  };
}

export const useChatStore = create<ChatState>((set, get) => ({
  identity: null,
  unlockedSecretKey: null,
  chatKey: null,
  inboxTopic: null,
  requests: [],
  chats: [],
  messages: {},
  reactions: {},
  attachments: {},
  sessions: {},
  typing: {},
  activeChatId: null,
  wakuReady: false,
  errors: [],
  init: async () => {
    const identity = await getIdentity();
    const data = await getAllData();
    const messagesByChat: Record<string, MessageRecord[]> = {};
    data.messages.forEach((message) => {
      messagesByChat[message.chatId] = messagesByChat[message.chatId] || [];
      messagesByChat[message.chatId].push(message);
    });
    const reactionsByMessage: Record<string, ReactionRecord[]> = {};
    data.reactions.forEach((reaction) => {
      reactionsByMessage[reaction.messageId] =
        reactionsByMessage[reaction.messageId] || [];
      reactionsByMessage[reaction.messageId].push(reaction);
    });
    const attachmentMap: Record<string, AttachmentRecord> = {};
    data.attachments.forEach((attachment) => {
      attachmentMap[attachment.id] = attachment;
    });
    const sessionMap: Record<string, SessionRecord> = {};
    data.sessions.forEach((session) => {
      sessionMap[session.conversationId] = session;
    });

    set({
      identity: identity || null,
      requests: data.requests,
      chats: data.chats,
      messages: messagesByChat,
      reactions: reactionsByMessage,
      attachments: attachmentMap,
      sessions: sessionMap,
    });
  },
  createIdentity: async (passphrase) => {
    const keypair = nacl.box.keyPair();
    const encrypted = await encryptWithPassphrase(keypair.secretKey, passphrase);
    const identity: IdentityRecord = {
      id: "local",
      publicKey: bytesToBase64(keypair.publicKey),
      encryptedSecretKey: encrypted.ciphertext,
      iv: encrypted.iv,
      salt: encrypted.salt,
      createdAt: now(),
    };
    await setIdentity(identity);
    set({
      identity,
      unlockedSecretKey: keypair.secretKey,
      chatKey: bytesToBase58(keypair.publicKey),
      inboxTopic: inboxTopic(keypair.publicKey),
    });
    const inbox = inboxTopic(keypair.publicKey);
    await ensureSubscription(inbox, async (payload) => {
      await handleIncoming(payload, set, get);
    });
    const acceptedChats = get().chats.filter((chat) => chat.accepted);
    for (const chat of acceptedChats) {
      const topic = chat.kind === "dm" ? dmTopic(chat.id) : groupTopic(chat.id);
      await ensureSubscription(topic, async (payload) => {
        await handleIncoming(payload, set, get);
      });
    }
    set({ wakuReady: true });
  },
  unlockIdentity: async (passphrase) => {
    const identity = get().identity || (await getIdentity());
    if (!identity) {
      return false;
    }
    try {
      const secretKey = await decryptWithPassphrase(
        {
          ciphertext: identity.encryptedSecretKey,
          iv: identity.iv,
          salt: identity.salt,
        },
        passphrase,
      );
      const publicKeyBytes = base64ToBytes(identity.publicKey);
      const inbox = inboxTopic(publicKeyBytes);
      set({
        identity,
        unlockedSecretKey: secretKey,
        chatKey: bytesToBase58(publicKeyBytes),
        inboxTopic: inbox,
      });

      await ensureSubscription(inbox, async (payload) => {
        await handleIncoming(payload, set, get);
      });

      const acceptedChats = get().chats.filter((chat) => chat.accepted);
      for (const chat of acceptedChats) {
        const topic = chat.kind === "dm" ? dmTopic(chat.id) : groupTopic(chat.id);
        await ensureSubscription(topic, async (payload) => {
          await handleIncoming(payload, set, get);
        });
      }
      set({ wakuReady: true });
      return true;
    } catch (error) {
      addError(set, "Failed to unlock identity. Check passphrase.");
      return false;
    }
  },
  exportIdentity: async () => {
    const identity = get().identity;
    if (!identity) {
      throw new Error("No identity to export.");
    }
    return JSON.stringify(identity, null, 2);
  },
  importIdentity: async (payload) => {
    const identity = JSON.parse(payload) as IdentityRecord;
    await setIdentity(identity);
    set({ identity });
  },
  setActiveChat: (chatId) => {
    if (chatId) {
      const chat = get().chats.find((item) => item.id === chatId);
      if (chat && chat.unreadCount) {
        const updated = { ...chat, unreadCount: 0 };
        setChat(updated).catch(() => null);
        set((prev) => ({
          chats: prev.chats.map((item) => (item.id === chatId ? updated : item)),
        }));
      }
    }
    set({ activeChatId: chatId });
  },
  sendChatRequest: async (toChatKey, intro) => {
    const state = get();
    const secretKey = state.unlockedSecretKey;
    if (!secretKey || !state.chatKey || !state.inboxTopic) {
      addError(set, "Unlock identity first.");
      return;
    }

    const toPubKeyBytes = base58ToBytes(toChatKey.trim());
    const requestId = randomId();
    const nonce = randomBytes(24);
    const ciphertext = nacl.box(
      stringToBytes(intro),
      nonce,
      toPubKeyBytes,
      secretKey,
    );

    const payload = {
      v: 1,
      type: "chat_request",
      requestId,
      fromPubKey: state.chatKey,
      toPubKey: toChatKey,
      nonce: bytesToBase64(nonce),
      ciphertext: bytesToBase64(ciphertext),
      timestamp: now(),
    };

    const recipientInbox = inboxTopic(toPubKeyBytes);
    await publishPayload(recipientInbox, encodePayload(payload));

    const request: RequestRecord = {
      id: requestId,
      kind: "dm",
      fromPubKey: state.chatKey,
      toPubKey: toChatKey,
      intro,
      status: "pending",
      createdAt: now(),
    };
    await setRequest(request);
    await setRequestState({ id: requestId, status: "pending", updatedAt: now() });
    set((prev) => ({ requests: [...prev.requests, request] }));
  },
  respondToRequest: async (requestId, response) => {
    const state = get();
    const request = state.requests.find((item) => item.id === requestId);
    if (!request || !state.unlockedSecretKey || !state.chatKey) {
      return;
    }
    const updated: RequestRecord = { ...request, status: response };
    await setRequest(updated);
    await setRequestState({ id: requestId, status: response, updatedAt: now() });

    set((prev) => ({
      requests: prev.requests.map((item) => (item.id === requestId ? updated : item)),
    }));

    const targetInbox = inboxTopic(base58ToBytes(request.fromPubKey));
    if (request.kind === "group") {
      const payload = {
        v: 1,
        type: `group_${response}`,
        requestId,
        groupId: request.groupId,
        fromPubKey: state.chatKey,
        toPubKey: request.fromPubKey,
        timestamp: now(),
      };
      await publishPayload(targetInbox, encodePayload(payload));
      if (response === "accepted" && request.groupId) {
        const chat: ChatRecord = {
          id: request.groupId,
          kind: "group",
          title: request.groupName || "Group",
          participants: request.members || [state.chatKey],
          accepted: true,
          createdAt: now(),
          groupId: request.groupId,
        };
        await setChat(chat);
        set((prev) => ({ chats: [...prev.chats, chat] }));

        await ensureSubscription(groupTopic(chat.id), async (payloadBytes) => {
          await handleIncoming(payloadBytes, set, get);
        });
      }
      return;
    }

    const type =
      response === "accepted"
        ? "chat_accept"
        : response === "declined"
          ? "chat_declined"
          : "chat_blocked";
    const payload = {
      v: 1,
      type,
      requestId,
      fromPubKey: state.chatKey,
      toPubKey: request.fromPubKey,
      conversationId: conversationIdFromPubKeys(state.chatKey, request.fromPubKey),
      timestamp: now(),
    };
    await publishPayload(targetInbox, encodePayload(payload));

    if (response === "accepted") {
      const chatId = conversationIdFromPubKeys(state.chatKey, request.fromPubKey);
      const chat: ChatRecord = {
        id: chatId,
        kind: request.kind,
        title: request.fromPubKey.slice(0, 12),
        participants: [state.chatKey, request.fromPubKey],
        accepted: true,
        createdAt: now(),
      };
      await setChat(chat);
      set((prev) => ({ chats: [...prev.chats, chat] }));

      await ensureSubscription(dmTopic(chatId), async (payloadBytes) => {
        await handleIncoming(payloadBytes, set, get);
      });

      await ensureSession(chatId, "dm", request.fromPubKey, set, get);
      const existingMessages = get().messages[chatId] || [];
      if (existingMessages.length === 0) {
        const systemMessage = createSystemMessage(
          chatId,
          `Chat request: ${request.intro}`,
        );
        await setMessage(systemMessage);
        set((prev) => ({
          messages: updateMessageList(prev.messages, chatId, systemMessage),
        }));
      }
    }
  },
  sendMessage: async (chatId, body, replyTo) => {
    const state = get();
    const chat = state.chats.find((item) => item.id === chatId);
    if (!chat || !chat.accepted || !state.unlockedSecretKey || !state.chatKey) {
      addError(set, "Chat not ready.");
      return;
    }

    if (chat.kind === "group") {
      const messageId = randomId();
      const message: MessageRecord = {
        id: messageId,
        chatId,
        type: "text",
        fromPubKey: state.chatKey,
        body,
        replyTo,
        timestamp: now(),
        status: "sent",
      };
      await setMessage(message);
      set((prev) => ({
        messages: updateMessageList(prev.messages, chatId, message),
        chats: prev.chats.map((item) =>
          item.id === chatId ? { ...item, lastMessageAt: now() } : item,
        ),
      }));
      await sendGroupMessage(chat, { kind: "text", body, replyTo }, set, get, messageId);
      return;
    }

    const peerPubKey = chat.participants.find((key) => key !== state.chatKey);
    if (!peerPubKey) {
      return;
    }

    const { messageKey, session } = await getSendKey(
      chatId,
      chat.kind,
      peerPubKey,
      set,
      get,
    );
    const messageNumber = Math.max(0, session.sendN - 1);
    const nonce = randomBytes(24);
    const innerPayload = { kind: "text", body, replyTo };
    const ciphertext = nacl.secretbox(
      encodePayload(innerPayload),
      nonce,
      messageKey,
    );

    const messageId = randomId();
    const payload = {
      v: 1,
      type: "dm_message",
      conversationId: chatId,
      messageId,
      fromPubKey: state.chatKey,
      n: messageNumber,
      nonce: bytesToBase64(nonce),
      ciphertext: bytesToBase64(ciphertext),
      timestamp: now(),
    };

    await publishPayload(dmTopic(chatId), encodePayload(payload));
    await setSession(session);

    const message: MessageRecord = {
      id: messageId,
      chatId,
      type: "text",
      fromPubKey: state.chatKey,
      body,
      replyTo,
      timestamp: now(),
      status: "sent",
      n: messageNumber,
    };
    await setMessage(message);
    set((prev) => ({
      messages: updateMessageList(prev.messages, chatId, message),
      chats: prev.chats.map((item) =>
        item.id === chatId ? { ...item, lastMessageAt: now() } : item,
      ),
      sessions: { ...prev.sessions, [chatId]: session },
    }));
  },
  sendReaction: async (chatId, messageId, emoji) => {
    const state = get();
    const chat = state.chats.find((item) => item.id === chatId);
    if (!chat || !state.chatKey) {
      return;
    }
    const reaction: ReactionRecord = {
      id: randomId(),
      messageId,
      fromPubKey: state.chatKey,
      emoji,
      timestamp: now(),
    };
    await setReaction(reaction);
    set((prev) => ({
      reactions: {
        ...prev.reactions,
        [messageId]: [...(prev.reactions[messageId] || []), reaction],
      },
    }));
    if (chat.kind === "group") {
      await sendGroupMessage(chat, { kind: "reaction", messageId, emoji }, set, get);
      return;
    }
    await sendEventMessage(chat, {
      kind: "reaction",
      messageId,
      emoji,
    }, set, get);
  },
  sendEdit: async (chatId, messageId, body) => {
    const chat = get().chats.find((item) => item.id === chatId);
    if (!chat) {
      return;
    }
    if (chat.kind === "group") {
      await sendGroupMessage(chat, { kind: "edit", messageId, body }, set, get);
      return;
    }
    await sendEventMessage(chat, { kind: "edit", messageId, body }, set, get);
    const existing = get().messages[chatId]?.find((msg) => msg.id === messageId);
    if (existing) {
      await setMessage({ ...existing, body, edited: true });
    }
    set((prev) => ({
      messages: mergeMessageUpdate(prev.messages, chatId, messageId, (item) => ({
        ...item,
        body,
        edited: true,
      })),
    }));
  },
  sendDelete: async (chatId, messageId) => {
    const chat = get().chats.find((item) => item.id === chatId);
    if (!chat) {
      return;
    }
    if (chat.kind === "group") {
      await sendGroupMessage(chat, { kind: "delete", messageId }, set, get);
      return;
    }
    await sendEventMessage(chat, { kind: "delete", messageId }, set, get);
    const existing = get().messages[chatId]?.find((msg) => msg.id === messageId);
    if (existing) {
      await setMessage({ ...existing, deleted: true, body: "" });
    }
    set((prev) => ({
      messages: mergeMessageUpdate(prev.messages, chatId, messageId, (item) => ({
        ...item,
        deleted: true,
        body: "",
      })),
    }));
  },
  sendTyping: async (chatId, isTyping) => {
    const chat = get().chats.find((item) => item.id === chatId);
    if (!chat) {
      return;
    }
    if (chat.kind === "group") {
      await sendGroupMessage(chat, { kind: "typing", isTyping }, set, get);
      return;
    }
    await sendEventMessage(chat, { kind: "typing", isTyping }, set, get);
  },
  sendAttachment: async (chatId, file) => {
    const chat = get().chats.find((item) => item.id === chatId);
    if (!chat || !get().chatKey) {
      return;
    }
    const messageId = randomId();
    const attachmentId = randomId();
    const buffer = new Uint8Array(await file.arrayBuffer());
    const totalChunks = Math.ceil(buffer.length / ATTACHMENT_CHUNK_SIZE);
    const meta = {
      kind: "attachment_meta",
      attachmentId,
      name: file.name,
      mime: file.type || "application/octet-stream",
      size: buffer.length,
      totalChunks,
    };
    if (chat.kind === "group") {
      await sendGroupMessage(chat, meta, set, get, messageId);
    } else {
      await sendEventMessage(chat, meta, set, get, messageId);
    }
    const message: MessageRecord = {
      id: messageId,
      chatId,
      type: "attachment_meta",
      fromPubKey: get().chatKey || "me",
      body: file.name,
      attachmentId,
      timestamp: now(),
      status: "sent",
    };
    const attachment: AttachmentRecord = {
      id: attachmentId,
      messageId: message.id,
      name: file.name,
      mime: file.type || "application/octet-stream",
      size: buffer.length,
      totalChunks,
      receivedChunks: totalChunks,
      complete: true,
      data: bytesToBase64(buffer),
    };
    await setMessage(message);
    await setAttachment(attachment);
    set((prev) => ({
      messages: updateMessageList(prev.messages, chatId, message),
      attachments: { ...prev.attachments, [attachment.id]: attachment },
    }));

    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * ATTACHMENT_CHUNK_SIZE;
      const end = Math.min(buffer.length, start + ATTACHMENT_CHUNK_SIZE);
      const chunk = buffer.slice(start, end);
      const chunkPayload = {
        kind: "attachment_chunk",
        attachmentId,
        index,
        totalChunks,
        data: bytesToBase64(chunk),
      };
      if (chat.kind === "group") {
        await sendGroupMessage(chat, chunkPayload, set, get);
      } else {
        await sendEventMessage(chat, chunkPayload, set, get);
      }
    }
  },
  createGroup: async (name, members) => {
    const state = get();
    if (!state.chatKey || !state.unlockedSecretKey) {
      return;
    }
    const groupId = conversationIdFromPubKeys(
      bytesToBase58(randomBytes(32)),
      String(now()),
    );
    const fullMembers = Array.from(new Set([state.chatKey, ...members]));
    const chat: ChatRecord = {
      id: groupId,
      kind: "group",
      title: name,
      participants: fullMembers,
      accepted: true,
      createdAt: now(),
      groupId,
    };
    await setChat(chat);
    set((prev) => ({ chats: [...prev.chats, chat] }));

    await ensureSubscription(groupTopic(groupId), async (payloadBytes) => {
      await handleIncoming(payloadBytes, set, get);
    });

    for (const member of fullMembers) {
      if (member === state.chatKey) {
        continue;
      }
      const nonce = randomBytes(24);
      const ciphertext = nacl.box(
        encodePayload({ groupId, name, members: fullMembers }),
        nonce,
        base58ToBytes(member),
        state.unlockedSecretKey,
      );
      const payload = {
        v: 1,
        type: "group_invite",
        fromPubKey: state.chatKey,
        toPubKey: member,
        nonce: bytesToBase64(nonce),
        ciphertext: bytesToBase64(ciphertext),
        timestamp: now(),
      };
      await publishPayload(inboxTopic(base58ToBytes(member)), encodePayload(payload));
    }
  },
  rekeySession: async (chatId) => {
    const state = get();
    const chat = state.chats.find((item) => item.id === chatId);
    if (!chat || !state.chatKey) {
      return;
    }
    const peer = chat.participants.find((key) => key !== state.chatKey);
    if (!peer) {
      return;
    }
    const session = await resetSession(chatId, chat.kind, peer, set, get);
    await setSession(session);
    set((prev) => ({
      sessions: { ...prev.sessions, [chatId]: session },
      messages: updateMessageList(
        prev.messages,
        chatId,
        createSystemMessage(chatId, "Session rekeyed."),
      ),
    }));

    const rekeyPayload = { kind: "rekey" };
    if (chat.kind === "group") {
      await sendGroupMessage(chat, rekeyPayload, set, get);
    } else {
      await sendEventMessage(chat, rekeyPayload, set, get);
    }
  },
  backupData: async (passphrase) => {
    const data = await getAllData();
    const plaintext = stringToBytes(JSON.stringify(data));
    const encrypted = await encryptWithPassphrase(plaintext, passphrase);
    return JSON.stringify(encrypted, null, 2);
  },
  restoreData: async (payload, passphrase) => {
    const encrypted = JSON.parse(payload) as {
      ciphertext: string;
      iv: string;
      salt: string;
    };
    const plaintext = await decryptWithPassphrase(encrypted, passphrase);
    const data = JSON.parse(bytesToString(plaintext)) as Awaited<
      ReturnType<typeof getAllData>
    >;
    await restoreAllData(data);
    await get().init();
  },
}));

async function handleIncoming(
  payload: Uint8Array,
  setState: typeof useChatStore.setState,
  getState: typeof useChatStore.getState,
): Promise<void> {
  const state = getState();
  const message = decodePayload(payload);
  if (!message || typeof message.type !== "string") {
    return;
  }

  if (!state.chatKey || !state.unlockedSecretKey || !state.identity) {
    return;
  }

  if (message.type === "chat_request") {
    const fromPubKey = String(message.fromPubKey);
    const chatId = conversationIdFromPubKeys(state.chatKey, fromPubKey);
    const acceptedChat = state.chats.find(
      (item) => item.id === chatId && item.accepted,
    );
    if (acceptedChat) {
      await publishPayload(
        inboxTopic(base58ToBytes(fromPubKey)),
        encodePayload({
          v: 1,
          type: "chat_accept",
          requestId: message.requestId,
          fromPubKey: state.chatKey,
          toPubKey: fromPubKey,
          conversationId: chatId,
          timestamp: now(),
        }),
      );
      return;
    }
    const blockedRequest = state.requests.find(
      (item) =>
        item.fromPubKey === fromPubKey &&
        item.toPubKey === state.chatKey &&
        item.status === "blocked",
    );
    if (blockedRequest) {
      await publishPayload(
        inboxTopic(base58ToBytes(fromPubKey)),
        encodePayload({
          v: 1,
          type: "chat_blocked",
          requestId: message.requestId,
          fromPubKey: state.chatKey,
          toPubKey: fromPubKey,
          conversationId: chatId,
          timestamp: now(),
        }),
      );
      return;
    }
    const nonce = base64ToBytes(message.nonce);
    const ciphertext = base64ToBytes(message.ciphertext);
    const introBytes = nacl.box.open(
      ciphertext,
      nonce,
      base58ToBytes(fromPubKey),
      state.unlockedSecretKey,
    );
    const intro = introBytes ? bytesToString(introBytes) : "Unable to decrypt intro.";
    const request: RequestRecord = {
      id: message.requestId,
      kind: "dm",
      fromPubKey,
      toPubKey: state.chatKey,
      intro,
      status: "pending",
      createdAt: message.timestamp || now(),
    };
    await setRequest(request);
    await setRequestState({ id: request.id, status: "pending", updatedAt: now() });
    setState((prev) => ({
      requests: [...prev.requests.filter((item) => item.id !== request.id), request],
    }));
    return;
  }

  if (message.type === "chat_accept") {
    const peer = String(message.fromPubKey);
    const chatId = conversationIdFromPubKeys(state.chatKey, peer);
    const chat: ChatRecord = {
      id: chatId,
      kind: "dm",
      title: peer.slice(0, 12),
      participants: [state.chatKey, peer],
      accepted: true,
      createdAt: now(),
    };
    await setChat(chat);
    setState((prev) => ({
      chats: [...prev.chats.filter((item) => item.id !== chatId), chat],
    }));
    await ensureSubscription(dmTopic(chatId), async (incoming) => {
      await handleIncoming(incoming, setState, getState);
    });
    await ensureSession(chatId, "dm", peer, setState, getState);
    const existingRequest = state.requests.find((item) => item.id === message.requestId);
    if (existingRequest) {
      const updated = { ...existingRequest, status: "accepted" as const };
      await setRequest(updated);
      await setRequestState({ id: updated.id, status: "accepted", updatedAt: now() });
      setState((prev) => ({
        requests: prev.requests.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      }));
    }
    const existingMessages = state.messages[chatId] || [];
    if (existingMessages.length === 0) {
      const systemMessage = createSystemMessage(chatId, "Chat request accepted.");
      await setMessage(systemMessage);
      setState((prev) => ({
        messages: updateMessageList(prev.messages, chatId, systemMessage),
      }));
    }
    return;
  }

  if (message.type === "chat_declined" || message.type === "chat_blocked") {
    const requestId = message.requestId;
    const status = message.type === "chat_blocked" ? "blocked" : "declined";
    const existing = state.requests.find((item) => item.id === requestId);
    if (existing) {
      const updated = { ...existing, status };
      await setRequest(updated);
      await setRequestState({ id: requestId, status, updatedAt: now() });
    }
    setState((prev) => ({
      requests: prev.requests.map((item) =>
        item.id === requestId ? { ...item, status } : item,
      ),
    }));
    return;
  }

  if (message.type === "group_invite") {
    const fromPubKey = String(message.fromPubKey);
    const nonce = base64ToBytes(message.nonce);
    const ciphertext = base64ToBytes(message.ciphertext);
    const introBytes = nacl.box.open(
      ciphertext,
      nonce,
      base58ToBytes(fromPubKey),
      state.unlockedSecretKey,
    );
    if (!introBytes) {
      return;
    }
    const invite = decodePayload(introBytes);
    if (!invite) {
      return;
    }
    const request: RequestRecord = {
      id: `${invite.groupId}:${fromPubKey}`,
      kind: "group",
      fromPubKey,
      toPubKey: state.chatKey,
      intro: `${invite.name} (${invite.members.length} members)`,
      status: "pending",
      createdAt: now(),
      groupId: invite.groupId,
      groupName: invite.name,
      members: invite.members,
    };
    await setRequest(request);
    await setRequestState({ id: request.id, status: "pending", updatedAt: now() });
    setState((prev) => ({
      requests: [...prev.requests.filter((item) => item.id !== request.id), request],
    }));
    return;
  }

  if (message.type === "group_accept") {
    return;
  }

  if (message.type === "dm_ack") {
    const chatId = message.conversationId;
    const messageId = message.messageId;
    const existing = state.messages[chatId]?.find((msg) => msg.id === messageId);
    if (existing) {
      await setMessage({ ...existing, status: "delivered" });
    }
    setState((prev) => ({
      messages: mergeMessageUpdate(prev.messages, chatId, messageId, (item) => ({
        ...item,
        status: "delivered",
      })),
    }));
    return;
  }

  if (message.type === "dm_message") {
    await handleEncryptedMessage(message, setState, getState);
    return;
  }

  if (message.type === "group_message") {
    await handleGroupMessage(message, setState, getState);
  }
}

async function ensureSession(
  conversationId: string,
  kind: ChatKind,
  peerPubKey: string,
  setState: typeof useChatStore.setState,
  getState: typeof useChatStore.getState,
): Promise<SessionRecord> {
  const state = getState();
  const existing = state.sessions[conversationId] || (await getSession(conversationId));
  if (existing) {
    return existing;
  }
  const secretKey = state.unlockedSecretKey;
  if (!secretKey || !state.chatKey) {
    throw new Error("Missing secret key");
  }
  const sharedSecret = nacl.box.before(
    base58ToBytes(peerPubKey),
    secretKey,
  );
  const rootKey = await deriveRootKey(sharedSecret, conversationId);
  const { sendCK, recvCK } = await deriveChainKeys(rootKey, state.chatKey, peerPubKey);
  const session: SessionRecord = {
    conversationId,
    kind,
    peerPubKey,
    sendCK: bytesToBase64(sendCK),
    recvCK: bytesToBase64(recvCK),
    sendN: 0,
    recvN: 0,
    skippedKeys: {},
  };
  await setSession(session);
  setState((prev) => ({
    sessions: { ...prev.sessions, [conversationId]: session },
  }));
  return session;
}

async function resetSession(
  conversationId: string,
  kind: ChatKind,
  peerPubKey: string,
  setState: typeof useChatStore.setState,
  getState: typeof useChatStore.getState,
): Promise<SessionRecord> {
  const state = getState();
  const secretKey = state.unlockedSecretKey;
  if (!secretKey || !state.chatKey) {
    throw new Error("Missing secret key");
  }
  const sharedSecret = nacl.box.before(
    base58ToBytes(peerPubKey),
    secretKey,
  );
  const rootKey = await deriveRootKey(sharedSecret, conversationId);
  const { sendCK, recvCK } = await deriveChainKeys(rootKey, state.chatKey, peerPubKey);
  const session: SessionRecord = {
    conversationId,
    kind,
    peerPubKey,
    sendCK: bytesToBase64(sendCK),
    recvCK: bytesToBase64(recvCK),
    sendN: 0,
    recvN: 0,
    skippedKeys: {},
  };
  await setSession(session);
  setState((prev) => ({
    sessions: { ...prev.sessions, [conversationId]: session },
  }));
  return session;
}

async function getSendKey(
  conversationId: string,
  kind: ChatKind,
  peerPubKey: string,
  setState: typeof useChatStore.setState,
  getState: typeof useChatStore.getState,
): Promise<{ messageKey: Uint8Array; session: SessionRecord }> {
  const session = await ensureSession(conversationId, kind, peerPubKey, setState, getState);
  const { messageKey, nextSession } = await advanceSend(session);
  return { messageKey, session: nextSession };
}

async function sendEventMessage(
  chat: ChatRecord,
  eventPayload: Record<string, unknown>,
  setState: typeof useChatStore.setState,
  getState: typeof useChatStore.getState,
  messageId?: string,
): Promise<void> {
  const state = getState();
  const peerPubKey = chat.participants.find((key) => key !== state.chatKey);
  if (!peerPubKey) {
    return;
  }
  const { messageKey, session } = await getSendKey(
    chat.id,
    chat.kind,
    peerPubKey,
    setState,
    getState,
  );
  const messageNumber = Math.max(0, session.sendN - 1);
  const nonce = randomBytes(24);
  const ciphertext = nacl.secretbox(encodePayload(eventPayload), nonce, messageKey);
  const outboundId = messageId || randomId();
  const payload = {
    v: 1,
    type: "dm_message",
    conversationId: chat.id,
    messageId: outboundId,
    fromPubKey: state.chatKey,
    n: messageNumber,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
    timestamp: now(),
  };
  await publishPayload(dmTopic(chat.id), encodePayload(payload));
  await setSession(session);
  setState((prev) => ({ sessions: { ...prev.sessions, [chat.id]: session } }));
}

async function sendGroupMessage(
  chat: ChatRecord,
  innerPayload: Record<string, unknown>,
  setState: typeof useChatStore.setState,
  getState: typeof useChatStore.getState,
  messageId?: string,
): Promise<void> {
  const state = getState();
  if (!state.chatKey || !state.unlockedSecretKey) {
    return;
  }
  const sealed: Array<{ toPubKey: string; n: number; nonce: string; ciphertext: string }> = [];
  const updatedSessions: SessionRecord[] = [];

  for (const member of chat.participants) {
    if (member === state.chatKey) {
      continue;
    }
    const convId = groupSessionId(chat.id, state.chatKey, member);
    const { messageKey, session } = await getSendKey(
      convId,
      "group",
      member,
      setState,
      getState,
    );
    const messageNumber = Math.max(0, session.sendN - 1);
    const nonce = randomBytes(24);
    const ciphertext = nacl.secretbox(encodePayload(innerPayload), nonce, messageKey);
    sealed.push({
      toPubKey: member,
      n: messageNumber,
      nonce: bytesToBase64(nonce),
      ciphertext: bytesToBase64(ciphertext),
    });
    updatedSessions.push(session);
  }

  const payload = {
    v: 1,
    type: "group_message",
    groupId: chat.id,
    messageId: messageId || randomId(),
    fromPubKey: state.chatKey,
    sealed,
    timestamp: now(),
  };
  await publishPayload(groupTopic(chat.id), encodePayload(payload));

  for (const session of updatedSessions) {
    await setSession(session);
  }
  setState((prev) => {
    const sessionUpdates = { ...prev.sessions };
    updatedSessions.forEach((session) => {
      sessionUpdates[session.conversationId] = session;
    });
    return { sessions: sessionUpdates };
  });
}

async function handleEncryptedMessage(
  payload: any,
  setState: typeof useChatStore.setState,
  getState: typeof useChatStore.getState,
): Promise<void> {
  const state = getState();
  const chatId = payload.conversationId;
  const fromPubKey = payload.fromPubKey;
  if (fromPubKey === state.chatKey) {
    return;
  }
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) {
    return;
  }

  const session = await ensureSession(chatId, "dm", fromPubKey, setState, getState);
  const { messageKey, nextSession } = await deriveReceiveKey(
    session,
    payload.n,
    MAX_SKIPPED_KEYS,
  );
  if (!messageKey) {
    const keyMismatch = createSystemMessage(chatId, "Key mismatch. Rekey to continue.");
    await setMessage(keyMismatch);
    setState((prev) => ({
      messages: updateMessageList(prev.messages, chatId, {
        ...keyMismatch,
        keyMismatch: true,
      }),
    }));
    return;
  }
  const nonce = base64ToBytes(payload.nonce);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const decrypted = nacl.secretbox.open(ciphertext, nonce, messageKey);
  if (!decrypted) {
    const keyMismatch = createSystemMessage(chatId, "Key mismatch. Rekey to continue.");
    await setMessage(keyMismatch);
    setState((prev) => ({
      messages: updateMessageList(prev.messages, chatId, {
        ...keyMismatch,
        keyMismatch: true,
      }),
    }));
    return;
  }
  const inner = decodePayload(decrypted);
  if (!inner) {
    return;
  }

  await setSession(nextSession);
  setState((prev) => ({
    sessions: { ...prev.sessions, [chatId]: nextSession },
  }));

  await publishPayload(
    inboxTopic(base58ToBytes(fromPubKey)),
    encodePayload({
      v: 1,
      type: "dm_ack",
      conversationId: chatId,
      messageId: payload.messageId,
      fromPubKey: state.chatKey,
      toPubKey: fromPubKey,
      timestamp: now(),
    }),
  );

  await handleInnerPayload(chatId, fromPubKey, inner, setState, getState, payload.messageId);
}

async function handleGroupMessage(
  payload: any,
  setState: typeof useChatStore.setState,
  getState: typeof useChatStore.getState,
): Promise<void> {
  const state = getState();
  if (!state.chatKey) {
    return;
  }
  const groupId = payload.groupId;
  const chat = state.chats.find((item) => item.id === groupId);
  if (!chat) {
    return;
  }
  const sealed = Array.isArray(payload.sealed) ? payload.sealed : [];
  const entry = sealed.find((item: any) => item.toPubKey === state.chatKey);
  if (!entry) {
    return;
  }

  const convId = groupSessionId(groupId, state.chatKey, payload.fromPubKey);
  const session = await ensureSession(convId, "group", payload.fromPubKey, setState, getState);
  const { messageKey, nextSession } = await deriveReceiveKey(
    session,
    entry.n,
    MAX_SKIPPED_KEYS,
  );
  if (!messageKey) {
    return;
  }
  const decrypted = nacl.secretbox.open(
    base64ToBytes(entry.ciphertext),
    base64ToBytes(entry.nonce),
    messageKey,
  );
  if (!decrypted) {
    return;
  }
  const inner = decodePayload(decrypted);
  if (!inner) {
    return;
  }
  await setSession(nextSession);
  setState((prev) => ({
    sessions: { ...prev.sessions, [convId]: nextSession },
  }));
  await handleInnerPayload(
    groupId,
    payload.fromPubKey,
    inner,
    setState,
    getState,
    payload.messageId,
  );
}

async function handleInnerPayload(
  chatId: string,
  fromPubKey: string,
  inner: any,
  setState: typeof useChatStore.setState,
  getState: typeof useChatStore.getState,
  messageId?: string,
): Promise<void> {
  const state = getState();
  if (inner.kind === "text") {
    const message: MessageRecord = {
      id: messageId || randomId(),
      chatId,
      type: "text",
      fromPubKey,
      body: inner.body,
      replyTo: inner.replyTo,
      timestamp: now(),
      status: "delivered",
    };
    await setMessage(message);
    const isActive = state.activeChatId === chatId;
    setState((prev) => ({
      messages: updateMessageList(prev.messages, chatId, message),
      chats: prev.chats.map((item) =>
        item.id === chatId
          ? {
              ...item,
              lastMessageAt: now(),
              unreadCount: isActive ? 0 : (item.unreadCount || 0) + 1,
            }
          : item,
      ),
    }));
  }

  if (inner.kind === "reaction") {
    const reaction: ReactionRecord = {
      id: randomId(),
      messageId: inner.messageId,
      fromPubKey,
      emoji: inner.emoji,
      timestamp: now(),
    };
    await setReaction(reaction);
    setState((prev) => ({
      reactions: {
        ...prev.reactions,
        [inner.messageId]: [...(prev.reactions[inner.messageId] || []), reaction],
      },
    }));
  }

  if (inner.kind === "edit") {
    const existing = state.messages[chatId]?.find((msg) => msg.id === inner.messageId);
    if (existing) {
      await setMessage({ ...existing, body: inner.body, edited: true });
    }
    setState((prev) => ({
      messages: mergeMessageUpdate(prev.messages, chatId, inner.messageId, (item) => ({
        ...item,
        body: inner.body,
        edited: true,
      })),
    }));
  }

  if (inner.kind === "delete") {
    const existing = state.messages[chatId]?.find((msg) => msg.id === inner.messageId);
    if (existing) {
      await setMessage({ ...existing, deleted: true, body: "" });
    }
    setState((prev) => ({
      messages: mergeMessageUpdate(prev.messages, chatId, inner.messageId, (item) => ({
        ...item,
        deleted: true,
        body: "",
      })),
    }));
  }

  if (inner.kind === "typing") {
    setState((prev) => ({
      typing: {
        ...prev.typing,
        [chatId]: {
          ...(prev.typing[chatId] || {}),
          [fromPubKey]: inner.isTyping,
        },
      },
    }));
  }

  if (inner.kind === "attachment_meta") {
    const message: MessageRecord = {
      id: messageId || randomId(),
      chatId,
      type: "attachment_meta",
      fromPubKey,
      body: inner.name,
      attachmentId: inner.attachmentId,
      timestamp: now(),
      status: "delivered",
    };
    const attachment: AttachmentRecord = {
      id: inner.attachmentId,
      messageId: message.id,
      name: inner.name,
      mime: inner.mime,
      size: inner.size,
      totalChunks: inner.totalChunks,
      receivedChunks: 0,
      chunks: {},
      complete: false,
    };
    await setMessage(message);
    await setAttachment(attachment);
    setState((prev) => ({
      messages: updateMessageList(prev.messages, chatId, message),
      attachments: { ...prev.attachments, [attachment.id]: attachment },
    }));
  }

  if (inner.kind === "attachment_chunk") {
    const attachment = state.attachments[inner.attachmentId] ||
      (await getAttachment(inner.attachmentId));
    if (!attachment) {
      return;
    }
    const nextChunks = { ...(attachment.chunks || {}) };
    nextChunks[String(inner.index)] = inner.data;
    const receivedChunks = Object.keys(nextChunks).length;
    const complete = receivedChunks === attachment.totalChunks;
    let mergedData: string | undefined = attachment.data;
    if (complete) {
      const ordered = Object.keys(nextChunks)
        .map((key) => Number(key))
        .sort((a, b) => a - b);
      const chunks = ordered.map((key) => base64ToBytes(nextChunks[String(key)]));
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      chunks.forEach((chunk) => {
        merged.set(chunk, offset);
        offset += chunk.length;
      });
      mergedData = bytesToBase64(merged);
    }
    const updated: AttachmentRecord = {
      ...attachment,
      chunks: nextChunks,
      receivedChunks,
      complete,
      data: mergedData,
    };
    await setAttachment(updated);
    setState((prev) => ({
      attachments: { ...prev.attachments, [updated.id]: updated },
    }));
  }

  if (inner.kind === "rekey") {
    const chat = state.chats.find((item) => item.id === chatId);
    if (!chat) {
      return;
    }
    const peerPubKey = fromPubKey;
    await resetSession(chatId, chat.kind, peerPubKey, setState, getState);
    setState((prev) => ({
      messages: updateMessageList(
        prev.messages,
        chatId,
        createSystemMessage(chatId, "Session rekeyed by peer."),
      ),
    }));
  }
}
