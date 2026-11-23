package ui

import (
	"fmt"
	"strings"

	"github.com/andrew/herdr-docker-dash/internal/docker"
)

// cRow is one line of the containers tab: a container, or a compose project header.
type cRow struct {
	header  bool
	project string
	members []docker.Container // header only: the project's containers (unfiltered)
	c       docker.Container   // container rows only
}

func (r cRow) key() string {
	if r.header {
		return "project:" + r.project
	}
	return "container:" + r.c.ID
}

// applyFilter rebuilds every grid from the data, keeping each selection on
// the same item when it still exists.
func (m *Model) applyFilter() {
	q := strings.ToLower(m.filter.Value())
	match := func(fields ...string) bool {
		return q == "" || strings.Contains(strings.ToLower(strings.Join(fields, " ")), q)
	}

	// containers, grouped by compose project (Containers() sorts by project);
	// names matching the config's hide patterns are left out entirely
	var visible []docker.Container
	m.hidden = 0
	for _, c := range m.containers {
		if m.cfg.Hidden(c.Name) {
			m.hidden++
			continue
		}
		visible = append(visible, c)
	}
	m.shownC = m.shownC[:0]
	var crows [][]string
	var cemph []bool
	var ckeys []string
	addC := func(r cRow, cells []string) {
		m.shownC = append(m.shownC, r)
		crows = append(crows, cells)
		cemph = append(cemph, r.header)
		ckeys = append(ckeys, r.key())
	}
	for i := 0; i < len(visible); {
		project := visible[i].Project
		j := i
		for j < len(visible) && visible[j].Project == project {
			j++
		}
		group := visible[i:j]
		i = j

		var hits []docker.Container
		for _, c := range group {
			if match(c.Name, c.Image, c.Project, c.State) {
				hits = append(hits, c)
			}
		}
		if len(hits) == 0 {
			continue
		}
		indent := ""
		if project != "" {
			addC(cRow{header: true, project: project, members: group}, m.projectCells(project, group))
			if m.collapsed[project] {
				continue
			}
			indent = "  "
		}
		for _, c := range hits {
			addC(cRow{c: c, project: project}, m.containerCells(c, indent))
		}
	}
	m.setGrid(tabContainers, crows, cemph, ckeys)

	// images
	m.shownI = m.shownI[:0]
	var irows [][]string
	var ikeys []string
	for _, img := range m.images {
		if !match(imageName(img), img.ID) {
			continue
		}
		used := ""
		if img.InUse > 0 {
			used = fmt.Sprint(img.InUse)
		}
		m.shownI = append(m.shownI, img)
		irows = append(irows, []string{imageName(img), shortID(img.ID), humanSize(img.Size), ago(img.Created), used})
		ikeys = append(ikeys, img.ID)
	}
	m.setGrid(tabImages, irows, nil, ikeys)

	// volumes
	m.shownV = m.shownV[:0]
	var vrows [][]string
	var vkeys []string
	for _, v := range m.volumes {
		if !match(v.Name, v.Driver, strings.Join(v.UsedBy, " ")) {
			continue
		}
		m.shownV = append(m.shownV, v)
		vrows = append(vrows, []string{volumeName(v), v.Driver, strings.Join(v.UsedBy, ", "), ago(v.Created)})
		vkeys = append(vkeys, v.Name)
	}
	m.setGrid(tabVolumes, vrows, nil, vkeys)

	// networks
	m.shownN = m.shownN[:0]
	var nrows [][]string
	var nkeys []string
	for _, n := range m.networks {
		if !match(n.Name, n.Driver, strings.Join(n.Containers, " ")) {
			continue
		}
		name := n.Name
		if n.Builtin() {
			name += " (built-in)"
		}
		m.shownN = append(m.shownN, n)
		nrows = append(nrows, []string{name, n.Driver, n.Scope, strings.Join(n.Containers, ", ")})
		nkeys = append(nkeys, n.ID)
	}
	m.setGrid(tabNetworks, nrows, nil, nkeys)
}

func (m *Model) setGrid(t tab, rows [][]string, emph []bool, keys []string) {
	g := &m.grids[t]
	prev := ""
	if c := g.Cursor(); c >= 0 && c < len(m.keys[t]) {
		prev = m.keys[t][c]
	}
	cursor := g.Cursor()
	for i, k := range keys {
		if k == prev {
			cursor = i
			break
		}
	}
	m.keys[t] = keys
	g.SetRows(rows, emph)
	g.SetCursor(cursor)
}

