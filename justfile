# Shockolate - common dev tasks
# Run `just` to see available recipes. Use inside `nix develop`.

build_dir := "build"

# CMake flags: use system libraries (from the nix dev shell) instead of the
# bundled deps that build_deps.sh fetches and compiles.
# CMAKE_POLICY_VERSION_MINIMUM lets modern CMake (4.x) build this project,
# which still declares cmake_minimum_required(VERSION 3.1).
cmake_flags := "-DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DENABLE_SDL2=ON -DENABLE_SOUND=ON -DENABLE_FLUIDSYNTH=ON -DENABLE_OPENGL=ON"

# List available recipes.
default:
    @just --list

# Enter the nix dev shell.
dev:
    nix develop

# Configure the CMake build (out-of-source, into {{build_dir}}/).
configure:
    cmake -S . -B {{build_dir}} {{cmake_flags}}

# Build the game (configures first if needed).
build: configure
    cmake --build {{build_dir}} --target systemshock -j

# Build everything CMake knows about (tools, tests, examples).
build-all: configure
    cmake --build {{build_dir}} -j

# Run the game. Must run from the repo root so it finds shaders/ and res/data.
# Pass extra args through, e.g. `just run -nosplash`.
run *ARGS: build
    ./{{build_dir}}/systemshock {{ARGS}}

# Build the Nix package (./result/bin/shockolate).
pkg:
    nix build .#shockolate

# Build and run the packaged game via Nix. Needs assets in SHOCKOLATE_HOME
# (default ~/.local/share/shockolate). See `just install-assets`.
play *ARGS:
    nix run .#shockolate -- {{ARGS}}

# Import game assets into SHOCKOLATE_HOME from an original install.
# Handles the DOS CD layout (DATA/ + SOUND/ with UPPERCASE names) by building
# a lowercase res/ tree of symlinks, which is what Shockolate expects on a
# case-sensitive filesystem. Then links a SoundFont so MIDI music plays.
# Usage: just install-assets /path/to/SSHOCK   (the dir holding DATA and SOUND)
install-assets SRC:
    #!/usr/bin/env bash
    set -euo pipefail
    src="{{SRC}}"
    home="${SHOCKOLATE_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/shockolate}"

    # Find a subdir case-insensitively.
    find_dir() { find "$1" -maxdepth 1 -type d -iname "$2" -print -quit; }
    # Symlink every file in $1 into $2 with a lowercased name.
    link_lc() {
      mkdir -p "$2"
      for f in "$1"/*; do
        [ -e "$f" ] || continue
        ln -sfn "$f" "$2/$(basename "$f" | tr 'A-Z' 'a-z')"
      done
    }

    data=$(find_dir "$src" data)
    [ -n "$data" ] || { echo "No DATA/ dir found under $src" >&2; exit 1; }
    link_lc "$data" "$home/res/data"
    echo "Linked $(ls "$home/res/data" | wc -l) files into res/data"

    sound=$(find_dir "$src" sound)
    if [ -n "$sound" ]; then
      # Top-level DOS music (thm*.bin) plus per-driver XMI subdirs (genmidi, sblaster).
      for f in "$sound"/[Tt][Hh][Mm]*.[Bb][Ii][Nn]; do
        [ -e "$f" ] || continue
        mkdir -p "$home/res/sound"
        ln -sfn "$f" "$home/res/sound/$(basename "$f" | tr 'A-Z' 'a-z')"
      done
      for d in "$sound"/*/; do
        [ -d "$d" ] || continue
        link_lc "$d" "$home/res/sound/$(basename "$d" | tr 'A-Z' 'a-z')"
      done
      echo "Linked music into res/sound"
    fi

    just install-soundfont
    echo "Assets ready in $home/res"

# Link a General MIDI SoundFont into res/ so FluidSynth music works.
install-soundfont:
    #!/usr/bin/env bash
    set -euo pipefail
    home="${SHOCKOLATE_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/shockolate}"
    mkdir -p "$home/res"
    sf=$(ls "$(nix build --no-link --print-out-paths nixpkgs#soundfont-fluid)"/share/soundfonts/*.sf2 | head -1)
    ln -sfn "$sf" "$home/res/music.sf2"
    echo "Linked SoundFont -> $home/res/music.sf2"

# Serve the web resource viewer at http://localhost:8000/ (needs a real HTTP
# server because it uses ES modules + a three.js CDN import map).
viewer port="8000":
    @echo "Serving resource viewer at http://localhost:{{port}}/"
    cd tools/web-viewer && nix run nixpkgs#python3 -- -m http.server {{port}}

# Build the bundled dependencies (SDL2, SDL2_mixer, FluidSynth) the old way.
# Not needed in the nix dev shell, but kept for parity with the README.
deps:
    ./build_deps.sh

# Format C/C++ sources with the project's .clang-format.
fmt:
    git ls-files 'src/*.c' 'src/*.cc' 'src/*.cpp' 'src/*.h' 'src/*.hh' | xargs clang-format -i

# Check formatting without modifying files.
fmt-check:
    git ls-files 'src/*.c' 'src/*.cc' 'src/*.cpp' 'src/*.h' 'src/*.hh' | xargs clang-format --dry-run --Werror

# Remove the build directory.
clean:
    rm -rf {{build_dir}}

# Clean and rebuild from scratch.
rebuild: clean build
