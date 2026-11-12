-- SPDX-License-Identifier: GPL-2.0-only
local fs = require "nixio.fs"
local nixio = require "nixio"
local json = require "luci.jsonc"
local uci = require("uci").cursor()
local core = require "mtk-hqos.core"
local M = {}
local HNAT, STATE = "/sys/kernel/debug/hnat", "/var/run/mtk-hqos"
local IFB, HANDLE = "ifb-hqos", "a110:"
local function fail(message) error(message, 0) end
local function trim(text) return (text or ""):gsub("^%s+", ""):gsub("%s+$", "") end
local function read(path, limit)
	local file = io.open(path, "r")
	if not file then return nil end
	local content = file:read((limit or 16384) + 1); file:close()
	if content and #content > (limit or 16384) then return nil end
	return content
end
local function quote(value) return "'" .. tostring(value):gsub("'", "'\\''") .. "'" end
local function command(arguments)
	local out = {}; for _, value in ipairs(arguments) do out[#out + 1] = quote(value) end
	return table.concat(out, " ")
end
local function run(arguments, quiet)
	return os.execute(command(arguments) .. (quiet == false and "" or " >/dev/null 2>&1")) == 0
end
local function must(arguments) if not run(arguments) then fail("命令执行失败：" .. tostring(arguments[1])) end end
local function capture(arguments, limit)
	local pipe = io.popen(command(arguments) .. " 2>/dev/null", "r")
	if not pipe then return nil end
	local result = pipe:read((limit or 262144) + 1); pipe:close()
	if result and #result > (limit or 262144) then return nil end
	return result
end
local function mkdir()
	if not fs.stat(STATE) then assert(fs.mkdir(STATE, 448), "无法创建状态目录") end
	assert(fs.chmod(STATE, 448), "无法保护状态目录")
end
local function atomic(path, content)
	local temporary = path .. "." .. nixio.getpid()
	local file = assert(io.open(temporary, "w"), "无法写入运行状态")
	local ok = file:write(content); local closed = file:close()
	if not ok or not closed then fs.unlink(temporary); fail("无法保存运行状态") end
	fs.chmod(temporary, 384)
	assert(fs.rename(temporary, path), "无法发布运行状态")
end
local function decode(path) return json.parse(read(path, 1048576) or "") end
local function save(path, data)
	local encoded = assert(json.stringify(data))
	if #encoded > 1048576 then fail("运行状态超过 1 MiB，无法安全保存") end
	atomic(path, encoded)
end
local function write(node, value)
	local file = io.open(HNAT .. "/" .. node, "w")
	if not file then fail("无法写入 HNAT 接口 " .. node) end
	local ok = file:write(value); local closed = file:close()
	if not ok or not closed then fail("HNAT 拒绝配置 " .. node) end
end
local function qos_status()
	local out = {}
	for key, value in (read(HNAT .. "/qos_status") or ""):gmatch("([%w_]+)=([%w]+)") do out[key] = tonumber(value) or value end
	return out
end
local function queue(id)
	local content = read(HNAT .. "/qdma_txq" .. id)
	if not content then return nil end
	local result = { id = id, scheduler = tonumber(content:match("scheduler:%s*(%d+)")), hw_resv = tonumber(content:match("hw resv:%s*(%d+)")), sw_resv = tonumber(content:match("sw resv:%s*(%d+)")) }
	result.max_enable, result.rate, result.weight = content:match("max%s+(%d+)%s+(%d+)%s+(%d+)")
	result.min_enable, result.min_rate = content:match("min%s+(%d+)%s+(%d+)")
	for _, key in ipairs({ "max_enable", "rate", "weight", "min_enable", "min_rate" }) do result[key] = tonumber(result[key]) end
	if not result.scheduler or not result.hw_resv or not result.sw_resv or not result.rate or not result.min_rate or not result.weight then return nil end
	result.packets = tonumber(content:match("packet count:%s*(%d+)"))
	result.bytes = tonumber(content:match("bytes count:%s*(%d+)"))
	result.drops = tonumber(content:match("packet drop:%s*(%d+)"))
	return result
end
local function scheduler(id)
	local content = read(HNAT .. "/qdma_sch" .. id)
	if not content then return nil end
	local enable, mode, rate = content:match("\n([01])%s+(%u+)%s+(%d+)")
	if not enable or (mode ~= "SP" and mode ~= "WRR") then return nil end
	return { id = id, enable = tonumber(enable), mode = mode:lower(), rate = tonumber(rate) }
end
local function caps()
	local status = qos_status()
	local result = { queues = {}, schedulers = {}, queue_mask = status.queue_mask or 0, queue_first = status.queue_first or 16, hnat_enabled = trim(read(HNAT .. "/hook_toggle")) == "enabled", control = status.control_abi == 1 and status.software_mark == 128 and status.packet_mark == 16384 and fs.access(HNAT .. "/qos_control"), mode = status.mode, dscp = status.dscp_mapping }
	-- Broken symlinks are not queues. Do not infer a contiguous ID space.
	for id = 0, 63 do local item = queue(id); if item then result.queues[#result.queues + 1] = item end end
	for id = 0, 3 do local item = scheduler(id); if item then result.schedulers[#result.schedulers + 1] = item end end
	result.usable = result.hnat_enabled and result.control and result.dscp == 0 and #result.queues > 1
	return result
end
local function configuration()
	local result = { global = uci:get_all("mtk-hqos", "global") or {}, rules = {} }
	uci:foreach("mtk-hqos", "rule", function(section)
		section.id = section[".name"]; result.rules[#result.rules + 1] = section
	end)
	return result
end
local function list(value, fallback)
	if type(value) == "table" then return value end
	local out = {}; for entry in tostring(value or fallback or ""):gmatch("%S+") do out[#out + 1] = entry end
	return out
end
local function resolve(config)
	local result = { lan = {}, wan = {}, hosts = {} }
	local function network(name, into)
		if not name:match("^[%w_-]+$") or #name > 32 then fail("网络名称无效") end
		local data = json.parse(capture({ "/bin/ubus", "call", "network.interface." .. name, "status" }) or "")
		if data and data.up and (data.l3_device or data.device) then into[data.l3_device or data.device] = true end
	end
	local lans, wans = {}, {}
	for _, name in ipairs(list(config.global.lan, "lan")) do network(name, lans) end
	for _, name in ipairs(list(config.global.wan, "wan wan6")) do network(name, wans) end
	for dev in pairs(lans) do result.lan[#result.lan + 1] = dev end
	for dev in pairs(wans) do if not lans[dev] then result.wan[#result.wan + 1] = dev end end
	local seen = {}
	local function host(mac, address)
		local ok, normalized = pcall(core.mac, mac)
		if not ok or not address or not address:match("^[%x:.]+$") then return end
		local valid, value, key = pcall(core.address, address, address:find(":", 1, true) and "ip6" or "ip")
		if valid then seen[key] = { mac = normalized, address = value } end
	end
	for line in (read("/tmp/dhcp.leases", 262144) or ""):gmatch("[^\n]+") do
		local expiry, mac, ip = line:match("^(%d+)%s+(%S+)%s+(%S+)")
		if expiry and (tonumber(expiry) == 0 or tonumber(expiry) >= os.time()) then host(mac, ip) end
	end
	for _, dev in ipairs(result.lan) do
		for _, family in ipairs({ "-4", "-6" }) do
			local neighbors = json.parse(capture({ "/sbin/ip", "-j", family, "neigh", "show", "dev", dev }) or "") or {}
			for _, neighbor in ipairs(neighbors) do
				local failed = false
				for _, state in ipairs(neighbor.state or {}) do if state == "FAILED" or state == "INCOMPLETE" then failed = true end end
				if not failed and neighbor.lladdr and neighbor.dst then host(neighbor.lladdr, neighbor.dst) end
			end
		end
	end
	for _, item in pairs(seen) do
		result.hosts[item.mac] = result.hosts[item.mac] or {}
		result.hosts[item.mac][#result.hosts[item.mac] + 1] = item.address
	end
	return result
end
local function qargs(item) return table.concat({ item.scheduler, item.min_enable, item.min_rate, item.max_enable, item.rate, item.weight, item.hw_resv }, " ") end
local function sargs(item) return item.enable .. " " .. item.mode .. " " .. item.rate end
local function quantize(value)
	local power = 1; while value > 127 do value = math.floor(value / 10); power = power * 10 end
	return value * power
end
local function expected(plan, baseline)
	local result = { queues = {}, schedulers = {}, mode = plan.control and 1 or baseline.mode }
	local originals = {}; for _, item in ipairs(baseline.queues) do originals[item.id] = item end
	for _, target in ipairs(plan.queues) do
		local old = originals[target.id]
		if not old then fail("队列布局发生变化，请先停止服务") end
		result.queues[#result.queues + 1] = { id = target.id, direction = target.direction, scheduler = target.scheduler, min_enable = 0, min_rate = 0, max_enable = target.rate > 0 and 1 or 0, rate = quantize(target.rate), weight = 4, hw_resv = math.max(4, old.hw_resv), sw_resv = math.max(4, old.sw_resv) }
	end
	for _, target in ipairs(plan.schedulers) do result.schedulers[#result.schedulers + 1] = { id = target.id, enable = target.rate > 0 and 1 or 0, rate = quantize(target.rate), mode = "wrr" } end
	return result
end
local function same_queue(a, b)
	return a and b and qargs(a) == qargs(b) and a.sw_resv == b.sw_resv
end
local function hardware_verify(state)
	local expected_state = state.expected or {}
	local status = qos_status()
	if state.plan.control and (status.mode ~= expected_state.mode or status.packet_owned ~= 1 or status.dscp_mapping ~= 0) then return nil, "HNAT QoS 模式已被其他服务修改" end
	for _, target in ipairs(expected_state.queues or {}) do if not same_queue(queue(target.id), target) then return nil, "硬件队列配置发生变化：" .. target.id end end
	for _, target in ipairs(expected_state.schedulers or {}) do
		local current = scheduler(target.id)
		if not current or sargs(current) ~= sargs(target) then return nil, "硬件调度器配置发生变化：" .. target.id end
	end
	return true
end
local function verify(state)
	local ok, message = hardware_verify(state)
	if not ok then return nil, message end
	if state.plan.control and trim(read(HNAT .. "/hook_toggle")) ~= "enabled" then return nil, "HNAT 已关闭" end
	if state.plan.software then
		local owned = decode(STATE .. "/tc.json")
		if not owned or not fs.stat("/sys/class/net/" .. IFB) then return nil, "软件整形接口不可用" end
	end
	if not run({ "/usr/sbin/nft", "list", "table", "inet", "mtk_hqos" }) then return nil, "限速标记规则不可用" end
	return true
end
local function nft_apply(text)
	local exists = run({ "/usr/sbin/nft", "list", "table", "inet", "mtk_hqos" })
	atomic(STATE .. "/pending.nft", (exists and "delete table inet mtk_hqos\n" or "") .. text)
	if not run({ "/usr/sbin/nft", "-c", "-f", STATE .. "/pending.nft" }) then fail("nftables 规则校验失败") end
	must({ "/usr/sbin/nft", "-f", STATE .. "/pending.nft" })
end
local function tc_exists(dev, needle)
	return (capture({ "/sbin/tc", "qdisc", "show", "dev", dev }, 32768) or ""):find(needle, 1, true) ~= nil
end
local function tc_stop()
	local owned = decode(STATE .. "/tc.json")
	if not owned then return end
	if tc_exists(owned.dev, "htb " .. HANDLE) then must({ "/sbin/tc", "qdisc", "del", "dev", owned.dev, "root" }) end
	if owned.ingress then
		for _, protocol in ipairs({ "ip", "ipv6" }) do run({ "/sbin/tc", "filter", "del", "dev", owned.dev, "parent", "ffff:", "protocol", protocol, "pref", protocol == "ip" and "62010" or "62011" }) end
		if trim(capture({ "/sbin/tc", "filter", "show", "dev", owned.dev, "parent", "ffff:" })) == "" then run({ "/sbin/tc", "qdisc", "del", "dev", owned.dev, "ingress" }) end
	end
	if owned.ifb then run({ "/sbin/ip", "link", "del", "dev", IFB }) end
	fs.unlink(STATE .. "/tc.json")
end
local function tc_apply(plan)
	tc_stop()
	if not plan.software then return end
	local dev = plan.lan[1]
	local current = capture({ "/sbin/tc", "qdisc", "show", "dev", dev }) or ""
	for line in current:gmatch("[^\n]+") do
		if line:find(" root ", 1, true) and not line:match("^qdisc noqueue ") and not line:match("^qdisc noop ") then fail("LAN 接口已有其他整形服务") end
	end
	if current:find(" ingress ", 1, true) or current:find(" clsact ", 1, true) then fail("LAN 接口已有入口整形服务") end
	if fs.stat("/sys/class/net/" .. IFB) then fail("软件回退接口已被占用") end
	local owned = { dev = dev }; save(STATE .. "/tc.json", owned)
	must({ "/sbin/ip", "link", "add", IFB, "type", "ifb" }); owned.ifb = true; save(STATE .. "/tc.json", owned)
	must({ "/sbin/ip", "link", "set", "dev", IFB, "up" })
	for _, target in ipairs({ dev, IFB }) do
		must({ "/sbin/tc", "qdisc", "add", "dev", target, "root", "handle", HANDLE, "htb", "default", "1" })
		must({ "/sbin/tc", "class", "add", "dev", target, "parent", HANDLE, "classid", HANDLE .. "1", "htb", "rate", "10000mbit", "ceil", "10000mbit" })
	end
	must({ "/sbin/tc", "qdisc", "add", "dev", dev, "ingress" }); owned.ingress = true; save(STATE .. "/tc.json", owned)
	for _, protocol in ipairs({ "ip", "ipv6" }) do must({ "/sbin/tc", "filter", "add", "dev", dev, "parent", "ffff:", "protocol", protocol, "pref", protocol == "ip" and "62010" or "62011", "u32", "match", "u32", "0", "0", "action", "mirred", "egress", "redirect", "dev", IFB }) end
	local filters = 0
	for index, rule in ipairs(plan.rules) do if rule.path == "software" then
		for _, direction in ipairs({ "up", "down" }) do
			local limit = direction == "up" and rule.upload or rule.download
			if limit > 0 then
				local target = direction == "up" and IFB or dev
				local class = string.format("%x", index + 1)
				must({ "/sbin/tc", "class", "add", "dev", target, "parent", HANDLE, "classid", HANDLE .. class, "htb", "rate", limit .. "kbit", "ceil", limit .. "kbit" })
				local addresses = rule.addresses
				if rule.mac and direction == "up" then addresses = { { family = "ip", mac = rule.mac }, { family = "ip6", mac = rule.mac } } end
				if rule.kind == "port" and #addresses == 0 then addresses = { { family = "ip" }, { family = "ip6" } } end
				for _, address in ipairs(addresses) do
					local ports = #rule.ports > 0 and rule.ports or { false }
					local protocols = #rule.protocols > 0 and rule.protocols or { false }
					local fields = rule.port_side == "any" and { "src_port", "dst_port" } or { ((rule.port_side == "remote") == (direction == "up")) and "dst_port" or "src_port" }
					for _, port in ipairs(ports) do for _, protocol in ipairs(protocols) do for _, field in ipairs(fields) do
						filters = filters + 1; if filters > 1024 then fail("软件限速过滤器超过 1024 条") end
						local args = { "/sbin/tc", "filter", "add", "dev", target, "parent", HANDLE, "protocol", address.family == "ip" and "ip" or "ipv6", "pref", tostring(index + 10), "flower", "skip_hw" }
						if address.value then args[#args + 1] = direction == "up" and "src_ip" or "dst_ip"; args[#args + 1] = address.value end
						if address.mac then args[#args + 1] = "src_mac"; args[#args + 1] = address.mac end
						if protocol then args[#args + 1] = "ip_proto"; args[#args + 1] = protocol end
						if port then args[#args + 1] = field; args[#args + 1] = port end
						args[#args + 1] = "classid"; args[#args + 1] = HANDLE .. class
						must(args)
					end end end
				end
			end
		end
	end end
end
local function hardware_apply(plan, baseline)
	local target = expected(plan, baseline)
	baseline.dirty_queues = baseline.dirty_queues or {}
	baseline.dirty_schedulers = baseline.dirty_schedulers or {}
	for _, item in ipairs(target.queues) do baseline.dirty_queues[tostring(item.id)] = true end
	for _, item in ipairs(target.schedulers) do baseline.dirty_schedulers[tostring(item.id)] = true end
	save(STATE .. "/baseline.json", baseline)
	for _, item in ipairs(target.schedulers) do write("qdma_sch" .. item.id, sargs(item)) end
	for _, item in ipairs(target.queues) do write("qdma_txq" .. item.id, qargs(item)) end
	return target
end
local function baseline_restore(baseline, keep_mode)
	if baseline.control_owned and not keep_mode then write("qos_control", tostring(baseline.mode)) end
	for _, item in ipairs(baseline.schedulers or {}) do
		if (baseline.dirty_schedulers or {})[tostring(item.id)] then write("qdma_sch" .. item.id, sargs(item)) end
	end
	for _, item in ipairs(baseline.queues or {}) do
		if (baseline.dirty_queues or {})[tostring(item.id)] then write("qdma_txq" .. item.id, qargs(item)) end
	end
end
function M.stop()
	local baseline = decode(STATE .. "/baseline.json")
	local previous = decode(STATE .. "/state.json")
	if not baseline then
		if previous or fs.access(STATE .. "/tc.json") then fail("缺少原始配置快照，无法安全清理") end
		fs.unlink(STATE .. "/error"); fs.unlink(STATE .. "/pending.nft")
		return true
	end
	if previous and not fs.access(STATE .. "/applying") then
		local ok, message = hardware_verify(previous)
		if not ok then fail(message .. "，拒绝覆盖其他服务的配置") end
	end
	local mode = qos_status().mode
	if baseline.control and mode ~= 1 and mode ~= baseline.mode then fail("QoS 模式已被其他服务接管，拒绝覆盖") end
	tc_stop()
	if run({ "/usr/sbin/nft", "list", "table", "inet", "mtk_hqos" }) then must({ "/usr/sbin/nft", "delete", "table", "inet", "mtk_hqos" }) end
	baseline_restore(baseline)
	fs.unlink(STATE .. "/baseline.json"); fs.unlink(STATE .. "/state.json"); fs.unlink(STATE .. "/active")
	fs.unlink(STATE .. "/error"); fs.unlink(STATE .. "/pending.nft")
	fs.unlink(STATE .. "/applying")
	return true
end
function M.apply(refresh)
	local config = configuration()
	if not core.enabled(config.global.enabled) then return M.stop() end
	mkdir()
	local previous = decode(STATE .. "/state.json")
	local baseline = decode(STATE .. "/baseline.json")
	local current = caps()
	if previous and previous.plan.control and not current.hnat_enabled then fail("HNAT 已关闭，请恢复加速引擎后重试") end
	if not baseline and fs.access("/var/run/eqos.active") then fail("请先停止旧 EQoS 服务") end
	if not baseline and current.mode == 1 then fail("QDMA 已被其他 HQoS 服务占用") end
	if current.dscp == 1 then fail("请先关闭 DSCP 队列映射") end
	if baseline and not baseline.control and current.hnat_enabled then
		if not current.control or (current.mode ~= 0 and current.mode ~= 2) then fail("新启用的 HNAT 尚未就绪或已被其他服务接管") end
		baseline = { mode = current.mode, queues = current.queues, schedulers = current.schedulers, control = true }
		save(STATE .. "/baseline.json", baseline)
	end
	-- Re-plan against the saved unmodified pool, not our own rate-limited queues.
	local planning = current
	if baseline then
		planning = { queues = baseline.queues, schedulers = baseline.schedulers, queue_mask = current.queue_mask, queue_first = current.queue_first, hnat_enabled = current.hnat_enabled, control = current.control, usable = current.usable }
	end
	local plan = core.plan(config, planning, resolve(config))
	if #plan.rules == 0 and plan.total_up == 0 and plan.total_down == 0 then return M.stop() end
	uci:foreach("firewall", "defaults", function(section)
		if core.enabled(section.flow_offloading) or core.enabled(section.flow_offloading_hw) then fail("请关闭防火墙流量分载，避免绕过限速标记；MediaTek HNAT 可保持开启") end
	end)
	local fingerprint = core.nft(plan) .. "\n" .. plan.lan[1]
	for _, rule in ipairs(plan.rules) do fingerprint = fingerprint .. "\n" .. rule.id .. ":" .. rule.path .. ":" .. rule.download .. ":" .. rule.upload end
	fingerprint = fingerprint .. ":" .. plan.total_up .. ":" .. plan.total_down .. ":" .. tostring(plan.control)
	if previous and previous.fingerprint == fingerprint and verify(previous) then
		local changed = false
		for index, rule in ipairs(plan.rules) do
			if rule.name ~= previous.plan.rules[index].name or rule.engine ~= previous.plan.rules[index].engine then changed = true end
		end
		if changed then previous.plan = plan; save(STATE .. "/state.json", previous) end
		fs.unlink(STATE .. "/error")
		return true
	end
	if not baseline and run({ "/usr/sbin/nft", "list", "table", "inet", "mtk_hqos" }) then fail("同名 nftables 表不属于本服务") end
	if baseline and previous and not fs.access(STATE .. "/applying") then
		local ok, message = hardware_verify(previous)
		if not ok then fail(message .. "，请先停止服务后重试") end
	end
	if not baseline then
		if current.hnat_enabled and not current.control then fail("请更新支持 HQoS 控制接口的 HNAT 模块") end
		baseline = { mode = current.mode, queues = current.queues, schedulers = current.schedulers, control = current.control and current.hnat_enabled }
		if baseline.control and baseline.mode ~= 0 and baseline.mode ~= 2 then fail("HNAT QoS 状态无效") end
		save(STATE .. "/baseline.json", baseline)
	end
	local mutated = false
	local ok, result = pcall(function()
		local ruleset = core.nft(plan)
		-- nft -c runs before the first mutable TC/QDMA operation.
		local exists = run({ "/usr/sbin/nft", "list", "table", "inet", "mtk_hqos" })
		atomic(STATE .. "/pending.nft", (exists and "delete table inet mtk_hqos\n" or "") .. ruleset)
		if not run({ "/usr/sbin/nft", "-c", "-f", STATE .. "/pending.nft" }) then fail("nftables 规则校验失败") end
		atomic(STATE .. "/applying", "1\n")
		mutated = true
		tc_apply(plan)
		baseline_restore(baseline, true)
		local programmed = hardware_apply(plan, baseline)
		nft_apply(ruleset)
		-- Publish after marking rules exist. Retire FOE bindings, not conntrack.
		if plan.control then baseline.control_owned = true; save(STATE .. "/baseline.json", baseline); write("qos_control", "1") end
		local state = { plan = plan, expected = programmed, nft = ruleset, fingerprint = fingerprint, applied_at = os.time() }
		local valid, message = verify(state); if not valid then fail(message) end
		save(STATE .. "/state.json", state); atomic(STATE .. "/active", "1\n")
		fs.unlink(STATE .. "/error"); fs.unlink(STATE .. "/pending.nft")
		fs.unlink(STATE .. "/applying")
		return true
	end)
	if ok then return result end
	if not mutated then
		if not previous then fs.unlink(STATE .. "/baseline.json") end
		fs.unlink(STATE .. "/pending.nft")
		fail(result)
	end
	local restored = pcall(function()
		if previous then
			tc_apply(previous.plan); baseline_restore(baseline, true)
			previous.expected = hardware_apply(previous.plan, baseline); nft_apply(previous.nft)
			if previous.plan.control then write("qos_control", "1") end
			local valid, message = verify(previous); if not valid then fail(message) end
			save(STATE .. "/state.json", previous)
			fs.unlink(STATE .. "/applying")
		else M.stop() end
	end)
	if not restored then fs.unlink(STATE .. "/active"); result = tostring(result) .. "；回滚未完成，请停止服务重试" end
	fail(result)
end
function M.status()
	local config = configuration()
	local state = decode(STATE .. "/state.json")
	local hardware = caps()
	local valid, message
	if state then valid, message = verify(state) end
	local result = { schema = 1, enabled = core.enabled(config.global.enabled), applied = valid == true and fs.access(STATE .. "/active") or false, owned = fs.access(STATE .. "/baseline.json") or false, hnat = hardware.hnat_enabled, available = hardware.usable, total_queues = #hardware.queues, queue_mask = hardware.queue_mask, queues = {}, rules = {}, error = trim(read(STATE .. "/error", 1024)) }
	if state then
		result.applied_at = state.applied_at
		if not valid and result.error == "" then result.error = message or "状态校验失败" end
		for _, rule in ipairs(state.plan.rules) do
			result.rules[#result.rules + 1] = { id = rule.id, name = rule.name, path = rule.path, up_qid = rule.up_qid, down_qid = rule.down_qid, pending_address = rule.mac ~= nil and #rule.addresses == 0, upload = rule.upload, download = rule.download }
		end
		for _, target in ipairs(state.expected.queues) do
			local item = queue(target.id)
			if item then result.queues[#result.queues + 1] = { id = item.id, direction = target.direction, scheduler = item.scheduler, rate_kbps = item.max_enable == 1 and item.rate or 0, packets = item.packets, bytes = item.bytes, drops = item.drops, verified = same_queue(item, target) } end
		end
	end
	return result
end
function M.error(message)
	mkdir()
	local text = tostring(message):sub(1, 1000)
	if trim(read(STATE .. "/error", 1024)) ~= text then nixio.syslog("err", "mtk-hqos: " .. text:sub(1, 512)) end
	atomic(STATE .. "/error", text .. "\n")
end
function M.migrate()
	if uci:get("mtk-hqos", "global", "migrated") == "1" then return true end
	local existing = false
	uci:foreach("mtk-hqos", "rule", function() existing = true end)
	local old = uci:get_all("eqos", "config")
	if old and not existing then
		local backup = read("/etc/config/eqos", 262144)
		if backup and not fs.stat("/etc/config/mtk-hqos.eqos-backup") then atomic("/etc/config/mtk-hqos.eqos-backup", backup) end
		-- A live old backend owns its snapshot; never guess at those registers.
		if fs.access("/var/run/eqos/mode") or fs.access("/var/run/eqos.active") then
			if not run({ "/etc/init.d/eqos", "stop" }) then fail("请先停止旧 EQoS，再完成配置迁移") end
		end
		for _, key in ipairs({ "enabled", "download", "upload" }) do uci:set("mtk-hqos", "global", key, old[key] or "0") end
		uci:foreach("eqos", "device", function(source)
			local section = uci:add("mtk-hqos", "rule")
			uci:set("mtk-hqos", section, "enabled", source.enabled or "1")
			uci:set("mtk-hqos", section, "engine", tonumber(source.queue or source.comment or 0) and tonumber(source.queue or source.comment or 0) > 31 and "software" or "auto")
			local selector = source.ip6 and source.ip6 ~= "" and "ip6" or
				(source.mac and source.mac ~= "" and "mac" or "ip")
			uci:set("mtk-hqos", section, "selector", selector)
			if source.name and source.name ~= "" then uci:set("mtk-hqos", section, "name", source.name) end
			uci:set("mtk-hqos", section, selector, source[selector] or "")
			for _, key in ipairs({ "download", "upload" }) do uci:set("mtk-hqos", section, key, source[key] or "0") end
		end)
	end
	uci:set("mtk-hqos", "global", "migrated", "1")
	uci:save("mtk-hqos"); assert(uci:commit("mtk-hqos"), "无法保存迁移配置")
	return true
end
M.paths = { hnat = HNAT, state = STATE }
return M
