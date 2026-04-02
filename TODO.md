# TODO — Cooked Pixels

## Planned Features

- [ ] **TikTok Pixel support** — Intercept TikTok Pixel (`analytics.tiktok.com`) events, parse ecommerce data, add as 4th platform column
- [ ] **Pinterest Tag support** — Intercept Pinterest conversion tracking events
- [ ] **Snapchat Pixel support** — Intercept Snap Pixel events
- [ ] **LinkedIn Insight Tag support** — Intercept LinkedIn conversion events
- [ ] **Server-side event validation** — Compare client-side events with server-side (CAPI) events when both are present
- [ ] **Consent mode detection** — Show whether Google Consent Mode v2 is active and which consent states are set
- [ ] **DataLayer inspector** — Show `dataLayer.push()` events alongside network requests
- [ ] **GTM container detection** — Identify which GTM containers are loaded and their IDs
- [ ] **Event diffing** — Compare two events side-by-side to spot differences
- [ ] **Persistent sessions** — Save event history across browser sessions for long debugging sessions
- [ ] **Custom event name mapping** — Allow users to define custom event name aliases for comparison
- [ ] **Export to Google Sheets** — Direct export of event data to a Google Sheet
- [ ] **Notification alerts** — Desktop notifications when specific events fire (e.g., purchase)
- [ ] **Regex-based URL filtering** — Filter events by page URL pattern
- [ ] **Dark/Light theme toggle** — Add light mode option for the popup UI

## Improvements

- [ ] **Better item comparison in insights** — Group items by ID and show a visual diff table
- [ ] **Insights history** — Track insights results over time to see if issues get resolved
- [ ] **Batch event detection** — Flag when GA4 events are being batched vs sent individually
- [ ] **Conversion linker detection** — Show if Google Ads conversion linker is active
- [ ] **Attribution parameters** — Show gclid, fbclid, ttclid and other click IDs present on the page
- [ ] **PDF report enhancements** — Add charts/graphs, executive summary, and recommendation section

## Known Limitations

- Chrome Extension only (no Firefox/Safari support yet)
- Cannot intercept events sent via Fetch API `keepalive` in some edge cases
- Enhanced Conversions data only captured from Google Ads and Meta (GA4 handles it server-side)
