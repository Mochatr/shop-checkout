// Loyalty stamps: the shop's own token on Solana.
// 1 stamp per paid purchase, sent automatically; 10 stamps = a free coffee.
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  some,
} from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  extension,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMintInstruction,
  getMintSize,
  getMintToCheckedInstruction,
  getPostInitializeInstructionsForMintExtensions,
  getPreInitializeInstructionsForMintExtensions,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { rpc } from './solana';

export const STAMPS_FOR_REWARD = 10;
const REWARDS_KEY_STORAGE = 'rewardsKey';

// ---------------------------------------------------------------------------
// The "rewards key": a small wallet that lives in the shop's browser and is only
// allowed to create stamps. It lets stamps go out automatically, without popups.
// (Fine for a demo on devnet; a real shop would keep this on a server.)
// ---------------------------------------------------------------------------
export async function loadRewardsSigner() {
  let hex = null;
  try {
    hex = localStorage.getItem(REWARDS_KEY_STORAGE);
  } catch {
    /* storage unavailable */
  }
  if (!hex) return null;
  const bytes = new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
  return createKeyPairSignerFromPrivateKeyBytes(bytes);
}

export async function createRewardsSigner() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(REWARDS_KEY_STORAGE, hex);
  return createKeyPairSignerFromPrivateKeyBytes(bytes);
}

export async function getSolBalance(addr) {
  const { value } = await rpc.getBalance(address(addr), { commitment: 'confirmed' }).send();
  return Number(value) / 1e9;
}

// ---------------------------------------------------------------------------
// Create the stamp token (once per shop). Uses Token-2022, which can store the
// token's name and symbol on-chain so wallets like Phantom display them.
// ---------------------------------------------------------------------------
export async function createStampToken({ signer, shopName, metadataUri }) {
  const mint = await generateKeyPairSigner();
  const instructions = await buildStampTokenInstructions({ payer: signer, mint, shopName, metadataUri });
  const signature = await sendWithSigner(signer, instructions);
  return { mint: mint.address, signature };
}

export async function buildStampTokenInstructions({ payer: signer, mint, shopName, metadataUri }) {
  const metadataPointer = extension('MetadataPointer', {
    authority: some(signer.address),
    metadataAddress: some(mint.address),
  });
  const metadata = extension('TokenMetadata', {
    updateAuthority: some(signer.address),
    mint: mint.address,
    name: `${shopName} Stamps`.slice(0, 32),
    symbol: 'STAMP',
    uri: metadataUri,
    additionalMetadata: new Map(),
  });

  // The account starts with room for the pointer; the metadata step grows it,
  // so we pre-pay rent for the final size.
  const space = getMintSize([metadataPointer]);
  const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(getMintSize([metadataPointer, metadata]))).send();

  return [
    getCreateAccountInstruction({
      payer: signer,
      newAccount: mint,
      lamports: rent,
      space,
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    ...getPreInitializeInstructionsForMintExtensions(mint.address, [metadataPointer]),
    getInitializeMintInstruction({ mint: mint.address, decimals: 0, mintAuthority: signer.address }),
    ...getPostInitializeInstructionsForMintExtensions(mint.address, signer, [metadata]),
  ];
}

// Give one stamp to a customer (creates their stamp account the first time).
export async function awardStamp({ signer, mint, customer }) {
  return sendWithSigner(signer, await buildAwardStampInstructions({ signer, mint, customer }));
}

export async function buildAwardStampInstructions({ signer, mint, customer }) {
  const owner = address(customer);
  const createAccount = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer: signer,
    owner,
    mint: address(mint),
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  const mintTo = getMintToCheckedInstruction({
    mint: address(mint),
    token: createAccount.accounts[1].address, // the customer's stamp account
    mintAuthority: signer,
    amount: 1n,
    decimals: 0,
  });
  return [createAccount, mintTo];
}

export async function getStampBalance(mint, owner) {
  const [ata] = await findAssociatedTokenPda({
    owner: address(owner),
    mint: address(mint),
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  try {
    const { value } = await rpc.getTokenAccountBalance(ata, { commitment: 'confirmed' }).send();
    return Number(value.amount);
  } catch {
    return 0; // no stamp account yet
  }
}

// The customer is whoever paid the transaction fee (the first account).
export async function findPayer(signature) {
  const tx = await rpc
    .getTransaction(signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
    .send();
  return tx?.transaction.message.accountKeys[0].pubkey ?? null;
}

// ---------------------------------------------------------------------------
// Sign with the rewards key, send, and wait until the network confirms.
// ---------------------------------------------------------------------------
async function sendWithSigner(signer, instructions) {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  await rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' })
    .send();

  for (let i = 0; i < 40; i++) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new Error('Transaction failed: ' + JSON.stringify(status.err, bigintSafe));
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return signature;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Timed out waiting for confirmation');
}

const bigintSafe = (_k, v) => (typeof v === 'bigint' ? String(v) : v);
