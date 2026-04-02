# MISTAKES — Lessons Learned

This file documents bugs and mistakes encountered during development. Review before every deploy to avoid repeating them.

---

## 1. JavaScript string truthiness: `"0"` is truthy

**Bug:** Google Ads `page_view` events were classified as `conversion` because `value=0` in the URL becomes the string `"0"`, and `!!"0"` is `true`.

**Fix:** Always parse numeric values with `Number()` and check `> 0` instead of relying on string truthiness.

```js
// BAD
const hasValue = !!(p.get("value"));  // "0" → true

// GOOD
const raw = p.get("value") || "";
const num = Number(raw);
const hasValue = raw !== "" && !isNaN(num) && num > 0;
```

**Rule:** Never use `!!stringValue` to check if a numeric parameter has a meaningful value.

---

## 2. Google Ads `en=gtag.config` is a page view, not a conversion

**Bug:** `gtag('config', 'AW-xxx')` fires to `/pagead/conversion/` with `en=gtag.config`. The code never reached the `value=0` fallback because `en` was set explicitly, so it was treated as an unknown event.

**Fix:** Map `gtag.config` → `page_view` AFTER all event name determination steps (not before the data param check).

**Rule:** Always check for internal/non-standard event names and map them to canonical names as a final step.

---

## 3. Comma-separated IDs treated as a single item

**Bug:** Google Ads sends item IDs like `"sku1,sku2,sku3"` as a single string. The parser treated this as one item with ID `"sku1,sku2,sku3"`.

**Fix:** After `JSON.parse` fails, check for commas and split:
```js
if (itemId.includes(",")) {
  ids = itemId.split(",").map(s => s.trim()).filter(Boolean);
}
```

**Rule:** Always handle both JSON arrays and comma-separated strings for item ID fields.

---

## 4. Facebook has THREE param groups, not just `cd[...]`

**Bug:** Only `cd[...]` (custom data) was parsed. Rich product data in `pmd[...]` (product metadata: name, brand, description) and `ap[...]` (automatic params: mpn, price, availability) was silently dropped.

**Fix:** Parse all three groups and merge items by `item_id` with priority order: pmd → ap → cd.

**Rule:** When adding a new platform parser, capture the FULL request payload — don't assume one param group contains everything.

---

## 5. Facebook `ids` field vs `id` field

**Bug:** Some Facebook events use `ids: ["sku"]` (array) instead of `id: "sku"` in their contents. The item mapper only checked for `id`.

**Fix:** Added `ids` handling in `mapFBItem` — extract first element if array.

**Rule:** Always check platform documentation for field name variants. Test with real-world payloads, not just docs.

---

## 6. `findLastEvent` picks sparse duplicates over rich ones

**Bug:** The insights engine picked the most recent event by timestamp, but duplicate events exist with varying data richness. Sometimes the last one had fewer fields.

**Fix:** Replaced `findLastEvent` with `findBestEvent` that scores events by data richness (count of non-empty fields) and picks the highest-scoring one.

**Rule:** When selecting "the" event for analysis, prefer the richest data, not just the most recent.

---

## 7. Ecommerce data leaking into page_view events

**Bug:** Google Ads `gtag('config')` calls share the same `/pagead/conversion/` URL as real conversions. The parser extracted value/items from config calls, making page_view events show conversion data.

**Fix:** Wrap all ecommerce extraction in `if (eventName !== "page_view")`.

**Rule:** Determine the event type FIRST, then decide what data to extract based on that type.

---

## 8. Insights showing items/IDs for PageView stage

**Bug:** Facebook's PageView naturally carries product data from `pmd[contents]`/`ap[contents]`. This was displayed in the insights Page View row even though it's not meaningful.

**Fix:** Skip `renderFieldRows` when stage is `pageview`.

**Rule:** Not all data that exists should be displayed. Consider what's meaningful per event type.

---

## Pre-Deploy Checklist

Before pushing changes:

1. [ ] Test with a real GA4 purchase event — verify value, items, transaction_id
2. [ ] Test with a real Google Ads conversion — verify conversion_id, label, value
3. [ ] Test with a real Facebook Purchase event — verify pixel_id, all 3 param groups
4. [ ] Test Google Ads `gtag('config')` — should appear as `page_view`, no ecommerce data
5. [ ] Test Facebook `PageView` — should appear clean, no items in insights
6. [ ] Test insights with all 3 platforms — verify cross-platform comparison
7. [ ] Test enhanced conversions — verify email/phone hash detection
8. [ ] Test PDF report export — verify it opens and contains all data
9. [ ] Check string truthiness — no `!!` on numeric string params
10. [ ] Check item ID parsing — handle both JSON and comma-separated formats
