#!/bin/sh
# Refresh is idempotent: only a changed compiled plan updates TC/QDMA/nft.
# Lease notifications are coalesced by this single procd-owned worker.
while sleep 15; do
	/usr/sbin/mtk-hqos refresh >/dev/null 2>&1
done
