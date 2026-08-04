# Delivering Digital Excellence: A Stakeholder’s Guide to AEM Page Quality


The **AEM Automated QA Tool** acts as an instant digital inspector. With a single click, it runs **52 quality checks in under 15 seconds** to ensure our pages look polished, work flawlessly, and uphold our brand’s guidelines before going live.

---

## 🌟 The 4 Pillars of Site Health

Instead of complex code jargon, our automated QA tool organizes every page inspection into **4 human-friendly pillars**:

```
                              ┌─────────────────────────────────────────┐
                              │       AEM DIGITAL QUALITY AUDIT         │
                              └────────────────────┬────────────────────┘
                                                   │
        ┌───────────────────┬──────────────────────┼───────────────────┐
        ▼                   ▼                      ▼                   ▼
┌───────────────┐   ┌───────────────┐      ┌───────────────┐   ┌───────────────┐
│ 1. VISIBILITY │   │ 2. INTEGRITY  │      │ 3. ADAPTABILITY│  │ 4. INCLUSION  │
│  (SEO & Meta) │   │ (Content/Links)│     │  (Responsive) │   │ (Accessibility)│
└───────────────┘   └───────────────┘      └───────────────┘   └───────────────┘
```

### 1. Digital Visibility (SEO & Search Readiness)
Ensures search engines and professional networks (e.g., Google, LinkedIn) can properly discover, index, and present KONE pages to prospective clients and candidates.

- **What Is Checked**: Page title structure, meta descriptions, canonical page URLs, and social sharing tags (OpenGraph).
- **Business Impact**: Maximizes organic search traffic and ensures shared links display accurate titles and preview cards.

---

### 2. Content & Brand Consistency
Ensures text hierarchy, navigation links, and interactive elements across all KONE pages are functional and professional.

- **What Is Checked**:
  - **Link & Button Integrity**: Confirms all call-to-action (CTA) buttons and links direct users to valid destinations (no dead "404 Not Found" pages).
  - **Author Environment Leaks**: Ensures internal preview URLs (`author-p12345...`) or unshortened `/content/` paths are not exposed to public visitors.
  - **Placeholder Text Cleanliness**: Scans for leftover draft notes or placeholder text.
  - **Heading Hierarchy**: Verifies proper section structuring with a single primary title (`<h1>`).
- **Business Impact**: Maintains brand credibility and prevents customer drop-off during inquiry or product exploration journeys.

---

### 3. Multi-Device Adaptability (Responsive Experience)
Guarantees KONE pages adapt seamlessly across desktop computers, tablets, and mobile devices.

- **What Is Checked**:
  - **Viewport Layout**: Ensures page content fits within mobile screen boundaries without horizontal clipping.
  - **Touch-Friendly Controls**: Verifies interactive buttons are sized appropriately for touch navigation on mobile screens.
  - **Text Legibility**: Confirms font sizes remain comfortable to read on all screen sizes.
- **Business Impact**: Delivers an optimal experience for mobile visitors researching KONE solutions on the go.

---

### 4. Inclusive Digital Experience (Accessibility / WCAG)
Ensures KONE digital touchpoints are accessible to all visitors, including people who rely on screen readers or keyboard navigation.

- **What Is Checked**:
  - **Color Contrast**: Verifies sufficient contrast between text and background colors for readability.
  - **Media Descriptions (Alt Text)**: Ensures images include meaningful text descriptions for screen readers.
  - **Keyboard Navigation**: Confirms all interactive features can be navigated using standard keyboard controls.
  - **Form Labels**: Checks that inquiry and contact forms have clear, accessible field labels.
- **Business Impact**: Upholds global digital compliance standards (WCAG 2.1 AA) and reinforces KONE's commitment to inclusion.

---

## 🚥 The Evaluation Model (Traffic Light System)

When an author runs the audit, results are presented in a clear, actionable summary:

| Signal | Score Benchmark | Status & Meaning | Action |
|---|---|---|---|
| 🟢 **GO** | **80% - 100%** | Meets quality standards with zero critical defects. | Ready for publication. |
| 🟡 **WARNING** | **80%+ (P2 Flags)** | Fully functional, with minor recommendations noted (e.g., long title). | Publishable; schedule minor refinements. |
| 🔴 **NO-GO** | **Below 80% or Hard Blocker** | Contains a critical flaw affecting user experience or link routing. | **Publication Paused.** Fix flagged issues. |

---

## ⚡ Critical Release Blockers (P1 Flagged Issues)

A **P1 Hard Blocker** represents a high-priority defect that automatically pauses page publication until corrected. Examples include:

1. 🚫 **Missing Page Title**: Pages published without a primary heading (`<h1>`).
2. 🚫 **Broken CTA Button**: A primary contact or inquiry button leading to an error page.
3. 🚫 **Internal Link Exposure**: Links pointing to internal authoring or staging URLs instead of published domain paths.
4. 🚫 **Unreachable Media**: Image elements failing to load or display correctly.
5. 🚫 **Unlabeled Form Input**: Contact fields lacking accessible labels for screen readers.

---

## ⏱️ Simple 1-Click Workflow for Authors

Executing an audit requires no technical setup:

1. Open any AEM preview or author page in your web browser.
2. Click **`AEM QA`** in your browser bookmarks bar.
3. Review the 15-second side panel summary.
4. Optionally click **`📡 Send to Server`** to sync results with the central **Executive Quality Dashboard**.

---

## 📈 Executive Summary & Business Value

- 🛡️ **Brand Protection**: Eliminates broken links, staging leaks, and unformatted content across regional and global sites.
- 🚀 **SEO Readiness**: Ensures new product pages, service offerings, and news articles adhere to search engine best practices.
- ⚖️ **Compliance & Inclusion**: Enforces WCAG 2.1 AA accessibility compliance across all digital assets.
- ⏱️ **Operational Efficiency**: Replaces manual page reviews with a 1-click automated process.

---


