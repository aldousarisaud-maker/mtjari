/** Badge colours for order and payment states (meaning is always also written as text). */
export const statusTone = (s: string) =>
  ({
    PENDING: 'bg-amber-100 text-amber-800', CONFIRMED: 'bg-blue-100 text-blue-800', PROCESSING: 'bg-indigo-100 text-indigo-800',
    SHIPPED: 'bg-cyan-100 text-cyan-800', DELIVERED: 'bg-emerald-100 text-emerald-800', CANCELLED: 'bg-slate-200 text-slate-700',
  })[s] ?? '';
export const payTone = (s: string) => ({ UNPAID: 'bg-slate-200 text-slate-700', PAID: 'bg-emerald-100 text-emerald-800', REFUNDED: 'bg-amber-100 text-amber-800' })[s] ?? '';
