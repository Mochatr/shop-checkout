import { useEffect, useState } from 'react';
import { CURRENCIES, newReference } from '../solana';
import { STAMPS_FOR_REWARD } from '../loyalty';
import { fmt } from '../storage';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
const MAX_DECIMALS = { USDC: 2, SOL: 4 };

// The register: tap a price on the keypad, pick a currency, charge.
export default function Register({ shop, history, onCharge }) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(() => shop.defaultCurrency || 'USDC');
  const [note, setNote] = useState('');
  const value = Number(amount);
  const valid = amount !== '' && Number.isFinite(value) && value > 0;

  function press(key) {
    setAmount((a) => {
      if (key === '⌫') return a.slice(0, -1);
      if (key === '.') return a.includes('.') ? a : (a || '0') + '.';
      const [, dec] = a.split('.');
      if (dec !== undefined && dec.length >= MAX_DECIMALS[currency]) return a;
      if (a === '0') return key;
      if (a.replace('.', '').length >= 8) return a;
      return a + key;
    });
  }

  function charge() {
    if (!valid) return;
    onCharge({ amount: value, currency, note: note.trim(), reference: newReference(), createdAt: Date.now() });
  }

  // Physical keyboard support: digits, dot/comma, backspace, Enter.
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT') return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === '.' || e.key === ',') press('.');
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Enter') charge();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const today = new Date().toDateString();
  const todaySales = history.filter((s) => new Date(s.paidAt).toDateString() === today && s.currency !== 'STAMPS');

  return (
    <div className="register">
      <div className="card">
        <div className="toggle-row" role="radiogroup" aria-label="Currency">
          {Object.keys(CURRENCIES).map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={c === currency}
              className={c === currency ? 'on' : ''}
              onClick={() => {
                setCurrency(c);
                setAmount('');
              }}
            >
              {c}
            </button>
          ))}
        </div>

        <div className={`display ${amount ? '' : 'empty'}`} aria-live="polite">
          {amount || '0'} <span>{currency}</span>
        </div>

        <input
          className="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note (optional), e.g. 2 mint teas"
        />

        <div className="keypad">
          {KEYS.map((k) => (
            <button key={k} onClick={() => press(k)} aria-label={k === '⌫' ? 'Delete' : k}>
              {k}
            </button>
          ))}
        </div>

        <button className="primary charge" disabled={!valid} onClick={charge}>
          {valid ? `Charge ${fmt(value, currency)} ${currency}` : 'Enter an amount'}
        </button>
      </div>

      {shop.stampMint && (
        <button
          className="secondary wide"
          onClick={() =>
            onCharge({
              amount: STAMPS_FOR_REWARD,
              currency: 'STAMPS',
              mint: shop.stampMint,
              note: 'Free coffee 🎁',
              reference: newReference(),
              createdAt: Date.now(),
            })
          }
        >
          🎁 Redeem free coffee ({STAMPS_FOR_REWARD} stamps)
        </button>
      )}

      <p className="footer-note">
        Today: {todaySales.length} {todaySales.length === 1 ? 'sale' : 'sales'}
        {Object.keys(CURRENCIES).map((c) => {
          const total = todaySales.filter((s) => s.currency === c).reduce((sum, s) => sum + s.amount, 0);
          return total ? ` · ${fmt(total, c)} ${c}` : '';
        })}
      </p>
    </div>
  );
}
