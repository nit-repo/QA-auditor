(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  var TOAST_ID = 'aem-qa-toast';

  // ─── ENDPOINT RESOLUTION ────────────────────────────────────────────
  // Precedence: explicit override > remote <script> origin > build-injected
  // default > localhost. '__QA_ENDPOINT__' is substituted by scripts/build.js;
  // when it survives unsubstituted we are running from source, so ignore it.
  var BUILD_ENDPOINT = '__QA_ENDPOINT__';
  var BUILD_MODE = '__QA_MODE__';
  var userConfig = window.__AEM_QA_CONFIG__ || {};

  // ─── AUDIT MODE ─────────────────────────────────────────────────────
  //   'full'  — all 49 checks, every link verified. The health assessment.
  //   'quick' — the 15 P1 blockers only, links sampled. Answers the single
  //             question "is anything blocking go-live?" in seconds.
  //
  // Both modes reach the SAME go/no-go verdict, because getGoNoGo() keys off
  // P1 failures alone. Quick mode drops the P2/P3/P4 detail, not the verdict.
  function resolveMode() {
    if (userConfig.mode === 'quick' || userConfig.mode === 'full') return userConfig.mode;
    if (BUILD_MODE === 'quick' || BUILD_MODE === 'full') return BUILD_MODE;
    return 'full';
  }
  var auditMode = resolveMode();

  function resolveEndpoint() {
    if (userConfig.reportServer) return userConfig.reportServer;

    // Loaded as a remote <script>? Report back to the origin that served us.
    var tag = document.currentScript;
    if (tag && tag.src && tag.src.indexOf('http') === 0) {
      try { return new URL(tag.src).origin + '/api/report'; } catch (e) {}
    }

    if (BUILD_ENDPOINT.indexOf('__QA_') !== 0) return BUILD_ENDPOINT;
    return 'http://localhost:3500/api/report';
  }

  var reportServerUrl = resolveEndpoint();

  // Origin used to target postMessage. Never post audit data to '*'.
  var reportOrigin = (function () {
    try { return new URL(reportServerUrl, location.href).origin; } catch (e) { return null; }
  })();

  // ─── CONFIG ─────────────────────────────────────────────────────────
  var CONFIG = {
    version: '3.1.0',
    panelId: 'aem-qa-panel',
    thresholdScore: 80,
    linkBatchSize: 5,
    linkTimeout: 5000,
    reportServer: reportServerUrl,
    reportOrigin: reportOrigin,

    mode: auditMode,
    // Quick mode samples rather than exhaustively verifying links, so a
    // link-heavy page cannot turn a "quick" scan into a 15-second one. The
    // sample size and the shorter timeout are both reported, so a sampled
    // pass is never mistaken for a clean bill of health.
    quickLinkSample: typeof userConfig.quickLinkSample === 'number' ? userConfig.quickLinkSample : 25,
    quickLinkTimeout: typeof userConfig.quickLinkTimeout === 'number' ? userConfig.quickLinkTimeout : 2000,

    // 'panel' = interactive side panel (default). 'toast' = fire-and-forget:
    // run, show a small toast, auto-send, no panel.
    ui: userConfig.ui === 'toast' ? 'toast' : 'panel',
    autoSend: userConfig.autoSend === true,

    // Optional shared secret, required only when the server sets QA_API_TOKEN.
    apiToken: userConfig.apiToken || null,

    selectors: {
      header: '.kone-header, header, [role="banner"]',
      nav: 'nav, [role="navigation"], .kone-header__main-menu',
      main: 'main, [role="main"], #main-content, #content',
      cta: [
        'a[class*="cta"]', 'a[class*="button"]', 'a[class*="btn"]',
        '.cmp-button a', '.cmp-teaser__link',
        'button[class*="cta"]', 'a[class*="kone-button"]', '.kone-button', '.kone-icon-button'
      ],
      image: '.cmp-image img, [data-cmp-is="image"] img, img',
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

  // Per-site overrides. The default selectors are tuned for KONE + AEM Core
  // Components; any site can retune them without editing the engine by setting
  // window.__AEM_QA_CONFIG__ = { selectors: { cta: [...] } } before running.
  if (userConfig.selectors) {
    Object.keys(userConfig.selectors).forEach(function (k) {
      CONFIG.selectors[k] = userConfig.selectors[k];
    });
  }
  if (userConfig.weights) {
    Object.keys(userConfig.weights).forEach(function (k) {
      CONFIG.weights[k] = userConfig.weights[k];
    });
  }
  if (typeof userConfig.thresholdScore === 'number') CONFIG.thresholdScore = userConfig.thresholdScore;
  if (typeof userConfig.linkTimeout === 'number') CONFIG.linkTimeout = userConfig.linkTimeout;
  if (typeof userConfig.linkBatchSize === 'number') CONFIG.linkBatchSize = userConfig.linkBatchSize;

  // ─── PREVENT DOUBLE INJECTION ───────────────────────────────────────
  // Re-running the bookmarklet on an already-audited page tears the previous
  // run down instead of stacking a second panel/toast on top of it.
  var priorPanel = document.getElementById(CONFIG.panelId);
  var priorToast = document.getElementById(TOAST_ID);
  if (priorPanel || priorToast) {
    if (priorPanel) priorPanel.remove();
    if (priorToast) priorToast.remove();
    ['aem-qa-styles', 'aem-qa-toast-style'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
    return;
  }

  var results = {
    metadata: [],
    content: [],
    responsive: [],
    accessibility: []
  };

  var overallScores = {
    metadata: 0,
    content: 0,
    responsive: 0,
    accessibility: 0,
    overall: 0,
    goNoGo: { status: 'CHECKING', reason: 'Running checks...' }
  };

  // NOTE: the audit is started at the very bottom of this IIFE, after every
  // declaration has been evaluated. Booting from here instead would run before
  // `var PRIORITY_WEIGHTS` (and friends) are assigned — `var` hoists the
  // binding but not the value — so scoring threw
  // "Cannot read properties of undefined (reading 'P1')" on every single run.

  // ─── UTILITY FUNCTIONS ──────────────────────────────────────────────

  function getPath(el) {
    if (!el) return '';
    var parts = [];
    var node = el;
    while (node && node !== document.body && node.parentElement) {
      var sel = node.tagName ? node.tagName.toLowerCase() : '';
      if (node.id) {
        sel += '#' + node.id;
        parts.unshift(sel);
        break;
      }
      if (node.classList && node.classList.length > 0) {
        var cls = Array.from(node.classList).slice(0, 2).join('.');
        if (cls) sel += '.' + cls;
      }
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

  function updateLinkProgress(done, total) {
    var pct = total > 0 ? Math.round((done / total) * 100) : 100;

    if (CONFIG.ui === 'toast') {
      // Link checking occupies the 40–90% band of the toast progress bar.
      updateToast('Checking links… ' + done + '/' + total, 40 + Math.round(pct * 0.5));
      return;
    }

    var pbar = document.getElementById('qa-pbar-fill');
    var progText = document.getElementById('qa-progress-text');
    if (pbar) pbar.style.width = pct + '%';
    if (progText) {
      progText.textContent = total === 0 ? 'Link check completed' : 'Checking links… ' + done + '/' + total + ' (' + pct + '%)';
    }
    if (done >= total && total > 0) {
      var container = document.getElementById('qa-progress');
      if (container) {
        setTimeout(function () {
          container.style.display = 'none';
        }, 1500);
      }
    }
  }

  function checkColorContrast() {
    var issues = [];
    var textEls = Array.from(document.querySelectorAll('p, h1, h2, h3, h4, li, a, span, td')).slice(0, 30);
    textEls.forEach(function (el) {
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

  // ─── PHASE 1: SYNCHRONOUS DOM CHECKS ────────────────────────────────

  function runPhase1() {
    results.metadata = checkMetadata();
    results.content = checkContent();
    results.responsive = checkResponsive();
    results.accessibility = checkAccessibility();

    // Every check is computed either way — the synchronous pass costs ~50ms, so
    // filtering before running would save nothing. Quick mode discards the
    // non-blocking results here instead, which keeps one code path for the
    // checks themselves and guarantees the two modes can never disagree about
    // a P1 verdict.
    if (CONFIG.mode === 'quick') {
      ['metadata', 'content', 'responsive', 'accessibility'].forEach(function (pillar) {
        results[pillar] = results[pillar].filter(function (c) { return c.priority === 'P1'; });
      });
    }

    finalizeScores();
    renderPartialResults();
  }

  function checkMetadata() {
    var r = [];

    // M-01 — Title present (P1)
    var title = document.title ? document.title.trim() : '';
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
    var genericTitles = ['home', 'page', 'untitled', 'new page', 'document'];
    r.push({
      id: 'M-03', pillar: 'metadata', priority: 'P3',
      label: 'Title not generic',
      status: genericTitles.indexOf(title.toLowerCase()) === -1 ? 'pass' : 'fail',
      detail: genericTitles.indexOf(title.toLowerCase()) > -1
        ? 'Generic title: "' + title + '"' : 'OK',
    });

    // M-04 — Meta description present (P1)
    var metaDesc = document.querySelector('meta[name="description"]');
    var descContent = metaDesc ? metaDesc.getAttribute('content') : '';
    r.push({
      id: 'M-04', pillar: 'metadata', priority: 'P1',
      label: 'Meta description present',
      status: descContent && descContent.trim().length > 0 ? 'pass' : 'fail',
      detail: descContent
        ? '"' + descContent.substring(0, 80) + '…"'
        : 'Missing <meta name="description">',
    });

    // M-05 — Meta description length (P2)
    var descLen = descContent ? descContent.trim().length : 0;
    r.push({
      id: 'M-05', pillar: 'metadata', priority: 'P2',
      label: 'Meta description length (50–160)',
      status: descLen >= 50 && descLen <= 160 ? 'pass'
        : descLen > 160 ? 'warn' : (descLen > 0 ? 'warn' : 'fail'),
      detail: descLen > 0 ? descLen + ' characters' : 'Not set',
    });

    // M-06 — Canonical present (P1)
    var canonical = document.querySelector('link[rel="canonical"]');
    var canonHref = canonical ? canonical.getAttribute('href') : '';
    r.push({
      id: 'M-06', pillar: 'metadata', priority: 'P1',
      label: 'Canonical URL present',
      status: canonHref ? 'pass' : 'fail',
      detail: canonHref || 'No <link rel="canonical"> found',
    });

    // M-07 — Canonical matches page URL (P2)
    var pageUrl = location.href.split('?')[0].replace(/\/$/, '');
    var canonUrl = canonHref ? canonHref.split('?')[0].replace(/\/$/, '') : '';
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
    var robots = document.querySelector('meta[name="robots"]');
    var robotsContent = robots ? robots.getAttribute('content') : '';
    r.push({
      id: 'M-08', pillar: 'metadata', priority: 'P2',
      label: 'Robots meta present',
      status: robotsContent
        ? (robotsContent.toLowerCase().indexOf('noindex') > -1 ? 'warn' : 'pass')
        : 'warn',
      detail: robotsContent
        ? (robotsContent.toLowerCase().indexOf('noindex') > -1
          ? 'noindex detected: "' + robotsContent + '"'
          : robotsContent)
        : 'No <meta name="robots"> — relying on server default',
    });

    // M-09 — <html lang> (P1)
    var lang = document.documentElement.getAttribute('lang');
    r.push({
      id: 'M-09', pillar: 'metadata', priority: 'P1',
      label: '<html lang> attribute set',
      status: lang && lang.trim().length > 0 ? 'pass' : 'fail',
      detail: lang ? 'lang="' + lang + '"' : 'Missing lang attribute on <html>',
    });

    // M-10 — OG title (P3)
    var ogTitle = document.querySelector('meta[property="og:title"]');
    r.push({
      id: 'M-10', pillar: 'metadata', priority: 'P3',
      label: 'OG title present',
      status: ogTitle && ogTitle.content ? 'pass' : 'warn',
      detail: ogTitle ? '"' + ogTitle.content + '"' : 'Missing og:title',
    });

    // M-11 — OG description (P3)
    var ogDesc = document.querySelector('meta[property="og:description"]');
    r.push({
      id: 'M-11', pillar: 'metadata', priority: 'P3',
      label: 'OG description present',
      status: ogDesc && ogDesc.content ? 'pass' : 'warn',
      detail: ogDesc ? 'Present' : 'Missing og:description',
    });

    // M-12 — OG image (P3)
    var ogImage = document.querySelector('meta[property="og:image"]');
    r.push({
      id: 'M-12', pillar: 'metadata', priority: 'P3',
      label: 'OG image present',
      status: ogImage && ogImage.content ? 'pass' : 'warn',
      detail: ogImage ? ogImage.content.substring(0, 60) + '…' : 'Missing og:image',
    });

    return r;
  }

  function checkContent() {
    var r = [];

    // C-01 — Exactly 1 H1 (P1)
    var h1s = Array.from(document.querySelectorAll('h1'));
    r.push({
      id: 'C-01', pillar: 'content', priority: 'P1',
      label: 'Exactly one <h1> on page',
      status: h1s.length === 1 ? 'pass' : 'fail',
      detail: h1s.length === 0
        ? 'No <h1> found — critical SEO and accessibility failure'
        : h1s.length + ' H1 elements found',
      items: h1s.map(function (h) {
        return {
          text: h.textContent.trim().substring(0, 40),
          path: getPath(h)
        };
      })
    });

    // C-02 — H1 not empty (P1)
    var h1text = h1s.length > 0 ? h1s[0].textContent.trim() : '';
    r.push({
      id: 'C-02', pillar: 'content', priority: 'P1',
      label: 'H1 has content',
      status: h1text.length > 0 ? 'pass' : 'fail',
      detail: h1text || 'H1 is empty or missing',
    });

    // C-03 — Heading hierarchy (P2)
    var headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    var hierarchyIssues = [];
    var prevLevel = 0;
    headings.forEach(function (h) {
      var level = parseInt(h.tagName[1]);
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
      items: hierarchyIssues.map(function (i) { return { text: i }; })
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

    // C-05 — Images missing alt attribute (P2)
    var allImgs = Array.from(document.querySelectorAll('img'));
    var missingAlt = allImgs.filter(function (img) {
      return !img.hasAttribute('alt');
    });
    r.push({
      id: 'C-05', pillar: 'content', priority: 'P2',
      label: 'All images have alt attribute',
      status: missingAlt.length === 0 ? 'pass' : 'fail',
      detail: missingAlt.length === 0
        ? 'All ' + allImgs.length + ' images have alt'
        : missingAlt.length + ' image(s) missing alt attribute',
      items: missingAlt.map(function (img) {
        return { text: img.src ? img.src.split('/').pop() : '[no src]', path: getPath(img) };
      })
    });

    // C-06 — Invalid alt/ syntax (AEM-specific bug) (P2)
    var invalidAlt = allImgs.filter(function (img) {
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
    var decorativeImgs = allImgs.filter(function (img) {
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
    var aemPathLinks = allLinks.filter(function (a) {
      return CONFIG.aemPathPattern.test(a.getAttribute('href') || '');
    });
    r.push({
      id: 'C-09', pillar: 'content', priority: 'P1',
      label: 'No raw AEM /content/ paths in links',
      status: aemPathLinks.length === 0 ? 'pass' : 'fail',
      detail: aemPathLinks.length === 0
        ? 'No raw AEM paths found'
        : aemPathLinks.length + ' link(s) with /content/ path — will 404 on publish',
      items: aemPathLinks.map(function (a) {
        return { text: a.getAttribute('href'), element: getPath(a) };
      })
    });

    // C-10 — Author/Stage/Dev env URLs in links (P1)
    var envLinks = allLinks.filter(function (a) {
      var href = a.getAttribute('href') || '';
      return CONFIG.envPatterns.some(function (p) { return p.test(href); });
    });
    r.push({
      id: 'C-10', pillar: 'content', priority: 'P1',
      label: 'No author/stage/dev URLs in links',
      status: envLinks.length === 0 ? 'pass' : 'fail',
      detail: envLinks.length === 0
        ? 'No environment URLs found'
        : envLinks.length + ' link(s) pointing to author/stage/dev environment',
      items: envLinks.map(function (a) {
        return { text: a.getAttribute('href'), element: getPath(a) };
      })
    });

    // C-11 — External links missing rel="noopener" (P3)
    var extLinks = allLinks.filter(function (a) {
      var href = a.getAttribute('href') || '';
      return a.getAttribute('target') === '_blank' && href.indexOf('http') === 0;
    });
    var noOpener = extLinks.filter(function (a) {
      return (a.getAttribute('rel') || '').indexOf('noopener') === -1;
    });
    r.push({
      id: 'C-11', pillar: 'content', priority: 'P3',
      label: 'External links have rel="noopener"',
      status: noOpener.length === 0 ? 'pass' : 'warn',
      detail: noOpener.length === 0
        ? 'All ' + extLinks.length + ' external links have rel="noopener"'
        : noOpener.length + ' external link(s) missing rel="noopener"',
      items: noOpener.map(function (a) {
        return { text: a.textContent.trim() || a.getAttribute('href'), element: getPath(a) };
      })
    });

    // C-12 — Dead hash-only anchors (P2)
    var hashAnchors = allLinks.filter(function (a) {
      return a.getAttribute('href') === '#';
    });
    r.push({
      id: 'C-12', pillar: 'content', priority: 'P2',
      label: 'No dead href="#" anchors',
      status: hashAnchors.length === 0 ? 'pass' : 'warn',
      detail: hashAnchors.length === 0
        ? 'No empty anchors found'
        : hashAnchors.length + ' link(s) with href="#"',
      items: hashAnchors.map(function (a) {
        return { text: a.textContent.trim() || '[no text]', element: getPath(a) };
      })
    });

    // C-13 — Empty links (P1)
    var emptyLinks = allLinks.filter(function (a) {
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
      items: emptyLinks.map(function (a) {
        return { text: a.getAttribute('href'), element: getPath(a) };
      })
    });

    // ── CTAs ────────────────────────────────────────────────────────────
    var ctaEls = getCTAs();

    // C-15 — Generic CTA text (P3)
    var genericCTAs = ctaEls.filter(function (el) {
      var text = el.textContent.trim().toLowerCase();
      return CONFIG.genericCtaText.some(function (g) { return text === g; });
    });
    r.push({
      id: 'C-15', pillar: 'content', priority: 'P3',
      label: 'CTAs have descriptive text',
      status: genericCTAs.length === 0 ? 'pass' : 'warn',
      detail: genericCTAs.length === 0
        ? 'All ' + ctaEls.length + ' CTAs have descriptive text'
        : genericCTAs.length + ' CTA(s) with generic text — add aria-label',
      items: genericCTAs.map(function (el) {
        return {
          text: '"' + el.textContent.trim() + '"',
          element: getPath(el),
          suggestion: 'Add aria-label="[descriptive action]"'
        };
      })
    });

    // C-16 — CTAs have accessible label (P2)
    var iconOnlyCTAs = ctaEls.filter(function (el) {
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
      items: iconOnlyCTAs.map(function (el) {
        return { text: el.outerHTML.substring(0, 80), element: getPath(el) };
      })
    });

    // C-17 — CTA inventory (P4, informational)
    r.push({
      id: 'C-17', pillar: 'content', priority: 'P4',
      label: 'CTA inventory',
      status: 'info',
      detail: ctaEls.length + ' CTA element(s) found',
      items: ctaEls.map(function (el) {
        return { text: el.textContent.trim() || '[icon-only]', href: el.getAttribute('href') || el.tagName };
      })
    });

    // ── FORMS ───────────────────────────────────────────────────────────
    var inputs = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
    ));
    var unlabelledInputs = inputs.filter(function (inp) {
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
      items: unlabelledInputs.map(function (inp) {
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
      items: embeds.map(function (el) {
        return { text: el.tagName, src: el.getAttribute('src') || el.getAttribute('data-src') || 'no src' };
      })
    });

    return r;
  }

  function checkResponsive() {
    var r = [];

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

    // R-05 — Touch targets >= 44x44px (P2)
    var interactiveEls = Array.from(document.querySelectorAll('a, button, [role="button"], input, select'));
    var smallTargets = interactiveEls.filter(function (el) {
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
      items: smallTargets.slice(0, 10).map(function (el) {
        var rect = el.getBoundingClientRect();
        return {
          text: el.textContent.trim().substring(0, 30) || el.tagName,
          size: Math.round(rect.width) + 'x' + Math.round(rect.height) + 'px'
        };
      })
    });

    // R-06 — Navigation visible (P2)
    var navEl = document.querySelector(CONFIG.selectors.header);
    var navRect = navEl ? navEl.getBoundingClientRect() : null;
    r.push({
      id: 'R-06', pillar: 'responsive', priority: 'P2',
      label: 'Navigation visible at current viewport',
      status: navRect && navRect.height > 0 ? 'pass' : 'warn',
      detail: navRect ? 'Header height: ' + Math.round(navRect.height) + 'px' : 'No header/nav element found',
    });

    // R-07 — Image overflow (P3)
    var imgOverflows = Array.from(document.querySelectorAll('img')).filter(function (img) {
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

    // R-08 — srcset coverage (P4)
    var allImgs = Array.from(document.querySelectorAll('img'));
    var withSrcset = allImgs.filter(function (img) { return img.hasAttribute('srcset'); });
    var coverage = allImgs.length > 0 ? Math.round((withSrcset.length / allImgs.length) * 100) : 100;
    r.push({
      id: 'R-08', pillar: 'responsive', priority: 'P4',
      label: 'Responsive srcset coverage',
      status: 'info',
      detail: withSrcset.length + ' of ' + allImgs.length + ' images (' + coverage + '%) use srcset',
    });

    // R-POPUP — Breakpoint popup buttons (informational)
    r.push({
      id: 'R-POPUP', pillar: 'responsive', priority: 'P4',
      label: 'View at breakpoints',
      status: 'info',
      detail: 'Use buttons to open page at mobile/tablet/desktop width',
      isBreakpointControl: true,
    });

    return r;
  }

  function checkAccessibility() {
    var r = [];

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
    focusableEls.forEach(function (el) {
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
    var negativeTabIndex = allTabIndex.filter(function (el) {
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
      items: negativeTabIndex.slice(0, 5).map(function (el) {
        return { text: el.tagName + ': ' + el.className.substring(0, 40), element: getPath(el) };
      })
    });

    // A-06 — ARIA roles valid (P3)
    var validRoles = ['alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'cell', 'checkbox',
      'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition', 'dialog', 'directory', 'document',
      'feed', 'figure', 'form', 'grid', 'gridcell', 'group', 'heading', 'img', 'link', 'list', 'listbox', 'listitem',
      'log', 'main', 'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
      'navigation', 'none', 'note', 'option', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region',
      'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton',
      'status', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'timer', 'toolbar', 'tooltip',
      'tree', 'treegrid', 'treeitem'];
    var roleEls = Array.from(document.querySelectorAll('[role]'));
    var invalidRoles = roleEls.filter(function (el) {
      return validRoles.indexOf(el.getAttribute('role')) === -1;
    });
    r.push({
      id: 'A-06', pillar: 'accessibility', priority: 'P3',
      label: 'ARIA roles are valid',
      status: invalidRoles.length === 0 ? 'pass' : 'warn',
      detail: invalidRoles.length === 0
        ? 'All ' + roleEls.length + ' role attributes are valid'
        : invalidRoles.length + ' invalid ARIA role(s)',
      items: invalidRoles.map(function (el) {
        return { text: 'role="' + el.getAttribute('role') + '"', element: getPath(el) };
      })
    });

    // A-07 — aria-expanded on toggle buttons (P3)
    var toggleBtns = Array.from(document.querySelectorAll('button, [role="button"]')).filter(function (btn) {
      var controls = btn.getAttribute('aria-controls');
      return controls && document.getElementById(controls);
    });
    var missingExpanded = toggleBtns.filter(function (btn) {
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
    var iconBtns = buttons.filter(function (btn) {
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
      items: iconBtns.slice(0, 5).map(function (btn) {
        return { text: btn.className.substring(0, 50), element: getPath(btn) };
      })
    });

    // A-09 — Decorative SVGs are aria-hidden (P3)
    var svgs = Array.from(document.querySelectorAll('svg'));
    var svgsWithoutHidden = svgs.filter(function (svg) {
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
    var uncontrolled = autoplayMedia.filter(function (el) {
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
    var emptyAnchors = allLinks.filter(function (a) {
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
      items: emptyAnchors.slice(0, 5).map(function (a) {
        return { text: a.getAttribute('href'), element: getPath(a) };
      })
    });

    return r;
  }

  // ─── PHASE 2: ASYNC LINK & CTA CHECKER ────────────────────────────────

  async function runPhase2() {
    var allLinks = Array.from(document.querySelectorAll('a[href]'));
    var internalLinks = allLinks
      .map(function (a) { return { el: a, href: a.getAttribute('href') }; })
      .filter(function (item) {
        var href = item.href;
        if (!href) return false;
        if (href.charAt(0) === '#') return false;
        if (/^(mailto|tel|javascript):/i.test(href)) return false;
        if (href.indexOf('http') === 0 && href.indexOf(location.origin) !== 0) return false;
        return true;
      })
      .map(function (item) {
        return {
          el: item.el,
          href: item.href.charAt(0) === '/' ? location.origin + item.href : item.href,
          original: item.href
        };
      });

    var seenHrefs = {};
    var uniqueLinks = internalLinks.filter(function (l) {
      if (seenHrefs[l.href]) return false;
      seenHrefs[l.href] = true;
      return true;
    });

    // Quick mode: sample rather than exhaust. Record what was left out so the
    // result can say "25 of 300 sampled" instead of implying full coverage.
    var linkTotalFound = uniqueLinks.length;
    var linksSampled = false;
    if (CONFIG.mode === 'quick') {
      CONFIG.linkTimeout = CONFIG.quickLinkTimeout;
      if (uniqueLinks.length > CONFIG.quickLinkSample) {
        uniqueLinks = uniqueLinks.slice(0, CONFIG.quickLinkSample);
        linksSampled = true;
      }
    }

    var ctaEls = getCTAs();
    var ctaLinks = ctaEls
      .filter(function (el) { return el.tagName === 'A' && el.getAttribute('href'); })
      .map(function (el) { return { el: el, href: el.getAttribute('href'), isCTA: true }; })
      .filter(function (item) {
        var href = item.href;
        return href && href !== '#' && !/^(mailto|tel|javascript):/i.test(href);
      });

    var total = uniqueLinks.length + ctaLinks.length;
    updateLinkProgress(0, total);

    var broken = [];
    var ctaFailed = [];
    var done = 0;
    // Cross-origin links we could only confirm as "reachable" via an opaque
    // response. Reported so the score is never silently overstated.
    var unverified = 0;

    // Link health is checked in up to three passes, because a cross-origin
    // fetch that throws tells us nothing about the link — it usually means the
    // target simply sends no CORS headers, which is true of most of the web.
    // Treating that as "broken" is what produced false positives on every
    // external link. Only a definite signal is allowed to fail a link.
    //   1. HEAD (same-origin, or CORS-enabled cross-origin) → real status code
    //   2. GET  (some servers reject HEAD with 405/501)     → real status code
    //   3. no-cors GET → opaque response: proves the host resolved and
    //      answered, so the link is reachable even though we cannot read the
    //      status. Anything still failing here is genuinely unreachable.
    var sameOrigin = function (u) {
      try { return new URL(u, location.href).origin === location.origin; } catch (e) { return false; }
    };

    function timedFetch(href, opts) {
      var controller = new AbortController();
      var timeout = setTimeout(function () { controller.abort(); }, CONFIG.linkTimeout);
      opts.signal = controller.signal;
      opts.redirect = 'follow';
      return fetch(href, opts).then(
        function (res) { clearTimeout(timeout); return res; },
        function (err) { clearTimeout(timeout); throw err; }
      );
    }

    async function checkUrl(href) {
      var isLocal = sameOrigin(href);
      // credentials only for same-origin: sending cookies cross-origin is both
      // a privacy leak and a guaranteed CORS rejection.
      var creds = isLocal ? 'include' : 'omit';
      var lastErr = null;

      for (var i = 0; i < 2; i++) {
        try {
          var res = await timedFetch(href, { method: i === 0 ? 'HEAD' : 'GET', credentials: creds });
          // 405/501 => method not allowed, retry as GET before believing it.
          if (i === 0 && (res.status === 405 || res.status === 501)) continue;
          return { href: href, status: res.status, ok: res.ok };
        } catch (e) {
          lastErr = e;
          if (e.name === 'AbortError') return { href: href, status: 'timeout', ok: false };
        }
      }

      // Both readable attempts failed. Distinguish "blocked by CORS" (fine)
      // from "host does not answer" (genuinely broken).
      try {
        await timedFetch(href, { method: 'GET', mode: 'no-cors', credentials: 'omit' });
        return { href: href, status: 'opaque', ok: true, unverified: true };
      } catch (e) {
        if (e.name === 'AbortError') return { href: href, status: 'timeout', ok: false };
        return { href: href, status: 'unreachable', ok: false };
      }
    }

    async function processBatch(items, isCTA) {
      for (var i = 0; i < items.length; i += CONFIG.linkBatchSize) {
        var batch = items.slice(i, i + CONFIG.linkBatchSize);
        var batchResults = await Promise.all(batch.map(function (item) {
          var url = item.href;
          if (url.charAt(0) === '/') url = location.origin + url;
          return checkUrl(url);
        }));
        batchResults.forEach(function (result, idx) {
          done++;
          updateLinkProgress(done, total);
          if (result.unverified) unverified++;
          if (!result.ok) {
            var entry = {
              href: result.href,
              original: batch[idx].original || result.href,
              httpStatus: result.status,
              element: getPath(batch[idx].el),
              linkText: batch[idx].el ? batch[idx].el.textContent.trim().substring(0, 40) || '[no text]' : '[no text]'
            };
            if (isCTA) ctaFailed.push(entry);
            else broken.push(entry);
          }
        });
      }
    }

    if (total > 0) {
      await processBatch(uniqueLinks, false);
      await processBatch(ctaLinks, true);
    } else {
      updateLinkProgress(0, 0);
    }

    // C-08 — Internal links not 404 (P1)
    results.content.push({
      id: 'C-08', pillar: 'content', priority: 'P1',
      label: 'Internal links resolve (not 404)',
      status: broken.length === 0 ? 'pass' : 'fail',
      detail: (broken.length === 0
        ? (linksSampled
            ? 'No broken links in a sample of ' + uniqueLinks.length + ' of ' + linkTotalFound + ' — NOT full coverage'
            : 'All ' + uniqueLinks.length + ' internal links resolve correctly')
        : broken.length + ' broken link(s) found'
            + (linksSampled ? ' in a sample of ' + uniqueLinks.length + ' of ' + linkTotalFound : ''))
        + (unverified > 0 ? ' (' + unverified + ' cross-origin link(s) reachable but status unreadable)' : ''),
      sampled: linksSampled,
      linksChecked: uniqueLinks.length,
      linksFound: linkTotalFound,
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
      unverifiedCount: unverified,
      items: ctaFailed
    });

    finalizeScores();

    if (CONFIG.ui === 'toast') {
      updateToast('Sending report to dashboard…', 90);
      sendToServer();
    } else {
      renderFinalResults();
      if (CONFIG.autoSend) sendToServer();
    }
  }

  // ─── SCORING ENGINE ───────────────────────────────────────────────────

  var PRIORITY_WEIGHTS = { P1: 4, P2: 2, P3: 1, P4: 0 };
  var RESULT_SCORES = { pass: 1.0, warn: 0.5, fail: 0.0, info: null };

  function calcPillarScore(checks) {
    var earned = 0;
    var possible = 0;
    checks.forEach(function (c) {
      var weight = PRIORITY_WEIGHTS[c.priority] || 0;
      if (weight === 0) return;
      var factor = RESULT_SCORES[c.status];
      if (factor === null || factor === undefined) return;
      earned += weight * factor;
      possible += weight;
    });
    return possible === 0 ? 100 : Math.round((earned / possible) * 100);
  }

  function calcOverallScore(pillarScores) {
    var w = CONFIG.weights;
    return Math.round(
      pillarScores.metadata * w.metadata +
      pillarScores.content * w.content +
      pillarScores.responsive * w.responsive +
      pillarScores.accessibility * w.accessibility
    );
  }

  function getGoNoGo(overall, allChecks) {
    var p1Failures = allChecks.filter(function (c) {
      return c.priority === 'P1' && c.status === 'fail';
    });
    if (p1Failures.length > 0)
      return { status: 'BLOCK', reason: p1Failures.length + ' P1 failure(s) detected' };
    if (overall >= 90)
      return { status: 'PASS', reason: 'Ready for promotion' };
    if (overall >= 80)
      return { status: 'PASS_WITH_WARNINGS', reason: 'Promote — fix warnings next sprint' };
    if (overall >= 70)
      return { status: 'CONDITIONAL', reason: 'Fix P1+P2 failures before promoting' };
    return { status: 'FAIL', reason: 'Score below threshold' };
  }

  function finalizeScores() {
    var allChecks = [].concat(results.metadata, results.content, results.responsive, results.accessibility);
    overallScores.metadata = calcPillarScore(results.metadata);
    overallScores.content = calcPillarScore(results.content);
    overallScores.responsive = calcPillarScore(results.responsive);
    overallScores.accessibility = calcPillarScore(results.accessibility);
    overallScores.overall = calcOverallScore(overallScores);
    overallScores.goNoGo = getGoNoGo(overallScores.overall, allChecks);
  }

  // ─── QA PANEL UI ──────────────────────────────────────────────────────

  function injectPanelStyles() {
    var style = document.createElement('style');
    style.id = 'aem-qa-styles';
    style.textContent = [
      // KONE design system: blue + white lead, black for structure, sand as the
      // one supporting neutral. Flat and high-key — no gradients, no blur, and
      // a single soft edge shadow only so the panel separates from the page it
      // overlays. Inter is sentence case and never blue; the ALL-CAPS labels
      // carry the blue. No emoji anywhere.
      '#aem-qa-panel, #aem-qa-panel * { box-sizing:border-box; font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; }',
      '#aem-qa-panel { position:fixed; top:0; right:0; width:400px; height:100vh;',
      '  background:#FFFFFF; color:#141414; z-index:2147483647; border-left:1px solid #E6E6E6;',
      '  display:flex; flex-direction:column; box-shadow:0 6px 20px rgba(20,20,20,.08); font-size:13px; line-height:1.5; overflow:hidden; }',
      '#aem-qa-panel .qa-hdr { background:#1450F5; padding:14px 16px; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }',
      '#aem-qa-panel .qa-hdr h1 { font-size:15px; font-weight:400; margin:0; color:#fff; display:flex; align-items:center; gap:10px; letter-spacing:-0.005em; }',
      '#aem-qa-panel .qa-hdr .qa-mark { display:flex; gap:2px; }',
      '#aem-qa-panel .qa-hdr .qa-mark i { display:block; width:3px; height:14px; background:#fff; }',
      '#aem-qa-panel .qa-hdr .qa-v { font-size:10px; opacity:.8; letter-spacing:.06em; text-transform:uppercase; }',
      '#aem-qa-panel .qa-hdr button { background:transparent; border:1px solid rgba(255,255,255,.55); color:#fff; cursor:pointer; padding:5px 11px; border-radius:8px; font-size:12px; font-weight:600; transition:background 140ms ease; }',
      '#aem-qa-panel .qa-hdr button:hover { background:rgba(255,255,255,.16); border-color:#fff; }',
      '#aem-qa-panel .qa-meta { padding:10px 16px; background:#F3EEE6; border-bottom:1px solid #E6E6E6; font-size:11px; color:#727272; flex-shrink:0; display:flex; justify-content:space-between; gap:12px; }',
      '#aem-qa-panel .qa-bod { flex:1; overflow-y:auto; padding:16px; }',
      '#aem-qa-panel .qa-scr { background:#FFFFFF; border:1px solid #E6E6E6; border-radius:8px; padding:16px; margin-bottom:16px; }',
      '#aem-qa-panel .qa-scr-hdr { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; gap:12px; }',
      '#aem-qa-panel .qa-scr-v { font-size:34px; font-weight:400; line-height:1; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }',
      '#aem-qa-panel .qa-scr-v.p { color:#1ED273; } #aem-qa-panel .qa-scr-v.w { color:#FFA023; } #aem-qa-panel .qa-scr-v.f { color:#FF5F28; }',
      '#aem-qa-panel .qa-status-tag { font-size:10px; letter-spacing:.05em; text-transform:uppercase; font-weight:600; padding:3px 8px; border-radius:4px; border:1px solid; white-space:nowrap; }',
      '#aem-qa-panel .qa-status-tag.PASS { background:rgba(30,210,115,.16); color:#0B7A42; border-color:rgba(30,210,115,.45); }',
      '#aem-qa-panel .qa-status-tag.PASS_WITH_WARNINGS, #aem-qa-panel .qa-status-tag.CONDITIONAL { background:rgba(255,160,35,.16); color:#96590A; border-color:rgba(255,160,35,.45); }',
      '#aem-qa-panel .qa-status-tag.BLOCK, #aem-qa-panel .qa-status-tag.FAIL { background:rgba(255,95,40,.14); color:#B23A11; border-color:rgba(255,95,40,.4); }',
      '#aem-qa-panel .qa-bar { height:4px; background:#E6E6E6; border-radius:2px; overflow:hidden; margin-bottom:12px; }',
      '#aem-qa-panel .qa-fill { height:100%; border-radius:2px; transition:width .2s ease; }',
      '#aem-qa-panel .qa-p1a { background:rgba(255,95,40,.10); border:1px solid rgba(255,95,40,.4); color:#B23A11; border-radius:8px; padding:8px 11px; font-size:12px; font-weight:600; margin-bottom:12px; }',
      '#aem-qa-panel .qa-p-scores { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }',
      '#aem-qa-panel .qa-p-card { background:#F3EEE6; border-radius:8px; padding:9px 10px; }',
      '#aem-qa-panel .qa-p-val { font-size:17px; font-weight:400; font-variant-numeric:tabular-nums; letter-spacing:-.01em; }',
      '#aem-qa-panel .qa-p-lbl { font-size:9px; color:#1450F5; text-transform:uppercase; letter-spacing:.06em; margin-top:2px; }',
      '#aem-qa-panel .qa-pil { border:1px solid #E6E6E6; border-radius:8px; margin-bottom:12px; overflow:hidden; }',
      '#aem-qa-panel .qa-ph { background:#F3EEE6; padding:10px 13px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; border-bottom:1px solid #E6E6E6; }',
      '#aem-qa-panel .qa-pt { font-size:11px; font-weight:400; color:#1450F5; text-transform:uppercase; letter-spacing:.06em; }',
      '#aem-qa-panel .qa-ps { font-size:12px; font-weight:600; font-variant-numeric:tabular-nums; }',
      '#aem-qa-panel .qa-pb { background:#fff; }',
      '#aem-qa-panel .qa-chk { padding:9px 13px; border-bottom:1px solid #F0F0F0; display:flex; gap:9px; align-items:flex-start; border-left:3px solid transparent; }',
      '#aem-qa-panel .qa-chk:last-child { border-bottom:none; }',
      '#aem-qa-panel .qa-chk.pass { border-left-color:#1ED273; }',
      '#aem-qa-panel .qa-chk.warn { border-left-color:#FFA023; background:rgba(255,160,35,.05); }',
      '#aem-qa-panel .qa-chk.fail { border-left-color:#FF5F28; background:rgba(255,95,40,.06); }',
      '#aem-qa-panel .qa-chk.info { border-left-color:#D0D0D0; }',
      '#aem-qa-panel .qa-ci { flex-shrink:0; width:15px; height:15px; margin-top:1px; }',
      '#aem-qa-panel .qa-ci svg { width:15px; height:15px; display:block; }',
      '#aem-qa-panel .qa-chk.pass .qa-ci { color:#1ED273; } #aem-qa-panel .qa-chk.warn .qa-ci { color:#FFA023; }',
      '#aem-qa-panel .qa-chk.fail .qa-ci { color:#FF5F28; } #aem-qa-panel .qa-chk.info .qa-ci { color:#A1A1A1; }',
      '#aem-qa-panel .qa-cb { flex:1; min-width:0; }',
      '#aem-qa-panel .qa-cl { font-size:12px; font-weight:600; color:#141414; }',
      '#aem-qa-panel .qa-cd { font-size:11px; color:#727272; margin-top:2px; }',
      '#aem-qa-panel .qa-items { margin-top:5px; background:#F3EEE6; border-radius:4px; padding:6px 9px; }',
      '#aem-qa-panel .qa-item { font-size:10px; color:#727272; margin-bottom:2px; word-break:break-all; }',
      '#aem-qa-panel .qa-bg { font-size:9px; letter-spacing:.05em; padding:1px 5px; border-radius:4px; margin-right:5px; border:1px solid; text-transform:uppercase; }',
      '#aem-qa-panel .qa-bg.P1 { color:#B23A11; border-color:rgba(255,95,40,.45); background:rgba(255,95,40,.12); }',
      '#aem-qa-panel .qa-bg.P2 { color:#96590A; border-color:rgba(255,160,35,.45); background:rgba(255,160,35,.12); }',
      '#aem-qa-panel .qa-bg.P3 { color:#727272; border-color:#D0D0D0; background:#F3EEE6; }',
      '#aem-qa-panel .qa-bg.P4 { color:#A1A1A1; border-color:#E6E6E6; background:#fff; }',
      '#aem-qa-panel .qa-ftr { padding:11px 16px; border-top:1px solid #E6E6E6; background:#fff; flex-shrink:0; }',
      '#aem-qa-panel .qa-bp { display:flex; gap:7px; }',
      '#aem-qa-panel .qa-bp button { flex:1; white-space:nowrap; font-size:11px; padding:8px 8px; border-radius:8px; border:1px solid #D0D0D0; background:#fff; color:#141414; cursor:pointer; font-weight:600; transition:background 140ms ease,border-color 140ms ease; }',
      '#aem-qa-panel .qa-bp button:hover { background:#F3EEE6; border-color:#A1A1A1; }',
      '#aem-qa-panel .qa-bp button.qa-primary { background:#1450F5; border-color:#1450F5; color:#fff; }',
      '#aem-qa-panel .qa-bp button.qa-primary:hover { background:#4373F7; border-color:#4373F7; }',
      '#aem-qa-panel .qa-prg { padding:10px 16px; background:#F3EEE6; border-bottom:1px solid #E6E6E6; font-size:11px; color:#727272; flex-shrink:0; }',
      '#aem-qa-panel .qa-pgb { height:4px; background:#E6E6E6; border-radius:2px; margin-top:6px; overflow:hidden; }',
      '#aem-qa-panel .qa-pgf { height:100%; background:#1450F5; border-radius:2px; transition:width .2s; }' 
    ].join('\n');
    document.head.appendChild(style);
  }

  function injectPanel() {
    var panel = document.createElement('div');
    panel.id = CONFIG.panelId;
    panel.innerHTML = [
      '<div class="qa-hdr">',
      '  <h1><span class="qa-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span> AEM QA <span class="qa-v">v' + CONFIG.version + '</span></h1>',
      '  <button id="qa-close-btn">Close</button>',
      '</div>',
      '<div class="qa-meta">',
      '  <span>' + location.hostname + '</span>',
      '  <span>' + new Date().toLocaleTimeString() + '</span>',
      '</div>',
      '<div class="qa-scr" id="qa-score-card">',
      '  <!-- Rendered dynamically -->',
      '</div>',
      '<div class="qa-prg" id="qa-progress">',
      '  <div id="qa-progress-text">Checking links… 0/0 (0%)</div>',
      '  <div class="qa-pgb"><div class="qa-pgf" id="qa-pbar-fill" style="width:0%"></div></div>',
      '</div>',
      '<div class="qa-bod" id="qa-body">',
      '  <div class="qa-pil" data-pillar="metadata">',
      '    <div class="qa-ph"><span class="qa-pt">Metadata</span><span class="qa-ps" id="qa-ps-metadata">--</span></div>',
      '    <div class="qa-pb open" id="qa-pb-metadata"></div>',
      '  </div>',
      '  <div class="qa-pil" data-pillar="content">',
      '    <div class="qa-ph"><span class="qa-pt">Content and components</span><span class="qa-ps" id="qa-ps-content">--</span></div>',
      '    <div class="qa-pb open" id="qa-pb-content"></div>',
      '  </div>',
      '  <div class="qa-pil" data-pillar="responsive">',
      '    <div class="qa-ph"><span class="qa-pt">Responsive layout</span><span class="qa-ps" id="qa-ps-responsive">--</span></div>',
      '    <div class="qa-pb" id="qa-pb-responsive"></div>',
      '  </div>',
      '  <div class="qa-pil" data-pillar="accessibility">',
      '    <div class="qa-ph"><span class="qa-pt">Accessibility</span><span class="qa-ps" id="qa-ps-accessibility">--</span></div>',
      '    <div class="qa-pb" id="qa-pb-accessibility"></div>',
      '  </div>',
      '</div>',
      '<div class="qa-ftr">',
      '  <div class="qa-bp">',
      '  <button id="qa-btn-server" class="qa-primary">Send to dashboard</button>',
      '  <button id="qa-btn-export">Export JSON</button>',
      '  <button id="qa-btn-copy">Copy report</button>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(panel);

    document.getElementById('qa-close-btn').addEventListener('click', function () {
      panel.remove();
      var existingStyles = document.getElementById('aem-qa-styles');
      if (existingStyles) existingStyles.remove();
    });

    document.querySelectorAll('#aem-qa-panel .qa-ph').forEach(function (hdr) {
      hdr.addEventListener('click', function () {
        var body = this.nextElementSibling;
        body.classList.toggle('open');
      });
    });

    document.getElementById('qa-btn-export').addEventListener('click', exportJSON);
    document.getElementById('qa-btn-copy').addEventListener('click', copyReport);
    document.getElementById('qa-btn-server').addEventListener('click', sendToServer);
  }

  function renderScoreCard() {
    var sc = document.getElementById('qa-score-card');
    if (!sc) return;

    var overall = overallScores.overall;
    var statusClass = overall >= 80 ? (overall >= 90 ? 'p' : 'w') : 'f';
    var fillBg = overall >= 80 ? (overall >= 90 ? '#10B981' : '#F59E0B') : '#EF4444';
    var g = overallScores.goNoGo;

    var allChecks = [].concat(results.metadata, results.content, results.responsive, results.accessibility);
    var p1Fails = allChecks.filter(function (c) { return c.priority === 'P1' && c.status === 'fail'; }).length;

    // Quick mode headlines the blocker count, not a score. Only P1 checks ran,
    // so a 0-100 would read high (all P2/P3 issues invisible) and invite a
    // false comparison against full-audit numbers.
    var isQuick = CONFIG.mode === 'quick';
    var headline = isQuick
      ? [
          '  <div>',
          '    <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;font-weight:600;margin-bottom:2px;">Go-live blockers</div>',
          '    <div class="qa-scr-v ' + (p1Fails ? 'f' : 'p') + '">' + p1Fails + '<span style="font-size:16px;">/' + allChecks.length + ' P1</span></div>',
          '  </div>'
        ].join('')
      : [
          '  <div>',
          '    <div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;font-weight:600;margin-bottom:2px;">Overall Health</div>',
          '    <div class="qa-scr-v ' + statusClass + '">' + overall + '<span style="font-size:16px;">/100</span></div>',
          '  </div>'
        ].join('');

    sc.innerHTML = [
      '<div class="qa-scr-hdr">',
      headline,
      '  <div class="qa-status-tag ' + g.status + '">' + g.status.replace(/_/g, ' ') + '</div>',
      '</div>',
      isQuick
        ? '<div style="font-size:11px;color:#141414;background:#F3EEE6;border-left:3px solid #1450F5;border-radius:4px;padding:8px 11px;margin-bottom:10px;line-height:1.5;"><b>Quick scan</b> — P1 blockers only, links sampled. Run a full audit for the complete 49-check picture.</div>'
        : '',
      '<div class="qa-bar"><div class="qa-fill" style="width:' + overall + '%;background:' + fillBg + ';"></div></div>',
      p1Fails > 0 ? '<div class="qa-p1a">Blocks go-live — ' + p1Fails + ' P1 ' + (p1Fails === 1 ? 'failure' : 'failures') + '</div>' : '',
      // Per-pillar percentages are omitted in quick mode: derived from P1s
      // alone they are not the pillar health a reader would assume.
      isQuick ? '' : [
        '<div class="qa-p-scores">',
        '  <div class="qa-p-card"><div class="qa-p-val">' + overallScores.metadata + '%</div><div class="qa-p-lbl">Meta</div></div>',
        '  <div class="qa-p-card"><div class="qa-p-val">' + overallScores.content + '%</div><div class="qa-p-lbl">Content</div></div>',
        '  <div class="qa-p-card"><div class="qa-p-val">' + overallScores.responsive + '%</div><div class="qa-p-lbl">Resp</div></div>',
        '  <div class="qa-p-card"><div class="qa-p-val">' + overallScores.accessibility + '%</div><div class="qa-p-lbl">A11y</div></div>',
        '</div>'
      ].join('\n')
    ].join('\n');
  }

  function renderChecks(pillar, checks) {
    var container = document.getElementById('qa-pb-' + pillar);
    var scoreElem = document.getElementById('qa-ps-' + pillar);
    if (!container) return;

    if (scoreElem) {
      scoreElem.textContent = overallScores[pillar] + '%';
    }

    var html = checks.map(function (c) {
      var icon = c.status === 'pass' ? "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 12l5 5L20 6\"/></svg>"
        : c.status === 'warn' ? "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3 1.5 21h21L12 3zM12 10v5M12 18h.01\"/></svg>"
          : c.status === 'fail' ? "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg>" : "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 11v5M12 8h.01\"/></svg>";

      var itemsHtml = '';
      if (c.items && c.items.length > 0) {
        itemsHtml = '<div class="qa-items">' + c.items.map(function (it) {
          var text = typeof it === 'string' ? it : (it.text || it.detail || JSON.stringify(it));
          var sub = typeof it === 'object' && it.element ? ' <span style="opacity:0.7">[' + it.element + ']</span>' : '';
          return '<div class="qa-item">' + text + sub + '</div>';
        }).join('') + '</div>';
      }

      var popupHtml = '';
      if (c.isBreakpointControl) {
        popupHtml = [
          '<div class="qa-bp">',
          '  <button onclick="window.open(location.href, \'_blank\', \'width=375,height=812\')">375px Mobile ↗</button>',
          '  <button onclick="window.open(location.href, \'_blank\', \'width=768,height=1024\')">768px Tablet ↗</button>',
          '  <button onclick="window.open(location.href, \'_blank\', \'width=1440,height=900\')">1440px Desktop ↗</button>',
          '</div>'
        ].join('');
      }

      return [
        '<div class="qa-chk ' + c.status + '">',
        '  <div class="qa-ci">' + icon + '</div>',
        '  <div class="qa-cb">',
        '    <div class="qa-cl"><span class="qa-bg ' + c.priority + '">' + c.priority + '</span>' + c.label + '</div>',
        '    <div class="qa-cd">' + c.detail + '</div>',
        '    ' + itemsHtml,
        '    ' + popupHtml,
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    container.innerHTML = html;
  }

  function renderPartialResults() {
    // Panel-only. In toast mode there is no panel DOM to render into.
    if (CONFIG.ui !== 'panel') return;
    renderScoreCard();
    renderChecks('metadata', results.metadata);
    renderChecks('content', results.content);
    renderChecks('responsive', results.responsive);
    renderChecks('accessibility', results.accessibility);
  }

  function renderFinalResults() {
    renderPartialResults();
  }

  // ─── EXPORT & PAYLOAD FUNCTIONS ──────────────────────────────────────

  function buildReportPayload() {
    var allChecks = [].concat(results.metadata, results.content, results.responsive, results.accessibility);
    var defects = allChecks.filter(function (c) { return c.status === 'fail' || c.status === 'warn'; });

    return {
      meta: {
        url: location.href,
        pageTitle: document.title,
        auditedAt: new Date().toISOString(),
        toolVersion: CONFIG.version,
        viewport: window.innerWidth,
        // A quick scan runs only P1 checks, so its 0-100 would skew high — a
        // page failing ten P2s but no P1 would score 100. Publishing that
        // number next to full-audit scores would be actively misleading, so
        // quick reports carry a verdict and a blocker count instead.
        overallScore: CONFIG.mode === 'quick' ? null : overallScores.overall,
        threshold: CONFIG.thresholdScore,
        status: overallScores.goNoGo.status,
        goNoGo: overallScores.goNoGo.status,
        auditMode: CONFIG.mode,
        checksRun: allChecks.length,
        checksAvailable: CONFIG.mode === 'quick' ? 15 : 49,
        p1FailCount: allChecks.filter(function (c) { return c.priority === 'P1' && c.status === 'fail'; }).length
      },
      scores: {
        metadata: { score: overallScores.metadata, weight: CONFIG.weights.metadata },
        content: { score: overallScores.content, weight: CONFIG.weights.content },
        responsive: { score: overallScores.responsive, weight: CONFIG.weights.responsive },
        accessibility: { score: overallScores.accessibility, weight: CONFIG.weights.accessibility }
      },
      checks: allChecks,
      defects: defects,
      info: {
        totalChecks: allChecks.length,
        passed: allChecks.filter(function (c) { return c.status === 'pass'; }).length,
        warned: allChecks.filter(function (c) { return c.status === 'warn'; }).length,
        failed: allChecks.filter(function (c) { return c.status === 'fail'; }).length
      }
    };
  }

  // ─── TOAST UI (CONFIG.ui === 'toast') ───────────────────────────────
  // Lightweight fire-and-forget presentation: no panel, auto-sends on finish.

  function injectToast() {
    var style = document.createElement('style');
    style.id = 'aem-qa-toast-style';
    style.textContent = [
      '@keyframes qa-slide{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes qa-fade{from{opacity:1}to{opacity:0}}',
      '#aem-qa-toast{position:fixed;bottom:24px;right:24px;width:300px;',
      'background:#FFFFFF;color:#141414;border:1px solid #E6E6E6;border-left:4px solid #1450F5;border-radius:8px;',
      'padding:14px 18px;font-family:Inter,system-ui,-apple-system,Arial,sans-serif;',
      'font-size:13px;z-index:2147483647;box-shadow:0 6px 20px rgba(20,20,20,0.10);',
      'animation:qa-slide 0.3s ease;line-height:1.6;}',
      '#aem-qa-toast.qa-done{animation:qa-fade 0.5s ease 3.5s forwards;}',
      '#aem-qa-toast .qa-t-title{font-weight:600;font-size:14px;color:#141414;margin-bottom:4px;}',
      '#aem-qa-toast .qa-t-msg{color:#727272;font-size:12px;min-height:16px;}',
      '#aem-qa-toast .qa-t-bar{height:3px;background:#E6E6E6;border-radius:2px;margin-top:10px;overflow:hidden;}',
      '#aem-qa-toast .qa-t-fill{height:100%;background:#1450F5;border-radius:2px;transition:width 0.4s ease;}'
    ].join('');
    document.head.appendChild(style);

    var toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.innerHTML = [
      '<div class="qa-t-title">AEM QA</div>',
      '<div class="qa-t-msg" id="qa-t-msg">Running checks…</div>',
      '<div class="qa-t-bar"><div class="qa-t-fill" id="qa-t-fill" style="width:5%"></div></div>'
    ].join('');
    document.body.appendChild(toast);
  }

  // Safe to call in any UI mode — a no-op when no toast is on the page.
  // (The panel build used to call this without defining it, which threw.)
  function updateToast(message, percent, isError, isDone) {
    var msg = document.getElementById('qa-t-msg');
    if (!msg) return;
    msg.textContent = message;
    if (isError) msg.style.color = '#FF5F28';

    var fill = document.getElementById('qa-t-fill');
    if (fill && typeof percent === 'number') fill.style.width = percent + '%';

    if (isDone) {
      var toast = document.getElementById(TOAST_ID);
      if (toast) {
        toast.classList.add('qa-done');
        setTimeout(function () {
          var t = document.getElementById(TOAST_ID);
          if (t) t.remove();
          var s = document.getElementById('aem-qa-toast-style');
          if (s) s.remove();
        }, 4200);
      }
    }
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
    data.defects.forEach(function (d) {
      lines.push('- [' + d.priority + '] ' + d.id + ' — ' + d.label + ': ' + d.detail);
    });
    navigator.clipboard.writeText(lines.join('\n'));
    alert('Report copied to clipboard in Markdown format!');
  }

  // Diagnose a delivery failure into something the operator can act on. A bare
  // "failed to fetch" is indistinguishable between a typo'd endpoint, a blocked
  // scheme and a server that is simply down.
  function explainDeliveryFailure(err) {
    var target = CONFIG.reportServer;
    var isHttps = location.protocol === 'https:';
    var targetIsHttp = /^http:\/\//i.test(target);

    if (isHttps && targetIsHttp) {
      return 'Blocked as mixed content: this page is HTTPS but the dashboard '
        + 'endpoint is HTTP (' + target + '). Rebuild the bookmarklet against '
        + 'your HTTPS dashboard URL.';
    }
    if (/localhost|127\.0\.0\.1/.test(target) && location.hostname !== 'localhost') {
      return 'The bookmarklet is pointing at ' + target + ', which only exists '
        + 'on your own machine. Rebuild it with --endpoint <your dashboard>/api/report.';
    }
    return 'Could not reach ' + target + ' (' + (err && err.message ? err.message : 'network error')
      + '). Check the dashboard is running and the URL is correct.';
  }

  async function deliverReport(data) {
    var payload = { type: 'AEM_QA_REPORT', report: data };

    // ── Fast paths ───────────────────────────────────────────────────────────
    // Neither confirms delivery, so neither is allowed to report success. They
    // exist to make the dashboard update instantly when it happens to be
    // listening; the HTTP POST below is the authoritative channel.
    //
    // postMessage is targeted at the dashboard origin, never '*' — audit
    // payloads embed internal author/stage URLs and page content.
    if (window.opener && !window.opener.closed && CONFIG.reportOrigin) {
      try { window.opener.postMessage(payload, CONFIG.reportOrigin); } catch (ex) {}
    }
    // BroadcastChannel only reaches same-origin tabs, so for a real AEM audit
    // (page origin ≠ dashboard origin) this is a no-op. Kept for the case where
    // the dashboard and the audited page are served from the same host.
    try {
      var bc = new BroadcastChannel('aem_qa_channel');
      bc.postMessage(payload);
      bc.close();
    } catch (ex) {}

    // ── Authoritative path: awaited, with the real outcome returned ──────────
    var headers = { 'Content-Type': 'application/json' };
    if (CONFIG.apiToken) headers['X-QA-Token'] = CONFIG.apiToken;

    try {
      var res = await fetch(CONFIG.reportServer, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data)
      });

      if (res.ok) return { ok: true, message: 'Report delivered to the dashboard' };

      if (res.status === 401) {
        return { ok: false, message: 'Rejected (401): the dashboard requires an API token. '
          + 'Rebuild the bookmarklet with --token, or clear QA_API_TOKEN on the server.' };
      }
      var body = '';
      try { body = (await res.json()).error || ''; } catch (e) {}
      return { ok: false, message: 'Dashboard rejected the report (HTTP ' + res.status + ')'
        + (body ? ': ' + body : '') };
    } catch (err) {
      return { ok: false, message: explainDeliveryFailure(err) };
    }
  }

  async function sendToServer() {
    var data = buildReportPayload();

    // ── Center-screen completion dialog ──────────────────────────────────────
    var score = data.meta.overallScore;
    var goNoGo = data.meta.goNoGo || 'UNKNOWN';
    var isPass = goNoGo === 'PASS' || goNoGo === 'PASS_WITH_WARNINGS';
    var gc = isPass ? '#1ED273' : ((score === null || score >= 50) ? '#FFA023' : '#FF5F28');
    var icon = isPass ? CHECK_SVG : ((score === null || score >= 50) ? WARN_SVG : FAIL_SVG);
    var shortU = location.href.length > 68 ? location.href.slice(0, 68) + '…' : location.href;

    // Quick scans have no comparable 0-100, so headline the blocker count.
    var headlineValue = data.meta.auditMode === 'quick'
      ? data.meta.p1FailCount + ' blocker' + (data.meta.p1FailCount === 1 ? '' : 's')
      : score + ' / 100';

    var inner = '<div style="background:#FFFFFF;border-radius:8px;padding:28px 32px;max-width:430px;width:88%;text-align:left;box-shadow:0 6px 20px rgba(20,20,20,.14);border:1px solid #E6E6E6;border-top:4px solid ' + gc + ';box-sizing:border-box;font-family:Inter,system-ui,-apple-system,Arial,sans-serif;color:#141414">'
      + '<div style="color:' + gc + ';margin-bottom:12px;line-height:0">' + icon + '</div>'
      + '<div style="font-size:11px;font-weight:400;letter-spacing:.06em;text-transform:uppercase;color:#1450F5;margin-bottom:12px">AEM QA '
      + (data.meta.auditMode === 'quick' ? 'Quick Scan' : 'Audit') + ' Complete</div>'
      + '<div style="background:#F3EEE6;border-radius:8px;padding:12px 16px;font-size:26px;font-weight:400;color:' + gc + ';letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin-bottom:12px">' + headlineValue + '</div>'
      + '<div style="color:#727272;font-size:12px;margin-bottom:8px">Status: <b style="color:#141414">' + goNoGo + '</b></div>'
      + '<div style="font-size:10px;color:#A1A1A1;margin-bottom:14px;word-break:break-all;overflow:hidden;max-height:26px">' + shortU + '</div>'
      + '<div id="__qaaudcl__" style="font-size:11px;color:#727272;background:#F3EEE6;border-radius:4px;padding:8px 12px;display:block;line-height:1.5">Sending to the QA dashboard…</div>'
      + '</div>';

    // Try <dialog>.showModal() — browser top-layer, beats ALL z-index/overflow:hidden
    var shown = false;
    try {
      var old = document.getElementById('__qaaud__'); if (old) old.remove();
      var dlg = document.createElement('dialog');
      dlg.id = '__qaaud__';
      dlg.style.cssText = 'background:rgba(20,20,20,.55);border:none;padding:0;margin:0;width:100vw;height:100vh;max-width:100vw;max-height:100vh;overflow:hidden;box-sizing:border-box;display:flex;align-items:center;justify-content:center';
      dlg.innerHTML = inner;
      document.body.appendChild(dlg);
      dlg.showModal();
      shown = true;
    } catch (ex) {}

    // Fallback: position:fixed div
    if (!shown) {
      var old2 = document.getElementById('__qaaud__'); if (old2) old2.remove();
      var ov = document.createElement('div');
      ov.id = '__qaaud__';
      ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(20,20,20,.55);z-index:2147483647;display:flex;align-items:center;justify-content:center';
      ov.innerHTML = inner;
      (document.body || document.documentElement).appendChild(ov);
    }

    // Report what actually happened. This used to say "Sent!" on a timer
    // regardless of the outcome, so a report that never left the browser looked
    // identical to one the dashboard had stored.
    var outcome = await deliverReport(data);
    var status = document.getElementById('__qaaudcl__');

    if (outcome.ok) {
      if (status) {
        status.style.color = '#0B7A42';
        status.textContent = outcome.message + ' — closing…';
      }
      updateToast(headlineValue + ' — ' + goNoGo + ' — delivered to dashboard', 100, false, true);
      setTimeout(function () {
        var el = document.getElementById('__qaaud__');
        if (el) el.remove();
      }, 2200);
      return;
    }

    // Failure: keep the dialog open, explain why, and leave the operator a way
    // to salvage the result rather than silently losing the audit.
    if (status) {
      status.style.color = '#B23A11';
      status.innerHTML = '<b>Not delivered.</b><br>' + escapeHtmlText(outcome.message)
        + '<br><br><button id="__qaretry__" style="background:#1450F5;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:11px;font-weight:600;cursor:pointer;margin-right:6px">Retry</button>'
        + '<button id="__qadl__" style="background:#fff;color:#141414;border:1px solid #D0D0D0;border-radius:8px;padding:7px 14px;font-size:11px;font-weight:600;cursor:pointer;margin-right:6px">Download JSON</button>'
        + '<button id="__qaclose__" style="background:none;color:#727272;border:none;font-size:11px;cursor:pointer">Close</button>';

      var retry = document.getElementById('__qaretry__');
      if (retry) retry.addEventListener('click', function () {
        var el = document.getElementById('__qaaud__');
        if (el) el.remove();
        sendToServer();
      });
      var dl = document.getElementById('__qadl__');
      if (dl) dl.addEventListener('click', exportJSON);
      var cl = document.getElementById('__qaclose__');
      if (cl) cl.addEventListener('click', function () {
        var el = document.getElementById('__qaaud__');
        if (el) el.remove();
      });
    }
    updateToast('Report not delivered — ' + outcome.message, 100, true, false);
  }

  var CHECK_SVG = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>';
  var WARN_SVG  = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 1.5 21h21L12 3zM12 10v5M12 18h.01"/></svg>';
  var FAIL_SVG  = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function escapeHtmlText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── BOOT ─────────────────────────────────────────────────────────────
  // Must stay last: everything above is now initialised, including the `var`
  // lookup tables the scoring engine depends on.

  if (CONFIG.ui === 'toast') {
    injectToast();
  } else {
    injectPanelStyles();
    injectPanel();
  }
  runPhase1();
  runPhase2();

})();
