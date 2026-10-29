param(
  [string]$Url = "http://localhost:3000",
  [int]$MaxAttempts = 120,
  [int]$DelayMilliseconds = 200,
  [switch]$NoOpen
)

for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      if (-not $NoOpen) {
        Start-Process $Url
      }
      exit 0
    }
  } catch {
    # The development server is still starting. Try again shortly.
  }

  Start-Sleep -Milliseconds $DelayMilliseconds
}

exit 1
