'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/action-form';
import { api, clearSession, setSession } from '@/lib/api';
import { errorText, isLocale, t, type Locale } from '@/lib/i18n';
import type { TokenPair } from '@/lib/session';

const str = (f: FormData, k: string) => (f.get(k) ?? '').toString();
const loc = (f: FormData): Locale => {
  const l = str(f, 'locale');
  return isLocale(l) ? l : 'ar';
};
const fail = (l: Locale, code?: string): ActionState => ({ error: errorText(l, code) });
const UUID = /^[0-9a-f-]{36}$/i;
const sid = (f: FormData) => {
  const id = str(f, 'storeId');
  if (!UUID.test(id)) throw new Error('bad store id');
  return id;
};

export async function loginAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const mfaCode = str(f, 'mfaCode').trim();
  const res = await api<{ tokens: TokenPair }>('/v1/auth/login', {
    method: 'POST', auth: false,
    body: { email: str(f, 'email'), password: str(f, 'password'), ...(mfaCode ? { mfaCode } : {}) },
  });
  if (!res.ok) return { ...fail(l, res.code), needsMfa: res.code === 'mfa_required' || res.code === 'invalid_mfa_code' };
  await setSession(res.data.tokens);
  const next = str(f, 'next');
  redirect(next.startsWith(`/${l}/`) ? next : `/${l}/dashboard`);
}

export async function registerAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const res = await api('/v1/auth/register', {
    method: 'POST', auth: false,
    body: { email: str(f, 'email'), password: str(f, 'password'), name: str(f, 'name'), locale: l },
  });
  return res.ok ? { ok: t(l, 'auth.register.sent') } : fail(l, res.code);
}

export async function forgotAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const res = await api('/v1/auth/forgot-password', { method: 'POST', auth: false, body: { email: str(f, 'email') } });
  return res.ok ? { ok: t(l, 'auth.forgot.sent') } : fail(l, res.code);
}

export async function resetAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const res = await api('/v1/auth/reset-password', { method: 'POST', auth: false, body: { token: str(f, 'token'), password: str(f, 'password') } });
  return res.ok ? { ok: t(l, 'auth.reset.done') } : fail(l, res.code);
}

export async function resendVerificationAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const res = await api('/v1/auth/resend-verification', { method: 'POST', auth: false, body: { email: str(f, 'email') } });
  return res.ok ? { ok: t(l, 'auth.verify.resent') } : fail(l, res.code);
}

export async function logoutAction(f: FormData): Promise<void> {
  const l = loc(f);
  await api('/v1/auth/logout', { method: 'POST' });
  await clearSession();
  redirect(`/${l}`);
}

export async function logoutAllAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  await api('/v1/auth/logout-all', { method: 'POST' });
  await clearSession();
  redirect(`/${l}/login`);
}

export async function checkSlugAction(slug: string): Promise<{ slug: string; available: boolean; reason?: string } | null> {
  const res = await api<{ slug: string; available: boolean; reason?: string }>(`/v1/stores/slug-availability?slug=${encodeURIComponent(slug)}`);
  return res.ok ? res.data : null;
}

export async function createStoreAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const res = await api<{ id: string }>('/v1/stores', {
    method: 'POST',
    body: {
      name: str(f, 'name'), slug: str(f, 'slug'), businessType: str(f, 'businessType'),
      country: str(f, 'country'), currency: str(f, 'currency'), defaultLocale: str(f, 'defaultLocale'),
    },
  });
  if (!res.ok) return fail(l, res.code);
  redirect(`/${l}/dashboard/${res.data.id}`);
}

export async function updateStoreAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const id = sid(f);
  const res = await api(`/v1/stores/${id}`, {
    method: 'PATCH',
    body: {
      name: str(f, 'name'), businessType: str(f, 'businessType'), country: str(f, 'country'),
      currency: str(f, 'currency'), defaultLocale: str(f, 'defaultLocale'),
    },
  });
  if (!res.ok) return fail(l, res.code);
  revalidatePath(`/${l}/dashboard/${id}`, 'layout');
  return { ok: t(l, 'store.saved') };
}

export async function inviteAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const id = sid(f);
  const res = await api(`/v1/stores/${id}/invitations`, { method: 'POST', body: { email: str(f, 'email'), roleId: str(f, 'roleId') } });
  if (!res.ok) return fail(l, res.code);
  revalidatePath(`/${l}/dashboard/${id}/team`);
  return { ok: t(l, 'team.invited') };
}

async function simple(f: FormData, method: string, path: string, body: unknown, page: string): Promise<ActionState> {
  const l = loc(f);
  const res = await api(path, { method, body });
  if (!res.ok) return fail(l, res.code);
  revalidatePath(`/${l}/dashboard/${sid(f)}/${page}`);
  return {};
}

export async function revokeInvitationAction(_: ActionState, f: FormData): Promise<ActionState> {
  return simple(f, 'DELETE', `/v1/stores/${sid(f)}/invitations/${encodeURIComponent(str(f, 'id'))}`, undefined, 'team');
}

export async function changeRoleAction(_: ActionState, f: FormData): Promise<ActionState> {
  return simple(f, 'PATCH', `/v1/stores/${sid(f)}/members/${encodeURIComponent(str(f, 'id'))}`, { roleId: str(f, 'roleId') }, 'team');
}

export async function removeMemberAction(_: ActionState, f: FormData): Promise<ActionState> {
  return simple(f, 'DELETE', `/v1/stores/${sid(f)}/members/${encodeURIComponent(str(f, 'id'))}`, undefined, 'team');
}

export async function createRoleAction(_: ActionState, f: FormData): Promise<ActionState> {
  return simple(f, 'POST', `/v1/stores/${sid(f)}/roles`, { name: str(f, 'name'), permissions: f.getAll('permissions').map(String) }, 'roles');
}

export async function deleteRoleAction(_: ActionState, f: FormData): Promise<ActionState> {
  return simple(f, 'DELETE', `/v1/stores/${sid(f)}/roles/${encodeURIComponent(str(f, 'id'))}`, undefined, 'roles');
}

export async function mfaSetupAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const res = await api<{ secret: string; otpauthUrl: string }>('/v1/auth/mfa/setup', { method: 'POST' });
  return res.ok ? { data: { secret: res.data.secret } } : fail(l, res.code);
}

export async function mfaEnableAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const res = await api<{ recoveryCodes: string[] }>('/v1/auth/mfa/enable', { method: 'POST', body: { code: str(f, 'code').trim() } });
  if (!res.ok) return fail(l, res.code);
  return { data: { recoveryCodes: res.data.recoveryCodes } };
}

export async function mfaDisableAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const res = await api('/v1/auth/mfa/disable', { method: 'POST', body: { code: str(f, 'code').trim(), password: str(f, 'password') } });
  if (!res.ok) return fail(l, res.code);
  revalidatePath(`/${l}/dashboard/security`);
  return {};
}

export async function verifyEmailAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const res = await api('/v1/auth/verify-email', { method: 'POST', auth: false, body: { token: str(f, 'token') } });
  return res.ok ? { ok: t(l, 'auth.verify.ok') } : { error: t(l, 'auth.verify.bad') };
}

export async function acceptInvitationAction(_: ActionState, f: FormData): Promise<ActionState> {
  const l = loc(f);
  const res = await api<{ storeId: string }>('/v1/invitations/accept', { method: 'POST', body: { token: str(f, 'token') } });
  if (res.status === 401) return { error: t(l, 'invite.accept.login') };
  if (!res.ok) return fail(l, res.code);
  redirect(`/${l}/dashboard/${res.data.storeId}`);
}
