# "Uçak" seçeneği için havalimanı veri setini Wikidata'dan üretir → data/airports.json
# IATA kodu olan, kapanmamış havalimanları; yıllık yolcu sayısı (varsa) tarifeli uçuş olup olmadığını anlamaya yarar.
# Kullanım:  powershell -ExecutionPolicy Bypass -File tools/build-airports.ps1
$ErrorActionPreference = 'Stop'
$UA = 'RotaTravelApp/0.1 (https://github.com/Alanmett/rota)'
$root = Split-Path -Parent $PSScriptRoot
$inv = [Globalization.CultureInfo]::InvariantCulture

# build-destinations.ps1 ile aynı ülkeler
$countries = [ordered]@{
  CH = 'Q39'; LI = 'Q347'; IT = 'Q38'; FR = 'Q142'; DE = 'Q183'; AT = 'Q40'; TR = 'Q43'
  ES = 'Q29'; PT = 'Q45'; NL = 'Q55'; BE = 'Q31'; LU = 'Q32'; CZ = 'Q213'; SI = 'Q215'; HR = 'Q224'
  GR = 'Q41'; GB = 'Q145'; MC = 'Q235'; HU = 'Q28'; PL = 'Q36'; DK = 'Q35'; SM = 'Q238'; VA = 'Q237'
}

function Sparql([string]$q) {
  for ($try = 1; $try -le 4; $try++) {
    try {
      return Invoke-RestMethod -Method Post -Uri 'https://query.wikidata.org/sparql' -Body @{ query = $q; format = 'json' } `
        -UserAgent $UA -Headers @{ Accept = 'application/sparql-results+json' } -TimeoutSec 120
    } catch {
      Write-Host "  tekrar deneniyor ($try): $($_.Exception.Message)"
      Start-Sleep -Seconds (8 * $try)
    }
  }
  throw 'Wikidata sorgusu başarısız'
}

# 1) Ülke ülke: IATA kodu, koordinatı olan, kapanmamış havalimanları
$items = @{}
foreach ($cc in $countries.Keys) {
  $q = @"
SELECT ?item ?coord ?iata ?sl (MAX(?p) AS ?pax) WHERE {
  ?item wdt:P238 ?iata ; wdt:P625 ?coord ; wdt:P17 wd:$($countries[$cc]) ; wikibase:sitelinks ?sl ; wdt:P31/wdt:P279* wd:Q1248784 .
  FILTER NOT EXISTS { ?item wdt:P3999 [] }
  OPTIONAL { ?item wdt:P3872 ?p }
} GROUP BY ?item ?coord ?iata ?sl
"@
  $r = Sparql $q
  $before = $items.Count
  foreach ($b in $r.results.bindings) {
    $qid = $b.item.value.Split('/')[-1]
    if ($items.ContainsKey($qid)) { continue }
    if ($b.coord.value -notmatch '^Point\(([-\d.eE]+) ([-\d.eE]+)\)$') { continue }
    $items[$qid] = [pscustomobject]@{
      q = $qid; iata = $b.iata.value; name = $null; lon = [double]::Parse($matches[1], $inv); lat = [double]::Parse($matches[2], $inv)
      cc = $cc; sl = [int]$b.sl.value; pax = $(if ($b.pax) { [double]::Parse($b.pax.value, $inv) } else { 0 })
    }
  }
  Write-Host ('{0}: {1} havalimanı' -f $cc, ($items.Count - $before))
  Start-Sleep -Seconds 2
}

# 2) Adlar: Türkçe varsa Türkçe, yoksa İngilizce, yoksa yerel dil
$langs = @('tr', 'en', 'de', 'fr', 'it', 'es', 'nl', 'pt', 'cs', 'pl', 'hu', 'hr', 'sl', 'el', 'da')
$qids = @($items.Keys)
for ($i = 0; $i -lt $qids.Count; $i += 300) {
  $batch = $qids[$i..([Math]::Min($i + 299, $qids.Count - 1))]
  $q = "SELECT ?item ?l WHERE { VALUES ?item { $(($batch | ForEach-Object { 'wd:' + $_ }) -join ' ') } ?item rdfs:label ?l . FILTER(LANG(?l) IN ($(($langs | ForEach-Object { '"' + $_ + '"' }) -join ','))) }"
  $r = Sparql $q
  $byLang = @{}
  foreach ($b in $r.results.bindings) {
    $qid = $b.item.value.Split('/')[-1]
    if (-not $byLang.ContainsKey($qid)) { $byLang[$qid] = @{} }
    $byLang[$qid][$b.l.'xml:lang'] = $b.l.value
  }
  foreach ($qid in $byLang.Keys) {
    $l = $byLang[$qid]
    $items[$qid].name = ($langs | Where-Object { $l.ContainsKey($_) } | Select-Object -First 1 | ForEach-Object { $l[$_] })
  }
  Start-Sleep -Milliseconds 500
}

# 3) Süz: yılda en az 100 bin yolcusu bilinenler. Yolcu sayısı olmayanlar genelde spor/askeri pist ve heliport
#    (Grenchen, Cambridge, RAF Northolt…); Berlin-Schönefeld eski terminali artık BER ile aynı havalimanı.
$keep = $items.Values | Where-Object { $_.name -and $_.pax -ge 100000 -and $_.iata -ne 'SXF' }
$sorted = $keep | Sort-Object -Property @{ Expression = 'pax'; Descending = $true }, @{ Expression = 'sl'; Descending = $true }

$sb = New-Object System.Text.StringBuilder
[void]$sb.Append('{"v":1,"built":"' + (Get-Date -Format 'yyyy-MM-dd') + '","fields":["q","iata","name","lat","lon","cc","paxK","sl"],"items":[')
$first = $true
foreach ($it in $sorted) {
  if (-not $first) { [void]$sb.Append(',') }
  $first = $false
  $name = ($it.name | ConvertTo-Json -Compress)
  [void]$sb.Append([string]::Format($inv, '["{0}","{1}",{2},{3:0.####},{4:0.####},"{5}",{6},{7}]', $it.q, $it.iata, $name, $it.lat, $it.lon, $it.cc, [int][Math]::Round($it.pax / 1000), $it.sl))
}
[void]$sb.Append(']}')
New-Item -ItemType Directory -Force (Join-Path $root 'data') | Out-Null
$path = Join-Path $root 'data\airports.json'
[IO.File]::WriteAllText($path, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))
Write-Host ("Yazıldı: {0} havalimanı ({1} ham), {2:n0} KB" -f @($sorted).Count, $items.Count, ((Get-Item $path).Length / 1KB))
