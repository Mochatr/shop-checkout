import { useState } from 'react';
import { isValidWallet } from '../solana';
import { UseBrowserWalletButton } from '../components/WalletButtons';
import { LoyaltySettings } from '../components/Loyalty';

// First-run guide: 1) shop name, 2) where payments go, 3) loyalty stamps (optional).
export default function Onboarding({ shop, rewardsSigner, onRewardsSigner, onUpdateShop, onFinish }) {
  const [step, setStep] = useState(shop?.wallet ? 3 : shop?.name ? 2 : 1);
  const [name, setName] = useState(shop?.name || '');
  const [wallet, setWallet] = useState(shop?.wallet || '');
  const walletOk = isValidWallet(wallet);

  return (
    <div className="card">
      <div className="progress" aria-label={`Step ${step} of 3`}>
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= step ? 'on' : ''} />
        ))}
      </div>

      {step === 1 && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            onUpdateShop({ name: name.trim() });
            setStep(2);
          }}
        >
          <p className="eyebrow">Step 1 of 3</p>
          <h1>What's your shop called?</h1>
          <p className="muted">Customers see this name in their wallet when they pay.</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Brew coffee" autoFocus />
          <button className="primary" disabled={!name.trim()}>Continue</button>
        </form>
      )}

      {step === 2 && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!walletOk) return;
            onUpdateShop({ wallet: wallet.trim() });
            setStep(3);
          }}
        >
          <p className="eyebrow">Step 2 of 3</p>
          <h1>Where should payments go?</h1>
          <p className="muted">
            Money goes straight to your Solana wallet, with no bank and no card fees. Connect your wallet or paste its
            address.
          </p>
          <UseBrowserWalletButton onAddress={setWallet} className="primary" />
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="Wallet address"
            spellCheck={false}
            className="mono"
          />
          {wallet && !walletOk && <p className="error">That doesn't look like a Solana address.</p>}
          <button className="primary" disabled={!walletOk}>Continue</button>
          <p className="hint">
            No wallet yet? Install the <a href="https://phantom.com" target="_blank" rel="noreferrer">Phantom</a>{' '}
            browser extension, then turn on Settings → Developer Settings → Testnet Mode (Solana Devnet).
          </p>
          <button type="button" className="link" onClick={() => setStep(1)}>← Back</button>
        </form>
      )}

      {step === 3 && (
        <div className="stack">
          <p className="eyebrow">Step 3 of 3 · optional</p>
          <h1>Reward your regulars</h1>
          <LoyaltySettings
            shop={shop}
            rewardsSigner={rewardsSigner}
            onRewardsSigner={onRewardsSigner}
            onUpdateShop={onUpdateShop}
            onSkip={onFinish}
          />
        </div>
      )}
    </div>
  );
}
