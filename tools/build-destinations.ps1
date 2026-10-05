# "Nereye gidelim?" önerileri için gidilecek yer veri setini Wikidata'dan üretir → data/destinations.json
# Bir yerin gezi rehberi (Wikivoyage) maddesi varsa "gidilmeye değer" sayılır; kaç dilde maddesi olduğu önem ölçüsüdür.
# Kullanım:  powershell -ExecutionPolicy Bypass -File tools/build-destinations.ps1
$ErrorActionPreference = 'Stop'
$UA = 'RotaTravelApp/0.1 (https://github.com/Alanmett/rota)'
$root = Split-Path -Parent $PSScriptRoot
$inv = [Globalization.CultureInfo]::InvariantCulture

$countries = [ordered]@{
  CH = 'Q39'; LI = 'Q347'; IT = 'Q38'; FR = 'Q142'; DE = 'Q183'; AT = 'Q40'; TR = 'Q43'
  ES = 'Q29'; PT = 'Q45'; NL = 'Q55'; BE = 'Q31'; LU = 'Q32'; CZ = 'Q213'; SI = 'Q215'; HR = 'Q224'
  GR = 'Q41'; GB = 'Q145'; MC = 'Q235'; HU = 'Q28'; PL = 'Q36'; DK = 'Q35'; SM = 'Q238'; VA = 'Q237'
}

# Tür kökleri (Wikidata'da tek tek doğrulandı): s = şehir/kasaba/köy, n = doğa, a = gezilecek yer
$kindRoots = @{
  Q486972 = 's'; Q15284 = 's'; Q515 = 's'; Q3957 = 's'; Q532 = 's'; Q4946461 = 's'
  Q46169 = 'n'; Q179049 = 'n'; Q473972 = 'n'; Q23397 = 'n'; Q8502 = 'n'; Q23442 = 'n'; Q39816 = 'n'
  Q35666 = 'n'; Q34038 = 'n'; Q150784 = 'n'; Q40080 = 'n'; Q35509 = 'n'; Q133056 = 'n'; Q130003 = 'n'
  Q570116 = 'a'; Q839954 = 'a'; Q23413 = 'a'; Q16560 = 'a'; Q44613 = 'a'; Q2416723 = 'a'; Q15243209 = 'a'
  Q1497375 = 'a'; Q33506 = 'a'
}
# Ülke, dil, nehir, sıradağ ve il/eyalet düzeyi bölgeler yer önerisi olamaz (şehir olanlar hariç: Viyana, Berlin)
$alwaysDrop = @('Q6256', 'Q3624078', 'Q34770')
$dropUnlessSettlement = @('Q4022', 'Q46831', 'Q10864048')

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

# 1) Ülke ülke: Wikivoyage maddesi olan ve koordinatı bulunan her şey.
#    Not: Wikidata'nın ad servisi bu sorguyu ~10 kat yavaşlatıyor (3 sn → 24 sn); adlar 2. adımda ayrıca çekilir.
$items = @{}
foreach ($cc in $countries.Keys) {
  $q = @"
SELECT ?item ?coord ?sl (COUNT(DISTINCT ?site) AS ?wv) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?p31), "entity/"); separator=",") AS ?types) (MAX(?h) AS ?unesco) WHERE {
  ?site wikibase:wikiGroup "wikivoyage" .
  ?a schema:isPartOf ?site ; schema:about ?item .
  ?item wdt:P17 wd:$($countries[$cc]) ; wdt:P625 ?coord ; wikibase:sitelinks ?sl .
  OPTIONAL { ?item wdt:P31 ?p31 }
  OPTIONAL { ?item wdt:P1435 wd:Q9259 . BIND(1 AS ?h) }
} GROUP BY ?item ?coord ?sl
"@
  $t0 = Get-Date
  $r = Sparql $q
  $before = $items.Count
  foreach ($b in $r.results.bindings) {
    $qid = $b.item.value.Split('/')[-1]
    if ($items.ContainsKey($qid)) { continue }  # birden fazla koordinatı ya da ülkesi olanlar (ör. Boden Gölü)
    if ($b.coord.value -notmatch '^Point\(([-\d.eE]+) ([-\d.eE]+)\)$') { continue }  # Dünya dışı koordinatları atla
    $types = New-Object 'System.Collections.Generic.HashSet[string]'
    if ($b.types.value) { foreach ($t in $b.types.value.Split(',')) { if ($t) { [void]$types.Add($t) } } }
    $items[$qid] = [pscustomobject]@{
      q = $qid; name = $null; lon = [double]::Parse($matches[1], $inv); lat = [double]::Parse($matches[2], $inv)
      cc = $cc; wv = [int]$b.wv.value; sl = [int]$b.sl.value; un = [bool]$b.unesco; types = $types
    }
  }
  Write-Host ('{0}: {1} yer ({2:n1} sn)' -f $cc, ($items.Count - $before), ((Get-Date) - $t0).TotalSeconds)
  Start-Sleep -Seconds 2
}

