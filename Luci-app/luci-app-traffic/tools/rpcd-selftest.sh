#!/bin/bash
# rpcd-selftest.sh - offline regression for luci-app-traffic's rpcd backend.
#
# The page talks to the backend over ubus, and rpcd invokes a plugin as
#
#     <script> list                 # enumerate the methods
#     <script> call <method>        # with the arguments as JSON on stdin
#
# The method name is therefore the second argument and is NOT part of the stdin
# object.  Reading it out of that object instead (which is what the backend did)
# matches nothing, falls through to the default branch, and answers every single
# call with {"error":"unknown method"} - while the object itself looks healthy
# and `list` looks correct, so nothing anywhere reports a problem.  That is
# exactly what the LuCI page received, and why a working collector showed no
# data at all.  This file asserts the contract directly.
#
#   bash rpcd-selftest.sh
set -u

SELF="$(cd "$(dirname "$0")" && pwd)"
RPCD="$(cd "$SELF/.." && pwd)/root/usr/libexec/rpcd/luci.traffic"
[ -f "$RPCD" ] || { echo "luci.traffic not found next to $SELF" >&2; exit 1; }

echo "=== sh -n ==="
if ! sh -n "$RPCD"; then
    echo "FAIL: luci.traffic does not parse - aborting" >&2
    exit 1
fi
echo "luci.traffic syntax OK"

echo
echo "=== 分派契约 ==="
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

# A minimal jshn stand-in.  json_add_string prints what it was given, which is
# enough to tell which branch of the dispatch ran, and json_get_var assigns the
# value it is asked for so the argument plumbing is exercised too.
cat > "$T/jshn.sh" <<'EOF'
json_init() { :; }
json_load() { :; }
json_get_var() { eval "$1=\"\$2\""; }
json_add_object() { :; }
json_close_object() { :; }
json_add_boolean() { :; }
json_add_string() { printf 'OUT:%s=%s\n' "$1" "$2"; }
json_dump() { :; }
json_cleanup() { :; }
EOF

sed "s#^\. /usr/share/libubox/jshn\.sh#. $T/jshn.sh#" "$RPCD" > "$T/lt.sh"

mkdir -p "$T/state"
printf '{"collected_at":123,"flows":7,"apps":[{"name":"X","down":1,"up":2}]}\n' > "$T/state/summary.json"

fail=0
chk() { if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 (expect '$2', got '$3')"; fail=1; fi; }

got=$(STATE_DIR="$T/state" sh "$T/lt.sh" call getSummary < /dev/null)
chk "1 call getSummary 返回快照原文"       '{"collected_at":123,"flows":7,"apps":[{"name":"X","down":1,"up":2}]}' "$got"
chk "1a 而不是 unknown method"             "no"    "$(printf '%s' "$got" | grep -q 'unknown method' && echo yes || echo no)"

# The error branch still has to exist: a genuinely unknown method must be
# reported as one rather than silently returning nothing.
got=$(STATE_DIR="$T/state" sh "$T/lt.sh" call noSuchMethod < /dev/null)
chk "2 未知方法仍报 unknown method"        "OUT:error=unknown method" "$got"

# list must advertise every method the page declares, or the page cannot call it.
listing=$(STATE_DIR="$T/state" sh "$T/lt.sh" list < /dev/null)
PAGE="/d/Code/Luci-app/luci-app-traffic/htdocs/luci-static/resources/view/traffic/overview.js"
[ -f "$PAGE" ] || PAGE="$(cd "$SELF/.." && pwd)/htdocs/luci-static/resources/view/traffic/overview.js"
chk "3 list 声明 getSummary"              "1"     "$(grep -c 'json_add_object "getSummary"' "$RPCD")"
chk "3a list 声明 getSeries"              "1"     "$(grep -c 'json_add_object "getSeries"' "$RPCD")"
chk "3b list 声明 resetStats"             "1"     "$(grep -c 'json_add_object "resetStats"' "$RPCD")"
chk "3c list 声明 resolveNow"             "1"     "$(grep -c 'json_add_object "resolveNow"' "$RPCD")"
chk "3d 参数类型已声明（hours/range/what）" "3"    "$(printf '%s\n' "$listing" | grep -c '^OUT:')"

# Every method the page calls must be both advertised and dispatched, otherwise
# the page gets "unknown method" or a silent default.
for m in getSummary getHourly getConfig getSeries resolveNow resetStats; do
    chk "4 分派覆盖 $m"                   "1"     "$(grep -c "^			$m)" "$RPCD")"
done
page_methods=$(sed -n "s/.*rpc\.declare({ *object: 'luci\.traffic', *method: '\([A-Za-z]*\)'.*/\1/p" "$PAGE" | sort -u)
for m in $page_methods; do
    chk "5 页面调用的 $m 已被 list 声明"   "1"     "$(grep -c "json_add_object \"$m\"" "$RPCD")"
done

# An empty state directory must still answer with the documented shape, so the
# page reads one schema whether or not the collector has run yet.
got=$(STATE_DIR="$T/empty" sh "$T/lt.sh" call getSummary < /dev/null)
for k in collected_at interval hour flows dnsmap_lines pending rounds version acct querylog apps clients totals; do
    chk "6 空快照含字段 $k"                "1"     "$(printf '%s' "$got" | grep -c "\"$k\":")"
done
chk "6a 空快照是合法 JSON 形状"            "{"     "$(printf '%s' "$got" | head -c 1)"

echo
if [ "$fail" = 0 ]; then echo "=== 全部通过 ==="; else echo "=== 有失败 ==="; fi
exit "$fail"
