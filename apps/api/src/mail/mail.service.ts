import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { formatMoney } from '@mtjari/shared';
import { ENV, type Env } from '../config/env';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Transport abstraction so the provider (SMTP, SES, Resend...) can be swapped. */
export interface MailTransport {
  send(mail: OutgoingMail & { from: string }): Promise<void>;
}
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export class SmtpTransport implements MailTransport {
  private readonly transporter: Transporter;
  constructor(url: string) {
    this.transporter = createTransport(url);
  }
  async send(mail: OutgoingMail & { from: string }): Promise<void> {
    await this.transporter.sendMail(mail);
  }
}

/** Development only: logs recipient + subject (never the body, which holds tokens). */
export class LogTransport implements MailTransport {
  private readonly logger = new Logger('Mail');
  async send(mail: OutgoingMail & { from: string }): Promise<void> {
    this.logger.warn(`MAIL_TRANSPORT=log: not delivering "${mail.subject}" to ${mail.to}`);
  }
}

type Locale = 'ar' | 'en';

export interface OrderMailSummary {
  storeName: string; number: number; currency: string; customerName: string;
  items: { nameAr: string | null; nameEn: string | null; quantity: number; lineTotal: number }[];
  subtotal: number; deliveryFee: number; total: number; paymentName: { ar: string; en: string };
}

