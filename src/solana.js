// All the Solana-specific logic lives in this file, so the UI code stays simple.
import { address, createSolanaRpc, getAddressDecoder, isAddress } from '@solana/kit';
import {
  encodeURL,
  findReference,
  FindReferenceError,
  validateTransfer,
  ValidateTransferError,
} from '@solana/pay';

// Devnet = Solana's free test network. Switch to mainnet only when going live.
export const NETWORK = 'devnet';
export const RPC_URL = 'https://api.devnet.solana.com';
export const rpc = createSolanaRpc(RPC_URL);

// Currencies the shop accepts. USDC is a dollar-pegged token; SOL is Solana's native coin.
// `mint` is the token's address on devnet (this one is Circle's official devnet USDC).
export const CURRENCIES = {
  USDC: { symbol: 'USDC', mint: address('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU') },
  SOL: { symbol: 'SOL', mint: undefined },
};

export function isValidWallet(value) {
  return isAddress(value.trim());
}

// A "reference" is a random, one-time address attached to a payment.
// The wallet includes it in the transaction, which lets us find exactly this payment on-chain.
export function newReference() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return getAddressDecoder().decode(bytes);
}

// Builds the `solana:` payment link that the QR code contains.
export function buildPaymentUrl({ recipient, amount, currency, reference, shopName, note }) {
  return encodeURL({
    recipient: address(recipient),
    amount,
    splToken: CURRENCIES[currency].mint,
    reference,
    label: shopName,
    message: note || `Order at ${shopName}`,
  }).toString();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Checks the network every 1.5 seconds until a transaction carrying our reference shows up,
// then verifies it paid the right person the right amount. Returns the transaction signature.
export async function waitForPayment({ recipient, amount, currency, reference, signal }) {
  while (!signal.aborted) {
    try {
      const found = await findReference(rpc, reference, { commitment: 'confirmed' });
      try {
        await validateTransfer(
          rpc,
          found.signature,
          { recipient: address(recipient), amount, splToken: CURRENCIES[currency].mint, reference },
          { commitment: 'confirmed' },
        );
      } catch (err) {
        // The official check can't handle a shop's FIRST token payment: its token account is
        // created inside that same transaction, so there's no "before" balance. Check it ourselves.
        if (!(err instanceof ValidateTransferError && err.message === 'missing balance data')) throw err;
        await validateTokenPaymentToNewAccount({ signature: found.signature, recipient, amount, currency, reference });
      }
      return found.signature;
    } catch (err) {
      // "not found" just means the customer hasn't paid yet (or the network is still catching up): keep waiting.
      const notYet =
        err instanceof FindReferenceError ||
        (err instanceof ValidateTransferError && err.message === 'not found');
      if (!notYet) throw err;
    }
    await sleep(1500);
  }
  return null;
}

// Reads the transaction and checks: it succeeded, it carries our reference, and the shop's
// token balance went up by at least the sale amount (a missing "before" balance counts as 0).
export async function validateTokenPaymentToNewAccount({ signature, recipient, amount, currency, reference }) {
  const mint = CURRENCIES[currency].mint;
  if (!mint) throw new ValidateTransferError('missing balance data');
  const tx = await rpc
    .getTransaction(signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
    .send();
  checkTokenPayment(tx, { recipient, amount, mint, reference });
}

// Pure check on a parsed transaction (kept separate so it's easy to test).
export function checkTokenPayment(tx, { recipient, amount, mint, reference }) {
  if (!tx) throw new ValidateTransferError('not found');
  if (tx.meta.err) throw new ValidateTransferError('transaction failed');

  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  if (!keys.includes(reference)) throw new ValidateTransferError('invalid reference');

  const shopBalance = (list) => list?.find((b) => b.owner === recipient && b.mint === mint);
  const post = shopBalance(tx.meta.postTokenBalances);
  if (!post) throw new ValidateTransferError('invalid transfer');
  const pre = shopBalance(tx.meta.preTokenBalances);

  const received = BigInt(post.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount.amount ?? '0');
  const expected = BigInt(Math.round(amount * 10 ** post.uiTokenAmount.decimals));
  if (received < expected) throw new ValidateTransferError('amount not transferred');
}

export function explorerTxUrl(signature) {
  return `https://explorer.solana.com/tx/${signature}?cluster=${NETWORK}`;
}

export function explorerAddressUrl(addr) {
  return `https://explorer.solana.com/address/${addr}?cluster=${NETWORK}`;
}
