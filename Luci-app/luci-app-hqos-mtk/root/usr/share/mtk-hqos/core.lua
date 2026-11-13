-- SPDX-License-Identifier: GPL-2.0-only
-- Configuration and nftables planning. No commands or hardware writes here.
local M = {}
local function fail(message) error(message, 0) end
local function integer(value, low, high, label)
	local text = tostring(value or "0")
	if not text:match("^%d+$") or #text > 9 then fail(label .. " 必须为整数") end
	local n = tonumber(text)
	if n < low or n > high then fail(label .. " 超出范围") end
	return n
end
local function enabled(value) return value == true or value == "1" or value == "true" end
local function ipv4(value)
	local bytes = {}
	for octet in value:gmatch("[^.]+") do
		if not octet:match("^%d+$") or #octet > 3 or (#octet > 1 and octet:sub(1, 1) == "0") or tonumber(octet) > 255 then return nil end
		bytes[#bytes + 1] = tonumber(octet)
	end
	if #bytes ~= 4 or value:sub(1, 1) == "." or value:sub(-1) == "." or value:find("..", 1, true) then return nil end
	return bytes
end
function M.address(value, family)
	if type(value) ~= "string" or #value > 64 or value:find("[^%x:./]") then fail("IP 地址格式错误") end
	local address, prefix = value:match("^([^/]+)/(%d+)$")
	address = address or value
	local bytes
	if family == "ip" then
		bytes = ipv4(address)
		if not bytes then fail("IPv4 地址格式错误") end
		prefix = prefix and integer(prefix, 0, 32, "IPv4 前缀") or 32
	else
		if address:find(".", 1, true) then
			local tail = address:match("([^:]+)$")
			local v4 = tail and ipv4(tail)
			if not v4 then fail("IPv6 地址格式错误") end
			address = address:sub(1, #address - #tail) .. string.format("%x:%x", v4[1] * 256 + v4[2], v4[3] * 256 + v4[4])
		end
		if address:find(":::", 1, true) then fail("IPv6 地址格式错误") end
		local start = address:find("::", 1, true)
		if start and address:find("::", start + 2, true) then fail("IPv6 地址格式错误") end
		local words = {}
		for word in address:gmatch("[^:]+") do
			if #word > 4 or not word:match("^%x+$") then fail("IPv6 地址格式错误") end
			words[#words + 1] = tonumber(word, 16)
		end
		if start then
			if #words >= 8 then fail("IPv6 地址格式错误") end
			local before = 0
			for _ in address:sub(1, start - 1):gmatch("[^:]+") do before = before + 1 end
			while #words < 8 do table.insert(words, before + 1, 0) end
		elseif #words ~= 8 or address:sub(1, 1) == ":" or address:sub(-1) == ":" then fail("IPv6 地址格式错误") end
		bytes = {}
		for _, word in ipairs(words) do bytes[#bytes + 1] = math.floor(word / 256); bytes[#bytes + 1] = word % 256 end
		prefix = prefix and integer(prefix, 0, 128, "IPv6 前缀") or 128
	end
	local canonical = {}
	for i, byte in ipairs(bytes) do
		local remaining = math.max(0, math.min(8, prefix - (i - 1) * 8))
		canonical[i] = string.format("%02x", math.floor(byte / 2 ^ (8 - remaining)) * 2 ^ (8 - remaining))
	end
	return value:lower(), table.concat(canonical) .. "/" .. prefix
end
function M.mac(value)
	value = tostring(value or ""):lower()
	if not value:match("^%x%x:%x%x:%x%x:%x%x:%x%x:%x%x$") or tonumber(value:sub(1, 2), 16) % 2 ~= 0 or value == "00:00:00:00:00:00" then fail("MAC 地址必须为有效的单播地址") end
	return value
end
local function rate(value, label, mbit)
	if mbit then
		local text = tostring(value or "0")
		if not text:match("^%d+%.?%d*$") or #text > 12 then fail(label .. " 格式错误") end
		local n = tonumber(text) * 1000
		if n < 0 or n > 10000000 or math.abs(n - math.floor(n + 0.5)) > 0.00001 then fail(label .. " 范围为 0–10000 Mbit/s，最多三位小数") end
		return math.floor(n + 0.5)
	end
	return integer(value, 0, 10000000, label)
end
local function port_list(value)
	local out = {}
	value = tostring(value or ""):gsub("%s", "")
	if value == "" or #value > 160 or value:sub(-1) == "," or value:find(",,", 1, true) then fail("端口格式错误") end
	for term in value:gmatch("[^,]+") do
		local first, last = term:match("^(%d+)[-:](%d+)$")
		if not first then first = term; last = term end
		first = integer(first, 1, 65535, "端口"); last = integer(last, first, 65535, "端口")
		out[#out + 1] = first == last and tostring(first) or first .. "-" .. last
	end
	if #out == 0 or #out > 16 then fail("每条规则最多配置 16 个端口或端口段") end
	return out
end
M.enabled = enabled
local function interfaces(values)
	local result = {}
	for _, value in ipairs(values or {}) do
		if type(value) ~= "string" or #value > 15 or not value:match("^[%w_.:@-]+$") then fail("网络接口名称无效") end
		result[#result + 1] = value
	end
	table.sort(result)
	return result
end
function M.plan(config, caps, resolved)
	local global = config.global or {}
	local plan = { enabled = enabled(global.enabled), rules = {}, queues = {}, schedulers = {}, lan = interfaces(resolved.lan), wan = interfaces(resolved.wan), total_down = rate(global.download, "总下载", true), total_up = rate(global.upload, "总上传", true), software = false, hardware = false }
	if not plan.enabled then return plan end
	if #(config.rules or {}) > 128 then fail("最多支持 128 条规则") end
	local seen = {}
	for index, source in ipairs(config.rules or {}) do
		if source.enabled ~= "0" then
			local rule = { id = source.id or tostring(index), name = tostring(source.name or ""), kind = source.selector or "ip", engine = source.engine or "auto", download = rate(source.download, "下载"), upload = rate(source.upload, "上传"), addresses = {}, mac = nil, protocols = {}, ports = {}, port_side = source.port_side or "remote" }
			if not rule.id:match("^[%w_]+$") or #rule.name > 80 or rule.name:find("[%z\1-\31]") then fail("规则名称无效") end
			if rule.engine ~= "auto" and rule.engine ~= "hardware" and rule.engine ~= "software" then fail("限速方式无效") end
			if rule.download > 0 or rule.upload > 0 then
				local key
				if rule.kind == "ip" or rule.kind == "ip6" then
					local address, canonical = M.address(source[rule.kind], rule.kind)
					rule.addresses[1] = { family = rule.kind, value = address }; key = rule.kind .. canonical
				elseif rule.kind == "mac" then
					rule.mac = M.mac(source.mac); key = "mac" .. rule.mac
					for _, address in ipairs((resolved.hosts or {})[rule.mac] or {}) do
						local family = address:find(":", 1, true) and "ip6" or "ip"
						local ok, normalized = pcall(M.address, address, family)
						if ok then rule.addresses[#rule.addresses + 1] = { family = family, value = normalized } end
					end
					table.sort(rule.addresses, function(a, b) return a.value < b.value end)
					if #rule.addresses > 32 then fail("单个 MAC 地址过多，请改用网段匹配") end
				elseif rule.kind == "port" then
					rule.ports = port_list(source.ports)
					local protocol = source.proto or "both"
					if protocol ~= "tcp" and protocol ~= "udp" and protocol ~= "both" then fail("端口协议无效") end
					rule.protocols = protocol == "both" and { "tcp", "udp" } or { protocol }
					if rule.port_side ~= "local" and rule.port_side ~= "remote" and rule.port_side ~= "any" then fail("端口方向无效") end
					if source.address and source.address ~= "" then
						local family = source.address:find(":", 1, true) and "ip6" or "ip"
						local address = M.address(source.address, family)
						rule.addresses[1] = { family = family, value = address }
					end
					key = "port" .. protocol .. rule.port_side .. table.concat(rule.ports, ",") .. tostring(source.address or "")
				else fail("匹配类型无效") end
				if seen[key] then fail("存在重复的限速目标") end
				seen[key] = true
				plan.rules[#plan.rules + 1] = rule
			end
		end
	end
	if #plan.rules == 0 and plan.total_down == 0 and plan.total_up == 0 then return plan end
	if #plan.lan ~= 1 then fail("请选择一个已启用的 LAN 网络") end
	if #plan.wan == 0 then fail("请选择已启用的 WAN 网络") end
	local pool = {}
	for _, queue in ipairs(caps.queues or {}) do
		local default_min = queue.min_enable == 0 or (queue.min_enable == 1 and queue.min_rate == 10000)
		if queue.id >= (caps.queue_first or 16) and queue.id > 0 and queue.id < 63 and queue.id <= (caps.queue_mask or 0) and default_min and queue.max_enable == 0 and queue.hw_resv == queue.sw_resv then pool[#pool + 1] = queue.id end
	end
	table.sort(pool)
	local scheds, occupied, available = caps.schedulers or {}, {}, {}
	-- A scheduler is shared by every queue attached to it. Never change a
	-- live aggregate cap or a scheduler already referenced by another queue.
	for _, queue in ipairs(caps.queues or {}) do occupied[queue.scheduler or 0] = true end
	for _, item in ipairs(scheds) do
		if item.enable ~= 1 and not occupied[item.id] then available[#available + 1] = item.id end
	end
	table.sort(available)
	local hw = caps.usable and #available >= 2
	local up_sch, down_sch = available[#available - 1], available[#available]
	local position = 1
	local function allocate(direction, limit)
		local qid = pool[position]; position = position + 1
		if not qid then fail("可用硬件队列不足") end
		plan.queues[#plan.queues + 1] = { id = qid, direction = direction, scheduler = direction == "up" and up_sch or down_sch, rate = limit }
		return qid
	end
	plan.default_up, plan.default_down = 0, 0
	if plan.total_up > 0 or plan.total_down > 0 then
		if not hw or #scheds < 4 then fail("硬件转发总上限所需的 HNAT 或独立调度器不可用") end
		if plan.total_up > 0 then plan.default_up = allocate("up", 0) end
		if plan.total_down > 0 then plan.default_down = allocate("down", 0) end
		plan.hardware = true
	end
	local function choose(rule)
		local needed = (rule.upload > 0 and 1 or 0) + (rule.download > 0 and 1 or 0)
		local fits = hw and position + needed - 1 <= #pool
		if rule.engine == "hardware" and not fits then fail("规则 " .. rule.id .. " 无可用硬件队列、独立调度器或 HNAT 未就绪") end
		rule.path = rule.engine ~= "software" and fits and "hardware" or "software"
		if rule.path == "hardware" then
			plan.hardware = true
			rule.up_qid = rule.upload > 0 and allocate("up", rule.upload) or plan.default_up
			rule.down_qid = rule.download > 0 and allocate("down", rule.download) or plan.default_down
		else plan.software = true end
	end
	-- Explicit hardware rules take capacity before automatic fallback rules.
	for _, rule in ipairs(plan.rules) do if rule.engine == "hardware" then choose(rule) end end
	for _, rule in ipairs(plan.rules) do if rule.engine ~= "hardware" then choose(rule) end end
	if plan.software and caps.hnat_enabled and not caps.control then fail("软件回退需要更新 HNAT 的 QoS 标记接口") end
	local filters = 0
	for _, rule in ipairs(plan.rules) do if rule.path == "software" then
		for _, direction in ipairs({ "up", "down" }) do
			if (direction == "up" and rule.upload or rule.download) > 0 then
				local addresses = rule.mac and direction == "up" and 2 or #rule.addresses
				if rule.kind == "port" and addresses == 0 then addresses = 2 end
				filters = filters + addresses * math.max(1, #rule.ports) * math.max(1, #rule.protocols) * (rule.port_side == "any" and 2 or 1)
			end
		end
	end end
	if filters > 1024 then fail("软件限速过滤器超过 1024 条，请减少端口段或使用网段匹配") end
	if plan.hardware then
		plan.schedulers = { { id = up_sch, rate = plan.total_up }, { id = down_sch, rate = plan.total_down } }
	end
	plan.control = caps.hnat_enabled and (plan.hardware or plan.software)
	return plan
end
local function quoted(value) return '"' .. value:gsub('\\', '\\\\'):gsub('"', '\\"') .. '"' end
local function interface_set(values)
	local out = {}; for _, value in ipairs(values) do out[#out + 1] = quoted(value) end
	return "{ " .. table.concat(out, ", ") .. " }"
end
local function matches(rule, direction)
	local out, address = {}, direction == "up" and "saddr" or "daddr"
	if rule.mac and direction == "up" then out[1] = "ether saddr " .. rule.mac end
	for _, ip in ipairs(rule.addresses) do out[#out + 1] = ip.family .. " " .. address .. " " .. ip.value end
	if rule.kind == "port" then
		local scopes = #out > 0 and out or { "" }
		out = {}
		local port_fields = rule.port_side == "any" and { "sport", "dport" } or { ((rule.port_side == "remote") == (direction == "up")) and "dport" or "sport" }
		for _, scope in ipairs(scopes) do for _, protocol in ipairs(rule.protocols) do for _, field in ipairs(port_fields) do
			out[#out + 1] = scope .. " meta l4proto " .. protocol .. " th " .. field .. " { " .. table.concat(rule.ports, ", ") .. " }"
		end end end
	end
	return out
end
M.matches = matches
function M.nft(plan)
	local lines = { 'table inet mtk_hqos {', '\tcomment "Managed by luci-app-hqos-mtk"', '\tset selected { typeof ct id; flags dynamic,timeout; timeout 6h; size 16384; }', '\tset software { typeof ct id; flags dynamic,timeout; timeout 6h; size 16384; }', '\tcounter mark_conflicts { }', '\tcounter cache_hits { }' }
	local up, down, forward = {}, {}, {}
	local lan, wan = interface_set(plan.lan), interface_set(plan.wan)
	local function append(array, text) array[#array + 1] = "\t\t" .. text end
	-- Keep both halves of a software-limited connection out of HNAT, even
	-- with a one-sided limit or a MAC whose reply address is not known yet.
	append(forward, "iifname " .. lan .. " ct id @software update @software { ct id timeout 6h } meta mark set meta mark | 0x80 return")
	append(forward, "oifname " .. lan .. " ct id @software update @software { ct id timeout 6h } meta mark set meta mark | 0x80 return")
	append(up, "meta mark & 0xffff != 0 counter name mark_conflicts return")
	append(down, "meta mark & 0xffff != 0 counter name mark_conflicts return")
	for index, rule in ipairs(plan.rules) do
		for _, direction in ipairs({ "up", "down" }) do
			if rule.path == "hardware" or rule.path == "software" then
				local counter = "r" .. index .. "_" .. direction
				lines[#lines + 1] = "\tcounter " .. counter .. " { }"
				for _, match in ipairs(matches(rule, direction)) do
					if rule.path == "software" then
						append(forward, (direction == "up" and "iifname " or "oifname ") .. lan .. " " .. match .. " counter name " .. counter .. " update @software { ct id timeout 6h } meta mark set meta mark | 0x80 return")
					else
						local qid = direction == "up" and rule.up_qid or rule.down_qid
						local scope = direction == "up" and ("iifname " .. lan .. " oifname " .. wan) or ("iifname " .. wan .. " oifname " .. lan)
						append(forward, scope .. " meta mark & 0xffff == 0 " .. match .. " counter name " .. counter .. " meta mark set meta mark | " .. (0x4000 + qid) .. " goto save_" .. index .. "_" .. direction)
					end
				end
			end
		end
		if rule.path == "hardware" then
			for _, direction in ipairs({ "up", "down" }) do
				local original = direction == "up" and rule.up_qid or rule.down_qid
				local reply = direction == "up" and rule.down_qid or rule.up_qid
				lines[#lines + 1] = "\tchain save_" .. index .. "_" .. direction .. " {"
				for _, ct_direction in ipairs({ "original", "reply" }) do
					-- OpenWrt Lua uses signed 32-bit integers. Format each half
					-- separately so the validity bits never overflow %x.
					local high = 0x8000 + (ct_direction == "original" and original or reply)
					local low = 0x8000 + (ct_direction == "original" and reply or original)
					local value = string.format("0x%04x%04x", high, low)
					for _, guard in ipairs({ "ct mark & 0x803f803f == 0", "ct mark & 0x80008000 == 0x80008000" }) do
						lines[#lines + 1] = "\t\tct direction " .. ct_direction .. " " .. guard .. " ct mark set (ct mark & 0x7fc07fc0) | " .. value .. " update @selected { ct id timeout 6h } return"
					end
				end
				lines[#lines + 1] = "\t}"
			end
		end
	end
	local restore = { 0 }
	for _, queue in ipairs(plan.queues) do restore[#restore + 1] = queue.id end
	for _, chain in ipairs({ up, down }) do
		-- nft 1.0.x cannot OR two register expressions. The admitted QID pool
		-- is small, so restore a validated constant and preserve routing bits.
		for _, qid in ipairs(restore) do
			append(chain, "ct id @selected ct mark & 0x80008000 == 0x80008000 ct direction original ct mark & 0x003f0000 == " .. (qid * 65536) .. " counter name cache_hits meta mark set meta mark | " .. (0x4000 + qid) .. " return")
			append(chain, "ct id @selected ct mark & 0x80008000 == 0x80008000 ct direction reply ct mark & 0x3f == " .. qid .. " counter name cache_hits meta mark set meta mark | " .. (0x4000 + qid) .. " return")
		end
	end
	if plan.default_up > 0 then append(up, "counter meta mark set meta mark | " .. (0x4000 + plan.default_up)) end
	if plan.default_down > 0 then append(down, "counter meta mark set meta mark | " .. (0x4000 + plan.default_down)) end
	lines[#lines + 1] = "\tchain hardware_up {\n" .. table.concat(up, "\n") .. "\n\t}"
	lines[#lines + 1] = "\tchain hardware_down {\n" .. table.concat(down, "\n") .. "\n\t}"
	append(forward, "iifname " .. lan .. " oifname " .. wan .. " jump hardware_up")
	append(forward, "iifname " .. wan .. " oifname " .. lan .. " jump hardware_down")
	lines[#lines + 1] = "\tchain forward {\n\t\ttype filter hook forward priority -140; policy accept;\n" .. table.concat(forward, "\n") .. "\n\t}"
	lines[#lines + 1] = "}"
	local result = table.concat(lines, "\n") .. "\n"
	if #result > 262144 then fail("限速规则集超过 256 KiB，请减少重复地址或使用网段匹配") end
	return result
end
return M
