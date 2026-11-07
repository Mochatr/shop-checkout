import { useState } from 'react';
import { connectWallet, findBrowserWallets, payWithBrowserWallet } from '../wallet';
import { friendlyError } from '../storage';

// Fills in an address from a browser wallet extension (e.g. Phantom).
export function UseBrowserWalletButton({ onAddress, label, className = 'secondary' }) {
  const [wallets] = useState(findBrowserWallets);
  const [error, setError] = useState('');
  if (!wallets.length) return null;
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={async () => {
          setError('');
          try {
            const account = await connectWallet(wallets[0]);
            onAddress(account.address);
          } catch (e) {
            setError(friendlyError(e));
          }
        }}
      >
        {label || `Use my ${wallets[0].name} address`}
      </button>
      {error && <p className="error">{error}</p>}
    </>
  );
}

// Lets a customer pay this sale with a browser wallet extension instead of scanning the QR code.
export function BrowserPayButton({ shop, sale }) {
  const [wallets] = useState(findBrowserWallets);
  const [state, setState] = useState('idle'); // idle | busy | sent
  const [error, setError] = useState('');
  if (!wallets.length) {
    return <p className="hint">Install the Phantom browser extension to pay from this computer.</p>;
  }
  const wallet = wallets[0];

  async function pay() {
    setError('');
    setState('busy');
    try {
      const account = await connectWallet(wallet);
      if (account.address === shop.wallet) {
        throw new Error(
          `This ${wallet.name} account is the shop's own wallet. Switch to the customer's account in ${wallet.name} and try again.`,
        );
      }
      await payWithBrowserWallet({
        wallet,
        account,
        recipient: shop.wallet,
        amount: sale.amount,
        currency: sale.currency,
        mint: sale.mint,
        reference: sale.reference,
      });
      setState('sent'); // the register flips to "Paid" once the network confirms it
    } catch (e) {
      console.error(e);
      setError(friendlyError(e));
      setState('idle');
    }
  }

  return (
    <>
      <button className="primary wide" onClick={pay} disabled={state !== 'idle'}>
        {state === 'idle' && `Pay with ${wallet.name}`}
        {state === 'busy' && `Approve in ${wallet.name}…`}
        {state === 'sent' && 'Sent, confirming…'}
      </button>
      {error && <p className="error">{error}</p>}
    </>
  );
}
