# Chạy từ repo: powershell -File scripts/set-cloudflare-secrets.ps1
# Khôi phục Worker (KV + R2) và 4 secrets trên Cloudflare.
# Có thể set secrets trực tiếp trên dashboard: Workers → store → Settings → Variables and Secrets.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host "1) Deploy Worker (bindings ORDERS + PROOFS)..."
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { throw "wrangler deploy failed" }

Write-Host "2) Set secrets (nhập giá trị khi được hỏi, hoặc dùng Cloudflare Dashboard)..."
$secrets = @(
  @{ Name = "BREVO_API_KEY"; Hint = "xkeysib-..." },
  @{ Name = "WEB3FORMS_KEY"; Hint = "access key Web3Forms" },
  @{ Name = "ADMIN_TOKEN"; Hint = "Lol.Huy1812.Lol" },
  @{ Name = "ADMIN_PASS_HASH"; Hint = "SHA-256 hash mật khẩu admin (64 hex)" }
)
foreach ($s in $secrets) {
  Write-Host "  -> $($s.Name) ($($s.Hint))"
  $val = Read-Host "     Value (Enter = skip)"
  if ($val) {
    $val | npx wrangler secret put $s.Name
    if ($LASTEXITCODE -ne 0) { Write-Warning "Failed: $($s.Name)" }
  }
}

Write-Host "3) Verify:"
npx wrangler secret list
curl.exe -s -o NUL -w "GET /config -> HTTP %{http_code}`n" https://store.tdh1812.workers.dev/config
