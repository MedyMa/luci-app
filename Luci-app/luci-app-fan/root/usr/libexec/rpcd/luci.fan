#!/bin/sh

. "${IPKG_INSTROOT}/usr/share/libubox/jshn.sh"

FAN_CONTROL="${IPKG_INSTROOT}/usr/libexec/fan-control"
SYSINFO_DIR="${IPKG_INSTROOT}/tmp/sysinfo"
SMART_MIN_MILLI=30000
SMART_MAX_MILLI=60000
SMART_MAX_RPM=3000
SMART_MAX_RPM_MIN=500
SMART_MAX_RPM_MAX=10000

is_uint() {
	case "$1" in
		''|*[!0-9]*)
			return 1
			;;
		*)
			return 0
			;;
	esac
}

read_mode() {
	local value

	value=$(uci -q get 'luci-fan.@luci-fan[0].mode' 2>/dev/null)

	case "$value" in
		turbo|smart|manual)
			printf '%s\n' "$value"
			;;
		*)
			printf '%s\n' 'smart'
			;;
	esac
}

read_trimmed() {
	local value

	[ -r "$1" ] || return 1
	value=$(cat "$1" 2>/dev/null) || return 1
	printf '%s' "$value" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

read_number() {
	local value

	value=$(read_trimmed "$1") || return 1
	[ -n "$value" ] || return 1
	value=$(printf '%s\n' "$value" | sed -n 's/[^0-9]*\([0-9][0-9]*\).*/\1/p' | head -n1)
	[ -n "$value" ] || return 1
	printf '%s\n' "$value"
}

find_rpm_candidate_in_dir() {
	local base candidate

	base=$1
	[ -n "$base" ] || return 1
	[ -d "$base" ] || return 1

	for candidate in "$base"/fan*_input "$base"/fan*_speed "$base"/fan*_rpm "$base"/rpm; do
		[ -r "$candidate" ] || continue
		printf '%s\n' "$candidate"
		return 0
	done

	return 1
}

get_uci_temp() {
	local value

	value=$(uci -q get "luci-fan.@luci-fan[0].$1" 2>/dev/null)
	is_uint "$value" || return 1
	printf '%s\n' "$value"
}

parse_celsius_to_milli() {
	awk -v value="$1" 'BEGIN {
		if (value == "" || value !~ /^([0-9]+([.][0-9]+)?|[.][0-9]+)$/)
			exit 1

		milli = int((value * 1000) + 0.5)
		if (milli < 0)
			exit 1

		printf "%d", milli
	}'
}

get_uci_temp_milli() {
	local value

	value=$(uci -q get "luci-fan.@luci-fan[0].$1" 2>/dev/null)
	[ -n "$value" ] || return 1
	parse_celsius_to_milli "$value"
}

clamp_uint() {
	local value minimum maximum

	value=$1
	minimum=$2
	maximum=$3

	[ "$value" -lt "$minimum" ] && value=$minimum
	[ "$value" -gt "$maximum" ] && value=$maximum
	printf '%s\n' "$value"
}

resolve_smart_window_milli() {
	local on_milli off_milli

	on_milli=$(get_uci_temp_milli on_temp) || on_milli=$SMART_MAX_MILLI
	off_milli=$(get_uci_temp_milli off_temp) || off_milli=$SMART_MIN_MILLI

	on_milli=$(clamp_uint "$on_milli" 100 150000)
	off_milli=$(clamp_uint "$off_milli" 0 149900)

	if [ "$on_milli" -le "$off_milli" ]; then
		if [ "$off_milli" -ge 149900 ]; then
			off_milli=149800
			on_milli=149900
		else
			on_milli=$((off_milli + 100))
		fi
	fi

	SMART_WINDOW_ON_MILLI=$on_milli
	SMART_WINDOW_OFF_MILLI=$off_milli
}

milli_to_celsius() {
	awk -v value="$1" 'BEGIN { printf "%.1f", value / 1000 }'
}


pwm_to_percent() {
	awk -v raw="$1" 'BEGIN { printf "%d", int((raw * 100 / 255) + 0.5) }'
}

percent_to_raw() {
	awk -v value="$1" 'BEGIN {
		raw = int((value * 255 / 100) + 0.5)
		if (raw < 0)
			raw = 0
		else if (raw > 255)
			raw = 255
		printf "%d", raw
	}'
}

estimate_rpm_from_raw() {
	awk -v raw="$1" -v max_rpm="${2:-$SMART_MAX_RPM}" 'BEGIN {
		if (raw == "" || raw < 0)
			raw = 0
		else if (raw > 255)
			raw = 255
		printf "%d", int((raw * max_rpm / 255) + 0.5)
	}'
}

