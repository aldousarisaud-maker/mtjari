# Mtjari.cc — SEO Strategy

Status: **design only** except where noted. Targets are engineering goals measured at the 75th percentile of real users; they are not ranking guarantees and no feature will claim one.

## Implemented now (Phase 1)

- Server-rendered pages with `lang` and `dir` per locale, `/ar` and `/en` URL prefixes, `hreflang` alternates in metadata.
- `robots.txt` that keeps the dashboard out of the index; token-bearing pages are `noindex` with `no-referrer`.
- Self-hosted fonts via `next/font` (no layout shift from late font swaps, no third-party font requests).

## Implemented in Phase 3 (storefront)

- Server-rendered shop pages (per request, no caching yet) at `/{locale}`, `/{locale}/products`, `/{locale}/c/{slug}`, `/{locale}/p/{slug}`.
- Self-canonical URLs, `hreflang` ar/en/x-default, per-shop `sitemap.xml` (home, categories, products with `lastmod`) and `robots.txt`.
- JSON-LD: `WebSite`, `Product` with offers and availability, `BreadcrumbList`.
- `noindex` for search results, cart and preview mode; unlaunched shops return 404 and an all-disallow robots file.
- Not yet: 301 redirects for changed slugs, sitemap splitting, image sitemaps, merchant-editable meta per page beyond the product SEO fields.

## Technical foundation (target design)

| Area | Approach |
|---|---|
| Rendering | SSR/ISR for every storefront page; no client-only product content |
| URLs | `/{locale}/products/{slug}`, `/{locale}/collections/{slug}`; slugs unique per store, editable, old slugs redirect (301) automatically |
| Canonicals | Self-canonical per locale; variants canonicalise to the parent product unless the merchant marks a variant as indexable; filtered/sorted collection URLs canonicalise to the clean URL |
| Pagination | Real paginated URLs (`?page=2`), self-canonical, no `noindex` on page 2+ |
| hreflang | `ar`, `en` and `x-default` on every page that exists in both languages; reciprocal |
| Sitemaps | Per-store sitemap index with product, collection, page and image sitemaps; split at 50k URLs; `lastmod` from real update times; regenerated on change |
| robots.txt | Per-store, generated; cart, checkout, account and search blocked; merchant can add rules |
| Status codes | Real 404/410; soft-404 detection in the audit tool |
| Custom domains | One primary host; all others 301 to it |

## Structured data

JSON-LD, generated server-side from the same data the page shows: `Organization` and `WebSite` (with search action) on home, `BreadcrumbList` on collection/product, `Product` with `Offer`/`AggregateOffer` (price, currency, availability, SKU, GTIN, brand), `AggregateRating`/`Review` only when real reviews exist, `FAQPage` only for visible FAQ sections. A unit test validates each generator against the schema.org required/recommended fields used by Google.

## Performance (Core Web Vitals)

Targets: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75.

- Images: upload → variants in WebP and AVIF at fixed widths, `srcset`/`sizes`, explicit dimensions, lazy loading below the fold, `fetchpriority="high"` for the LCP image, CDN caching.
- JavaScript: server components by default; per-theme JS budget enforced in the theme contract tests; third-party tags loaded after consent and off the main thread where possible.
- Caching: ISR with tag-based revalidation, CDN in front, Redis for data cache.
- Measurement: field data via the `web-vitals` library sent to an internal endpoint (aggregated per store and template), plus Lighthouse CI budgets on demo stores in CI.

## SEO manager (Phase 7)

Per store and per page/product/collection: meta title and description (with length hints and SERP preview), slug, index/noindex, canonical override, Open Graph and Twitter card fields, image alt text. Redirect manager (301/302, bulk import, loop detection). 404 monitor that records hits and suggests redirects. Verification tags for Google Search Console and Bing Webmaster; Search Console API connection through the merchant's own Google OAuth.

## SEO audit and score (Phase 7)

A background crawl of the store's own pages reports: missing/duplicate/too long titles and descriptions, images without alt, duplicate content (same canonical cluster), broken internal links, slow pages (from field data), products without descriptions, structured data errors, missing hreflang pairs.

The **SEO score** is a weighted checklist result. The UI states plainly that it is an internal health indicator, not a Google ranking or a promise of traffic.

## Google Ads and marketing tracking (Phase 7)

- One server-side event model (`view_item`, `add_to_cart`, `begin_checkout`, `purchase`) fanned out to GA4, Google Ads, Meta (Pixel + Conversions API), TikTok and Snapchat.
- **Deduplication**: every event has an `event_id`; `purchase` uses the order id as transaction id, is emitted once from the server when payment is confirmed, and the browser tag reuses the same id.
- **Consent**: Consent Mode v2 signals; no marketing tags or enhanced-conversion data before consent; hashed (SHA-256) user data only with consent.
- **Attribution**: UTM and click ids (gclid, fbclid, ttclid) captured at landing, stored on the cart and order, used for ROAS reporting.
- **Accounts**: each merchant connects their own Google account with OAuth; tokens are encrypted per store. There are no shared platform credentials for merchant data.
- **Merchant Center**: product feed (id, title, description, link, image, price, sale price, availability, brand, GTIN/MPN, variants as item groups) generated per store, validated before submission, diagnostics pulled back into the dashboard.

## What is needed from you (Phase 7)

A Google Cloud project with a verified OAuth consent screen, a Google Ads API developer token (requires Google's approval), and Merchant API access. Review by Google can take weeks, so it is worth starting during Phase 4.
