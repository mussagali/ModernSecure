import { createClient } from "../lib/supabase/server";
import { ReferenceIcon as Icon } from "./ReferenceIcon";
export async function PortalContacts() {
  const supabase = await createClient();
  const { data: contact, error } = await supabase.from("contact_settings").select("phone,email,business_hours,response_expectation").eq("id", true).maybeSingle();
  const phone = contact?.phone?.trim();
  const normalized = phone?.replace(/[^\d+]/g, "");
  const phoneHref = normalized && /^\+?\d{6,20}$/.test(normalized) ? `tel:${normalized}` : null;
  const email = contact?.email?.trim();
  const emailHref = email && /^[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/.test(email) ? `mailto:${email}` : null;
  return <section className="sovz-panel sovz-page-panel"><div className="sovz-card-heading"><span className="sovz-icon"><Icon name="Phone" /></span><h1>Контакты</h1></div>{error ? <p className="sovz-feedback is-error">Не удалось загрузить контакты.</p> : <div className="sovz-contact-rows"><><div className="sovz-contact-row"><span>Ваш юрист</span><div>Доступен в разделе «Моё дело»</div></div><div className="sovz-contact-row"><span>Телефон юриста</span><div>Уточните в чате с юристом</div></div></><div className="sovz-contact-row"><span>Телефон компании</span><div>{phoneHref ? <a href={phoneHref}>{phone}</a> : phone || "Не указан"}</div></div>{email && <div className="sovz-contact-row"><span>Электронная почта</span><div>{emailHref ? <a href={emailHref}>{email}</a> : email}</div></div>}{contact?.business_hours && <div className="sovz-contact-row"><span>Время работы</span><div>{contact.business_hours}</div></div>}</div>}</section>;
}
export async function PortalFaq() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("faq_entries").select("id,question,answer").eq("published", true).order("position");
  return <section className="sovz-panel sovz-page-panel"><h1>Ответы на вопросы</h1>{error ? <p className="sovz-feedback is-error">Не удалось загрузить вопросы.</p> : data?.length ? data.map(item => <details key={item.id} className="help-question"><summary>{item.question}</summary><p>{item.answer}</p></details>) : <p className="sovz-muted">Ответы на вопросы пока не опубликованы.</p>}</section>;
}