clamp_rpm() {
	local value
	local max_rpm

	value=$1
	max_rpm=${2:-$SMART_MAX_RPM}
	is_uint "$value" || return 1
	[ "$value" -gt "$max_rpm" ] && value=$max_rpm
	printf '%s\n' "$value"
}

resolve_max_rpm() {
	local max_rpm

	max_rpm=$(get_uci_temp max_rpm) || max_rpm=$SMART_MAX_RPM
	max_rpm=$(clamp_uint "$max_rpm" "$SMART_MAX_RPM_MIN" "$SMART_MAX_RPM_MAX")
	CONFIGURED_MAX_RPM=$max_rpm
}

smart_pwm_raw() {
	local min_temp max_temp

	min_temp=${2:-$SMART_MIN_MILLI}
	max_temp=${3:-$SMART_MAX_MILLI}

	awk -v temp="$1" -v min_temp="$min_temp" -v max_temp="$max_temp" 'BEGIN {
		if (temp <= min_temp)
			raw = 0
		else if (temp >= max_temp)
			raw = 255
		else
			raw = int((((temp - min_temp) * 255) / (max_temp - min_temp)) + 0.5)

		if (raw < 0)
			raw = 0
		else if (raw > 255)
			raw = 255

		printf "%d", raw
	}'
}

compute_ratio() {
	awk -v current="$1" -v off="$2" -v next="$3" -v start="$4" 'BEGIN {
		ratio = 0

		if (current != "") {
			if (off != "" && next != "" && next > off)
				ratio = (current - off) / (next - off)
			else if (start != "" && start > 0)
				ratio = current / start
		}

		if (ratio < 0)
			ratio = 0
		else if (ratio > 1)
			ratio = 1

		printf "%.3f", ratio
	}'
}

