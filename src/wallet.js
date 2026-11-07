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
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
  findAssociatedTokenPda,
} from '@solana-program/token';
import { getTransferSolInstruction } from '@solana-program/system';
import { createTransfer } from '@solana/pay';
import { NETWORK, mintFor, rpc } from './solana';

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
export async function payWithBrowserWallet({ wallet, account, recipient, amount, currency, mint, reference }) {
  const payer = createNoopSigner(address(account.address)); // the wallet does the real signing
  const instructions = await buildPaymentInstructions({
    payer,
    recipient: address(recipient),
    amount,
    mint: mintFor(currency, mint),
    reference,
  });
  return signAndSendWithBrowserWallet({ wallet, account, instructions });
}

// Send SOL from the browser wallet (used to top up the shop's rewards key).
export async function sendSolWithBrowserWallet({ wallet, account, to, sol }) {
  const source = createNoopSigner(address(account.address));
  const instructions = [
    getTransferSolInstruction({ source, destination: address(to), amount: BigInt(Math.round(sol * 1e9)) }),
  ];
  return signAndSendWithBrowserWallet({ wallet, account, instructions });
}

async function signAndSendWithBrowserWallet({ wallet, account, instructions }) {
  const feePayer = address(account.address);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
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

async function buildPaymentInstructions({ payer, recipient, amount, mint, reference }) {
  if (!mint) {
    // SOL: the official Solana Pay helper builds the transfer + reference for us.
    return createTransfer(rpc, payer, { recipient, amount, reference });
  }

  // Tokens (USDC, stamps) live in "token accounts" owned by each wallet.
  // If the shop has never received this token, its token account doesn't exist yet,
  // so we create it first (the customer pays the tiny rent for it).
  // Tokens can belong to the classic Token program or Token-2022 (our stamps), so look it up.
  const mintAccount = await rpc.getAccountInfo(mint, { encoding: 'base64' }).send();
  if (!mintAccount.value) throw new Error('Token not found on ' + NETWORK);
  const tokenProgram = mintAccount.value.owner;
  const { value: supply } = await rpc.getTokenSupply(mint).send();
  const decimals = supply.decimals;

  const [source] = await findAssociatedTokenPda({ owner: payer.address, mint, tokenProgram });
  const createShopAccount = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer,
    owner: recipient,
    mint,
    tokenProgram,
  });
  const destination = createShopAccount.accounts[1].address;

  const transfer = getTransferCheckedInstruction(
    {
      source,
      mint,
      destination,
      authority: payer,
      amount: BigInt(Math.round(amount * 10 ** decimals)),
      decimals,
    },
    { programAddress: tokenProgram }, // same instruction layout in both token programs
  );
  // Attach the sale's reference so the register can find this payment.
  const transferWithReference = {
    ...transfer,
    accounts: [...transfer.accounts, { address: reference, role: AccountRole.READONLY }],
  };
  // The transfer must be the LAST instruction for Solana Pay validation.
  return [createShopAccount, transferWithReference];
}
