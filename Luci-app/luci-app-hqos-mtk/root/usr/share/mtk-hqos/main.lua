-- SPDX-License-Identifier: GPL-2.0-only
package.path = "/usr/share/?.lua;" .. package.path
local runtime = require "mtk-hqos.runtime"
local json = require "luci.jsonc"
local nixio = require "nixio"
if nixio.geteuid() ~= 0 then io.stderr:write("mtk-hqos: root required\n"); os.exit(1) end
local action = arg[1]
local ok, result = pcall(function()
	if action == "status" then return runtime.status() end
	if action == "apply" or action == "refresh" then return runtime.apply(action == "refresh") end
	if action == "stop" then return runtime.stop() end
	if action == "migrate" then return runtime.migrate() end
	error("unsupported command", 0)
end)
if not ok then
	pcall(runtime.error, result)
	io.stderr:write("mtk-hqos: ", tostring(result), "\n")
	if action == "status" then print(json.stringify({ schema = 1, error = tostring(result), applied = false })) end
	os.exit(1)
end
if action == "status" then print(json.stringify(result)) end
