// Small helpers for saving data in the browser (no server needed).
export function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the app still works, it just won't remember */
  }
}

export const short = (addr) => (addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : '');

// Formats an amount for display: up to 4 decimals for SOL, 2 for everything else.
export function fmt(amount, currency) {
  const digits = currency === 'SOL' ? 4 : 2;
  return Number(amount).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function friendlyError(e) {
  const msg = e?.message || String(e);
  if (/reject|cancel|denied/i.test(msg)) return 'Cancelled in the wallet.';
  if (/account.*not.*found|AccountNotFound|sender not found|could not find account|insufficient/i.test(msg))
    return "This wallet doesn't have enough of that currency on devnet. Get free test funds from a faucet.";
  return msg;
}
