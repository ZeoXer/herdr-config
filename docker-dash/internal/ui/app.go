// Package ui is the Bubble Tea front end of the dashboard.
package ui

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"

	"github.com/andrew/herdr-docker-dash/internal/config"
	"github.com/andrew/herdr-docker-dash/internal/docker"
)

type tab int

const (
	tabContainers tab = iota
	tabImages
	tabVolumes
	tabNetworks
	numTabs
)

type mode int

const (
	modeNormal mode = iota
	modeFilter
	modePull
	modeConfirm
	modeLogs
	modeContext // picking a docker context
)

const (
	maxLogLines = 5000
	doubleClick = 400 * time.Millisecond
	wheelStep   = 3
)

// ── messages ────────────────────────────────────────────────────────────────

type dataMsg struct {
	gen        int
	containers []docker.Container
	images     []docker.Image
	volumes    []docker.Volume
	networks   []docker.Network
	err        error
}
type tickMsg struct{}
type statsTickMsg struct{}
type statsMsg struct {
	gen   int
	stats map[string]docker.Stat
}
type eventMsg struct{ gen int }
type contextsMsg struct {
	list []docker.DockerContext
	err  error
}
type switchedMsg struct {
	dc  *docker.Client
	err error
}
type doneMsg struct {
	text string
	err  error
}
type logLinesMsg struct {
	session int
	lines   []string
	closed  bool
}
type logsStartMsg struct {
	session int
	ch      <-chan string
	err     error
}

// ── model ───────────────────────────────────────────────────────────────────

type Model struct {
	cfg         config.Config
	dc          *docker.Client
	gen         int // bumps on every context switch
	events      <-chan struct{}
	watchCancel context.CancelFunc
	contexts    []docker.DockerContext
	ctxGrid     grid

	width, height int
	tab           tab
	mode          mode

	containers []docker.Container
	images     []docker.Image
	volumes    []docker.Volume
	networks   []docker.Network
	stats      map[string]docker.Stat
	statsBusy  bool
	hidden     int // containers hidden by config

	// rows currently shown (after filter/folding), aligned with each grid
	shownC []cRow
	shownI []docker.Image
	shownV []docker.Volume
	shownN []docker.Network

	grids     [numTabs]grid
	keys      [numTabs][]string // stable identity per row, to keep the selection across refreshes
	collapsed map[string]bool   // compose projects folded away

	filter textinput.Model
	pull   textinput.Model

	confirmText    string
	confirmDetails []string // shown in the body while confirming (prune plan)
	confirmCmd     tea.Cmd

	status    string
	statusErr bool
	connErr   error

	logs       viewport.Model
	logLines   []string
	logTitle   string
	logSession int
	logCancel  context.CancelFunc
	logCh      <-chan string
	logFollow  bool

	lastClickRow int
	lastClickAt  time.Time
}

// New builds the model; cfgErr (a bad config file) is shown in the status line.
func New(dc *docker.Client, cfg config.Config, cfgErr error) Model {
	f := textinput.New()
	f.Prompt = "/ "
	f.SetValue(cfg.Filter)
	p := textinput.New()
	p.Prompt = "pull image: "
	p.Placeholder = "nginx:latest"
	m := Model{
		cfg: cfg, dc: dc, filter: f, pull: p, lastClickRow: -1,
		collapsed: map[string]bool{}, stats: map[string]docker.Stat{},
	}
	m.ctxGrid.cols = []column{{"", 1}, {"NAME", 20}, {"ENDPOINT", 50}, {"DESCRIPTION", 40}}
	m.startWatch()
	if cfgErr != nil {
		m.setStatus("config: "+cfgErr.Error(), true)
	}
	return m
}

func (m *Model) startWatch() {
	ctx, cancel := context.WithCancel(context.Background())
	m.watchCancel = cancel
	m.events = m.dc.Watch(ctx)
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(m.load(), m.waitEvent(), m.tick(), m.statsTick())
}

// ── commands ────────────────────────────────────────────────────────────────

