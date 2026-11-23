// Package config loads ~/.config/docker-dash/config.toml.
package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

type Config struct {
	Context        string   `toml:"context"`         // docker context to start with; "" = current one
	RefreshSeconds int      `toml:"refresh_seconds"` // full reload interval (events also trigger reloads)
	StatsSeconds   int      `toml:"stats_seconds"`   // CPU/MEM sampling interval
	Filter         string   `toml:"filter"`          // initial filter text
	Hide           []string `toml:"hide"`            // container name globs to hide
	OpenIn         string   `toml:"open_in"`         // "pane" (Herdr app split) or "inline"
	Split          string   `toml:"split"`           // "right" or "down"
}

func Default() Config {
	return Config{RefreshSeconds: 5, StatsSeconds: 3, OpenIn: "pane", Split: "right"}
}

// Path is $XDG_CONFIG_HOME/docker-dash/config.toml, else ~/.config/docker-dash/config.toml.
func Path() string {
	dir := os.Getenv("XDG_CONFIG_HOME")
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".config")
	}
	return filepath.Join(dir, "docker-dash", "config.toml")
}

// Load returns defaults when the file does not exist. On a bad file it
// returns defaults plus an error, so the dashboard still starts.
func Load() (Config, error) {
	cfg := Default()
	p := Path()
	md, err := toml.DecodeFile(p, &cfg)
	if errors.Is(err, fs.ErrNotExist) {
		return Default(), nil
	}
	if err != nil {
		return Default(), fmt.Errorf("%w (in %s)", err, display(p))
	}
	if un := md.Undecoded(); len(un) > 0 {
		err = fmt.Errorf("unknown setting %q in %s", un[0].String(), display(p))
	}
	if cfg.RefreshSeconds < 1 {
		cfg.RefreshSeconds = 1
	}
	if cfg.StatsSeconds < 1 {
		cfg.StatsSeconds = 1
	}
	if cfg.OpenIn != "inline" {
		cfg.OpenIn = "pane"
	}
	if cfg.Split != "down" {
		cfg.Split = "right"
	}
	for _, g := range cfg.Hide {
		if _, e := path.Match(g, ""); e != nil && err == nil {
			err = fmt.Errorf("bad hide pattern %q in %s", g, display(p))
		}
	}
	return cfg, err
}

// display shortens the home directory to ~ for messages.
func display(p string) string {
	if home, err := os.UserHomeDir(); err == nil {
		if rel, err := filepath.Rel(home, p); err == nil && !strings.HasPrefix(rel, "..") {
			return filepath.Join("~", rel)
		}
	}
	return p
}

func (c Config) Refresh() time.Duration { return time.Duration(c.RefreshSeconds) * time.Second }
func (c Config) Stats() time.Duration   { return time.Duration(c.StatsSeconds) * time.Second }

// Hidden reports whether a container name matches a hide pattern.
func (c Config) Hidden(name string) bool {
	for _, g := range c.Hide {
		if ok, _ := path.Match(g, name); ok {
			return true
		}
	}
	return false
}
