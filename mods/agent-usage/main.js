// Agent usage: a sidebar block showing how much of each agent's quota is left.
//
// Claude Code: the subscription's 5-hour and 7-day limits, and each running
// agent's context window, from what claude-statusline.sh (this folder) saves
// to ~/.cache/herdr-agent-usage/claude/ every time Claude Code redraws its
// status line. Codex: its plan's rate-limit windows, from the newest session
// log in ~/.codex/sessions. Antigravity: `agy -p /usage --output-format json`
// (no model call, no tokens), per model group. Click an agent to go to it.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { agents, exec, home, readTextFile, run, theme, checking, watchFolder } from "herdr";

const POLL_MS = 15000;
const CODEX_POLL_MS = 60000;
// agy /usage takes ~2s and no tokens. Checked every AGY_TICK_MS; how often it actually runs
// depends on what the agy agents are doing (see agyDue).
const AGY_TICK_MS = 5000;
const AGY_WORKING_S = 20; // an agy agent is working: quota moves fast
const AGY_LIVE_S = 60; // agy agents running but idle
const AGY_IDLE_S = 180; // no agy agent
const AGY_SETTLED_S = 3; // an agy run (any, e.g. `agy -p` from Claude) stopped writing: check now
const AGY_ACTIVE_S = 15; // an agy run is still writing: check this often
const AGY_CONVERSATIONS = () => `${home()}/.gemini/antigravity-cli/conversations`;
const RECENT = 7 * 86400; // show a provider without a running agent if used this week

// Herdr's program table keys (programs.json), with the agent-reported app names as a fallback.
const PROVIDERS = {
  claude: { name: "Claude", icon: "icons/claude.svg", keys: ["claude", "claude-code"] },
  codex: { name: "Codex", icon: "icons/codex.svg", keys: ["codex"] },
  antigravity: { name: "Antigravity", icon: "icons/antigravity.svg", keys: ["antigravity", "agy"] },
};
function providerOf(a) {
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (p.keys.includes(a.program?.key) || p.keys.includes(a.app)) return id;
  }
  return null;
}

const CODEX_SCRIPT = `
d="$HOME/.codex/sessions"
[ -d "$d" ] || exit 0
find "$d" -name 'rollout-*.jsonl' -mtime -31 -print 2>/dev/null | xargs ls -t 2>/dev/null | head -5 | while read -r f; do
  l=$(grep '"rate_limits"' "$f" | tail -1)
  if [ -n "$l" ]; then printf '%s\\t%s\\n' "$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f")" "$l"; exit 0; fi
done
`;
const AGY_SCRIPT = `PATH="$HOME/.local/bin:$PATH"; command -v agy >/dev/null || exit 0; cd "$HOME" && agy -p /usage --output-format json`;

const now = () => Math.floor(Date.now() / 1000);

