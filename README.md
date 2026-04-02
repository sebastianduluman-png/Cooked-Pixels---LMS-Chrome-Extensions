# Cooked Pixels

**Real-time ecommerce event inspector for GA4, Google Ads & Meta Pixel.**

A Chrome Extension built for PPC teams to debug, validate, and compare ecommerce tracking across platforms — all from a single popup.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Version](https://img.shields.io/badge/version-1.5.0-purple)

---

## What It Does

Cooked Pixels intercepts network requests from **Google Analytics 4**, **Google Ads**, and **Meta Pixel** in real-time and displays ecommerce events in a clean, actionable UI. No configuration needed — just install and browse.

### Supported Platforms

| Platform | Detection | Events |
|----------|-----------|--------|
| **GA4** | Measurement Protocol (`/g/collect`, `/j/collect`) | `page_view`, `view_item`, `add_to_cart`, `begin_checkout`, `purchase` |
| **Google Ads** | Conversion tracking (`/pagead/conversion/`) | `page_view` (gtag.config), `conversion`, `purchase`, and all ecommerce events |
| **Meta Pixel** | Facebook Pixel (`/tr`) | `PageView`, `ViewContent`, `AddToCart`, `InitiateCheckout`, `Purchase` |

### Key Features

- **Event List** — Live feed of all ecommerce events with expandable payload details, items, and raw JSON
- **Check Matrix** — 6x3 grid showing which events fired on which platform at a glance
- **Cross-Platform Insights** — Compares values, items, IDs, and all shared properties between GA4, Google Ads, and Meta for each funnel stage
- **Enhanced Conversions** — Detects hashed email/phone data from Google Ads Enhanced Conversions and Meta Advanced Matching
- **PDF Report Export** — One-click report with full insights analysis, event payloads, and timeline
- **Source Filtering** — Filter by platform (All / GA4 / Google Ads / Meta) and event type
- **Server-side GTM Detection** — Identifies first-party endpoints vs standard Google hosts

---

## Installation

1. Clone this repo or download as ZIP
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the project folder
5. The Cooked Pixels icon appears in your toolbar — click it on any page

---

## How It Works

```
[Web Page] → network requests → [background.js Service Worker]
                                        │
                                  intercepts & parses
                                  GA4 / GAds / Meta
                                        │
                                        ▼
                              [chrome.storage.local]
                                        │
                                        ▼
                              [popup.js + popup.html]
                              Event List / Check Matrix / Insights
```

- **background.js** — Service worker that registers `chrome.webRequest.onBeforeRequest` listeners to intercept tracking requests. Parses GA4 Measurement Protocol, Google Ads conversion params + `data` param, and Facebook Pixel `cd[...]` / `pmd[...]` / `ap[...]` param groups.
- **popup.js** — UI controller with three views (Event List, Check Matrix, Insights). Handles cross-platform comparison, enhanced conversion detection, and PDF report generation.
- **popup.css** — Dark theme with platform-specific color coding.

No build step. No dependencies. Plain JS/CSS/HTML.

---

## Views

### Event List
Live feed of captured events. Each card shows:
- Event name, HTTP method, source badge, endpoint type
- Page URL, value, tracking ID
- Expandable: full payload, items table, raw JSON

### Check Matrix
Quick visual audit — did each expected event fire on each platform?
- 6 rows: Page View, View Item, Add to Cart, Begin Checkout, Purchase, Conversion
- 3 columns: GA4, Google Ads, Meta

### Insights
Deep cross-platform comparison for each funnel stage:
- Compares ALL shared properties between platforms
- Flags mismatches (value, currency, transaction ID, item IDs, item properties)
- Enhanced Conversions detection (email/phone hash presence)
- Severity levels: errors, warnings, info, OK

### PDF Report
One-click export opens a print-ready report with:
- Insights summary with severity badges
- Full event payloads per platform per stage
- Items tables with all properties
- Enhanced Conversions status
- Complete event timeline

---

## Permissions

| Permission | Why |
|------------|-----|
| `webRequest` | Observe (not modify) network requests to detect tracking calls |
| `storage` | Persist captured events across service worker restarts |
| `tabs` | Get current tab URL for display and per-tab event storage |
| `activeTab` | Access active tab info when popup opens |
| `<all_urls>` | Required to catch server-side GTM on arbitrary first-party domains |

The extension is **observe-only** — it never blocks, modifies, or injects into any request.

---

## Tech

- Chrome Extension Manifest V3
- Plain JavaScript (no frameworks, no build step)
- CSS custom properties for theming
- `chrome.webRequest` API for request interception
- `chrome.storage.local` for persistence

---

## Built By

**Limitless Agency** — PPC & Performance Marketing

---

*Cooked Pixels is an internal tool built to help PPC teams debug ecommerce tracking implementations faster.*