func (m Model) load() tea.Cmd {
	dc, gen := m.dc, m.gen
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		d := dataMsg{gen: gen}
		if d.containers, d.err = dc.Containers(ctx); d.err != nil {
			return d
		}
		if d.images, d.err = dc.Images(ctx, d.containers); d.err != nil {
			return d
		}
		if d.volumes, d.err = dc.Volumes(ctx, d.containers); d.err != nil {
			return d
		}
		d.networks, d.err = dc.Networks(ctx, d.containers)
		return d
	}
}

func (m Model) tick() tea.Cmd {
	return tea.Tick(m.cfg.Refresh(), func(time.Time) tea.Msg { return tickMsg{} })
}

func (m Model) statsTick() tea.Cmd {
	return tea.Tick(m.cfg.Stats(), func(time.Time) tea.Msg { return statsTickMsg{} })
}

func (m Model) loadStats() tea.Cmd {
	var ids []string
	for _, c := range m.containers {
		if c.State == "running" {
			ids = append(ids, c.ID)
		}
	}
	dc, gen := m.dc, m.gen
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		return statsMsg{gen: gen, stats: dc.Stats(ctx, ids)}
	}
}

func (m Model) waitEvent() tea.Cmd {
	ch, gen := m.events, m.gen
	return func() tea.Msg {
		if _, ok := <-ch; !ok {
			return nil // watcher cancelled (context switch or exit)
		}
		return eventMsg{gen: gen}
	}
}

// act runs a docker operation in the background and reports the result.
func act(text string, f func(ctx context.Context) error) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		return doneMsg{text: text, err: f(ctx)}
	}
}

func waitLogs(session int, ch <-chan string) tea.Cmd {
	return func() tea.Msg {
		line, ok := <-ch
		if !ok {
			return logLinesMsg{session: session, closed: true}
		}
		lines := []string{line}
		for len(lines) < 500 { // drain what is already buffered
			select {
			case l, ok := <-ch:
				if !ok {
					return logLinesMsg{session: session, lines: lines, closed: true}
				}
				lines = append(lines, l)
			default:
				return logLinesMsg{session: session, lines: lines}
			}
		}
		return logLinesMsg{session: session, lines: lines}
	}
}

func (m *Model) setStatus(s string, isErr bool) {
	m.status, m.statusErr = s, isErr
}

// ── update ──────────────────────────────────────────────────────────────────

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.layout()
		return m, nil

	case dataMsg:
		if msg.gen != m.gen {
			return m, nil // from the daemon we just switched away from
		}
		if msg.err != nil {
			m.connErr = msg.err
			return m, nil
		}
		m.connErr = nil
		m.containers, m.images, m.volumes, m.networks = msg.containers, msg.images, msg.volumes, msg.networks
		m.applyFilter()
		return m, nil

	case tickMsg:
		return m, tea.Batch(m.load(), m.tick())

	case statsTickMsg:
		// sample only while someone is looking at the containers
		if m.statsBusy || m.connErr != nil || m.tab != tabContainers || m.mode == modeLogs {
			return m, m.statsTick()
		}
		m.statsBusy = true
		return m, m.loadStats()

	case statsMsg:
		m.statsBusy = false
		if msg.gen == m.gen {
			m.stats = msg.stats
			m.applyFilter()
		}
		return m, m.statsTick()

	case eventMsg:
		if msg.gen != m.gen {
			return m, nil
		}
		return m, tea.Batch(m.load(), m.waitEvent())

	case contextsMsg:
		if m.mode != modeContext {
			return m, nil
		}
		if msg.err != nil {
			m.mode = modeNormal
			m.setStatus(msg.err.Error(), true)
			return m, nil
		}
		m.contexts = msg.list
		var rows [][]string
		cur := 0
		for i, c := range msg.list {
			mark := ""
			if c.Name == m.dc.Context {
				mark, cur = "●", i
			}
			rows = append(rows, []string{mark, c.Name, c.Endpoint, c.Description})
		}
		m.ctxGrid.SetRows(rows, nil)
		m.ctxGrid.SetCursor(cur)
		return m, nil

	case switchedMsg:
		if msg.err != nil {
			m.setStatus(msg.err.Error(), true)
			return m, nil
		}
		m.watchCancel()
		_ = m.dc.Close()
		m.dc = msg.dc
		m.gen++
		m.startWatch()
		m.connErr = nil
		m.stats = map[string]docker.Stat{}
		m.containers, m.images, m.volumes, m.networks = nil, nil, nil, nil
		m.applyFilter()
		m.setStatus("switched to docker context "+m.dc.Context, false)
		return m, tea.Batch(m.load(), m.waitEvent())

	case doneMsg:
		if msg.err != nil {
			m.setStatus(msg.err.Error(), true)
		} else if msg.text != "" {
			m.setStatus(msg.text, false)
		}
		return m, m.load()

	case logsStartMsg:
		if msg.session != m.logSession || m.mode != modeLogs {
			return m, nil
		}
		if msg.err != nil {
			m.mode = modeNormal
			m.setStatus(msg.err.Error(), true)
			return m, nil
		}
		m.logCh = msg.ch
		return m, m.nextLogs()

	case logLinesMsg:
		if msg.session != m.logSession || m.mode != modeLogs {
			return m, nil
		}
		m.appendLogs(msg.lines)
		if msg.closed {
			m.appendLogs([]string{"── log stream ended ──"})
			return m, nil
		}
		return m, m.nextLogs()

	case tea.MouseMsg:
		return m.handleMouse(msg)

	case tea.KeyMsg:
		return m.handleKey(msg)
	}
	return m, nil
}

