// Docker logs viewer: a container's logs as entries you can select and copy.
// Opened as a tab: tab.new {name, mod: "docker-logs", props: {container}}.
//
// One row per log entry; indented / "at …" / "Caused by" lines join the entry
// before them, so a stack trace is one entry. Click selects an entry,
// ⇧-click a range, ⌘-click adds or removes one; ⌘C (or the Copy button)
// copies the selection, ⌘A selects everything shown, Esc clears.
// New lines are fetched every 1.5 s (`docker logs --since`); scrolling up
// stops following, End / the Follow button resumes. Wrap (on by default,
// remembered across tabs) folds long lines at the list's width.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { exec, theme, props, settings, nextCommand, checking, shared, setShared } from "herdr";

const POLL_MS = 1500;
const MAX_ENTRIES = 5000;
const MAX_SHOWN_LINES = 40; // screen lines per entry; the rest is still copied
const LH = 18; // line height
const FONT = 12.5; // list text size
const CHAR_W = FONT * 0.62; // a monospace cell, rounded up so wrapped chunks always fit
// Row parts beside the text: padding 10+10, selection bar 3, gaps 10+10, clock 104, scrollbar room 14.
const ROW_CHROME = 10 + 10 + 3 + 10 + 104 + 10 + 14;
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F300}-\u{1FAFF}]/u;
const PAD = 6; // vertical padding per row
const TS = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ?(.*)$/;
// Color/cursor escapes a terminal would draw; here they'd show as junk.
const ANSI = /\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
// A line rewritten with \r (progress bars) shows its last state, as a terminal would.
const plain = (text) => text.replace(ANSI, "").split("\r").filter(Boolean).pop() ?? "";
const CONTINUATION = /^(\s|at\s|Caused by|\.\.\.\s|\}|\]|\))/;

// Docker trims trailing zeros from RFC3339Nano; pad so strings sort by time.
function normTs(ts) {
  const m = /^(.*?)(?:\.(\d+))?Z$/.exec(ts);
  return m ? `${m[1]}.${(m[2] ?? "").padEnd(9, "0")}Z` : ts;
}

function levelOf(text) {
  if (/\b(FATAL|PANIC|CRIT(ICAL)?|ERROR|ERR)\b/i.test(text)) return "error";
  if (/\b(WARN(ING)?|WRN)\b/i.test(text)) return "warn";
  if (/\b(DEBUG|DBG|TRACE|TRC)\b/i.test(text)) return "debug";
  return "info";
}

