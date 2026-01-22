# True Serverless Web3 Live Chat

Browser-only, end-to-end encrypted chat over the public Waku network. There is no backend, no database, and no login. All persistence lives locally in IndexedDB.

## Features

- Identity derived from `nacl.box` keypair, secret key encrypted with AES-GCM passphrase
- Chat Key display + QR share/scan
- Mandatory chat request/accept flow before DM
- Per-message symmetric ratchet (HKDF + HMAC) with skipped-key cache
- DM and group chat with per-recipient sealing
- Reactions, reply, edit, delete, typing indicators
- Attachments with chunked encrypted transfer
- Encrypted backup/restore for all local data

## Tech Stack

- Next.js App Router (TypeScript strict)
- TailwindCSS + shadcn/ui + lucide-react
- Zustand state management
- IndexedDB via idb
- Waku light node via `@waku/sdk`
- Crypto via tweetnacl + Web Crypto
- Hashing via keccak256 (viem)
- QR via qrcode + html5-qrcode

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## Usage

1. Create a passphrase to encrypt your secret key locally.
2. Share your Chat Key (base58 public key) or QR with a peer.
3. Send a chat request with an intro message.
4. The recipient accepts to start DM; both subscribe to the DM topic.
5. Create groups by adding Chat Keys and send per-recipient sealed messages.

## Backup & Restore

Open the settings panel and generate an encrypted backup using a passphrase. Keep the backup JSON safe. Restore by pasting the payload and passphrase.

## Networking

- DNS discovery is disabled to avoid DoH blocks; the app uses a static bootstrap list.
- Override bootstrap peers via `NEXT_PUBLIC_WAKU_BOOTSTRAP` (comma-separated multiaddrs).

## Notes

- Waku light node uses the public bootstrap network with relay filter + light push.
- Messages are ephemeral on the network; only local IndexedDB persists history.
- If decryption fails, the UI offers a rekey flow to reset the ratchet.