// nextLogs keeps reading from the current log stream.
func (m Model) nextLogs() tea.Cmd { return waitLogs(m.logSession, m.logCh) }

func (m Model) handleKey(k tea.KeyMsg) (tea.Model, tea.Cmd) {
	if k.String() == "ctrl+c" {
		m.stopLogs()
		return m, tea.Quit
	}
	switch m.mode {
	case modeFilter:
		switch k.String() {
		case "esc":
			m.filter.SetValue("")
			fallthrough
		case "enter":
			m.mode = modeNormal
			m.filter.Blur()
			m.applyFilter()
			return m, nil
		}
		var cmd tea.Cmd
		m.filter, cmd = m.filter.Update(k)
		m.applyFilter()
		return m, cmd

	case modePull:
		switch k.String() {
		case "esc":
			m.mode = modeNormal
			m.pull.Blur()
			return m, nil
		case "enter":
			ref := strings.TrimSpace(m.pull.Value())
			m.mode = modeNormal
			m.pull.Blur()
			m.pull.SetValue("")
			if ref == "" {
				return m, nil
			}
			m.setStatus("pulling "+ref+" …", false)
			dc := m.dc
			return m, act("pulled "+ref, func(ctx context.Context) error { return dc.Pull(ctx, ref) })
		}
		var cmd tea.Cmd
		m.pull, cmd = m.pull.Update(k)
		return m, cmd

	case modeConfirm:
		m.mode = modeNormal
		m.confirmDetails = nil
		if k.String() == "y" || k.String() == "Y" {
			cmd := m.confirmCmd
			m.confirmCmd = nil
			return m, cmd
		}
		m.setStatus("cancelled", false)
		return m, nil

	case modeContext:
		switch k.String() {
		case "esc", "q":
			m.mode = modeNormal
			return m, nil
		case "enter":
			m.mode = modeNormal
			i := m.ctxGrid.Cursor()
			if i < 0 || i >= len(m.contexts) || m.contexts[i].Name == m.dc.Context {
				return m, nil
			}
			name := m.contexts[i].Name
			m.setStatus("connecting to "+name+" …", false)
			return m, func() tea.Msg {
				dc, err := docker.New(name)
				return switchedMsg{dc: dc, err: err}
			}
		}
		m.ctxGrid.HandleKey(k.String())
		return m, nil

	case modeLogs:
		switch k.String() {
		case "esc", "q":
			m.stopLogs()
			m.mode = modeNormal
			return m, nil
		case "G", "end":
			m.logs.GotoBottom()
			m.logFollow = true
			return m, nil
		}
		var cmd tea.Cmd
		m.logs, cmd = m.logs.Update(k)
		m.logFollow = m.logs.AtBottom()
		return m, cmd
	}

	// normal mode: keys that work on every tab
	switch k.String() {
	case "q":
		return m, tea.Quit
	case "tab":
		m.switchTab((m.tab + 1) % numTabs)
		return m, nil
	case "shift+tab":
		m.switchTab((m.tab + numTabs - 1) % numTabs)
		return m, nil
	case "1", "2", "3", "4":
		m.switchTab(tab(k.String()[0] - '1'))
		return m, nil
	case "/":
		m.mode = modeFilter
		return m, m.filter.Focus()
	case "r":
		m.setStatus("refreshed", false)
		return m, m.load()
	case "P":
		return m.startPrune(), nil
	case "C":
		m.mode = modeContext
		m.contexts = nil
		m.ctxGrid.SetRows(nil, nil)
		return m, func() tea.Msg {
			list, err := docker.ListContexts()
			return contextsMsg{list: list, err: err}
		}
	}

	var (
		model   tea.Model
		cmd     tea.Cmd
		handled bool
	)
	switch m.tab {
	case tabContainers:
		model, cmd, handled = m.containerKey(k.String())
	case tabImages:
		model, cmd, handled = m.imageKey(k.String())
	case tabVolumes:
		model, cmd, handled = m.volumeKey(k.String())
	case tabNetworks:
		model, cmd, handled = m.networkKey(k.String())
	}
	if handled {
		return model, cmd
	}
	m.grids[m.tab].HandleKey(k.String())
	return m, nil
}

