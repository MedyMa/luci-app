#!/bin/sh
PATH="/usr/sbin:/usr/bin:/sbin:/bin"

lines="$1"
file="$2"
cleanup_rotated="$3"

case "$lines" in
	''|*[!0-9]*) lines=2000 ;;
esac

[ -n "$file" ] || exit 0

if [ -f "$file" ]; then
	tmp="${file}.tailtmp.$$"
	tail -n "$lines" "$file" > "$tmp" 2>/dev/null && cat "$tmp" > "$file" 2>/dev/null
	rm -f "$tmp"
fi

[ "$cleanup_rotated" = 'cleanup-rotated' ] || exit 0

case "$file" in
	/tmp/*|/var/run/*|/var/tmp/*) ;;
	*) exit 0 ;;
esac

dir="${file%/*}"
base="${file##*/}"
prefix="${base%.*}"
[ -n "$dir" ] && [ "$dir" != "$file" ] || exit 0
[ -n "$prefix" ] || exit 0

for rotated in "$dir"/"$prefix"-*.log; do
	[ -f "$rotated" ] || continue
	rm -f "$rotated" 2>/dev/null || true
done