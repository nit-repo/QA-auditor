# AEM QA Framework ⚡

> **Automated 49-point quality audit engine & dashboard for Adobe Experience Manager**

[![Stack](https://img.shields.io/badge/Stack-Vanilla%20JS%20%7C%20Node.js-blue.svg)](#technology)
[![Dependencies](https://img.shields.io/badge/npm%20dependencies-0-brightgreen.svg)](#technology)
[![Deploy](https://img.shields.io/badge/Deploy-Railway-purple.svg)](#deploying-to-railway)
[![License](https://img.shields.io/badge/License-MIT-lightgrey.svg)](#license)

A zero-dependency, browser-native QA tool for AEM (Cloud Service, 6.5, Author preview,
Stage and Production). It runs **49 automated checks across 4 quality pillars** inside
your already-authenticated browser tab, then reports to a self-hosted dashboard.

---

## Why it exists

Auditing AEM author preview URLs (`author-pXXXX-eYYYY.adobeaemcloud.com`) with
headless tooling is awkward, because Adobe IMS blocks unauthenticated requests:

```
✗ Playwright / Cypress / Lighthouse CLI  → hits the IMS login wall (401/302)
✗ External CORS fetch                    → blocked by cross-origin policy
✓ AEM QA bookmarklet                     → runs in your tab, inherits the IMS session
```

The engine executes inside the authenticated page, so it sees exactly what the
author sees.

---

## Quick start

```bash
git clone <repository-url> && cd <repo>
npm start                       # builds the bookmarklets, then serves on :3500
```

Open <http://localhost:3500>. There are no dependencies to install — `npm start`
runs `scripts/build.js` first (via `prestart`) and then boots the server.

### Install the bookmarklet

1. On the dashboard, click **Copy Code** (or drag **AEM QA Auditor** to your bookmarks bar).
2. Navigate to any page — including an AEM author preview.
3. Click the bookmark. The audit panel opens, checks run, and **Send to Server**
   pushes the result to your dashboard.

### Two audit modes

Install **both** bookmarklets — they answer different questions.

| | 🔍 Full audit | ⚡ Quick scan |
|---|---|---|
| Checks | all 49 | the 15 P1 blockers |
| Links | every link verified | first 25 sampled, 2s timeout |
| Answers | "how healthy is this page?" | "is anything blocking go-live?" |
| Result | score out of 100 | blocker count |

Both reach the **same go/no-go verdict**, because that verdict keys off P1
failures alone — quick mode drops the P2/P3/P4 detail, not the decision. Use
Quick while fixing, Full before signing off.

A quick scan reports **no 0–100 score**, deliberately. Only P1 checks ran, so a
page failing ten P2s would score 100 — a number that cannot be compared to a
full audit is worse than no number. The dashboard tags these reports `⚡ QUICK`
and shows the blocker count in place of a score. Sampling is always stated
("24 broken in a sample of 25 of 62"), so a sampled pass is never mistaken for
full coverage.

Payloads produced in `dist/`:

| File | Mode | Reports to |
|---|---|---|
| `AEM_QA_BOOKMARK_LOCAL_FULL.txt` | full | `http://localhost:3500` |
| `AEM_QA_BOOKMARK_LOCAL_QUICK.txt` | quick | `http://localhost:3500` |
| `AEM_QA_BOOKMARK_HOSTED_FULL.txt` | full | your `--endpoint` |
| `AEM_QA_BOOKMARK_HOSTED_QUICK.txt` | quick | your `--endpoint` |
| `AEM_QA_BOOKMARK_LOADER.txt` | full | loads the engine over HTTP; **blocked by CSP on most production AEM** — prefer a self-contained payload |

```bash
npm run build -- --endpoint https://<app>.up.railway.app/api/report
```

### Getting results back into the dashboard

The report reaches the dashboard over three channels, tried together:

1. `postMessage` to the opener — only when the page was opened via the
   dashboard's launcher.
2. `BroadcastChannel` — same-origin only, so a no-op for a real AEM audit.
3. **HTTP POST** — the authoritative channel, and the one that matters.

The bookmarklet **waits for the POST and reports the real outcome**. On failure
it stays on screen, names the cause, and offers Retry / Download JSON. The most
common cause is a bookmarklet built without `--endpoint`, which bakes in
`localhost:3500` and is then blocked as mixed content on an HTTPS page — the
dialog says exactly that.

---

## The 4 audit pillars

| Pillar | Weight | Checks | Covers |
|---|---:|---:|---|
| **Metadata & SEO** | 25% | 12 | Title, description, canonical, OpenGraph, Twitter cards, robots, hreflang |
| **Content & Components** | 35% | 19 | H1–H6 order, raw `/content/` paths, author/stage leaks, link + CTA health, image alt text |
| **Responsive Layout** | 15% | 7 | Viewport meta, 44px touch targets, horizontal overflow, flex/grid wrapping |
| **Accessibility (WCAG 2.1 AA)** | 25% | 11 | Colour contrast, form labels, ARIA landmarks and roles, focus visibility |

Scoring is priority-weighted (P1=4, P2=2, P3=1). Any failing **P1** check sets the
verdict to `BLOCK` regardless of the numeric score.

### A note on link checking

Cross-origin links usually send no CORS headers, so a browser cannot read their
status. The engine tries `HEAD`, then `GET`, then an opaque `no-cors` request; a
link is only reported broken when it is genuinely unreachable. Links that are
reachable but unreadable are counted separately as *unverified* rather than
being failed — which is what previously produced false positives on essentially
every external link.

---

## Deploying to Railway

The server is a single long-lived Node process, so reports persist to disk.

1. Create a Railway project from this repo. Nixpacks detects Node automatically;
   `railway.toml` supplies the build, start and healthcheck configuration.
2. **Attach a volume** (e.g. mounted at `/data`) and set `REPORTS_DIR=/data/reports`.
   Without a volume, reports are lost on every redeploy.
3. Set variables as needed (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | injected by Railway | Listen port |
| `REPORTS_DIR` | `./reports` | Where reports are written — point at your volume |
| `QA_API_TOKEN` | unset | When set, `POST /api/report` requires `X-QA-Token` |
| `MAX_REPORTS` | `500` | Oldest reports pruned beyond this |

4. Build the team bookmarklet against your deployment:

```bash
npm run build -- --endpoint https://<app>.up.railway.app/api/report --token "$QA_API_TOKEN"
```

`/health` returns `{ ok, reports, uptime }` for the Railway healthcheck.

### Access model

- **Writes** (`POST /api/report`) accept cross-origin requests — the bookmarklet
  posts from whatever AEM origin the author is on. Set `QA_API_TOKEN` to require
  a shared secret.
- **Reads** (`/api/reports`, `/api/report-details`) deliberately emit no wildcard
  CORS header, so only the same-origin dashboard can list or open reports. Audit
  payloads embed internal author/stage URLs and page content.

> If you expose the dashboard publicly, put Railway's access controls or an
> authenticating proxy in front of it. The read endpoints are same-origin
> protected, not authenticated.

---

## Project structure

```
├── server.js              Server: static dashboard + report API (Node core only)
├── railway.toml           Railway build/deploy/healthcheck manifest
├── .env.example           Documented environment variables
├── src/
│   └── bookmarklet.js     The QA engine — single source of truth
├── scripts/
│   └── build.js           Compiles the engine into its deployable payloads
├── public/                Dashboard SPA (index.html, app.js, style.css)
├── test/
│   └── smoke.test.js      Dependency-free smoke tests (npm test)
├── dist/                  Generated bookmarklet payloads (gitignored)
└── docs/                  Architecture, implementation and presentation guides
```

Generated files (`dist/`, `public/bookmarklet.js`) are gitignored and rebuilt by
`npm run build`. Edit `src/bookmarklet.js`, never the generated output.

---

## Configuration

Override engine behaviour per-site without editing it, by setting
`window.__AEM_QA_CONFIG__` before the engine runs:

```js
window.__AEM_QA_CONFIG__ = {
  mode: 'quick',                // 'full' (default, 49 checks) or 'quick' (15 P1 blockers)
  ui: 'toast',                  // 'panel' (default) or fire-and-forget 'toast'
  autoSend: true,               // send without clicking, in panel mode
  reportServer: 'https://…/api/report',
  apiToken: '…',                // when the server sets QA_API_TOKEN
  thresholdScore: 85,
  selectors: { cta: ['a.my-button'] },   // defaults target KONE + AEM Core Components
  weights: { accessibility: 0.35 },
  quickLinkSample: 25,          // links sampled in quick mode
  quickLinkTimeout: 2000
};
```

The default selectors are tuned for KONE and AEM Core Components; retune
`selectors` for other sites so component checks do not under-detect.

---

## API

| Method | Endpoint | Notes |
|---|---|---|
| `POST` | `/api/report` | Save a report. Cross-origin allowed; token-gated when configured |
| `GET` | `/api/reports` | Report summaries, newest first. Same-origin |
| `GET` | `/api/report-details?id=` | One full report; `404` when unknown. Same-origin |
| `GET` | `/api/bookmarklet?variant=` | Current compiled payload (`hosted` \| `local`) |
| `GET` | `/health` | Liveness probe |

---

## Testing

```bash
npm test
```

Covers payload compilation, the report round-trip, path-traversal rejection and
the CORS split. <a id="technology"></a>

---

## Technology

Vanilla JavaScript and Node core APIs only — **no npm dependencies**, no build
toolchain, no webfont CDN. The dashboard works offline and under a strict CSP.

---

## Documentation

- [Technical architecture guide](./docs/QA_FRAMEWORK_DOCUMENTATION.md)
- [Implementation guide](./docs/AEM_QA_FRAMEWORK_GUIDE.md)
- [Stakeholder overview](./docs/STAKEHOLDER_QA_OVERVIEW.md)
- [Sprint demo guide](./docs/SPRINT_DEMO_PRESENTATION_GUIDE.md)
- [Prototype walkthrough](./docs/walkthrough.md)

---

## License

MIT.
