// mobile-preview: a popup (⌘⇧E) to preview frontend services deployed with berth
// (and active local dev servers) inside a realistic floating device bezel
// (phones, tablets and desktops; see DEVICES). Enter launches the native
// device preview window; when closed, focus automatically returns to Herdr.
// 1..9, 0 switch devices; ⌘R toggles landscape. Esc closes.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import {
  exec,
  theme,
  props,
  closeOverlay,
  home,
  checking,
  shared,
  setShared,
} from "herdr";

// berth is found by name: $BERTH_BIN, else `berth` on the login shell's PATH (e.g. ~/.local/bin).
const FIND_BERTH = 'b="${BERTH_BIN:-$(command -v berth)}"; [ -x "$b" ] || b="$HOME/.local/bin/berth"; [ -x "$b" ] && printf %s "$b"';
const DEVICE_PREVIEW = () => `${home()}/herdr-plugins/device-preview/bin/device-preview`;
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROW = 34;
const HEAD = 28;
const MIN_H = 180;
const MAX_H = 540;
const STATE_KEY = "mobile-preview.state";

// Must match DEVICES in device-preview/main.swift (`device-preview --list`).
const DEVICES = [
  { id: "iphone-se", name: "iPhone SE", short: "SE", w: 375, h: 667 },
  { id: "iphone-17-pro", name: "iPhone 17 Pro", short: "17 Pro", w: 402, h: 874 },
  { id: "iphone-17-pro-max", name: "iPhone 17 Pro Max", short: "Pro Max", w: 440, h: 956 },
  { id: "galaxy-s25", name: "Galaxy S25", short: "Galaxy", w: 360, h: 780 },
  { id: "pixel-8", name: "Pixel 8", short: "Pixel", w: 412, h: 915 },
  { id: "ipad-mini", name: "iPad mini", short: "mini", w: 744, h: 1133 },
  { id: "ipad-air", name: "iPad Air 11″", short: "Air", w: 820, h: 1180 },
  { id: "ipad-pro", name: "iPad Pro 13″", short: "Pro 13″", w: 1032, h: 1376 },
  { id: "desktop", name: "MacBook Air 13″", short: "Mac", w: 1470, h: 956, fixed: true },
  { id: "monitor", name: "Desktop 1080p", short: "1080p", w: 1920, h: 1080, fixed: true },
];
const DEVICE_ALIASES = { "iphone-16": "iphone-17-pro" };
const indexOfDevice = (id) => {
  const i = DEVICES.findIndex((d) => d.id === (DEVICE_ALIASES[id] ?? id));
  return i < 0 ? 1 : i;
};

export default class MobilePreview extends View {
  init(_props, cx) {
    const saved = shared(STATE_KEY) || {};
    // Saved by id (older saves kept an index into a shorter list).
    this.deviceIndex = saved.deviceId ? indexOfDevice(saved.deviceId) : 1;
    this.landscape = saved.landscape ?? false;
    this.projects = null; // null until the first load
    this.localDevs = [];
    this.error = "";
    this.message = null; // { text, level }
    this.at = 0; // selected row index in shownRows()
    this.previewing = false;
    this.scroll = ScrollHandle.new();
    this.handle = cx.focus_handle();

    this.input = InputState.new({ placeholder: "Filter frontend services…" });
    this.input.on("change", (_e, cx) => {
      this.at = 0;
      cx.notify();
    });
    this.input.on("submit", (_e, cx) => {
      const rows = this.shownRows();
      if (rows[this.at]) this.preview(rows[this.at], cx);
    });
    this.input.focus();
    cx.timer.after(400, () => this.input.focus());

    if (checking()) return;
    this.load(cx);
    cx.timer.every(4000, (cx) => this.load(cx));
  }

  saveState() {
    setShared(STATE_KEY, {
      deviceId: this.currentDevice().id,
      landscape: this.landscape,
    });
  }

  currentDevice() {
    return DEVICES[this.deviceIndex] || DEVICES[0];
  }

