// herdr-docker: a terminal dashboard for Docker containers and images,
// meant to run inside a herdr plugin pane (or any terminal).
package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/andrew/herdr-docker-dash/internal/config"
	"github.com/andrew/herdr-docker-dash/internal/docker"
	"github.com/andrew/herdr-docker-dash/internal/ui"
)

func main() {
	cfg, cfgErr := config.Load()
	dc, err := docker.New(cfg.Context)
	if err != nil && cfg.Context != "" {
		// the configured context is gone: fall back to the current one
		cfgErr = fmt.Errorf("context %q: %w (using the current context)", cfg.Context, err)
		dc, err = docker.New("")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "docker client:", err)
		os.Exit(1)
	}

	p := tea.NewProgram(ui.New(dc, cfg, cfgErr), tea.WithAltScreen(), tea.WithMouseCellMotion())
	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
