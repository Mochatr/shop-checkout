import { useEffect, useRef, useState } from 'react';
import { createQR } from '@solana/pay';
import {
  CURRENCIES,
  NETWORK,
  buildPaymentUrl,
  explorerAddressUrl,
  explorerTxUrl,
  isValidWallet,
  newReference,
  waitForPayment,
} from './solana';
import { connectWallet, findBrowserWallets, payWithBrowserWallet } from './wallet';

// --- Small helpers for saving data in the browser (no server needed) ---
function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the app still works, it just won't remember */
  }
}
const short = (addr) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;

export default function App() {
  const [shop, setShop] = useState(() => load('shop', null)); // { name, wallet }
  const [sale, setSale] = useState(null); // the payment currently on screen
  const [history, setHistory] = useState(() => load('sales', []));

  useEffect(() => save('shop', shop), [shop]);
  useEffect(() => save('sales', history), [history]);

  function recordSale(paidSale) {
    setHistory((h) => [paidSale, ...h].slice(0, 50));
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">☕ {shop?.name || 'Shop Checkout'}</span>
        <span className="badge">{NETWORK}</span>
      </header>

      <main>
        {!shop ? (
          <SetupScreen onSave={setShop} />
        ) : sale ? (
          <PaymentScreen
            shop={shop}
            sale={sale}
            onPaid={recordSale}
            onDone={() => setSale(null)}
          />
        ) : (
          <RegisterScreen
            shop={shop}
            history={history}
            onCharge={setSale}
            onEditShop={() => setShop(null)}
          />
        )}
      </main>
    </div>
  );
}

// 1) First run: the shop owner says where payments should go.
function SetupScreen({ onSave }) {
  const saved = load('shop', null);
  const [name, setName] = useState(saved?.name || '');
  const [wallet, setWallet] = useState(saved?.wallet || '');
  const walletOk = isValidWallet(wallet);

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && walletOk) onSave({ name: name.trim(), wallet: wallet.trim() });
      }}
    >
      <h1>Set up your shop</h1>
      <p className="muted">Customers pay straight to your wallet. No bank, no card fees.</p>

      <label>
        Shop name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Café Atlas" />
      </label>

      <label>
        Your Solana wallet address
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="e.g. 7xKX…9fQ2"
          spellCheck={false}
          className="mono"
        />
      </label>
      {wallet && !walletOk && <p className="error">That doesn't look like a Solana address.</p>}
      <UseBrowserWalletButton onAddress={setWallet} />

      <button className="primary" disabled={!name.trim() || !walletOk}>
        Save and open register
      </button>
      <p className="hint">
        No wallet yet? Install the <a href="https://phantom.com" target="_blank" rel="noreferrer">Phantom</a>{' '}
        browser extension and switch it to Devnet (Settings → Developer Settings → Testnet Mode).
      </p>
    </form>
  );
}

