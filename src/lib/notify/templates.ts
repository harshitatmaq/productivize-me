import { appUrl } from "@/lib/env";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type EmailSection = {
  heading: string;
  items?: { text: string; meta?: string; href?: string }[];
  paragraph?: string;
  empty?: string;
};

/** Minimal, dark, inline-styled email that renders well in Gmail/Outlook/Apple Mail. */
export function renderEmail(params: {
  preheader: string;
  title: string;
  subtitle?: string;
  sections: EmailSection[];
  cta?: { label: string; href: string };
  footer?: string;
}): string {
  const base = appUrl();
  const href = (h?: string) => (h ? (h.startsWith("http") ? h : `${base}${h}`) : undefined);
  const sections = params.sections
    .map((s) => {
      const items = s.items?.length
        ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${s.items
            .map(
              (it) => `<tr><td style="padding:8px 0;border-bottom:1px solid #1f2023;font-size:14px;color:#e6e6e6;">
                ${it.href ? `<a href="${esc(href(it.href)!)}" style="color:#e6e6e6;text-decoration:none;">${esc(it.text)}</a>` : esc(it.text)}
                ${it.meta ? `<div style="font-size:12px;color:#8a8f98;margin-top:2px;">${esc(it.meta)}</div>` : ""}
              </td></tr>`,
            )
            .join("")}</table>`
        : s.empty
          ? `<p style="margin:0;font-size:14px;color:#8a8f98;">${esc(s.empty)}</p>`
          : "";
      const para = s.paragraph ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#d0d0d0;">${esc(s.paragraph)}</p>` : "";
      return `<tr><td style="padding:20px 24px 4px;">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a8f98;margin-bottom:8px;">${esc(s.heading)}</div>
        ${para}${items}
      </td></tr>`;
    })
    .join("");
  const cta = params.cta
    ? `<tr><td style="padding:24px;"><a href="${esc(href(params.cta.href)!)}" style="display:inline-block;background:#5e6ad2;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;">${esc(params.cta.label)}</a></td></tr>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#08090a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;">
  <span style="display:none;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${esc(params.preheader)}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#08090a;padding:24px 12px;"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#111214;border:1px solid #1f2023;border-radius:14px;">
      <tr><td style="padding:24px 24px 0;">
        <div style="font-size:13px;color:#8a8f98;">◐ Productivize</div>
        <h1 style="margin:12px 0 4px;font-size:22px;line-height:1.3;color:#f7f8f8;font-weight:600;">${esc(params.title)}</h1>
        ${params.subtitle ? `<div style="font-size:14px;color:#8a8f98;">${esc(params.subtitle)}</div>` : ""}
      </td></tr>
      ${sections}
      ${cta}
    </table>
    <div style="font-size:12px;color:#5a5f68;margin-top:16px;">${esc(params.footer ?? "You get this because email digests are on in Settings → Notifications.")}</div>
  </td></tr></table></body></html>`;
}
