package ui

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/mattn/go-runewidth"

	"github.com/andrew/herdr-docker-dash/internal/docker"
)

const (
	helpSep      = " · "
	confirmYes   = "[ Yes ]"
	confirmNo    = "[ No ]"
	confirmSpace = "  "
)

var (
	tabOn   = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("0")).Background(lipgloss.Color("12")).Padding(0, 1)
	tabOff  = lipgloss.NewStyle().Foreground(lipgloss.Color("7")).Padding(0, 1)
	dim     = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	keyText = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("12"))
	errText = lipgloss.NewStyle().Foreground(lipgloss.Color("9"))
	okText  = lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	warn    = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("11"))
	btnYes  = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("0")).Background(lipgloss.Color("9"))
	btnNo   = lipgloss.NewStyle().Foreground(lipgloss.Color("0")).Background(lipgloss.Color("7"))
)

func (m Model) bodyHeight() int {
	h := m.height - 3 // tab bar + status line + help line
	if h < 3 {
		h = 3
	}
	return h
}

// layout sizes every grid's columns to the window. Each cell has one column
// of padding on both sides.
func (m *Model) layout() {
	avail := func(cols int) int {
		return max(20, m.width-2*cols)
	}

	w := avail(7)
	state, status, cpu, mem := 1, 18, 7, 9
	flex := w - state - status - cpu - mem
	name, img := flex*35/100, flex*35/100
	m.grids[tabContainers].cols = []column{
		{"NAME", name}, {"IMAGE", img}, {"", state}, {"STATUS", status},
		{"CPU", cpu}, {"MEM", mem}, {"PORTS", flex - name - img},
	}

	w = avail(5)
	id, size, created, used := 12, 9, 14, 6
	m.grids[tabImages].cols = []column{
		{"REPOSITORY:TAG", w - id - size - created - used}, {"ID", id},
		{"SIZE", size}, {"CREATED", created}, {"IN USE", used},
	}

	w = avail(4)
	driver := 8
	flex = w - driver - created
	m.grids[tabVolumes].cols = []column{
		{"NAME", flex * 55 / 100}, {"DRIVER", driver}, {"USED BY", flex - flex*55/100}, {"CREATED", created},
	}

	w = avail(4)
	scope := 6
	flex = w - driver - scope
	m.grids[tabNetworks].cols = []column{
		{"NAME", flex * 40 / 100}, {"DRIVER", driver}, {"SCOPE", scope}, {"CONTAINERS", flex - flex*40/100},
	}

	for t := range m.grids {
		m.grids[t].SetHeight(m.bodyHeight())
	}
	m.ctxGrid.SetHeight(m.bodyHeight())
	ctxFlex := max(20, m.width-2*4-1-20)
	m.ctxGrid.cols[2].width, m.ctxGrid.cols[3].width = ctxFlex*55/100, ctxFlex-ctxFlex*55/100
	m.logs.Width, m.logs.Height = m.width, m.bodyHeight()
	m.applyFilter()
}

func (m Model) tabLabels() []string {
	running := 0
	for _, c := range m.containers {
		if c.State == "running" {
			running++
		}
	}
	containers := fmt.Sprintf("Containers %d/%d", running, len(m.containers))
	if m.hidden > 0 {
		containers += fmt.Sprintf(" (%d hidden)", m.hidden)
	}
	return []string{
		containers,
		fmt.Sprintf("Images %d", len(m.images)),
		fmt.Sprintf("Volumes %d", len(m.volumes)),
		fmt.Sprintf("Networks %d", len(m.networks)),
	}
}

// tabRanges gives each tab's [start, end) columns on the tab bar.
func (m Model) tabRanges() [][2]int {
	var out [][2]int
	pos := 0
	for _, l := range m.tabLabels() {
		w := runewidth.StringWidth(l) + 2 // padding
		out = append(out, [2]int{pos, pos + w})
		pos += w
	}
	return out
}

type helpItem struct{ key, label string }

// helpItems is the clickable help line; View and clickHelp both use it.
func (m Model) helpItems() []helpItem {
	var items []helpItem
	switch m.mode {
	case modeLogs:
		items = []helpItem{{"G", "follow"}, {"esc", "back"}}
	case modeFilter:
		items = []helpItem{{"enter", "apply"}, {"esc", "clear"}}
	case modePull:
		items = []helpItem{{"enter", "pull"}, {"esc", "cancel"}}
	case modeConfirm:
		items = []helpItem{{"y", "yes"}, {"n", "no"}}
	case modeContext:
		items = []helpItem{{"enter", "use"}, {"esc", "cancel"}}
	default:
		switch m.tab {
		case tabContainers:
			if r, ok := m.selectedContainerRow(); ok && r.header {
				items = []helpItem{{"s", "start all"}, {"x", "stop all"}, {"R", "restart all"}, {"enter", "fold"}}
			} else {
				items = []helpItem{{"s", "start"}, {"x", "stop"}, {"R", "restart"}, {"l", "logs"},
					{"e", "shell"}, {"D", "remove"}}
			}
		case tabImages:
			items = []helpItem{{"p", "pull"}, {"D", "remove"}}
		default:
			items = []helpItem{{"D", "remove"}}
		}
		items = append(items, helpItem{"/", "filter"}, helpItem{"r", "refresh"}, helpItem{"P", "prune"},
			helpItem{"C", "context"}, helpItem{"tab", "switch"}, helpItem{"q", "quit"})
	}
	// keep only what fits, so click positions match what is drawn
	var out []helpItem
	pos := 0
	for i, it := range items {
		w := runewidth.StringWidth(it.key + " " + it.label)
		if i > 0 {
			w += runewidth.StringWidth(helpSep)
		}
		if pos+w > m.width {
			break
		}
		pos += w
		out = append(out, it)
	}
	return out
}

