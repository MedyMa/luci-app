# Keep the latest sample per consecutive five-minute segment of each radio.
# Clock rollback may revisit a bucket: retain that new segment, as the RPC does.
BEGIN { OFS = "\t" }
$1 == "H" { sub(/^H\t/, "") }
NF == 6 && $1 ~ /^[0-9]+$/ && $1 + 0 >= cutoff &&
$2 ~ /^[A-Za-z0-9_.-]+$/ && $3 ~ /^[0-9]+$/ && $4 ~ /^[0-9]+$/ &&
($5 == "-" || $5 ~ /^[0-9]+(\.[0-9]+)?$/) &&
($6 == "-" || $6 ~ /^[0-9]+(\.[0-9]+)?$/) {
    name = $2
    bucket = int($1 / 300)
    if (!(name in last_bucket) || bucket != last_bucket[name])
        last_position[name] = ++count
    last_bucket[name] = bucket
    record[last_position[name]] = $0
}
END {
    first = count > 12000 ? count - 11999 : 1
    for (i = first; i <= count; i++) print record[i]
}
