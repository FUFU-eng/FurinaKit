$os = Get-CimInstance Win32_OperatingSystem
    $cs = Get-CimInstance Win32_ComputerSystem
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $gpu = (Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notlike '*Virtual*' -and $_.Name -notlike '*Basic*' } )
    $disk = Get-CimInstance Win32_DiskDrive
    [pscustomobject]@{
      osName        = $os.Caption
      osBuild       = $os.BuildNumber
      osArch        = $os.OSArchitecture
      osInstallDate = $os.InstallDate
      hostname      = $cs.Name
      manufacturer  = $cs.Manufacturer
      model         = $cs.Model
      totalMemory   = $cs.TotalPhysicalMemory
      freeMemory    = $os.FreePhysicalMemory * 1KB
      cpuName       = $cpu.Name
      cpuCores      = $cpu.NumberOfCores
      cpuThreads    = $cpu.NumberOfLogicalProcessors
      gpuNames      = ($gpu | ForEach-Object { $_.Name }) -join ' / '
      diskTotal     = ($disk | Measure-Object -Property Size -Sum).Sum
      diskCount     = ($disk | Measure-Object).Count
      lastBoot      = $os.LastBootUpTime
      uptimeSeconds = [int]((Get-Date) - $os.LastBootUpTime).TotalSeconds
      activated     = (Get-CimInstance SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL AND Name LIKE 'Windows%'" | Select-Object -First 1).LicenseStatus
      monitorCount  = (Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBasicDisplayParams | Measure-Object).Count
    } | ConvertTo-Json -Compress
