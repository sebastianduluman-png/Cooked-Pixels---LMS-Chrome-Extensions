# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Ecommerce Inspector — a Chrome Extension (Manifest V3) that observes Google Analytics 4, Google Ads conversion, and Meta Pixel (Facebook) network requests in real-time and displays ecommerce events in a popup UI. No build step — plain JS/CSS/HTML loaded directly by Chrome.

## Loading the Extension

1. Open `chrome://extensions/`, enable "Developer mode"
2. Click "Load unpacked" and select this directory
3. After code changes, click the refresh icon on the extension card; for background.js changes, also reopen the popup
4. Inspect the service worker via the "Service worker" link on the extension card

## Architecture

### Execution contexts (communicate via `chrome.runtime.sendMessage`):

**background.js** (Service Worker) — Registers `chrome.webRequest.onBeforeRequest` with path-based URL filters to intercept GA4 requests (`*/g/collect*`, `*/j/collect*`, `*/debug/mp/collect*`), Google Ads requests (`*/pagead/*` on googleadservices.com, doubleclick.net, google.com, googlesyndication.com), and Facebook Pixel requests (`www.facebook.com/tr`). GA4: two-stage detection (path match + param validation `v=2`/`tid`), parses Measurement Protocol including batched POST payloads. Google Ads: extracts conversion ID from URL path, parses value/currency/transaction_id/label params from direct params and `data` param (semicolon-separated key=value pairs like `event=purchase;value=50;currency=USD`). Event name detection: (1) `en` or `event_name` param, (2) `data` param `event` key, (3) fallback based on numeric value > 0 / transaction_id / items / data param presence → `conversion` or `page_view`, (4) maps `gtag.config` → `page_view`. Comma-separated item IDs (e.g. `"sku1,sku2,sku3"`) are split into separate items. Ecommerce data extraction is skipped for `page_view` events. Facebook: extracts pixel_id from `id` param, event name from `ev` param, ecommerce data from three param groups — `cd[...]` (custom data), `pmd[...]` (product metadata: name, description, brand, item_condition), `ap[...]` (automatic params: mpn, item_price, availability). Items merged from all three sources by item_id with priority order pmd → ap → cd. Each event carries a `source` field (`"ga4"`, `"gads"`, or `"fb"`). Persists events to `chrome.storage.local` with serialised per-tab write queues. Updates badge counts.

**popup.js + popup.html + popup.css** (Popup UI) — Three views: **Event List** (default), **Check Matrix** (toggle via "Check Events" button), and **Insights** (toggle via "Insights" button).

*Event List view:* Source toggle bar (All/GA4/Google Ads/Meta) filters by event source. Filter chips: All, PageView, View, Cart, Checkout, Purchase — maps Facebook PascalCase events to GA4 equivalents (e.g. PageView↔page_view, ViewContent↔view_item). Cards show event name, method (GET/POST), source badge (GA4/GAds/Meta), endpoint badge, page path, value, tracking ID. Source-tinted gradient on cards. Expandable detail with Payload/Items/Raw JSON tabs.

*Check Matrix view:* 6×3 grid (Page View/View/Cart/Checkout/Purchase/Conversion rows × GA4/Google Ads/Meta columns). Each cell shows green checkmark + count if at least one event fired, dim dash if not. N/A shown for platform/event combinations that don't exist (e.g. Conversion for GA4/Meta). Source toggle hides in this view. Real-time updates auto-refresh.

*Insights view:* Cross-platform comparison for 5 stages (Page View, View, Cart, Checkout, Purchase). For each stage, shows the latest event from each platform side by side. Compares ALL shared properties between platforms (value, currency, transaction_id, item IDs, item count, and all shared event_params). Severity levels: error (value mismatch, missing items), warning (property differences), info (missing platform event — non-actionable), ok (match). Page View row shows only event names — no value/items/IDs. Items compared by matching item_id across platforms, then checking all shared properties per item.

**content.js** — Stub placeholder (unused). All capture via webRequest.

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

`chrome.storage.local` keyed by `tab_{tabId}` → `{ origin, events[] }`. Survives service worker termination, page navigation, browser restarts. Write queue per tab serialises rapid events. Stale tab data pruned on `runtime.onStartup`.

### Message Protocol

| Message        | Direction          | Purpose                      |
|----------------|--------------------|------------------------------|
| `GET_EVENTS`   | popup → background | Load events for current tab  |
| `NEW_EVENT`    | background → popup | Push new event in real-time  |
| `CLEAR_EVENTS` | popup → background | Clear events for current tab |
| `EXPORT_EVENTS`| popup → background | Get events for JSON export   |

## UI Conventions

- Dark theme via CSS custom properties in `:root` (popup.css)
- Dark palette: #222222 bg, #404040 borders, #07F2C7 teal accent, #301B92/#280F7A purple, #F6CF12 gold, #1877F2 Facebook blue
- Color coding: lavender = pageview, teal = view, gold = cart, purple = checkout, mint = purchase
- Source toggle: segmented button bar (All / GA4 / Google Ads / Meta) with SVG icons; hides in Check Matrix view
- Check Events button: pill button in status bar, toggles between Event List and Check Matrix views
- Source badges on each card: purple "GA4", gold "GAds", blue "Meta" — each with inline SVG icon
- GET/POST method badges; endpoint badges (teal "sGTM" for first-party, purple "GA4" for standard Google hosts, gold "Google Ads" for GAds, blue "Meta Pixel" for FB)
- JSON syntax highlighting: `.json-key` (purple), `.json-string` (mint), `.json-number` (gold), `.json-bool` (teal), `.json-null` (muted)
- Popup dimensions: 600×600px

## CSP Compliance

No inline scripts, no `eval()`, no `script.textContent` injection. Relies entirely on `chrome.webRequest` (observe-only). Popup loads a single `<script src="popup.js">`.
