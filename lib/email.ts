import { Resend } from "resend";
import type { Read } from "@/types";

/**
 * Transactional email via Resend. Sends a clean, text-friendly copy of the
 * read — never the pasted conversation.
 *
 * RESEND_API_KEY is server-side only. The sender must be a verified-domain
 * address; until the domain is verified, we fall back to Resend's onboarding
 * sandbox sender.
 *
 * TODO(launch): set RESEND_FROM to a verified-domain address (e.g.
 * reads@yourdomain) before going live — the sandbox sender only delivers to
 * the Resend account owner.
 */
const SANDBOX_FROM = "Companion <onboarding@resend.dev>";

export class EmailError extends Error {}

export async function sendReadEmail(params: {
  to: string;
  nickname: string;
  read: Read;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new EmailError("Missing RESEND_API_KEY");

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM || SANDBOX_FROM;

  const { error } = await resend.emails.send({
    from,
    to: params.to,
    subject: `Your read on ${params.nickname}`,
    html: renderHtml(params.nickname, params.read),
    text: renderText(params.nickname, params.read),
  });

  if (error) throw new EmailError(error.message || "Resend send failed");
}

function deleteUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/delete`;
}

/** Plain, on-brand HTML. Read only — no conversation. */
function renderHtml(nickname: string, read: Read): string {
  if (read.safety.flag) {
    return wrap(`
      <h1 style="${H1}">Let's slow down for a moment.</h1>
      <p style="${P}">${esc(
        read.safety.note ||
          "Some of what you shared worries me for your safety. Please reach out to people you trust, or your local support services. You don't have to handle this alone.",
      )}</p>
    `);
  }

  const bars = read.bars
    .map(
      (b) => `
      <tr>
        <td style="padding:6px 0;font-size:14px;color:#3a2f2c;">
          <b>${esc(b.label)}</b> &middot; ${esc(b.tag)}
          <div style="color:#7a6b66;font-size:13px;">${esc(b.caption)}</div>
        </td>
        <td style="padding:6px 0;text-align:right;font-size:14px;color:#7a6b66;white-space:nowrap;">
          ${b.level}/100
        </td>
      </tr>`,
    )
    .join("");

  const cards = read.cards
    .map(
      (c) => `
      <div style="margin:14px 0;">
        <div style="${KICKER}">${esc(c.kind)}</div>
        <div style="font-weight:600;color:#3a2f2c;margin:2px 0;">${esc(c.title)}</div>
        <div style="${P}">${esc(c.body)}</div>
      </div>`,
    )
    .join("");

  return wrap(`
    <div style="${KICKER}">What I'm noticing on ${esc(nickname)}</div>
    <h1 style="${H1}">${esc(read.headline)}</h1>
    <div style="display:inline-block;background:#f1e6e2;color:#9c4a3f;border-radius:999px;padding:4px 12px;font-size:12px;margin-bottom:8px;">${esc(read.status_tag)}</div>
    <table style="width:100%;border-collapse:collapse;margin:10px 0;">${bars}</table>
    ${cards}
    ${
      read.suggested_move
        ? `<div style="margin:14px 0;"><div style="${KICKER}">Suggested move</div><div style="${P}">${esc(read.suggested_move)}</div></div>`
        : ""
    }
    ${
      read.where_this_leaves_you
        ? `<div style="margin:14px 0;"><div style="${KICKER}">Where this leaves you</div><div style="${P}">${esc(read.where_this_leaves_you)}</div></div>`
        : ""
    }
  `);
}

function renderText(nickname: string, read: Read): string {
  if (read.safety.flag) {
    return `Let's slow down for a moment.\n\n${
      read.safety.note ||
      "Some of what you shared worries me for your safety. Please reach out to people you trust, or your local support services."
    }\n\n${footerText()}`;
  }
  const lines = [
    `What I'm noticing on ${nickname}`,
    read.headline,
    read.status_tag,
    "",
    ...read.bars.map((b) => `- ${b.label} (${b.tag}) — ${b.level}/100. ${b.caption}`),
    "",
    ...read.cards.map((c) => `${c.kind}: ${c.title}\n${c.body}`),
  ];
  if (read.suggested_move) lines.push("", `Suggested move: ${read.suggested_move}`);
  if (read.where_this_leaves_you)
    lines.push("", `Where this leaves you: ${read.where_this_leaves_you}`);
  lines.push("", footerText());
  return lines.join("\n");
}

const H1 = "font-size:20px;color:#3a2f2c;margin:4px 0 12px;line-height:1.3;";
const P = "font-size:14px;color:#5a4a45;line-height:1.6;margin:4px 0;";
const KICKER =
  "font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#b08a82;";

function wrap(inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6eee9;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#fffaf7;border-radius:16px;padding:28px;">
      ${inner}
      <hr style="border:none;border-top:1px solid #efe2dc;margin:22px 0 14px;">
      <p style="font-size:12px;color:#9b8a84;line-height:1.6;">
        We saved your email and this read so you can come back to it — we never store
        the conversation you pasted. Want it gone? Delete your data anytime:
        <a href="${deleteUrl()}" style="color:#9c4a3f;">${deleteUrl()}</a>
      </p>
    </div>
  </body></html>`;
}

function footerText(): string {
  return `We saved your email and this read (never the conversation you pasted). Delete your data anytime: ${deleteUrl()}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
