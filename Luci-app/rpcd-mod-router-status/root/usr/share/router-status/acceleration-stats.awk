# Accept only the versioned, passive HNAT summary. Legacy hnat_stats follows
# the interactive debug filter and cannot prove that its counts are BIND.
BEGIN { FS = "=" }
NF != 2 || $2 !~ /^[0-9]+$/ || length($2) > 9 { bad = 1; next }
{ if (seen[$1]++) bad = 1; value[$1] = $2 + 0 }
END {
    count = value["PPE_NUM"]
    if (bad || value["STATS_VERSION"] != 2 || count < 1 || count > 3) exit 1
    for (i = 0; i < count; i++) {
        if (!seen["AVAILABLE_PPE" i] || value["AVAILABLE_PPE" i] != 1) exit 1
        for (k = 1; k <= 5; k++) {
            key = (k == 1 ? "ALL" : k == 2 ? "BIND" : k == 3 ? "IPV4" : k == 4 ? "IPV6" : "OTHER") "_PPE" i
            if (!seen[key] || value[key] > 65536) exit 1
        }
        if (!value["ALL_PPE" i] || value["BIND_PPE" i] > value["ALL_PPE" i] ||
            value["BIND_PPE" i] != value["IPV4_PPE" i] + value["IPV6_PPE" i] + value["OTHER_PPE" i]) exit 1
        capacity += value["ALL_PPE" i]; bound += value["BIND_PPE" i]
        ipv4 += value["IPV4_PPE" i]; ipv6 += value["IPV6_PPE" i]; other += value["OTHER_PPE" i]
    }
    printf "%d %d %d %d %d %d\n", count, capacity, bound, ipv4, ipv6, other
}
