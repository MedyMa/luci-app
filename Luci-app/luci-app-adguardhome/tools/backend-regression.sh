#!/bin/sh
set -eu
package_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM
cache="$test_dir/cache/core-version"
# Exercise the production function in an isolated directory, never router state.
sed -n '/^resolve_core_version() {/,/^}/p' "$package_dir/root/usr/libexec/rpcd/luci.adguardhome" |
    sed "s|cache_dir='/var/run/AdGuardHome-ui-cache'|cache_dir='$test_dir/cache'|" > "$test_dir/function.sh"
. "$test_dir/function.sh"
core="$test_dir/core with spaces"
write_core() {
    printf '#!/bin/sh\nprintf "x\\n" >> "%s"\nprintf "%s\\n"\n' "$test_dir/invocations" "$1" > "$core"
    chmod +x "$core"
}
write_core v0.107.79
[ "$(resolve_core_version "$core")" = 'v0.107.79' ]
[ "$(resolve_core_version "$core")" = 'v0.107.79' ]
[ "$(wc -l < "$test_dir/invocations" | tr -d ' ')" = 1 ]
# Windows Git Bash reports synthetic NTFS permissions. Check real Unix modes in CI.
case "$(uname -s)" in MINGW*|MSYS*) ;; *) [ "$(stat -c '%a' "$cache")" = 600 ] ;; esac
# Replace binary, including a preserved mtime: inode change must invalidate.
mv "$core" "$test_dir/old-core"
write_core v0.107.80
touch -r "$test_dir/old-core" "$core"
[ "$(resolve_core_version "$core")" = 'v0.107.80' ]
[ "$(wc -l < "$test_dir/invocations" | tr -d ' ')" = 2 ]
# Cache input is validated data, never sourced or evaluated.
signature=$(head -n 1 "$cache")
printf '%s\n$(touch %s)\n' "$signature" "$test_dir/unsafe" > "$cache"
[ "$(resolve_core_version "$core")" = 'v0.107.80' ]
[ ! -e "$test_dir/unsafe" ]
# A configured symlink follows changes to the actual executable.
ln -s "$core" "$test_dir/core-link"
if [ -L "$test_dir/core-link" ]; then
    [ "$(resolve_core_version "$test_dir/core-link")" = 'v0.107.80' ]
    mv "$core" "$test_dir/previous-core"
    write_core v0.107.81
    [ "$(resolve_core_version "$test_dir/core-link")" = 'v0.107.81' ]
else
    echo 'NOTE: Windows emulated links; real symlink test runs on Linux CI.'
fi
rm -f "$core"
if resolve_core_version "$core"; then
    echo 'Missing core incorrectly returned a cached version' >&2
    exit 1
fi
echo 'PASS: core version cache, reuse, replacement invalidation, private permissions, untrusted cache and missing core.'
