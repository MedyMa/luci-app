-- SPDX-License-Identifier: GPL-2.0-only
package.path = "/usr/share/?.lua;" .. package.path
local json = require "luci.jsonc"
local runtime
local action = arg[1]
local ok, result = pcall(function()
	local nixio = require "nixio"
	if nixio.getuid() ~= 0 then error("root required", 0) end
	runtime = require "mtk-hqos.runtime"
	if action == "status" then return runtime.status() end
	if action == "apply" or action == "refresh" then return runtime.apply(action == "refresh") end
	if action == "stop" then return runtime.stop() end
	if action == "migrate" then return runtime.migrate() end
	error("unsupported command", 0)
end)
if not ok then
	io.stderr:write("mtk-hqos: ", tostring(result), "\n")
	if action == "status" then
		-- Status errors are reply data; do not overwrite the last apply error.
		print(json.stringify({ schema = 1, error = tostring(result), applied = false }))
		os.exit(0)
	end
	if runtime then pcall(runtime.error, result) end
	os.exit(1)
end
if action == "status" then print(json.stringify(result)) end
