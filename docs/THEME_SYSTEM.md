# Mtjari.cc — Theme System

Status: **first five themes implemented and tested (Phase 3)**. The rest of this document is the target design; the section-based layout editor and the other 20 themes are Phase 6.

## Implemented in Phase 3

- Theme ids and the settings schema live in `packages/shared/src/themes.ts` (one Zod schema, shared by API and web).
- A theme is a module in `apps/web/src/storefront/themes/` exporting `{ id, root, ui, buy, Layout, Home, Card, Product }`. Listing, search and cart pages are shared views styled through the theme's `ui` classes.
- `store_themes` holds one row per (store, theme) with `draft` and `published` JSON. `stores.theme_id` is the live theme. Switching theme only changes that pointer.
- Settings today: primary and accent colour, announcement bar (ar/en), hero title and subtitle (ar/en), featured category, home product count. Text is plain text only; colours must be hex.
- Preview uses a signed token bound to store + theme, valid 30 minutes.
- Not yet: page layouts as sections, logo/typography editors, version history, custom CSS.

## Goals

- 25 genuinely different storefront designs, not one layout with 25 colour presets.
- Switching theme never touches products, orders, customers or content.
- Merchants customise without code; everything is RTL/LTR aware and mobile-first.
- Themes cannot break isolation, security or Core Web Vitals.

## Core idea: content is theme-independent, presentation is a theme package

```
Store data (products, collections, pages, menus)     ← never changes when switching theme
        │
Section schema (typed blocks: hero, product-grid, countdown, faq, ...)
        │
Theme package = { manifest, tokens, layouts, section renderers, product card, header, footer }
        │
Store theme instance = { themeId, version, settings JSON, page layouts JSON, draft | published }
```

- A **section** has a platform-wide type and a typed settings schema (Zod). Example: `product-grid { source: collectionId | 'best-sellers', columns, limit, cardStyle }`.
- A **theme** provides its own React server component for every section type it supports, plus theme-only sections. Two themes render the same `hero` data in completely different markup and style.
- **Switching theme**: page layouts are stored per theme instance. Sections with a platform-wide type are carried over; theme-only sections are kept in the old instance (so switching back restores them). Catalogue data is not involved at all.

## Theme package contract

```
packages/themes/<theme-id>/
  manifest.ts        id, name {ar,en}, category, version, supported sections, preview images
  tokens.ts          colour palette(s), type scale, radii, spacing, motion: exposed as CSS variables
  settings.schema.ts merchant-editable settings (colours, fonts, logo position, card style, ...)
  layout/            Header, Footer, MobileNav, AnnouncementBar
  sections/          one component per supported section type
  templates/         Home, Collection, Product, Cart, Checkout shell, Account, Page, Search, 404
  components/        ProductCard, Price, Badge, VariantPicker, Gallery
  demo/              demo catalogue and content used for previews
  theme.test.tsx     contract tests
```

Every theme must pass the shared contract suite: renders all required templates in `ar` (RTL) and `en` (LTR), at 360/768/1280 px, with no horizontal overflow, valid heading order, labelled controls, one `h1`, images with dimensions and alt text, product structured data present, and a JS/CSS budget.

## Rendering

- Next.js App Router, server components. The storefront route resolves the store by host, loads the published theme instance, and renders with the theme's components.
- Tokens are emitted as CSS variables in a `<style>` tag per store; Tailwind utilities reference the variables, so colour/typography changes need no rebuild.
- Caching: ISR with cache tags per store and per resource (`store:{id}:product:{id}`); publishing a theme or editing a product revalidates only the affected tags.
- Fonts: curated, self-hosted set (IBM Plex Sans Arabic, Tajawal, Cairo, Almarai, Noto Kufi Arabic + Latin pairs) with `font-display: swap` and subsetting.

## Draft, publish, versions