// 2) The register: enter a price, pick a currency, charge.
function RegisterScreen({ shop, history, onCharge, onEditShop }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [currency, setCurrency] = useState('USDC');
  const value = Number(amount);
  const valid = amount !== '' && Number.isFinite(value) && value > 0;

  return (
    <>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onCharge({
            amount: value,
            currency,
            note: note.trim(),
            reference: newReference(),
            createdAt: Date.now(),
          });
        }}
      >
        <h1>New sale</h1>

        <div className="amount-row">
          <input
            className="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
            placeholder="0.00"
            autoFocus
          />
          <div className="toggle">
            {Object.keys(CURRENCIES).map((c) => (
              <button
                type="button"
                key={c}
                className={c === currency ? 'on' : ''}
                onClick={() => setCurrency(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <label>
          <span>
            What's it for? <span className="muted">(optional)</span>
          </span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="2 mint teas" />
        </label>

        <button className="primary" disabled={!valid}>
          Charge {valid ? `${value} ${currency}` : ''}
        </button>
      </form>

      <section className="card">
        <h2>Recent sales</h2>
        {history.length === 0 ? (
          <p className="muted">No sales yet.</p>
        ) : (
          <ul className="sales">
            {history.map((s) => (
              <li key={s.signature}>
                <span>
                  <strong>
                    {s.amount} {s.currency}
                  </strong>{' '}
                  <span className="muted">{s.note}</span>
                </span>
                <a href={explorerTxUrl(s.signature)} target="_blank" rel="noreferrer">
                  {new Date(s.paidAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ↗
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="footer-note">
        Payments go to{' '}
        <a href={explorerAddressUrl(shop.wallet)} target="_blank" rel="noreferrer" className="mono">
          {short(shop.wallet)}
        </a>{' '}
        · <button className="link" onClick={onEditShop}>Change shop settings</button>
      </p>
    </>
  );
}

// 3) Show the QR code and wait until the payment lands on-chain.
function PaymentScreen({ shop, sale, onPaid, onDone }) {
  const [status, setStatus] = useState('waiting'); // waiting | paid | error
  const [signature, setSignature] = useState(null);
  const [error, setError] = useState('');
  const qrRef = useRef(null);

  const url = buildPaymentUrl({
    recipient: shop.wallet,
    amount: sale.amount,
    currency: sale.currency,
    reference: sale.reference,
    shopName: shop.name,
    note: sale.note,
  });

  // Draw the QR code.
  useEffect(() => {
    const el = qrRef.current;
    if (!el) return;
    el.innerHTML = '';
    createQR(url, 300, 'white', '#14121f').append(el);
  }, [url]);

  // Watch the network for this payment.
  useEffect(() => {
    const controller = new AbortController();
    waitForPayment({
      recipient: shop.wallet,
      amount: sale.amount,
      currency: sale.currency,
      reference: sale.reference,
      signal: controller.signal,
    })
      .then((sig) => {
        if (!sig) return; // cancelled
        setSignature(sig);
        setStatus('paid');
        onPaid({ ...sale, signature: sig, paidAt: Date.now() });
      })
      .catch((err) => {
        console.error(err);
        setError(err.message || String(err));
        setStatus('error');
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale.reference]);

  return (
    <div className="card center">
      <p className="muted">{sale.note || `Order at ${shop.name}`}</p>
      <div className="big-amount">
        {sale.amount} <span>{sale.currency}</span>
      </div>

      {status === 'waiting' && (
        <>
          <div ref={qrRef} className="qr" aria-label="Payment QR code" />
          <p className="status">
            <span className="spinner" /> Waiting for payment…
          </p>
          <p className="hint">Scan with a Solana wallet app to pay, or pay from this computer:</p>
          <BrowserPayButton shop={shop} sale={sale} />
          <div className="row">
            <a className="secondary" href={url}>Open in wallet</a>
            <button className="secondary" onClick={() => navigator.clipboard?.writeText(url)}>
              Copy link
            </button>
            <button className="secondary" onClick={onDone}>Cancel</button>
          </div>
        </>
      )}

      {status === 'paid' && (
        <>
          <div className="paid">✓</div>
          <h1>Paid</h1>
          <p>
            <a href={explorerTxUrl(signature)} target="_blank" rel="noreferrer">
              View on Solana Explorer ↗
            </a>
          </p>
          <button className="primary" onClick={onDone}>New sale</button>
        </>
      )}

      {status === 'error' && (
        <>
          <p className="error">
            A payment arrived but didn't match this sale: {error}
          </p>
          <button className="primary" onClick={onDone}>Back to register</button>
        </>
      )}
    </div>
  );
}

// Fills the shop's wallet address from a browser wallet extension (e.g. Phantom).
function UseBrowserWalletButton({ onAddress }) {
  const [wallets] = useState(findBrowserWallets);
  const [error, setError] = useState('');
  if (!wallets.length) return null;
  return (
    <>
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          setError('');
          try {
            const account = await connectWallet(wallets[0]);
            onAddress(account.address);
          } catch (e) {
            setError(e.message || 'Wallet connection was cancelled');
          }
        }}
      >
        Use my {wallets[0].name} address
      </button>
      {error && <p className="error">{error}</p>}
    </>
  );
}

// Lets a customer pay this sale with a browser wallet extension instead of scanning the QR code.
function BrowserPayButton({ shop, sale }) {
  const [wallets] = useState(findBrowserWallets);
  const [state, setState] = useState('idle'); // idle | busy | sent
  const [error, setError] = useState('');
  if (!wallets.length) {
    return <p className="hint">(Install the Phantom browser extension to pay from this computer.)</p>;
  }
  const wallet = wallets[0];

  async function pay() {
    setError('');
    setState('busy');
    try {
      const account = await connectWallet(wallet);
      if (account.address === shop.wallet) {
        throw new Error(
          `This ${wallet.name} account is the shop's own wallet. Switch to a different (customer) account in ${wallet.name} and try again.`,
        );
      }
      await payWithBrowserWallet({
        wallet,
        account,
        recipient: shop.wallet,
        amount: sale.amount,
        currency: sale.currency,
        reference: sale.reference,
      });
      setState('sent'); // the register will flip to "Paid" once the network confirms it
    } catch (e) {
      console.error(e);
      setError(friendlyError(e));
      setState('idle');
    }
  }

  return (
    <>
      <button className="primary" onClick={pay} disabled={state !== 'idle'}>
        {state === 'idle' && `Pay with ${wallet.name}`}
        {state === 'busy' && `Approve in ${wallet.name}…`}
        {state === 'sent' && 'Sent, confirming…'}
      </button>
      {error && <p className="error">{error}</p>}
    </>
  );
}

function friendlyError(e) {
  const msg = e?.message || String(e);
  if (/reject|cancel|denied/i.test(msg)) return 'Payment was cancelled in the wallet.';
  if (/account.*not.*found|AccountNotFound|sender not found|could not find account|insufficient/i.test(msg))
    return "This wallet doesn't have enough of that currency on devnet. Get free test funds from a faucet.";
  return msg;
}
