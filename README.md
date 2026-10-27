# Solutions Demo Hub

Public catalog of every demo built by the **DigitalOcean Solutions** team — browsable by Solutions Architect (A→Z), use-case stage, industry, and product, plus Blog & Knowledge Base entries from the same tracker sheet.

```
Google Sheet (private source of truth)
  Demo Tracker · SA Profiles · KB · Blog · Summary
                 │
                 │  export / sync → data/*.json
                 ▼
        App Platform (this repo)
        Express  ·  GET /api/catalog  ·  static UI
                 │
                 ▼
        Password-gated URL  (*.ondigitalocean.app)
```

- **By owner / All demos** — owner sections sorted alphabetically, with profile hooks from the `SA Profiles` tab.
- **Four filters + search** — Owner, Use case stage, Industry / vertical, Products used, plus free-text search.
- **Blog & KB** — rows from the `KB` and `Blog` tabs.
- **Sheet sync** — refresh `data/*.json` from a spreadsheet export (`npm run sync:local`), then deploy so the site serves that catalog.
- **Site login** — optional `SITE_PASSWORD` shows a custom login page; `/api/health` stays open for App Platform checks.

## Run locally

Requires Node 20+.

```bash
npm install
npm start          # http://localhost:8080
```

The API serves `data/demos.json`, `data/profiles.json`, and `data/content.json`.

Refresh those files from a spreadsheet export:

```bash
npm run sync:local -- ~/Downloads/Solutions_Demo_Tracker.xlsx
```

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
| Blog | `content[]` (`type: "Blog"`) | same |

Owner names must match across tabs — that is the join key for profiles and content.

Internal-only notes (e.g. vault / 1Password references) are stripped from the public API.

`GET /api/health` reports `source: "local-json"` when serving the committed `data/*.json` files.

## Deploy to DigitalOcean App Platform

`.do/app.yaml` defines a Node service on App Platform.

```bash
# after the GitHub repo exists and secrets are ready
doctl apps create --spec .do/app.yaml
# later
doctl apps update <APP_ID> --spec .do/app.yaml
```

Or Control Panel: **Create → Apps → GitHub → `KumariPurnima/solutions-demo-hub`** → set env secrets (`SITE_PASSWORD`, optional sync secrets) → Deploy.

With `deploy_on_push: true`, every push to `main` redeploys.

## Project layout

```
public/index.html     UI (filters, A–Z owners, Blog & KB, canvas hero)
public/login.html     Custom 3D login gate
server/index.js       Express: /api/catalog, /api/health, /api/login, static
server/lib/catalog.js Catalog loader + cache (local JSON; optional sheet fetch)
data/                 JSON exports of the sheet tabs (served in production)
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
