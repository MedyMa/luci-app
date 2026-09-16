<#
    fetch-icons.ps1 - build the icon set for luci-app-traffic.

    Reads the display names from root/etc/traffic/apps.tsv and downloads a
    matching logo for each, into
    htdocs/luci-static/resources/traffic/icons/.

    The *filename* is derived from the display name exactly the way the view's
    slug() does it (lower case, runs of non-alphanumerics -> "-"), because that
    is the name the page looks up.  The *content* comes from whichever upstream
    icon matches, which is often named differently - so several candidates are
    tried per name.

    Two sources, in order:
      1. simple-icons   (cdn.simpleicons.org)      - monochrome brand marks
      2. dashboard-icons (cdn.jsdelivr.net/gh/...) - dashboard-oriented set
    simple-icons has withdrawn a number of trademarks (Microsoft, Amazon,
    OpenAI and several Chinese brands), which is what the second source is for.

    A name with no match in either source keeps its letter avatar - that is a
    normal outcome, not a failure.

    Icons remain the trademarks of their owners and are used here only to
    identify the corresponding service.  Check the upstream licences if you
    redistribute.

        pwsh -File fetch-icons.ps1
#>
[CmdletBinding()]
param(
    [string] $PackageRoot = (Split-Path -Parent $PSScriptRoot),
    [int]    $DelayMs     = 100
)

$ErrorActionPreference = 'Stop'

$appsTsv = Join-Path $PackageRoot 'root/etc/traffic/apps.tsv'
$iconDir = Join-Path $PackageRoot 'htdocs/luci-static/resources/traffic/icons'

if (-not (Test-Path $appsTsv)) { throw "not found: $appsTsv" }
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

# Same normalisation as slug() in overview.js - this is the lookup key.
function Get-Slug([string] $name) {
    ($name.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
}

# Upstream slugs that cannot be derived from the display name.
# Entries that turned out not to exist upstream are deliberately absent.
$alias = @{
    'tencent'       = @('qq', 'tencentqq')
    'tencent cloud' = @('tencent-cloud', 'tencentcloud')
    'weibo'         = @('weibo', 'sinaweibo')
    'sina'          = @('sinaweibo', 'weibo')
    'netease music' = @('netease-cloud-music', 'neteasecloudmusic')
    'douyin'        = @('tiktok', 'douyin')
    'microsoft'     = @('microsoft')
    'outlook'       = @('microsoft-outlook', 'outlook')
    'amazon'        = @('amazon')
    'openai'        = @('openai')
    'twitter'       = @('twitter', 'x')
    'jd'            = @('jd', 'jdcom')
    'didi'          = @('didi')
    'iqiyi'         = @('iqiyi')
    'youku'         = @('youku')
    'tmall'         = @('tmall')
    'pinduoduo'     = @('pinduoduo')
    'toutiao'       = @('toutiao')
    'china mobile'  = @('china-mobile', 'chinamobile')
    'china telecom' = @('china-telecom')
    'china unicom'  = @('china-unicom')
    'alibaba cloud' = @('alibabacloud')
    'netease mail'  = @('netease-mail')
    'live'          = @('microsoft-outlook')
    'epic games'    = @('epicgames', 'epic-games')
    'anthropic'     = @('anthropic', 'claude')
    'alibaba'       = @('alibaba', 'alibabacloud')
}

$sources = @(
    { param($s) "https://cdn.simpleicons.org/$s" },
    { param($s) "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/$s.svg" }
)

function Get-Icon([string] $slug) {
    foreach ($mk in $sources) {
        $uri = & $mk $slug
        try {
            $r = Invoke-WebRequest -Uri $uri -TimeoutSec 15 -ErrorAction Stop
            if ($r.StatusCode -eq 200 -and $r.Content -match '<svg') { return $r.Content }
        }
        catch { }
        Start-Sleep -Milliseconds $DelayMs
    }
    return $null
}

function Format-Svg([string] $svg) {
    # let CSS own the size: drop fixed dimensions, make sure a viewBox exists
    if ($svg -notmatch 'viewBox') { $svg = $svg -replace '<svg', '<svg viewBox="0 0 24 24"' }
    $svg = $svg -replace '(<svg[^>]*?)\s+width="[^"]*"', '$1'
    $svg = $svg -replace '(<svg[^>]*?)\s+height="[^"]*"', '$1'
    if ($svg -notmatch 'xmlns=') { $svg = $svg -replace '<svg', '<svg xmlns="http://www.w3.org/2000/svg"' }
    return $svg.Trim()
}

$rows = Get-Content $appsTsv | Where-Object { $_ -and -not $_.StartsWith('#') }
$saved = @(); $missed = @(); $seenFile = @{}; $cache = @{}

foreach ($row in $rows) {
    $parts = $row -split "`t"
    if ($parts.Count -lt 2) { continue }
    $name   = $parts[0].Trim()
    $domain = $parts[1].Trim()
    $file   = (Get-Slug $name) + '.svg'
    if ($seenFile.ContainsKey($file)) { continue }
    $seenFile[$file] = $true

    $key = $name.ToLower()
    $cands = @()
    if ($alias.ContainsKey($key)) { $cands += $alias[$key] }
    $cands += (Get-Slug $name)
    $cands += ($name.ToLower() -replace '[^a-z0-9]', '')
    $cands += (Get-Slug ($domain -split '\.')[0])
    $cands = $cands | Where-Object { $_ } | Select-Object -Unique

    $svg = $null; $from = $null
    foreach ($c in $cands) {
        if ($cache.ContainsKey($c)) { $svg = $cache[$c]; $from = $c; break }   # reuse across names
        $svg = Get-Icon $c
        if ($svg) { $cache[$c] = $svg; $from = $c; break }
    }

    if ($svg) {
        Set-Content -LiteralPath (Join-Path $iconDir $file) -Value (Format-Svg $svg) -Encoding utf8 -NoNewline
        $saved += [pscustomobject]@{ File = $file; Name = $name; From = $from }
    }
    else {
        $missed += $name
    }
}

Write-Host ""
Write-Host ("saved   : {0}" -f $saved.Count)
$saved | ForEach-Object { Write-Host ("  {0,-22} {1,-16} (upstream: {2})" -f $_.File, $_.Name, $_.From) }
Write-Host ""
Write-Host ("no match: {0}" -f $missed.Count)
$missed | ForEach-Object { Write-Host ("  {0}  (keeps its letter avatar)" -f $_) }
Write-Host ""
$total = (Get-ChildItem $iconDir -Filter *.svg | Measure-Object -Property Length -Sum)
Write-Host ("icon dir: {0} files, {1:N0} bytes" -f $total.Count, $total.Sum)
