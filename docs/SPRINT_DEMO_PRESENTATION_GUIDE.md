# Tech Sprint Demo Guide: AEM Automated QA Bookmarklet Framework

**Session Type:** Sprint Review / Technical Demo  
**Target Audience:** Product Owners, AEM Developers, QA Leads, Content Authors  
**Duration:** 10 – 15 Minutes  
**Tool Artifact:** `AEM_QA_FRAMEWORK_GUIDE.md`  

---

## 1. Executive Summary (The 60-Second Pitch)

### The Problem
Manual AEM page QA is **slow, inconsistent, and prone to escaped defects**. A single page review takes 30–45 minutes. Critical issues like broken internal links, raw `/content/` author paths, missing `<h1>` tags, and accessibility violations frequently slip into production because manual spot-checks can't cover 50+ DOM rules per page. Furthermore, automated server-side tools (like Playwright or Lighthouse running in CI) fail on AEM Author tier preview URLs due to Adobe IMS authentication walls.

### The Solution
We built a **zero-dependency, one-click browser bookmarklet** that runs directly inside an active browser session on any AEM Cloud Author Preview or Publish page.

- ⚡ **Instant Execution:** 49 automated checks executed in ~1s (DOM) + ~10s (async link verification).
- 🔐 **Authentication Solved:** Zero credentials or cookies to manage; it inherits the active browser’s IMS session.
- 🎯 **Elevated P1 Checks:** Deep focus on broken internal links, raw AEM content paths, and non-functional CTAs.
- 📊 **Immediate Visual Reporting:** Injects a clean, interactive side-panel right on the target page, with JSON export and local server logging.

---

## 2. Sprint Demo Agenda & Timing

| Time | Agenda Item | Key Objective |
|---|---|---|
| **00:00 - 02:00** | Problem Context & Architecture | Explain why external QA scripts fail on AEM & why bookmarklets win |
| **02:00 - 07:00** | **Live Demonstration** | Run bookmarklet on live page, review 4 pillars, inspect defects |
| **07:00 - 10:00** | Real-World Defect Showcase | Walk through real defects caught on KONE.com (H1, /content/ leaks) |
| **10:00 - 13:00** | Technical Highlights & Scoring | Explain P1 hard-block rules, async link algorithm & scoring engine |
| **13:00 - 15:00** | Q&A & Next Steps Roadmap | Address stakeholder questions & discuss Phase 2 CI integration |

---

## 3. Live Demo Script (Step-by-Step Walkthrough)

### Setup Before Presentation
1. Open Google Chrome.
2. Ensure the `[AEM QA]` bookmarklet is visible in your Bookmarks Bar.
3. Open the target AEM page:
   - *Example AEM Author URL:* `https://author-p156420-e1658594.adobeaemcloud.com/content/frontlines/us-temp/en/elevators-escalators.html?wcmmode=disabled`
   - *Alternative Public URL:* `https://www.kone.com`

---

### Step 1: Trigger the Audit (Presenter Script)
> *"Notice I'm on an authenticated AEM author preview page with `wcmmode=disabled`. Normally, running automated tools here requires configuring test users, proxying OAuth tokens, or handling IMS login flows. Watch what happens when I click our bookmarklet..."*

👉 **Action:** Click **`[AEM QA]`** in the bookmarks bar.

---

### Step 2: Highlight the Instant Injected Panel
> *"Within milliseconds, the tool injects a lightweight, isolated side-panel on the right side of the screen. Notice that while I'm talking, it's running Phase 1 synchronous DOM checks, and right now in the background, Phase 2 is asynchronously batch-fetching all internal links and CTA destinations using the browser's active session."*

👉 **Point Out:**
- The top header displaying current URL, hostname, and timestamp.
- The real-time progress bar showing link verification (`Checking links... 24/34`).

---

### Step 3: Walk Through the 4 Pillars & Scorecard
> *"Our framework evaluates pages against 52 standardized criteria organized into 4 core pillars:"*

1. **Page Properties & Metadata (25% Weight):** Validates Title length, Meta Description, Canonical URL matching, `<html lang>`, and OpenGraph tags.
2. **Content & Components (35% Weight - Highest Priority):** Evaluates H1 uniqueness, heading hierarchy, image alt attributes, and deeply audits **Internal Links and CTAs**.
3. **Responsive Layout (15% Weight):** Checks viewport meta, horizontal scroll overflow at key breakpoints, touch target size (44x44px), and `srcset` coverage.
4. **Accessibility / WCAG 2.1 AA (25% Weight):** Verifies skip navigation, contrast ratios, focus indicators, ARIA roles, and empty anchor tags.

---

### Step 4: Demonstrate Real Defects Found (The "Wow" Moment)
> *"Let's expand the **Content & Components** accordion to see what the tool caught on this live page..."*

👉 **Show & Explain Real Findings:**

