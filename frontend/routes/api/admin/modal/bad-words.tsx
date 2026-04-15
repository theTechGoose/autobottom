/** Modal content: Bad Words — 3 tabs (Recipients/Words/Offices) matching production. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

interface BwConfig {
  enabled?: boolean;
  allOffices?: boolean;
  emails?: string[];
  words?: (string | { word: string })[];
  officePatterns?: string[];
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const tab = url.searchParams.get("tab") ?? "emails";

    let config: BwConfig = {};
    try { config = await apiFetch<BwConfig>("/admin/bad-word-config", ctx.req); } catch {}

    const emails = config.emails ?? [];
    const words = (config.words ?? []).map(w => typeof w === "string" ? w : w.word);
    const officePatterns = config.officePatterns ?? [];

    const html = renderToString(
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div>
            <div class="modal-title">Bad Word Detection</div>
            <div class="modal-sub" style="margin-bottom:0;">Alert on prohibited phrases in package transcripts</div>
          </div>
          <button class="sf-btn ghost" data-close-modal="bad-words-modal">Close</button>
        </div>

        {/* Enable toggle */}
        <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:16px;">
          <label style="font-size:11px;font-weight:600;color:var(--text-bright);flex:1;">Enable bad word detection for package audits</label>
          <input
            type="checkbox"
            id="bw-enabled"
            checked={!!config.enabled}
            style="width:16px;height:16px;cursor:pointer;"
            hx-post="/api/admin/modal/bad-words/toggle-enabled"
            hx-trigger="change"
            hx-swap="none"
          />
        </div>

        {/* Tabs */}
        <div class="tab-bar">
          <button class={`tab-btn ${tab === "emails" ? "active" : ""}`} hx-get="/api/admin/modal/bad-words?tab=emails" hx-target="#bad-words-modal-content" hx-swap="innerHTML">Recipients</button>
          <button class={`tab-btn ${tab === "words" ? "active" : ""}`} hx-get="/api/admin/modal/bad-words?tab=words" hx-target="#bad-words-modal-content" hx-swap="innerHTML">Words</button>
          <button class={`tab-btn ${tab === "offices" ? "active" : ""}`} hx-get="/api/admin/modal/bad-words?tab=offices" hx-target="#bad-words-modal-content" hx-swap="innerHTML">Offices</button>
        </div>

        {/* Tab panels */}
        {tab === "emails" && (
          <div>
            <div class="modal-sub" style="margin-bottom:10px;">Email addresses that receive alerts when bad words are detected.</div>
            <div style="display:flex;gap:6px;margin-bottom:10px;">
              <input id="bw-email-input" class="sf-input" type="email" name="email" placeholder="email@example.com" style="flex:1;" />
              <button class="sf-btn primary" hx-post="/api/admin/modal/bad-words/add-email" hx-include="#bw-email-input" hx-target="#bw-email-list" hx-swap="innerHTML">Add</button>
            </div>
            <div id="bw-email-list" style="display:flex;flex-direction:column;gap:4px;max-height:220px;overflow-y:auto;">
              {emails.length === 0 ? (
                <div style="color:var(--text-dim);font-size:11px;padding:8px;">No recipients</div>
              ) : emails.map(e => (
                <div key={e} class="item-row">
                  <span>{e}</span>
                  <button class="item-remove" hx-post="/api/admin/modal/bad-words/remove-email" hx-vals={JSON.stringify({ email: e })} hx-target="#bw-email-list" hx-swap="innerHTML">&times;</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "words" && (
          <div>
            <div class="modal-sub" style="margin-bottom:10px;">Phrases to search for in transcripts. Case-insensitive.</div>
            <div style="display:flex;gap:6px;margin-bottom:10px;">
              <input id="bw-word-input" class="sf-input" type="text" name="word" placeholder="e.g. resort fees included" style="flex:1;" />
              <button class="sf-btn primary" hx-post="/api/admin/modal/bad-words/add-word" hx-include="#bw-word-input" hx-target="#bw-word-list" hx-swap="innerHTML">Add</button>
            </div>
            <div id="bw-word-list" style="display:flex;flex-direction:column;gap:4px;max-height:340px;overflow-y:auto;">
              {words.length === 0 ? (
                <div style="color:var(--text-dim);font-size:11px;padding:8px;">No words configured</div>
              ) : words.map(w => (
                <div key={w} class="item-row">
                  <span>{w}</span>
                  <button class="item-remove" hx-post="/api/admin/modal/bad-words/remove-word" hx-vals={JSON.stringify({ word: w })} hx-target="#bw-word-list" hx-swap="innerHTML">&times;</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "offices" && (
          <div>
            <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:12px;">
              <label style="font-size:11px;font-weight:600;color:var(--text-bright);flex:1;">Check all offices (ignore patterns below)</label>
              <input
                type="checkbox"
                id="bw-all-offices"
                checked={!!config.allOffices}
                style="width:16px;height:16px;cursor:pointer;"
                hx-post="/api/admin/modal/bad-words/toggle-all-offices"
                hx-trigger="change"
                hx-swap="none"
              />
            </div>
            <div class="modal-sub" style="margin-bottom:10px;">Office name patterns (case-insensitive substring). Only used when "all offices" is off.</div>
            <div style="display:flex;gap:6px;margin-bottom:10px;">
              <input id="bw-office-input" class="sf-input" type="text" name="pattern" placeholder="e.g. JAY" style="flex:1;" />
              <button class="sf-btn primary" hx-post="/api/admin/modal/bad-words/add-office" hx-include="#bw-office-input" hx-target="#bw-office-list" hx-swap="innerHTML">Add</button>
            </div>
            <div id="bw-office-list" style="display:flex;flex-direction:column;gap:4px;max-height:180px;overflow-y:auto;">
              {officePatterns.length === 0 ? (
                <div style="color:var(--text-dim);font-size:11px;padding:8px;">No office patterns</div>
              ) : officePatterns.map(p => (
                <div key={p} class="item-row">
                  <span>{p}</span>
                  <button class="item-remove" hx-post="/api/admin/modal/bad-words/remove-office" hx-vals={JSON.stringify({ pattern: p })} hx-target="#bw-office-list" hx-swap="innerHTML">&times;</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
    return new Response(html, { headers: { "content-type": "text/html" } });
  },
});
