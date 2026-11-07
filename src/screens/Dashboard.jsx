import { useEffect, useMemo, useState } from 'react';
import { address } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { CURRENCIES, explorerAddressUrl, explorerTxUrl, rpc } from '../solana';
import { getSolBalance, STAMPS_FOR_REWARD } from '../loyalty';
import { fmt, short } from '../storage';
import SalesChart from '../components/SalesChart';

const PERIODS = { today: 'Today', week: 'Last 7 days', all: 'All time' };
const DAY = 24 * 60 * 60 * 1000;

// Live balances read straight from the blockchain.
async function loadBalances(shop) {
  const [usdcAta] = await findAssociatedTokenPda({
    owner: address(shop.wallet),
    mint: CURRENCIES.USDC.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [sol, usdc, stamps] = await Promise.all([
    getSolBalance(shop.wallet),
    rpc
      .getTokenAccountBalance(usdcAta, { commitment: 'confirmed' })
      .send()
      .then((r) => Number(r.value.uiAmountString))
      .catch(() => 0),
    shop.stampMint
      ? rpc
          .getTokenSupply(address(shop.stampMint), { commitment: 'confirmed' })
          .send()
          .then((r) => Number(r.value.amount))
          .catch(() => null)
      : null,
  ]);
  return { sol, usdc, stamps };
}

export default function Dashboard({ shop, history }) {
  const [period, setPeriod] = useState('week');
  const [balances, setBalances] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    loadBalances(shop).then(setBalances).catch(console.error);
  }, [shop]);

  const stats = useMemo(() => summarize(history, period), [history, period]);
  const days = useMemo(() => lastSevenDays(history), [history]);

  return (
    <div className="dashboard">
      <div className="filters" role="tablist" aria-label="Time period">
        {Object.entries(PERIODS).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={period === k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="tiles">
        <Tile label="Sales" value={stats.count} />
        <Tile label="USDC received" value={fmt(stats.revenue.USDC, 'USDC')} />
        <Tile label="SOL received" value={fmt(stats.revenue.SOL, 'SOL')} />
        <Tile label="Customers" value={stats.customers} sub={`${stats.returning} came back`} />
      </div>

      <section className="card">
        <h2>Sales per day</h2>
        <p className="hint">Last 7 days · hover a day for details</p>
        <SalesChart days={days} />
      </section>

      <div className="two-col">
        <section className="card">
          <h2>In your wallet</h2>
          <p className="hint">
            Live from Solana ·{' '}
            <a href={explorerAddressUrl(shop.wallet)} target="_blank" rel="noreferrer" className="mono">
              {short(shop.wallet)} ↗
            </a>
          </p>
          <div className="kv big">
            <span>USDC</span>
            <strong>{balances ? fmt(balances.usdc, 'USDC') : '…'}</strong>
          </div>
          <div className="kv big">
            <span>SOL</span>
            <strong>{balances ? fmt(balances.sol, 'SOL') : '…'}</strong>
          </div>
        </section>

        <section className="card">
          <h2>Loyalty</h2>
          {shop.stampMint ? (
            <>
              <p className="hint">1 stamp per purchase · {STAMPS_FOR_REWARD} = free coffee</p>
              <div className="kv big">
                <span>Stamps in circulation</span>
                <strong>{!balances ? '…' : balances.stamps ?? '—'}</strong>
              </div>
              <div className="kv big">
                <span>Free coffees given</span>
                <strong>{stats.redeemed}</strong>
              </div>
            </>
          ) : (
            <p className="muted">Loyalty stamps aren't set up yet. Turn them on in Settings.</p>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Top customers</h2>
        {stats.top.length === 0 ? (
          <p className="muted">No customers in this period yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="num">Visits</th>
                <th className="num">Spent</th>
              </tr>
            </thead>
            <tbody>
              {stats.top.map((c) => (
                <tr key={c.customer}>
                  <td>
                    <a href={explorerAddressUrl(c.customer)} target="_blank" rel="noreferrer" className="mono">
                      {short(c.customer)}
                    </a>
                  </td>
                  <td className="num">{c.visits}</td>
                  <td className="num">
                    {Object.entries(c.spent)
                      .map(([cur, v]) => `${fmt(v, cur)} ${cur}`)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>All sales</h2>
          {stats.list.length > 0 && (
            <button className="secondary small" onClick={() => downloadCsv(stats.list, shop.name)}>
              Export CSV
            </button>
          )}
        </div>
        {stats.list.length === 0 ? (
          <p className="muted">No sales in this period yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th className="item">Item</th>
                <th className="num">Amount</th>
                <th className="num">Proof</th>
              </tr>
            </thead>
            <tbody>
              {(showAll ? stats.list : stats.list.slice(0, 10)).map((s) => (
                <tr key={s.signature}>
                  <td>{when(s.paidAt)}</td>
                  <td className="muted item">{s.note || "—"}</td>
                  <td className="num">
                    <strong>{fmt(s.amount, s.currency)}</strong> {s.currency}
                  </td>
                  <td className="num">
                    <a href={explorerTxUrl(s.signature)} target="_blank" rel="noreferrer" aria-label="View transaction">
                      ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {stats.list.length > 10 && (
          <button className="link" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${stats.list.length} sales`}
          </button>
        )}
        <p className="hint">Sales recorded on this register. Every one is verifiable on Solana Explorer.</p>
      </section>
    </div>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <strong className="tile-value">{value}</strong>
      {sub && <span className="hint">{sub}</span>}
    </div>
  );
}

function summarize(history, period) {
  const now = Date.now();
  const start = period === 'today' ? new Date().setHours(0, 0, 0, 0) : period === 'week' ? now - 7 * DAY : 0;
  const list = history.filter((s) => s.paidAt >= start);
  const sales = list.filter((s) => s.currency !== 'STAMPS');

  const revenue = { USDC: 0, SOL: 0 };
  const byCustomer = new Map();
  for (const s of sales) {
    revenue[s.currency] = (revenue[s.currency] || 0) + s.amount;
    if (!s.customer) continue;
    const c = byCustomer.get(s.customer) || { customer: s.customer, visits: 0, spent: {} };
    c.visits += 1;
    c.spent[s.currency] = (c.spent[s.currency] || 0) + s.amount;
    byCustomer.set(s.customer, c);
  }
  const customers = [...byCustomer.values()];
  return {
    list,
    count: sales.length,
    revenue,
    customers: customers.length,
    returning: customers.filter((c) => c.visits > 1).length,
    redeemed: list.filter((s) => s.currency === 'STAMPS').length,
    top: customers.sort((a, b) => b.visits - a.visits).slice(0, 5),
  };
}

function lastSevenDays(history) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toDateString();
    const sales = history.filter((s) => s.currency !== 'STAMPS' && new Date(s.paidAt).toDateString() === key);
    const revenue = {};
    for (const s of sales) revenue[s.currency] = (revenue[s.currency] || 0) + s.amount;
    days.push({
      key,
      label: i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' }),
      fullLabel: d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }),
      isToday: i === 0,
      count: sales.length,
      revenue,
    });
  }
  return days;
}

function when(ts) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function downloadCsv(list, shopName) {
  const rows = [['date', 'amount', 'currency', 'note', 'customer', 'transaction']];
  for (const s of list) {
    rows.push([new Date(s.paidAt).toISOString(), s.amount, s.currency, s.note || '', s.customer || '', s.signature]);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `${shopName.replace(/\W+/g, '-').toLowerCase()}-sales.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
