$adapters = Get-NetAdapter
    $up = Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' }
    $wlan = netsh wlan show interfaces
    $ssid = ($wlan | Select-String '^\s+SSID\s+:' | Select-Object -First 1) -replace '.*:\s*',''
    $bssid = ($wlan | Select-String 'BSSID' | Select-Object -First 1) -replace '.*:\s*',''
    $signal = ($wlan | Select-String 'Signal' | Select-Object -First 1) -replace '.*:\s*',''
    $radio = ($wlan | Select-String 'Radio type' | Select-Object -First 1) -replace '.*:\s*',''
    $channel = ($wlan | Select-String 'Channel' | Select-Object -First 1) -replace '.*:\s*',''
    [pscustomobject]@{
      hostname = $env:COMPUTERNAME
      adapters = ($adapters | ForEach-Object { [pscustomobject]@{
        name    = $_.Name
        desc    = $_.InterfaceDescription
        status  = "$($_.Status)"
        mac     = $_.MacAddress
        speed   = $_.LinkSpeed
        type    = "$($_.MediaType)"
        virtual = $_.Virtual
      } })
      configs = ($up | ForEach-Object {
        [pscustomobject]@{
          alias   = $_.InterfaceAlias
          ipv4    = ($_.IPv4Address | ForEach-Object { $_.IPAddress }) -join ', '
          prefix  = ($_.IPv4Address | ForEach-Object { $_.PrefixLength }) -join ', '
          gateway = ($_.IPv4DefaultGateway | ForEach-Object { $_.NextHop }) -join ', '
          dns     = ($_.DNSServer | Where-Object { $_.AddressFamily -eq 2 } | ForEach-Object { $_.ServerAddresses }) -join ', '
          dhcp    = "$($_.NetIPv4Interface.ConnectionState)"
        }
      })
      ssid = "$ssid".Trim()
      bssid = "$bssid".Trim()
      signal = "$signal".Trim()
      radio = "$radio".Trim()
      channel = "$channel".Trim()
    } | ConvertTo-Json -Compress -Depth 4