func (m *Model) switchTab(t tab) {
	m.tab = t
	m.lastClickRow = -1
}

// ── per-tab actions ─────────────────────────────────────────────────────────

func (m Model) containerKey(key string) (tea.Model, tea.Cmd, bool) {
	row, ok := m.selectedContainerRow()
	if !ok {
		return m, nil, false
	}
	if row.header {
		return m.groupKey(key, row)
	}
	c := row.c
	dc, id := m.dc, c.ID
	switch key {
	case "s":
		m.setStatus("starting "+c.Name+" …", false)
		return m, act("started "+c.Name, func(ctx context.Context) error { return dc.Start(ctx, id) }), true
	case "x":
		m.setStatus("stopping "+c.Name+" …", false)
		return m, act("stopped "+c.Name, func(ctx context.Context) error { return dc.Stop(ctx, id) }), true
	case "R":
		m.setStatus("restarting "+c.Name+" …", false)
		return m, act("restarted "+c.Name, func(ctx context.Context) error { return dc.Restart(ctx, id) }), true
	case "D":
		what := "Remove container " + c.Name
		if c.State == "running" {
			what += " (it is running and will be stopped)"
		}
		m.confirm(what+"?", nil, act("removed "+c.Name, func(ctx context.Context) error { return dc.RemoveContainer(ctx, id) }))
		return m, nil, true
	case "l", "L":
		// In the Herdr app, logs open in the docker-logs viewer (selectable,
		// copyable entries); inline logs are only for a plain terminal.
		if m.inApp() {
			return m, m.openLogsTab(c.Name), true
		}
		m.startLogs(c)
		cmd := m.logStartCmd(c)
		return m, cmd, true
	case "e":
		if c.State != "running" {
			m.setStatus(c.Name+" is not running", true)
			return m, nil, true
		}
		argv := m.dockerArgv("exec", "-it", id, "sh", "-c",
			"if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi")
		if m.inApp() {
			return m, m.openPane("shell in "+c.Name, argv), true
		}
		cmd := exec.Command(argv[0], argv[1:]...)
		return m, tea.ExecProcess(cmd, func(err error) tea.Msg {
			return doneMsg{text: "left " + c.Name, err: err}
		}), true
	}
	return m, nil, false
}

