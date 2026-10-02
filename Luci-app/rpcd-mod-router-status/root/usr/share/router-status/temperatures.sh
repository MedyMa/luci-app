#!/bin/sh

temperature_records() {
    local sensor type value now input
    now=$1
    for sensor in "${THERMAL_ROOT:-/sys/class/thermal}"/thermal_zone*; do
        [ -r "$sensor/type" ] && [ -r "$sensor/temp" ] || continue
        read -r type < "$sensor/type" || continue
        case "$type" in cpu-thermal|cpu_thermal|soc-thermal|soc_thermal|mt7988*) : ;; *) continue ;; esac
        read -r value < "$sensor/temp" || continue
        printf 'cpu\t%s\t%s\t%s\n' "$type" "$value" "$now"
    done
    for sensor in "${HWMON_ROOT:-/sys/class/hwmon}"/hwmon*; do
        [ -r "$sensor/name" ] || continue
        read -r type < "$sensor/name" || continue
        case "$type" in nvme|drivetemp) : ;; *) continue ;; esac
        for input in "$sensor"/temp*_input; do
            [ -r "$input" ] || continue
            read -r value < "$input" || continue
            printf 'disk\t%s\t%s\t%s\n' "$type" "$value" "$now"
        done
    done
    if [ -r "$STATE_DIR/wifi-temperatures.tsv" ]; then
        awk -F '\t' 'NF == 3 && $1 ~ /^[0-9]+$/ && $2 ~ /^[A-Za-z0-9_.-]+$/ &&
            $3 ~ /^[0-9]+$/ && $3 <= 150 { print "wifi\t" $2 "\t" $3 * 1000 "\t" $1 }' \
            "$STATE_DIR/wifi-temperatures.tsv"
    fi
}

get_temperatures() {
    local records old_ifs now sensor
    now=${TEMPERATURE_NOW:-$(date +%s)}
    records=$(temperature_records "$now" | awk -F '\t' -v now="$now" '
        NF == 4 && $1 ~ /^(cpu|wifi|disk)$/ && $2 ~ /^[A-Za-z0-9_.-]+$/ &&
        $3 ~ /^-?[0-9]+$/ && $4 ~ /^[0-9]+$/ &&
        $3 >= -20000 && $3 <= 150000 && $4 <= now && now-$4 <= 180 {
            printf "%s|%s|%.1f|%s\n", $1, $2, $3/1000, $4
        }')
    json_add_string sampled_at "$now"
    json_add_array temperatures
    for sensor in $records; do
        old_ifs=$IFS; IFS='|'; set -- $sensor; IFS=$old_ifs
        json_add_object ''
        json_add_string kind "$1"
        json_add_string name "$2"
        json_add_string celsius "$3"
        json_add_string sampled_at "$4"
        json_close_object
    done
    json_close_array
}