# 2) Karşılaşılan her türün hangi köke bağlandığını bul (ör. "Protestan kilisesi" → ... , "İsviçre belediyesi" → belediye)
$allRoots = @($kindRoots.Keys) + $alwaysDrop + $dropUnlessSettlement
$classes = @($items.Values | ForEach-Object { $_.types } | Sort-Object -Unique)
$classRoots = @{}
for ($i = 0; $i -lt $classes.Count; $i += 80) {
  $batch = $classes[$i..([Math]::Min($i + 79, $classes.Count - 1))]
  $q = "SELECT ?c ?root WHERE { VALUES ?c { $(($batch | ForEach-Object { 'wd:' + $_ }) -join ' ') } VALUES ?root { $(($allRoots | ForEach-Object { 'wd:' + $_ }) -join ' ') } ?c wdt:P279* ?root . }"
  $r = Sparql $q
  foreach ($b in $r.results.bindings) {
    $c = $b.c.value.Split('/')[-1]
    if (-not $classRoots.ContainsKey($c)) { $classRoots[$c] = New-Object 'System.Collections.Generic.HashSet[string]' }
    [void]$classRoots[$c].Add($b.root.value.Split('/')[-1])
  }
  Start-Sleep -Milliseconds 800
}
Write-Host "$($classes.Count) tür sınıflandırıldı"

# 3) Adlar: Türkçe varsa Türkçe (Zürih, Cenevre, Floransa), yoksa İngilizce, yoksa yerel dil
$langs = @('tr', 'en', 'de', 'fr', 'it', 'es', 'nl', 'pt', 'cs', 'pl', 'hu', 'hr', 'sl', 'el', 'da')
$localLangs = @{
  CH = @('de', 'fr', 'it'); LI = @('de'); IT = @('it'); FR = @('fr'); DE = @('de'); AT = @('de'); TR = @('tr'); ES = @('es')
  PT = @('pt'); NL = @('nl'); BE = @('nl', 'fr'); LU = @('fr', 'de'); CZ = @('cs'); SI = @('sl'); HR = @('hr'); GR = @('en')
  GB = @('en'); MC = @('fr'); HU = @('hu'); PL = @('pl'); DK = @('da'); SM = @('it'); VA = @('it')
}
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
    $it = $items[$qid]
    $it.name = ($langs | Where-Object { $l.ContainsKey($_) } | Select-Object -First 1 | ForEach-Object { $l[$_] })
    # Yerel ad: tren tarifesi gibi servisler "Lozan"ı değil "Lausanne"ı tanır
    $local = ($localLangs[$it.cc] | Where-Object { $l.ContainsKey($_) } | Select-Object -First 1 | ForEach-Object { $l[$_] })
    $it | Add-Member -NotePropertyName local -NotePropertyValue $(if ($local -and $local -ne $it.name) { $local } else { '' }) -Force
  }
  Start-Sleep -Milliseconds 500
}
Write-Host "Adlar alındı"

# 4) Sınıflandır, kalite süzgecinden geçir, yaz
$out = New-Object System.Collections.Generic.List[object]
foreach ($it in $items.Values) {
  $roots = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($t in $it.types) { if ($classRoots.ContainsKey($t)) { $roots.UnionWith($classRoots[$t]) } }
  if (@($alwaysDrop | Where-Object { $roots.Contains($_) }).Count) { continue }
  $kinds = @($roots | Where-Object { $kindRoots.ContainsKey($_) } | ForEach-Object { $kindRoots[$_] })
  $kind = if ($kinds -contains 's') { 's' } elseif ($kinds -contains 'n') { 'n' } elseif ($kinds -contains 'a') { 'a' } else { $null }
  if (-not $kind) { continue }
  if ($kind -ne 's' -and @($dropUnlessSettlement | Where-Object { $roots.Contains($_) }).Count) { continue }
  # Kalite: tek bir dilde rehberi olan küçük köyler elenir; doğa ve gezilecek yerlerde süzgeç daha gevşek
  $keep = if ($kind -eq 's') { $it.wv -ge 2 -or $it.sl -ge 15 -or $it.un } else { $it.sl -ge 3 -or $it.un }
  if (-not $keep -or -not $it.name) { continue }
  $it | Add-Member -NotePropertyName kind -NotePropertyValue $kind -Force
  $out.Add($it)
}
$sorted = $out | Sort-Object -Property @{ Expression = 'wv'; Descending = $true }, @{ Expression = 'sl'; Descending = $true }

$sb = New-Object System.Text.StringBuilder
[void]$sb.Append('{"v":1,"built":"' + (Get-Date -Format 'yyyy-MM-dd') + '","fields":["q","name","lat","lon","cc","kind","wv","sl","unesco","local"],"items":[')
$first = $true
foreach ($it in $sorted) {
  if (-not $first) { [void]$sb.Append(',') }
  $first = $false
  $name = ($it.name | ConvertTo-Json -Compress)
  $local = ([string]$it.local | ConvertTo-Json -Compress)
  [void]$sb.Append([string]::Format($inv, '["{0}",{1},{2:0.####},{3:0.####},"{4}","{5}",{6},{7},{8},{9}]', $it.q, $name, $it.lat, $it.lon, $it.cc, $it.kind, $it.wv, $it.sl, [int]$it.un, $local))
}
[void]$sb.Append(']}')
New-Item -ItemType Directory -Force (Join-Path $root 'data') | Out-Null
$path = Join-Path $root 'data\destinations.json'
[IO.File]::WriteAllText($path, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))
$byKind = $sorted | Group-Object kind | ForEach-Object { "$($_.Name)=$($_.Count)" }
Write-Host ("Yazıldı: {0} yer ({1}), {2:n0} KB" -f $sorted.Count, ($byKind -join ' '), ((Get-Item $path).Length / 1KB))