func (m Model) containerCells(c docker.Container, indent string) []string {
	cpu, mem := "", ""
	if s, ok := m.stats[c.ID]; ok && c.State == "running" {
		cpu, mem = fmt.Sprintf("%.1f%%", s.CPU), humanIEC(s.Mem)
	}
	return []string{indent + c.Name, c.Image, stateIcon(c.State), c.Status, cpu, mem, c.Ports}
}

func (m Model) projectCells(project string, members []docker.Container) []string {
	arrow := "▾"
	if m.collapsed[project] {
		arrow = "▸"
	}
	running := 0
	var cpu float64
	var mem uint64
	sampled := false
	for _, c := range members {
		if c.State != "running" {
			continue
		}
		running++
		if s, ok := m.stats[c.ID]; ok {
			cpu += s.CPU
			mem += s.Mem
			sampled = true
		}
	}
	cpuS, memS := "", ""
	if sampled {
		cpuS, memS = fmt.Sprintf("%.1f%%", cpu), humanIEC(mem)
	}
	icon := "●"
	switch {
	case running == 0:
		icon = "■"
	case running < len(members):
		icon = "◐"
	}
	return []string{arrow + " " + project, "compose project", icon,
		fmt.Sprintf("%d/%d running", running, len(members)), cpuS, memS, ""}
}

// prunePlan predicts what Client.Prune will remove, as display lines.
// Prune removes stopped containers first, so things used only by them go too.
func (m Model) prunePlan() []string {
	gone := map[string]bool{}
	var cs []string
	for _, c := range m.containers {
		if c.Stopped() {
			gone[c.Name] = true
			cs = append(cs, c.Name)
		}
	}
	keptUser := map[string]bool{} // image IDs used by containers that stay
	for _, c := range m.containers {
		if !c.Stopped() {
			keptUser[c.ImageID] = true
		}
	}
	allGone := func(names []string) bool {
		for _, n := range names {
			if !gone[n] {
				return false
			}
		}
		return true
	}

	var is, vs, ns []string
	for _, img := range m.images {
		if len(img.Tags) == 0 && !keptUser[img.ID] {
			is = append(is, fmt.Sprintf("%s  %s", shortID(img.ID), humanSize(img.Size)))
		}
	}
	for _, v := range m.volumes {
		if v.Anonymous && allGone(v.UsedBy) {
			vs = append(vs, volumeName(v))
		}
	}
	for _, n := range m.networks {
		if !n.Builtin() && allGone(n.Containers) {
			ns = append(ns, n.Name)
		}
	}
	if len(cs)+len(is)+len(vs)+len(ns) == 0 {
		return nil
	}

	var out []string
	section := func(title string, items []string) {
		if len(items) == 0 {
			return
		}
		out = append(out, fmt.Sprintf("%s (%d)", title, len(items)))
		for _, it := range items {
			out = append(out, "    "+it)
		}
		out = append(out, "")
	}
	section("Stopped containers", cs)
	section("Dangling images (untagged, unused)", is)
	section("Anonymous volumes no container needs", vs)
	section("Networks no container uses", ns)
	out = append(out, "Kept: running containers, tagged images, named volumes, built-in networks.")
	return out
}

// ── selection ───────────────────────────────────────────────────────────────

func (m Model) selectedContainerRow() (cRow, bool) {
	i := m.grids[tabContainers].Cursor()
	if i < 0 || i >= len(m.shownC) {
		return cRow{}, false
	}
	return m.shownC[i], true
}

func (m Model) selectedImage() (docker.Image, bool) {
	i := m.grids[tabImages].Cursor()
	if i < 0 || i >= len(m.shownI) {
		return docker.Image{}, false
	}
	return m.shownI[i], true
}

func (m Model) selectedVolume() (docker.Volume, bool) {
	i := m.grids[tabVolumes].Cursor()
	if i < 0 || i >= len(m.shownV) {
		return docker.Volume{}, false
	}
	return m.shownV[i], true
}

func (m Model) selectedNetwork() (docker.Network, bool) {
	i := m.grids[tabNetworks].Cursor()
	if i < 0 || i >= len(m.shownN) {
		return docker.Network{}, false
	}
	return m.shownN[i], true
}
