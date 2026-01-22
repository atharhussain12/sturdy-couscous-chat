"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Copy,
  FileDown,
  FileUp,
  ImagePlus,
  KeyRound,
  Lock,
  MessageCircle,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  Settings2,
  Shield,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatStore } from "@/store/chatStore";
import type { AttachmentRecord, MessageRecord } from "@/types/chat";

const EMOJI_REACTIONS = ["??", "??", "??", "??", "??"];

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortKey(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export default function ChatApp() {
  const init = useChatStore((state) => state.init);
  const identity = useChatStore((state) => state.identity);
  const unlockedSecretKey = useChatStore((state) => state.unlockedSecretKey);
  const chatKey = useChatStore((state) => state.chatKey);
  const requests = useChatStore((state) => state.requests);
  const chats = useChatStore((state) => state.chats);
  const messages = useChatStore((state) => state.messages);
  const reactions = useChatStore((state) => state.reactions);
  const attachments = useChatStore((state) => state.attachments);
  const typing = useChatStore((state) => state.typing);
  const activeChatId = useChatStore((state) => state.activeChatId);
  const errors = useChatStore((state) => state.errors);

  const createIdentity = useChatStore((state) => state.createIdentity);
  const unlockIdentity = useChatStore((state) => state.unlockIdentity);
  const exportIdentity = useChatStore((state) => state.exportIdentity);
  const importIdentity = useChatStore((state) => state.importIdentity);
  const setActiveChat = useChatStore((state) => state.setActiveChat);
  const sendChatRequest = useChatStore((state) => state.sendChatRequest);
  const respondToRequest = useChatStore((state) => state.respondToRequest);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const sendReaction = useChatStore((state) => state.sendReaction);
  const sendEdit = useChatStore((state) => state.sendEdit);
  const sendDelete = useChatStore((state) => state.sendDelete);
  const sendTyping = useChatStore((state) => state.sendTyping);
  const sendAttachment = useChatStore((state) => state.sendAttachment);
  const createGroup = useChatStore((state) => state.createGroup);
  const rekeySession = useChatStore((state) => state.rekeySession);
  const backupData = useChatStore((state) => state.backupData);
  const restoreData = useChatStore((state) => state.restoreData);

  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [identityModalOpen, setIdentityModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);

  const [passphrase, setPassphrase] = useState("");
  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const [chatKeyInput, setChatKeyInput] = useState("");
  const [introText, setIntroText] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState("");
  const [composerText, setComposerText] = useState("");
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [editMessageId, setEditMessageId] = useState<string | null>(null);
  const [importPayload, setImportPayload] = useState("");
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [backupPayload, setBackupPayload] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restorePayload, setRestorePayload] = useState("");
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scannerRef = useRef<any>(null);

  const mustCreate = !identity;
  const mustUnlock = Boolean(identity) && !unlockedSecretKey;
  const activeChat = chats.find((chat) => chat.id === activeChatId) || null;
  const canSend = Boolean(activeChat?.accepted);
  const activeMessages = activeChatId ? messages[activeChatId] || [] : [];
  const messageMap = useMemo(() => {
    return new Map(activeMessages.map((message) => [message.id, message]));
  }, [activeMessages]);

  const sortedChats = useMemo(() => {
    return [...chats].sort((a, b) => {
      const aTime = a.lastMessageAt || a.createdAt;
      const bTime = b.lastMessageAt || b.createdAt;
      return bTime - aTime;
    });
  }, [chats]);

  const incomingRequests = useMemo(() => {
    return requests.filter(
      (request) => request.toPubKey === chatKey && request.status === "pending",
    );
  }, [requests, chatKey]);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (mustCreate || mustUnlock) {
      setIdentityModalOpen(true);
    }
  }, [mustCreate, mustUnlock]);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("theme") : null;
    if (stored === "dark" || stored === "light") {
      setTheme(stored);
    } else if (typeof window !== "undefined") {
      setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!chatKey) {
      setQrCode(null);
      return;
    }
    QRCode.toDataURL(chatKey, { margin: 1, width: 220 })
      .then((url) => setQrCode(url))
      .catch(() => setQrCode(null));
  }, [chatKey]);

  useEffect(() => {
    setComposerText("");
    setReplyToId(null);
    setEditMessageId(null);
  }, [activeChatId]);

  useEffect(() => {
    if (!scanOpen) {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => null);
        scannerRef.current.clear().catch(() => null);
        scannerRef.current = null;
      }
      return;
    }
    let active = true;
    (async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (!active) {
        return;
      }
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        (decodedText: string) => {
          setChatKeyInput(decodedText);
          setScanOpen(false);
        },
        () => undefined,
      );
    })();
    return () => {
      active = false;
    };
  }, [scanOpen]);

  const handleSend = async () => {
    if (!activeChatId || !composerText.trim()) {
      return;
    }
    if (editMessageId) {
      await sendEdit(activeChatId, editMessageId, composerText.trim());
      setEditMessageId(null);
      setComposerText("");
      return;
    }
    await sendMessage(activeChatId, composerText.trim(), replyToId || undefined);
    setComposerText("");
    setReplyToId(null);
  };

  const handleTyping = (value: string) => {
    setComposerText(value);
    if (!activeChatId) {
      return;
    }
    if (typingTimeout.current) {
      clearTimeout(typingTimeout.current);
    }
    sendTyping(activeChatId, true).catch(() => null);
    typingTimeout.current = setTimeout(() => {
      sendTyping(activeChatId, false).catch(() => null);
    }, 1500);
  };

  const handleAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeChatId) {
      return;
    }
    await sendAttachment(activeChatId, file);
    event.target.value = "";
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen px-4 py-6">
        <div className="mx-auto flex h-[calc(100vh-3rem)] w-full max-w-6xl gap-4">
          <aside
            className={`flex w-full max-w-md flex-col gap-4 rounded-[32px] border border-border bg-background/90 p-5 shadow-lg ${
              activeChatId ? "hidden md:flex" : "flex"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  True Serverless
                </p>
                <h1 className="text-xl font-semibold">Web3 Live Chat</h1>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => setNewChatOpen(true)}>
                  <MessageCircle className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setNewGroupOpen(true)}>
                  <Users className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)}>
                  <Settings2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                >
                  <Shield className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="rounded-[24px] border border-border bg-muted/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">Your Chat Key</p>
                  <p className="font-mono text-sm">{chatKey ? shortKey(chatKey) : "Locked"}</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
                  <KeyRound className="h-4 w-4" />
                  Manage
                </Button>
              </div>
            </div>
            <Tabs defaultValue="chats" className="flex flex-1 flex-col">
              <TabsList className="w-full">
                <TabsTrigger value="chats" className="flex-1">
                  Chats
                </TabsTrigger>
                <TabsTrigger value="requests" className="flex-1">
                  Requests
                </TabsTrigger>
              </TabsList>
              <TabsContent value="chats" className="flex-1">
                <ScrollArea className="h-[calc(100vh-20rem)] pr-3">
                  <div className="flex flex-col gap-3">
                    {sortedChats.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                        No chats yet. Send a request to start.
                      </div>
                    )}
                    {sortedChats.map((chat) => {
                      const lastMessage = (messages[chat.id] || []).slice(-1)[0];
                      return (
                        <button
                          key={chat.id}
                          onClick={() => setActiveChat(chat.id)}
                          className={`flex w-full items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3 text-left transition hover:bg-muted/40 ${
                            activeChatId === chat.id ? "bg-muted/60" : "bg-background/80"
                          }`}
                        >
                          <div>
                            <p className="text-sm font-semibold">{chat.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {lastMessage?.body
                                ? lastMessage.body.slice(0, 42)
                                : chat.kind === "group"
                                  ? "Group chat"
                                  : "Start the conversation"}
                            </p>
                          </div>
                          {chat.unreadCount ? (
                            <Badge variant="secondary">{chat.unreadCount}</Badge>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </TabsContent>
              <TabsContent value="requests" className="flex-1">
                <ScrollArea className="h-[calc(100vh-20rem)] pr-3">
                  <div className="flex flex-col gap-3">
                    {incomingRequests.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                        No pending requests.
                      </div>
                    )}
                    {incomingRequests.map((request) => (
                      <div
                        key={request.id}
                        className="rounded-2xl border border-border bg-background/80 p-4"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold">
                              {request.kind === "group" ? request.groupName : shortKey(request.fromPubKey)}
                            </p>
                            <p className="text-xs text-muted-foreground">{request.intro}</p>
                          </div>
                          <Badge variant="outline">{request.kind.toUpperCase()}</Badge>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => respondToRequest(request.id, "accepted")}>
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => respondToRequest(request.id, "declined")}
                          >
                            Decline
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => respondToRequest(request.id, "blocked")}
                          >
                            Block
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </aside>

          <main
            className={`flex flex-1 flex-col rounded-[32px] border border-border bg-background/90 p-5 shadow-lg ${
              activeChatId ? "flex" : "hidden md:flex"
            }`}
          >
            {!activeChat && (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <div className="rounded-full bg-muted/60 p-4">
                  <MessageCircle className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-lg font-semibold">Start a new conversation</p>
                  <p className="text-sm text-muted-foreground">
                    Share your Chat Key, scan a QR, or accept a request to begin.
                  </p>
                </div>
                <Button onClick={() => setNewChatOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New Chat
                </Button>
              </div>
            )}

            {activeChat && (
              <>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="md:hidden"
                      onClick={() => setActiveChat(null)}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                      <p className="text-base font-semibold">{activeChat.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {activeChat.kind === "group"
                          ? `${activeChat.participants.length} members`
                          : shortKey(activeChat.participants.find((key) => key !== chatKey) || "")}
                      </p>
                      {activeChatId && typing[activeChatId] && (
                        <p className="text-xs text-primary">
                          {Object.entries(typing[activeChatId])
                            .filter(([, value]) => value)
                            .map(([key]) => shortKey(key))
                            .join(", ") || ""}
                          {Object.values(typing[activeChatId]).some(Boolean)
                            ? " typing..."
                            : ""}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => rekeySession(activeChat.id)}>
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Rekey session</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <Separator className="my-4" />
                <ScrollArea className="flex-1 pr-3">
                  <div className="flex flex-col gap-4">
                    {activeMessages.map((message) => {
                      const isMine = message.fromPubKey === chatKey;
                      const messageReactions = reactions[message.id] || [];
                      const attachment = message.attachmentId
                        ? attachments[message.attachmentId]
                        : undefined;
                      const replyMessage = message.replyTo ? messageMap.get(message.replyTo) : undefined;
                      return (
                        <MessageBubble
                          key={message.id}
                          message={message}
                          isMine={isMine}
                          reactions={messageReactions}
                          attachment={attachment}
                          replyMessage={replyMessage}
                          onReply={() => {
                            setReplyToId(message.id);
                            setEditMessageId(null);
                          }}
                          onEdit={() => {
                            setEditMessageId(message.id);
                            setReplyToId(null);
                            setComposerText(message.body || "");
                          }}
                          onDelete={() => sendDelete(activeChat.id, message.id)}
                          onReact={(emoji) => sendReaction(activeChat.id, message.id, emoji)}
                          onRekey={() => rekeySession(activeChat.id)}
                        />
                      );
                    })}
                  </div>
                </ScrollArea>
                <div className="mt-4 rounded-[24px] border border-border bg-muted/30 p-4">
                  {(replyToId || editMessageId) && (
                    <div className="mb-3 flex items-center justify-between rounded-2xl bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                      <span>
                        {editMessageId
                          ? "Editing message"
                          : `Replying to ${messageMap.get(replyToId || "")?.body || "message"}`}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setReplyToId(null);
                          setEditMessageId(null);
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  )}
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <label
                        className={`cursor-pointer ${canSend ? "" : "pointer-events-none opacity-50"}`}
                      >
                        <input type="file" className="hidden" onChange={handleAttachment} />
                        <div className="rounded-full border border-border p-2 hover:bg-muted/60">
                          <ImagePlus className="h-4 w-4" />
                        </div>
                      </label>
                      <div className="flex-1">
                        <Input
                          value={composerText}
                          onChange={(event) => handleTyping(event.target.value)}
                          placeholder={canSend ? "Write a message" : "Accept request to chat"}
                          disabled={!canSend}
                        />
                      </div>
                      <Button onClick={handleSend} disabled={!canSend}>
                        <Send className="h-4 w-4" />
                        Send
                      </Button>
                    </div>
                    {errors.length > 0 && (
                      <div className="text-xs text-destructive">
                        {errors[errors.length - 1]}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </main>
        </div>

        <Dialog
          open={identityModalOpen}
          onOpenChange={(open) => {
            if (mustCreate || mustUnlock) {
              setIdentityModalOpen(true);
            } else {
              setIdentityModalOpen(open);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {mustCreate ? "Create your identity" : "Unlock your identity"}
              </DialogTitle>
              <DialogDescription>
                {mustCreate
                  ? "Set a passphrase to encrypt your secret key on this device."
                  : "Enter your passphrase to decrypt the local secret key."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {mustCreate ? (
                <Input
                  type="password"
                  placeholder="Create passphrase"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                />
              ) : (
                <Input
                  type="password"
                  placeholder="Passphrase"
                  value={unlockPassphrase}
                  onChange={(event) => setUnlockPassphrase(event.target.value)}
                />
              )}
            </div>
            <DialogFooter>
              {mustCreate ? (
                <Button
                  onClick={async () => {
                    if (!passphrase.trim()) {
                      return;
                    }
                    await createIdentity(passphrase.trim());
                    setPassphrase("");
                    setIdentityModalOpen(false);
                  }}
                >
                  <Lock className="h-4 w-4" />
                  Create Identity
                </Button>
              ) : (
                <Button
                  onClick={async () => {
                    if (!unlockPassphrase.trim()) {
                      return;
                    }
                    const ok = await unlockIdentity(unlockPassphrase.trim());
                    if (ok) {
                      setUnlockPassphrase("");
                      setIdentityModalOpen(false);
                    }
                  }}
                >
                  <KeyRound className="h-4 w-4" />
                  Unlock
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New chat request</DialogTitle>
              <DialogDescription>
                Paste a Chat Key or scan a QR to request a new conversation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="Recipient Chat Key"
                value={chatKeyInput}
                onChange={(event) => setChatKeyInput(event.target.value)}
              />
              <Textarea
                placeholder="Intro message"
                value={introText}
                onChange={(event) => setIntroText(event.target.value)}
              />
              <Button variant="secondary" onClick={() => setScanOpen(true)}>
                <QrCode className="h-4 w-4" />
                Scan QR
              </Button>
            </div>
            <DialogFooter>
              <Button
                onClick={async () => {
                  if (!chatKeyInput.trim()) {
                    return;
                  }
                  await sendChatRequest(chatKeyInput.trim(), introText.trim() || "Hello!");
                  setChatKeyInput("");
                  setIntroText("");
                  setNewChatOpen(false);
                }}
              >
                Send Request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={newGroupOpen} onOpenChange={setNewGroupOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create group</DialogTitle>
              <DialogDescription>
                Add Chat Keys for members, one per line.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="Group name"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
              />
              <Textarea
                placeholder="Chat Keys (one per line)"
                value={groupMembers}
                onChange={(event) => setGroupMembers(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                onClick={async () => {
                  const members = groupMembers
                    .split(/\n+/)
                    .map((entry) => entry.trim())
                    .filter(Boolean);
                  if (!groupName.trim() || members.length === 0) {
                    return;
                  }
                  await createGroup(groupName.trim(), members);
                  setGroupName("");
                  setGroupMembers("");
                  setNewGroupOpen(false);
                }}
              >
                Create Group
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={scanOpen} onOpenChange={setScanOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Scan Chat Key QR</DialogTitle>
              <DialogDescription>
                Point your camera at a QR code to capture the Chat Key.
              </DialogDescription>
            </DialogHeader>
            <div id="qr-reader" className="h-[280px] w-full overflow-hidden rounded-2xl border" />
          </DialogContent>
        </Dialog>

        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Identity & Backup</DialogTitle>
              <DialogDescription>
                Manage your Chat Key, export identity, and backup local data.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-muted/40 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Chat Key</p>
                    <p className="font-mono text-sm">{chatKey || "Locked"}</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => chatKey && navigator.clipboard.writeText(chatKey)}
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                </div>
                {qrCode && (
                  <div className="mt-4 flex justify-center">
                    <img src={qrCode} alt="Chat Key QR" className="h-40 w-40 rounded-2xl" />
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-border bg-background/70 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Export Identity</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      const payload = await exportIdentity();
                      setImportPayload(payload);
                    }}
                  >
                    <FileUp className="h-4 w-4" />
                    Export
                  </Button>
                </div>
                <Textarea
                  className="mt-3"
                  placeholder="Paste identity JSON here"
                  value={importPayload}
                  onChange={(event) => setImportPayload(event.target.value)}
                />
                <Button
                  className="mt-3"
                  variant="secondary"
                  onClick={async () => {
                    if (!importPayload.trim()) {
                      return;
                    }
                    await importIdentity(importPayload.trim());
                    setIdentityModalOpen(true);
                  }}
                >
                  <FileDown className="h-4 w-4" />
                  Import Identity
                </Button>
              </div>
              <Button variant="outline" onClick={() => setBackupOpen(true)}>
                Backup / Restore
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={backupOpen} onOpenChange={setBackupOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Encrypted Backup</DialogTitle>
              <DialogDescription>
                Export or restore all local data using a backup passphrase.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-background/70 p-4">
                <p className="text-sm font-semibold">Create backup</p>
                <Input
                  className="mt-2"
                  placeholder="Backup passphrase"
                  type="password"
                  value={backupPassphrase}
                  onChange={(event) => setBackupPassphrase(event.target.value)}
                />
                <Button
                  className="mt-3"
                  onClick={async () => {
                    if (!backupPassphrase.trim()) {
                      return;
                    }
                    const payload = await backupData(backupPassphrase.trim());
                    setBackupPayload(payload);
                  }}
                >
                  Generate Backup
                </Button>
                <Textarea
                  className="mt-3"
                  placeholder="Encrypted backup payload"
                  value={backupPayload}
                  onChange={(event) => setBackupPayload(event.target.value)}
                />
              </div>
              <Separator />
              <div className="rounded-2xl border border-border bg-background/70 p-4">
                <p className="text-sm font-semibold">Restore backup</p>
                <Input
                  className="mt-2"
                  placeholder="Backup passphrase"
                  type="password"
                  value={restorePassphrase}
                  onChange={(event) => setRestorePassphrase(event.target.value)}
                />
                <Textarea
                  className="mt-3"
                  placeholder="Paste encrypted backup JSON"
                  value={restorePayload}
                  onChange={(event) => setRestorePayload(event.target.value)}
                />
                <Button
                  className="mt-3"
                  variant="destructive"
                  onClick={async () => {
                    if (!restorePassphrase.trim() || !restorePayload.trim()) {
                      return;
                    }
                    await restoreData(restorePayload.trim(), restorePassphrase.trim());
                    setRestorePassphrase("");
                    setRestorePayload("");
                    setBackupOpen(false);
                  }}
                >
                  Restore Backup
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

interface MessageBubbleProps {
  message: MessageRecord;
  isMine: boolean;
  reactions: Array<{ emoji: string; fromPubKey: string }>;
  attachment?: AttachmentRecord;
  replyMessage?: MessageRecord;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  onRekey: () => void;
}

function MessageBubble({
  message,
  isMine,
  reactions,
  attachment,
  replyMessage,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onRekey,
}: MessageBubbleProps) {
  if (message.type === "system") {
    return (
      <div className="mx-auto w-fit rounded-full border border-dashed border-border px-4 py-2 text-xs text-muted-foreground">
        {message.body}
        {message.keyMismatch && (
          <Button className="ml-2" size="sm" variant="secondary" onClick={onRekey}>
            Rekey
          </Button>
        )}
      </div>
    );
  }

  const reactionSummary = reactions.reduce<Record<string, number>>((acc, item) => {
    acc[item.emoji] = (acc[item.emoji] || 0) + 1;
    return acc;
  }, {});

  const statusIcon = message.status === "delivered" ? (
    <CheckCheck className="h-3 w-3" />
  ) : (
    <Check className="h-3 w-3" />
  );

  const attachmentUrl = attachment?.data
    ? `data:${attachment.mime};base64,${attachment.data}`
    : null;

  return (
    <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[75%] space-y-2`}>
        <div
          className={`rounded-3xl px-4 py-3 shadow-sm ${
            isMine
              ? "bg-primary text-primary-foreground"
              : "bg-muted/70 text-foreground"
          }`}
        >
          {replyMessage && (
            <div className="mb-2 rounded-2xl bg-background/20 px-3 py-2 text-xs">
              {replyMessage.body || "Message"}
            </div>
          )}
          {message.deleted ? (
            <p className="text-sm italic opacity-70">Message deleted</p>
          ) : message.type === "attachment_meta" ? (
            <div>
              <p className="text-sm font-semibold">{message.body}</p>
              {attachmentUrl ? (
                <a
                  className="mt-2 inline-flex items-center gap-2 text-xs underline"
                  href={attachmentUrl}
                  download={attachment?.name || "attachment"}
                >
                  <FileDown className="h-3 w-3" />
                  Download
                </a>
              ) : (
                <p className="text-xs opacity-70">Receiving attachment...</p>
              )}
            </div>
          ) : (
            <p className="text-sm">{message.body}</p>
          )}
          <div className="mt-2 flex items-center justify-between text-[11px] opacity-70">
            <span>
              {formatTime(message.timestamp)}
              {message.edited ? " (edited)" : ""}
            </span>
            {isMine && statusIcon}
          </div>
        </div>
        {Object.keys(reactionSummary).length > 0 && (
          <div className="flex flex-wrap gap-1 text-xs">
            {Object.entries(reactionSummary).map(([emoji, count]) => (
              <span key={emoji} className="rounded-full bg-muted/70 px-2 py-0.5">
                {emoji} {count}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {EMOJI_REACTIONS.map((emoji, index) => (
              <button
                key={`${emoji}-${index}`}
                className="rounded-full border border-border px-2 py-0.5 text-xs"
                onClick={() => onReact(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={onReply}>
            Reply
          </Button>
          {isMine && (
            <>
              <Button size="sm" variant="ghost" onClick={onEdit}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={onDelete}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
