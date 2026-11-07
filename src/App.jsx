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
import { connectWallet, findBrowserWallets, payWithBrowserWallet, sendSolWithBrowserWallet } from './wallet';
import {
  STAMPS_FOR_REWARD,
  awardStamp,
  createRewardsSigner,
  createStampToken,
  findPayer,
  getSolBalance,
  getStampBalance,
  loadRewardsSigner,
} from './loyalty';

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
  const [shop, setShop] = useState(() => load('shop', null)); // { name, wallet, stampMint? }
  const [editing, setEditing] = useState(false);
  const [sale, setSale] = useState(null); // the payment currently on screen
  const [history, setHistory] = useState(() => load('sales', []));
  const [rewardsSigner, setRewardsSigner] = useState(null); // signs stamp transactions

  useEffect(() => {
    loadRewardsSigner().then(setRewardsSigner).catch(console.error);
  }, []);

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
        {!shop || editing ? (
          <SetupScreen
            shop={shop}
            onSave={(changes) => {
              setShop((old) => ({ ...old, ...changes })); // keeps the stamp token when editing
              setEditing(false);
            }}
          />
        ) : sale ? (
          <PaymentScreen
            shop={shop}
            sale={sale}
            rewardsSigner={rewardsSigner}
            onPaid={recordSale}
            onDone={() => setSale(null)}
          />
        ) : (
          <RegisterScreen
            shop={shop}
            history={history}
            rewardsSigner={rewardsSigner}
            onRewardsSigner={setRewardsSigner}
            onUpdateShop={(changes) => setShop((old) => ({ ...old, ...changes }))}
            onCharge={setSale}
            onEditShop={() => setEditing(true)}
          />
        )}
      </main>
    </div>
  );
}

