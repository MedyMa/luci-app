#!/bin/sh
# Copyright 2022 Rafał Wabik (IceG) - From eko.one.pl forum
# MIT License

BANDZ="$(modemband.sh getbands 2>/dev/null)"
WORKBANDZ="$(printf '%s' "$BANDZ" | tr ' ' ,)"

if [ -n "$WORKBANDZ" ] && [ "$WORKBANDZ" != "null" ]; then
	uci set modemband.@modemband[0].set_bands="$WORKBANDZ"
	uci commit modemband
fi
