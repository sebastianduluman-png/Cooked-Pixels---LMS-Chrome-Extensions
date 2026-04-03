# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Cooked Pixels — a Chrome Extension (Manifest V3) that observes Google Analytics 4, Google Ads conversion, and Meta Pixel (Facebook) network requests in real-time and displays ecommerce events in a popup UI. Built for the PPC team at Limitless Agency. No build step — plain JS/CSS/HTML loaded directly by Chrome. Repo: `sebastianduluman-png/Cooked-Pixels---LMS-Chrome-Extensions`.

## Loading the Extension

1. Open `chrome://extensions/`, enable "Developer mode"
2. Click "Load unpacked" and select this directory
3. After code changes, click the refresh icon on the extension card; for background.js changes, also reopen the popup
4. Inspect the service worker via the "Service worker" link on the extension card

## Architecture

### Execution contexts (communicate via `chrome.runtime.sendMessage`):

**background.js** (Service Worker) — Registers `chrome.webRequest.onBeforeRequest` with path-based URL filters to intercept GA4 requests (`*/g/collect*`, `*/j/collect*`, `*/debug/mp/collect*`), Google Ads requests (`*/pagead/*` on googleadservices.com, doubleclick.net, google.com, googlesyndication.com), and Facebook Pixel requests (`www.facebook.com/tr`). GA4: two-stage detection (path match + param validation `v=2`/`tid`), parses Measurement Protocol including batched POST payloads. Google Ads: extracts conversion ID from URL path, parses value/currency/transaction_id/label params from direct params and `data` param (semicolon-separated key=value pairs like `event=purchase;value=50;currency=USD`). Event name detection: (1) `en` or `event_name` param, (2) `data` param `event` key, (3) fallback based on numeric value > 0 / transaction_id / items / data param presence → `conversion` or `page_view`, (4) maps `gtag.config` → `page_view`. Comma-separated item IDs (e.g. `"sku1,sku2,sku3"`) are split into separate items. Ecommerce data extraction is skipped for `page_view` events. Facebook: extracts pixel_id from `id` param, event name from `ev` param, ecommerce data from three param groups — `cd[...]` (custom data), `pmd[...]` (product metadata: name, description, brand, item_condition), `ap[...]` (automatic params: mpn, item_price, availability). Items merged from all three sources by item_id with priority order pmd → ap → cd. Each event carries a `source` field (`"ga4"`, `"gads"`, or `"fb"`). Persists events to `chrome.storage.local` with serialised per-tab write queues. Updates badge counts.

**popup.js + popup.html + popup.css** (Popup UI) — Five views: **Event List** (default), **Check Matrix** (toggle via "Check Events" button), **Insights** (toggle via "Insights" button), **Consent** (toggle via "Consent" button), and **Pixel Inspector** (toggle via "Pixels" button). Handles `REPLACE_EVENT` messages from background (when a richer event replaces a sparser duplicate) — uses `_identityFP()` to find and swap the sparser event in the local array.

*Event List view:* Source toggle bar (All/GA4/Google Ads/Meta) filters by event source. Filter chips: All, PageView, View, Cart, Checkout, Purchase — maps Facebook PascalCase events to GA4 equivalents (e.g. PageView↔page_view, ViewContent↔view_item). Cards show event name, method (GET/POST), source badge (GA4/GAds/Meta), endpoint badge, page path, value, tracking ID. Source-tinted gradient on cards. Expandable detail with Payload/Items/Raw JSON tabs.

*Check Matrix view:* 6×3 grid (Page View/View/Cart/Checkout/Purchase/Conversion rows × GA4/Google Ads/Meta columns). Each cell shows green checkmark + count if at least one event fired, dim dash if not. N/A shown for platform/event combinations that don't exist (e.g. Conversion for GA4/Meta). Source toggle hides in this view. Real-time updates auto-refresh.