- `store_themes` holds `draft` and `published` JSON. The editor writes to draft; publish copies draft → published and appends a row to `theme_versions`.
- Preview uses a signed, short-lived token to render the draft on the real storefront route.
- Undo/redo is client-side history in the editor; version history is server-side and restorable.

## Visual builder (Phase 6)

Stage 1 (sections, drag and drop, undo/redo, device preview, version history) is implemented; the preview frame uses a `?pv=<signed token>` URL whose token travels in a request header (never a cookie) and is the only case where a shop page may be framed, and only by the dashboard (`frame-ancestors`). Typography, header/footer builders and custom CSS below are still target design.

Editor iframe renders the real storefront in draft mode and talks to the dashboard shell with `postMessage` (origin-checked). Features: drag and drop sections, device preview widths, colour and typography editors driven by the theme's settings schema, header/footer builders, custom pages, draft/publish, version history, undo/redo.

**Custom CSS** is parsed (PostCSS) and filtered by allow-list: scoped under the store root, no `@import`, no `url()` to other origins, no `position: fixed` overlays over checkout, size limit. It is never injected into checkout payment steps.

## The 25 themes

Each has a distinct layout system, header pattern and product card. Build order: five in Phase 3 (marked ★) to prove the contract across very different designs, the rest in Phase 6.

| # | Theme | Sector | Design direction |
|---|---|---|---|
| 1 ★ | Modern Electronics | Electronics | Spec-forward cards, comparison strip, mega menu |
| 2 | Gaming Zone | Gaming | Dark neon, angled panels, platform filters |
| 3 ★ | Luxury Fashion | Fashion | Editorial full-bleed imagery, serif headings, lookbook |
| 4 | Beauty Studio | Beauty | Soft pastels, routine builder, shade swatches |
| 5 ★ | Perfume Boutique | Perfume | Dark-gold, notes pyramid, size selector |
| 6 | Jewelry Premium | Jewelry | Macro photography, minimal chrome, zoom gallery |
| 7 ★ | Coffee House | Coffee | Warm earth tones, roast/grind pickers, subscription-ready |
| 8 | Restaurant Market | Food | Menu-style categories, quick add, delivery slot banner |
| 9 | Home Living | Furniture | Room scenes, dimension tables, large grids |
| 10 | Mobile Store | Phones | Model/storage/colour configurator, accessory bundles |
| 11 | Sports Active | Sports | Bold type, motion accents, size guides |
| 12 | Baby World | Kids | Rounded playful UI, age filters |
| 13 | Pet Supplies | Pets | Pet-type navigation, repeat-order prompts |
| 14 | Book Store | Books | Shelf layout, author pages, dense lists |
| 15 | Digital Products | Digital | Instant-delivery badges, licence info, no shipping UI |
| 16 | Auto Accessories | Automotive | Fitment (make/model/year) filter |
| 17 | Flower Boutique | Flowers & gifts | Occasion navigation, delivery date picker, gift message |
| 18 | Watches Luxury | Watches | Black/white contrast, spec sheets, slow reveal motion |
| 19 | Health & Wellness | Health | Clean clinical look, ingredient panels |
| 20 | Supermarket | Grocery | Aisle navigation, sticky cart, quantity steppers on cards |
| 21 | Fashion Minimal | Fashion | Monochrome grid, generous whitespace |
| 22 | Tech Pro | Computers | Dense spec tables, compare, build-your-own |
| 23 | Handmade Studio | Crafts | Textured backgrounds, maker story sections |
| 24 | Multi-Vendor Style | Department store | Department mega menu, many collection rails |
| 25 ★ | Gulf Premium | Gulf luxury | Arabic-first typography, geometric motifs, calm palette |

Preview images are real screenshots generated by Playwright from each theme's demo content, regenerated in CI. Ratings are shown only when real merchant ratings exist.

## Plan gating

`plan_features.themes` lists which themes a plan may publish. The check runs in the publish endpoint (API), not just in the gallery UI.
