import { useEffect, useRef, useState } from 'react';
import { createQR } from '@solana/pay';
import { buildPaymentUrl, explorerTxUrl, waitForPayment } from '../solana';
import { findPayer } from '../loyalty';
import { fmt } from '../storage';
import { BrowserPayButton } from '../components/WalletButtons';
import { StampReward } from '../components/Loyalty';

// Customer-facing screen: shows the QR code and waits until the payment lands on-chain.
export default function Payment({ shop, sale, rewardsSigner, onPaid, onDone }) {
  const [status, setStatus] = useState('waiting'); // waiting | paid | error
  const [paid, setPaid] = useState(null); // { signature, customer }
  const [error, setError] = useState('');
  const qrRef = useRef(null);
  const isRedeem = sale.currency === 'STAMPS';

  const url = buildPaymentUrl({
    recipient: shop.wallet,
    amount: sale.amount,
    currency: sale.currency,
    mint: sale.mint,
    reference: sale.reference,
    shopName: shop.name,
    note: sale.note,
  });

  useEffect(() => {
    const el = qrRef.current;
    if (!el) return;
    el.innerHTML = '';
    createQR(url, 280, 'white', '#14121f').append(el);
  }, [url]);

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
      .then(async (signature) => {
        if (!signature) return; // cancelled
        const customer = await findPayer(signature).catch(() => null);
        setPaid({ signature, customer });
        setStatus('paid');
        onPaid({ ...sale, signature, customer, paidAt: Date.now() });
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
    <div className="card center payment">
      <p className="muted">{sale.note || `Order at ${shop.name}`}</p>
      <div className="big-amount">
        {fmt(sale.amount, sale.currency)} <span>{sale.currency}</span>
      </div>

      {status === 'waiting' && (
        <>
          <div ref={qrRef} className="qr" role="img" aria-label="Payment QR code" />
          <p className="status">
            <span className="spinner" /> Waiting for payment…
          </p>
          <p className="hint">
            {isRedeem
              ? 'The customer pays with 10 stamps from their wallet.'
              : 'Scan with any Solana wallet app, or pay from this computer:'}
          </p>
          <BrowserPayButton shop={shop} sale={sale} />
          <div className="row">
            <a className="secondary" href={url}>Open in wallet</a>
            <button className="secondary" onClick={() => navigator.clipboard?.writeText(url)}>Copy link</button>
            <button className="secondary" onClick={onDone}>Cancel</button>
          </div>
        </>
      )}

      {status === 'paid' && (
        <>
          <div className="paid">✓</div>
          <h1>{isRedeem ? 'Free coffee redeemed 🎉' : 'Paid'}</h1>
          <a href={explorerTxUrl(paid.signature)} target="_blank" rel="noreferrer">View on Solana Explorer ↗</a>
          {!isRedeem && shop.stampMint && (
            <StampReward
              shop={shop}
              signature={paid.signature}
              customer={paid.customer}
              rewardsSigner={rewardsSigner}
            />
          )}
          <button className="primary wide" onClick={onDone} autoFocus>New sale</button>
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
