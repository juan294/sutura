#!/usr/bin/env sh
set -eu

target="${1:-}"
case "$target" in
  darwin-arm64|linux-x64) ;;
  *)
    echo "usage: $0 darwin-arm64|linux-x64" >&2
    exit 64
    ;;
esac

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
package_directory=$(CDPATH= cd -- "$script_directory/.." && pwd)
source_directory="$package_directory/vendor/runtime-source"
output_directory="$package_directory/vendor"
image='node:22-bookworm@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d'

docker run --rm --platform linux/amd64 \
  -e RUNTIME_TARGET="$target" \
  -v "$source_directory:/runtime-source:ro" \
  -v "$script_directory:/runtime-scripts:ro" \
  -v "$output_directory:/output" \
  "$image" bash -euo pipefail -c '
    mkdir /runtime
    cp /runtime-source/package.json /runtime/package.json
    cp /runtime-source/pnpm-lock.yaml /runtime/pnpm-lock.yaml
    cp "/runtime-source/$RUNTIME_TARGET/pnpm-workspace.yaml" /runtime/pnpm-workspace.yaml
    corepack enable
    corepack prepare pnpm@11.22.0 --activate
    test "$(pnpm --version)" = 11.22.0
    pnpm --dir /runtime install --frozen-lockfile --ignore-scripts
    node /runtime-scripts/normalize-test-runtime.mjs /runtime/node_modules
    archive() {
      tar --sort=name --mtime="@0" --owner=0 --group=0 --numeric-owner \
        --format=gnu --no-xattrs --no-acls --no-selinux \
        -cf - -C /runtime node_modules | gzip -n -9
    }
    archive > /tmp/runtime-first.tgz
    archive > /tmp/runtime-second.tgz
    cmp /tmp/runtime-first.tgz /tmp/runtime-second.tgz
    cp /tmp/runtime-first.tgz "/output/placebo-test-runtime-$RUNTIME_TARGET-node_modules.tgz"
    sha256sum "/output/placebo-test-runtime-$RUNTIME_TARGET-node_modules.tgz"
  '

node "$script_directory/verify-test-runtime.mjs"
