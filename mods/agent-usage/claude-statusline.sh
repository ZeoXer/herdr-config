#!/bin/sh
# Claude Code status line that also feeds the agent-usage mod.
#
# Claude Code hands its status line a JSON blob with the subscription's
# rate limits (5-hour and 7-day windows) and this session's context window.
# This saves it to ~/.cache/herdr-agent-usage/claude/<terminal>.json, keyed by
# the Herdr terminal (HC_TERMINAL_ID), so the mod can show each agent's context
# and the account's remaining limits. It prints a one-line status as usual.
#
# Install: in ~/.claude/settings.json
#   "statusLine": { "type": "command", "command": "sh <repo>/mods/agent-usage/claude-statusline.sh" }
# To keep your own status line too, set AGENT_USAGE_NEXT to its command:
# it gets the same input and its output is printed instead of ours.

input="$(cat)"
printf '%s' "$input" | HC_TERMINAL_ID="${HC_TERMINAL_ID:-}" python3 -c '
import json, os, sys, time, tempfile
try:
    d = json.loads(sys.stdin.read() or "{}")
except Exception:
    d = {}
base = os.path.join(os.path.expanduser("~"), ".cache", "herdr-agent-usage", "claude")
os.makedirs(base, exist_ok=True)
now = int(time.time())
term = os.environ.get("HC_TERMINAL_ID") or ""
sid = d.get("session_id") or ""
ctx = d.get("context_window") or {}
rec = {
    "at": now,
    "terminal": term,
    "session_id": sid,
    "cwd": (d.get("workspace") or {}).get("current_dir") or d.get("cwd"),
    "model": (d.get("model") or {}).get("display_name"),
    "context": {
        "used_percentage": ctx.get("used_percentage"),
        "remaining_percentage": ctx.get("remaining_percentage"),
        "input_tokens": ctx.get("total_input_tokens"),
        "size": ctx.get("context_window_size"),
    },
    "rate_limits": d.get("rate_limits"),
    "cost_usd": (d.get("cost") or {}).get("total_cost_usd"),
}
def save(name, obj):
    fd, tmp = tempfile.mkstemp(dir=base, prefix=".tmp-")
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f)
    os.replace(tmp, os.path.join(base, name))
key = term or ("s-" + sid[:12] if sid else "")
if key:
    save(key + ".json", rec)
if rec["rate_limits"]:
    save("_account.json", {"at": now, "rate_limits": rec["rate_limits"]})
# Forget terminals not heard from in two days.
for n in os.listdir(base):
    p = os.path.join(base, n)
    try:
        if n.endswith(".json") and not n.startswith("_") and now - os.path.getmtime(p) > 172800:
            os.remove(p)
    except OSError:
        pass
def pct(x):
    return "%d%%" % round(x) if isinstance(x, (int, float)) else "?"
parts = [rec["model"] or "Claude"]
if ctx.get("used_percentage") is not None:
    parts.append("ctx " + pct(ctx["used_percentage"]))
rl = rec["rate_limits"] or {}
for k, label in (("five_hour", "5h"), ("seven_day", "7d")):
    if rl.get(k):
        parts.append(label + " " + pct(rl[k].get("used_percentage")))
print(" · ".join(parts))
' 2>/dev/null > "${TMPDIR:-/tmp}/agent-usage-line.$$" || true
if [ -n "${AGENT_USAGE_NEXT:-}" ]; then
  printf '%s' "$input" | sh -c "$AGENT_USAGE_NEXT"
else
  cat "${TMPDIR:-/tmp}/agent-usage-line.$$"
fi
rm -f "${TMPDIR:-/tmp}/agent-usage-line.$$"
