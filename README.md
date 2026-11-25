# herdr-config

我的 Herdr 桌面 app mods，包含在開發過程中常用到的一些實用小工具。

| Mod | 快捷鍵 | 做什麼 |
|---|---|---|
| `docker-quick` | ⌘⇧D | 彈出視窗搜尋 container：Enter 看 log、⌘E 開 shell、⌘S 啟動/停止、⌘R 重啟、⌘O 開完整的 docker-dash |
| `docker-logs` | （由 docker-quick 開啟） | 以分頁顯示 container log，stack trace 合併成一筆，可點選、多選、⌘C 複製，可切換自動換行 |
| `docker-watch` | （背景執行） | container crash、OOM、unhealthy 時跳通知，點通知直接開 log；手動 stop/restart 不會通知 |
| `git-links` | ⌘⇧G | 依目前 pane 所在的 git repo，一鍵打開 repo / branch / 資料夾 / commit / PR / issues / CI 網頁；支援 GitHub、GitLab、Bitbucket、Gitea |
| `agent-usage` | （側邊欄區塊） | 顯示 agent 剩餘用量：Claude 訂閱的 5 小時 / 7 天額度剩餘 % 與重置倒數、每個 Claude agent 的 context 剩餘；Codex 的方案額度；Antigravity 各模型群組（Gemini、Claude/GPT）的 5 小時 / 每週額度。每個 provider 和 agent 都有原生 icon，點 agent 跳過去 |
| `docker-dash/` | ⌘O（從 docker-quick） | Go + Bubble Tea 寫的 Docker TUI：containers / images / volumes / networks、compose 分組、CPU/MEM、prune |

需求：macOS 上的 Herdr app、Docker、Go 1.27+（編譯 docker-dash 用）。

## 安裝

```sh
git clone https://github.com/ZeoXer/herdr-config ~/herdr-config
cd ~/herdr-config
./install.sh                 # 全部 mod，並編譯 docker-dash
./install.sh git-links       # 只裝指定的 mod
```

`install.sh` 會把 `mods/<name>` 用 symlink 接到 `~/.config/herdr-app/mods/<name>`。Herdr 會 hot reload，不用重開。原本已有的同名資料夾會改名成 `.bak-<時間>`。

repo 可以 clone 在任何位置。如果之後搬動了 repo，symlink 會斷掉，在新位置重跑一次 `./install.sh` 就會重新接上。

然後在 `~/.config/herdr-app/keys.json` 的 `"global"` 加上想要的快捷鍵：

```json
"cmd-shift-d": "mod.open:docker-quick",
"cmd-shift-g": "mod.open:git-links"
```

### docker-watch 要放進 layout

`docker-watch` 是不可見的浮動區塊，需要在你使用的 layout（`~/.config/herdr-app/layouts/*.json`）最外層的 `floating` 裡加上：

```json
"floating": [
  { "id": "docker-watch", "content": { "mod": "docker-watch" }, "edge": "bottom", "align": "end" }
]
```

內建 layout 會被 Herdr 更新覆蓋，請先複製一份再改：`herdr-app do layout.clone '{"name":"main","as":"my-main"}'`。

### agent-usage 要接上 Claude Code 的 status line 並放進 layout

Claude 的額度資料來自 Claude Code 的 status line 輸入。在 `~/.claude/settings.json` 加上：

```json
"statusLine": { "type": "command", "command": "sh ~/herdr-config/mods/agent-usage/claude-statusline.sh" }
```

它會把資料寫到 `~/.cache/herdr-agent-usage/claude/`，並照常印出一行 status（`Opus · ctx 37% · 5h 23% · 7d 41%`）。原本已有 status line 的話，把那個指令放進環境變數 `AGENT_USAGE_NEXT`，畫面上就會顯示原本的。資料在 Claude 每次回應時更新，所以閒置太久會顯示「X ago」。Codex 則直接讀 `~/.codex/sessions` 最新的 log；Antigravity 執行 `agy -p /usage --output-format json`（不呼叫模型、不耗 token，有 agy agent 時每 3 分鐘、否則每 15 分鐘一次），兩者都不用設定。

再在 layout 的側邊欄（例如 `sidebar-lists` column）加一個 block：

```json
{ "id": "usage", "type": "block", "content": { "mod": "agent-usage" }, "size": { "weight": 1 }, "min": 120 }
```

### docker-dash 設定（選用）

```sh
mkdir -p ~/.config/docker-dash && cp docker-dash/config.example.toml ~/.config/docker-dash/config.toml
```

