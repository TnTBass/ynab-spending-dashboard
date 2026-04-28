# YNAB Spending Dashboard

A self-contained, browser-based spending dashboard for [YNAB](https://www.ynab.com/) — monthly trends, category drill-downs, and group breakdowns. **No backend, no install, no account required beyond YNAB itself.**

### 👉 Try it: <https://ynab-dashboard.org>

![Built with Chart.js](https://img.shields.io/badge/Chart.js-vanilla%20JS-ff6384) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## How it works

1. Create a YNAB **personal access token** at <https://app.ynab.com/settings/developer> → *New Token*.
2. Visit <https://ynab-dashboard.org> (or run locally — see below) and paste the token when prompted.

That's it. The token is saved in your browser's `localStorage` so you only paste it once. It's sent only to `api.ynab.com` — never to the dashboard host or any other server.

### Run locally

If you'd rather not trust a hosted copy, you can run the same HTML file from your machine:

```bash
git clone https://github.com/TnTBass/ynab-spending-dashboard.git
cd ynab-spending-dashboard
python serve.py            # or:  python -m http.server 3131 --directory public
```

Then open <http://localhost:3131/>.

> `public/index.html` works when opened directly via `file://` too — but a local server is recommended so the browser caches behave normally.

---

## Features

- **Live data** — fetches directly from the YNAB API, nothing is cached on disk
- **Any budget** — automatically detects your category groups, names, and months
- **Configurable range** — last 3 / 6 / 12 months or year-to-date
- **Drill-down** — click any chart → month detail → click a category → trend across months
- **Group breakdown** — stacked chart by your YNAB category groups, with per-group trend explorer
- **Transactions view** — see every transaction behind any number on the chart
- **PDF export** — one-click PDF of the full dashboard
- **Partial month marker** — current month is marked with `*`

---

## Privacy & security

- The page has **no backend**. Your token and budget data never leave your browser, except for direct calls to `https://api.ynab.com`.
- The token is stored in your browser's `localStorage` so you don't have to re-paste it. Click **Sign out** in the top-right to remove it.
- Only paste tokens you created yourself. A YNAB personal access token grants full read/write access to your budget — though this dashboard only ever issues `GET` requests.
- Want truly ephemeral storage? Open the page in a Private/Incognito window — `localStorage` is wiped when you close the window.

---

## What you need

- A YNAB account with at least one budget
- A [personal access token](https://app.ynab.com/settings/developer)
- Any modern browser (Chrome, Firefox, Safari, Edge)

---

## Tech stack

- **Vanilla HTML + JavaScript** — no build step, no npm, no framework
- **[Chart.js](https://www.chartjs.org/)** loaded from CDN — single dependency
- **[html2canvas](https://html2canvas.hertzen.com/) + [jsPDF](https://github.com/parallax/jsPDF)** for PDF export
- The whole dashboard is **one HTML file** (`public/index.html`) — easy to read, easy to fork

---

## Deploying your own copy (Cloudflare Workers)

This repo includes a [`wrangler.jsonc`](./wrangler.jsonc) so you can deploy to Cloudflare's free tier in two clicks:

1. In the Cloudflare dashboard: **Workers & Pages** → **Create application** → **Connect to Git** → pick your fork.
2. Leave **Build command** blank and **Deploy command** as the default `npx wrangler deploy`. Cloudflare reads `wrangler.jsonc` and uploads `./public` as static assets.

Your dashboard will be live at `<project>.<your-subdomain>.workers.dev`. To wire up a custom domain, add it under the Worker's **Settings → Domains & Routes**.

---

## License

MIT