function span(sec) {
  if (sec < 60) return "now";
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24 ? `${h % 24}h` : ""}`;
}
const ago = (at) => (!at ? "" : now() - at < 60 ? "just now" : `${span(now() - at)} ago`);

function windowLabel(minutes) {
  if (!minutes) return "";
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function parseJSON(text) {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

// A window past its reset is full again, even if nobody has said so yet.
function remaining(w) {
  if (!w) return null;
  if (w.resets_at && w.resets_at <= now()) return { left: 100, resets: null };
  const used = Number(w.used_percentage ?? w.used_percent ?? 0);
  return { left: Math.max(0, Math.min(100, 100 - used)), resets: w.resets_at ?? null };
}

// Antigravity's buckets: { remaining_fraction, reset_time (ISO), window: "5h" | "weekly" }.
function agyRemaining(b) {
  const resets = b.reset_time ? Math.floor(Date.parse(b.reset_time) / 1000) : null;
  if (resets && resets <= now()) return { left: 100, resets: null };
  return { left: Math.max(0, Math.min(100, Number(b.remaining_fraction ?? 1) * 100)), resets };
}
const AGY_WINDOW = { "5h": "5h", weekly: "7d", daily: "1d" };
const agyGroupName = (name) => name.replace(/\s+models?$/i, "").replace(/ and /g, "/");

export default class AgentUsage extends View {
  init(_props, cx) {
    this.width = 240;
    this.claude = null; // { at, rate_limits }
    this.sessions = {}; // terminal address -> statusline record
    this.codex = null; // { at, rate_limits }
    this.agy = null; // { at, groups }
    this.agyLast = 0; // seconds; last /usage started
    this.agySig = ""; // agy agents' status+seq at that time
    this.agyBusy = false;
    this.agyChange = 0; // seconds; last write by any agy run
    if (checking()) return;
    this.load(cx);
    this.loadCodex(cx);
    this.loadAgy(cx);
    cx.timer.every(POLL_MS, (cx) => this.load(cx));
    cx.timer.every(CODEX_POLL_MS, (cx) => this.loadCodex(cx));
    cx.timer.every(AGY_TICK_MS, (cx) => { if (this.agyDue()) this.loadAgy(cx); });
    this.watchAgy(cx);
  }

  dir() {
    return `${home()}/.cache/herdr-agent-usage/claude`;
  }

  load(cx) {
    cx.spawn(async (cx) => {
      const account = parseJSON(await readTextFile(`${this.dir()}/_account.json`).catch(() => null));
      const sessions = {};
      for (const a of agents()) {
        if (a.address.includes("/") || providerOf(a) !== "claude") continue;
        const rec = parseJSON(await readTextFile(`${this.dir()}/${a.address}.json`).catch(() => null));
        if (rec) sessions[a.address] = rec;
      }
      this.claude = account;
      this.sessions = sessions;
      cx.notify();
    });
  }

  loadCodex(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", CODEX_SCRIPT], { timeout: 10000 });
        const line = r.stdout.trim();
        if (!line) { this.codex = null; cx.notify(); return; }
        const tab = line.indexOf("\t");
        const ev = parseJSON(line.slice(tab + 1));
        const rl = ev?.payload?.rate_limits ?? ev?.rate_limits;
        this.codex = rl ? { at: Number(line.slice(0, tab)) || null, rate_limits: rl } : null;
      } catch {
        this.codex = null;
      }
      cx.notify();
    });
  }

  // agy runs that aren't Herdr agents (Claude calling `agy -p` from its shell) still write their
  // conversation here; /usage itself doesn't, so this can't trigger itself.
  watchAgy(cx) {
    cx.spawn(async () => {
      for (;;) {
        try {
          const changed = await watchFolder(AGY_CONVERSATIONS());
          if (changed.length) this.agyChange = now();
        } catch {
          return; // no agy folder (or no watch slots): the timer pace still applies
        }
      }
    });
  }

  agySignature() {
    return agents().filter((a) => providerOf(a) === "antigravity").map((a) => `${a.address}:${a.status}:${a.seq}`).join(",");
  }

  // Poll right after an agy agent changes (a turn ended, one started or quit), else on a
  // pace that follows how busy they are.
  agyDue() {
    if (this.agyBusy) return false;
    const live = agents().filter((a) => providerOf(a) === "antigravity");
    const since = now() - this.agyLast;
    if (this.agySignature() !== this.agySig) return since >= 3;
    if (this.agyChange > this.agyLast) {
      return now() - this.agyChange >= AGY_SETTLED_S || since >= AGY_ACTIVE_S;
    }
    if (live.some((a) => a.status === "working")) return since >= AGY_WORKING_S;
    return since >= (live.length ? AGY_LIVE_S : AGY_IDLE_S);
  }

  loadAgy(cx) {
    this.agyLast = now();
    this.agySig = this.agySignature();
    this.agyBusy = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", AGY_SCRIPT], { timeout: 30000 });
        const groups = parseJSON(r.stdout.trim())?.command?.data?.groups;
        if (Array.isArray(groups)) this.agy = { at: now(), groups };
        else if (!this.agy) this.agy = { at: null, groups: [], error: (r.stderr || r.stdout).trim().split("\n")[0] };
      } catch (e) {
        if (!this.agy) this.agy = { at: null, groups: [], error: String(e?.message ?? e) };
      }
      this.agyBusy = false;
      cx.notify();
    });
  }

  // Remaining-% colour: plenty, getting low, nearly out.
  tone(left) {
    const t = theme();
    return left > 50 ? t.ansi2 : left > 20 ? t.ansi3 : t.ansi1;
  }

  icon(path, size) {
    return image(path).w(size).h(size).flex_none();
  }

  // The agent's own icon, as the agents list draws it.
  programIcon(p, size) {
    const t = theme();
    if (!p?.icon) return div().w(size).h(size).flex_none();
    return p.tint ? svg(p.icon).size(size).flex_none().text_color(p.color ?? t.foreground) : this.icon(p.icon, size);
  }

  bar(left) {
    const t = theme();
    return div().flex_1().h(6).rounded(3).bg(t.raised).overflow_hidden()
      .child(div().h_full().rounded(3).w(`${Math.round(left)}%`).bg(this.tone(left)));
  }

  limitRow(id, label, r) {
    const t = theme();
    if (!r) return null;
    const narrow = this.width < 160;
    return h_flex().id(id).gap(6).items_center().text_size(13)
      .child(div().w(narrow ? 22 : 28).text_color(t.muted).child(label))
      .when(!narrow, (el) => el.child(this.bar(r.left)))
      .child(div().w(44).text_right().text_color(this.tone(r.left)).font_semibold().child(`${Math.round(r.left)}%`))
      .when(!narrow, (el) => el.child(div().w(52).text_right().text_color(t.dim).child(r.resets ? span(r.resets - now()) : "")));
  }

  heading(id, text, right) {
    const t = theme();
    const p = PROVIDERS[id];
    return h_flex().gap(6).items_center().pt(4)
      .child(this.icon(p.icon, 17))
      .when(this.width >= 160, (el) => el
        .child(div().flex_1().truncate().text_size(13).font_semibold().text_color(t.foreground).child(text))
        .child(div().text_size(12).text_color(t.dim).child(right ?? "")));
  }

  subheading(text) {
    return div().text_size(12).text_color(theme().muted).pt(2).child(text);
  }

  // The agents under a provider, folded away behind a toggle (remembered per provider).
  agentList(id, live, recFor) {
    if (!live.length) return [];
    const t = theme();
    const key = `agent-usage.open.${id}`;
    const open = localStorage.getItem(key) === "1";
    const toggle = h_flex().id(`fold-${id}`).gap(6).items_center().text_size(12).text_color(t.dim).px(4).py(1).rounded(4)
      .hover((s) => s.bg(t.hover).text_color(t.muted))
      .on_click((_e, cx) => { localStorage.setItem(key, open ? "0" : "1"); cx.notify(); })
      .child(div().w(10).child(open ? "▾" : "▸"))
      .child(div().child(id === "claude" ? `${live.length} agents · context left` : `${live.length} agents`));
    return [toggle, ...(open ? live.map((a) => this.agentRow(a, recFor(a))) : [])];
  }

  hint(text) {
    return div().text_size(12).text_color(theme().dim).child(text);
  }

  // One running agent: its icon with a status dot, where it is, and how much context it has left.
  agentRow(a, rec) {
    const t = theme();
    const color = t[a.status] ?? t.idle;
    const fresh = rec && now() - rec.at < 6 * 3600;
    const left = fresh ? rec.context?.remaining_percentage : null;
    const name = a.pane_name || `${a.space_name} · ${a.tab_name}`;
    return h_flex().id(`a-${a.address}`).gap(7).items_center().text_size(13).px(4).py(2).rounded(4)
      .when(a.focused, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("agent.focus", { terminal: a.address }))
      .child(div().relative().w(16).h(16).flex_none()
        .child(this.programIcon(a.program, 16))
        .child(div().absolute().right(-2).bottom(-2).w(7).h(7).rounded(4).bg(color).border(1).border_color(t.chrome)))
      .when(this.width >= 160, (el) => el.child(div().flex_1().truncate().text_color(t.muted).child(name)))
      .when(left != null, (el) => el.child(div().text_right().text_color(this.tone(left)).child(this.width >= 160 ? `${Math.round(left)}% left` : `${Math.round(left)}%`)));
  }

  claudeSection(live) {
    const rl = this.claude?.rate_limits;
    if (!rl && !live.length) return null;
    const rows = [];
    if (rl) {
      rows.push(this.limitRow("c-5h", "5h", remaining(rl.five_hour)));
      rows.push(this.limitRow("c-7d", "7d", remaining(rl.seven_day)));
      if (rl.spend_limit) rows.push(this.limitRow("c-spend", "$", remaining(rl.spend_limit)));
    } else {
      rows.push(this.hint("Waiting for Claude Code's status line…"));
    }
    return v_flex().gap(4)
      .child(this.heading("claude", "Claude", ago(this.claude?.at)))
      .children(rows.filter(Boolean))
      .children(this.agentList("claude", live, (a) => this.sessions[a.address]));
  }

  codexSection(live) {
    const rl = this.codex?.rate_limits;
    const recent = this.codex?.at && now() - this.codex.at < RECENT;
    if (!live.length && !recent) return null;
    const rows = [];
    for (const [key, w] of [["primary", rl?.primary], ["secondary", rl?.secondary]]) {
      if (!w) continue;
      rows.push(this.limitRow(`x-${key}`, windowLabel(w.window_minutes) || key[0], remaining(w)));
    }
    if (!rows.length) rows.push(this.hint("No rate-limit data yet"));
    const plan = rl?.plan_type ? ` · ${rl.plan_type}` : "";
    return v_flex().gap(4)
      .child(this.heading("codex", `Codex${plan}`, ago(this.codex?.at)))
      .children(rows)
      .children(this.agentList("codex", live, () => null));
  }

  agySection(live) {
    const groups = this.agy?.groups ?? [];
    // Without a running agy agent, show it only once some quota has been used.
    const used = groups.some((g) => (g.buckets ?? []).some((b) => agyRemaining(b).left < 100));
    if (!live.length && !used) return null;
    const blocks = [];
    for (const [gi, g] of groups.entries()) {
      const buckets = [...(g.buckets ?? [])].sort((a, b) => (a.window === "5h" ? -1 : b.window === "5h" ? 1 : 0));
      if (groups.length > 1) blocks.push(this.subheading(agyGroupName(g.name ?? "")));
      for (const [bi, b] of buckets.entries()) {
        blocks.push(this.limitRow(`g-${gi}-${bi}`, AGY_WINDOW[b.window] ?? b.window ?? "?", agyRemaining(b)));
      }
    }
    if (!blocks.length) blocks.push(this.hint(this.agy?.error || "Checking agy /usage…"));
    return v_flex().gap(4)
      .child(this.heading("antigravity", "Antigravity", ago(this.agy?.at)))
      .children(blocks)
      .children(this.agentList("antigravity", live, () => null));
  }

  render(cx) {
    const t = theme();
    const all = agents();
    const live = (id) => all.filter((a) => providerOf(a) === id);
    const sections = [
      this.claudeSection(live("claude")),
      this.codexSection(live("codex")),
      this.agySection(live("antigravity")),
    ].filter(Boolean);
    // Header matches the shipped Agents list's (same paddings, size and weight).
    return v_flex().id("root").size_full().bg(t.chrome).border_t(1).border_color(t.border)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .child(h_flex().px(16).h(41).pt(14).pb(5).flex_none().items_center()
        .child(div().text_size(11.5).font_medium().text_color(t.dim).child(this.width < 160 ? "Usage" : "Usage Left")))
      // Scrollbar only while the pointer is over the panel, so it goes as soon as you leave.
      .child(div().relative().flex_1().min_h(0)
        .child(v_flex().id("usage-scroll").size_full().px(16).pt(4).pb(10).gap(10).overflow_y_scroll()
          .children(sections.length ? sections : [this.hint("No Claude, Codex or Antigravity agents running")]))
        .child(Scrollbar.vertical("usage-scroll").mode("hover").absolute().inset_0()));
  }
}
