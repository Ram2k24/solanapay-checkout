import type { Page } from "@playwright/test";
import {
  generateKeyPair,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
  signBytes,
  type Address,
} from "@solana/kit";
import { E2E_RPC_URL } from "./env";

// A Wallet Standard wallet for the browser tests (Phase 14, decision F2). It registers
// the way Phantom does, so the app's real wallet code runs unchanged.
//
// The Ed25519 key pair is created for each test in the test process (non-extractable,
// memory only) and never reaches the browser or the disk: the page gets the public key
// and asks the test process to sign through page.exposeFunction. Like a real wallet,
// "sign and send" signs the transaction and broadcasts it (to the mock RPC).

export const TEST_WALLET_NAME = "E2E Test Wallet";

export type TestWallet = {
  address: string;
  // Make the wallet's next request fail the way a user's "Cancel" does.
  rejectNextRequest(): Promise<void>;
  // Sign the next transaction and report its signature, but never broadcast it: what a
  // lying or broken browser would claim (the server must not believe it).
  skipBroadcastOfNextTransaction(): void;
};

export async function installTestWallet(page: Page): Promise<TestWallet> {
  const keyPair = await generateKeyPair();
  const address = await getAddressFromPublicKey(keyPair.publicKey);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));

  await page.exposeFunction("__e2eWalletSign", async (message: number[]) => {
    const signature = await signBytes(keyPair.privateKey, new Uint8Array(message));
    return Array.from(signature);
  });
  let broadcast = true;
  await page.exposeFunction("__e2eWalletSignAndSend", async (wire: number[]) => {
    const transaction = getTransactionDecoder().decode(new Uint8Array(wire));
    const signed = await partiallySignTransaction([keyPair], transaction);
    if (!broadcast) {
      broadcast = true;
      return Array.from(signed.signatures[address as Address]!);
    }
    const response = await fetch(E2E_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [getBase64EncodedWireTransaction(signed), { encoding: "base64" }] }),
    });
    const body = (await response.json()) as { error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return Array.from(signed.signatures[address as Address]!);
  });
  await page.addInitScript(registerWalletInBrowser, { name: TEST_WALLET_NAME, address, publicKey: Array.from(publicKey) });

  return {
    address,
    skipBroadcastOfNextTransaction() {
      broadcast = false;
    },
    async rejectNextRequest() {
      await page.evaluate(() => {
        (window as unknown as { __e2eWalletReject: boolean }).__e2eWalletReject = true;
      });
    },
  };
}

// Runs in the browser before the app's scripts (serialized by Playwright: it must not
// use anything from this module's scope).
function registerWalletInBrowser({ name, address, publicKey }: { name: string; address: string; publicKey: number[] }) {
  type Listener = (properties: { accounts: unknown[] }) => void;
  const w = window as unknown as {
    __e2eWalletSign(message: number[]): Promise<number[]>;
    __e2eWalletSignAndSend(transaction: number[]): Promise<number[]>;
    __e2eWalletReject?: boolean;
  };
  const CHAIN = "solana:devnet";
  const listeners = new Set<Listener>();
  const account = Object.freeze({
    address,
    publicKey: new Uint8Array(publicKey),
    chains: [CHAIN],
    features: ["solana:signMessage", "solana:signAndSendTransaction"],
  });
  let accounts: (typeof account)[] = [];
  const changed = () => listeners.forEach((listener) => listener({ accounts }));

  // Throws like a wallet whose user pressed "Cancel" (EIP-1193 style code 4001).
  const rejectIfAsked = () => {
    if (!w.__e2eWalletReject) return;
    w.__e2eWalletReject = false;
    throw Object.assign(new Error("User rejected the request."), { code: 4001 });
  };

  const wallet = {
    version: "1.0.0",
    name,
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=",
    chains: [CHAIN],
    get accounts() {
      return accounts;
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        async connect() {
          accounts = [account];
          changed();
          return { accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        async disconnect() {
          accounts = [];
          changed();
        },
      },
      "standard:events": {
        version: "1.0.0",
        on(_event: "change", listener: Listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        async signMessage(...inputs: { account: { address: string }; message: Uint8Array }[]) {
          rejectIfAsked();
          return Promise.all(
            inputs.map(async ({ account: signer, message }) => {
              if (signer.address !== address) throw new Error("Unknown account");
              const signature = new Uint8Array(await w.__e2eWalletSign(Array.from(message)));
              return { signedMessage: message, signature };
            }),
          );
        },
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        async signAndSendTransaction(...inputs: { account: { address: string }; chain: string; transaction: Uint8Array }[]) {
          rejectIfAsked();
          return Promise.all(
            inputs.map(async ({ account: signer, chain, transaction }) => {
              if (signer.address !== address || chain !== CHAIN) throw new Error("Unknown account or chain");
              return { signature: new Uint8Array(await w.__e2eWalletSignAndSend(Array.from(transaction))) };
            }),
          );
        },
      },
    },
  };

  // Wallet Standard registration, both orders: app already loaded, or loading later.
  const register = ({ register }: { register(wallet: unknown): void }) => register(wallet);
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  window.addEventListener("wallet-standard:app-ready", (event) => register((event as CustomEvent).detail));
}
