# herdr-config

我的 Herdr 桌面 app mods，包含在開發過程中常用到的一些實用小工具。

| Mod | 快捷鍵 | 做什麼 |
|---|---|---|
| `docker-quick` | ⌘⇧D | 彈出視窗搜尋 container：Enter 看 log、⌘E 開 shell、⌘S 啟動/停止、⌘R 重啟、⌘O 開完整的 docker-dash |
| `docker-logs` | （由 docker-quick 開啟） | 以分頁顯示 container log，stack trace 合併成一筆，可點選、多選、⌘C 複製，可切換自動換行 |
| `docker-watch` | （背景執行） | container crash、OOM、unhealthy 時跳通知，點通知直接開 log；手動 stop/restart 不會通知 |
| `git-links` | ⌘⇧G | 依目前 pane 所在的 git repo，一鍵打開 repo / branch / 資料夾 / commit / PR / issues / CI 網頁；支援 GitHub、GitLab、Bitbucket、Gitea |
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

### docker-dash 設定（選用）

```sh
mkdir -p ~/.config/docker-dash && cp docker-dash/config.example.toml ~/.config/docker-dash/config.toml
```

