-- ans.lua - decode the base64 DNS answer stored in an AdGuard Home querylog line.
--
--   stdin : one AGH querylog JSON object per line
--   stdout: "<client_ip>\t<domain>\t<resolved_ip>" per A/AAAA record
--
-- Only the wire format itself is parsed (no JSON library): AGH writes compact
-- JSON, so the three fields we need are extracted with string.match.  Records
-- we cannot decode are skipped rather than guessed at.
--
-- Portable across Lua 5.1 (float only) and 5.3+ (integer + float subtypes):
-- string.char() needs an integer in 5.3+, so every byte goes through
-- math.floor(), which yields an integer there and a whole number in 5.1.

local B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

local function b64decode(s)
    local out, v, n = {}, 0, 0
    for i = 1, #s do
        local c = s:sub(i, i)
        if c == '=' then break end
        local f = B64:find(c, 1, true)
        if f then
            -- keep only 24 bits: enough for the <=13 bits held between bytes,
            -- and it stops the value from drifting into float imprecision.
            v = (v * 64 + (f - 1)) % 16777216
            n = n + 6
            if n >= 8 then
                n = n - 8
                out[#out + 1] = string.char(math.floor((v / 2 ^ n) % 256))
            end
        end
    end
    return table.concat(out)
end

-- Walk the questions and answers of a DNS message, returning A/AAAA records.
local function records(m)
    if #m < 12 then return {} end
    local function u8(p) return string.byte(m, p) or 0 end
    local qd = u8(5) * 256 + u8(6)
    local an = u8(7) * 256 + u8(8)
    local p = 13
    for _ = 1, qd do
        while u8(p) ~= 0 and u8(p) < 192 do p = p + 1 + u8(p) end
        if u8(p) >= 192 then p = p + 2 else p = p + 1 end
        p = p + 4                       -- QTYPE + QCLASS
    end
    local out = {}
    for _ = 1, an do
        if u8(p) >= 192 then            -- compression pointer
            p = p + 2
        else
            while u8(p) ~= 0 do p = p + 1 + u8(p) end
            p = p + 1
        end
        local rtype = u8(p) * 256 + u8(p + 1)
        local rdlen = u8(p + 8) * 256 + u8(p + 9)
        p = p + 10                      -- NAME + TYPE + CLASS + TTL + RDLENGTH
        if rtype == 1 and rdlen == 4 then
            out[#out + 1] = string.format('%d.%d.%d.%d', u8(p), u8(p + 1), u8(p + 2), u8(p + 3))
        elseif rtype == 28 and rdlen == 16 then
            local g = {}
            for i = 0, 7 do g[#g + 1] = string.format('%x', u8(p + i * 2) * 256 + u8(p + i * 2 + 1)) end
            out[#out + 1] = table.concat(g, ':')
        end
        p = p + rdlen
    end
    return out
end

for line in io.lines() do
    local ip = line:match('"IP":"([^"]*)"')
    local qh = line:match('"QH":"([^"]*)"')
    local an = line:match('"Answer":"([^"]*)"')
    if ip and qh and an and #an > 8 then
        for _, a in ipairs(records(b64decode(an))) do
            print(ip .. '\t' .. qh .. '\t' .. a)
        end
    end
end
