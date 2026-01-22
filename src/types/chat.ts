export type ChatKind = "dm" | "group";
export type RequestStatus = "pending" | "accepted" | "declined" | "blocked";
export type MessageStatus = "sending" | "sent" | "delivered" | "failed";
export type MessageKind =
  | "text"
  | "reaction"
  | "edit"
  | "delete"
  | "typing"
  | "attachment_meta"
  | "attachment_chunk"
  | "system"
  | "rekey";

export interface IdentityRecord {
  id: "local";
  publicKey: string;
  encryptedSecretKey: string;
  iv: string;
  salt: string;
  createdAt: number;
}

export interface PeerRecord {
  pubKey: string;
  label?: string;
  blocked?: boolean;
  lastSeen?: number;
}

export interface RequestRecord {
  id: string;
  kind: ChatKind;
  fromPubKey: string;
  toPubKey: string;
  intro: string;
  status: RequestStatus;
  createdAt: number;
  groupId?: string;
  groupName?: string;
  members?: string[];
}

export interface RequestStateRecord {
  id: string;
  status: RequestStatus;
  updatedAt: number;
}

export interface ChatRecord {
  id: string;
  kind: ChatKind;
  title: string;
  participants: string[];
  accepted: boolean;
  createdAt: number;
  lastMessageAt?: number;
  unreadCount?: number;
  groupId?: string;
}

export interface SessionRecord {
  conversationId: string;
  kind: ChatKind;
  peerPubKey: string;
  groupId?: string;
  sendCK: string;
  recvCK: string;
  sendN: number;
  recvN: number;
  skippedKeys: Record<string, string>;
}

export interface MessageRecord {
  id: string;
  chatId: string;
  type: MessageKind;
  fromPubKey: string;
  toPubKey?: string;
  body?: string;
  timestamp: number;
  status?: MessageStatus;
  n?: number;
  replyTo?: string;
  edited?: boolean;
  deleted?: boolean;
  keyMismatch?: boolean;
  attachmentId?: string;
  localOnly?: boolean;
}

export interface ReactionRecord {
  id: string;
  messageId: string;
  fromPubKey: string;
  emoji: string;
  timestamp: number;
}

export interface AttachmentRecord {
  id: string;
  messageId: string;
  name: string;
  mime: string;
  size: number;
  data?: string;
  totalChunks?: number;
  receivedChunks?: number;
  chunks?: Record<string, string>;
  complete: boolean;
}