- 🔴 **P1 Fail - Missing `<h1>`:** *"The tool flagged that this page has ZERO `<h1>` elements. The hero title was implemented as a `<p class="cmp-teaser__title">`. This is an immediate SEO and accessibility blocker."*
- 🔴 **P1 Fail - Exposed AEM Content Path:** *"Look at check C-09. It caught a link pointing directly to `/content/frontlines/master/en/find-your-solution.html`. On production, raw author paths like this break for end users because vanity URLs weren't resolved."*
- 🟠 **P2 Fail - Invalid `alt/` Syntax:** *"Notice check C-06. The tool detected 8 navigation images containing `alt/` instead of `alt=""`. This is a known AEM Core Component authoring glitch that breaks screen readers."*
- 🔴 **P1 Hard-Block Trigger:** *"Notice our score is 77/100, but even if the score were 95/100, the tool displays a bold red alert: **`BLOCK GO-LIVE — P1 Failures Detected`**. In our framework, P1 failures are non-negotiable go/no-go blockers."*

---

### Step 5: Responsive Quick-View & Export
> *"To help authors test layouts quickly without opening DevTools..."*

👉 **Action:**
1. Click **`[Open 375px ↗]`** in the Responsive section → Opens a 375x812 mobile popup window instantly.
2. Click **`[📤 Export JSON]`** → Downloads formatted JSON report.
3. Click **`[📋 Copy Report]`** → Show how easily a QA engineer can paste a Markdown defect summary directly into Jira or Slack.

---

## 4. Technical Deep-Dive for Developers & Tech Leads

If developers or architects ask technical questions during the demo, use these talking points:

### Architecture Highlights
```
┌─────────────────────────────────────────────────────────────┐
│                   BROWSER PAGE CONTEXT                      │
│                                                             │
│   bookmarklet.js (Pure Vanilla JS, 0 Third-Party Dependencies)│
│   ├── DOM Scanner (Sync) → Headings, Meta, ARIA, Responsive  │
│   ├── Link Verifier (Async) → Batched fetch(HEAD) [5 at a time]│
│   ├── Scoring Engine → Weight-adjusted calculation + P1 Gate │
│   └── Panel UI Engine → Shadow DOM style isolation           │
└─────────────────────────────────────────────────────────────┘
```

1. **Zero Third-Party Dependencies:** Built entirely with native Web APIs (`querySelector`, `getComputedStyle`, `fetch`, `AbortController`). Zero npm packages, zero bundle bloat.
2. **Session Inheritance:** Executes within the current window context, leveraging browser-managed cookies/tokens natively.
3. **Async Batch Fetcher:** Internal link checking runs in batches of 5 concurrent requests with a 5-second abort timeout per link to prevent performance bottlenecking or UI locking.
4. **Site-Agnostic Selectors:** Easily adaptable to any AEM design system by tweaking the `CONFIG.selectors` map (e.g., matching `.cmp-button`, `.kone-button`, or custom clientlib classes).

---

## 5. Frequently Asked Questions (QA & PO Cheat Sheet)

### Q1: Does this require installing anything on local machines?
> **Answer:** No. It's a single bookmark in your browser's bookmark bar. No `npm install`, no permissions setup, no browser extensions required.

### Q2: How does this handle AEM Author authentication?
> **Answer:** Because it runs as a bookmarklet inside your active browser tab, every HTTP `fetch()` call made by the script automatically sends your active AEM session cookies (`credentials: 'include'`).

### Q3: Can we customize checks for our specific project components?
> **Answer:** Yes. The framework uses a modular `CONFIG.selectors` object. Adding custom component rules (like checking Adobe Analytics datalayer attributes or specific hero banners) takes less than 10 lines of vanilla JavaScript.

### Q4: Can this report be logged centrally for audit trails?
> **Answer:** Yes. The bottom bar includes a **`[📡 Send to Server]`** button that POSTs the full JSON audit payload to an optional lightweight Node.js server (`server.js`) running on `localhost:3500` or a shared team server.

---

## 6. Sprint Outcomes & Next Steps

### What We Completed This Sprint (Phase 1)
- [x] Defined 49-point 4-Pillar QA specification mapped to AEM Core Components & WCAG 2.1 AA.
- [x] Created zero-dependency bookmarklet engine (`bookmarklet.js` & `build-bookmarklet.js`).
- [x] Built async link & CTA verification engine with batching and timeout protection.
- [x] Implemented instant visual overlay panel with Go/No-Go status calculation.
- [x] Tested and verified against live KONE AEM production & preview pages.

### Upcoming Next Steps (Phase 2 & Phase 3)
1. **Phase 2 (Report Aggregator):** Deploy central Node.js report listener (`server.js`) with web UI for tracking page score history over time.
2. **Phase 3 (CI/CD Quality Gate):** Wrap the core check engine into a headless CLI tool for automated pull request checks before merging AEM code.

---

### Demo Wrap-Up Prompt
> *"Thank you! The technical guide and build scripts are saved in `AEM_QA_FRAMEWORK_GUIDE.md`. I'm ready to answer any questions or show specific check implementations in detail."*
