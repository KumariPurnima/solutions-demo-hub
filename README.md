# Solutions Demo Hub

Public catalog of every demo built by the **DigitalOcean Solutions** team — browsable by Solutions Architect (A→Z), use-case stage, industry, and product, plus Blog & Knowledge Base entries from the same tracker sheet.

```
Google Sheet (private source of truth)
  Demo Tracker · SA Profiles · KB · Blog post · Summary
                 │
                 │  shared Viewer → Google service account only
                 ▼
        App Platform (this repo)
        Express  ·  GET /api/catalog  ·  static UI
                 │
                 ▼
        Public URL  (*.ondigitalocean.app)
```

- **By owner / All demos** — owner sections sorted alphabetically, with profile hooks from the `SA Profiles` tab.
- **Four filters + search** — Owner, Use case stage, Industry / vertical, Products used, plus free-text search.
- **Blog & KB** — rows from the `KB` and `Blog post` tabs.
- **Live sheet sync** — production reads the sheet with a Google service account (sheet stays private; site is public).
- **Local JSON fallback** — `data/*.json` keeps the hub usable without credentials.

## Run locally

Requires Node 20+.

```bash
npm install
npm start          # http://localhost:8080
```

Without `GOOGLE_SERVICE_ACCOUNT_JSON`, the API serves `data/demos.json`, `data/profiles.json`, and `data/content.json`.

Refresh those files from a local spreadsheet export:

```bash
npm run sync:local -- ~/Downloads/Solutions_Demo_Tracker.xlsx
```

Optional live Sheets locally — copy `.env.example` → `.env`, paste the service account JSON, share the sheet with that SA email as **Viewer**, then restart.

| Script | What it does |
| --- | --- |
| `npm start` | Express on `PORT` (default 8080): `/api/catalog` + `public/` |
| `npm run dev` | Same with `node --watch` |
| `npm run sync:local` | Rebuild `data/*.json` from an `.xlsx` export |

## Sheet → API mapping

| Sheet tab | API field | Shape |
| --- | --- | --- |
| Demo Tracker | `demos[]` | `{ owner, name, stage, use_case, industry, products, pain_value, brief, demo_link, github, recording, status, date, feedback, notes }` |
| SA Profiles | `profiles` | `{ [ownerName]: { title, location, bio, photo, linkedin, github } }` |
| KB | `content[]` (`type: "KB"`) | `{ type, owner, title, link, use_case, industry, products }` |
| Blog post | `content[]` (`type: "Blog"`) | same |

Owner names must match across tabs — that is the join key for profiles and content.

Internal-only notes (e.g. vault / 1Password references) are stripped from the public API.

## Service account setup (private sheet → public site)

1. In Google Cloud Console create a project (or reuse one) → **APIs & Services → Enable Google Sheets API**.
2. **IAM → Service accounts → Create**. Download a JSON key.
3. Open [Solutions_Demo_Tracker](https://docs.google.com/spreadsheets/d/1AUYS2mF28aLeHb8LSq6FNXZD9lM7Qva4ey4t79vGHJo/edit) → **Share** → add the service account email as **Viewer** (not “anyone with the link”).
4. In DigitalOcean App Platform, set secret `GOOGLE_SERVICE_ACCOUNT_JSON` to the JSON (raw one-line or base64).
5. Confirm `GOOGLE_SHEET_ID=1AUYS2mF28aLeHb8LSq6FNXZD9lM7Qva4ey4t79vGHJo`.

`GET /api/health` reports `source: "google-sheets"` when live, or `local-json` when falling back.

## Deploy to DigitalOcean App Platform

`.do/app.yaml` defines a Node service (not a static site — the server must call Sheets).

```bash
# after the GitHub repo exists and secrets are ready
doctl apps create --spec .do/app.yaml
# later
doctl apps update <APP_ID> --spec .do/app.yaml
```

Or Control Panel: **Create → Apps → GitHub → `KumariPurnima/solutions-demo-hub`** → set the secret env vars → Deploy.

With `deploy_on_push: true`, every push to `main` redeploys.

## Project layout

```
public/index.html     UI (filters, A–Z owners, Blog & KB, canvas hero)
server/index.js       Express: /api/catalog, /api/health, static
server/lib/catalog.js Sheets client + local JSON fallback + 60s cache
data/                 Fallback JSON exports of the sheet tabs
scripts/              Offline xlsx → JSON sync
.do/app.yaml          App Platform spec
docs/                 Screenshots / notes
```

## Design notes

- Palette: near-black navy `#06070D`, DigitalOcean blue `#0080FF`, status badges green / amber / violet.
- Type: Sora (display), Manrope (body), IBM Plex Mono (meta).
- Status mapping: `Live` → green, `In Progress` → amber, else → Idea.
- Product aliases (`SI` → Serverless Inference, etc.) normalize in the browser.

---

Maintained by the DigitalOcean Solutions team. Demo data lives in the Solutions_Demo_Tracker sheet; this repo is the public lens.
