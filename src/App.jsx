import { useEffect, useState } from 'react';
import { NETWORK } from './solana';
import { loadRewardsSigner } from './loyalty';
import { load, save } from './storage';
import Onboarding from './screens/Onboarding';
import Register from './screens/Register';
import Payment from './screens/Payment';
import Dashboard from './screens/Dashboard';
import Settings from './screens/Settings';

const TABS = [
  { id: 'register', label: 'Register', icon: '🧾' },
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export default function App() {
  const [shop, setShop] = useState(() => load('shop', null)); // { name, wallet, stampMint?, defaultCurrency? }
  const [onboarded, setOnboarded] = useState(() => load('onboarded', !!load('shop', null)?.wallet));
  const [tab, setTab] = useState('register');
  const [sale, setSale] = useState(null); // the payment currently on screen
  const [history, setHistory] = useState(() => load('sales', []));
  const [rewardsSigner, setRewardsSigner] = useState(null); // signs stamp transactions

  useEffect(() => save('shop', shop), [shop]);
  useEffect(() => save('sales', history), [history]);
  useEffect(() => save('onboarded', onboarded), [onboarded]);
  useEffect(() => {
    loadRewardsSigner().then(setRewardsSigner).catch(console.error);
  }, []);

  const updateShop = (changes) => setShop((old) => ({ ...old, ...changes }));
  const recordSale = (paid) => setHistory((h) => [paid, ...h].slice(0, 500));

  const loyaltyProps = { rewardsSigner, onRewardsSigner: setRewardsSigner, onUpdateShop: updateShop };

  let content;
  if (!onboarded || !shop?.wallet) {
    content = <Onboarding shop={shop || {}} {...loyaltyProps} onFinish={() => setOnboarded(true)} />;
  } else if (sale) {
    content = (
      <Payment
        shop={shop}
        sale={sale}
        rewardsSigner={rewardsSigner}
        onPaid={recordSale}
        onDone={() => setSale(null)}
      />
    );
  } else if (tab === 'dashboard') {
    content = <Dashboard shop={shop} history={history} />;
  } else if (tab === 'settings') {
    content = <Settings shop={shop} {...loyaltyProps} />;
  } else {
    content = <Register shop={shop} history={history} onCharge={setSale} />;
  }

  const showTabs = onboarded && shop?.wallet && !sale;

  return (
    <div className={`app ${tab === 'dashboard' && showTabs ? 'wide' : ''}`}>
      <header className="topbar">
        <span className="brand">
          <span className="logo" aria-hidden>☕</span> {shop?.name || 'Shop Checkout'}
        </span>
        <span className="badge" title="Solana test network: no real money">{NETWORK}</span>
      </header>

      {showTabs && (
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'on' : ''}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
            >
              <span aria-hidden>{t.icon}</span> {t.label}
            </button>
          ))}
        </nav>
      )}

      <main>{content}</main>
    </div>
  );
}
