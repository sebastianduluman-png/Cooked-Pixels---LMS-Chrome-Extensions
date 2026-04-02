# TODO — Cooked Pixels

## Planned Features

- [ ] **Double-fire detection** — Detect when the same event fires 2+ times (e.g., duplicate `purchase` = inflated ROAS). Compare events by timestamp proximity + transaction_id + value + source. Flag duplicates with a visible warning badge on the event card and a dedicated "Duplicates" severity in insights. Critical for catching the most common tracking bug on client sites
- [ ] **Tracking health score** — Automatic per-platform score (0-100%) based on: all funnel events present, value/currency populated, items with IDs, transaction_id on purchase, enhanced conversions active, no duplicates. Show as a dashboard widget: "GA4: 85% · GAds: 60% · Meta: 40%" with specific actionable recommendations per platform (e.g., "GAds purchase missing transaction_id", "Meta has no AddToCart event")
- [ ] **Weekly tracking health report via email** — Scheduled weekly email report with: currency mismatches detected (RON on GA4 vs USD on GAds), value anomalies (negative values, purchase with value=0, items with price=0), missing transaction_id on purchase events, tracking health scores per platform, comparison with previous week. Requires a lightweight backend/cloud function (e.g., Firebase Cloud Functions or AWS Lambda) to aggregate data from BigQuery stream and send via SendGrid/Mailgun. Configurable recipients and report day in extension settings
- [ ] **Consent Mode section** — Dedicated section showing Google Consent Mode v2 status: `ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization` states (granted/denied), detect `gcs` param in GA4 requests and `gdpr` / `gdpr_consent` in Meta requests, show default vs updated consent, flag when consent is denied but events still fire
- [ ] **Cross-event item ID validation** — In insights, compare item IDs across different funnel stages (not just across platforms within a stage). Example: detect if `item_id` in `view_item` (GA4) differs from `item_id` in `add_to_cart` (GAds or Meta). Check all combinations: view→cart, cart→checkout, checkout→purchase across all platform pairs
- [ ] **BigQuery real-time stream** — Stream captured events in real-time to a BigQuery table for historical analysis, dashboarding, and auditing. Configure project/dataset/table in settings, use BigQuery Storage Write API or insertAll
- [ ] **Group conversions by label** — In the Google Ads conversion view, group conversion events by `conversion_label`. Show each label as a collapsible section with its events, counts, and total value. Useful for seeing which conversion actions fired vs which didn't
- [ ] **Multiple pixel detection** — Detect when a site has multiple tracking IDs for the same platform (e.g., 2 GA4 measurement IDs, 3 Meta Pixels, multiple AW- conversion IDs). Show a warning/info section listing all detected IDs per platform with event counts for each
- [ ] **TikTok Pixel support** — Intercept TikTok Pixel (`analytics.tiktok.com`) events, parse ecommerce data, add as 4th platform column
- [ ] **Pinterest Tag support** — Intercept Pinterest conversion tracking events
- [ ] **Snapchat Pixel support** — Intercept Snap Pixel events
- [ ] **LinkedIn Insight Tag support** — Intercept LinkedIn conversion events
- [ ] **Server-side event validation** — Compare client-side events with server-side (CAPI) events when both are present
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
