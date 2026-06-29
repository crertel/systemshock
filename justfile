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

# Install game assets into SHOCKOLATE_HOME for the packaged game.
# Usage: just install-assets /path/to/res
install-assets RES:
    #!/usr/bin/env bash
    set -euo pipefail
    home="${SHOCKOLATE_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/shockolate}"
    mkdir -p "$home"
    cp -r "{{RES}}" "$home/res"
    echo "Installed assets to $home/res"

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
