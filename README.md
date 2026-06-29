Shockolate - System Shock, but cross platform!
============================
Based on the source code for PowerPC released by Night Dive Studios, Incorporated.

[![Build Status TravisCI](https://travis-ci.org/Interrupt/systemshock.svg?branch=master)](https://travis-ci.org/Interrupt/systemshock) [![Build Status AppVeyor](https://ci.appveyor.com/api/projects/status/5fmcswq8n7ni0o9j/branch/master?svg=true)](https://ci.appveyor.com/project/Interrupt/systemshock)

GENERAL NOTES
=============

Shockolate is a cross platform source port of System Shock, using SDL2. This runs well on OSX, Linux, and Windows right now, with some missing features that need reviving due to not being included in the source code that was released.

The end goal for this project is something like what Chocolate Doom is for Doom: an experience that closely mimics the original, but portable and with some quality of life improvements including an OpenGL renderer and mod support!

Join our Discord to follow along with development: https://discord.gg/m45xPan

![work so far](https://i.imgur.com/kbVWQj4.gif)

Prerequisites
=======
  - Original cd-rom or SS:EE assets in a `res/data` folder next to the executable
    - Floppy disk assets are an older version that we can't load currently


Running
=======

## From a prebuilt package

Find a list of [downloadable packages](https://github.com/Interrupt/systemshock/releases/) for Linux, Mac and Windows. 32 and 64 bit versions are available for Linux and Windows.

## From source code

Prerequisites: 
- [CMake](https://cmake.org/download/) installed

Step 1. Build the dependencies:
* Windows: `build_win32.sh` or `build_win64.sh` (Git Bash and MinGW recommended)
* Linux/Mac: `build_deps.sh` or the CI build scripts in `osx-linux`
* Other: `build_deps.sh` 

Step 2. Build and run the game itself
```
cmake .
make systemshock
./systemshock
```

The following CMake options are supported in the build process:
* `ENABLE_SDL2` - use system or bundled SDL2 (ON/BUNDLED, default BUNDLED)
* `ENABLE_SOUND` - enable sound support (requires SDL2_mixer, ON/BUNDLED/OFF, default is BUNDLED)
* `ENABLE_FLUIDSYNTH` - enable FluidSynth MIDI support (ON/BUNDLED/OFF, default is BUNDLED)
* `ENABLE_OPENGL` - enable OpenGL support (ON/OFF, default ON)

If you find yourself needing to modify the build script for Shockolate itself, `CMakeLists.txt` is the place to look into.

## With Nix (Linux/macOS)

A `flake.nix` and `justfile` are provided for a reproducible build using system
libraries (no `build_deps.sh` needed). Requires Nix with flakes enabled.

Build and run the packaged game directly:
```
nix run .#shockolate          # or: just play
```

Or work in a dev shell (provides cmake, SDL2, SDL2_mixer, FluidSynth, GLEW,
OpenGL, etc.) and use the `just` recipes:
```
nix develop          # enter the dev shell
just build           # configure + build into build/
just run -nosplash   # build and run from the repo root
just                 # list all recipes
```

The dev-shell build runs CMake with the system-library options
(`ENABLE_SDL2=ON ENABLE_SOUND=ON ENABLE_FLUIDSYNTH=ON ENABLE_OPENGL=ON`) plus
`-DCMAKE_POLICY_VERSION_MINIMUM=3.5` so modern CMake accepts the project.

### Game assets

You still need the original game assets (see Prerequisites above). The packaged
game (`nix run`) looks for them in a working directory:
`$SHOCKOLATE_HOME`, else `$XDG_DATA_HOME/shockolate`, else
`~/.local/share/shockolate`. It provides the `shaders/` itself and writes saves
there.

Shockolate expects a lowercase `res/data/` tree, but the original DOS CD-ROM
ships UPPERCASE filenames (`DATA/`, `SOUND/`), which matters on a
case-sensitive filesystem. `install-assets` builds the lowercase tree for you
and links a General MIDI SoundFont so FluidSynth music plays:
```
# Point it at the directory containing DATA/ and SOUND/
just install-assets /path/to/your/SSHOCK
just play
```

For the dev-shell build (`just run`), the game runs from the repo root instead,
so place your assets in `res/data/` (and `res/sound/`) next to `CMakeLists.txt`.


Command line parameters
============

`-nosplash` Disables the splash screens, causes the game to start straight to the main menu

Modding Support
============
Shockolate supports loading mods and full on fan missions. Just point the executable at a mod file or folder and the game will load it in. So far mod loading supports additional `.res` and `.dat` files for resources and missions respectively.

Run a fan mission from a folder:
```
./systemshock /Path/To/My/Mission
```

Run a fan mission from specific files:
```
./systemshock my-archive.dat my-strings.res
```

Control modifications
=======

## Movement

Shockolate replaces the original game's movement with WASD controls, and uses `F` as the mouselook toggle hotkey. This differs from the Enhanced Edition's usage of `E` as the mouselook hotkey, but allows us to keep `Q` and `E` available for leaning.

## Additional hotkeys

* `Ctrl+G` cycles between graphics rendering modes
* `Ctrl+F` to enable full screen mode
* `Ctrl+D` to disable full screen mode 

