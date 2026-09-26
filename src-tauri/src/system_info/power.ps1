$os = Get-CimInstance Win32_OperatingSystem
    $cpu = Get-CimInstance Win32_ComputerSystem
    $bat = Get-CimInstance Win32_Battery
    $full = (Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue).FullChargedCapacity
    $online = (Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue).PowerOnline
    $scheme = (powercfg /getactivescheme) -join ''
    $thermal = (Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue |
                ForEach-Object { [math]::Round($_.CurrentTemperature / 10 - 273.15, 1) })
    $fan = (Get-CimInstance Win32_Fan -ErrorAction SilentlyContinue | ForEach-Object { $_.DesiredSpeed })
    [pscustomobject]@{
      uptimeSeconds = [int]((Get-Date) - $os.LastBootUpTime).TotalSeconds
      logicalCpus = $cpu.NumberOfLogicalProcessors
      batteryName   = $bat.Name
      charge        = $bat.EstimatedChargeRemaining
      status        = $bat.BatteryStatus
      fullCharge    = $full
      powerOnline   = $online
      scheme        = "$scheme"
      thermal       = ($thermal)
      fan           = ($fan)
    } | ConvertTo-Json -Compress -Depth 3
