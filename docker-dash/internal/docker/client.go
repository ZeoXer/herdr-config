// Package docker wraps the Docker SDK with the small surface the dashboard needs.
package docker

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sort"
	"strings"
	"time"

	"github.com/docker/cli/cli/connhelper"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
)

// Container is a flattened view of a container for display.
type Container struct {
	ID       string
	Name     string
	Image    string
	ImageID  string
	State    string // running, exited, paused, ...
	Status   string // human text, e.g. "Up 3 hours"
	Ports    string
	Project  string   // docker compose project, if any
	Volumes  []string // names of mounted volumes
	Networks []string // names of attached networks
}

// Stopped reports whether `docker container prune` would remove it.
func (c Container) Stopped() bool {
	return c.State == "exited" || c.State == "created" || c.State == "dead"
}

// Image is a flattened view of an image for display.
type Image struct {
	ID      string
	Tags    []string
	Size    int64
	Created time.Time
	InUse   int // number of containers (any state) using this image
}

// Ref returns the best reference for removing this image: its only tag, or its ID.
func (i Image) Ref() string {
	if len(i.Tags) == 1 {
		return i.Tags[0]
	}
	return i.ID
}

type Client struct {
	api     *client.Client
	Context string // docker context name; "env" when DOCKER_HOST decides
	Host    string
}

// New connects to the daemon of a docker context. name "" means the current
// context, or DOCKER_HOST when that is set (as the docker CLI does).
// The SDK itself only honours DOCKER_HOST, so contexts are resolved through
// the docker CLI; ssh:// endpoints go through the CLI's connection helper.
func New(name string) (*Client, error) {
	var host string
	switch {
	case name == "" && os.Getenv("DOCKER_HOST") != "":
		name, host = "env", os.Getenv("DOCKER_HOST")
	case name == "":
		var err error
		if name, host, err = inspectContext(""); err != nil {
			name, host = "default", "" // no docker CLI: fall back to the SDK default
		}
	default:
		var err error
		if name, host, err = inspectContext(name); err != nil {
			return nil, err
		}
	}

	opts := []client.Opt{client.FromEnv, client.WithAPIVersionNegotiation()}
	if host != "" {
		helper, err := connhelper.GetConnectionHelper(host)
		if err != nil {
			return nil, err
		}
		if helper != nil {
			opts = append(opts, client.WithHost(helper.Host), client.WithDialContext(helper.Dialer))
		} else {
			opts = append(opts, client.WithHost(host))
		}
	}
	api, err := client.NewClientWithOpts(opts...)
	if err != nil {
		return nil, err
	}
	if host == "" {
		host = api.DaemonHost()
	}
	return &Client{api: api, Context: name, Host: host}, nil
}

func (c *Client) Close() error { return c.api.Close() }

// CLIArgs are the docker CLI flags that target the same daemon as this client.
func (c *Client) CLIArgs() []string {
	if c.Context == "env" {
		return nil
	}
	return []string{"--context", c.Context}
}

func inspectContext(name string) (string, string, error) {
	args := []string{"context", "inspect", "--format", "{{.Name}}\t{{.Endpoints.docker.Host}}"}
	if name != "" {
		args = append(args, name)
	}
	out, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		return "", "", fmt.Errorf("docker context %q: %s", name, strings.TrimSpace(string(out)))
	}
	parts := strings.SplitN(strings.TrimSpace(string(out)), "\t", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("docker context %q: unexpected output %q", name, out)
	}
	return parts[0], parts[1], nil
}

// DockerContext is one entry of `docker context ls`.
type DockerContext struct {
	Name        string
	Description string
	Endpoint    string `json:"DockerEndpoint"`
	Current     bool
}

func ListContexts() ([]DockerContext, error) {
	out, err := exec.Command("docker", "context", "ls", "--format", "{{json .}}").Output()
	if err != nil {
		return nil, fmt.Errorf("docker context ls: %w", err)
	}
	var list []DockerContext
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		var dc DockerContext
		if err := json.Unmarshal([]byte(line), &dc); err != nil {
			return nil, fmt.Errorf("docker context ls: %w", err)
		}
		list = append(list, dc)
	}
	return list, nil
}