// groupKey handles keys on a compose project header row.
func (m Model) groupKey(key string, row cRow) (tea.Model, tea.Cmd, bool) {
	dc, name := m.dc, row.project
	var ids []string
	pick := func(want func(docker.Container) bool) {
		for _, c := range row.members {
			if want(c) {
				ids = append(ids, c.ID)
			}
		}
	}
	each := func(f func(ctx context.Context, id string) error) func(ctx context.Context) error {
		return func(ctx context.Context) error {
			var errs []error
			for _, id := range ids {
				errs = append(errs, f(ctx, id))
			}
			return errors.Join(errs...)
		}
	}
	switch key {
	case "enter", " ", "space":
		m.collapsed[name] = !m.collapsed[name]
		m.applyFilter()
		return m, nil, true
	case "s":
		pick(func(c docker.Container) bool { return c.State != "running" })
		if len(ids) == 0 {
			m.setStatus(name+": everything is already running", false)
			return m, nil, true
		}
		m.setStatus(fmt.Sprintf("starting %d container(s) in %s …", len(ids), name), false)
		return m, act("started "+name, each(dc.Start)), true
	case "x":
		pick(func(c docker.Container) bool { return c.State == "running" })
		if len(ids) == 0 {
			m.setStatus(name+": nothing is running", false)
			return m, nil, true
		}
		m.setStatus(fmt.Sprintf("stopping %d container(s) in %s …", len(ids), name), false)
		return m, act("stopped "+name, each(dc.Stop)), true
	case "R":
		pick(func(docker.Container) bool { return true })
		m.setStatus(fmt.Sprintf("restarting %d container(s) in %s …", len(ids), name), false)
		return m, act("restarted "+name, each(dc.Restart)), true
	case "l", "e", "D":
		m.setStatus("select a container inside "+name+" for that", true)
		return m, nil, true
	}
	return m, nil, false
}

func (m Model) imageKey(key string) (tea.Model, tea.Cmd, bool) {
	if key == "p" {
		model, cmd := m.startPull()
		return model, cmd, true
	}
	img, ok := m.selectedImage()
	if !ok || key != "D" {
		return m, nil, false
	}
	dc, ref := m.dc, img.Ref()
	text := "Remove image " + imageName(img) + "?"
	if img.InUse > 0 {
		text = fmt.Sprintf("Image %s is used by %d container(s); docker will refuse. Try anyway?", imageName(img), img.InUse)
	}
	m.confirm(text, nil, act("removed "+imageName(img), func(ctx context.Context) error { return dc.RemoveImage(ctx, ref) }))
	return m, nil, true
}

func (m Model) volumeKey(key string) (tea.Model, tea.Cmd, bool) {
	v, ok := m.selectedVolume()
	if !ok || key != "D" {
		return m, nil, false
	}
	if len(v.UsedBy) > 0 {
		m.setStatus("volume is used by "+strings.Join(v.UsedBy, ", ")+"; remove those containers first", true)
		return m, nil, true
	}
	dc, name := m.dc, v.Name
	m.confirm("Remove volume "+volumeName(v)+"? Its data is deleted for good.", nil,
		act("removed volume "+volumeName(v), func(ctx context.Context) error { return dc.RemoveVolume(ctx, name) }))
	return m, nil, true
}

func (m Model) networkKey(key string) (tea.Model, tea.Cmd, bool) {
	n, ok := m.selectedNetwork()
	if !ok || key != "D" {
		return m, nil, false
	}
	if n.Builtin() {
		m.setStatus(n.Name+" is a built-in network and can't be removed", true)
		return m, nil, true
	}
	if len(n.Containers) > 0 {
		m.setStatus("network is used by "+strings.Join(n.Containers, ", "), true)
		return m, nil, true
	}
	dc, id := m.dc, n.ID
	m.confirm("Remove network "+n.Name+"?", nil,
		act("removed network "+n.Name, func(ctx context.Context) error { return dc.RemoveNetwork(ctx, id) }))
	return m, nil, true
}

func (m *Model) confirm(text string, details []string, cmd tea.Cmd) {
	m.mode = modeConfirm
	m.confirmText, m.confirmDetails, m.confirmCmd = text, details, cmd
}

