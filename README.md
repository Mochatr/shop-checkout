# Shop Checkout

A point-of-sale web app that lets a small shop accept payments on **Solana**.
The shop owner types a price, the customer scans a QR code with their wallet, and the
payment lands directly in the shop's wallet in about a second, for a fee of a fraction of a cent.

Built for the MLH Solana Hackathon (Best Beginner Hack track).

**Live demo:** https://mochatr.github.io/shop-checkout/ (devnet)

## Features

- **Register** – a big keypad (works with a physical keyboard too), USDC / SOL switch, one Charge button.
- **Checkout** – a Solana Pay QR code for mobile wallets, or *Pay with Phantom* from the browser.
  The register detects the payment on-chain and shows **Paid ✓** within seconds.
- **Loyalty stamps** – 1 stamp per purchase sent automatically to the customer's wallet; 10 = a free coffee.
- **Dashboard** – sales, revenue per currency, unique and returning customers, a 7-day sales chart,
  live wallet balances, top customers, and every sale linked to its on-chain proof. Export to CSV.
- **Guided setup** – shop name, payout wallet, then optional loyalty stamps, in three steps.

## How it works

1. **Set up** – the shop enters its name and Solana wallet address (stored in the browser).
2. **Charge** – enter an amount in USDC or SOL; the app builds a [Solana Pay](https://docs.solanapay.com)
   transfer request and shows it as a QR code. Each sale gets a unique random `reference` address.
3. **Get paid** – the app polls the network for a transaction containing that reference, then checks
   it paid the right wallet the right amount, and shows **Paid ✓** with a link to Solana Explorer.

Customers can pay by scanning the QR code with a mobile wallet, or with the **Pay with Phantom**
button using a browser wallet extension (via the Wallet Standard).

### Loyalty stamps 🎟️

- Each shop creates its own **stamp token** (Token-2022, with its name and symbol stored on-chain so wallets
  like Phantom show it). Stamps are whole numbers (0 decimals).
- **1 stamp per paid purchase**, sent automatically to the customer's wallet right after payment, by a
  small *rewards key* kept in the shop's browser (the only key allowed to create stamps).
- **10 stamps = a free coffee**: the register charges "10 STAMPS" and the customer pays with stamps,
  using the exact same Solana Pay checkout (QR code or browser wallet).
- Customers truly own their stamps: they sit in their wallet like any other token.

No backend or smart contract: everything runs in the browser and talks to Solana's public RPC.
Runs on **devnet** (test network, free test tokens).

## Run locally

```bash
npm install
npm run dev
```

## Tech

React + Vite · `@solana/kit` · `@solana/pay` · `@solana-program/token-2022` · Wallet Standard
