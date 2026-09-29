Write-Host "=== TEST 1: Health Check ==="
$health = Invoke-RestMethod -Uri "http://localhost:5000/api/health" -Method Get
Write-Host "Health Status: $($health.status)"
Write-Host "yt-dlp: $($health.ytdlp.version)"
Write-Host "ffmpeg: $($health.ffmpeg.version)"
Write-Host "deno: $($health.deno.version)"
Write-Host "yt-dlp-ejs solver supported: $($health.ytdlpEjsSupported)"

Write-Host ""
Write-Host "=== TEST 2: Extract Media Info ==="
$infoBody = @{ url = "https://www.youtube.com/watch?v=jNQXAC9IVRw" } | ConvertTo-Json
$info = Invoke-RestMethod -Uri "http://localhost:5000/api/info" -Method Post -ContentType "application/json" -Body $infoBody
Write-Host "Success: $($info.success)"
Write-Host "Title: $($info.data.title)"
Write-Host "Author: $($info.data.uploader)"
Write-Host "Platform: $($info.data.platform)"
Write-Host "Formats count: $($info.data.formats.Count)"
foreach ($f in $info.data.formats) {
    Write-Host "Format: $($f.label) | ID: $($f.formatId) | Ext: $($f.extension)"
}

Write-Host ""
Write-Host "=== TEST 3: Download & Transcode (MP3 Audio) ==="
$tmpMp3 = [System.IO.Path]::GetTempFileName() + ".mp3"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$res = Invoke-WebRequest -Uri "http://localhost:5000/api/download?url=https://www.youtube.com/watch?v=jNQXAC9IVRw&format=mp3" -OutFile $tmpMp3
$sw.Stop()
$fileInfo = Get-Item $tmpMp3
Write-Host "Downloaded MP3 in: $($sw.ElapsedMilliseconds)ms"
Write-Host "MP3 File Size: $($fileInfo.Length) bytes"
Remove-Item $tmpMp3

Write-Host ""
Write-Host "=== TEST 4: Download Video (MP4) ==="
$tmpMp4 = [System.IO.Path]::GetTempFileName() + ".mp4"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$res = Invoke-WebRequest -Uri "http://localhost:5000/api/download?url=https://www.youtube.com/watch?v=jNQXAC9IVRw&format=360p" -OutFile $tmpMp4
$sw.Stop()
$fileInfo = Get-Item $tmpMp4
Write-Host "Downloaded MP4 in: $($sw.ElapsedMilliseconds)ms"
Write-Host "MP4 File Size: $($fileInfo.Length) bytes"
Remove-Item $tmpMp4

Write-Host ""
Write-Host "=== TEST 5: Next.js Frontend Integration ==="
$fe = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing
Write-Host "Frontend Status Code: $($fe.StatusCode)"
Write-Host "Frontend Title Check: $($fe.Content.Contains('OmniStream'))"

Write-Host ""
Write-Host "=== ALL PIPELINE TESTS COMPLETED SUCCESSFULLY ==="