func (m Model) startPrune() Model {
	plan := m.prunePlan()
	if len(plan) == 0 {
		m.setStatus("nothing to prune", false)
		return m
	}
	dc := m.dc
	m.confirm("Prune everything listed above?", plan, func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		r, err := dc.Prune(ctx)
		return doneMsg{
			text: fmt.Sprintf("pruned %d container(s), %d image(s), %d volume(s), %d network(s) · reclaimed %s",
				r.Containers, r.Images, r.Volumes, r.Networks, humanSize(int64(r.Reclaimed))),
			err: err,
		}
	})
	return m
}

func (m Model) startPull() (tea.Model, tea.Cmd) {
	m.mode = modePull
	return m, m.pull.Focus()
}

// ── logs ────────────────────────────────────────────────────────────────────

func (m *Model) startLogs(c docker.Container) {
	m.stopLogs()
	m.logSession++
	m.mode = modeLogs
	m.logTitle = c.Name
	m.logLines = nil
	m.logFollow = true
	m.logs = viewport.New(m.width, m.bodyHeight())
	m.logs.MouseWheelDelta = wheelStep
	m.logs.SetContent("")
}

func (m *Model) logStartCmd(c docker.Container) tea.Cmd {
	ctx, cancel := context.WithCancel(context.Background())
	m.logCancel = cancel
	session, dc, id := m.logSession, m.dc, c.ID
	return func() tea.Msg {
		ch, err := dc.Logs(ctx, id)
		return logsStartMsg{session: session, ch: ch, err: err}
	}
}

func (m *Model) stopLogs() {
	if m.logCancel != nil {
		m.logCancel()
		m.logCancel = nil
	}
}

func (m *Model) appendLogs(lines []string) {
	m.logLines = append(m.logLines, lines...)
	if n := len(m.logLines); n > maxLogLines {
		m.logLines = m.logLines[n-maxLogLines:]
	}
	m.logs.SetContent(strings.Join(m.logLines, "\n"))
	if m.logFollow {
		m.logs.GotoBottom()
	}
}

// ── Herdr app integration ───────────────────────────────────────────────────

// dockerArgv is a docker CLI command aimed at the same daemon as the dashboard.
func (m Model) dockerArgv(args ...string) []string {
	return append(append([]string{"docker"}, m.dc.CLIArgs()...), args...)
}

// herdrApp finds the Herdr app's CLI, or "".
func herdrApp() string {
	if p, err := exec.LookPath("herdr-app"); err == nil {
		return p
	}
	if home, err := os.UserHomeDir(); err == nil {
		p := filepath.Join(home, ".local", "bin", "herdr-app")
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// inApp reports whether logs and shells should open as Herdr app panes:
// we run in a herdr-core terminal, the CLI exists, and config allows it.
func (m Model) inApp() bool {
	return m.cfg.OpenIn == "pane" && os.Getenv("HC_TERMINAL_ID") != "" && herdrApp() != ""
}

// openLogsTab opens the docker-logs mod as a new full-size tab (⌘W closes it),
// on the same docker context as the dashboard.
func (m Model) openLogsTab(name string) tea.Cmd {
	bin := herdrApp()
	ctx := ""
	if args := m.dc.CLIArgs(); len(args) == 2 {
		ctx = args[1]
	}
	return func() tea.Msg {
		js, _ := json.Marshal(map[string]string{"container": name, "context": ctx})
		out, err := exec.Command(bin, "do", "tab.new", "--name", "logs: "+name,
			"--mod", "docker-logs", "--props", string(js)).CombinedOutput()
		if err != nil {
			return doneMsg{err: fmt.Errorf("herdr-app tab.new: %s", strings.TrimSpace(string(out)))}
		}
		return doneMsg{text: "opened logs of " + name + " in a new tab"}
	}
}

// openPane splits the focused pane (the dashboard) and runs argv there.
func (m Model) openPane(what string, argv []string) tea.Cmd {
	bin, split := herdrApp(), m.cfg.Split
	return func() tea.Msg {
		js, _ := json.Marshal(argv)
		out, err := exec.Command(bin, "do", "pane.split", "--direction", split, "--argv", string(js)).CombinedOutput()
		if err != nil {
			return doneMsg{err: fmt.Errorf("herdr-app pane.split: %s", strings.TrimSpace(string(out)))}
		}
		return doneMsg{text: "opened " + what + " in a new pane"}
	}
}
