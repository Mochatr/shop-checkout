# Shop Checkout

A point-of-sale web app that lets a small shop accept payments on **Solana**.
The shop owner types a price, the customer scans a QR code with their wallet, and the
payment lands directly in the shop's wallet in about a second, for a fee of a fraction of a cent.

Built for the MLH Solana Hackathon (Best Beginner Hack track).

**Live demo:** https://mochatr.github.io/shop-checkout/ (devnet)

## How it works

1. **Set up** – the shop enters its name and Solana wallet address (stored in the browser).
2. **Charge** – enter an amount in USDC or SOL; the app builds a [Solana Pay](https://docs.solanapay.com)
   transfer request and shows it as a QR code. Each sale gets a unique random `reference` address.
3. **Get paid** – the app polls the network for a transaction containing that reference, then checks
   it paid the right wallet the right amount, and shows **Paid ✓** with a link to Solana Explorer.

Customers can pay by scanning the QR code with a mobile wallet, or with the **Pay with Phantom**
button using a browser wallet extension (via the Wallet Standard).

No backend or smart contract: everything runs in the browser and talks to Solana's public RPC.
Runs on **devnet** (test network, free test tokens).

## Run locally

```bash
npm install
npm run dev
```

## Tech

React + Vite · `@solana/kit` · `@solana/pay`
