/** Modal content: Bad Words — 3 tabs (Recipients/Words/Offices) matching production. */
import { define } from "../../../../lib/define.ts";
import { apiFetch } from "../../../../lib/api.ts";
import { renderToString } from "preact-render-to-string";

export interface BwExclusion { word: string; buffer: number; type: string }
export interface BwWordEntry { word: string; exclusions?: BwExclusion[] }
export interface BwConfig {
  enabled?: boolean;
  allOffices?: boolean;
  emails?: string[];
  words?: (string | BwWordEntry)[];
  officePatterns?: string[];
}

/** Normalize raw config words (mixed strings/objects) to BwWordEntry[]. */
export function normalizeWordEntries(raw: (string | BwWordEntry)[] | undefined): BwWordEntry[] {
  return (raw ?? []).map(w => typeof w === "string" ? { word: w } : { word: w.word, exclusions: w.exclusions ?? [] });
}

/** Render the Words tab — pure, reusable from GET handler and POST sub-routes. */
export function renderWordsTab(wordEntries: BwWordEntry[], expandedWord: string | null) {
  return (
    <div>
      <div class="modal-sub" style="margin-bottom:10px;">Phrases to search for in transcripts. Case-insensitive. Expand a word to add exclusion rules (e.g. ignore 'free' if 'toll' precedes it).</div>
      <div style="display:flex;gap:6px;margin-bottom:10px;">
        <input id="bw-word-input" class="sf-input" type="text" name="word" placeholder="e.g. resort fees included" style="flex:1;" />
        <button
          class="sf-btn primary"
          hx-post="/api/admin/modal/bad-words/add-word"
          hx-include="#bw-word-input"
          hx-target="#bad-words-modal-content"
          hx-swap="innerHTML"
        >Add</button>
      </div>
      <div id="bw-word-list" style="display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto;">
        {wordEntries.length === 0 ? (
          <div style="color:var(--text-dim);font-size:11px;padding:8px;">No words configured</div>
        ) : wordEntries.map(entry => {
          const excls = entry.exclusions ?? [];
          const isExpanded = expandedWord === entry.word;
          const collapseUrl = `/api/admin/modal/bad-words?tab=words`;
          const expandUrl = `/api/admin/modal/bad-words?tab=words&expand=${encodeURIComponent(entry.word)}`;
          const headerUrl = isExpanded ? collapseUrl : expandUrl;
          return (
            <div key={entry.word} style="background:#161c28;border:1px solid #1c2333;border-radius:6px;overflow:hidden;flex-shrink:0;">
              <div
                style="display:flex;align-items:center;gap:6px;padding:7px 10px;cursor:pointer;"
                hx-get={headerUrl}
                hx-target="#bad-words-modal-content"
                hx-swap="innerHTML"
              >
                <span style="font-size:11px;color:#e6edf3;flex:1;">{entry.word}</span>
                <span style="font-size:9px;color:#6e7681;padding:2px 6px;background:#0b0f15;border:1px solid #1c2333;border-radius:10px;white-space:nowrap;">
                  {excls.length ? `${excls.length} exclusion${excls.length > 1 ? "s" : ""}` : "no exclusions"}
                </span>
                <span style="font-size:10px;color:#58a6ff;margin-left:2px;">{isExpanded ? "▾" : "▸"}</span>
                <button
                  style="background:transparent;border:none;color:#f85149;cursor:pointer;font-size:13px;padding:0 0 0 6px;"
                  title="Remove word"
                  hx-post="/api/admin/modal/bad-words/remove-word"
                  hx-vals={JSON.stringify({ word: entry.word })}
                  hx-target="#bad-words-modal-content"
                  hx-swap="innerHTML"
                  hx-trigger="click consume"
                >&times;</button>
              </div>
              {isExpanded && (
                <div style="padding:8px 10px 10px;border-top:1px solid var(--border);background:var(--bg);">
                  {excls.length === 0 ? (
                    <div style="font-size:10px;color:var(--text-dim);margin-bottom:8px;">No exclusions — word always triggers</div>
                  ) : (
                    <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;">
                      {excls.map((ex, ei) => (
                        <div key={ei} style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--bg-surface);border:1px solid var(--border);border-radius:5px;font-size:10px;color:var(--text-muted);">
                          <span style="color:var(--yellow);font-weight:600;">{ex.type === "prefix" ? "before" : "after"}</span>
                          <span style="color:var(--text-bright);">"{ex.word}"</span>
                          <span>within {ex.buffer} word{ex.buffer !== 1 ? "s" : ""}</span>
                          <button
                            style="margin-left:auto;background:transparent;border:none;color:var(--red);cursor:pointer;font-size:12px;"
                            hx-post="/api/admin/modal/bad-words/remove-exclusion"
                            hx-vals={JSON.stringify({ word: entry.word, exIndex: ei })}
                            hx-target="#bad-words-modal-content"
                            hx-swap="innerHTML"
                          >&times;</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Add-exclusion form */}
                  <form
                    id={`bw-add-excl-${entry.word}`}
                    style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;"
                    hx-post="/api/admin/modal/bad-words/add-exclusion"
                    hx-target="#bad-words-modal-content"
                    hx-swap="innerHTML"
                  >
                    <input type="hidden" name="word" value={entry.word} />
                    <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);">Add exclusion:</span>
                    <select name="exType" style="background:var(--bg-raised);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:10px;padding:3px 5px;">
                      <option value="prefix">if word before</option>
                      <option value="suffix">if word after</option>
                    </select>
                    <input class="sf-input" type="text" name="exWord" placeholder="e.g. toll" required style="flex:1;min-width:80px;font-size:10px;padding:4px 7px;" />
                    <span style="font-size:10px;color:var(--text-muted);">within</span>
                    <input type="number" name="exBuffer" min="1" max="20" value="1" style="width:42px;background:var(--bg-raised);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:10px;padding:3px 5px;" />
                    <span style="font-size:10px;color:var(--text-muted);">word(s)</span>
                    <button type="submit" class="sf-btn primary" style="font-size:10px;padding:3px 9px;">Add</button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Render the entire modal shell (tabs + active tab body). Pure. */
export function renderBadWordsModal(config: BwConfig, tab: string, expandedWord: string | null) {
  const emails = config.emails ?? [];
  const wordEntries = normalizeWordEntries(config.words);
  const officePatterns = config.officePatterns ?? [];

  return (
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

      {tab === "words" && renderWordsTab(wordEntries, expandedWord)}

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
}

/** Fetch config + render full modal as text/html Response. Used by GET and POST sub-routes for words tab. */
export async function renderBadWordsResponse(req: Request, opts: { tab?: string; expandedWord?: string | null } = {}): Promise<Response> {
  let config: BwConfig = {};
  try { config = await apiFetch<BwConfig>("/admin/bad-word-config", req); } catch { /* fail-safe: empty config */ }
  const tab = opts.tab ?? "words";
  const expandedWord = opts.expandedWord ?? null;
  const html = renderToString(renderBadWordsModal(config, tab, expandedWord));
  return new Response(html, { headers: { "content-type": "text/html" } });
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const tab = url.searchParams.get("tab") ?? "emails";
    const expandedWord = url.searchParams.get("expand");
    return await renderBadWordsResponse(ctx.req, { tab, expandedWord });
  },
});