function layout(locale: Locale, title: string, body: string, cta?: { href: string; label: string }): string {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const button = cta
    ? `<p style="margin:28px 0"><a href="${cta.href}" style="background:#2563EB;color:#fff;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:600">${cta.label}</a></p>`
    : '';
  return `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;background:#F8FAFC;font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;padding:32px;box-shadow:0 10px 30px rgba(15,23,42,.06)">
<h1 style="font-size:20px;margin:0 0 16px">${title}</h1><div style="font-size:15px;line-height:1.8">${body}</div>${button}
<p style="font-size:12px;color:#64748b;margin-top:32px">Mtjari.cc</p></div></body></html>`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

@Injectable()
export class MailService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  private send(mail: OutgoingMail) {
    return this.transport.send({ ...mail, from: this.env.MAIL_FROM });
  }

  sendVerifyEmail(to: string, name: string, locale: Locale, token: string) {
    const href = `${this.env.WEB_URL}/${locale}/verify-email?token=${encodeURIComponent(token)}`;
    const t = locale === 'ar'
      ? { s: 'تأكيد بريدك الإلكتروني في متجري', h: `مرحباً ${esc(name)}`, b: 'اضغط الزر لتأكيد بريدك الإلكتروني. الرابط صالح لمدة 24 ساعة.', c: 'تأكيد البريد' }
      : { s: 'Confirm your email for Mtjari', h: `Hi ${esc(name)}`, b: 'Click the button to confirm your email. The link is valid for 24 hours.', c: 'Confirm email' };
    return this.send({ to, subject: t.s, text: `${t.b}\n${href}`, html: layout(locale, t.h, t.b, { href, label: t.c }) });
  }

  sendAccountExists(to: string, locale: Locale) {
    const href = `${this.env.WEB_URL}/${locale}/login`;
    const t = locale === 'ar'
      ? { s: 'محاولة تسجيل ببريدك في متجري', b: 'حاول أحدهم إنشاء حساب بهذا البريد، لكن لديك حساب بالفعل. إذا كنت أنت، سجّل الدخول. وإلا تجاهل هذه الرسالة.', c: 'تسجيل الدخول' }
      : { s: 'Sign-up attempt with your email', b: 'Someone tried to create an account with this email, but you already have one. If this was you, just sign in. Otherwise ignore this email.', c: 'Sign in' };
    return this.send({ to, subject: t.s, text: `${t.b}\n${href}`, html: layout(locale, t.s, t.b, { href, label: t.c }) });
  }

  sendPasswordReset(to: string, locale: Locale, token: string) {
    const href = `${this.env.WEB_URL}/${locale}/reset-password?token=${encodeURIComponent(token)}`;
    const t = locale === 'ar'
      ? { s: 'إعادة تعيين كلمة المرور', b: 'اضغط الزر لاختيار كلمة مرور جديدة. الرابط صالح لمدة ساعة واحدة. إذا لم تطلب ذلك فتجاهل الرسالة.', c: 'إعادة التعيين' }
      : { s: 'Reset your password', b: 'Click the button to choose a new password. The link is valid for one hour. If you did not request this, ignore this email.', c: 'Reset password' };
    return this.send({ to, subject: t.s, text: `${t.b}\n${href}`, html: layout(locale, t.s, t.b, { href, label: t.c }) });
  }

  sendInvitation(to: string, locale: Locale, storeName: string, token: string) {
    const href = `${this.env.WEB_URL}/${locale}/invitations/accept?token=${encodeURIComponent(token)}`;
    const t = locale === 'ar'
      ? { s: `دعوة للانضمام إلى ${storeName}`, b: `تمت دعوتك للانضمام إلى فريق متجر <b>${esc(storeName)}</b> على متجري. الدعوة صالحة لمدة 7 أيام.`, c: 'قبول الدعوة' }
      : { s: `Invitation to join ${storeName}`, b: `You have been invited to join the <b>${esc(storeName)}</b> team on Mtjari. The invitation is valid for 7 days.`, c: 'Accept invitation' };
    return this.send({ to, subject: t.s, text: `${t.b.replace(/<[^>]+>/g, '')}\n${href}`, html: layout(locale, t.s, t.b, { href, label: t.c }) });
  }

  private orderLines(locale: Locale, o: OrderMailSummary): { text: string; html: string } {
    const money = (n: number) => formatMoney(n, o.currency, locale);
    const name = (i: OrderMailSummary['items'][number]) => (locale === 'ar' ? i.nameAr ?? i.nameEn : i.nameEn ?? i.nameAr) ?? '';
    const L = locale === 'ar'
      ? { sub: 'المجموع الفرعي', del: 'التوصيل', total: 'الإجمالي', pay: 'طريقة الدفع' }
      : { sub: 'Subtotal', del: 'Delivery', total: 'Total', pay: 'Payment' };
    const rows: [string, string][] = [
      ...o.items.map((i): [string, string] => [`${name(i)} × ${i.quantity}`, money(i.lineTotal)]),
      [L.sub, money(o.subtotal)], [L.del, money(o.deliveryFee)], [L.total, money(o.total)], [L.pay, o.paymentName[locale]],
    ];
    return {
      text: rows.map(([a, b]) => `${a}: ${b}`).join('\n'),
      html: `<table style="width:100%;border-collapse:collapse;margin-top:12px">${rows.map(([a, b]) => `<tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0">${esc(a)}</td><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;text-align:end;white-space:nowrap">${esc(b)}</td></tr>`).join('')}</table>`,
    };
  }

  sendOrderConfirmation(to: string, locale: Locale, o: OrderMailSummary, orderUrl: string) {
    const lines = this.orderLines(locale, o);
    const t = locale === 'ar'
      ? { s: `تم استلام طلبك رقم ${o.number} من ${o.storeName}`, h: `شكراً ${esc(o.customerName)}`, b: `استلمنا طلبك رقم <b>${o.number}</b> من ${esc(o.storeName)}.`, c: 'عرض الطلب' }
      : { s: `Order ${o.number} received by ${o.storeName}`, h: `Thank you, ${esc(o.customerName)}`, b: `We received your order <b>${o.number}</b> from ${esc(o.storeName)}.`, c: 'View order' };
    return this.send({ to, subject: t.s, text: `${t.b.replace(/<[^>]+>/g, '')}\n${lines.text}\n${orderUrl}`, html: layout(locale, t.h, t.b + lines.html, { href: orderUrl, label: t.c }) });
  }

  sendNewOrderNotice(to: string, locale: Locale, o: OrderMailSummary, dashboardUrl: string) {
    const lines = this.orderLines(locale, o);
    const t = locale === 'ar'
      ? { s: `طلب جديد رقم ${o.number} في ${o.storeName}`, b: `طلب جديد رقم <b>${o.number}</b> من ${esc(o.customerName)}.`, c: 'فتح الطلب' }
      : { s: `New order ${o.number} at ${o.storeName}`, b: `New order <b>${o.number}</b> from ${esc(o.customerName)}.`, c: 'Open order' };
    return this.send({ to, subject: t.s, text: `${t.b.replace(/<[^>]+>/g, '')}\n${lines.text}\n${dashboardUrl}`, html: layout(locale, t.s, t.b + lines.html, { href: dashboardUrl, label: t.c }) });
  }
}
