import { useEffect, useState } from 'react';
import {
  STAMPS_FOR_REWARD,
  awardStamp,
  createRewardsSigner,
  createStampToken,
  getSolBalance,
  getStampBalance,
} from '../loyalty';
import { explorerAddressUrl } from '../solana';
import { connectWallet, findBrowserWallets, sendSolWithBrowserWallet } from '../wallet';
import { friendlyError, load, save, short } from '../storage';

const MIN_REWARDS_SOL = 0.01; // enough for a few stamp transactions
const TOP_UP_SOL = 0.1;

// Settings panel: set up the rewards key, fund it, create the stamp token.
export function LoyaltySettings({ shop, rewardsSigner, onRewardsSigner, onUpdateShop, onSkip }) {
  const [balance, setBalance] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const wallets = findBrowserWallets();

  const refresh = () => {
    if (rewardsSigner) getSolBalance(rewardsSigner.address).then(setBalance).catch(() => setBalance(null));
  };
  useEffect(refresh, [rewardsSigner]);

  async function run(label, fn) {
    setError('');
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setError(friendlyError(e));
    } finally {
      setBusy('');
    }
  }

  const topUp = () =>
    run('Approve in your wallet…', async () => {
      const account = await connectWallet(wallets[0]);
      await sendSolWithBrowserWallet({ wallet: wallets[0], account, to: rewardsSigner.address, sol: TOP_UP_SOL });
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const b = await getSolBalance(rewardsSigner.address);
        setBalance(b);
        if (b >= MIN_REWARDS_SOL) break;
      }
    });

  const lowFunds = balance !== null && balance < MIN_REWARDS_SOL;
  const step = !rewardsSigner ? 1 : !shop.stampMint && (balance === null || lowFunds) ? 2 : !shop.stampMint ? 3 : 4;

  const fundingRow = rewardsSigner && (
    <div className="subtle">
      <div className="kv">
        <span>Rewards key</span>
        <a href={explorerAddressUrl(rewardsSigner.address)} target="_blank" rel="noreferrer" className="mono">
          {short(rewardsSigner.address)}
        </a>
      </div>
      <div className="kv">
        <span>Balance</span>
        <span>
          {balance === null ? '…' : `${balance.toFixed(4)} SOL`}{' '}
          <button className="link" onClick={refresh}>refresh</button>
        </span>
      </div>
      {lowFunds && (
        <>
          <p className="hint">
            The rewards key pays the tiny network fee for each stamp. Top it up with {TOP_UP_SOL} test SOL from your
            wallet.
          </p>
          {wallets.length ? (
            <button className="secondary" onClick={topUp} disabled={!!busy}>
              {busy || `Send ${TOP_UP_SOL} SOL from ${wallets[0].name}`}
            </button>
          ) : (
            <p className="hint">Send it to the address above from any devnet wallet.</p>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="stack">
      <p className="muted">
        Every paid purchase earns the customer <strong>1 stamp</strong>, sent automatically to their wallet.{' '}
        <strong>{STAMPS_FOR_REWARD} stamps = a free coffee.</strong> Stamps are a real token the customer owns.
      </p>

      {step < 4 && (
        <ol className="steps">
          <li className={step > 1 ? 'done' : step === 1 ? 'current' : ''}>Create a rewards key</li>
          <li className={step > 2 ? 'done' : step === 2 ? 'current' : ''}>Fund it with a little test SOL</li>
          <li className={step === 3 ? 'current' : ''}>Create your stamp token</li>
        </ol>
      )}

      {step === 1 && (
        <button
          className="primary"
          onClick={() => run('Creating…', async () => onRewardsSigner(await createRewardsSigner()))}
        >
          Set up loyalty stamps
        </button>
      )}

      {fundingRow}

      {step === 3 && (
        <button
          className="primary"
          disabled={!!busy}
          onClick={() =>
            run('Creating your stamp token…', async () => {
              const { mint } = await createStampToken({
                signer: rewardsSigner,
                shopName: shop.name,
                metadataUri: new URL('stamp-metadata.json', window.location.href).href,
              });
              onUpdateShop({ stampMint: mint });
              refresh();
            })
          }
        >
          {busy || `Create "${shop.name} Stamps"`}
        </button>
      )}

      {step === 4 && (
        <div className="kv">
          <span>✅ Stamp token</span>
          <a href={explorerAddressUrl(shop.stampMint)} target="_blank" rel="noreferrer" className="mono">
            {short(shop.stampMint)} ↗
          </a>
        </div>
      )}
      {shop.stampMint && !rewardsSigner && (
        <p className="error">
          This browser doesn't have the rewards key that created these stamps, so it can't send new ones.
        </p>
      )}

      {busy && step !== 3 && <p className="hint">{busy}</p>}
      {error && <p className="error">{error}</p>}
      {onSkip && step < 4 && (
        <button className="link" onClick={onSkip}>
          Skip for now
        </button>
      )}
      {onSkip && step === 4 && (
        <button className="primary" onClick={onSkip}>
          Open the register
        </button>
      )}
    </div>
  );
}

// Remembers which sales already got their stamp, so a stamp is never sent twice.
const awarded = new Set(load('awardedStamps', []));

// Shown on the "Paid" screen: sends the customer their stamp and shows their progress.
export function StampReward({ shop, signature, customer, rewardsSigner }) {
  const [state, setState] = useState({ status: 'sending' });

  useEffect(() => {
    if (!customer || customer === shop.wallet) {
      setState({ status: 'skipped' });
      return;
    }
    if (!rewardsSigner) {
      setState({ status: 'error', message: 'No rewards key in this browser.' });
      return;
    }
    if (awarded.has(signature)) return;
    awarded.add(signature);
    save('awardedStamps', [...awarded].slice(-200));

    (async () => {
      await awardStamp({ signer: rewardsSigner, mint: shop.stampMint, customer });
      const stamps = await getStampBalance(shop.stampMint, customer);
      setState({ status: 'sent', stamps });
    })().catch((e) => {
      console.error(e);
      setState({ status: 'error', message: friendlyError(e) });
    });
  }, [signature, customer, rewardsSigner, shop.stampMint, shop.wallet]);

  if (state.status === 'skipped') return null;
  if (state.status === 'sending') return <p className="hint">Sending a loyalty stamp…</p>;
  if (state.status === 'error') return <p className="error">Stamp not sent: {state.message}</p>;
  return <StampCard stamps={state.stamps} customer={customer} />;
}

export function StampCard({ stamps, customer }) {
  const progress = Math.min(stamps, STAMPS_FOR_REWARD);
  return (
    <div className="stamps">
      <p>
        <strong>+1 stamp</strong> for <span className="mono">{short(customer)}</span>
      </p>
      <div className="stamp-row" role="img" aria-label={`${progress} of ${STAMPS_FOR_REWARD} stamps`}>
        {Array.from({ length: STAMPS_FOR_REWARD }, (_, i) => (
          <span key={i} className={i < progress ? 'stamp on' : 'stamp'}>☕</span>
        ))}
      </div>
      <p className="hint">
        {stamps >= STAMPS_FOR_REWARD
          ? '🎉 Next coffee is free! Use "Redeem free coffee" on the register.'
          : `${stamps} of ${STAMPS_FOR_REWARD}: ${STAMPS_FOR_REWARD - stamps} more for a free coffee`}
      </p>
    </div>
  );
}
