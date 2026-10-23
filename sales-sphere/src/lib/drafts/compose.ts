// Builds the HTML body: paragraphs + sign-off + mailbox signature (HTML table, no images) + compliance footer.

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 12px 0">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Strips a sign-off Claude may have added despite instructions ("Best,\nAdyasha"). */
export function stripSignOff(body: string, personaName: string): string {
  const lines = body.trimEnd().split("\n");
  const signOff = /^(best|best regards|kind regards|regards|thanks|cheers|warm regards|many thanks)[,.]?\s*$/i;
  while (lines.length > 0) {
    const last = lines[lines.length - 1]!.trim();
    if (last === "" || last.toLowerCase() === personaName.toLowerCase() || signOff.test(last) || /^best,\s*\w+$/i.test(last)) {
      lines.pop();
    } else break;
  }
  return lines.join("\n");
}

/** Removes images from signatures: the spec says signatures are HTML tables, no images. */
export function sanitizeSignature(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<img\b[^>]*>/gi, "");
}

export function renderFooter(template: string, vars: { physicalAddress: string }): string {
  return template.replace(/\{\{physical_address\}\}/g, vars.physicalAddress);
}

export function footerIsComplete(template: string, vars: { physicalAddress: string }): boolean {
  return !template.includes("{{physical_address}}") || vars.physicalAddress.trim().length > 0;
}

export function composeEmailHtml(p: {
  body: string;
  signOff: string;
  personaName: string;
  signatureHtml: string;
  footer: string;
}): string {
  const body = paragraphs(stripSignOff(p.body, p.personaName));
  const sign = `<p style="margin:0 0 12px 0">${escapeHtml(p.signOff)}<br>${escapeHtml(p.personaName)}</p>`;
  const signature = p.signatureHtml ? `<div>${sanitizeSignature(p.signatureHtml)}</div>` : "";
  const footer = p.footer.trim()
    ? `<p style="margin:16px 0 0 0;font-size:11px;color:#777">${escapeHtml(p.footer.trim()).replace(/\n/g, "<br>")}</p>`
    : "";
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222">${body}${sign}${signature}${footer}</div>`;
}
