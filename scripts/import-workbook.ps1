param([string]$WorkbookPath = 'C:\Users\dme\OneDrive\Desktop\MAIN SHEET PT.xlsx')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($WorkbookPath)
function Read-ZipXml($name) {
    $entry = $archive.GetEntry($name)
    if ($entry) {
        $reader = [System.IO.StreamReader]::new($entry.Open())
        try { return [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
    }
}
try {
    $strings = Read-ZipXml 'xl/sharedStrings.xml'
    $shared = @()
    if ($strings) { $shared = @($strings.sst.si | ForEach-Object { ($_.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '' }) }
    $book = Read-ZipXml 'xl/workbook.xml'
    $rels = Read-ZipXml 'xl/_rels/workbook.xml.rels'
    $sheets = [ordered]@{}
    foreach ($sheet in $book.workbook.sheets.sheet) {
        $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
        $target = ($rels.Relationships.Relationship | Where-Object Id -eq $rid).Target.TrimStart('/')
        if (-not $target.StartsWith('xl/')) { $target = 'xl/' + $target }
        $xml = Read-ZipXml $target
        $rows = @()
        foreach ($row in $xml.worksheet.sheetData.row) {
            $cells = [ordered]@{}
            foreach ($cell in $row.c) {
                $v = [string]$cell.v
                if ($cell.t -eq 's') { $v = $shared[[int]$cell.v] }
                elseif ($cell.t -eq 'inlineStr') { $v = $cell.is.InnerText }
                if ($v -ne '') { $cells[($cell.r -replace '\d', '')] = $v }
            }
            if ($cells.Count -gt 0) { $rows += @{ row = [int]$row.r; cells = $cells } }
        }
        $sheets[$sheet.name] = $rows
    }
    $output = Join-Path $PSScriptRoot '../backend/data/workbook.json'
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($output)) | Out-Null
    $data = @{ source = [System.IO.Path]::GetFileName($WorkbookPath); importedAt = [DateTime]::UtcNow.ToString('o'); sheets = $sheets }
    [System.IO.File]::WriteAllText($output, ($data | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))
    Write-Output "Imported $($sheets.Count) sheets into backend/data/workbook.json. Original workbook unchanged."
} finally { $archive.Dispose() }
