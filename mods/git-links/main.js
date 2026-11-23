// Git links: a popup (⌘⇧G) for the focused pane's repo. It reads the git remotes
// and offers the web pages that matter: repo, branch, this folder, commit, PRs,
// new PR, issues, CI. Each row has a letter key (R, B, F, …); ↑/↓ + Enter works
// too. ⌘C copies the URL instead of opening it. Tab / ←→ switches remote.
// Works for GitHub, GitLab, Bitbucket and Gitea/Forgejo/Codeberg; other hosts get
// the repo page. A space on another machine runs git there; the browser opens here.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, props, closeOverlay, notify, focused, spaces, window, checking, shared, setShared } from "herdr";

const ROW = 36;

// ---- remote URL → web URL -------------------------------------------------

// Returns { host, path } (path without leading slash or .git), or null.
function parseRemote(url) {
  url = url.trim();
  let m;
  // scheme://[user[:pass]@]host[:port]/path
  if ((m = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(url))) {
    if (m[1] === "file") return null;
    return { host: m[2].toLowerCase(), path: clean(m[3]), ssh: /ssh/i.test(m[1]) };
  }
  // scp-like: [user@]host:path
  if ((m = /^(?:[^@/]+@)?([^/:]+):(?!\/\/)(.+)$/.exec(url))) {
    return { host: m[1].toLowerCase(), path: clean(m[2]), ssh: true };
  }
  return null;
}

function clean(path) {
  return path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
}

function providerOf(host) {
  if (host === "github.com" || host.includes("github")) return "github";
  if (host.includes("gitlab")) return "gitlab";
  if (host === "bitbucket.org") return "bitbucket";
  if (/codeberg|gitea|forgejo/.test(host)) return "gitea";
  return "other";
}

