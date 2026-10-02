BEGIN {
    tx_ok = tx_fail = rx_ok = rx_crc = temperature = -1
    OFS = "\t"
}

function first_number(value, parts, count, number) {
    count = split(value, parts, /[^0-9]/)
    for (number = 1; number <= count; number++)
        if (parts[number] != "") return parts[number] + 0
    return -1
}

/^Tx success[[:space:]]*=/ { tx_ok = first_number($0); next }
/^Tx fail count[[:space:]]*=/ { tx_fail = first_number($0); next }
/^Rx success[[:space:]]*=/ { rx_ok = first_number($0); next }
/^Rx with CRC[[:space:]]*=/ { rx_crc = first_number($0); next }

/^CurrentTemperature[[:space:]]*=/ {
    value = $0
    sub(/^[^=]*=[[:space:]]*/, "", value)
    sub(/[[:space:]]*$/, "", value)
    if (value ~ /^[0-9]+$/ && value + 0 <= 150) temperature = value + 0
    next
}

END { print tx_ok, tx_fail, rx_ok, rx_crc, temperature }
