import type { ReactNode } from 'react';
import type { ThemeId } from '@mtjari/shared';
import type { SfKey } from './i18n';
import type { Locale, ProductCard, ProductDetail, Shop, ShopCategory } from './types';

/** Everything a theme component needs about the current request. */
export interface Ctx {
  shop: Shop;
  locale: Locale;
  cartCount: number;
  t: (key: SfKey) => string;
  /** Link inside the shop, e.g. href('/cart') → /ar/cart. */
  href: (path?: string) => string;
  money: (minor: number) => string;
  name: (x: { nameAr: string | null; nameEn: string | null }) => string;
  /** Top-level categories for navigation. */
  nav: ShopCategory[];
}

/** Class names for the pages that share their structure across themes (listing, cart, not-found). */
export interface ThemeUi {
  container: string; h1: string; muted: string; grid: string; button: string; buttonGhost: string; input: string;
  panel: string; chip: string; chipActive: string; error: string; success: string;
}

/** Class names for the interactive buy box (variant picker, quantity, add to cart). */
export interface BuyClasses {
  price: string; compare: string; label: string; option: string; optionActive: string; optionDisabled: string;
  select: string; button: string; stock: string; error: string; success: string;
}

export interface Theme {
  id: ThemeId;
  /** Classes on the page root: background, text colour, font. */
  root: string;
  ui: ThemeUi;
  buy: BuyClasses;
  Layout: (p: { ctx: Ctx; children: ReactNode }) => ReactNode;
  /** Wrapper around all home sections (class names). */
  homeWrap: string;
  /** Home page blocks. The merchant orders them; each theme only draws them. */
  Hero: (p: { ctx: Ctx; /** A product with a picture, for themes that show one in the hero. */ star?: ProductCard }) => ReactNode;
  Categories: (p: { ctx: Ctx }) => ReactNode;
  Products: (p: { ctx: Ctx; products: ProductCard[]; heading: string; moreHref: string; id: string }) => ReactNode;
  Card: (p: { ctx: Ctx; product: ProductCard; priority?: boolean }) => ReactNode;
  Product: (p: { ctx: Ctx; product: ProductDetail; buyBox: ReactNode }) => ReactNode;
}
