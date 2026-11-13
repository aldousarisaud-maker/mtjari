import type { ThemeId, ThemeSettings } from '@mtjari/shared';

export type Locale = 'ar' | 'en';

export interface ShopCategory { id: string; parentId: string | null; slug: string; nameAr: string | null; nameEn: string | null; productCount: number }

export interface Shop {
  id: string; name: string; slug: string; currency: string; country: string; defaultLocale: string; host: string;
  preview: boolean;
  theme: { id: ThemeId; settings: ThemeSettings };
  categories: ShopCategory[];
}

export interface ShopImage { id: string; width: number; height: number; altAr: string | null; altEn: string | null; urls: Record<string, string> }

export interface ProductCard {
  id: string; slug: string; nameAr: string | null; nameEn: string | null; type: 'SIMPLE' | 'VARIANT' | 'DIGITAL'; brand: string | null;
  images: ShopImage[]; priceMin: number; priceMax: number; compareAtPrice: number | null; inStock: boolean; variantCount: number;
}

export interface ShopVariant {
  id: string; sku: string | null; optionValues: Record<string, string>; price: number; compareAtPrice: number | null; available: boolean; maxQuantity: number;
}

export interface ProductDetail {
  id: string; slug: string; type: 'SIMPLE' | 'VARIANT' | 'DIGITAL'; nameAr: string | null; nameEn: string | null;
  descriptionAr: string | null; descriptionEn: string | null; tags: string[]; seoTitle: string | null; seoDescription: string | null; updatedAt: string;
  brand: string | null; options: { name: string; values: string[] }[]; variants: ShopVariant[]; images: ShopImage[];
  categories: { id: string; slug: string; nameAr: string | null; nameEn: string | null }[]; related: ProductCard[];
}

export interface ProductList { total: number; page: number; limit: number; items: ProductCard[] }

export interface CartLine {
  id: string; variantId: string; slug: string; nameAr: string | null; nameEn: string | null; optionValues: Record<string, string>;
  image: string | null; unitPrice: number; quantity: number; lineTotal: number; maxQuantity: number; issue: 'unavailable' | 'insufficient_stock' | null;
}
export interface Cart { currency: string; items: CartLine[]; itemCount: number; subtotal: number; checkoutAvailable: boolean }

export interface CheckoutZone { id: string; nameAr: string; nameEn: string; fee: number; freeAbove: number | null }
export interface CheckoutInfo {
  cart: Cart; zones: CheckoutZone[]; pickup: { enabled: boolean; instructionsAr: string | null; instructionsEn: string | null };
  minOrderAmount: number; country: string; paymentMethods: { provider: string; kind: 'offline' | 'online'; name: { ar: string; en: string } }[];
  available: boolean; unavailableReason: 'store_not_live' | 'no_payment_method' | 'no_delivery_option' | null;
}
export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
export interface ShopOrder {
  number: number; status: OrderStatus; paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED'; fulfillment: 'DELIVERY' | 'PICKUP'; currency: string;
  subtotal: number; deliveryFee: number; total: number; customerName: string; customerPhone: string; customerNote: string | null; placedAt: string;
  address: null | { area: string; block: string; street: string; avenue: string; building: string; floor: string; apartment: string; directions: string; zoneNameAr: string; zoneNameEn: string };
  paymentName: { ar: string; en: string }; pickupInstructionsAr: string | null; pickupInstructionsEn: string | null;
  items: { nameAr: string | null; nameEn: string | null; optionValues: Record<string, string>; unitPrice: number; quantity: number; lineTotal: number }[];
}
