import { AccountHeader } from "../../../components/AccountHeader";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";

export const metadata: Metadata = { title: "Помощь | Современная защита" };

function phoneHref(value: string | null): string | null {
  const phone = value?.trim();
  if (!phone || !/^\+?[\d\s().-]{6,30}$/.test(phone)) return null;
  const normalized = phone.replace(/[^\d+]/g, "");
  if (!/^\+?\d{6,20}$/.test(normalized)) return null;
  return `tel:${normalized}`;
}

function emailHref(value: string | null): string | null {
  const email = value?.trim();
  if (!email || !/^[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/.test(email)) return null;
  return `mailto:${email}`;
}

function whatsappHref(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!["wa.me", "api.whatsapp.com", "web.whatsapp.com"].includes(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export default async function ClientHelpPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const [faqResult, contactResult] = await Promise.all([
    supabase.from("faq_entries").select("id, question, answer").eq("published", true).order("position", { ascending: true }).order("id", { ascending: true }),
    supabase.from("contact_settings").select("phone, whatsapp_url, email, business_hours, response_expectation").eq("id", true).maybeSingle(),
  ]);
  const contact = contactResult.data;
  const phone = contact?.phone?.trim() || null;
  const email = contact?.email?.trim() || null;
  const phoneLink = phoneHref(phone);
  const emailLink = emailHref(email);
  const whatsapp = whatsappHref(contact?.whatsapp_url ?? null);
  const businessHours = contact?.business_hours?.trim();
  const responseExpectation = contact?.response_expectation?.trim();
  const hasContactDetails = Boolean(phone || email || whatsapp || businessHours || responseExpectation);

  return <main className="account-page">
    <AccountHeader />
    <div className="account-content account-detail client-settings">
      <Link href="/account" className="account-back">В личный кабинет</Link>

      <h1>Помощь</h1>

      <section className="account-detail-section" aria-labelledby="faq-heading">
        <div className="account-section-heading"><div><h2 id="faq-heading">Частые вопросы</h2></div></div>
        {faqResult.error ? <p className="account-muted" role="alert">Не удалось загрузить вопросы. Обновите страницу позже.</p>
          : faqResult.data?.length ? faqResult.data.map((entry) => <details className="help-question" key={entry.id}><summary>{entry.question}</summary><p>{entry.answer}</p></details>)
            : <p className="account-muted">Ответы на частые вопросы пока не опубликованы.</p>}
      </section>

      <section className="account-detail-section" aria-labelledby="contacts-heading">
        <div className="account-section-heading"><div><h2 id="contacts-heading">Контакты</h2></div></div>
        {contactResult.error ? <p className="account-muted" role="alert">Не удалось загрузить контакты. Обновите страницу позже.</p>
          : hasContactDetails ? <div className="account-card">
              {phone && <p>Телефон: {phoneLink ? <a href={phoneLink}>{phone}</a> : phone}</p>}
              {email && <p>Email: {emailLink ? <a href={emailLink}>{email}</a> : email}</p>}
              {whatsapp && <p><a href={whatsapp} target="_blank" rel="noopener noreferrer">Написать в WhatsApp</a></p>}
              {businessHours && <p>Время работы: {businessHours}</p>}
              {responseExpectation && <p>Срок ответа: {responseExpectation}</p>}
            </div>
            : <p className="account-muted">Доступных контактных данных пока нет.</p>}
      </section>
    </div>
  </main>;
}