resolve_pwm_rpm_path() {
	local candidate fallback hwmon pwm_device hwmon_device pwm_parent

	PWM_RPM_PATH=''

	candidate=$(find_rpm_candidate_in_dir "$PWM_HWMON") || candidate=''
	if [ -n "$candidate" ]; then
		PWM_RPM_PATH="$candidate"
		return 0
	fi

	pwm_device=$(readlink -f "$PWM_HWMON/device" 2>/dev/null) || pwm_device=''
	pwm_parent=$(dirname "$pwm_device" 2>/dev/null)

	for hwmon in "$pwm_device" "$pwm_device"/hwmon/hwmon* "$pwm_parent"/hwmon/hwmon*; do
		candidate=$(find_rpm_candidate_in_dir "$hwmon") || candidate=''
		if [ -n "$candidate" ]; then
			PWM_RPM_PATH="$candidate"
			return 0
		fi
	done

	for hwmon in "${IPKG_INSTROOT}"/sys/class/hwmon/hwmon*; do
		[ -d "$hwmon" ] || continue
		[ "$hwmon" = "$PWM_HWMON" ] && continue

		candidate=$(find_rpm_candidate_in_dir "$hwmon") || candidate=''
		[ -n "$candidate" ] || continue

		hwmon_device=$(readlink -f "$hwmon/device" 2>/dev/null) || hwmon_device=''

		if [ -n "$pwm_device" ] && [ -n "$hwmon_device" ]; then
			case "$hwmon_device" in
				"$pwm_device"|"$pwm_device"/*)
					PWM_RPM_PATH="$candidate"
					return 0
					;;
			esac

			case "$pwm_device" in
				"$hwmon_device"|"$hwmon_device"/*)
					PWM_RPM_PATH="$candidate"
					return 0
					;;
			esac
		fi

		[ -n "$fallback" ] || fallback="$candidate"
	done

	[ -n "$fallback" ] || return 1
	PWM_RPM_PATH="$fallback"
	return 0
}

resolve_pwm_hwmon() {
	local hwmon entry preferred fallback name

	[ -d "${IPKG_INSTROOT}/sys/class/hwmon" ] || return 1

	for hwmon in "${IPKG_INSTROOT}"/sys/class/hwmon/hwmon*; do
		[ -d "$hwmon" ] || continue
		[ -w "$hwmon/pwm1" ] || continue

		name=$(read_trimmed "$hwmon/name") || name=''
		entry="$hwmon|$name"

		case "$name" in
			pwmfan|pwm-fan|pwm_fan)
				preferred=$entry
				break
				;;
			*)
				[ -n "$fallback" ] || fallback=$entry
				;;
		esac
	done

	entry=${preferred:-$fallback}
	[ -n "$entry" ] || return 1

	PWM_HWMON=${entry%%|*}
	PWM_NAME=${entry#*|}
	PWM_PATH="$PWM_HWMON/pwm1"
	PWM_ENABLE_PATH=''
	PWM_RPM_PATH=''

	[ -w "$PWM_HWMON/pwm1_enable" ] && PWM_ENABLE_PATH="$PWM_HWMON/pwm1_enable"
	resolve_pwm_rpm_path || true
	return 0
}

read_pwm_runtime() {
	resolve_pwm_hwmon || return 1

	PWM_RAW=$(read_number "$PWM_PATH") || PWM_RAW=''
	PWM_ENABLE=''
	PWM_RPM=''
	PWM_PERCENT=''

	[ -n "$PWM_ENABLE_PATH" ] && PWM_ENABLE=$(read_trimmed "$PWM_ENABLE_PATH") || true
	[ -n "$PWM_RPM_PATH" ] && PWM_RPM=$(read_number "$PWM_RPM_PATH") || true
	[ -n "$PWM_RAW" ] && PWM_PERCENT=$(pwm_to_percent "$PWM_RAW") || true
	return 0
}

resolve_primary_thermal_zone() {
	local zone_path thermal_zone thermal_type fallback_zone fallback_type

	if [ -n "$ZONE" ]; then
		zone_path="${IPKG_INSTROOT}/sys/class/thermal/$ZONE"
		if [ -r "$zone_path/temp" ]; then
			PRIMARY_ZONE=$ZONE
			PRIMARY_THERMAL_TYPE=$(read_trimmed "$zone_path/type") || PRIMARY_THERMAL_TYPE=''
			return 0
		fi
	fi

	for thermal_zone in "${IPKG_INSTROOT}"/sys/class/thermal/thermal_zone*; do
		[ -d "$thermal_zone" ] || continue
		[ -r "$thermal_zone/temp" ] || continue

		thermal_type=$(read_trimmed "$thermal_zone/type") || thermal_type=''

		case "$thermal_type" in
			*cpu*|*soc*|*package*)
				PRIMARY_ZONE=${thermal_zone##*/}
				PRIMARY_THERMAL_TYPE=$thermal_type
				return 0
				;;
			*)
				if [ -z "$fallback_zone" ]; then
					fallback_zone=${thermal_zone##*/}
					fallback_type=$thermal_type
				fi
				;;
		esac
	done

	[ -n "$fallback_zone" ] || return 1
	PRIMARY_ZONE=$fallback_zone
	PRIMARY_THERMAL_TYPE=$fallback_type
	return 0
}

load_board_profile() {
	local lowered

	BOARD_NAME=$(read_trimmed "$SYSINFO_DIR/board_name") || BOARD_NAME=''
	MODEL_NAME=$(read_trimmed "$SYSINFO_DIR/model") || MODEL_NAME=''
	lowered=$(printf '%s %s\n' "$BOARD_NAME" "$MODEL_NAME" | tr '[:upper:]' '[:lower:]')

	if printf '%s\n' "$lowered" | grep -Eiq 'bpi[-[:space:]]*r4|mt7988'; then
		IS_BPI_R4=1
		PROFILE='bpi-r4'
	else
		IS_BPI_R4=0
		PROFILE='generic'
	fi
}

resolve_zone_trip() {
	set -- $($FAN_CONTROL get 2>/dev/null)
	[ -n "$1" ] && [ -n "$2" ] || return 1
	ZONE=$1
	TRIP=$2
	return 0
}

json_add_common() {
	json_add_string board_name "$BOARD_NAME"
	json_add_string model_name "$MODEL_NAME"
	json_add_boolean is_bpi_r4 "$IS_BPI_R4"
	json_add_string profile "$PROFILE"
	json_add_boolean enabled "$ENABLED"
	json_add_string mode "$MODE"
	json_add_int manual_pwm "$MANUAL_PWM"
	json_add_int poll_interval "$POLL_INTERVAL"
}