function clock(ts) {
  const d = new Date(ts.replace(/(\.\d{3})\d*Z$/, "$1Z"));
  if (isNaN(d)) return "";
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// Splits one line into chunks of at most `cols` cells (CJK and emoji take two),
// preferring to break after a space near the end of a chunk.
function wrapLine(line, cols) {
  if (!line) return [""];
  const out = [];
  let chunk = "";
  let w = 0;
  let lastSpace = -1;
  for (const ch of line) {
    const cw = WIDE.test(ch) ? 2 : 1;
    if (w + cw > cols) {
      if (lastSpace > chunk.length * 0.6) {
        out.push(chunk.slice(0, lastSpace + 1));
        chunk = chunk.slice(lastSpace + 1);
      } else {
        out.push(chunk);
        chunk = "";
      }
      w = [...chunk].reduce((n, c) => n + (WIDE.test(c) ? 2 : 1), 0);
      lastSpace = -1;
    }
    chunk += ch;
    w += cw;
    if (ch === " ") lastSpace = chunk.length - 1;
  }
  out.push(chunk);
  return out;
}

export default class DockerLogs extends View {
  init(_props, cx) {
    this.container = props()?.container ?? "";
    // The docker-dash TUI passes its context (it can switch to ssh contexts).
    this.context = props()?.context ?? "";
    this.entries = []; // { id, ts, stream, lines: [], level }
    this.nextId = 1;
    this.lastTs = null; // normalised timestamp of the newest line
    this.atLast = new Set(); // raw lines already taken at lastTs (--since is inclusive)
    this.lastOf = {}; // stream -> its newest entry, for joining continuation lines
    this.selected = new Set(); // entry ids
    this.anchor = null; // entry id for ⇧-click ranges
    this.follow = true;
    this.width = 0; // the entries area, logical px
    this.errorsOnly = false;
    this.filter = "";
    this.error = "";
    this.note = null;
    this.loaded = false;
    this.mods = { shift: false, platform: false, control: false };
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.input = InputState.new({ placeholder: "Filter…" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value();
      cx.notify();
    });
    if (checking() || !this.container) return;
    this.fetch(cx, true);
    cx.timer.every(POLL_MS, (cx) => this.fetch(cx, false));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        cx.notify();
      }
    });
  }

  fetch(cx, first) {
    if (this.busy) return;
    this.busy = true;
    const args = this.context ? ["--context", this.context, "logs", "--timestamps"] : ["logs", "--timestamps"];
    if (first) args.push("--tail", "2000");
    else if (this.lastTs) args.push("--since", this.lastTs);
    args.push(this.container);
    cx.spawn(async (cx) => {
      try {
        const r = await exec("docker", args, { timeout: 15000 });
        if (r.code !== 0) {
          this.error = (r.stderr || "docker logs failed").trim().split("\n").pop();
        } else {
          this.error = "";
          const added = this.ingest(r.stdout, r.stderr);
          if (added && this.follow) this.scroll.scroll_to_bottom();
          if (added || first) cx.notify();
        }
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        this.busy = false;
        if (first) {
          this.loaded = true;
          this.scroll.scroll_to_bottom();
          cx.notify();
        }
      }
    });
  }

  // Parses both streams, merges them by time, groups lines into entries.
  ingest(stdout, stderr) {
    const lines = [];
    const take = (text, stream) => {
      for (const raw of text.split("\n")) {
        if (!raw) continue;
        const m = TS.exec(raw);
        if (!m) continue;
        lines.push({ ts: normTs(m[1]), stream, text: plain(m[2]), raw });
      }
    };
    take(stdout, "out");
    take(stderr, "err");
    lines.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

    let added = 0;
    for (const l of lines) {
      if (this.lastTs && l.ts < this.lastTs) continue;
      if (l.ts === this.lastTs) {
        if (this.atLast.has(l.raw)) continue;
      } else {
        this.lastTs = l.ts;
        this.atLast = new Set();
      }
      this.atLast.add(l.raw);
      // stdout and stderr interleave by time, so a stack trace on stderr can
      // have stdout lines between its parts: join it to its own stream's entry.
      const last = this.lastOf[l.stream];
      if (last && CONTINUATION.test(l.text)) {
        last.lines.push(l.text);
      } else {
        const e = { id: this.nextId++, ts: l.ts, stream: l.stream, lines: [l.text], level: levelOf(l.text) };
        this.entries.push(e);
        this.lastOf[l.stream] = e;
      }
      added++;
    }
    if (this.entries.length > MAX_ENTRIES) {
      const drop = this.entries.splice(0, this.entries.length - MAX_ENTRIES);
      for (const e of drop) this.selected.delete(e.id);
    }
    return added;
  }

  shown() {
    const f = this.filter.toLowerCase();
    return this.entries.filter((e) =>
      (!this.errorsOnly || e.level === "error" || e.level === "warn") &&
      (!f || e.lines.join("\n").toLowerCase().includes(f)));
  }

  click(id, cx) {
    const list = this.shown();
    const idx = (x) => list.findIndex((e) => e.id === x);
    if (this.mods.shift && this.anchor !== null && idx(this.anchor) >= 0) {
      const [a, b] = [idx(this.anchor), idx(id)].sort((x, y) => x - y);
      if (!(this.mods.platform || this.mods.control)) this.selected.clear();
      for (let i = a; i <= b; i++) this.selected.add(list[i].id);
    } else if (this.mods.platform || this.mods.control) {
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
      this.anchor = id;
    } else {
      const only = this.selected.size === 1 && this.selected.has(id);
      this.selected.clear();
      if (!only) this.selected.add(id); // clicking the only selected entry deselects it
      this.anchor = id;
    }
    this.note = null;
    cx.notify();
  }

  copy(cx) {
    const picked = this.entries.filter((e) => this.selected.has(e.id));
    if (!picked.length) {
      this.note = { text: "Select entries first (click, ⇧-click, ⌘-click)", error: true };
      cx.notify();
      return;
    }
    cx.write_to_clipboard(picked.map((e) => e.lines.join("\n")).join("\n"));
    this.note = { text: `Copied ${picked.length} entr${picked.length === 1 ? "y" : "ies"}` };
    cx.notify();
  }

  wrap() {
    return shared("docker-logs.wrap") ?? true;
  }

  cols() {
    return Math.max(20, Math.floor((this.width - ROW_CHROME) / CHAR_W));
  }

  // The entry as screen lines: [{ text, first }] where `first` marks the
  // entry's first log line (drawn in the level's color). Cached per width.
  screenLines(e) {
    const wrap = this.wrap() && this.width > 0;
    const key = wrap ? this.cols() : 0;
    if (e.vis && e.visKey === key && e.visCount === e.lines.length) return e.vis;
    const vis = [];
    e.lines.forEach((l, i) => {
      for (const part of wrap ? wrapLine(l, key) : [l]) vis.push({ text: part, first: i === 0 });
    });
    e.vis = vis;
    e.visKey = key;
    e.visCount = e.lines.length;
    return vis;
  }

  heightOf(e) {
    const n = this.screenLines(e).length;
    return (Math.min(n, MAX_SHOWN_LINES) + (n > MAX_SHOWN_LINES ? 1 : 0)) * LH + PAD;
  }

  row(t, e) {
    const sel = this.selected.has(e.id);
    const color = { error: t.ansi1, warn: t.ansi3, debug: t.dim, info: t.foreground }[e.level];
    const vis = this.screenLines(e);
    const shownLines = vis.slice(0, MAX_SHOWN_LINES);
    return h_flex()
      .w_full()
      .h(this.heightOf(e))
      .px(10)
      .py(PAD / 2)
      .gap(10)
      .items_start()
      .cursor_pointer()
      .bg(sel ? t.selected : "#00000000")
      .hover((s) => s.bg(sel ? t.selected : t.hover))
      .child(div().w(3).h_full().flex_none().rounded(2).bg(sel ? t.accent : "#00000000"))
      .child(div().w(104).flex_none().h(LH).whitespace_nowrap().text_color(t.dim).child(clock(e.ts)))
      .child(
        v_flex().flex_1().min_w(0)
          .children(shownLines.map((l) =>
            div().h(LH).truncate().whitespace_nowrap().text_color(l.first ? color : t.muted).child(l.text || " ")))
          .when(vis.length > MAX_SHOWN_LINES, (el) =>
            el.child(div().h(LH).text_color(t.dim).child(`… ${vis.length - MAX_SHOWN_LINES} more lines (copied too)`))),
      );
  }

  toggle(t, id, label, on, onClick) {
    return div()
      .id(id)
      .px(9)
      .py(4)
      .rounded(6)
      .text_size(11.5)
      .cursor_pointer()
      .text_color(on ? t.accent_foreground : t.muted)
      .bg(on ? t.accent : t.raised)
      .hover((s) => s.bg(on ? t.accent : t.hover))
      .on_click((_e, cx) => onClick(cx))
      .child(label);
  }

  render(cx) {
    const t = theme();
    const list = this.shown();
    const font = settings().font_family ?? "JetBrains Mono";
    const nSel = this.selected.size;

    let body;
    if (!this.container) {
      body = div().p(16).text_color(t.dim).child("No container given.");
    } else if (!this.loaded) {
      body = div().p(16).text_color(t.dim).child(`Loading logs of ${this.container}…`);
    } else if (!list.length) {
      body = div().p(16).text_color(t.dim).child(this.entries.length ? "No entry matches." : "No logs yet.");
    } else {
      body = v_virtual_list("dl-rows", list.length, list.map((e) => this.heightOf(e)),
        (i) => String(list[i].id),
        (range) => list.slice(range.start, range.end).map((e) => this.row(t, e)))
        .track_scroll(this.scroll)
        .on_item_click((key, cx) => this.click(Number(key), cx))
        .size_full();
    }

    return v_flex()
      .id("docker-logs")
      .track_focus(this.handle)
      .size_full()
      .bg(t.background)
      .text_size(FONT)
      .on_mouse_down("left", (e, cx) => {
        this.mods = e.modifiers; // on_item_click reports no modifiers; remember them here
        this.handle.focus();
      })
      .on_modifiers_changed((e) => { this.mods = e.modifiers; })
      .on_key_down((e, cx) => {
        const cmd = e.modifiers.platform || e.modifiers.control;
        if (cmd && e.key === "c" && nSel) this.copy(cx);
        else if (cmd && e.key === "a") list.forEach((x) => this.selected.add(x.id));
        else if (e.key === "escape") { this.selected.clear(); this.note = null; }
        else if (e.key === "end") { this.follow = true; this.scroll.scroll_to_bottom(); }
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      // toolbar
      .child(
        h_flex().flex_none().h(44).px(12).gap(8).items_center().border_b(1).border_color(t.border).bg(t.chrome)
          .child(div().text_size(13).font_semibold().text_color(t.foreground).child(this.container))
          .child(div().text_size(11.5).text_color(this.error ? t.ansi1 : t.dim).truncate().child(
            this.error || `${this.entries.length} entries`))
          .child(div().flex_1())
          .child(h_flex().w(220).h(28).px(8).items_center().rounded(7).border_1().border_color(t.border).bg(t.background)
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground)))
          .child(this.toggle(t, "dl-wrap", "Wrap", this.wrap(), (cx) => { setShared("docker-logs.wrap", !this.wrap()); cx.notify(); }))
          .child(this.toggle(t, "dl-errors", "Errors & warnings", this.errorsOnly, (cx) => { this.errorsOnly = !this.errorsOnly; cx.notify(); }))
          .child(this.toggle(t, "dl-follow", "Follow", this.follow, (cx) => {
            this.follow = !this.follow;
            if (this.follow) this.scroll.scroll_to_bottom();
            cx.notify();
          }))
          .child(div().id("dl-copy").px(10).py(4).rounded(6).text_size(11.5).cursor_pointer()
            .text_color(nSel ? t.solid_foreground : t.dim).bg(nSel ? t.solid : t.raised)
            .on_click((_e, cx) => this.copy(cx))
            .child(nSel ? `Copy ${nSel} ⌘C` : "Copy")),
      )
      // entries
      .child(
        div().id("dl-area").flex_1().min_h(0).relative().font_family(font)
          .on_size_change((size, cx) => {
            const w = size.width / (settings().zoom ?? 1);
            if (Math.abs(w - this.width) >= 1) { this.width = w; cx.notify(); }
          })
          .on_scroll_wheel((e, cx) => {
            if (e.delta.y > 0 && this.follow) { this.follow = false; cx.notify(); } // scrolled up: stop following
          })
          .child(body)
          .child(Scrollbar.vertical("dl-rows").absolute().inset_0()),
      )
      // status
      .child(
        h_flex().flex_none().h(26).px(12).gap(10).items_center().border_t(1).border_color(t.border).bg(t.chrome)
          .text_size(11).text_color(t.dim)
          .child(div().flex_1().truncate().when(!!this.note, (d) => d.text_color(this.note.error ? t.ansi1 : t.ansi2))
            .child(this.note ? this.note.text : nSel
              ? `${nSel} selected · ⌘C copy · Esc clear`
              : "Click to select · ⇧-click range · ⌘-click add/remove · ⌘A all"))
          .child(div().child(this.follow ? "following" : "paused · End to follow")),
      );
  }
}
