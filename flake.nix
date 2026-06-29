{
  description = "Shockolate - System Shock source port";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      # Systems we support.
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f {
          inherit system;
          pkgs = import nixpkgs { inherit system; };
        });

      # The libraries the build links against (system deps, ENABLE_*=ON).
      runtimeDeps = pkgs: with pkgs; [
        SDL2
        SDL2_mixer
        fluidsynth
        glew
        libGL
      ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
        alsa-lib
      ];

      mkPackage = pkgs:
        pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "shockolate";
          version = "0.7.8";

          # Keep the store copy lean: drop VCS, build dirs, and the 10MB .sit.
          src = pkgs.lib.cleanSourceWith {
            src = ./.;
            filter = path: type:
              let base = baseNameOf path; in
              !(base == "build" || base == "build_ext" || base == "ShockMac.sit");
          };

          nativeBuildInputs = with pkgs; [ cmake pkg-config makeWrapper ];
          buildInputs = runtimeDeps pkgs;

          cmakeFlags = [
            # Modern CMake (4.x) needs this to accept the project's old
            # cmake_minimum_required(VERSION 3.1).
            "-DCMAKE_POLICY_VERSION_MINIMUM=3.5"
            "-DENABLE_SDL2=ON"
            "-DENABLE_SOUND=ON"
            "-DENABLE_FLUIDSYNTH=ON"
            "-DENABLE_OPENGL=ON"
          ];

          # The CMakeLists builds several tools/tests; we only want the game.
          ninjaFlags = [ "systemshock" ];
          buildFlags = [ "systemshock" ];

          # There are no install() rules in CMakeLists, so do it by hand.
          # The game uses cwd-relative paths (shaders/, res/data/, saves/),
          # so the wrapper sets up a working directory at launch.
          installPhase = ''
            runHook preInstall

            mkdir -p "$out/libexec/shockolate" "$out/share/shockolate"
            install -Dm755 systemshock "$out/libexec/shockolate/systemshock"
            cp -r "$src/shaders" "$out/share/shockolate/shaders"

            makeWrapper "$out/libexec/shockolate/systemshock" "$out/bin/shockolate" \
              --run '
                : "''${SHOCKOLATE_HOME:=''${XDG_DATA_HOME:-$HOME/.local/share}/shockolate}"
                mkdir -p "$SHOCKOLATE_HOME"
                ln -sfn '"$out"'/share/shockolate/shaders "$SHOCKOLATE_HOME/shaders"
                if [ ! -e "$SHOCKOLATE_HOME/res/data" ]; then
                  echo "shockolate: no game assets found at $SHOCKOLATE_HOME/res/data" >&2
                  echo "  Copy your System Shock '"'"'res'"'"' directory there, for example:" >&2
                  echo "    cp -r /path/to/your/res \"$SHOCKOLATE_HOME/\"" >&2
                  exit 1
                fi
                cd "$SHOCKOLATE_HOME"
              '

            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "Cross-platform source port of System Shock (SDL2)";
            homepage = "https://github.com/Interrupt/systemshock";
            license = licenses.gpl3Only; # code is GPLv3; game assets required separately
            platforms = systems;
            mainProgram = "shockolate";
          };
        });
    in
    {
      packages = forAllSystems ({ pkgs, system }: rec {
        shockolate = mkPackage pkgs;
        default = shockolate;
      });

      apps = forAllSystems ({ pkgs, system }: rec {
        shockolate = {
          type = "app";
          program = "${mkPackage pkgs}/bin/shockolate";
        };
        default = shockolate;
      });

      devShells = forAllSystems ({ pkgs, system }: {
        default = pkgs.mkShell {
          nativeBuildInputs = with pkgs; [ cmake pkg-config git just ];
          buildInputs = runtimeDeps pkgs;

          # The game dlopen's GL/SDL at runtime; make sure they're findable
          # when running ./systemshock from inside the shell.
          shellHook = pkgs.lib.optionalString pkgs.stdenv.isLinux ''
            export LD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath [
              pkgs.libGL pkgs.SDL2 pkgs.SDL2_mixer pkgs.fluidsynth
            ]}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
          '';
        };
      });

      formatter = forAllSystems ({ pkgs, system }: pkgs.nixpkgs-fmt);
    };
}
