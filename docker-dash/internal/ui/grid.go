package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/mattn/go-runewidth"
)

func init() {
	// Under CJK locales go-runewidth counts ambiguous symbols (●, …, ─) as two
	// columns, but terminals draw them as one; that would skew click positions.
	runewidth.DefaultCondition.EastAsianWidth = false
}

// grid is a minimal scrolling table. Unlike bubbles/table it exposes its
// scroll offset, so mouse clicks can be mapped to rows.
type grid struct {
	cols   []column
	rows   [][]string
	emph   []bool // rows drawn bold (group headers); may be shorter than rows
	cursor int
	offset int
	height int // total lines: header + rule + rows
}

type column struct {
	title string
	width int
}

var (
	gridHeader   = lipgloss.NewStyle().Bold(true)
	gridRule     = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	gridSelected = lipgloss.NewStyle().Foreground(lipgloss.Color("0")).Background(lipgloss.Color("12"))
)

func (g *grid) visible() int {
	if v := g.height - 2; v > 0 {
		return v
	}
	return 1
}

func (g *grid) SetRows(rows [][]string, emph []bool) {
	g.rows, g.emph = rows, emph
	g.SetCursor(g.cursor)
}

func (g *grid) SetHeight(h int) {
	g.height = h
	g.SetCursor(g.cursor)
}

func (g *grid) Cursor() int { return g.cursor }

// SetCursor clamps i to the rows and scrolls so it is visible.
func (g *grid) SetCursor(i int) {
	if i >= len(g.rows) {
		i = len(g.rows) - 1
	}
	if i < 0 {
		i = 0
	}
	g.cursor = i
	v := g.visible()
	if g.cursor < g.offset {
		g.offset = g.cursor
	}
	if g.cursor >= g.offset+v {
		g.offset = g.cursor - v + 1
	}
	if maxOff := len(g.rows) - v; g.offset > maxOff {
		g.offset = max(0, maxOff)
	}
}

func (g *grid) Move(delta int) { g.SetCursor(g.cursor + delta) }

// HandleKey moves the cursor for navigation keys; it reports whether it used the key.
func (g *grid) HandleKey(k string) bool {
	switch k {
	case "up", "k":
		g.Move(-1)
	case "down", "j":
		g.Move(1)
	case "pgup", "ctrl+u":
		g.Move(-g.visible())
	case "pgdown", "ctrl+d":
		g.Move(g.visible())
	case "home", "g":
		g.SetCursor(0)
	case "end", "G":
		g.SetCursor(len(g.rows) - 1)
	default:
		return false
	}
	return true
}

// RowAt maps a line within the grid (0 = header) to a row index, or -1.
func (g *grid) RowAt(y int) int {
	if y < 2 {
		return -1
	}
	i := g.offset + y - 2
	if y-2 >= g.visible() || i >= len(g.rows) {
		return -1
	}
	return i
}

func (g *grid) line(cells []string) string {
	var b strings.Builder
	for i, c := range g.cols {
		cell := ""
		if i < len(cells) {
			cell = cells[i]
		}
		b.WriteString(" ")
		b.WriteString(runewidth.FillRight(runewidth.Truncate(cell, c.width, "…"), c.width))
		b.WriteString(" ")
	}
	return b.String()
}

func (g *grid) View() string {
	titles := make([]string, len(g.cols))
	width := 0
	for i, c := range g.cols {
		titles[i] = c.title
		width += c.width + 2
	}
	lines := []string{gridHeader.Render(g.line(titles)), gridRule.Render(strings.Repeat("─", width))}
	v := g.visible()
	for i := g.offset; i < g.offset+v; i++ {
		switch {
		case i >= len(g.rows):
			lines = append(lines, "")
		case i == g.cursor:
			lines = append(lines, gridSelected.Render(g.line(g.rows[i])))
		case i < len(g.emph) && g.emph[i]:
			lines = append(lines, gridHeader.Render(g.line(g.rows[i])))
		default:
			lines = append(lines, g.line(g.rows[i]))
		}
	}
	return strings.Join(lines, "\n")
}
