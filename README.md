# Glowtape by Zalin Studios

The whole stock market at a glance: the S&P 500, Nasdaq-100, Dow 30 and Russell 2000 (top 150) shown as glowing bubbles. Green bubbles are up, red bubbles are down, and size shows how big the company is.

**Live site:** https://smwajeeh.github.io/glowtape/

## How it works

| Piece | What it does | Cost |
|---|---|---|
| `index.html`, `app.js` | The website, hosted on GitHub Pages | Free |
| `.github/workflows/update-data.yml` | Runs every 5 minutes while the U.S. market is open | Free (public repo) |
| `scripts/update.mjs` | Gets prices from Alpaca and writes `data.json` to the `data` branch | Free (Alpaca Basic, IEX feed) |
| `config.js` | Where the site reads live data from; the contact form key | |

The website checks for new data every 2 minutes and updates the bubbles in place. If live data isn't available yet, it falls back to the snapshot in `data.json`.

## One-time setup

### 1. Alpaca API keys (free)
1. Sign up at https://alpaca.markets and open the dashboard (a free paper-trading account is enough).
2. Generate API keys. Copy the **Key ID** and **Secret Key**.
3. In this repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `ALPACA_KEY_ID`
   - `ALPACA_SECRET_KEY`
4. Go to **Actions → Update market data → Run workflow** to run it once right away.

The keys stay secret in GitHub. They are never in the website code.

### 2. Contact form (free, optional)
1. Go to https://web3forms.com, enter the email where you want messages, and copy the access key they send you.
2. Paste it into `config.js` as `web3formsKey`.

Messages are forwarded to your inbox. Your email address never appears on the site.

## Changing how often it updates
In `.github/workflows/update-data.yml`, change the `cron` line:
- Every 5 minutes: `*/5 13-21 * * 1-5`
- Every 15 minutes: `*/15 13-21 * * 1-5`
- Every hour: `0 13-21 * * 1-5`

Times are in UTC. GitHub sometimes starts scheduled runs a few minutes late.

## Good to know
- The free Alpaca feed uses prices from the IEX exchange. Big stocks match the full market closely; very thinly traded small caps can lag slightly or show no move.
- Index members, market caps and weights come from StockAnalysis.com (`scripts/universe.json`). Caps and weights are scaled by the live price; refresh the list when the indexes rebalance.
- For learning and screening only. Not financial advice.
