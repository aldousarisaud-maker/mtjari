import 'server-only';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { api } from '@/lib/api';

export interface StoreDetail {
  id: string; name: string; slug: string; status: string; businessType: string; country: string; currency: string; defaultLocale: string;
  domains: { id: string; hostname: string; type: string; status: string; isPrimary: boolean }[];
  access: { roleId: string; roleKey: string | null; permissions: string[] };
}

export const getStore = cache(async (storeId: string): Promise<StoreDetail> => {
  const res = await api<StoreDetail>(`/v1/stores/${encodeURIComponent(storeId)}`);
  if (!res.ok) notFound();
  return res.data;
});

export const can = (store: StoreDetail, permission: string) => store.access.permissions.includes(permission);
