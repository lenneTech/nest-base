import { renderAdminLayout } from "./admin-layout.js";
import type { EmailPreviewCatalog, EmailPreviewResult } from "./email-preview.js";

/** `/dev/email-preview` HTML page — gallery of templates rendered with sample payloads. */
export function renderEmailPreviewPage(input: {
  catalog: EmailPreviewCatalog;
  rendered: Record<string, EmailPreviewResult>;
}): string {
  const cards = input.catalog.entries
    .map((entry) => {
      const result = input.rendered[entry.template] ?? { error: "not rendered" };
      return renderCard(entry.template, entry.description, entry.samplePayload, result);
    })
    .join("\n");

  const body = `
<style>
  .ep-card { background: var(--surface-1); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.5rem; margin-bottom: 1.5rem; }
  .ep-card__title { font-family: var(--font-mono); font-size: 1rem; color: var(--accent); margin: 0 0 .35rem; }
  .ep-card__desc { color: var(--fg-muted); font-size: .85rem; margin-bottom: 1rem; }
  .ep-grid { display: grid; gap: 1rem; grid-template-columns: 1fr 1fr; }
  @media (max-width: 900px) { .ep-grid { grid-template-columns: 1fr; } }
  .ep-pane { background: var(--surface-2); border: 1px solid var(--line); border-radius: 6px; padding: 1rem; }
  .ep-pane__title { font-size: .65rem; color: var(--fg-dim); text-transform: uppercase; letter-spacing: .14em; font-weight: 600; margin: 0 0 .5rem; }
  .ep-html { background: white; color: black; padding: 1rem; border-radius: 4px; font-size: .85rem; }
  .ep-text, .ep-payload { font-family: var(--font-mono); font-size: .8rem; color: var(--fg); white-space: pre-wrap; word-break: break-word; }
  .ep-subject { font-family: var(--font-mono); font-size: .9rem; color: var(--fg); margin-bottom: 1rem; padding: .5rem .75rem; background: var(--surface-2); border-radius: 4px; }
  .ep-error { color: var(--err); font-family: var(--font-mono); font-size: .85rem; padding: .75rem; background: rgba(248,113,113,.08); border: 1px solid rgba(248,113,113,.3); border-radius: 4px; }
</style>

${cards}
`;

  return renderAdminLayout({
    title: "Email Preview",
    subtitle: `${input.catalog.entries.length} template(s) registered. Sample payloads are rendered below — Mailpit at <code>localhost:8025</code> shows actually-sent emails.`,
    currentNav: "email-preview",
    body,
  });
}

function renderCard(
  template: string,
  description: string,
  payload: Record<string, string>,
  result: EmailPreviewResult,
): string {
  if (result.error) {
    return `<section class="ep-card">
  <h3 class="ep-card__title">${escapeHtml(template)}</h3>
  <p class="ep-card__desc">${escapeHtml(description)}</p>
  <div class="ep-error">⚠ ${escapeHtml(result.error)}</div>
</section>`;
  }
  return `<section class="ep-card">
  <h3 class="ep-card__title">${escapeHtml(template)}</h3>
  <p class="ep-card__desc">${escapeHtml(description)}</p>
  <div class="ep-subject"><strong>Subject:</strong> ${escapeHtml(result.subject ?? "")}</div>
  <div class="ep-grid">
    <div class="ep-pane">
      <div class="ep-pane__title">HTML</div>
      <iframe class="ep-html" sandbox="" srcdoc="${escapeHtml(result.html ?? "")}" style="width:100%;min-height:18rem;border:0;background:white;"></iframe>
    </div>
    <div class="ep-pane">
      <div class="ep-pane__title">Text</div>
      <div class="ep-text">${escapeHtml(result.text ?? "")}</div>
    </div>
  </div>
  <div class="ep-pane" style="margin-top:1rem;">
    <div class="ep-pane__title">Sample payload</div>
    <div class="ep-payload">${escapeHtml(JSON.stringify(payload, null, 2))}</div>
  </div>
</section>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
