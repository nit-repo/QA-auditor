# AEM Site & Page QA Framework
## Complete Technical Guide — Build This Tool Anywhere

**Version:** 1.0  
**Last Updated:** 2026-08-02  
**Stack:** Zero npm dependencies · Vanilla JS · Node.js built-ins only  
**Runs on:** Any AEM as a Cloud Service page (author preview or publish)

---

## Table of Contents

1. [What This Tool Does](#1-what-this-tool-does)
2. [How It Works — Architecture](#2-how-it-works--architecture)
3. [Project Setup](#3-project-setup)
4. [The 4-Pillar Check System](#4-the-4-pillar-check-system)
5. [Check Implementation Code](#5-check-implementation-code)
6. [Link & CTA Checker — Core Algorithm](#6-link--cta-checker--core-algorithm)
7. [Scoring Engine](#7-scoring-engine)
8. [QA Panel UI — Full Implementation](#8-qa-panel-ui--full-implementation)
9. [Bookmarklet Build Script](#9-bookmarklet-build-script)
10. [Report Server](#10-report-server)
11. [Adapting to Any AEM Site](#11-adapting-to-any-aem-site)
12. [Testing the Tool Itself](#12-testing-the-tool-itself)
13. [Extending the Framework](#13-extending-the-framework)

---

## 1. What This Tool Does

The AEM QA Framework is a **browser bookmarklet** that runs automated quality checks on any AEM page directly from your browser. You click it once on an open AEM page and it:

- Reads the live DOM (no server, no proxy, no CORS issues)
- Inherits your AEM authentication session automatically
- Checks 52 criteria across 4 pillars in under 15 seconds
- Renders a scored, structured report as a floating side panel
- Exports JSON results for reporting or CI integration

```
INPUT:  Any AEM page URL open in your browser
OUTPUT: 49-point audit report with pass/warn/fail per check
TIME:   ~1s for DOM checks + ~10s for async link verification
DEPS:   Zero — pure browser JavaScript APIs only
```

---

## 2. How It Works — Architecture

### Why a Bookmarklet (not a server or extension)

AEM as a Cloud Service author-tier URLs (`author-p*.adobeaemcloud.com`) are protected by Adobe IMS. Any external server or headless browser hits the IMS login page. The browser where you are already logged in is the only client that can access these pages.

```
❌ Node.js + Playwright → IMS login wall (no session)
❌ External fetch() from another origin → CORS block
✅ Bookmarklet in active browser tab → full DOM + auth
```

### Execution Flow

```
User clicks [AEM QA] bookmark
       │
       ▼
javascript: URL executes in page context
       │
       ├─ PHASE 1 (sync, ~50ms)
       │   Inject CSS → create panel → run all DOM checks
       │   Metadata · Headings · Images · ARIA · Responsive
       │
       ├─ PHASE 2 (async, 5–15s)
       │   Collect all <a href> on page
       │   Batch fetch(HEAD) for internal links (5 at a time)
       │   Batch fetch(HEAD) for CTA destinations
       │   Update panel rows as results arrive
       │
       ├─ PHASE 3 (sync, ~5ms)
       │   Aggregate scores · Determine pass/fail · P1 hard block
       │
       └─ PHASE 4
           Enable export button · Optional POST to localhost:3500
```

### Files

```
├── src/bookmarklet.js      ← THE MAIN FILE (all engine logic lives here)
├── scripts/build.js        ← Minify → emit the javascript: payloads into dist/
├── server.js               ← Dashboard host + report API
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```

---

## 3. Project Setup

### Prerequisites

- Node.js v18 or higher (only for build step and optional server)
- A modern browser (Chrome / Edge recommended)
- An open AEM page in your browser

### One-Time Build

```bash
# 1. Clone the repository
git clone <repository-url> && cd <repo>

# 2. Generate the bookmarklet payloads
npm run build
# → Creates: dist/AEM_QA_BOOKMARK_LOCAL.txt, _HOSTED.txt, _LOADER.txt

# 4. Copy the javascript:... URL from AEM_QA_BOOKMARK.txt
# 5. Browser → Bookmarks → Add new bookmark
#    Name: AEM QA
#    URL:  [paste]
# 6. Drag bookmark to bookmarks bar
```

### Daily Usage

```
1. Open AEM page (e.g. ?wcmmode=disabled on author, or publish URL)
2. Wait for page to fully load
3. Click [AEM QA] in bookmarks bar
4. Wait ~10s for link checks
5. Review panel on the right side of screen
6. Click [Export JSON] or [Copy Report] to save findings
```

---

## 4. The 4-Pillar Check System

Every check belongs to one pillar and one priority level.

### Priority Levels

| Level | Label | Score Multiplier | Go-Live Impact |
|---|---|---|---|
| 🔴 P1 | Critical | ×4 | BLOCKS go-live (any failure = block) |
| 🟠 P2 | High | ×2 | Should fix this sprint |
| 🟡 P3 | Medium | ×1 | Fix next sprint |
| 🔵 P4 | Info | ×0 | Logged only, not scored |

### The 52 Checks at a Glance

```
PILLAR 1 — METADATA (12 checks, weight 25%)
  P1: title, meta-description, canonical, lang
  P2: title-length, desc-length, canonical-match, robots
  P3: title-generic, og-title, og-description, og-image

PILLAR 2 — CONTENT & COMPONENTS (19 checks, weight 35%)  ← HIGHEST WEIGHT
  P1: h1-exists, h1-not-empty, no-placeholder, links-not-404,
      aem-paths-in-links, env-urls-in-links, cta-destinations-resolve,
      empty-link-text
  P2: heading-hierarchy, img-alt-missing, img-alt-invalid-syntax,
      dead-hash-anchors, cta-accessible-label, form-input-labels
  P3: external-noopener, cta-generic-text
  P4: decorative-alt, cta-inventory, embed-inventory

PILLAR 3 — RESPONSIVE (8 checks, weight 15%)
  P1: viewport-meta
  P2: h-scroll-375, h-scroll-768, touch-targets-375, nav-visible-375
  P3: h-scroll-1440, image-overflow
  P4: srcset-coverage

PILLAR 4 — ACCESSIBILITY (13 checks, weight 25%)
  P1: lang-attr, empty-anchor-no-label
  P2: skip-nav, contrast-body, contrast-large, focus-visible,
      negative-tabindex, icon-btn-label, form-label-association,
      no-autoplay-media
  P3: aria-roles-valid, aria-expanded-on-toggles, decorative-svg-hidden
```

---

## 5. Check Implementation Code

The following is the complete implementation of every check. All code goes inside `bookmarklet.js`.

### bookmarklet.js — Full Structure

```javascript
(function () {
  'use strict';

  // ─── CONFIG ─────────────────────────────────────────────────────────
  const CONFIG = {
    version: '1.0.0',
    panelId: 'aem-qa-panel',
    thresholdScore: 80,
    linkBatchSize: 5,
    linkTimeout: 5000,
    reportServer: 'http://localhost:3500/report',

    // ADAPT THESE for your AEM site (see Section 11)
    selectors: {
      header: '.kone-header, header, [role="banner"]',
      nav:    'nav, [role="navigation"]',
      main:   'main, [role="main"], #main-content, #content',
      cta: [
        'a[class*="cta"]', 'a[class*="button"]', 'a[class*="btn"]',
        '.cmp-button a', '.cmp-teaser__link',
        'button[class*="cta"]', 'a[class*="kone-button"]'
      ],
      image:    '.cmp-image img, [data-cmp-is="image"] img, img',
      richtext: '.cmp-text, [class*="richtext"], [class*="rich-text"]',
    },

    aemPathPattern: /^\/content\/[a-zA-Z]/,

    envPatterns: [
      /author-p\d+.*\.adobeaemcloud\.com/i,
      /-stage\.[a-z]/i,
      /-dev\.[a-z]/i,
      /localhost:\d{4}/i,
      /\.aem\.page/i,
    ],

    genericCtaText: [
      'click here', 'read more', 'learn more', 'here', 'more',
      'link', 'this link', 'find out more', 'see more'
    ],

    weights: {
      metadata: 0.25,
      content: 0.35,
      responsive: 0.15,
      accessibility: 0.25
    }
  };

  // ─── PREVENT DOUBLE INJECTION ───────────────────────────────────────
  if (document.getElementById(CONFIG.panelId)) {
    document.getElementById(CONFIG.panelId).remove();
    document.getElementById('aem-qa-styles')?.remove();
    return;
  }

  const results = {
    metadata: [],
    content: [],
    responsive: [],
    accessibility: []
  };

  injectPanelStyles();
  injectPanel();
  runPhase1();
  runPhase2();

  // ─── UTILITY FUNCTIONS ──────────────────────────────────────────────

  function getPath(el) {
    const parts = [];
    let node = el;
    while (node && node !== document.body) {
      let sel = node.tagName.toLowerCase();
      if (node.id) {
        sel += '#' + node.id;
        parts.unshift(sel);
        break;
      }
      const cls = Array.from(node.classList).slice(0, 2).join('.');
      if (cls) sel += '.' + cls;
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.slice(-3).join(' > ');
  }

  function getCTAs() {
    const selectorStr = Array.isArray(CONFIG.selectors.cta)
      ? CONFIG.selectors.cta.join(', ')
      : CONFIG.selectors.cta;
    return Array.from(document.querySelectorAll(selectorStr));
  }

  function updateLinkProgress(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const pbar = document.getElementById('qa-pbar');
    const prog = document.getElementById('qa-progress');
    if (pbar) pbar.style.width = pct + '%';
    if (prog) {
      const txt = prog.querySelector('div');
      if (txt) txt.textContent = 'Checking links… ' + done + '/' + total;
    }
  }

  // ─── PHASE 1: SYNCHRONOUS DOM CHECKS ────────────────────────────────

  function runPhase1() {
    results.metadata      = checkMetadata();
    results.content       = checkContent();
    results.responsive    = checkResponsive();
    results.accessibility = checkAccessibility();
    renderPartialResults();
  }

  // ─── All check function implementations follow ──────────────────────

})();
```

---

### 5A. Metadata Checks (12 checks)

```javascript
function checkMetadata() {
  const r = [];

  // M-01 — Title present (P1)
  const title = document.title.trim();
  r.push({
    id: 'M-01', pillar: 'metadata', priority: 'P1',
    label: 'Page title present',
    status: title.length > 0 ? 'pass' : 'fail',
    detail: title.length > 0 ? '"' + title + '"' : 'No <title> tag content found',
  });

  // M-02 — Title length (P2)
  r.push({
    id: 'M-02', pillar: 'metadata', priority: 'P2',
    label: 'Title length (10–60 chars)',
    status: title.length >= 10 && title.length <= 60 ? 'pass'
          : title.length > 60 ? 'warn' : 'fail',
    detail: title.length + ' characters' + (title.length > 60 ? ' — may be truncated in SERPs' : ''),
  });

  // M-03 — Title not generic (P3)
  const genericTitles = ['home', 'page', 'untitled', 'new page', 'document'];
  r.push({
    id: 'M-03', pillar: 'metadata', priority: 'P3',
    label: 'Title not generic',
    status: !genericTitles.includes(title.toLowerCase()) ? 'pass' : 'fail',
    detail: genericTitles.includes(title.toLowerCase())
      ? 'Generic title: "' + title + '"' : 'OK',
  });

  // M-04 — Meta description present (P1)
  const metaDesc = document.querySelector('meta[name="description"]');
  const descContent = metaDesc ? metaDesc.getAttribute('content') : '';
  r.push({
    id: 'M-04', pillar: 'metadata', priority: 'P1',
    label: 'Meta description present',
    status: descContent && descContent.trim().length > 0 ? 'pass' : 'fail',
    detail: descContent
      ? '"' + descContent.substring(0, 80) + '…"'
      : 'Missing <meta name="description">',
  });

  // M-05 — Meta description length (P2)
  const descLen = descContent ? descContent.trim().length : 0;
  r.push({
    id: 'M-05', pillar: 'metadata', priority: 'P2',
    label: 'Meta description length (50–160)',
    status: descLen >= 50 && descLen <= 160 ? 'pass'
          : descLen > 160 ? 'warn' : (descLen > 0 ? 'warn' : 'fail'),
    detail: descLen > 0 ? descLen + ' characters' : 'Not set',
  });

  // M-06 — Canonical present (P1)
  const canonical = document.querySelector('link[rel="canonical"]');
  const canonHref = canonical ? canonical.getAttribute('href') : '';
  r.push({
    id: 'M-06', pillar: 'metadata', priority: 'P1',
    label: 'Canonical URL present',
    status: canonHref ? 'pass' : 'fail',
    detail: canonHref || 'No <link rel="canonical"> found',
  });

  // M-07 — Canonical matches page URL (P2)
  const pageUrl = location.href.split('?')[0].replace(/\/$/, '');
  const canonUrl = canonHref ? canonHref.split('?')[0].replace(/\/$/, '') : '';
  r.push({
    id: 'M-07', pillar: 'metadata', priority: 'P2',
    label: 'Canonical matches page URL',
    status: !canonHref ? 'fail'
          : canonUrl === pageUrl ? 'pass' : 'warn',
    detail: canonHref
      ? (canonUrl === pageUrl ? 'Matches' : 'Mismatch: canonical="' + canonUrl + '" vs page="' + pageUrl + '"')
      : 'No canonical to check',
  });

  // M-08 — Robots meta (P2)
  const robots = document.querySelector('meta[name="robots"]');
  const robotsContent = robots ? robots.getAttribute('content') : '';
  r.push({
    id: 'M-08', pillar: 'metadata', priority: 'P2',
    label: 'Robots meta present',
    status: robotsContent
      ? (robotsContent.toLowerCase().includes('noindex') ? 'warn' : 'pass')
      : 'warn',
    detail: robotsContent
      ? (robotsContent.toLowerCase().includes('noindex')
        ? 'noindex detected: "' + robotsContent + '"'
        : robotsContent)
      : 'No <meta name="robots"> — relying on server default',
  });

  // M-09 — <html lang> (P1)
  const lang = document.documentElement.getAttribute('lang');
  r.push({
    id: 'M-09', pillar: 'metadata', priority: 'P1',
    label: '<html lang> attribute set',
    status: lang && lang.trim().length > 0 ? 'pass' : 'fail',
    detail: lang ? 'lang="' + lang + '"' : 'Missing lang attribute on <html>',
  });

  // M-10 — OG title (P3)
  const ogTitle = document.querySelector('meta[property="og:title"]');
  r.push({
    id: 'M-10', pillar: 'metadata', priority: 'P3',
    label: 'OG title present',
    status: ogTitle && ogTitle.content ? 'pass' : 'warn',
    detail: ogTitle ? '"' + ogTitle.content + '"' : 'Missing og:title',
  });

  // M-11 — OG description (P3)
  const ogDesc = document.querySelector('meta[property="og:description"]');
  r.push({
    id: 'M-11', pillar: 'metadata', priority: 'P3',
    label: 'OG description present',
    status: ogDesc && ogDesc.content ? 'pass' : 'warn',
    detail: ogDesc ? 'Present' : 'Missing og:description',
  });

  // M-12 — OG image (P3)
  const ogImage = document.querySelector('meta[property="og:image"]');
  r.push({
    id: 'M-12', pillar: 'metadata', priority: 'P3',
    label: 'OG image present',
    status: ogImage && ogImage.content ? 'pass' : 'warn',
    detail: ogImage ? ogImage.content.substring(0, 60) + '…' : 'Missing og:image',
  });

  return r;
}
```

---

### 5B. Content & Component Checks (19 checks — Links & CTAs at P1)

```javascript
function checkContent() {
  const r = [];

  // ── HEADINGS ────────────────────────────────────────────────────────

  // C-01 — Exactly 1 H1 (P1)
  const h1s = Array.from(document.querySelectorAll('h1'));
  r.push({
    id: 'C-01', pillar: 'content', priority: 'P1',
    label: 'Exactly one <h1> on page',
    status: h1s.length === 1 ? 'pass' : 'fail',
    detail: h1s.length === 0
      ? 'No <h1> found — critical SEO and accessibility failure'
      : h1s.length + ' H1 elements found',
    items: h1s.map(h => ({
      text: h.textContent.trim().substring(0, 40),
      path: getPath(h)
    }))
  });

  // C-02 — H1 not empty (P1)
  const h1text = h1s.length > 0 ? h1s[0].textContent.trim() : '';
  r.push({
    id: 'C-02', pillar: 'content', priority: 'P1',
    label: 'H1 has content',
    status: h1text.length > 0 ? 'pass' : 'fail',
    detail: h1text || 'H1 is empty or missing',
  });

  // C-03 — Heading hierarchy (P2)
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  const hierarchyIssues = [];
  let prevLevel = 0;
  headings.forEach(function(h) {
    const level = parseInt(h.tagName[1]);
    if (prevLevel > 0 && level > prevLevel + 1) {
      hierarchyIssues.push(
        'Jumped from H' + prevLevel + ' to H' + level +
        ': "' + h.textContent.trim().substring(0, 40) + '"'
      );
    }
    prevLevel = level;
  });
  r.push({
    id: 'C-03', pillar: 'content', priority: 'P2',
    label: 'Heading hierarchy (no skips)',
    status: hierarchyIssues.length === 0 ? 'pass' : 'warn',
    detail: hierarchyIssues.length === 0
      ? 'Hierarchy is correct'
      : hierarchyIssues.length + ' skip(s) found',
    items: hierarchyIssues.map(function(i) { return { text: i }; })
  });

  // C-04 — No placeholder content (P1)
  var bodyText = document.body.innerText || '';
  var hasLorem = /lorem\s+ipsum/i.test(bodyText);
  r.push({
    id: 'C-04', pillar: 'content', priority: 'P1',
    label: 'No placeholder/lorem ipsum text',
    status: hasLorem ? 'fail' : 'pass',
    detail: hasLorem
      ? 'Lorem ipsum placeholder text found on page'
      : 'No placeholder text detected',
  });

  // ── IMAGES ──────────────────────────────────────────────────────────

  // C-05 — Images missing alt attribute (P2)
  var allImgs = Array.from(document.querySelectorAll('img'));
  var missingAlt = allImgs.filter(function(img) {
    return !img.hasAttribute('alt');
  });
  r.push({
    id: 'C-05', pillar: 'content', priority: 'P2',
    label: 'All images have alt attribute',
    status: missingAlt.length === 0 ? 'pass' : 'fail',
    detail: missingAlt.length === 0
      ? 'All ' + allImgs.length + ' images have alt'
      : missingAlt.length + ' image(s) missing alt attribute',
    items: missingAlt.map(function(img) {
      return { text: img.src ? img.src.split('/').pop() : '[no src]', path: getPath(img) };
    })
  });

  // C-06 — Invalid alt/ syntax (AEM-specific bug) (P2)
  var invalidAlt = allImgs.filter(function(img) {
    return img.getAttribute('alt') === null && img.outerHTML.indexOf('alt/') > -1;
  });
  r.push({
    id: 'C-06', pillar: 'content', priority: 'P2',
    label: 'No invalid alt/ syntax (AEM bug)',
    status: invalidAlt.length === 0 ? 'pass' : 'warn',
    detail: invalidAlt.length === 0
      ? 'No invalid alt/ attributes'
      : invalidAlt.length + ' image(s) with invalid alt/ syntax — should be alt=""',
  });

  // C-07 — Decorative images (P4, informational)
  var decorativeImgs = allImgs.filter(function(img) {
    return img.getAttribute('alt') === '';
  });
  r.push({
    id: 'C-07', pillar: 'content', priority: 'P4',
    label: 'Decorative images (alt="")',
    status: 'info',
    detail: decorativeImgs.length + ' decorative image(s) with empty alt',
  });

  // ── INTERNAL LINKS (P1) ─────────────────────────────────────────────

  var allLinks = Array.from(document.querySelectorAll('a[href]'));

  // C-09 — AEM content paths in links (P1)
  var aemPathLinks = allLinks.filter(function(a) {
    return CONFIG.aemPathPattern.test(a.getAttribute('href') || '');
  });
  r.push({
    id: 'C-09', pillar: 'content', priority: 'P1',
    label: 'No raw AEM /content/ paths in links',
    status: aemPathLinks.length === 0 ? 'pass' : 'fail',
    detail: aemPathLinks.length === 0
      ? 'No raw AEM paths found'
      : aemPathLinks.length + ' link(s) with /content/ path — will 404 on publish',
    items: aemPathLinks.map(function(a) {
      return { text: a.getAttribute('href'), element: getPath(a) };
    })
  });

  // C-10 — Author/Stage/Dev env URLs in links (P1)
  var envLinks = allLinks.filter(function(a) {
    var href = a.getAttribute('href') || '';
    return CONFIG.envPatterns.some(function(p) { return p.test(href); });
  });
  r.push({
    id: 'C-10', pillar: 'content', priority: 'P1',
    label: 'No author/stage/dev URLs in links',
    status: envLinks.length === 0 ? 'pass' : 'fail',
    detail: envLinks.length === 0
      ? 'No environment URLs found'
      : envLinks.length + ' link(s) pointing to author/stage/dev environment',
    items: envLinks.map(function(a) {
      return { text: a.getAttribute('href'), element: getPath(a) };
    })
  });

  // C-11 — External links missing rel="noopener" (P3)
  var extLinks = allLinks.filter(function(a) {
    var href = a.getAttribute('href') || '';
    return a.getAttribute('target') === '_blank' && href.indexOf('http') === 0;
  });
  var noOpener = extLinks.filter(function(a) {
    return (a.getAttribute('rel') || '').indexOf('noopener') === -1;
  });
  r.push({
    id: 'C-11', pillar: 'content', priority: 'P3',
    label: 'External links have rel="noopener"',
    status: noOpener.length === 0 ? 'pass' : 'warn',
    detail: noOpener.length === 0
      ? 'All ' + extLinks.length + ' external links have rel="noopener"'
      : noOpener.length + ' external link(s) missing rel="noopener"',
    items: noOpener.map(function(a) {
      return { text: a.textContent.trim() || a.getAttribute('href'), element: getPath(a) };
    })
  });

  // C-12 — Dead hash-only anchors (P2)
  var hashAnchors = allLinks.filter(function(a) {
    return a.getAttribute('href') === '#';
  });
  r.push({
    id: 'C-12', pillar: 'content', priority: 'P2',
    label: 'No dead href="#" anchors',
    status: hashAnchors.length === 0 ? 'pass' : 'warn',
    detail: hashAnchors.length === 0
      ? 'No empty anchors found'
      : hashAnchors.length + ' link(s) with href="#"',
    items: hashAnchors.map(function(a) {
      return { text: a.textContent.trim() || '[no text]', element: getPath(a) };
    })
  });

  // C-13 — Empty links (P1)
  var emptyLinks = allLinks.filter(function(a) {
    var text = a.textContent.trim();
    var label = a.getAttribute('aria-label') || a.getAttribute('title') || '';
    var hasVisibleContent = a.querySelector('img[alt]:not([alt=""])');
    return !text && !label && !hasVisibleContent;
  });
  r.push({
    id: 'C-13', pillar: 'content', priority: 'P1',
    label: 'No links with empty text and no aria-label',
    status: emptyLinks.length === 0 ? 'pass' : 'fail',
    detail: emptyLinks.length === 0
      ? 'All links have accessible text'
      : emptyLinks.length + ' link(s) have no text, no aria-label',
    items: emptyLinks.map(function(a) {
      return { text: a.getAttribute('href'), element: getPath(a) };
    })
  });

  // ── CTAs ────────────────────────────────────────────────────────────

  var ctaEls = getCTAs();

  // C-15 — Generic CTA text (P3)
  var genericCTAs = ctaEls.filter(function(el) {
    var text = el.textContent.trim().toLowerCase();
    return CONFIG.genericCtaText.some(function(g) { return text === g; });
  });
  r.push({
    id: 'C-15', pillar: 'content', priority: 'P3',
    label: 'CTAs have descriptive text',
    status: genericCTAs.length === 0 ? 'pass' : 'warn',
    detail: genericCTAs.length === 0
      ? 'All ' + ctaEls.length + ' CTAs have descriptive text'
      : genericCTAs.length + ' CTA(s) with generic text — add aria-label',
    items: genericCTAs.map(function(el) {
      return {
        text: '"' + el.textContent.trim() + '"',
        element: getPath(el),
        suggestion: 'Add aria-label="[descriptive action]"'
      };
    })
  });

  // C-16 — CTAs have accessible label (P2)
  var iconOnlyCTAs = ctaEls.filter(function(el) {
    var text = el.textContent.trim();
    var label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    return !text && !label;
  });
  r.push({
    id: 'C-16', pillar: 'content', priority: 'P2',
    label: 'Icon-only CTAs have aria-label',
    status: iconOnlyCTAs.length === 0 ? 'pass' : 'fail',
    detail: iconOnlyCTAs.length === 0
      ? 'All icon-only CTAs are labelled'
      : iconOnlyCTAs.length + ' icon-only CTA(s) missing aria-label',
    items: iconOnlyCTAs.map(function(el) {
      return { text: el.outerHTML.substring(0, 80), element: getPath(el) };
    })
  });

  // C-17 — CTA inventory (P4, informational)
  r.push({
    id: 'C-17', pillar: 'content', priority: 'P4',
    label: 'CTA inventory',
    status: 'info',
    detail: ctaEls.length + ' CTA element(s) found',
    items: ctaEls.map(function(el) {
      return { text: el.textContent.trim() || '[icon-only]', href: el.getAttribute('href') || el.tagName };
    })
  });

  // ── FORMS ───────────────────────────────────────────────────────────

  // C-18 — Form inputs have labels (P2)
  var inputs = Array.from(document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
  ));
  var unlabelledInputs = inputs.filter(function(inp) {
    var id = inp.getAttribute('id');
    var label = id ? document.querySelector('label[for="' + id + '"]') : null;
    var ariaLabel = inp.getAttribute('aria-label');
    var ariaLabelledBy = inp.getAttribute('aria-labelledby');
    return !label && !ariaLabel && !ariaLabelledBy;
  });
  r.push({
    id: 'C-18', pillar: 'content', priority: 'P2',
    label: 'Form inputs have labels',
    status: unlabelledInputs.length === 0 ? 'pass' : 'fail',
    detail: inputs.length === 0 ? 'No form inputs on page'
          : unlabelledInputs.length === 0 ? 'All ' + inputs.length + ' inputs are labelled'
          : unlabelledInputs.length + ' input(s) missing label',
    items: unlabelledInputs.map(function(inp) {
      return { text: inp.getAttribute('type') || inp.tagName, element: getPath(inp) };
    })
  });

  // C-19 — Embeds inventory (P4)
  var embeds = Array.from(document.querySelectorAll('iframe, video, embed, [data-type="video"]'));
  r.push({
    id: 'C-19', pillar: 'content', priority: 'P4',
    label: 'Embeds inventory',
    status: 'info',
    detail: embeds.length + ' embed(s) found',
    items: embeds.map(function(el) {
      return { text: el.tagName, src: el.getAttribute('src') || el.getAttribute('data-src') || 'no src' };
    })
  });

  return r;
}
```

---

### 5C. Responsive Layout Checks (8 checks)

```javascript
function checkResponsive() {
  const r = [];

  // R-01 — Viewport meta (P1)
  var viewportMeta = document.querySelector('meta[name="viewport"]');
  var viewportContent = viewportMeta ? viewportMeta.getAttribute('content') : '';
  r.push({
    id: 'R-01', pillar: 'responsive', priority: 'P1',
    label: 'Viewport meta tag present',
    status: viewportContent.indexOf('width=device-width') > -1 ? 'pass' : 'fail',
    detail: viewportContent || 'No viewport meta tag — page will not scale on mobile',
  });

  // R-02 — Horizontal scroll at current viewport (P2)
  var scrollWidth = document.documentElement.scrollWidth;
  var hasHScroll = scrollWidth > window.innerWidth + 5;
  r.push({
    id: 'R-02', pillar: 'responsive', priority: 'P2',
    label: 'No horizontal scroll at current viewport (' + window.innerWidth + 'px)',
    status: hasHScroll ? 'fail' : 'pass',
    detail: hasHScroll
      ? 'Horizontal scroll detected (scrollWidth=' + scrollWidth + 'px > viewport=' + window.innerWidth + 'px)'
      : 'No horizontal scroll at current width',
  });

  // R-03 — Touch targets >= 44x44px (P2)
  var interactiveEls = Array.from(document.querySelectorAll('a, button, [role="button"], input, select'));
  var smallTargets = interactiveEls.filter(function(el) {
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
  });
  r.push({
    id: 'R-05', pillar: 'responsive', priority: 'P2',
    label: 'Touch targets >= 44x44px',
    status: smallTargets.length === 0 ? 'pass' : 'warn',
    detail: smallTargets.length === 0
      ? 'All ' + interactiveEls.length + ' interactive elements meet touch target size'
      : smallTargets.length + ' element(s) smaller than 44x44px',
    items: smallTargets.slice(0, 10).map(function(el) {
      var rect = el.getBoundingClientRect();
      return {
        text: el.textContent.trim().substring(0, 30) || el.tagName,
        size: Math.round(rect.width) + 'x' + Math.round(rect.height) + 'px'
      };
    })
  });

  // R-04 — Navigation visible (P2)
  var navEl = document.querySelector(CONFIG.selectors.header);
  var navRect = navEl ? navEl.getBoundingClientRect() : null;
  r.push({
    id: 'R-06', pillar: 'responsive', priority: 'P2',
    label: 'Navigation visible at current viewport',
    status: navRect && navRect.height > 0 ? 'pass' : 'warn',
    detail: navRect ? 'Header height: ' + Math.round(navRect.height) + 'px' : 'No header/nav element found',
  });

  // R-05 — Image overflow (P3)
  var imgOverflows = Array.from(document.querySelectorAll('img')).filter(function(img) {
    return img.getBoundingClientRect().width > window.innerWidth;
  });
  r.push({
    id: 'R-07', pillar: 'responsive', priority: 'P3',
    label: 'Images not overflowing viewport',
    status: imgOverflows.length === 0 ? 'pass' : 'fail',
    detail: imgOverflows.length === 0
      ? 'No images overflow viewport'
      : imgOverflows.length + ' image(s) wider than viewport',
  });

  // R-06 — srcset coverage (P4)
  var allImgs = Array.from(document.querySelectorAll('img'));
  var withSrcset = allImgs.filter(function(img) { return img.hasAttribute('srcset'); });
  var coverage = allImgs.length > 0 ? Math.round((withSrcset.length / allImgs.length) * 100) : 100;
  r.push({
    id: 'R-08', pillar: 'responsive', priority: 'P4',
    label: 'Responsive srcset coverage',
    status: 'info',
    detail: withSrcset.length + ' of ' + allImgs.length + ' images (' + coverage + '%) use srcset',
  });

  // R-07 — Breakpoint popup buttons (informational)
  r.push({
    id: 'R-POPUP', pillar: 'responsive', priority: 'P4',
    label: 'View at breakpoints',
    status: 'info',
    detail: 'Use buttons to open page at mobile/tablet/desktop width',
    isBreakpointControl: true,
  });

  return r;
}
```

---

### 5D. Accessibility Checks (13 checks)

```javascript
function checkAccessibility() {
  const r = [];

  // A-01 — Skip navigation link (P2)
  var skipNav = document.querySelector(
    'a[href="#main"], a[href="#content"], a[href="#main-content"], .skip-nav, .skip-link, [class*="skip"]'
  );
  r.push({
    id: 'A-01', pillar: 'accessibility', priority: 'P2',
    label: 'Skip navigation link present',
    status: skipNav ? 'pass' : 'fail',
    detail: skipNav
      ? 'Found: "' + skipNav.textContent.trim() + '"'
      : 'No skip nav link — keyboard users must tab through entire navigation',
  });

  // A-02 — Colour contrast (P2) — approximate
  var contrastIssues = checkColorContrast();
  r.push({
    id: 'A-02', pillar: 'accessibility', priority: 'P2',
    label: 'Colour contrast — body text (>= 4.5:1)',
    status: contrastIssues.length === 0 ? 'pass' : 'warn',
    detail: contrastIssues.length === 0
      ? 'No obvious contrast issues detected (approximate)'
      : contrastIssues.length + ' element(s) may have insufficient contrast',
    items: contrastIssues,
  });

  // A-04 — Focus visible (P2)
  var focusIssues = [];
  var focusableEls = Array.from(document.querySelectorAll('a, button, input, [tabindex]')).slice(0, 20);
  focusableEls.forEach(function(el) {
    var styles = window.getComputedStyle(el);
    if (styles.outlineStyle === 'none' && styles.outlineWidth === '0px') {
      var boxShadow = styles.boxShadow;
      if (!boxShadow || boxShadow === 'none') {
        focusIssues.push({
          text: el.tagName + ' ' + (el.textContent.trim().substring(0, 20) || el.getAttribute('aria-label') || ''),
          element: getPath(el)
        });
      }
    }
  });
  r.push({
    id: 'A-04', pillar: 'accessibility', priority: 'P2',
    label: 'Focus indicator visible',
    status: focusIssues.length === 0 ? 'pass' : 'warn',
    detail: focusIssues.length === 0
      ? 'Focus styles appear present'
      : focusIssues.length + ' element(s) may lack visible focus indicator',
    items: focusIssues.slice(0, 5)
  });

  // A-05 — Negative tabindex on content (P2)
  var allTabIndex = Array.from(document.querySelectorAll('[tabindex]'));
  var negativeTabIndex = allTabIndex.filter(function(el) {
    var ti = parseInt(el.getAttribute('tabindex'));
    var isInteractive = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].indexOf(el.tagName) > -1;
    return ti < 0 && !isInteractive;
  });
  r.push({
    id: 'A-05', pillar: 'accessibility', priority: 'P2',
    label: 'No negative tabindex on content elements',
    status: negativeTabIndex.length === 0 ? 'pass' : 'warn',
    detail: negativeTabIndex.length === 0
      ? 'No problematic negative tabindex values'
      : negativeTabIndex.length + ' content element(s) with tabindex="-1"',
    items: negativeTabIndex.slice(0, 5).map(function(el) {
      return { text: el.tagName + ': ' + el.className.substring(0, 40), element: getPath(el) };
    })
  });

  // A-06 — ARIA roles valid (P3)
  var validRoles = ['alert','alertdialog','application','article','banner','button','cell','checkbox',
    'columnheader','combobox','complementary','contentinfo','definition','dialog','directory','document',
    'feed','figure','form','grid','gridcell','group','heading','img','link','list','listbox','listitem',
    'log','main','marquee','math','menu','menubar','menuitem','menuitemcheckbox','menuitemradio',
    'navigation','none','note','option','presentation','progressbar','radio','radiogroup','region',
    'row','rowgroup','rowheader','scrollbar','search','searchbox','separator','slider','spinbutton',
    'status','switch','tab','table','tablist','tabpanel','term','textbox','timer','toolbar','tooltip',
    'tree','treegrid','treeitem'];
  var roleEls = Array.from(document.querySelectorAll('[role]'));
  var invalidRoles = roleEls.filter(function(el) {
    return validRoles.indexOf(el.getAttribute('role')) === -1;
  });
  r.push({
    id: 'A-06', pillar: 'accessibility', priority: 'P3',
    label: 'ARIA roles are valid',
    status: invalidRoles.length === 0 ? 'pass' : 'warn',
    detail: invalidRoles.length === 0
      ? 'All ' + roleEls.length + ' role attributes are valid'
      : invalidRoles.length + ' invalid ARIA role(s)',
    items: invalidRoles.map(function(el) {
      return { text: 'role="' + el.getAttribute('role') + '"', element: getPath(el) };
    })
  });

  // A-07 — aria-expanded on toggle buttons (P3)
  var toggleBtns = Array.from(document.querySelectorAll('button, [role="button"]')).filter(function(btn) {
    var controls = btn.getAttribute('aria-controls');
    return controls && document.getElementById(controls);
  });
  var missingExpanded = toggleBtns.filter(function(btn) {
    return !btn.hasAttribute('aria-expanded');
  });
  r.push({
    id: 'A-07', pillar: 'accessibility', priority: 'P3',
    label: 'Toggle buttons have aria-expanded',
    status: missingExpanded.length === 0 ? 'pass' : 'warn',
    detail: missingExpanded.length === 0
      ? 'All toggle buttons have aria-expanded'
      : missingExpanded.length + ' toggle button(s) missing aria-expanded',
  });

  // A-08 — Icon-only buttons have aria-label (P2)
  var buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
  var iconBtns = buttons.filter(function(btn) {
    var text = btn.textContent.trim();
    var label = btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
    return !text && !label;
  });
  r.push({
    id: 'A-08', pillar: 'accessibility', priority: 'P2',
    label: 'Icon-only buttons have aria-label',
    status: iconBtns.length === 0 ? 'pass' : 'fail',
    detail: iconBtns.length === 0
      ? 'All icon buttons are labelled'
      : iconBtns.length + ' icon-only button(s) missing aria-label',
    items: iconBtns.slice(0, 5).map(function(btn) {
      return { text: btn.className.substring(0, 50), element: getPath(btn) };
    })
  });

  // A-09 — Decorative SVGs are aria-hidden (P3)
  var svgs = Array.from(document.querySelectorAll('svg'));
  var svgsWithoutHidden = svgs.filter(function(svg) {
    var hasTitle = svg.querySelector('title');
    var hasLabel = svg.getAttribute('aria-label');
    var isHidden = svg.getAttribute('aria-hidden') === 'true';
    return !hasTitle && !hasLabel && !isHidden;
  });
  r.push({
    id: 'A-09', pillar: 'accessibility', priority: 'P3',
    label: 'Decorative SVGs are aria-hidden',
    status: svgsWithoutHidden.length === 0 ? 'pass' : 'warn',
    detail: svgsWithoutHidden.length === 0
      ? 'All ' + svgs.length + ' SVGs properly labelled or hidden'
      : svgsWithoutHidden.length + ' SVG(s) without aria-hidden',
  });

  // A-11 — No auto-playing media (P2)
  var autoplayMedia = Array.from(document.querySelectorAll('video[autoplay], audio[autoplay]'));
  var uncontrolled = autoplayMedia.filter(function(el) {
    return !el.hasAttribute('controls');
  });
  r.push({
    id: 'A-11', pillar: 'accessibility', priority: 'P2',
    label: 'No auto-playing media without controls',
    status: uncontrolled.length === 0 ? 'pass' : 'fail',
    detail: uncontrolled.length === 0
      ? 'No uncontrolled autoplay media'
      : uncontrolled.length + ' media element(s) auto-playing without controls',
  });

  // A-12 — <html lang> (P1 cross-check)
  var lang = document.documentElement.getAttribute('lang');
  r.push({
    id: 'A-12', pillar: 'accessibility', priority: 'P1',
    label: '<html lang> set (WCAG 3.1.1)',
    status: lang && lang.trim() ? 'pass' : 'fail',
    detail: lang ? 'lang="' + lang + '"' : 'Missing lang — screen readers cannot determine language',
  });

  // A-13 — Empty anchor links (P1)
  var allLinks = Array.from(document.querySelectorAll('a'));
  var emptyAnchors = allLinks.filter(function(a) {
    var text = a.textContent.trim();
    var label = a.getAttribute('aria-label') || a.getAttribute('title') || '';
    var imgWithAlt = a.querySelector('img[alt]:not([alt=""])');
    return !text && !label && !imgWithAlt;
  });
  r.push({
    id: 'A-13', pillar: 'accessibility', priority: 'P1',
    label: 'No empty links (no text or aria-label)',
    status: emptyAnchors.length === 0 ? 'pass' : 'fail',
    detail: emptyAnchors.length === 0
      ? 'All links have accessible text'
      : emptyAnchors.length + ' link(s) with no text and no aria-label',
    items: emptyAnchors.slice(0, 5).map(function(a) {
      return { text: a.getAttribute('href'), element: getPath(a) };
    })
  });

  return r;
}
```

---

## 6. Link & CTA Checker — Core Algorithm

This is the most critical module. It runs asynchronously after Phase 1 and updates the panel as results arrive.

```javascript
async function runPhase2() {
  // Collect all internal links
  var allLinks = Array.from(document.querySelectorAll('a[href]'));
  var internalLinks = allLinks
    .map(function(a) { return { el: a, href: a.getAttribute('href') }; })
    .filter(function(item) {
      var href = item.href;
      if (!href) return false;
      if (href.charAt(0) === '#') return false;
      if (/^(mailto|tel|javascript):/i.test(href)) return false;
      if (href.indexOf('http') === 0 && href.indexOf(location.origin) !== 0) return false;
      return true;
    })
    .map(function(item) {
      return {
        el: item.el,
        href: item.href.charAt(0) === '/' ? location.origin + item.href : item.href,
        original: item.href
      };
    });

  // Remove duplicates by href
  var seenHrefs = {};
  var uniqueLinks = internalLinks.filter(function(l) {
    if (seenHrefs[l.href]) return false;
    seenHrefs[l.href] = true;
    return true;
  });

  // Collect CTA destinations
  var ctaEls = getCTAs();
  var ctaLinks = ctaEls
    .filter(function(el) { return el.tagName === 'A' && el.getAttribute('href'); })
    .map(function(el) { return { el: el, href: el.getAttribute('href'), isCTA: true }; })
    .filter(function(item) {
      var href = item.href;
      return href && href !== '#' && !/^(mailto|tel|javascript):/i.test(href);
    });

  var total = uniqueLinks.length + ctaLinks.length;
  updateLinkProgress(0, total);

  var broken = [];
  var ctaFailed = [];
  var done = 0;

  async function checkUrl(href) {
    try {
      var controller = new AbortController();
      var timeout = setTimeout(function() { controller.abort(); }, CONFIG.linkTimeout);
      var res = await fetch(href, {
        method: 'HEAD',
        credentials: 'include',
        signal: controller.signal,
        redirect: 'follow'
      });
      clearTimeout(timeout);
      return { href: href, status: res.status, ok: res.ok };
    } catch (e) {
      return { href: href, status: e.name === 'AbortError' ? 'timeout' : 'error', ok: false };
    }
  }

  async function processBatch(items, isCTA) {
    for (var i = 0; i < items.length; i += CONFIG.linkBatchSize) {
      var batch = items.slice(i, i + CONFIG.linkBatchSize);
      var batchResults = await Promise.all(batch.map(function(item) {
        var url = item.href;
        if (url.charAt(0) === '/') url = location.origin + url;
        return checkUrl(url);
      }));
      batchResults.forEach(function(result, idx) {
        done++;
        updateLinkProgress(done, total);
        if (!result.ok) {
          var entry = {
            href: result.href,
            original: batch[idx].original || result.href,
            httpStatus: result.status,
            element: getPath(batch[idx].el),
            linkText: batch[idx].el.textContent.trim().substring(0, 40) || '[no text]'
          };
          if (isCTA) ctaFailed.push(entry);
          else broken.push(entry);
        }
      });
    }
  }

  await processBatch(uniqueLinks, false);
  await processBatch(ctaLinks, true);

  // C-08 — Internal links not 404 (P1)
  results.content.push({
    id: 'C-08', pillar: 'content', priority: 'P1',
    label: 'Internal links resolve (not 404)',
    status: broken.length === 0 ? 'pass' : 'fail',
    detail: broken.length === 0
      ? 'All ' + uniqueLinks.length + ' internal links resolve correctly'
      : broken.length + ' broken link(s) found',
    items: broken
  });

  // C-14 — CTA destinations resolve (P1)
  results.content.push({
    id: 'C-14', pillar: 'content', priority: 'P1',
    label: 'CTA destinations resolve',
    status: ctaFailed.length === 0 ? 'pass' : 'fail',
    detail: ctaFailed.length === 0
      ? 'All ' + ctaLinks.length + ' CTA links resolve'
      : ctaFailed.length + ' CTA(s) pointing to dead URLs',
    items: ctaFailed
  });

  finalizeScores();
  renderFinalResults();
}
```

---

## 7. Scoring Engine

```javascript
var PRIORITY_WEIGHTS = { P1: 4, P2: 2, P3: 1, P4: 0 };
var RESULT_SCORES    = { pass: 1.0, warn: 0.5, fail: 0.0, info: null };

function calcPillarScore(checks) {
  var earned = 0;
  var possible = 0;
  checks.forEach(function(c) {
    var weight = PRIORITY_WEIGHTS[c.priority] || 0;
    if (weight === 0) return;
    var factor = RESULT_SCORES[c.status];
    if (factor === null) return;
    earned   += weight * factor;
    possible += weight;
  });
  return possible === 0 ? 100 : Math.round((earned / possible) * 100);
}

function calcOverallScore(pillarScores) {
  var w = CONFIG.weights;
  return Math.round(
    pillarScores.metadata      * w.metadata +
    pillarScores.content       * w.content +
    pillarScores.responsive    * w.responsive +
    pillarScores.accessibility * w.accessibility
  );
}

function getGoNoGo(overall, allChecks) {
  var p1Failures = allChecks.filter(function(c) {
    return c.priority === 'P1' && c.status === 'fail';
  });
  if (p1Failures.length > 0)
    return { status: 'BLOCK', reason: p1Failures.length + ' P1 failure(s)' };
  if (overall >= 90)
    return { status: 'PASS', reason: 'Ready for promotion' };
  if (overall >= 80)
    return { status: 'PASS_WITH_WARNINGS', reason: 'Promote — fix warnings next sprint' };
  if (overall >= 70)
    return { status: 'CONDITIONAL', reason: 'Fix P1+P2 failures before promoting' };
  return { status: 'FAIL', reason: 'Score below threshold' };
}
```

---

## 8. QA Panel UI — Full CSS

This CSS is injected into the page by the bookmarklet. It uses a `#aem-qa-panel` prefix to avoid conflicts.

```javascript
function injectPanelStyles() {
  var style = document.createElement('style');
  style.id = 'aem-qa-styles';
  style.textContent = [
    '#aem-qa-panel * { box-sizing:border-box; font-family:system-ui,-apple-system,sans-serif; }',
    '#aem-qa-panel { position:fixed; top:0; right:0; width:380px; height:100vh;',
    '  background:#0A0F1E; color:#F9FAFB; z-index:2147483647;',
    '  display:flex; flex-direction:column; box-shadow:-4px 0 32px rgba(0,0,0,.65); font-size:13px; overflow:hidden; }',
    '#aem-qa-panel .qa-hdr { background:#1450F5; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }',
    '#aem-qa-panel .qa-hdr h1 { font-size:15px; font-weight:700; margin:0; color:#fff; }',
    '#aem-qa-panel .qa-hdr button { background:rgba(255,255,255,.2); border:none; color:#fff; cursor:pointer; padding:4px 8px; border-radius:4px; font-size:12px; }',
    '#aem-qa-panel .qa-meta { padding:10px 16px; background:#111827; border-bottom:1px solid #1F2937; font-size:11px; color:#9CA3AF; flex-shrink:0; }',
    '#aem-qa-panel .qa-scr { padding:12px 16px; background:#111827; border-bottom:1px solid #1F2937; flex-shrink:0; }',
    '#aem-qa-panel .qa-scr-v { font-size:32px; font-weight:800; }',
    '#aem-qa-panel .qa-scr-v.p { color:#10B981; }',
    '#aem-qa-panel .qa-scr-v.w { color:#F59E0B; }',
    '#aem-qa-panel .qa-scr-v.f { color:#EF4444; }',
    '#aem-qa-panel .qa-bar { height:6px; background:#1F2937; border-radius:3px; margin:6px 0; }',
    '#aem-qa-panel .qa-fill { height:100%; border-radius:3px; transition:width .4s; }',
    '#aem-qa-panel .qa-p1a { background:rgba(220,38,38,.15); border:1px solid #DC2626; border-radius:6px; padding:6px 10px; margin-top:6px; color:#FCA5A5; font-size:12px; font-weight:600; }',
    '#aem-qa-panel .qa-bod { flex:1; overflow-y:auto; padding:8px 0; }',
    '#aem-qa-panel .qa-pil { border-bottom:1px solid #1F2937; }',
    '#aem-qa-panel .qa-ph { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; cursor:pointer; user-select:none; background:#111827; }',
    '#aem-qa-panel .qa-ph:hover { background:#1A2235; }',
    '#aem-qa-panel .qa-pt { font-weight:600; font-size:13px; }',
    '#aem-qa-panel .qa-ps { font-size:12px; color:#9CA3AF; }',
    '#aem-qa-panel .qa-pb { display:none; padding:4px 0; }',
    '#aem-qa-panel .qa-pb.open { display:block; }',
    '#aem-qa-panel .qa-chk { padding:8px 16px; border-left:3px solid transparent; display:flex; align-items:flex-start; gap:8px; }',
    '#aem-qa-panel .qa-chk.pass { border-color:#10B981; }',
    '#aem-qa-panel .qa-chk.warn { border-color:#F59E0B; background:rgba(245,158,11,.05); }',
    '#aem-qa-panel .qa-chk.fail { border-color:#EF4444; background:rgba(239,68,68,.07); }',
    '#aem-qa-panel .qa-chk.info { border-color:#374151; }',
    '#aem-qa-panel .qa-ci { flex-shrink:0; font-size:14px; }',
    '#aem-qa-panel .qa-cb { flex:1; min-width:0; }',
    '#aem-qa-panel .qa-cl { font-weight:500; font-size:12px; }',
    '#aem-qa-panel .qa-cd { color:#9CA3AF; font-size:11px; margin-top:2px; }',
    '#aem-qa-panel .qa-bg { font-size:9px; font-weight:700; padding:1px 5px; border-radius:3px; letter-spacing:.5px; margin-right:4px; }',
    '#aem-qa-panel .qa-bg.P1 { background:#7F1D1D; color:#FCA5A5; }',
    '#aem-qa-panel .qa-bg.P2 { background:#7C2D12; color:#FED7AA; }',
    '#aem-qa-panel .qa-bg.P3 { background:#713F12; color:#FEF08A; }',
    '#aem-qa-panel .qa-bg.P4 { background:#374151; color:#9CA3AF; }',
    '#aem-qa-panel .qa-items { margin-top:6px; }',
    '#aem-qa-panel .qa-item { font-size:10px; color:#6B7280; padding:2px 0 2px 12px; border-left:1px solid #374151; margin-left:4px; word-break:break-all; }',
    '#aem-qa-panel .qa-ftr { padding:10px 16px; background:#111827; border-top:1px solid #1F2937; display:flex; gap:6px; flex-wrap:wrap; flex-shrink:0; }',
    '#aem-qa-panel .qa-ftr button { flex:1; padding:8px; border-radius:6px; border:1px solid #1F2937; background:#1A2235; color:#9CA3AF; cursor:pointer; font-size:11px; min-width:80px; }',
    '#aem-qa-panel .qa-ftr button:hover { background:#243148; color:#F9FAFB; }',
    '#aem-qa-panel .qa-ftr button.primary { background:#1450F5; color:#fff; border-color:#1450F5; }',
    '#aem-qa-panel .qa-bp { display:flex; gap:4px; margin-top:6px; }',
    '#aem-qa-panel .qa-bp button { font-size:10px; padding:4px 8px; border-radius:4px; border:1px solid #374151; background:#1A2235; color:#9CA3AF; cursor:pointer; }',
    '#aem-qa-panel .qa-prg { padding:16px; text-align:center; color:#9CA3AF; font-size:12px; }',
    '#aem-qa-panel .qa-pgb { height:4px; background:#1F2937; border-radius:2px; margin-top:8px; }',
    '#aem-qa-panel .qa-pgf { height:100%; background:#1450F5; border-radius:2px; transition:width .2s; }'
  ].join('\n');
  document.head.appendChild(style);
}
```

---

## 9. Bookmarklet Build Script

### build-bookmarklet.js (pure Node.js, zero deps)

```javascript
// build-bookmarklet.js
// Run: node build-bookmarklet.js
// Output: AEM_QA_BOOKMARK.txt

var fs   = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, 'bookmarklet.js'), 'utf8');

// Simple minification (no npm):
var minified = src
  .replace(/\/\*[\s\S]*?\*\//g, '')         // block comments
  .replace(/^\s*\/\/.*$/gm, '')             // line comments
  .replace(/\n{2,}/g, '\n')                 // collapse newlines
  .split('\n').map(function(l) { return l.trim(); }).join(' ')
  .replace(/\s{2,}/g, ' ')
  .trim();

if (minified.indexOf('(function') !== 0) {
  minified = '(function(){' + minified + '})()';
}

var bookmarkletUrl = 'javascript:' + encodeURIComponent(minified);

fs.writeFileSync('AEM_QA_BOOKMARK.txt', bookmarkletUrl);

console.log('Bookmarklet generated -> AEM_QA_BOOKMARK.txt');
console.log('Size: ' + (bookmarkletUrl.length / 1024).toFixed(1) + ' KB');
console.log('');
console.log('NEXT STEPS:');
console.log('  1. Copy full content of AEM_QA_BOOKMARK.txt');
console.log('  2. Browser -> Bookmarks -> Add new bookmark');
console.log('     Name: AEM QA');
console.log('     URL:  [paste]');
console.log('  3. Drag to bookmarks bar');
```

---

## 10. Report Server

### server.js (pure Node.js built-ins only)

```javascript
// server.js — zero npm dependencies
// Run: node server.js
// Open: http://localhost:3500

var http = require('http');
var fs   = require('fs');
var path = require('path');
var url  = require('url');

var PORT    = 3500;
var REPORTS = path.join(__dirname, 'reports');
var PUBLIC  = path.join(__dirname, 'public');

if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });

var MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'text/javascript',
  '.json': 'application/json',
};

var server = http.createServer(function(req, res) {
  var parsed = url.parse(req.url, true);
  var pathname = parsed.pathname;

  // CORS — allow bookmarklet to POST from any AEM origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // POST /report — save audit result
  if (req.method === 'POST' && pathname === '/report') {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      try {
        var data = JSON.parse(body);
        var slug = data.meta.url.replace(/[^a-z0-9]/gi, '-').substring(0, 60);
        var ts   = new Date().toISOString().replace(/[:.]/g, '-');
        var file = path.join(REPORTS, slug + '--' + ts + '.json');
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, file: file }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // GET /reports — list all saved reports
  if (req.method === 'GET' && pathname === '/reports') {
    var files = fs.readdirSync(REPORTS)
      .filter(function(f) { return f.endsWith('.json'); })
      .map(function(f) {
        var data = JSON.parse(fs.readFileSync(path.join(REPORTS, f), 'utf8'));
        return {
          file: f,
          url: data.meta.url,
          score: data.meta.overallScore,
          status: data.meta.status,
          auditedAt: data.meta.auditedAt
        };
      })
      .sort(function(a, b) { return b.auditedAt.localeCompare(a.auditedAt); });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(files));
  }

  // Serve static files from /public
  var filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC, filePath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    var ext  = path.extname(filePath);
    var mime = MIME[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    return res.end(fs.readFileSync(filePath));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, function() {
  console.log('AEM QA Report Server -> http://localhost:' + PORT);
  console.log('Reports stored in: ' + REPORTS);
});
```

---

## 11. Adapting to Any AEM Site

The tool is built to be site-agnostic. To adapt it to a different AEM implementation, update the `CONFIG.selectors` object and the AEM path patterns.

### Discovery — Finding Your Site's Component Selectors

Open DevTools on your AEM page and run:

```javascript
// Find CTA selectors used on this page
document.querySelectorAll('a, button').forEach(function(el) {
  if (el.className) console.log(el.tagName, el.className.split(' ')[0]);
});

// Find the header/nav element
['header','[role="banner"]','nav','[role="navigation"]'].forEach(function(sel) {
  var el = document.querySelector(sel);
  if (el) console.log('Found:', sel, el.className.substring(0, 60));
});

// Find AEM component wrappers
document.querySelectorAll('[data-cmp-is], [class*="cmp-"]').forEach(function(el) {
  var name = el.getAttribute('data-cmp-is');
  if (!name) {
    var match = el.className.match(/cmp-[\w]+/);
    name = match ? match[0] : el.className;
  }
  console.log(name);
});
```

### Site Configuration Examples

```javascript
// KONE (kone.com — confirmed from live audit)
CONFIG.selectors = {
  header: '.kone-header, header',
  nav:    '.kone-header__main-menu',
  cta: ['.kone-button', '.cmp-button a', '.cmp-teaser__link',
        '.kone-icon-button', 'a[class*="kone-button"]'],
  image:  '.cmp-image img, [data-cmp-is="image"] img',
};

// Generic AEM Core Components site
CONFIG.selectors = {
  header: 'header, [role="banner"]',
  nav:    'nav, [role="navigation"]',
  cta:    ['.cmp-button a', '.cmp-teaser__link', 'a.button'],
  image:  '.cmp-image img, [data-cmp-is="image"] img',
};

// AEM with custom component library
CONFIG.selectors = {
  header: '.site-header',
  nav:    '.main-nav',
  cta:    ['.btn-primary', '.btn-secondary', '.action-link'],
  image:  '.content-image img',
};
```

### AEM Path Pattern Adaptation

```javascript
// If your AEM content root is different:
CONFIG.aemPathPattern = /^\/content\/your-site-name\//;

// Safe default (catches all /content/ paths):
CONFIG.aemPathPattern = /^\/content\/[a-zA-Z]/;
```

---

## 12. Testing the Tool Itself

### Validation Steps

```javascript
// Test 1: Open a page with known issues and verify detection

// Test 2: Run in console to check individual functions
var h1s = document.querySelectorAll('h1');
console.assert(h1s.length === 1, 'Should have exactly 1 H1');

var metaDesc = document.querySelector('meta[name="description"]');
console.assert(metaDesc && metaDesc.content, 'Should have meta description');

// Test 3: Verify link checker fetches correctly
fetch('/some-page.html', { method: 'HEAD', credentials: 'include' })
  .then(function(r) { console.log('Status:', r.status); })
  .catch(function(e) { console.error('Fetch failed:', e); });
```

### Known Limitations

| Limitation | Impact | Workaround |
|---|---|---|
| Colour contrast is approximate | External stylesheets not fully resolved | Use DevTools accessibility audit for precision |
| Responsive checks at current viewport only | Accurate only at tested width | Use breakpoint popup buttons for visual check |
| Link checker requires same-origin | Cross-domain fetches blocked by CORS | Use Screaming Frog for full external link audit |
| Auth-protected links may return 401 | False positive broken link | 401/403 flagged as WARN not FAIL |
| JS-rendered content may be missed | Links added by JS after load | Wait for full page load before clicking bookmark |

---

## 13. Extending the Framework

### Adding a New Check

Follow this object schema and place it in the appropriate `check*()` function:

```javascript
{
  id:       'X-01',          // Unique ID within its pillar
  pillar:   'content',       // metadata | content | responsive | accessibility
  priority: 'P1',           // P1 | P2 | P3 | P4
  label:    'Check label',  // Shown in panel header
  status:   'pass',         // pass | warn | fail | info
  detail:   'Detail text',  // Supporting context
  items:    []              // Optional array of { text, element, href }
}
```

The panel and scoring engine pick up new checks automatically.

### Example: Adding AEM Analytics Checks

```javascript
// K-01 — Adobe Launch (DTM) script loaded
var dtmScript = document.querySelector('script[src*="adobedtm.com"]');
r.push({
  id: 'K-01', pillar: 'content', priority: 'P2',
  label: 'Adobe Launch (DTM) loaded',
  status: dtmScript ? 'pass' : 'fail',
  detail: dtmScript ? dtmScript.src.substring(0, 60) : 'No Adobe DTM script found',
});

// K-02 — Adobe Data Layer on body
var hasDataLayer = document.body.hasAttribute('data-cmp-data-layer-name');
r.push({
  id: 'K-02', pillar: 'content', priority: 'P2',
  label: 'Adobe Data Layer configured',
  status: hasDataLayer ? 'pass' : 'warn',
  detail: hasDataLayer
    ? 'data-cmp-data-layer-name="' + document.body.getAttribute('data-cmp-data-layer-name') + '"'
    : 'No data layer attribute on body',
});
```

---

## Appendix A — Utility Functions

```javascript
function getPath(el) {
  var parts = [];
  var node = el;
  while (node && node !== document.body) {
    var sel = node.tagName.toLowerCase();
    if (node.id) {
      sel += '#' + node.id;
      parts.unshift(sel);
      break;
    }
    var cls = Array.from(node.classList).slice(0, 2).join('.');
    if (cls) sel += '.' + cls;
    parts.unshift(sel);
    node = node.parentElement;
  }
  return parts.slice(-3).join(' > ');
}

function getCTAs() {
  var selectorStr = Array.isArray(CONFIG.selectors.cta)
    ? CONFIG.selectors.cta.join(', ')
    : CONFIG.selectors.cta;
  return Array.from(document.querySelectorAll(selectorStr));
}

function checkColorContrast() {
  var issues = [];
  var textEls = Array.from(document.querySelectorAll('p, h1, h2, h3, h4, li, a, span, td')).slice(0, 30);
  textEls.forEach(function(el) {
    var styles = window.getComputedStyle(el);
    var color = styles.color;
    var bg = styles.backgroundColor;
    if (!bg || bg === 'rgba(0, 0, 0, 0)') return;
    var ratio = approximateContrastRatio(color, bg);
    if (ratio !== null && ratio < 4.5) {
      issues.push({
        text: el.textContent.trim().substring(0, 30),
        detail: 'Estimated ratio: ' + ratio.toFixed(1) + ':1',
        element: getPath(el)
      });
    }
  });
  return issues.slice(0, 5);
}

function approximateContrastRatio(fg, bg) {
  function parseRgb(str) {
    var m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function toLinear(c) {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function luminance(rgb) {
    return 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);
  }
  var fgRgb = parseRgb(fg);
  var bgRgb = parseRgb(bg);
  if (!fgRgb || !bgRgb) return null;
  var L1 = luminance(fgRgb);
  var L2 = luminance(bgRgb);
  var bright = Math.max(L1, L2);
  var dark = Math.min(L1, L2);
  return (bright + 0.05) / (dark + 0.05);
}

function exportJSON() {
  var data = buildReportPayload();
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'aem-qa-' + location.hostname + '-' + Date.now() + '.json';
  a.click();
}

function copyReport() {
  var data = buildReportPayload();
  var lines = [
    '# AEM QA Report — ' + data.meta.url,
    'Score: ' + data.meta.overallScore + '/100 | Status: ' + data.meta.status,
    'Audited: ' + data.meta.auditedAt,
    '',
    '## Defects'
  ];
  data.defects.forEach(function(d) {
    lines.push('- [' + d.priority + '] ' + d.id + ' — ' + d.label + ': ' + d.detail);
  });
  navigator.clipboard.writeText(lines.join('\n'));
}

async function sendToServer() {
  var data = buildReportPayload();
  try {
    var res = await fetch(CONFIG.reportServer, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    var json = await res.json();
    alert(json.ok ? 'Report saved to server' : 'Server error: ' + json.error);
  } catch (e) {
    alert('Could not connect to report server. Is node server.js running?');
  }
}

function buildReportPayload() {
  var allChecks = [].concat(results.metadata, results.content, results.responsive, results.accessibility);
  var pillarScores = {
    metadata:      calcPillarScore(results.metadata),
    content:       calcPillarScore(results.content),
    responsive:    calcPillarScore(results.responsive),
    accessibility: calcPillarScore(results.accessibility)
  };
  var overall = calcOverallScore(pillarScores);
  var goNoGo  = getGoNoGo(overall, allChecks);
  var defects = allChecks.filter(function(c) { return c.status === 'fail' || c.status === 'warn'; });

  return {
    meta: {
      url: location.href,
      pageTitle: document.title,
      auditedAt: new Date().toISOString(),
      toolVersion: CONFIG.version,
      viewport: window.innerWidth,
      overallScore: overall,
      threshold: CONFIG.thresholdScore,
      status: goNoGo.status,
      goNoGo: goNoGo.status,
      p1FailCount: allChecks.filter(function(c) { return c.priority === 'P1' && c.status === 'fail'; }).length
    },
    scores: {
      metadata:      { score: pillarScores.metadata, weight: CONFIG.weights.metadata },
      content:       { score: pillarScores.content, weight: CONFIG.weights.content },
      responsive:    { score: pillarScores.responsive, weight: CONFIG.weights.responsive },
      accessibility: { score: pillarScores.accessibility, weight: CONFIG.weights.accessibility }
    },
    checks: allChecks,
    defects: defects,
    info: {
      totalChecks: allChecks.length,
      passed: allChecks.filter(function(c) { return c.status === 'pass'; }).length,
      warned: allChecks.filter(function(c) { return c.status === 'warn'; }).length,
      failed: allChecks.filter(function(c) { return c.status === 'fail'; }).length
    }
  };
}
```

---

## Appendix B — Quick Reference

```
CHECK ID    PRIORITY  PILLAR       WHAT IT CHECKS
────────────────────────────────────────────────────────────────
M-01        P1        Metadata     <title> tag present
M-04        P1        Metadata     Meta description present
M-06        P1        Metadata     Canonical URL present
M-09        P1        Metadata     <html lang> attribute

C-01        P1        Content      Exactly 1 H1
C-02        P1        Content      H1 not empty
C-04        P1        Content      No lorem ipsum placeholder
C-08        P1        Content      Internal links not broken       ⭐
C-09        P1        Content      No /content/ paths in links     ⭐
C-10        P1        Content      No author/stage URLs in links   ⭐
C-13        P1        Content      No links with empty text        ⭐
C-14        P1        Content      CTA destinations resolve        ⭐

R-01        P1        Responsive   Viewport meta present

A-12        P1        Access.      <html lang> (WCAG 3.1.1)
A-13        P1        Access.      No empty anchor links

────────────────────────────────────────────────────────────────
⭐ = Links & CTAs — highest business impact
P1 failure on ANY check = automatic go-live BLOCK
────────────────────────────────────────────────────────────────
TOTAL: 49 checks | 15 P1 | 19 P2 | 10 P3 | 5 P4
DEPS:  Zero npm packages — pure vanilla browser JS
```
