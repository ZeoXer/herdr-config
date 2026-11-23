#!/usr/bin/env bash
# Install these Herdr app mods by linking them into ~/.config/herdr-app.
#
#   ./install.sh                    every mod + build docker-dash
#   ./install.sh git-links ...      only the named mods
#
# Anything already in the way is moved aside as <name>.bak-<time>.
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
STAMP="$(date +%Y%m%d%H%M%S)"

mods=()
for arg in "$@"; do
  case "$arg" in
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) [ -d "$REPO/mods/$arg" ] || { echo "no such mod: $arg" >&2; exit 1; }; mods+=("$arg") ;;
  esac
done
if [ ${#mods[@]} -eq 0 ]; then
  for d in "$REPO"/mods/*/; do mods+=("$(basename "$d")"); done
fi

# link <source> <target>: point target at source, moving anything else aside
link() {
  local src="$1" dst="$2"
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
    echo "  ok      $dst"; return
  fi
  if [ -L "$dst" ] && [ ! -e "$dst" ]; then
    rm "$dst"; echo "  relink  $dst (was broken: repo moved?)"
  elif [ -e "$dst" ] || [ -L "$dst" ]; then
    mv "$dst" "$dst.bak-$STAMP"; echo "  backup  $dst.bak-$STAMP"
  fi
  mkdir -p "$(dirname "$dst")"
  ln -s "$src" "$dst"; echo "  link    $dst"
}

echo "mods → $HOME_DIR/mods"
for m in "${mods[@]}"; do link "$REPO/mods/$m" "$HOME_DIR/mods/$m"; done

if [[ " ${mods[*]} " == *" docker-quick "* ]]; then
  echo "docker-dash (opened by docker-quick's ⌘O)"
  link "$REPO/docker-dash" "$HOME/herdr-plugins/docker-dash"
  if command -v go >/dev/null; then
    (cd "$REPO/docker-dash" && go build -o bin/herdr-docker .) && echo "  built   docker-dash/bin/herdr-docker"
  else
    echo "  skip    go not found; install Go, then: make -C $REPO/docker-dash build"
  fi
fi

if command -v herdr-app >/dev/null; then
  echo "check"
  for m in "${mods[@]}"; do
    if out="$(herdr-app check "$HOME_DIR/mods/$m" 2>&1)"; then echo "  ok      $m"
    else echo "  FAIL    $m"; echo "$out" | sed 's/^/          /'; fi
  done
else
  echo "herdr-app not on PATH: open Herdr once, then rerun to check the mods"
fi
