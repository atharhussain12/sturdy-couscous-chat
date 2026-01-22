import { createLightNode, Protocols, waitForRemotePeer } from "@waku/sdk";
import type { IDecoder, IDecodedMessage, LightNode } from "@waku/interfaces";

// Static bootstrap peers to avoid DoH-based DNS discovery.
const DEFAULT_BOOTSTRAP_PEERS = [
  "/dns4/node-01.do-ams3.waku.sandbox.status.im/tcp/8000/wss/p2p/16Uiu2HAmNaeL4p3WEYzC9mgXBmBWSgWjPHRvatZTXnp8Jgv3iKsb",
  "/dns4/node-01.gc-us-central1-a.waku.sandbox.status.im/tcp/8000/wss/p2p/16Uiu2HAmRv1iQ3NoMMcjbtRmKxPuYBbF9nLYz2SDv9MTN8WhGuUU",
  "/dns4/node-01.ac-cn-hongkong-c.waku.sandbox.status.im/tcp/8000/wss/p2p/16Uiu2HAmQYiojgZ8APsh9wqbWNyCstVhnp9gbeNrxSEQnLJchC92",
  "/dns4/node-01.do-ams3.waku.test.statusim.net/tcp/8000/wss/p2p/16Uiu2HAkykgaECHswi3YKJ5dMLbq2kPVCo89fcyTd38UcQD6ej5W",
  "/dns4/node-01.gc-us-central1-a.waku.test.statusim.net/tcp/8000/wss/p2p/16Uiu2HAmDCp8XJ9z1ev18zuv8NHekAsjNyezAvmMfFEJkiharitG",
  "/dns4/node-01.ac-cn-hongkong-c.waku.test.statusim.net/tcp/8000/wss/p2p/16Uiu2HAkzHaTP5JsUwfR9NR8Rj9HC24puS6ocaU8wze4QrXr9iXp",
];

function parseBootstrapPeers(input?: string | null): string[] {
  if (!input) {
    return [];
  }
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

let wakuPromise: Promise<LightNode> | null = null;
const subscriptions = new Map<string, IDecoder<IDecodedMessage>>();

export async function getWakuNode(): Promise<LightNode> {
  if (!wakuPromise) {
    wakuPromise = (async () => {
      const envBootstrap = parseBootstrapPeers(
        process.env.NEXT_PUBLIC_WAKU_BOOTSTRAP,
      );
      const bootstrapPeers =
        envBootstrap.length > 0 ? envBootstrap : DEFAULT_BOOTSTRAP_PEERS;
      const node = await createLightNode({
        defaultBootstrap: false,
        bootstrapPeers,
        discovery: { dns: false, peerExchange: true, peerCache: true },
      });
      await node.start();
      await node.filter.start();
      node.lightPush.start();
      try {
        await waitForRemotePeer(node, [Protocols.Filter, Protocols.LightPush], 15000);
      } catch {
        // Allow offline start; retries happen on demand.
      }
      return node;
    })();
  }
  return wakuPromise;
}

export async function subscribeTopic(
  contentTopic: string,
  handler: (payload: Uint8Array) => void | Promise<void>,
): Promise<void> {
  const node = await getWakuNode();
  const decoder = node.createDecoder({ contentTopic });
  subscriptions.set(contentTopic, decoder);
  const success = await node.filter.subscribe(decoder, async (message) => {
    if (!message?.payload) {
      return;
    }
    await handler(message.payload);
  });
  if (!success) {
    try {
      await waitForRemotePeer(node, [Protocols.Filter], 15000);
    } catch {
      return;
    }
    await node.filter.subscribe(decoder, async (message) => {
      if (!message?.payload) {
        return;
      }
      await handler(message.payload);
    });
  }
}

export async function unsubscribeTopic(contentTopic: string): Promise<void> {
  const node = await getWakuNode();
  const decoder = subscriptions.get(contentTopic);
  if (!decoder) {
    return;
  }
  await node.filter.unsubscribe(decoder);
  subscriptions.delete(contentTopic);
}

export async function publishPayload(
  contentTopic: string,
  payload: Uint8Array,
): Promise<void> {
  const node = await getWakuNode();
  const encoder = node.createEncoder({ contentTopic, ephemeral: true });
  await node.lightPush.send(encoder, { payload, timestamp: new Date() });
}
