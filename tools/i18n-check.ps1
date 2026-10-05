# Koddaki çevrilecek metinleri (t('...') çağrıları, data-t, yer türü ve mutfak adları) toplar
# ve js/i18n/en.js, fr.js içinde eksik ya da artık olanları listeler.
# Kullanım:  powershell -ExecutionPolicy Bypass -File tools/i18n-check.ps1 [-Dump dosya.txt]
param([string]$Dump)
$root = Split-Path -Parent $PSScriptRoot
$keys = New-Object 'System.Collections.Generic.SortedSet[string]'
$unesc = { param($s) $s -replace "\\'", "'" -replace '\\"', '"' }

Get-ChildItem (Join-Path $root 'js') -Recurse -Filter *.js | Where-Object { $_.DirectoryName -notlike '*\i18n' } | ForEach-Object {
  $src = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8)
  foreach ($m in [regex]::Matches($src, "(?<![\w.$])t\('((?:[^'\\]|\\.)*)'")) { [void]$keys.Add((& $unesc $m.Groups[1].Value)) }
  foreach ($m in [regex]::Matches($src, '(?<![\w.$])t\("((?:[^"\\]|\\.)*)"')) { [void]$keys.Add((& $unesc $m.Groups[1].Value)) }
  if ($_.Name -eq 'places.js') {
    foreach ($m in [regex]::Matches($src, "\['([^']+)', \d+, (?:true|false)\]")) { [void]$keys.Add($m.Groups[1].Value) }
    $cu = $src.Substring($src.IndexOf('const CUISINE = {'))
    $cu = $cu.Substring(0, $cu.IndexOf('};'))
    foreach ($m in [regex]::Matches($cu, ":\s*'([^']+)'")) { [void]$keys.Add($m.Groups[1].Value) }
    [void]$keys.Add('Yer')
  }
}
$html = [IO.File]::ReadAllText((Join-Path $root 'index.html'), [Text.Encoding]::UTF8)
foreach ($m in [regex]::Matches($html, 'data-t="([^"]+)"')) { [void]$keys.Add($m.Groups[1].Value) }

if ($Dump) { [IO.File]::WriteAllLines($Dump, [string[]]@($keys), (New-Object System.Text.UTF8Encoding $false)) }
Write-Host "$($keys.Count) metin bulundu"

foreach ($lang in 'en', 'fr') {
  $f = Join-Path $root "js\i18n\$lang.js"
  if (-not (Test-Path $f)) { Write-Host "$lang.js yok"; continue }
  $src = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8)
  $have = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($m in [regex]::Matches($src, "(?m)^\s*'((?:[^'\\]|\\.)*)'\s*:")) { [void]$have.Add((& $unesc $m.Groups[1].Value)) }
  foreach ($m in [regex]::Matches($src, '(?m)^\s*"((?:[^"\\]|\\.)*)"\s*:')) { [void]$have.Add((& $unesc $m.Groups[1].Value)) }
  $missing = @($keys | Where-Object { -not $have.Contains($_) })
  $extra = @($have | Where-Object { -not $keys.Contains($_) })
  Write-Host "${lang}: $($have.Count) çeviri, eksik $($missing.Count), artık $($extra.Count)"
  $missing | Select-Object -First 40 | ForEach-Object { Write-Host "  - eksik: $_" }
  $extra | Select-Object -First 20 | ForEach-Object { Write-Host "  + artık: $_" }
}