// Self-hosted servers: ask the API what it is (GitLab answers /api/v4, Gitea and
// Forgejo /api/v1/version). Cached for the session in shared state.
const CACHE = "git-links.hosts";
async function probe(host) {
  const cache = shared(CACHE) ?? {};
  if (cache[host]) return cache[host];
  const code = async (path) => {
    const r = await exec("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "3", `https://${host}${path}`], { timeout: 5000 }).catch(() => null);
    return r?.stdout.trim() ?? "000";
  };
  const [gl, gt] = await Promise.all([code("/api/v4/version"), code("/api/v1/version")]);
  let found = "other";
  if (gl === "401" || gl === "200") found = "gitlab";
  else if (gt === "200") found = "gitea";
  // Don't cache "unreachable" (VPN off): try again next time.
  if (gl !== "000" || gt !== "000") setShared(CACHE, { ...cache, [host]: found });
  return found;
}

const PROVIDER_NAME = { github: "GitHub", gitlab: "GitLab", bitbucket: "Bitbucket", gitea: "Gitea", other: "Git" };

// Encodes each path segment but keeps the slashes (branches like feat/login).
const seg = (s) => s.split("/").map(encodeURIComponent).join("/");

function linksFor(remote, info) {
  const base = remote.web;
  const b = info.branch ? seg(info.branch) : null;
  const dir = info.prefix ? seg(info.prefix.replace(/\/$/, "")) : null;
  const sha = info.sha;
  const L = [];
  const add = (key, title, url, note) => url && L.push({ key, title, url, note });

  const p = remote.provider;
  add("r", "Repository", base);
  if (p === "github") {
    if (b) add("b", `Branch ${info.branch}`, `${base}/tree/${b}`);
    if (b && dir) add("f", `Folder ${info.prefix}`, `${base}/tree/${b}/${dir}`);
    if (sha) add("c", `Commit ${sha.slice(0, 7)}`, `${base}/commit/${sha}`);
    add("p", "Pull requests", `${base}/pulls`);
    if (b && !info.isDefault) add("n", "Pull request for this branch", `${base}/pull/new/${b}`);
    add("i", "Issues", `${base}/issues`);
    add("a", "Actions", b ? `${base}/actions?query=${encodeURIComponent(`branch:${info.branch}`)}` : `${base}/actions`);
  } else if (p === "gitlab") {
    if (b) add("b", `Branch ${info.branch}`, `${base}/-/tree/${b}`);
    if (b && dir) add("f", `Folder ${info.prefix}`, `${base}/-/tree/${b}/${dir}`);
    if (sha) add("c", `Commit ${sha.slice(0, 7)}`, `${base}/-/commit/${sha}`);
    add("p", "Merge requests", `${base}/-/merge_requests`);
    if (b && !info.isDefault) add("n", "Merge request for this branch", `${base}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(info.branch)}`);
    add("i", "Issues", `${base}/-/issues`);
    add("a", "Pipelines", b ? `${base}/-/pipelines?ref=${encodeURIComponent(info.branch)}` : `${base}/-/pipelines`);
  } else if (p === "bitbucket") {
    if (b) add("b", `Branch ${info.branch}`, `${base}/src/${b}`);
    if (b && dir) add("f", `Folder ${info.prefix}`, `${base}/src/${b}/${dir}`);
    if (sha) add("c", `Commit ${sha.slice(0, 7)}`, `${base}/commits/${sha}`);
    add("p", "Pull requests", `${base}/pull-requests`);
    if (b && !info.isDefault) add("n", "Pull request for this branch", `${base}/pull-requests/new?source=${encodeURIComponent(info.branch)}`);
    add("i", "Issues", `${base}/issues`);
    add("a", "Pipelines", `${base}/pipelines`);
  } else if (p === "gitea") {
    if (b) add("b", `Branch ${info.branch}`, `${base}/src/branch/${b}`);
    if (b && dir) add("f", `Folder ${info.prefix}`, `${base}/src/branch/${b}/${dir}`);
    if (sha) add("c", `Commit ${sha.slice(0, 7)}`, `${base}/commit/${sha}`);
    add("p", "Pull requests", `${base}/pulls`);
    if (b && !info.isDefault && info.defaultBranch) add("n", "Pull request for this branch", `${base}/compare/${seg(info.defaultBranch)}...${b}`);
    add("i", "Issues", `${base}/issues`);
    add("a", "Actions", `${base}/actions`);
  }
  return L;
}

// ---- the popup ---------------------------------------------------------------

export default class GitLinks extends View {
  init(_props, cx) {
    this.at = 0;
    this.state = "loading"; // loading | ready | norepo | noremote | error
    this.error = "";
    this.info = null;
    this.remotes = [];
    this.ri = 0;
    this.message = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
    if (checking()) {
      this.state = "noremote";
      return;
    }
    cx.spawn(async (cx) => {
      try {
        await this.load();
      } catch (e) {
        this.state = "error";
        this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  async load() {
    const f = focused();
    this.cwd = f?.cwd ?? null;
    const space = spaces().find((s) => s.id === f?.space);
    this.machine = space?.machine ?? null;
    if (!this.cwd) this.cwd = space?.folder ?? null;
    if (!this.cwd) {
      this.state = "norepo";
      return;
    }
    const git = (args) => exec("git", args, { cwd: this.cwd, on: this.machine, timeout: 8000 })
      .then((r) => (r.code === 0 ? r.stdout.trim() : null), () => null);

    const top = await git(["rev-parse", "--show-toplevel"]);
    if (top === null) {
      this.state = "norepo";
      return;
    }
    const [prefix, branch, sha, upstream, remoteV] = await Promise.all([
      git(["rev-parse", "--show-prefix"]),
      git(["branch", "--show-current"]),
      git(["rev-parse", "HEAD"]),
      git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
      git(["remote", "-v"]),
    ]);

    // Remotes, fetch URLs, upstream's remote first, then origin.
    const seen = new Map();
    for (const line of (remoteV ?? "").split("\n")) {
      const m = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
      if (m && !seen.has(m[1])) seen.set(m[1], m[2]);
    }
    const upRemote = upstream && [...seen.keys()].find((n) => upstream.startsWith(`${n}/`));
    const order = [...seen.keys()].sort((a, b) =>
      (b === upRemote) - (a === upRemote) || (b === "origin") - (a === "origin") || a.localeCompare(b));

    const remotes = [];
    for (const name of order) {
      const parsed = parseRemote(seen.get(name));
      if (!parsed) continue;
      let host = parsed.host;
      // ssh host aliases (e.g. "github-work"): ask ssh what they point to.
      if (parsed.ssh && providerOf(host) === "other" && !host.includes(".")) {
        const r = await exec("ssh", ["-G", host], { timeout: 4000 }).catch(() => null);
        const hn = r?.code === 0 && /^hostname (\S+)$/m.exec(r.stdout);
        if (hn) host = hn[1].toLowerCase();
      }
      // `git config --global herdr.<host>.provider gitlab` (github, gitlab, bitbucket, gitea) wins.
      let provider = (await git(["config", "--get", `herdr.${host}.provider`]))?.toLowerCase();
      if (!PROVIDER_NAME[provider]) provider = providerOf(host);
      if (provider === "other") provider = await probe(host);
      remotes.push({ name, url: seen.get(name), host, provider, path: parsed.path, web: `https://${host}/${parsed.path}` });
    }
    if (!remotes.length) {
      this.state = "noremote";
      this.top = top;
      return;
    }

    // Default branch of the main remote (for "is this the default branch" and Gitea compares).
    const main = remotes[0].name;
    const head = await git(["symbolic-ref", "--short", `refs/remotes/${main}/HEAD`]);
    const defaultBranch = head ? head.slice(main.length + 1) : null;

    // Link to the branch as the remote knows it (upstream may have another name).
    let remoteBranch = branch || null;
    let ahead = 0;
    if (upstream && upRemote) {
      remoteBranch = upstream.slice(upRemote.length + 1);
      ahead = Number(await git(["rev-list", "--count", "@{u}..HEAD"])) || 0;
    }
    this.info = {
      top, prefix: prefix || "", sha, localBranch: branch, branch: remoteBranch,
      upstream, upRemote, ahead, defaultBranch,
      isDefault: !!remoteBranch && remoteBranch === defaultBranch,
    };
    this.remotes = remotes;
    this.state = "ready";
  }

  remote() {
    return this.remotes[this.ri];
  }

  links() {
    const r = this.remote();
    if (!r || !this.info) return [];
    // A remote other than the upstream may not have this branch: still offer it.
    return linksFor(r, this.info);
  }

  close() {
    closeOverlay(props().overlay);
  }

  open(link) {
    if (!link) return;
    this.close();
    const opener = window().platform === "macos" ? ["open", [link.url]]
      : window().platform === "windows" ? ["cmd", ["/c", "start", "", link.url]]
      : ["xdg-open", [link.url]];
    exec(opener[0], opener[1], { timeout: 5000 }).then((r) => {
      if (r.code !== 0) notify({ title: "Couldn't open the browser", body: (r.stderr || link.url).trim(), level: "error" });
    }, (e) => notify({ title: "Couldn't open the browser", body: String(e?.message ?? e), level: "error" }));
  }

  copy(link, cx) {
    if (!link) return;
    const cmd = window().platform === "macos" ? 'printf %s "$1" | pbcopy'
      : 'printf %s "$1" | (wl-copy 2>/dev/null || xclip -selection clipboard 2>/dev/null || xsel -b)';
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", cmd, "sh", link.url], { timeout: 5000 });
        this.message = r.code === 0 ? { text: `Copied ${link.url}`, level: "ok" } : { text: "Couldn't copy", level: "error" };
      } catch (e) {
        this.message = { text: String(e?.message ?? e), level: "error" };
      }
      cx.notify();
    });
  }

  switchRemote(by) {
    if (this.remotes.length < 2) return;
    this.ri = (this.ri + by + this.remotes.length) % this.remotes.length;
    this.at = 0;
    this.message = null;
  }

  pill(t, id, text, on, onClick) {
    return div().id(id).px(8).py(2).rounded(6).text_size(11.5).cursor_pointer()
      .text_color(on ? t.accent_foreground : t.muted).bg(on ? t.accent : t.raised)
      .hover((s) => (on ? s : s.bg(t.selected).text_color(t.foreground)))
      .on_click((_e, cx) => { onClick(); cx.notify(); })
      .child(text);
  }

  row(t, link, i) {
    const on = i === this.at;
    return h_flex()
      .id(`gl-${link.key}`)
      .mx(2).px(10).h(ROW).flex_none().rounded(7).gap(10).items_center().cursor_pointer()
      .when(on, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.at = i; this.open(link); cx.notify(); })
      .child(div().w(20).h(20).flex_none().rounded(5).bg(t.raised).border_1().border_color(t.border)
        .flex().items_center().justify_center().text_size(11).font_semibold().text_color(t.muted)
        .child(link.key.toUpperCase()))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_color(t.foreground).child(link.title))
        .child(div().truncate().text_size(11).text_color(t.dim).child(link.url.replace(/^https:\/\//, ""))))
      .when(on, (el) => el.child(div().id("gl-copy").flex_none().px(8).py(3).rounded(6).text_size(11.5)
        .text_color(t.foreground).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.selected))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.copy(link, cx); })
        .child("Copy")));
  }

  render() {
    const t = theme();
    const links = this.links();
    this.at = Math.max(0, Math.min(this.at, links.length - 1));
    const sel = links[this.at];
    const r = this.remote();
    const info = this.info;
    const msgColor = { info: t.muted, ok: t.ansi2, error: t.ansi1 };

    let body;
    if (this.state === "loading") {
      body = div().px(10).py(12).text_color(t.dim).child("Reading git…");
    } else if (this.state === "norepo") {
      body = div().px(10).py(12).text_color(t.dim).child(`Not a git repository: ${this.cwd ?? "no folder"}`);
    } else if (this.state === "noremote") {
      body = div().px(10).py(12).text_color(t.dim).child(`${this.top ?? "This repo"} has no remote with a web page.`);
    } else if (this.state === "error") {
      body = div().px(10).py(12).text_color(t.ansi1).child(this.error);
    } else {
      body = v_flex().gap(1)
        .when(r.provider === "other", (el) => el.child(div().px(10).pb(6).text_size(11.5).text_color(t.dim)
          .child(`Unknown host. For more links: git config --global herdr.${r.host}.provider gitlab`))).children(links.map((l, i) => this.row(t, l, i)));
    }

    // Branch status line: upstream, ahead, or not pushed.
    let status = null;
    if (info) {
      if (!info.localBranch) status = { text: `detached at ${info.sha?.slice(0, 7)}`, color: t.ansi3 };
      else if (!info.upstream) status = { text: `${info.localBranch} · not pushed`, color: t.ansi3 };
      else if (info.ahead) status = { text: `${info.localBranch} · ${info.ahead} unpushed`, color: t.ansi3 };
      else status = { text: `${info.localBranch} → ${info.upstream}`, color: t.dim };
    }

    return v_flex()
      .id("git-links")
      .track_focus(this.handle)
      .w_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        const mod = e.modifiers.platform || e.modifiers.control;
        if (k === "escape") return this.close();
        if (k === "down" && links.length) this.at = (this.at + 1) % links.length;
        else if (k === "up" && links.length) this.at = (this.at + links.length - 1) % links.length;
        else if (k === "enter") this.open(sel);
        else if (mod && k === "c") this.copy(sel, cx);
        else if (k === "tab" || k === "right") this.switchRemote(e.modifiers.shift ? -1 : 1);
        else if (k === "left") this.switchRemote(-1);
        else if (!mod && k.length === 1) {
          const l = links.find((x) => x.key === k.toLowerCase());
          if (!l) return;
          if (e.modifiers.shift) { this.at = links.indexOf(l); this.copy(l, cx); }
          else this.open(l);
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(
        h_flex().items_center().gap(8)
          .child(div().text_size(15).font_semibold().text_color(t.foreground).truncate()
            .child(r ? r.path : "Git links"))
          .when(!!r, (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.raised).text_size(10.5).text_color(t.muted)
            .child(r.provider === "other" ? r.host : PROVIDER_NAME[r.provider])))
          .child(div().flex_1())
          .child(div().id("gl-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc")),
      )
      .when(!!status || this.remotes.length > 1, (el) => el.child(
        h_flex().items_center().gap(6).text_size(11.5)
          .when(!!status, (d) => d.child(div().flex_1().truncate().text_color(status.color).child(status.text)))
          .when(this.remotes.length > 1, (d) => d.children(this.remotes.map((x, i) =>
            this.pill(t, `gl-remote-${i}`, x.name, i === this.ri, () => { this.ri = i; this.at = 0; this.message = null; })))),
      ))
      .child(body)
      .child(
        h_flex().items_center().pt(6).border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
          .child(div().flex_1().truncate().when(!!this.message, (d) => d.text_color(msgColor[this.message.level])).child(
            this.message ? this.message.text
              : `letter / ↵ open · ⇧letter / ⌘C copy${this.remotes.length > 1 ? " · ⇥ remote" : ""}`)),
      );
  }
}
