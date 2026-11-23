// Docker watch: an invisible floating block that posts a notification when a
// container crashes (exits non-zero on its own), is OOM-killed, or turns
// unhealthy. Clicking the notification opens that container's logs in a new tab.
// Stops you asked for (docker stop / restart / rm, which send a kill first)
// stay quiet. Polls `docker events` every few seconds; it draws nothing.

import { View } from "gpui-kit";
import { exec, notify, checking } from "herdr";

const POLL_MS = 4000;
const QUIET_AFTER_KILL_S = 30; // a die this soon after a kill was asked for
const REPEAT_S = 60; // at most one notification per container per minute

export default class DockerWatch extends View {
  init(_props, cx) {
    this.since = Math.floor(Date.now() / 1000);
    this.seen = new Set(); // event keys, since windows share a boundary second
    this.killedAt = {}; // container id -> unix seconds of the last kill/stop
    this.lastSent = {}; // container name -> unix seconds
    if (checking()) return;
    cx.timer.every(POLL_MS, (cx) => this.poll(cx));
  }

  poll(cx) {
    if (this.busy) return;
    this.busy = true;
    const until = Math.floor(Date.now() / 1000);
    cx.spawn(async () => {
      try {
        const r = await exec("docker", [
          "events", "--since", String(this.since), "--until", String(until),
          "--filter", "type=container", "--format", "{{json .}}",
        ], { timeout: 20000 });
        if (r.code === 0) {
          this.since = until;
          this.handle(r.stdout);
        }
      } catch (e) {
        // docker not running: try again next tick
      } finally {
        this.busy = false;
      }
    });
  }

  handle(stdout) {
    const events = stdout.split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    events.sort((a, b) => (a.timeNano ?? 0) - (b.timeNano ?? 0));
    for (const e of events) {
      const key = `${e.timeNano}:${e.Actor?.ID}:${e.Action}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.event(e);
    }
    if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-500));
  }

  event(e) {
    const a = e.Action ?? "";
    const id = e.Actor?.ID ?? ""; // Docker 29 dropped the old top-level "id"
    const attrs = e.Actor?.Attributes ?? {};
    const name = attrs.name ?? id.slice(0, 12);
    const t = e.time ?? Math.floor(Date.now() / 1000);
    if (a === "kill" || a === "stop" || a === "destroy") {
      this.killedAt[id] = t;
    } else if (a === "oom") {
      this.send(name, t, "error", `${name} ran out of memory`, "The kernel killed it (OOM).");
    } else if (a === "die") {
      const code = Number(attrs.exitCode ?? 0);
      const asked = t - (this.killedAt[id] ?? -Infinity) < QUIET_AFTER_KILL_S;
      if (code !== 0 && !asked) {
        this.send(name, t, "error", `${name} crashed`, `Exited with code ${code}. Click to open its logs.`);
      }
    } else if (a.startsWith("health_status") && a.includes("unhealthy")) {
      this.send(name, t, "warning", `${name} is unhealthy`, "Its health check is failing. Click to open its logs.");
    }
  }

  send(name, t, level, title, body) {
    if (t - (this.lastSent[name] ?? -Infinity) < REPEAT_S) return;
    this.lastSent[name] = t;
    notify({
      title, body, level,
      action: { name: "tab.new", args: { name: `logs: ${name}`, mod: "docker-logs", props: { container: name } } },
    });
  }

  render() {
    return ""; // nothing to show: the floating block collapses
  }
}