func (c *Client) Containers(ctx context.Context) ([]Container, error) {
	list, err := c.api.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return nil, err
	}
	out := make([]Container, 0, len(list))
	for _, s := range list {
		name := s.ID[:12]
		if len(s.Names) > 0 {
			name = strings.TrimPrefix(s.Names[0], "/")
		}
		seen := map[string]bool{}
		var ports []string
		for _, p := range s.Ports {
			var txt string
			if p.PublicPort != 0 {
				txt = fmt.Sprintf("%d->%d/%s", p.PublicPort, p.PrivatePort, p.Type)
			} else {
				txt = fmt.Sprintf("%d/%s", p.PrivatePort, p.Type)
			}
			if !seen[txt] { // IPv4 and IPv6 bindings duplicate each other
				seen[txt] = true
				ports = append(ports, txt)
			}
		}
		sort.Strings(ports)
		var vols, nets []string
		for _, mt := range s.Mounts {
			if mt.Type == "volume" {
				vols = append(vols, mt.Name)
			}
		}
		if s.NetworkSettings != nil {
			for name := range s.NetworkSettings.Networks {
				nets = append(nets, name)
			}
			sort.Strings(nets)
		}
		out = append(out, Container{
			ID:       s.ID,
			Name:     name,
			Image:    s.Image,
			ImageID:  s.ImageID,
			State:    s.State,
			Status:   s.Status,
			Ports:    strings.Join(ports, ", "),
			Project:  s.Labels["com.docker.compose.project"],
			Volumes:  vols,
			Networks: nets,
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Project != out[j].Project {
			return out[i].Project < out[j].Project
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// Images lists images; containers is used to compute InUse.
func (c *Client) Images(ctx context.Context, containers []Container) ([]Image, error) {
	list, err := c.api.ImageList(ctx, image.ListOptions{})
	if err != nil {
		return nil, err
	}
	use := map[string]int{}
	for _, ct := range containers {
		use[ct.ImageID]++
	}
	out := make([]Image, 0, len(list))
	for _, s := range list {
		var tags []string
		for _, t := range s.RepoTags {
			if t != "<none>:<none>" {
				tags = append(tags, t)
			}
		}
		out = append(out, Image{
			ID:      s.ID,
			Tags:    tags,
			Size:    s.Size,
			Created: time.Unix(s.Created, 0),
			InUse:   use[s.ID],
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Created.After(out[j].Created) })
	return out, nil
}

func (c *Client) Start(ctx context.Context, id string) error {
	return c.api.ContainerStart(ctx, id, container.StartOptions{})
}

func (c *Client) Stop(ctx context.Context, id string) error {
	return c.api.ContainerStop(ctx, id, container.StopOptions{})
}

func (c *Client) Restart(ctx context.Context, id string) error {
	return c.api.ContainerRestart(ctx, id, container.StopOptions{})
}

// RemoveContainer force-removes (stops first if running). Callers must confirm.
func (c *Client) RemoveContainer(ctx context.Context, id string) error {
	return c.api.ContainerRemove(ctx, id, container.RemoveOptions{Force: true})
}

// RemoveImage removes without force, so images used by containers are refused.
func (c *Client) RemoveImage(ctx context.Context, ref string) error {
	_, err := c.api.ImageRemove(ctx, ref, image.RemoveOptions{PruneChildren: true})
	return err
}

// Pull pulls an image and blocks until done.
func (c *Client) Pull(ctx context.Context, ref string) error {
	rc, err := c.api.ImagePull(ctx, ref, image.PullOptions{})
	if err != nil {
		return err
	}
	defer rc.Close()
	// The stream reports errors inline as JSON; scan for them.
	sc := bufio.NewScanner(rc)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		if line := sc.Text(); strings.Contains(line, `"error"`) {
			return fmt.Errorf("pull %s: %s", ref, line)
		}
	}
	return sc.Err()
}

// Watch emits a signal whenever a container or image event happens.
// It resubscribes after errors (e.g. daemon restart) until ctx is cancelled.
// Signals are coalesced: the channel has capacity 1.
func (c *Client) Watch(ctx context.Context) <-chan struct{} {
	ch := make(chan struct{}, 1)
	go func() {
		defer close(ch)
		f := filters.NewArgs(filters.Arg("type", "container"), filters.Arg("type", "image"))
		for ctx.Err() == nil {
			msgs, errs := c.api.Events(ctx, events.ListOptions{Filters: f})
		loop:
			for {
				select {
				case <-ctx.Done():
					return
				case <-msgs:
					select {
					case ch <- struct{}{}:
					default:
					}
				case <-errs:
					break loop
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(3 * time.Second):
			}
		}
	}()
	return ch
}

// Logs follows a container's logs (last 300 lines first). The channel closes
// when the stream ends or ctx is cancelled.
func (c *Client) Logs(ctx context.Context, id string) (<-chan string, error) {
	info, err := c.api.ContainerInspect(ctx, id)
	if err != nil {
		return nil, err
	}
	rc, err := c.api.ContainerLogs(ctx, id, container.LogsOptions{
		ShowStdout: true, ShowStderr: true, Follow: true, Tail: "300",
	})
	if err != nil {
		return nil, err
	}
	pr, pw := io.Pipe()
	go func() {
		var err error
		if info.Config != nil && info.Config.Tty {
			_, err = io.Copy(pw, rc)
		} else {
			_, err = stdcopy.StdCopy(pw, pw, rc)
		}
		rc.Close()
		pw.CloseWithError(err)
	}()
	ch := make(chan string, 256)
	go func() {
		defer close(ch)
		defer pr.Close()
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			select {
			case ch <- strings.TrimRight(sc.Text(), "\r"):
			case <-ctx.Done():
				return
			}
		}
	}()
	return ch, nil
}
