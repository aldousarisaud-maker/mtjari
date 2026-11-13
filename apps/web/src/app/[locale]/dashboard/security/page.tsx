import { logoutAllAction } from '@/app/actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card } from '@/components/ui';
import { requireMe } from '@/lib/api';
import { isLocale, t } from '@/lib/i18n';
import { MfaPanel } from './mfa-panel';

export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const l = isLocale(locale) ? locale : 'ar';
  const me = await requireMe(l);
  return (
    <div className="rise mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">{t(l, 'side.security')}</h1>
      <Card>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t(l, 'sec.mfa')}</h2>
          <Badge className={me.user.mfaEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>{t(l, me.user.mfaEnabled ? 'sec.mfa.on' : 'sec.mfa.off')}</Badge>
        </div>
        <MfaPanel
          locale={l}
          enabled={me.user.mfaEnabled}
          labels={{ start: t(l, 'sec.mfa.start'), key: t(l, 'sec.mfa.key'), enable: t(l, 'sec.mfa.enable'), disable: t(l, 'sec.mfa.disable'), codes: t(l, 'sec.mfa.codes'), code: t(l, 'auth.mfa'), password: t(l, 'auth.password') }}
        />
      </Card>
      <Card>
        <ActionForm action={logoutAllAction}>
          <input type="hidden" name="locale" value={l} />
          <SubmitButton variant="danger">{t(l, 'sec.logoutAll')}</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