*Insights view:* Cross-platform comparison for 5 stages (Page View, View, Cart, Checkout, Purchase). For each stage, selects the **richest** event per platform (scored by data completeness, not just most recent). Compact horizontal layout: each platform gets one row with event name + inline values. Compares ALL shared properties between platforms (value, currency, transaction_id, item IDs, item count, and all shared event_params). Severity levels: error (value mismatch, missing items), warning (property differences), info (missing platform event — non-actionable), ok (match). Page View row shows only event names — no value/items/IDs. Items compared by matching item_id across platforms, then checking all shared properties per item. Purchase stage includes an **Enhanced Conversions** bar showing email/phone hash presence per platform (GA4: N/A, GAds/Meta: check/dash). **Item IDs section** (after stage cards): aggregates ALL unique item IDs per platform across ALL events (not just best-per-stage), then compares cross-platform using **shared-stages logic** — only IDs from stages where BOTH compared platforms have item-bearing events are included. This prevents false warnings when one platform hasn't fired later-stage events yet (e.g. GA4 has only view_item{A} while Meta has InitiateCheckout{A,B,C} → shared stage is view only → {A} vs {A} → OK). Shows IDs as monospace chips per platform row (max 10, "+N more" if truncated). Included in summary bar pill counts and PDF report export.

