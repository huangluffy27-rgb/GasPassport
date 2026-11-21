# 在 Monad 测试网上实测页成本（不需要私钥、不需要测试币）
# 用法: powershell -File scripts\measure_monad_page_cost.ps1
# 原理: 把 PageWriter 运行时字节码通过 eth_estimateGas 的 state override 挂到测试网地址上模拟调用。

param(
    [string]$Rpc = "https://testnet-rpc.monad.xyz",
    [string]$Out = "contracts\reports\monad_testnet_page_cost.csv"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$forge = Join-Path $env:USERPROFILE ".foundry\bin\forge.exe"
$cast = Join-Path $env:USERPROFILE ".foundry\bin\cast.exe"

Push-Location (Join-Path $root "contracts")
try {
    $code = (& $forge inspect src/PageWriter.sol:PageWriter deployedBytecode).Trim()
    $from = "0x00000000000000000000000000000000000000aa"
    $to = "0x00000000000000000000000000000000000000bb"
    $rows = @("count,contiguous,scattered,diff")

    foreach ($n in 1, 8, 16, 32, 64) {
        $values = @()
        foreach ($fn in "writeContiguous", "writeScattered") {
            $data = (& $cast calldata "$fn(uint256)" $n).Trim()
            $payload = @{
                jsonrpc = "2.0"
                id      = 1
                method  = "eth_estimateGas"
                params  = @(
                    @{ from = $from; to = $to; data = $data; gasPrice = "0x0"; value = "0x0" },
                    "latest",
                    @{ $to = @{ code = $code } }
                )
            } | ConvertTo-Json -Depth 8 -Compress

            $tmp = Join-Path $env:TEMP "monad_estimate.json"
            $payload | Set-Content $tmp -Encoding ascii
            $resp = curl.exe -s -m 30 -X POST $Rpc -H "Content-Type: application/json" --data-binary "@$tmp" | ConvertFrom-Json
            if ($resp.error) { throw "estimateGas failed: $($resp.error.message)" }
            $values += [Convert]::ToInt64($resp.result, 16)
        }
        $diff = $values[1] - $values[0]
        Write-Output ("n={0} contiguous={1} scattered={2} diff={3}" -f $n, $values[0], $values[1], $diff)
        $rows += "$n,$($values[0]),$($values[1]),$diff"
    }

    $rows | Set-Content (Join-Path $root $Out) -Encoding utf8
    Write-Output "written: $Out"
}
finally {
    Pop-Location
}
