BEGIN { OFS = "\t" }

$1 == "P" && NF == 9 {
    name = $2
    previous_time[name] = $3 + 0
    previous_tx_ok[name] = $4 + 0
    previous_tx_fail[name] = $5 + 0
    previous_rx_ok[name] = $6 + 0
    previous_rx_crc[name] = $7 + 0
    previous_rx_bytes[name] = $8 + 0
    previous_tx_bytes[name] = $9 + 0
    seen[name] = 1
    next
}

$1 == "C" && NF == 9 {
    name = $2
    at = $3 + 0
    tx_ok = $4 + 0
    tx_fail = $5 + 0
    rx_ok = $6 + 0
    rx_crc = $7 + 0
    rx_bytes = $8 + 0
    tx_bytes = $9 + 0
    print "N", name, at, tx_ok, tx_fail, rx_ok, rx_crc, rx_bytes, tx_bytes

    if (!seen[name] || at <= previous_time[name]) next
    elapsed = at - previous_time[name]
    rx_delta = rx_bytes - previous_rx_bytes[name]
    tx_delta = tx_bytes - previous_tx_bytes[name]
    if (rx_delta < 0 || tx_delta < 0 || elapsed > 300) next

    tx_percent = "-"
    if (tx_ok >= 0 && tx_fail >= 0 &&
        previous_tx_ok[name] >= 0 && previous_tx_fail[name] >= 0) {
        ok_delta = tx_ok - previous_tx_ok[name]
        fail_delta = tx_fail - previous_tx_fail[name]
        if (ok_delta >= 0 && fail_delta >= 0 && ok_delta + fail_delta > 0)
            tx_percent = sprintf("%.1f", 100 * fail_delta / (ok_delta + fail_delta))
    }

    rx_percent = "-"
    if (rx_ok >= 0 && rx_crc >= 0 &&
        previous_rx_ok[name] >= 0 && previous_rx_crc[name] >= 0) {
        ok_delta = rx_ok - previous_rx_ok[name]
        crc_delta = rx_crc - previous_rx_crc[name]
        if (ok_delta >= 0 && crc_delta >= 0 && ok_delta + crc_delta > 0)
            rx_percent = sprintf("%.1f", 100 * crc_delta / (ok_delta + crc_delta))
    }

    print "H", at, name, sprintf("%.0f", rx_delta / elapsed),
        sprintf("%.0f", tx_delta / elapsed), tx_percent, rx_percent
}
