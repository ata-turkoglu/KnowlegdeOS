param(
  [string]$Source = (Join-Path $PSScriptRoot "..\sourceFiles\orginals\MERTER B.docx"),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\sourceFiles\orginals\MERTER B-parcalari"),
  [int]$BlocksPerPart = 4
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (-not (Test-Path -LiteralPath $Source)) {
  throw "Kaynak dosya bulunamadı: $Source"
}

if (Test-Path -LiteralPath $OutputDirectory) {
  throw "Çıktı klasörü zaten var: $OutputDirectory"
}

$workingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("merter-b-split-" + [guid]::NewGuid())
$extractedSource = Join-Path $workingRoot "source"

try {
  New-Item -ItemType Directory -Path $extractedSource -Force | Out-Null
  [System.IO.Compression.ZipFile]::ExtractToDirectory($Source, $extractedSource)

  $documentXmlPath = Join-Path $extractedSource "word\document.xml"
  [xml]$sourceXml = Get-Content -LiteralPath $documentXmlPath -Raw -Encoding utf8
  $namespace = [System.Xml.XmlNamespaceManager]::new($sourceXml.NameTable)
  $namespace.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
  $body = $sourceXml.SelectSingleNode("//w:body", $namespace)

  $markers = @()
  for ($childIndex = 0; $childIndex -lt $body.ChildNodes.Count; $childIndex++) {
    $child = $body.ChildNodes[$childIndex]
    if ($child.LocalName -ne "p") { continue }

    $text = ($child.SelectNodes(".//w:t", $namespace) | ForEach-Object { $_.'#text' }) -join ""
    if ($text -match "^B-\d+(?:/.+)?$") {
      $markers += [PSCustomObject]@{ ChildIndex = $childIndex; Label = $text }
    }
  }

  if ($markers.Count -eq 0) {
    throw "Bölüm işaretleri bulunamadı."
  }

  New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
  $partNumber = 0

  for ($firstMarker = 0; $firstMarker -lt $markers.Count; $firstMarker += $BlocksPerPart) {
    $partNumber++
    $lastMarker = [Math]::Min($firstMarker + $BlocksPerPart - 1, $markers.Count - 1)
    $startChildIndex = $markers[$firstMarker].ChildIndex
    $endChildIndex = if ($lastMarker -lt $markers.Count - 1) { $markers[$lastMarker + 1].ChildIndex } else { $body.ChildNodes.Count }

    $partRoot = Join-Path $workingRoot ("part-" + $partNumber)
    Copy-Item -LiteralPath $extractedSource -Destination $partRoot -Recurse
    $partDocumentXml = Join-Path $partRoot "word\document.xml"
    [xml]$partXml = Get-Content -LiteralPath $partDocumentXml -Raw -Encoding utf8
    $partNamespace = [System.Xml.XmlNamespaceManager]::new($partXml.NameTable)
    $partNamespace.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
    $partBody = $partXml.SelectSingleNode("//w:body", $partNamespace)

    for ($childIndex = $partBody.ChildNodes.Count - 1; $childIndex -ge 0; $childIndex--) {
      $child = $partBody.ChildNodes[$childIndex]
      $keep = ($child.LocalName -eq "sectPr") -or ($childIndex -ge $startChildIndex -and $childIndex -lt $endChildIndex)
      if (-not $keep) { [void]$partBody.RemoveChild($child) }
    }

    $utf8 = [System.Text.UTF8Encoding]::new($false)
    $settings = [System.Xml.XmlWriterSettings]::new()
    $settings.Encoding = $utf8
    $settings.Indent = $false
    $writer = [System.Xml.XmlWriter]::Create($partDocumentXml, $settings)
    $partXml.Save($writer)
    $writer.Dispose()

    $firstLabel = $markers[$firstMarker].Label -replace "/", "-"
    $lastLabel = $markers[$lastMarker].Label -replace "/", "-"
    $fileName = "MERTER B - Bolum {0:D2} ({1} - {2}).docx" -f $partNumber, $firstLabel, $lastLabel
    $destination = Join-Path $OutputDirectory $fileName
    [System.IO.Compression.ZipFile]::CreateFromDirectory($partRoot, $destination, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    Write-Output ("{0}: {1}-{2}" -f $fileName, $markers[$firstMarker].Label, $markers[$lastMarker].Label)
  }
}
finally {
  if (Test-Path -LiteralPath $workingRoot) {
    Remove-Item -LiteralPath $workingRoot -Recurse -Force
  }
}
