#!/bin/sh
# A bounded short-lived background task, not a second collector or daemon.
# timeout also bounds libc DNS lookup, not just the curl transfer.
command -v timeout >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0
exec timeout 20 lua /usr/share/traffic/website-icons.lua
