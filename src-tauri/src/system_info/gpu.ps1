$gpus = Get-CimInstance Win32_VideoController
    $mons = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorID
    $sizes = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBasicDisplayParams
    $gpuLoad = (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine |
                Where-Object { $_.Name -like '*engtype_3D*' } |
                Measure-Object -Property UtilizationPercentage -Sum).Sum
    [pscustomobject]@{
      gpus = ($gpus | ForEach-Object { [pscustomobject]@{
        name       = $_.Name
        vram       = $_.AdapterRAM
        driver     = $_.DriverVersion
        driverDate = $_.DriverDate
        resolution = if ($_.CurrentHorizontalResolution) { "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)" } else { $null }
        refresh    = $_.CurrentRefreshRate
        bits       = $_.CurrentBitsPerPixel
        processor  = $_.VideoProcessor
        status     = $_.Status
      } })
      monitors = ($mons | ForEach-Object {
        $n = ($_.UserFriendlyName | Where-Object { $_ -gt 0 } | ForEach-Object { [char]$_ }) -join ''
        $m = ($_.ManufacturerName | Where-Object { $_ -gt 0 } | ForEach-Object { [char]$_ }) -join ''
        [pscustomobject]@{ name = $n; maker = $m; year = $_.YearOfManufacture; week = $_.WeekOfManufacture }
      })
      monitorSizes = ($sizes | ForEach-Object { [pscustomobject]@{ maxH = $_.MaxHorizontalImageSize; maxV = $_.MaxVerticalImageSize } })
      gpuLoad = [int]$gpuLoad
    } | ConvertTo-Json -Compress -Depth 4
