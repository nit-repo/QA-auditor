# AEM QA Framework Prototype Walkthrough

We have built the complete zero-dependency **AEM QA Framework** prototype inside `src/` and `scripts/`.

## 📁 Artifacts Created

| File | Description |
|---|---|
| [`bookmarklet.js`](../src/bookmarklet.js) | Full 49-check QA engine across 4 pillars (Metadata, Content & Components, Responsive, Accessibility) with in-page UI panel |
| [`build-bookmarklet.js`](../scripts/build.js) | Build script to minify & encode bookmarklet into `javascript:` URL |
| [`AEM_QA_BOOKMARK.txt`](../dist/AEM_QA_BOOKMARK_HOSTED.txt) | Minified bookmarklet URL ready to add to browser bookmarks |
| [`server.js`](../server.js) | Zero-dependency HTTP report server & REST API (runs on `http://localhost:3500`) |
| [`public/index.html`](../public/index.html) | Modern dark-mode Dashboard UI for history & detailed audit inspection |
| [`public/style.css`](../public/style.css) | Custom styling for the dashboard |
| [`public/app.js`](../public/app.js) | Dashboard client application logic |

---

## 🚀 How to Use the Prototype

### 1. Install the Bookmarklet in Browser (One-Time Setup)

1. Open your Web Browser (Chrome, Edge, Firefox, Safari).
2. Open the file [`AEM_QA_BOOKMARK.txt`](../dist/AEM_QA_BOOKMARK_HOSTED.txt) and copy its entire content (starts with `javascript:`).
3. Create a new Bookmark in your browser:
   - **Name:** `AEM QA`
   - **URL:** Paste the copied text.
4. Drag or pin `AEM QA` to your Bookmarks Bar.

---

### 2. Audit Any AEM Page or Public URL

Works on **live pages** (e.g. `https://www.kone.com`) AND **AEM preview / author links** (e.g. `https://author-p12345-e67890.adobeaemcloud.com/content/...html?wcmmode=disabled`):

1. Open the page in your browser (log in to AEM if accessing preview/author pages).
2. Click **`AEM QA`** in your Bookmarks Bar.
3. The interactive dark side-panel appears instantly:
   - Runs 50+ synchronous DOM checks immediately.
   - Batch-verifies all internal links and CTAs asynchronously in background.
   - Calculates weighted score and flags **P1 Hard Blockers** (e.g., missing H1, broken links, raw `/content/` paths).
4. Click **`📤 Export JSON`**, **`📋 Copy Report`**, or **`📡 Send to Server`**.

---

### 3. Open the Central QA Dashboard

The local report server is currently running at `http://localhost:3500`.

- Open **`http://localhost:3500`** in your browser.
- View audit history, overall scores, P1 failure flags, and drill down into individual check findings per audited page.

---

## ⚡ Key Highlights for AEM Preview & Author Tier

- **Bypasses IMS Auth Walls:** Executes inside the active browser session, inheriting all AEM authentication cookies natively without needing API keys or test users.
- **Catches AEM-Specific Bugs:**
  - Raw `/content/` author paths left in links.
  - Author/Stage/Dev URLs exposed on published components.
  - Known AEM Core Component `alt/` attribute syntax bugs.
- **Zero Third-Party Dependencies:** Pure vanilla JS and native Web APIs only (`querySelector`, `getComputedStyle`, `fetch`, `AbortController`).
