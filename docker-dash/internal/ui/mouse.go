package ui

import (
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/mattn/go-runewidth"
)

// Screen rows: 0 tab bar · 1..height-3 body · height-2 status · height-1 help.

func (m Model) handleMouse(msg tea.MouseMsg) (tea.Model, tea.Cmd) {
	wheel := msg.Button == tea.MouseButtonWheelUp || msg.Button == tea.MouseButtonWheelDown
	if msg.Action != tea.MouseActionPress && !wheel {
		return m, nil
	}

	if m.mode == modeLogs {
		if msg.Y == m.height-1 && msg.Button == tea.MouseButtonLeft {
			return m.clickHelp(msg.X)
		}
		var cmd tea.Cmd
		m.logs, cmd = m.logs.Update(msg)
		m.logFollow = m.logs.AtBottom()
		return m, cmd
	}

	if wheel {
		d := wheelStep
		if msg.Button == tea.MouseButtonWheelUp {
			d = -d
		}
		switch m.mode {
		case modeNormal:
			m.grids[m.tab].Move(d)
		case modeContext:
			m.ctxGrid.Move(d)
		}
		return m, nil
	}
	if msg.Button != tea.MouseButtonLeft {
		return m, nil
	}

	switch y := msg.Y; {
	case y == m.height-1:
		return m.clickHelp(msg.X)
	case y == m.height-2 && m.mode == modeConfirm:
		return m.clickConfirm(msg.X)
	case m.mode == modeContext:
		row := m.ctxGrid.RowAt(y - 1)
		if row < 0 {
			return m, nil
		}
		m.ctxGrid.SetCursor(row)
		now := time.Now()
		double := row == m.lastClickRow && now.Sub(m.lastClickAt) < doubleClick
		m.lastClickRow, m.lastClickAt = row, now
		if double {
			m.lastClickRow = -1
			return m.handleKey(keyMsg("enter"))
		}
		return m, nil
	case m.mode != modeNormal:
		return m, nil
	case y == 0:
		for i, r := range m.tabRanges() {
			if msg.X >= r[0] && msg.X < r[1] {
				m.switchTab(tab(i))
			}
		}
		return m, nil
	case m.connErr == nil:
		row := m.grids[m.tab].RowAt(y - 1)
		if row < 0 {
			return m, nil
		}
		m.grids[m.tab].SetCursor(row)
		now := time.Now()
		double := row == m.lastClickRow && now.Sub(m.lastClickAt) < doubleClick
		m.lastClickRow, m.lastClickAt = row, now
		if double && m.tab == tabContainers {
			m.lastClickRow = -1
			if r, ok := m.selectedContainerRow(); ok && r.header {
				return m.handleKey(keyMsg("enter")) // fold / unfold the project
			}
			return m.handleKey(keyMsg("l")) // open the container's logs
		}
	}
	return m, nil
}

func (m Model) clickHelp(x int) (tea.Model, tea.Cmd) {
	pos := 0
	for _, it := range m.helpItems() {
		w := runewidth.StringWidth(it.key + " " + it.label)
		if x >= pos && x < pos+w {
			return m.handleKey(keyMsg(it.key))
		}
		pos += w + runewidth.StringWidth(helpSep)
	}
	return m, nil
}

func (m Model) clickConfirm(x int) (tea.Model, tea.Cmd) {
	start := runewidth.StringWidth(m.confirmText + confirmSpace)
	yesEnd := start + runewidth.StringWidth(confirmYes)
	noStart := yesEnd + 1
	noEnd := noStart + runewidth.StringWidth(confirmNo)
	switch {
	case x >= start && x < yesEnd:
		return m.handleKey(keyMsg("y"))
	case x >= noStart && x < noEnd:
		return m.handleKey(keyMsg("n"))
	}
	return m, nil
}

// keyMsg builds the key event a click stands for.
func keyMsg(k string) tea.KeyMsg {
	switch k {
	case "esc":
		return tea.KeyMsg{Type: tea.KeyEsc}
	case "enter":
		return tea.KeyMsg{Type: tea.KeyEnter}
	case "tab":
		return tea.KeyMsg{Type: tea.KeyTab}
	}
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(k)}
}