// 1) First run: the shop owner says where payments should go.
function SetupScreen({ shop: saved, onSave }) {
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
function RegisterScreen({ shop, history, rewardsSigner, onRewardsSigner, onUpdateShop, onCharge, onEditShop }) {
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

      <LoyaltyCard
        shop={shop}
        rewardsSigner={rewardsSigner}
        onRewardsSigner={onRewardsSigner}
        onUpdateShop={onUpdateShop}
        onRedeem={() =>
          onCharge({
            amount: STAMPS_FOR_REWARD,
            currency: 'STAMPS',
            mint: shop.stampMint,
            note: 'Free coffee 🎁',
            reference: newReference(),
            createdAt: Date.now(),
          })
        }
      />

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
function PaymentScreen({ shop, sale, rewardsSigner, onPaid, onDone }) {
  const [status, setStatus] = useState('waiting'); // waiting | paid | error
  const [signature, setSignature] = useState(null);
  const [error, setError] = useState('');
  const qrRef = useRef(null);

  const url = buildPaymentUrl({
    recipient: shop.wallet,
    amount: sale.amount,
    currency: sale.currency,
    mint: sale.mint,
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
      mint: sale.mint,
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
          <h1>{sale.currency === 'STAMPS' ? 'Free coffee redeemed' : 'Paid'}</h1>
          <p>
            <a href={explorerTxUrl(signature)} target="_blank" rel="noreferrer">
              View on Solana Explorer ↗
            </a>
          </p>
          {sale.currency !== 'STAMPS' && shop.stampMint && (
            <StampReward shop={shop} signature={signature} rewardsSigner={rewardsSigner} />
          )}
          <button className="primary" onClick={onDone}>New sale</button>
        </>
      )}

      {status === 'error' && (
        <>
          <p className="error">Something went wrong while checking this payment: {error}</p>
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
        mint: sale.mint,
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

// ---------------------------------------------------------------------------
// Loyalty stamps
// ---------------------------------------------------------------------------
const MIN_REWARDS_SOL = 0.01; // enough for a few stamp transactions
const TOP_UP_SOL = 0.1;

function LoyaltyCard({ shop, rewardsSigner, onRewardsSigner, onUpdateShop, onRedeem }) {
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
  const fundingBlock = rewardsSigner && (
    <div className="subtle">
      <p>
        Rewards key{' '}
        <a href={explorerAddressUrl(rewardsSigner.address)} target="_blank" rel="noreferrer" className="mono">
          {short(rewardsSigner.address)}
        </a>{' '}
        · {balance === null ? '…' : `${balance.toFixed(4)} SOL`}{' '}
        <button className="link" onClick={refresh}>refresh</button>
      </p>
      {lowFunds && (
        <>
          <p className="hint">
            It needs a little SOL to pay the network fees for sending stamps. Send {TOP_UP_SOL} test SOL from the
            shop's wallet:
          </p>
          {wallets.length ? (
            <button className="secondary" onClick={topUp} disabled={!!busy}>
              Send {TOP_UP_SOL} SOL from {wallets[0].name}
            </button>
          ) : (
            <p className="hint">Send it to the address above from any devnet wallet.</p>
          )}
        </>
      )}
    </div>
  );

  // Not set up yet
  if (!shop.stampMint) {
    return (
      <section className="card">
        <h2>🎟️ Loyalty stamps</h2>
        <p className="muted">
          Every paid purchase earns the customer 1 stamp, sent automatically to their wallet.{' '}
          {STAMPS_FOR_REWARD} stamps = a free coffee. Customers truly own their stamps.
        </p>
        {!rewardsSigner ? (
          <button
            className="primary"
            onClick={() => run('Creating…', async () => onRewardsSigner(await createRewardsSigner()))}
          >
            Set up loyalty stamps
          </button>
        ) : (
          <>
            {fundingBlock}
            <button
              className="primary"
              disabled={!!busy || balance === null || lowFunds}
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
          </>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  // Ready
  return (
    <section className="card">
      <h2>🎟️ Loyalty stamps</h2>
      <p className="muted">
        1 stamp per purchase · {STAMPS_FOR_REWARD} stamps = free coffee ·{' '}
        <a href={explorerAddressUrl(shop.stampMint)} target="_blank" rel="noreferrer">
          token ↗
        </a>
      </p>
      <button className="secondary" onClick={onRedeem}>
        🎁 Redeem a free coffee ({STAMPS_FOR_REWARD} stamps)
      </button>
      {rewardsSigner ? (
        fundingBlock
      ) : (
        <p className="error">
          This browser doesn't have the rewards key that created these stamps, so it can't send new ones.
        </p>
      )}
      {busy && <p className="hint">{busy}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// Remembers which sales already got their stamp, so a stamp is never sent twice.
const awarded = new Set(load('awardedStamps', []));

// Shown on the "Paid" screen: sends the customer their stamp and shows their progress.
function StampReward({ shop, signature, rewardsSigner }) {
  const [state, setState] = useState({ status: 'sending' });

  useEffect(() => {
    if (!rewardsSigner) {
      setState({ status: 'error', message: 'No rewards key in this browser.' });
      return;
    }
    if (awarded.has(signature)) return;
    awarded.add(signature);
    save('awardedStamps', [...awarded].slice(-200));

    (async () => {
      const customer = await findPayer(signature);
      if (!customer || customer === shop.wallet) {
        setState({ status: 'skipped' });
        return;
      }
      await awardStamp({ signer: rewardsSigner, mint: shop.stampMint, customer });
      const stamps = await getStampBalance(shop.stampMint, customer);
      setState({ status: 'sent', customer, stamps });
    })().catch((e) => {
      console.error(e);
      setState({ status: 'error', message: friendlyError(e) });
    });
  }, [signature, rewardsSigner, shop.stampMint, shop.wallet]);

  if (state.status === 'skipped') return null;
  if (state.status === 'sending') return <p className="hint">Sending a loyalty stamp…</p>;
  if (state.status === 'error') return <p className="error">Stamp not sent: {state.message}</p>;

  const progress = Math.min(state.stamps, STAMPS_FOR_REWARD);
  return (
    <div className="stamps">
      <p>
        <strong>+1 stamp</strong> for <span className="mono">{short(state.customer)}</span>
      </p>
      <div className="stamp-row" aria-label={`${progress} of ${STAMPS_FOR_REWARD} stamps`}>
        {Array.from({ length: STAMPS_FOR_REWARD }, (_, i) => (
          <span key={i} className={i < progress ? 'stamp on' : 'stamp'}>☕</span>
        ))}
      </div>
      <p className="hint">
        {state.stamps >= STAMPS_FOR_REWARD
          ? '🎉 Next coffee is free! Use "Redeem a free coffee" on the register.'
          : `${state.stamps} of ${STAMPS_FOR_REWARD}: ${STAMPS_FOR_REWARD - state.stamps} more for a free coffee`}
      </p>
    </div>
  );
}