  currentDimensions() {
    const d = this.currentDevice();
    let w = d.w;
    let h = d.h;
    if (this.landscape && !d.fixed) [w, h] = [h, w];
    return { w, h };
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        if (this.berth === undefined) {
          const r = await exec("sh", ["-lc", FIND_BERTH], { timeout: 5000 }).catch(() => null);
          this.berth = r?.stdout.trim() || null;
        }
        if (!this.berth) this.error = "not on your PATH (or set BERTH_BIN)";
        const [berthRes, lsofRes] = await Promise.all([
          this.berth ? exec(this.berth, ["status", "--json"], { timeout: 15000 }).catch(() => null) : null,
          exec("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n"], { timeout: 3000 }).catch(() => null),
        ]);

        if (berthRes && berthRes.code === 0) {
          try {
            const data = JSON.parse(berthRes.stdout);
            this.projects = data.projects || [];
            this.error = "";
          } catch (e) {
            this.error = "Failed to parse berth output";
          }
        } else if (berthRes) {
          this.error = (berthRes.stderr || "berth status failed").trim();
        }

        // Also detect standalone local dev servers (3000, 5173, etc.)
        const local = [];
        if (lsofRes && lsofRes.code === 0) {
          const common = [3000, 5173, 8080, 8000, 4321, 3001];
          for (const p of common) {
            if (lsofRes.stdout.includes(`:${p} `) || lsofRes.stdout.includes(`:${p}\n`)) {
              local.push({
                project: "local dev",
                service: `port ${p}`,
                url: `http://localhost:${p}`,
                state: "running",
                isLocal: true,
              });
            }
          }
        }
        this.localDevs = local;
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        this.loading = false;
      }
      cx.notify();
    });
  }

  // All selectable rows: berth app services + active local dev servers
  allRows() {
    const rows = [];
    for (const p of this.projects ?? []) {
      for (const s of p.services ?? []) {
        // Frontends are app services that have a public URL
        if (s.kind === "app" && !!s.public_url) {
          rows.push({
            project: p.name,
            service: s.service,
            url: s.public_url,
            state: s.state,
            raw: s,
          });
        }
      }
    }
    for (const l of this.localDevs) {
      rows.push(l);
    }
    return rows;
  }

  shownRows() {
    const filter = this.input.value().trim().toLowerCase();
    const rows = this.allRows();
    if (!filter) return rows;
    return rows.filter((r) =>
      r.project.toLowerCase().includes(filter) ||
      r.service.toLowerCase().includes(filter) ||
      r.url.toLowerCase().includes(filter)
    );
  }

  close() {
    closeOverlay(props().overlay);
  }

  preview(row, cx) {
    if (!row?.url || this.previewing) return;
    this.previewing = true;
    this.close();

    const d = this.currentDevice();
    const args = [
      "--url", row.url,
      "--device", d.id,
      "--title", `${row.project}/${row.service}`,
    ];
    if (this.landscape && !d.fixed) args.push("--landscape");

    cx.spawn(async () => {
      try {
        await exec(DEVICE_PREVIEW(), args, { timeout: 600000 });
      } catch {
        // Fallback to Chrome App Mode if device-preview binary isn't built
        const { w, h } = this.currentDimensions();
        const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
        const profileDir = `${home()}/.config/herdr-app/preview-profile`;
        try {
          await exec(CHROME_BIN, [
            `--app=${row.url}`,
            `--window-size=${w},${h}`,
            `--user-agent=${ua}`,
            `--user-data-dir=${profileDir}`,
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-sync",
          ]);
        } catch {
          await exec("open", [row.url]).catch(() => {});
        } finally {
          await exec("osascript", ["-e", 'tell application id "dev.herdr.app" to activate']).catch(() => {
            return exec("open", ["-b", "dev.herdr.app"]).catch(() => {});
          });
        }
      } finally {
        this.previewing = false;
      }
    });
  }

  openURL(row, cx) {
    if (!row?.url) return;
    cx.spawn(async () => {
      try {
        await exec("open", [row.url], { timeout: 5000 });
      } catch {}
    });
  }

  // ---------------------------------------------------------------- drawing

  badge(t, text, color) {
    return div()
      .flex_none()
      .px(6)
      .py(1)
      .rounded(4)
      .bg(t.raised)
      .text_size(10.5)
      .text_color(color)
      .child(text);
  }

  dot(t, state) {
    const color = state === "running" ? t.ansi2 : t.dim;
    return div()
      .w(12)
      .flex_none()
      .text_color(color)
      .child(state === "running" ? "●" : "■");
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
      .hover((st) => st.bg(t.selected))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => onClick(cx))
      .child(text);
  }

  serviceRow(t, row, i, selected) {
    const on = row === selected;
    return v_flex()
      .id(`mp-${row.project}-${row.service}`)
      .mx(4)
      .px(10)
      .py(6)
      .min_h(ROW)
      .flex_none()
      .rounded(7)
      .justify_center()
      .cursor_pointer()
      .when(on, (el) => el.bg(t.hover))
      .hover((st) => st.bg(t.hover))
      .on_click((e, cx) => {
        this.at = i;
        if (e.click_count >= 2) return this.preview(row, cx);
        this.input.focus(); // keep typing and Enter going to the search box
        cx.notify();
      })
      .child(
        h_flex()
          .gap(10)
          .items_center()
          .child(this.dot(t, row.state))
          .child(div().flex_none().text_color(t.foreground).font_semibold().child(row.service))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(row.url || ""))
          .child(this.badge(t, row.isLocal ? "local" : "berth", row.state === "running" ? t.ansi2 : t.dim))
          .when(on, (el) =>
            el.child(
              h_flex()
                .flex_none()
                .gap(4)
                .child(this.button(t, "mp-preview", "Preview", (cx) => this.preview(row, cx)))
                .child(this.button(t, "mp-open", "Open", (cx) => this.openURL(row, cx))),
            ),
          ),
      );
  }

  render() {
    const t = theme();
    const rows = this.shownRows();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const sel = rows[this.at];
    const cur = this.currentDevice();
    const { w, h } = this.currentDimensions();
    const msgColor = { info: t.muted, ok: t.ansi2, error: t.ansi1 };

    let body;
    let listH = 0;
    if (this.error && !rows.length) {
      body = div().px(10).py(12).text_color(t.ansi1).child(`berth isn't reachable: ${this.error}`);
    } else if (this.projects === null && !rows.length) {
      body = div().px(10).py(12).text_color(t.dim).child("Loading berth services…");
    } else if (!rows.length) {
      body = div()
        .px(10)
        .py(12)
        .text_color(t.dim)
        .child(this.input.value() ? "No frontend service matches." : "No frontend services found in berth or local dev.");
    } else {
      // Group rows by project
      const groups = {};
      for (const r of rows) {
        if (!groups[r.project]) groups[r.project] = [];
        groups[r.project].push(r);
      }

      const children = [];
      let i = 0;
      for (const [projectName, items] of Object.entries(groups)) {
        children.push(
          h_flex()
            .id(`mp-p-${projectName}`)
            .h(HEAD)
            .flex_none()
            .px(14)
            .gap(8)
            .items_center()
            .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(projectName)),
        );
        listH += HEAD;
        for (const r of items) {
          children.push(this.serviceRow(t, r, i, sel));
          listH += ROW + 2;
          i++;
        }
      }
      body = v_flex()
        .id("mp-list")
        .size_full()
        .min_h(0)
        .overflow_y_scrollbar()
        .track_scroll(this.scroll)
        .children(children);
    }

    return v_flex()
      .id("mobile-preview")
      .track_focus(this.handle)
      .w_full()
      .h(Math.max(MIN_H, Math.min(MAX_H, listH + 150)))
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        const ctrl = e.modifiers.platform || e.modifiers.control;
        if (k === "escape") return this.close();
        // Enter also works after a click took focus off the search box.
        if (k === "enter" && sel) {
          cx.stop_propagation();
          return this.preview(sel, cx);
        }
        if ((k === "down" || k === "up") && rows.length) {
          this.at = (this.at + (k === "down" ? 1 : rows.length - 1)) % rows.length;
          this.scroll.scroll_to_item(this.at);
        } else if (ctrl && k === "o" && sel) {
          this.openURL(sel, cx);
        } else if (ctrl && k === "r") {
          this.landscape = !this.landscape;
          this.saveState();
        } else if (k.length === 1 && k >= "0" && k <= "9" && (k === "0" ? 9 : +k - 1) < DEVICES.length) {
          this.deviceIndex = k === "0" ? 9 : parseInt(k, 10) - 1;
          this.saveState();
        } else {
          return;
        }
        cx.stop_propagation();
        cx.notify();
      })
      // Header: Title + Device pills + Esc
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(div().text_size(15).font_semibold().text_color(t.foreground).child("mobile preview"))
          .child(div().flex_1())
          // Device pills
          .child(
            h_flex()
              .gap(4)
              .items_center()
              .children(
                DEVICES.map((d, idx) => {
                  const on = idx === this.deviceIndex;
                  return div()
                    .id(`mp-dev-${d.id}`)
                    .px(5)
                    .py(2)
                    .rounded(4)
                    .text_size(11)
                    .cursor_pointer()
                    .bg(on ? t.accent : t.raised)
                    .text_color(on ? t.accent_foreground : t.muted)
                    .hover((st) => st.bg(on ? t.accent : t.selected))
                    .on_click((_e, cx) => {
                      this.deviceIndex = idx;
                      this.saveState();
                      this.input.focus();
                      cx.notify();
                    })
                    .child(d.short);
                }),
              )
              // Rotate orientation
              .child(
                div()
                  .id("mp-btn-rotate")
                  .px(6)
                  .py(2)
                  .rounded(4)
                  .text_size(11)
                  .cursor_pointer()
                  .bg(this.landscape ? t.accent : t.raised)
                  .text_color(this.landscape ? t.accent_foreground : t.muted)
                  .hover((st) => st.bg(this.landscape ? t.accent : t.selected))
                  .on_click((_e, cx) => {
                    this.landscape = !this.landscape;
                    this.saveState();
                    this.input.focus();
                    cx.notify();
                  })
                  .child(this.landscape ? "橫向" : "直向"),
              ),
          )
          // Esc button
          .child(
            div()
              .id("mp-esc")
              .px(6)
              .py(2)
              .rounded(5)
              .text_size(11)
              .text_color(t.dim)
              .cursor_pointer()
              .hover((st) => st.bg(t.hover).text_color(t.foreground))
              .on_click(() => this.close())
              .child("Esc"),
          ),
      )
      // Search / Filter Input
      .child(
        h_flex()
          .h(36)
          .flex_none()
          .px(10)
          .gap(8)
          .items_center()
          .rounded(9)
          .border_1()
          .border_color(t.accent)
          .bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      // List of Projects and Services
      .child(v_flex().flex_1().min_h(0).child(body))
      // Footer: shortcuts and device dimension indicator
      .child(
        h_flex()
          .items_center()
          .gap(10)
          .pt(4)
          .border_t(1)
          .border_color(t.border)
          .text_size(11)
          .text_color(t.dim)
          .child(
            div()
              .flex_1()
              .truncate()
              .when(!!this.message, (d) => d.text_color(msgColor[this.message.level]))
              .child(
                this.message
                  ? this.message.text
                  : "↵ preview · ⌘O open · ⌘R rotate · 1-9·0 device · ↑↓ choose",
              ),
          )
          .child(
            div()
              .flex_none()
              .text_color(t.muted)
              .child(`${w} × ${h} · ${cur.name}${this.landscape ? " (Landscape)" : ""}`),
          ),
      );
  }
}