*Consent view:* Decodes Google Consent Mode v2 signals (`gcd` and `gcs` URL parameters) from GA4 and Google Ads requests. Shows 4 consent categories: ad_storage, analytics_storage, ad_user_data, ad_personalization. **General Status** section shows unified consent per category — if GA4 and GAds agree, single pill; if they disagree, orange "Discrepancy" pill with per-platform breakdown. **Platform Grid** shows decoded state per category per platform (GA4/GAds only — Meta doesn't use gcd/gcs). **Consent Changes** section detects and warns when consent state changes mid-session — but skips normal CMP flows: transitions from `not_set` (consent mode not loaded yet) and `denied` → `granted` when the GCD code indicates a consent update (`r`, `n`, `v`) are not flagged. Only genuine mid-session regressions (e.g. `granted` → `denied`) trigger warnings. **Raw Values** section shows raw gcd/gcs strings with character-by-character decoded annotations. Info note explains that functionality_storage, security_storage, personalization_storage are not transmitted in gcd/gcs.

*Pixel Inspector view:* Aggregates all detected tracking IDs per platform from captured events. `collectPixelData()` scans `events[]`, groups by platform (GA4/Google Ads/Meta), and collects unique IDs with associated endpoints (hostnames), event counts, event names, and conversion labels (GAds only). Per-platform sections show each unique ID in a monospace card with endpoint hostname chips and event summary. **Multiple ID warning**: if more than one unique ID is detected for the same platform, an orange warning banner lists all IDs found and flags potential misconfiguration. ID extraction: GA4 → `payload.measurement_id`, Google Ads → `payload.conversion_id`, Meta → `payload.pixel_id`. Events with no extractable ID are skipped. sGTM proxy endpoints naturally display the proxy hostname. CSS classes prefixed `pv-`.

**content.js** — Stub placeholder (unused). All capture via webRequest.

### Consent Mode Decoding

**GCD parameter** (`gcd`): Format `<2-char prefix><consent codes separated by digits><suffix>`. Prefix `11` or `13`, suffix `5` or `7`. 4 letter codes in order: ad_storage, analytics_storage, ad_user_data, ad_personalization. Letter meanings: `l`=not set, `p`=denied (default), `q`=denied (both), `t`=granted (default), `r`=denied→granted, `m`=denied (update), `n`=granted (update), `u`=granted→denied, `v`=granted (both). Capital letters = same meaning but inherited from another category.

**GCS parameter** (`gcs`): Format `G1<ad_storage><analytics_storage>`. `1`=granted, `0`=denied.

Extracted in `extractConsent(params)` → stored as `consent` field on each event object. Facebook events get `consent: null`.

### Enhanced Conversions / Advanced Matching

Google Ads Enhanced Conversions: `em` (email SHA256 hash), `ph` (phone SHA256 hash) extracted from URL params and `data` param. Stored in `payload.user_data`.

Facebook Advanced Matching: `ud[em]` (email hash), `ud[ph]` (phone hash) extracted alongside `cd[...]`, `pmd[...]`, `ap[...]` param groups. Stored in `payload.user_data`.

GA4 does not send user data in the Measurement Protocol (handled server-side) — always shown as N/A.

### PDF Report Export

Export button generates a standalone HTML report opened in a new tab with auto-print. Built entirely in `generateReport()` + `reportCSS()` functions in popup.js. No external dependencies — pure inline HTML/CSS. Structured with semantic HTML (`<h2>` section headings, `<table>` with `<thead>`/`<tbody>`) for machine-parseability. Report sections in order:

1. **Tracking IDs** — Per-platform table of all detected measurement IDs (GA4), conversion IDs (Google Ads), pixel IDs (Meta) with endpoints, event counts, event names, and conversion labels. Multiple-ID warnings per platform. Uses `collectPixelData()`.
2. **Event Coverage** — 6×3 grid (Page View/View/Cart/Checkout/Purchase/Conversion × GA4/GAds/Meta). Cells show checkmark + count + event names for hits, N/A for impossible combos, dash for misses. Mirrors popup Check Matrix logic.
3. **Consent Mode** — Four sub-sections: General Consent Status (unified per-category with discrepancy detection), Platform Breakdown (per-category per-platform with GCD code + inheritance indicator), Consent Changes (mid-session anomalies), Raw Consent Strings (gcd/gcs with decoded annotations). Uses `getLatestConsent()`, `detectConsentChanges()`. Falls back gracefully when no consent signals exist.
4. **Insights Summary** — Stage-by-stage cross-platform comparison with severity badges, Enhanced Conversions bar (purchase only), and Item IDs analysis.
5. **Event Payloads** — Best event per stage per platform with event_params table, items table, and user_data (Enhanced Conversions).
6. **Event Timeline** — Chronological table of all events with timestamp, source, event name, value, and item count.

### Why `<all_urls>` in host_permissions

GA4 requests go to many different hosts: `www.google-analytics.com`, `analytics.google.com`, `region{1-9}.google-analytics.com`, `www.googletagmanager.com`, and arbitrary first-party domains when server-side GTM is configured (e.g., `analytics.mysite.com/g/collect`). Google Ads conversion requests go to `www.googleadservices.com`, `googleads.g.doubleclick.net`, and `www.google.com`. Facebook Pixel requests go to `www.facebook.com/tr`. Catching sGTM requires permission to observe requests on any host. The URL filter narrows the listener to specific paths.

### GA4 Request Detection (`isGA4Collect`)

Two-stage check to avoid false positives on arbitrary domains:
1. URL pathname must match `/g/collect`, `/j/collect`, or `/debug/mp/collect`
2. URL params must contain `v=2` (GA4 protocol version) or `tid` (measurement ID)

### Google Ads Request Detection

**`isGAdsConversion`** — Conversion/ecommerce requests:
1. URL pathname must match `/pagead/conversion/`, `/pagead/1p-conversion/`, or `/pagead/viewthroughconversion/`
2. Hostname must be a known Google Ads host (googleadservices.com, doubleclick.net, google.com)

**`isGAdsPageview`** — Non-conversion `/pagead/` requests (broader coverage):
1. URL pathname must contain `/pagead/` but NOT match conversion paths
2. Must not be a static asset (.js, .css, .png, etc.)
3. Hostname must be a known Google Ads host (including pagead2.googlesyndication.com)

### Facebook Pixel Detection (`isFBPixel`)

Two-stage check:
1. Hostname must be `www.facebook.com`
2. URL pathname must be exactly `/tr` or `/tr/`

Facebook events (PascalCase): PageView, ViewContent, AddToCart, AddToWishlist, InitiateCheckout, AddPaymentInfo, Purchase, Search. Three param groups: `cd[key]` (custom data — value, currency, contents, content_ids, content_type, etc.), `pmd[key]` (product metadata — name, description, brand, item_condition, aggregate_rating), `ap[key]` (automatic params — mpn, item_price, availability). Items merged from `cd[contents]`, `pmd[contents]`, and `ap[contents]` (JSON arrays) by item_id, with pmd → ap → cd priority. Fallback: `cd[content_ids]` when no contents arrays exist. Item fields mapped: id→item_id, ids→item_id, item_price→price, name→item_name, brand→item_brand.

### Persistence

`chrome.storage.local` keyed by `tab_{tabId}` → `{ origin, events[] }`. Survives service worker termination, page navigation, browser restarts. Write queue per tab serialises rapid events. Stale tab data pruned on `runtime.onStartup`. `_appendEvent` supports in-place replacement when a richer event supersedes a sparser duplicate (via `event._replaces` flag).

### Event Deduplication

Two-layer in-memory dedup in background.js prevents duplicate events from polluting the UI and storage. State held in `_dedupCache` (per-tab Map of identity fingerprints → `{ ts, score }`), reset on page navigation (`chrome.tabs.onUpdated` status "loading") and tab removal.

**Identity fingerprint** (`identityFingerprint(event)`) — coarse key using only source + tracking ID + event name:
- GA4: `ga4|measurement_id|event_name`
- Google Ads: `gads|conversion_id|conversion_label|event_name`
- Facebook: `fb|pixel_id|event_name`

**Event scoring** (`eventScore(event)`) — counts non-empty `event_params` fields + item count + item fields + `user_data` fields. Higher score = richer data.

**Layer 1 — Rapid duplicates (≤ 2 s, `RAPID_WINDOW_MS`):** Same identity within 2 seconds → keep richest, drop sparser/equal. Catches protocol retries, duplicate GTM tags, gtag+GTM overlap.

**Layer 2 — Sparse-beacon removal (2–15 s, `DEDUP_WINDOW_MS`):** If one side has score ≤ `SPARSE_THRESHOLD` (2) and the other has real data → drop the sparse one. Catches Meta's lightweight `/tr` GET beacons that fire alongside the full data request.

**Both events have real data and gap > 2 s:** Treated as separate logical events (e.g. two `add_to_cart` for different products). Not deduplicated.

When a richer event replaces a sparser one, `event._replaces` is set so `_appendEvent` swaps the old event in storage and a `REPLACE_EVENT` message updates the popup.

### Message Protocol

| Message         | Direction          | Purpose                                          |
|-----------------|--------------------|--------------------------------------------------|
| `GET_EVENTS`    | popup → background | Load events for current tab                      |
| `NEW_EVENT`     | background → popup | Push new event in real-time                      |
| `REPLACE_EVENT` | background → popup | Replace a sparser duplicate with a richer event  |
| `CLEAR_EVENTS`  | popup → background | Clear events for current tab                     |
| `EXPORT_EVENTS` | popup → background | Get events for report export                     |

## UI Conventions

- Dark theme via CSS custom properties in `:root` (popup.css)
- Dark palette: #222222 bg, #404040 borders, #07F2C7 teal accent, #301B92/#280F7A purple, #F6CF12 gold, #1877F2 Facebook blue, #4CAF50 consent-granted, #ef4444 consent-denied, #f59e0b consent-discrepancy
- Color coding: lavender = pageview, teal = view, gold = cart, purple = checkout, mint = purchase
- Source toggle: segmented button bar (All / GA4 / Google Ads / Meta) with SVG icons; hides in Check Matrix, Insights, Consent, and Pixel Inspector views
- Check Events button: pill button in status bar, toggles to Check Matrix view
- Insights button: pill button in status bar, toggles to Insights view
- Consent button: pill button (padlock icon) in status bar, toggles to Consent Mode view; hides source toggle + filter chips
- Pixels button: pill button (radar icon) in status bar, toggles to Pixel Inspector view; hides source toggle + filter chips
- Export Report button: document icon in header, generates print-ready HTML report in new tab
- Source badges on each card: purple "GA4", gold "GAds", blue "Meta" — each with inline SVG icon
- GET/POST method badges; endpoint badges (teal "sGTM" for first-party, purple "GA4" for standard Google hosts, gold "Google Ads" for GAds, blue "Meta Pixel" for FB)
- JSON syntax highlighting: `.json-key` (purple), `.json-string` (mint), `.json-number` (gold), `.json-bool` (teal), `.json-null` (muted)
- Popup dimensions: 600×600px

## CSP Compliance

No inline scripts, no `eval()`, no `script.textContent` injection. Relies entirely on `chrome.webRequest` (observe-only). Popup loads a single `<script src="popup.js">`. PDF report uses blob URL (`text/html`) opened in a new tab — the inline `<script>` for auto-print is allowed in blob URLs (not subject to extension CSP).

## Event Selection for Insights

`findBestEvent(source, eventNames)` selects the event with the richest data for each platform/stage, not just the most recent. `eventDataScore(e)` scores events by counting non-empty `event_params`, item fields, and `user_data` fields. On equal scores, the most recent event wins.

## Project Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension config (MV3, permissions, icons) |
| `background.js` | Service worker — request interception & parsing |
| `popup.js` | UI controller — 5 views + report generator |
| `popup.html` | Popup markup |
| `popup.css` | Dark theme styles |
| `content.js` | Stub (unused) |
| `CLAUDE.md` | This file — architecture docs |
| `README.md` | GitHub readme |
| `TODO.md` | Feature roadmap |
| `MISTAKES.md` | Bug log + pre-deploy checklist |