func (m Model) View() string {
	if m.width == 0 {
		return "loading…"
	}
	var b strings.Builder

	// tab bar
	if m.mode == modeLogs {
		b.WriteString(tabOn.Render("logs: " + m.logTitle))
	} else {
		for i, t := range m.tabLabels() {
			if tab(i) == m.tab {
				b.WriteString(tabOn.Render(t))
			} else {
				b.WriteString(tabOff.Render(t))
			}
		}
		b.WriteString(dim.Render("  docker: " + m.dc.Context))
	}
	b.WriteString("\n")

	// body
	switch {
	case m.mode == modeLogs:
		b.WriteString(m.logs.View())
	case m.mode == modeConfirm && len(m.confirmDetails) > 0:
		b.WriteString(m.detailsView())
	case m.mode == modeContext:
		b.WriteString(m.ctxGrid.View())
	case m.connErr != nil:
		b.WriteString(errText.Render("Cannot reach Docker ("+m.dc.Host+"):\n"+m.connErr.Error()) +
			dim.Render("\n\nRetrying every 5s… is the daemon (e.g. OrbStack) running?"))
		b.WriteString(strings.Repeat("\n", max(0, m.bodyHeight()-4)))
	default:
		b.WriteString(m.grids[m.tab].View())
	}
	b.WriteString("\n")

	// status / input line
	switch m.mode {
	case modeFilter:
		b.WriteString(m.filter.View())
	case modePull:
		b.WriteString(m.pull.View())
	case modeConfirm:
		b.WriteString(warn.Render(m.confirmText) + confirmSpace + btnYes.Render(confirmYes) + " " + btnNo.Render(confirmNo))
	case modeContext:
		b.WriteString(warn.Render("Choose a docker context (current: " + m.dc.Context + ")"))
	default:
		switch {
		case m.status == "":
			if q := m.filter.Value(); q != "" {
				b.WriteString(dim.Render("filter: " + q))
			}
		case m.statusErr:
			b.WriteString(errText.Render(truncate(m.status, m.width)))
		default:
			b.WriteString(okText.Render(truncate(m.status, m.width)))
		}
	}
	b.WriteString("\n")

	// help (clickable)
	for i, it := range m.helpItems() {
		if i > 0 {
			b.WriteString(dim.Render(helpSep))
		}
		b.WriteString(keyText.Render(it.key) + " " + dim.Render(it.label))
	}
	return b.String()
}

// detailsView fills the body with the confirm details (the prune plan).
func (m Model) detailsView() string {
	h := m.bodyHeight()
	lines := []string{warn.Render("Prune will remove:"), ""}
	for _, l := range m.confirmDetails {
		lines = append(lines, truncate(l, m.width))
	}
	if len(lines) > h {
		more := len(lines) - (h - 1)
		lines = append(lines[:h-1], dim.Render(fmt.Sprintf("… and %d more lines", more)))
	}
	for len(lines) < h {
		lines = append(lines, "")
	}
	return strings.Join(lines, "\n")
}

// ── formatting helpers ──────────────────────────────────────────────────────

func stateIcon(s string) string {
	switch s {
	case "running":
		return "●"
	case "paused":
		return "‖"
	case "restarting":
		return "↻"
	case "created":
		return "○"
	default:
		return "■"
	}
}

func imageName(i docker.Image) string {
	if len(i.Tags) == 0 {
		return "<none> " + shortID(i.ID)
	}
	return strings.Join(i.Tags, ", ")
}

func volumeName(v docker.Volume) string {
	if v.Anonymous {
		return shortID(v.Name) + " (anonymous)"
	}
	return v.Name
}

func shortID(id string) string {
	id = strings.TrimPrefix(id, "sha256:")
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

// humanSize uses SI units, like `docker images`.
func humanSize(b int64) string {
	const unit = 1000
	if b < unit {
		return fmt.Sprintf("%dB", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f%cB", float64(b)/float64(div), "kMGTPE"[exp])
}

// humanIEC uses binary units, like `docker stats`.
func humanIEC(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%dB", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f%ciB", float64(b)/float64(div), "KMGTPE"[exp])
}

func ago(t time.Time) string {
	if t.Year() < 2000 { // unknown, or images that report epoch 0
		return "-"
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%d min ago", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("%d hours ago", int(d.Hours()))
	case d < 60*24*time.Hour:
		return fmt.Sprintf("%d days ago", int(d.Hours()/24))
	default:
		return fmt.Sprintf("%d months ago", int(d.Hours()/24/30))
	}
}

func truncate(s string, w int) string {
	if w <= 1 || runewidth.StringWidth(s) <= w {
		return s
	}
	return runewidth.Truncate(s, w, "…")
}
