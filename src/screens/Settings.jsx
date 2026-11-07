import { useState } from 'react';
import { CURRENCIES, NETWORK, isValidWallet } from '../solana';
import { UseBrowserWalletButton } from '../components/WalletButtons';
import { LoyaltySettings } from '../components/Loyalty';

export default function Settings({ shop, rewardsSigner, onRewardsSigner, onUpdateShop }) {
  const [name, setName] = useState(shop.name);
  const [wallet, setWallet] = useState(shop.wallet);
  const [saved, setSaved] = useState(false);
  const walletOk = isValidWallet(wallet);
  const changed = name.trim() !== shop.name || wallet.trim() !== shop.wallet;

  return (
    <div className="settings">
      <section className="card">
        <h2>Shop</h2>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !walletOk) return;
            onUpdateShop({ name: name.trim(), wallet: wallet.trim() });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
        >
          <label>
            Shop name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Payments go to (your wallet)
            <input
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              spellCheck={false}
              className="mono"
            />
          </label>
          {wallet && !walletOk && <p className="error">That doesn't look like a Solana address.</p>}
          <UseBrowserWalletButton onAddress={setWallet} />
          <button className="primary" disabled={!changed || !name.trim() || !walletOk}>
            {saved ? 'Saved ✓' : 'Save changes'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Default currency</h2>
        <div className="toggle-row" role="radiogroup" aria-label="Default currency">
          {Object.keys(CURRENCIES).map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={(shop.defaultCurrency || 'USDC') === c}
              className={(shop.defaultCurrency || 'USDC') === c ? 'on' : ''}
              onClick={() => onUpdateShop({ defaultCurrency: c })}
            >
              {c}
            </button>
          ))}
        </div>
        <p className="hint">USDC is a digital dollar: prices stay stable. SOL is Solana's own coin.</p>
      </section>

      <section className="card">
        <h2>🎟️ Loyalty stamps</h2>
        <LoyaltySettings
          shop={shop}
          rewardsSigner={rewardsSigner}
          onRewardsSigner={onRewardsSigner}
          onUpdateShop={onUpdateShop}
        />
      </section>

      <section className="card">
        <h2>About</h2>
        <p className="muted">
          Running on Solana <strong>{NETWORK}</strong>, the free test network. Payments use test tokens with no real
          value. Settings and sales history are stored in this browser.
        </p>
      </section>
    </div>
  );
}
