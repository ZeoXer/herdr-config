// Docker quick switcher: a popup (⌘⇧D) to find a container and act on it.
// Type to filter, ↑/↓ to choose, Enter opens its logs in a new full-size tab
// (⌘W closes it): the docker-logs viewer, the only log view. ⌘E shell, ⌘S start/stop, ⌘R restart, ⌘O the full dashboard
// (the docker-dash TUI in a new tab). Esc closes. Nothing here removes anything.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { exec, run, theme, props, closeOverlay, notify, home, checking } from "herdr";

const ROW = 34;
const LIST_MAX = 380;
const SHELL = "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi";
const DASHBOARD = () => `${home()}/herdr-plugins/docker-dash/bin/herdr-docker`;

function exitCode(status) {
  const m = /Exited \((\d+)\)/.exec(status ?? "");
  return m ? Number(m[1]) : null;
}

function label(labels, key) {
  for (const part of (labels ?? "").split(",")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === key) return part.slice(i + 1);
  }
  return "";
}

export default class DockerQuick extends View {
  init(_props, cx) {
    this.filter = "";
    this.at = 0;
    this.items = null; // null until the first load
    this.error = "";
    this.message = null; // { text, level }
    this.busy = null; // container name being acted on
    this.context = "";
    this.scroll = ScrollHandle.new();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Find a container…" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value();
      this.at = 0;
      cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.logs(this.selected(), cx));
    this.input.focus();
    cx.timer.after(400, () => this.input.focus());
    if (checking()) return;
    this.load(cx);
    cx.timer.every(2000, (cx) => this.load(cx));
    cx.spawn(async (cx) => {
      try {
        const r = await exec("docker", ["context", "show"], { timeout: 5000 });
        if (r.code === 0) this.context = r.stdout.trim();
      } catch {}
      cx.notify();
    });
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("docker", ["ps", "-a", "--format", "{{json .}}"], { timeout: 10000 });
        if (r.code !== 0) {
          this.error = (r.stderr || "docker ps failed").trim();
        } else {
          this.error = "";
          this.items = r.stdout.split("\n").filter(Boolean).map((line) => {
            const c = JSON.parse(line);
            return {
              id: c.ID, name: c.Names, image: c.Image, state: c.State, status: c.Status,
              project: label(c.Labels, "com.docker.compose.project"),
            };
          });
          const rank = (c) => (c.state === "running" ? 0 : c.state === "restarting" || c.state === "paused" ? 1 : 2);
          this.items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
        }
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        this.loading = false;
      }
      cx.notify();
    });
  }

  shown() {
    const f = this.filter.toLowerCase();
    const all = this.items ?? [];
    return f ? all.filter((c) => `${c.name} ${c.image} ${c.project} ${c.state}`.toLowerCase().includes(f)) : all;
  }

  selected() {
    return this.shown()[this.at];
  }

  close() {
    closeOverlay(props().overlay);
  }

  // Opens argv in a new tab (the whole work area), after the popup closes.
  open(name, argv, what) {
    this.close();
    try {
      run("tab.new", { name, argv });
    } catch (e) {
      notify({ title: `Couldn't open ${what}`, body: String(e?.message ?? e), level: "error" });
    }
  }

  // The docker-logs viewer: entries you can select and copy.
  logs(c) {
    if (!c) return;
    this.close();
    run("tab.new", { name: `logs: ${c.name}`, mod: "docker-logs", props: { container: c.name } });
  }

  shell(c, cx) {
    if (!c) return;
    if (c.state !== "running") {
      this.message = { text: `${c.name} isn't running`, level: "error" };
      cx?.notify();
      return;
    }
    this.open(`shell: ${c.name}`, ["docker", "exec", "-it", c.name, "sh", "-c", SHELL], `a shell in ${c.name}`);
  }

  dashboard() {
    this.close();
    run("tab.new", { name: "Docker", argv: [DASHBOARD()] });
  }

  act(c, verb, cx) {
    if (!c || this.busy) return;
    this.busy = c.name;
    this.message = { text: `${verb} ${c.name}…`, level: "info" };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("docker", [verb, c.name], { timeout: 60000 });
        this.message = r.code === 0
          ? { text: `${verb}: ${c.name} ✓`, level: "ok" }
          : { text: (r.stderr || `${verb} failed`).trim(), level: "error" };
      } catch (e) {
        this.message = { text: String(e?.message ?? e), level: "error" };
      } finally {
        this.busy = null;
      }
      this.load(cx);
      cx.notify();
    });
  }

  toggle(c, cx) {
    if (!c) return;
    this.act(c, c.state === "running" ? "stop" : "start", cx);
  }

  dot(t, c) {
    let color = t.dim;
    if (c.state === "running") color = t.ansi2;
    else if (c.state === "restarting" || c.state === "paused") color = t.ansi3;
    else if ((exitCode(c.status) ?? 0) !== 0 || c.state === "dead") color = t.ansi1;
    return div().w(12).flex_none().text_color(color).child(c.state === "running" ? "●" : c.state === "exited" ? "■" : "◐");
  }

  button(t, id, text, onClick) {
    return div()
      .id(id)
      .px(8)
      .py(3)
      .rounded(6)
      .text_size(11.5)
      .text_color(t.foreground)
      .bg(t.raised)
      .cursor_pointer()
      .hover((s) => s.bg(t.selected))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => onClick(cx))
      .child(text);
  }

  row(t, c, i, sel) {
    const on = c === sel;
    const busy = this.busy === c.name;
    const code = exitCode(c.status);
    return h_flex()
      .id(`dq-${c.id}`)
      .mx(4)
      .px(10)
      .h(ROW)
      .flex_none()
      .rounded(7)
      .gap(10)
      .items_center()
      .cursor_pointer()
      .when(on, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover))
      .on_click((e, cx) => {
        this.at = i;
        if (e.click_count >= 2) this.logs(c);
        cx.notify();
      })
      .child(this.dot(t, c))
      .child(
        h_flex().flex_1().min_w(0).gap(8).items_center()
          .child(div().truncate().text_color(t.foreground).font_semibold().child(c.name))
          .when(!!c.project, (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.raised).text_size(10.5).text_color(t.muted).child(c.project)))
          .child(div().truncate().text_size(11.5).text_color(t.dim).child(c.image)),
      )
      .when(busy, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(on && !busy, (el) =>
        el.child(
          h_flex().flex_none().gap(4)
            .child(this.button(t, "dq-logs", "Logs", () => this.logs(c)))
            .when(c.state === "running", (b) => b.child(this.button(t, "dq-shell", "Shell", (cx) => this.shell(c, cx))))
            .child(this.button(t, "dq-toggle", c.state === "running" ? "Stop" : "Start", (cx) => this.toggle(c, cx)))
            .child(this.button(t, "dq-restart", "Restart", (cx) => this.act(c, "restart", cx))),
        ))
      .when(!on, (el) =>
        el.child(div().flex_none().text_size(11.5).text_color(code ? t.ansi1 : t.dim).child(c.status)));
  }

  render() {
    const t = theme();
    const list = this.shown();
    this.at = Math.max(0, Math.min(this.at, list.length - 1));
    const sel = list[this.at];
    const height = Math.min(LIST_MAX, Math.max(ROW, list.length * ROW));
    const msgColor = { info: t.muted, ok: t.ansi2, error: t.ansi1 };

    let body;
    if (this.error) {
      body = div().px(10).py(12).text_color(t.ansi1).child(`Docker isn't reachable: ${this.error}`);
    } else if (this.items === null) {
      body = div().px(10).py(12).text_color(t.dim).child("Loading containers…");
    } else if (!list.length) {
      body = div().px(10).py(12).text_color(t.dim).child(this.filter ? "No container matches." : "No containers.");
    } else {
      body = v_flex()
        .id("dq-list")
        .h(height)
        .min_h(0)
        .overflow_y_scrollbar()
        .track_scroll(this.scroll)
        .children(list.map((c, i) => this.row(t, c, i, sel)));
    }

    return v_flex()
      .id("docker-quick")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        // ⌘ on macOS; ⌃ keeps working too
        const ctrl = e.modifiers.platform || e.modifiers.control;
        if (k === "escape") return this.close();
        if (k === "down" && list.length) this.at = (this.at + 1) % list.length;
        else if (k === "up" && list.length) this.at = (this.at + list.length - 1) % list.length;
        else if (ctrl && k === "e") this.shell(sel, cx);
        else if (ctrl && k === "s") this.toggle(sel, cx);
        else if (ctrl && k === "r") this.act(sel, "restart", cx);
        else if (ctrl && k === "o") this.dashboard();
        else return;
        if (k === "down" || k === "up") this.scroll.scroll_to_item(this.at);
        cx.stop_propagation();
        cx.notify();
      })
      .child(
        h_flex().items_center().gap(8)
          .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Docker"))
          .when(!!this.context, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(this.context)))
          .child(div().flex_1())
          .child(div().id("dq-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc")),
      )
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(body)
      .child(
        h_flex().items_center().gap(10).pt(4).border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
          .child(div().flex_1().truncate().when(!!this.message, (d) => d.text_color(msgColor[this.message.level])).child(
            this.message ? this.message.text : "↵ logs · ⌘E shell · ⌘S start/stop · ⌘R restart",
          ))
          .child(div().id("dq-dashboard").px(8).py(3).rounded(6).text_color(t.muted).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click(() => this.dashboard())
            .child("Full dashboard ⌘O")),
      );
  }
}
