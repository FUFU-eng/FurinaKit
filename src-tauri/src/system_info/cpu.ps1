$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $perf = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor
    $total = $perf | Where-Object { $_.Name -eq '_Total' }
    $cores = $perf | Where-Object { $_.Name -ne '_Total' } | Sort-Object { [int]$_.Name } | Select-Object -First 32
    $os = Get-CimInstance Win32_OperatingSystem
    $sticks = Get-CimInstance Win32_PhysicalMemory
    $arr = Get-CimInstance Win32_PhysicalMemoryArray
    [pscustomobject]@{
      name        = $cpu.Name
      manufacturer= $cpu.Manufacturer
      description = $cpu.Description
      cores       = $cpu.NumberOfCores
      threads     = $cpu.NumberOfLogicalProcessors
      maxClock    = $cpu.MaxClockSpeed
      curClock    = $cpu.CurrentClockSpeed
      socket      = $cpu.SocketDesignation
      l2          = $cpu.L2CacheSize
      l3          = $cpu.L3CacheSize
      virt        = $cpu.VirtualizationFirmwareEnabled
      usageTotal  = [int]$total.PercentProcessorTime
      coreUsage   = ($cores | ForEach-Object { [int]$_.PercentProcessorTime })
      totalMem    = $os.TotalVisibleMemorySize * 1KB
      freeMem     = $os.FreePhysicalMemory * 1KB
      commitLimit = $os.TotalVirtualMemorySize * 1KB
      commitFree  = $os.FreeVirtualMemory * 1KB
      slots       = $arr.MemoryDevices
      sticks      = ($sticks | ForEach-Object { [pscustomobject]@{
                       capacity = $_.Capacity
                       speed    = $_.Speed
                       part     = ($_.PartNumber -replace '\s+$','')
                       maker    = $_.Manufacturer
                       slot     = $_.DeviceLocator
                       type     = $_.SMBIOSMemoryType
                     } })
    } | ConvertTo-Json -Compress -Depth 4
