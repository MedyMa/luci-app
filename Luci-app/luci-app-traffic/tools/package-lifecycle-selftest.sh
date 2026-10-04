#!/bin/sh
# Exercise the actual Makefile prerm against sandbox state and stub services.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
for cmd in pkill nft; do
    printf '#!/bin/sh\nexit 0\n' > "$T/bin/$cmd"
    chmod +x "$T/bin/$cmd"
done
cat > "$T/service" <<'EOF'
#!/bin/sh
printf '%s\n' "$1" >> "$SERVICE_LOG"
EOF
chmod +x "$T/service"
awk '/^define Package\/\$\(PKG_NAME\)\/prerm$/ { found=1; next }
     found && /^endef$/ { exit }
     found { gsub(/\$\$/, "$" ); print }' "$ROOT/Makefile" |
    sed "s|/tmp/traffic|$T/state|g; s|/etc/init.d/traffic|$T/service|g" > "$T/prerm"
export SERVICE_LOG="$T/service.log"
export PATH="$T/bin:$PATH"
export IPKG_INSTROOT=
export PKG_UPGRADE=
fail=0
check_case() {
    name=$1; preserve=$2; shift 2
    mkdir -p "$T/state/arch"
    printf '12345\n67890\n' > "$T/state/wan.tsv"
    printf '99999\n111111\n' > "$T/state/wan.abs"
    printf 'snapshot\n' > "$T/state/arch/wan.snap"
    : > "$SERVICE_LOG"
    sh "$T/prerm" "$@"
    if [ "$preserve" = yes ]; then
        if [ "$(cat "$T/state/wan.tsv" 2>/dev/null)" != "$(printf '12345\n67890')" ] ||
           [ ! -s "$T/state/wan.abs" ] || [ ! -s "$T/state/arch/wan.snap" ]; then
            printf 'FAIL %s: cumulative counters or archive baseline lost\n' "$name"
            fail=1
        elif grep -q '^disable$' "$SERVICE_LOG"; then
            printf 'FAIL %s: service disabled during upgrade\n' "$name"
            fail=1
        else printf 'ok %s preserves counters and archive baseline\n' "$name"; fi
    elif [ -d "$T/state" ]; then
        printf 'FAIL %s: uninstall did not clean state\n' "$name"
        fail=1
    elif ! grep -q '^disable$' "$SERVICE_LOG"; then
        printf 'FAIL %s: uninstall did not disable service\n' "$name"
        fail=1
    else printf 'ok %s cleans state and disables service\n' "$name"; fi
}
check_case 'opkg upgrade' yes upgrade 1.1.8-r7
check_case 'opkg remove' no remove
check_case 'apk deinstall' no
PKG_UPGRADE=1 check_case 'upgrade environment' yes
PKG_UPGRADE=1 check_case 'opkg default_prerm sourced arguments' yes /usr/lib/opkg/info/luci-app-traffic.prerm upgrade 1.1.8-r7
IPKG_INSTROOT="$T/offline" check_case 'offline root' yes remove
exit "$fail"
