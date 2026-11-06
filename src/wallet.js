// Lets the app talk to a browser wallet extension (e.g. Phantom for Chrome)
// through the "Wallet Standard" — the common interface Solana wallets expose to web pages.
import { getWallets } from '@wallet-standard/app';
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase58Decoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  AccountRole,
} from '@solana/kit';
import {
  fetchMint,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { createTransfer } from '@solana/pay';
import { CURRENCIES, NETWORK, rpc } from './solana';

const CHAIN = `solana:${NETWORK}`;

// Find installed wallets that can sign & send Solana transactions.
export function findBrowserWallets() {
  return getWallets()
    .get()
    .filter((w) => 'standard:connect' in w.features && 'solana:signAndSendTransaction' in w.features);
}

// Ask the wallet for permission to see the user's address (opens the wallet popup).
export async function connectWallet(wallet) {
  const { accounts } = await wallet.features['standard:connect'].connect();
  if (!accounts.length) throw new Error('No account was shared by the wallet');
  return accounts[0]; // .address is the base58 wallet address
}

// Build the payment transaction for a sale, then have the wallet sign & send it.
export async function payWithBrowserWallet({ wallet, account, recipient, amount, currency, reference }) {
  const payer = createNoopSigner(address(account.address)); // the wallet does the real signing
  const instructions = await buildPaymentInstructions({
    payer,
    recipient: address(recipient),
    amount,
    currency,
    reference,
  });

  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(payer.address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const bytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));

  const [result] = await wallet.features['solana:signAndSendTransaction'].signAndSendTransaction({
    account,
    transaction: bytes,
    chain: CHAIN,
  });
  return getBase58Decoder().decode(result.signature);
}

async function buildPaymentInstructions({ payer, recipient, amount, currency, reference }) {
  const mint = CURRENCIES[currency].mint;
  if (!mint) {
    // SOL: the official Solana Pay helper builds the transfer + reference for us.
    return createTransfer(rpc, payer, { recipient, amount, reference });
  }

  // USDC (an SPL token). Tokens live in "token accounts" owned by each wallet.
  // If the shop has never received USDC, its token account doesn't exist yet,
  // so we create it first (the customer pays the tiny rent for it).
  const { data: mintInfo } = await fetchMint(rpc, mint);
  const [source] = await findAssociatedTokenPda({ owner: payer.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const createShopAccount = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer,
    owner: recipient,
    mint,
  });
  const destination = createShopAccount.accounts[1].address;

  const transfer = getTransferCheckedInstruction({
    source,
    mint,
    destination,
    authority: payer,
    amount: BigInt(Math.round(amount * 10 ** mintInfo.decimals)),
    decimals: mintInfo.decimals,
  });
  // Attach the sale's reference so the register can find this payment.
  const transferWithReference = {
    ...transfer,
    accounts: [...transfer.accounts, { address: reference, role: AccountRole.READONLY }],
  };
  // The transfer must be the LAST instruction for Solana Pay validation.
  return [createShopAccount, transferWithReference];
}
