import { Amiri, El_Messiri, IBM_Plex_Sans_Arabic, Noto_Kufi_Arabic, Readex_Pro, Tajawal } from 'next/font/google';

// One typeface per theme. Not preloaded: the browser downloads only the one the active theme uses.
const tajawal = Tajawal({ subsets: ['arabic', 'latin'], weight: ['400', '500', '700', '800'], variable: '--font-tajawal', display: 'swap', preload: false });
const amiri = Amiri({ subsets: ['arabic', 'latin'], weight: ['400', '700'], variable: '--font-amiri', display: 'swap', preload: false });
const messiri = El_Messiri({ subsets: ['arabic', 'latin'], variable: '--font-messiri', display: 'swap', preload: false });
const readex = Readex_Pro({ subsets: ['arabic', 'latin'], variable: '--font-readex', display: 'swap', preload: false });
const kufi = Noto_Kufi_Arabic({ subsets: ['arabic', 'latin'], variable: '--font-kufi', display: 'swap', preload: false });

const plex = IBM_Plex_Sans_Arabic({ subsets: ['arabic', 'latin'], weight: ['400', '500', '600'], variable: '--font-plex-arabic', display: 'swap', preload: false });

export const storefrontFontVars = [tajawal, amiri, messiri, readex, kufi, plex].map((f) => f.variable).join(' ');
