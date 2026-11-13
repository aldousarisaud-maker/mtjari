import type { ThemeId } from '@mtjari/shared';
import type { Theme } from '../theme';
import { coffeeHouse } from './coffee-house';
import { gulfPremium } from './gulf-premium';
import { luxuryFashion } from './luxury-fashion';
import { modernElectronics } from './modern-electronics';
import { perfumeBoutique } from './perfume-boutique';

/** Every theme id known to the API must have its components here (checked by the type). */
export const themes: Record<ThemeId, Theme> = {
  'modern-electronics': modernElectronics,
  'luxury-fashion': luxuryFashion,
  'perfume-boutique': perfumeBoutique,
  'coffee-house': coffeeHouse,
  'gulf-premium': gulfPremium,
};
