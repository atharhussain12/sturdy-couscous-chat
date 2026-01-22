import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockState = {
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
  init: vi.fn(),
  createIdentity: vi.fn(),
  unlockIdentity: vi.fn(),
  exportIdentity: vi.fn(),
  importIdentity: vi.fn(),
  setActiveChat: vi.fn(),
  sendChatRequest: vi.fn(),
  respondToRequest: vi.fn(),
  sendMessage: vi.fn(),
  sendReaction: vi.fn(),
  sendEdit: vi.fn(),
  sendDelete: vi.fn(),
  sendTyping: vi.fn(),
  sendAttachment: vi.fn(),
  createGroup: vi.fn(),
  rekeySession: vi.fn(),
  backupData: vi.fn(),
  restoreData: vi.fn(),
};

function useChatStore(selector: any) {
  return selector(mockState);
}

vi.mock("@/store/chatStore", () => ({
  useChatStore,
}));

import ChatApp from "@/components/ChatApp";

describe("ChatApp", () => {
  it("renders the empty state when no chats are available", () => {
    render(<ChatApp />);
    expect(screen.getByText("Start a new conversation")).toBeInTheDocument();
    expect(screen.getByText("No chats yet. Send a request to start.")).toBeInTheDocument();
  });
});