json_add_empty_runtime() {
	json_add_string zone ""
	json_add_string thermal_type ""
	json_add_string zone_temp ""
	json_add_string fan_on_temp ""
	json_add_string fan_off_temp ""
	json_add_string configured_on_temp ""
	json_add_string configured_off_temp ""
	json_add_string hysteresis ""
	json_add_string next_trip_temp ""
	json_add_string headroom ""
	json_add_string start_delta ""
	json_add_string load_ratio "0"
	json_add_string state "disabled"
	json_add_boolean thermal_supported 0
	json_add_boolean pwm_supported 0
	json_add_boolean mode_supported 0
	json_add_string hwmon_name ""
	json_add_string hwmon_path ""
	json_add_string pwm_raw ""
	json_add_string pwm_percent ""
	json_add_string pwm_enable_mode ""
	json_add_string fan_rpm ""
	json_add_string actual_fan_rpm ""
	json_add_string estimated_fan_rpm ""
	json_add_string rpm_source "unavailable"
	json_add_int fan_max_rpm "$SMART_MAX_RPM"
	json_add_string smart_min_temp ""
	json_add_string smart_max_temp ""
}

get_status() {
	local zone_path primary_zone_path
	local fan_on_temp zone_temp fan_off_temp next_trip_temp thermal_type headroom start_delta load_ratio
	local configured_on_milli configured_off_milli configured_max_rpm state
	local thermal_supported pwm_supported mode_supported runtime_error supported trip_point_value trip_supported
	local actual_fan_rpm estimated_fan_rpm display_fan_rpm rpm_source target_raw

	load_board_profile
	ENABLED=$(uci -q get luci-fan.@luci-fan[0].enabled 2>/dev/null)
	[ "$ENABLED" = '1' ] || ENABLED=0
	MODE=$(read_mode)
	MANUAL_PWM=$(get_uci_temp manual_pwm) || MANUAL_PWM=70
	POLL_INTERVAL=$(get_uci_temp poll_interval) || POLL_INTERVAL=3
	trip_point_value=0
	thermal_supported=0
	trip_supported=0
	pwm_supported=0
	runtime_error=''

	json_init
	json_add_common

	if resolve_primary_thermal_zone; then
		thermal_supported=1
		primary_zone_path="${IPKG_INSTROOT}/sys/class/thermal/$PRIMARY_ZONE"
		ZONE=$PRIMARY_ZONE
		zone_temp=$(read_number "$primary_zone_path/temp") || zone_temp=''
		thermal_type=$PRIMARY_THERMAL_TYPE
	else
		zone_temp=''
		thermal_type=''
	fi

	if [ -x "$FAN_CONTROL" ] && resolve_zone_trip; then
		trip_supported=1
		trip_point_value=$TRIP
	fi

	if [ "$thermal_supported" != '1' ] && [ -n "$ZONE" ]; then
		zone_path="${IPKG_INSTROOT}/sys/class/thermal/$ZONE"
		if [ -r "$zone_path/temp" ]; then
			thermal_supported=1
			zone_temp=$(read_number "$zone_path/temp") || zone_temp=''
			thermal_type=$(read_trimmed "$zone_path/type") || thermal_type=''
		fi
	fi

	resolve_smart_window_milli
	resolve_max_rpm
	configured_on_milli=$SMART_WINDOW_ON_MILLI
	configured_off_milli=$SMART_WINDOW_OFF_MILLI
	configured_max_rpm=$CONFIGURED_MAX_RPM
	fan_off_temp=$configured_off_milli
	fan_on_temp=$configured_on_milli
	next_trip_temp=$configured_on_milli

	if read_pwm_runtime; then
		pwm_supported=1
	fi

	mode_supported=0
	case "$MODE" in
		smart)
			if { [ "$thermal_supported" = '1' ] && [ "$pwm_supported" = '1' ]; } || [ "$trip_supported" = '1' ]; then
				mode_supported=1
			fi
			;;
		*)
			if [ "$pwm_supported" = '1' ]; then
				mode_supported=1
			fi
			;;
	esac

	actual_fan_rpm=''
	estimated_fan_rpm=''
	display_fan_rpm=''
	rpm_source='unavailable'

	if [ "$pwm_supported" = '1' ]; then
		if is_uint "$PWM_RPM"; then
			actual_fan_rpm=$(clamp_rpm "$PWM_RPM" "$configured_max_rpm")
			display_fan_rpm=$actual_fan_rpm
			rpm_source='actual'
		fi

		if is_uint "$PWM_RAW"; then
			estimated_fan_rpm=$(estimate_rpm_from_raw "$PWM_RAW" "$configured_max_rpm")
		elif [ "$ENABLED" = '1' ]; then
			case "$MODE" in
				turbo)
					target_raw=255
					;;
				manual)
					target_raw=$(percent_to_raw "$MANUAL_PWM")
					;;
				*)
					if [ -n "$zone_temp" ]; then
						target_raw=$(smart_pwm_raw "$zone_temp" "$configured_off_milli" "$configured_on_milli")
					fi
					;;
			esac

			if is_uint "$target_raw"; then
				estimated_fan_rpm=$(estimate_rpm_from_raw "$target_raw" "$configured_max_rpm")
			fi
		fi

		if is_uint "$estimated_fan_rpm"; then
			estimated_fan_rpm=$(clamp_rpm "$estimated_fan_rpm" "$configured_max_rpm")
		fi

		if [ -z "$display_fan_rpm" ] && is_uint "$estimated_fan_rpm"; then
			display_fan_rpm=$estimated_fan_rpm
			rpm_source='estimated'
		fi
	fi

	state='disabled'
	if [ "$ENABLED" = '1' ]; then
		if [ "$pwm_supported" = '1' ] && [ -n "$PWM_RAW" ]; then
			if [ "$PWM_RAW" -ge 200 ]; then
				state='active'
			elif [ "$PWM_RAW" -gt 0 ]; then
				state='transition'
			else
				state='standby'
			fi
		elif [ -n "$zone_temp" ] && [ "$zone_temp" -ge "$configured_on_milli" ]; then
			state='active'
		elif [ -n "$zone_temp" ] && [ "$zone_temp" -gt "$configured_off_milli" ]; then
			state='transition'
		else
			state='standby'
		fi
	fi

	headroom=''
	[ -n "$zone_temp" ] && headroom=$((configured_on_milli - zone_temp))
	start_delta=''
	[ -n "$zone_temp" ] && start_delta=$((configured_off_milli - zone_temp))
	load_ratio=$(compute_ratio "$zone_temp" "$configured_off_milli" "$configured_on_milli" "$configured_on_milli")
	supported=0
	if { [ "$thermal_supported" = '1' ] && [ "$pwm_supported" = '1' ]; } || [ "$trip_supported" = '1' ]; then
		supported=1
	fi

	if [ "$supported" != '1' ]; then
		if [ "$thermal_supported" != '1' ]; then
			runtime_error='No readable CPU thermal zone was detected.'
		elif [ "$pwm_supported" != '1' ] && [ "$trip_supported" != '1' ]; then
			runtime_error='No writable pwm-fan hwmon interface or compatible fallback thermal trip point was detected.'
		fi
	fi

	json_add_boolean supported "$supported"
	[ -n "$runtime_error" ] && json_add_string error "$runtime_error"
	json_add_string zone "$ZONE"
	json_add_int trip_point "$trip_point_value"
	json_add_string thermal_type "$thermal_type"
	json_add_string zone_temp "$(milli_to_celsius "$zone_temp")"
	json_add_string fan_on_temp "$(milli_to_celsius "$fan_on_temp")"
	json_add_string fan_off_temp "$(milli_to_celsius "$fan_off_temp")"
	json_add_string configured_on_temp "$(milli_to_celsius "$configured_on_milli")"
	json_add_string configured_off_temp "$(milli_to_celsius "$configured_off_milli")"
	json_add_string hysteresis ""
	json_add_string next_trip_temp "$(milli_to_celsius "$next_trip_temp")"
	json_add_string headroom "$( [ -n "$headroom" ] && milli_to_celsius "$headroom" )"
	json_add_string start_delta "$(milli_to_celsius "$start_delta")"
	json_add_string load_ratio "$load_ratio"
	json_add_string state "$state"
	json_add_boolean thermal_supported "$thermal_supported"
	json_add_boolean pwm_supported "$pwm_supported"
	json_add_boolean mode_supported "$mode_supported"
	json_add_string hwmon_name "$PWM_NAME"
	json_add_string hwmon_path "$PWM_HWMON"
	json_add_string pwm_raw "$PWM_RAW"
	json_add_string pwm_percent "$PWM_PERCENT"
	json_add_string pwm_enable_mode "$PWM_ENABLE"
	json_add_string fan_rpm "$display_fan_rpm"
	json_add_string actual_fan_rpm "$actual_fan_rpm"
	json_add_string estimated_fan_rpm "$estimated_fan_rpm"
	json_add_string rpm_source "$rpm_source"
	json_add_int fan_max_rpm "$configured_max_rpm"
	json_add_string smart_min_temp "$(milli_to_celsius "$configured_off_milli")"
	json_add_string smart_max_temp "$(milli_to_celsius "$configured_on_milli")"
	json_dump
	json_cleanup
}

case "$1" in
	list)
		json_init
		json_add_object getStatus
		json_close_object
		json_dump
		json_cleanup
		;;
	call)
		case "$2" in
			getStatus)
				get_status
				;;
		esac
		;;
esac
