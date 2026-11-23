package docker

import (
	"context"
	"encoding/json"
	"sort"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/api/types/volume"
)

// ── volumes ─────────────────────────────────────────────────────────────────

type Volume struct {
	Name      string
	Driver    string
	Created   time.Time
	Anonymous bool     // created implicitly for a container (prune removes only these)
	UsedBy    []string // container names
}

func (c *Client) Volumes(ctx context.Context, containers []Container) ([]Volume, error) {
	resp, err := c.api.VolumeList(ctx, volume.ListOptions{})
	if err != nil {
		return nil, err
	}
	users := map[string][]string{}
	for _, ct := range containers {
		for _, v := range ct.Volumes {
			users[v] = append(users[v], ct.Name)
		}
	}
	out := make([]Volume, 0, len(resp.Volumes))
	for _, v := range resp.Volumes {
		if v == nil {
			continue
		}
		created, _ := time.Parse(time.RFC3339, v.CreatedAt)
		_, anon := v.Labels["com.docker.volume.anonymous"]
		out = append(out, Volume{
			Name: v.Name, Driver: v.Driver, Created: created,
			Anonymous: anon, UsedBy: users[v.Name],
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Anonymous != out[j].Anonymous {
			return !out[i].Anonymous // named volumes first
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// RemoveVolume refuses volumes in use (no force). Callers must confirm: data is lost.
func (c *Client) RemoveVolume(ctx context.Context, name string) error {
	return c.api.VolumeRemove(ctx, name, false)
}

// ── networks ────────────────────────────────────────────────────────────────

type Network struct {
	ID         string
	Name       string
	Driver     string
	Scope      string
	Containers []string // container names
}

// Builtin networks cannot be removed.
func (n Network) Builtin() bool {
	return n.Name == "bridge" || n.Name == "host" || n.Name == "none"
}

func (c *Client) Networks(ctx context.Context, containers []Container) ([]Network, error) {
	list, err := c.api.NetworkList(ctx, network.ListOptions{})
	if err != nil {
		return nil, err
	}
	users := map[string][]string{}
	for _, ct := range containers {
		for _, n := range ct.Networks {
			users[n] = append(users[n], ct.Name)
		}
	}
	out := make([]Network, 0, len(list))
	for _, n := range list {
		out = append(out, Network{
			ID: n.ID, Name: n.Name, Driver: n.Driver, Scope: n.Scope, Containers: users[n.Name],
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Builtin() != out[j].Builtin() {
			return !out[i].Builtin() // your networks first
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func (c *Client) RemoveNetwork(ctx context.Context, id string) error {
	return c.api.NetworkRemove(ctx, id)
}

// ── stats ───────────────────────────────────────────────────────────────────

type Stat struct {
	CPU      float64 // percent of one core × cores, like `docker stats`
	Mem      uint64  // bytes, excluding page cache
	MemLimit uint64
}

// Stats samples running containers concurrently. Each sample takes about a
// second (the daemon measures CPU over an interval). Failures are skipped.
func (c *Client) Stats(ctx context.Context, ids []string) map[string]Stat {
	var mu sync.Mutex
	var wg sync.WaitGroup
	out := make(map[string]Stat, len(ids))
	for _, id := range ids {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			resp, err := c.api.ContainerStats(ctx, id, false)
			if err != nil {
				return
			}
			defer resp.Body.Close()
			var s container.StatsResponse
			if json.NewDecoder(resp.Body).Decode(&s) != nil {
				return
			}
			mu.Lock()
			out[id] = toStat(s)
			mu.Unlock()
		}(id)
	}
	wg.Wait()
	return out
}

func toStat(s container.StatsResponse) Stat {
	var cpu float64
	cpuDelta := float64(s.CPUStats.CPUUsage.TotalUsage) - float64(s.PreCPUStats.CPUUsage.TotalUsage)
	sysDelta := float64(s.CPUStats.SystemUsage) - float64(s.PreCPUStats.SystemUsage)
	online := float64(s.CPUStats.OnlineCPUs)
	if online == 0 {
		online = float64(len(s.CPUStats.CPUUsage.PercpuUsage))
	}
	if cpuDelta > 0 && sysDelta > 0 {
		cpu = cpuDelta / sysDelta * online * 100
	}
	mem := s.MemoryStats.Usage
	for _, k := range []string{"inactive_file", "total_inactive_file"} { // cgroup v2, v1
		if v, ok := s.MemoryStats.Stats[k]; ok && v < mem {
			mem -= v
			break
		}
	}
	return Stat{CPU: cpu, Mem: mem, MemLimit: s.MemoryStats.Limit}
}

// ── prune ───────────────────────────────────────────────────────────────────

type PruneResult struct {
	Containers, Images, Volumes, Networks int
	Reclaimed                             uint64
}

// Prune removes, in this order: stopped containers, dangling images,
// unused anonymous volumes (named volumes are kept), unused networks.
// It stops at the first error and returns what was done so far.
func (c *Client) Prune(ctx context.Context) (PruneResult, error) {
	var r PruneResult
	cr, err := c.api.ContainersPrune(ctx, filters.Args{})
	if err != nil {
		return r, err
	}
	r.Containers, r.Reclaimed = len(cr.ContainersDeleted), cr.SpaceReclaimed

	ir, err := c.api.ImagesPrune(ctx, filters.NewArgs(filters.Arg("dangling", "true")))
	if err != nil {
		return r, err
	}
	r.Images, r.Reclaimed = len(ir.ImagesDeleted), r.Reclaimed+ir.SpaceReclaimed

	// Since API 1.42 volume prune only removes anonymous volumes unless all=true.
	vr, err := c.api.VolumesPrune(ctx, filters.Args{})
	if err != nil {
		return r, err
	}
	r.Volumes, r.Reclaimed = len(vr.VolumesDeleted), r.Reclaimed+vr.SpaceReclaimed

	nr, err := c.api.NetworksPrune(ctx, filters.Args{})
	if err != nil {
		return r, err
	}
	r.Networks = len(nr.NetworksDeleted)
	return r, nil
}
