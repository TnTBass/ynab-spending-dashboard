# YNAB Spending Dashboard

A self-contained, browser-based spending dashboard for [YNAB](https://www.ynab.com/) — monthly trends, category drill-downs, and group breakdowns. **No backend, no install, no account required beyond YNAB itself.**

![Built with Chart.js](https://img.shields.io/badge/Chart.js-vanilla%20JS-ff6384) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## Try it

1. Create a YNAB **personal access token** at <https://app.ynab.com/settings/developer> → *New Token*.
2. Open `spending-chart.html` in a browser and paste the token when prompted.

That's it. The token is saved in your browser's `localStorage` so you only paste it once. It's sent only to `api.ynab.com` — there is no other server.

### Run locally

```bash
python -m http.server 3131
# or
python serve.py
```

Then open <http://localhost:3131/spending-chart.html>.

> The file works when opened directly via `file://` too — but a local server is recommended so the browser caches behave normally.

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
- The whole dashboard is **one HTML file** (`spending-chart.html`) — easy to read, easy to fork

---

## Hosted version

A hosted copy is available at *(TBD — Cloudflare Pages link goes here once deployed)*. It's the same file served over HTTPS — your token still stays on your device.

---

## License

MIT
