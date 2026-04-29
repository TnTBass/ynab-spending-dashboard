# YNAB Spending Dashboard

A self-contained, browser-based spending dashboard for [YNAB](https://www.ynab.com/). Monthly trends, category drill-downs, group breakdowns, transaction lists, and PDF export. No data ever leaves your browser except for direct calls to YNAB.

### 👉 Try it: <https://ynab-dashboard.org>

![Built with Chart.js](https://img.shields.io/badge/Chart.js-vanilla%20JS-ff6384) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## How it works

1. Visit <https://ynab-dashboard.org>.
2. Click **Sign in with YNAB** and authorize the app on YNAB's site.
3. You're redirected back to the dashboard. Pick a budget. Done.

The dashboard requests **read-only** access (enforced by YNAB), so it cannot modify or delete anything in your budget. Tokens are stored in your browser's `localStorage` and refresh automatically every two hours, so you only sign in once.

You can revoke access at any time from your [YNAB OAuth settings](https://app.ynab.com/settings/oauth).

---

## Features

- **Live data.** Fetches directly from YNAB on each load. Nothing is cached on disk.
- **Any budget.** Detects your category groups, names, and months automatically.
- **Configurable range.** Last 3 / 6 / 12 months, or year-to-date.
- **Drill-down.** Click any chart → month detail → click a category → trend across months.
- **Group breakdown.** Stacked chart by your YNAB category groups, with per-group trend explorer.
- **Transactions view.** See every transaction behind any number on the chart.
- **PDF export.** One click for a full dashboard PDF.
- **Partial month marker.** Current month is marked with `*`.

---

## Privacy & security

- The dashboard makes **all YNAB API calls directly from your browser to `api.ynab.com`**. Your budget data never touches the dashboard server.
- The only thing that does go through the server is the OAuth token exchange (`/api/oauth/exchange` and `/api/oauth/refresh`). YNAB requires a `client_secret` for this, which can't safely live in a browser. The server holds the secret as an environment variable, never logs token responses, and forwards them straight back to your browser.
- Tokens are stored in your browser's `localStorage`. Sign out from the top right to remove them, or revoke the app entirely from YNAB's settings.
- Want ephemeral storage? Open the dashboard in a Private/Incognito window. `localStorage` is wiped when the window closes.
- The full source is in this repo. The Worker is ~150 lines (`src/worker.js`) and reviewable in 5 minutes.

---

## Run it locally

```bash
git clone https://github.com/TnTBass/ynab-spending-dashboard.git
cd ynab-spending-dashboard
python serve.py
# → http://localhost:3131/
```

Good for previewing UI changes. The "Sign in with YNAB" button works against the live OAuth endpoint (no local setup needed).

---

## Tech stack

- **Frontend:** Vanilla HTML + JavaScript, no build step. [Chart.js](https://www.chartjs.org/) and [html2canvas](https://html2canvas.hertzen.com/) + [jsPDF](https://github.com/parallax/jsPDF) loaded from CDN. The entire dashboard is `public/index.html`.
- **Backend:** A ~150-line Cloudflare Worker (`src/worker.js`) that proxies two OAuth endpoints. No dependencies.
- **OAuth:** Authorization Code flow with PKCE (RFC 7636). Refresh tokens are used to keep sessions alive without re-prompting.

---

## Privacy

Full policy at <https://ynab-dashboard.org/privacy.html> ([source](./public/privacy.html)). Short version: the dashboard server never sees your YNAB data or your tokens. The browser talks directly to `api.ynab.com` for everything except the OAuth token exchange itself, which is forwarded by the server without inspection or logging.

---

## License

MIT
