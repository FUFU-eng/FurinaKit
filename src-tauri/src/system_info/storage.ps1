$phys = Get-PhysicalDisk
    # Get-StorageReliabilityCounter 需要管理员权限；未提权时返回空，不影响其它字段
    $reliability = @{}
    try {
      Get-PhysicalDisk | ForEach-Object {
        $d = $_
        $r = $null
        try { $r = $d | Get-StorageReliabilityCounter -ErrorAction Stop } catch { $r = $null }
        if ($r) {
          $reliability[$d.FriendlyName] = [pscustomobject]@{
            wear          = $r.Wear
            temperature   = $r.Temperature
            powerOnHours  = $r.PowerOnHours
            startStopCycle= $r.StartStopCycleCount
            readErrors    = $r.ReadErrorsTotal
            writeErrors   = $r.WriteErrorsTotal
          }
        }
      }
    } catch { }
    $smartFail = $null
    try {
      $smartFail = (Get-CimInstance -Namespace root\wmi -ClassName MSStorageDriver_FailurePredictStatus -ErrorAction Stop |
                    Where-Object { $_.PredictFailure -eq $true } | Measure-Object).Count
    } catch { $smartFail = $null }
    $drives = Get-CimInstance Win32_DiskDrive
    $vols = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3"
    [pscustomobject]@{
      disks = ($phys | ForEach-Object { [pscustomobject]@{
        friendlyName = $_.FriendlyName
        mediaType    = "$($_.MediaType)"
        busType      = "$($_.BusType)"
        size         = $_.Size
        health       = "$($_.HealthStatus)"
        operational  = "$($_.OperationalStatus)"
        serial       = $_.SerialNumber
        firmware     = $_.FirmwareVersion
        spindleSpeed = $_.SpindleSpeed
      } })
      volumes = ($vols | ForEach-Object { [pscustomobject]@{
        letter = $_.DeviceID
        label  = $_.VolumeName
        fs     = $_.FileSystem
        size   = $_.Size
        free   = $_.FreeSpace
      } })
      driveCount = ($drives | Measure-Object).Count
      partitionCount = (Get-Partition | Measure-Object).Count
      reliability = ($phys | ForEach-Object {
        $r = $reliability[$_.FriendlyName]
        [pscustomobject]@{
          name          = $_.FriendlyName
          wear          = if ($r) { $r.wear } else { $null }
          temperature   = if ($r) { $r.temperature } else { $null }
          powerOnHours  = if ($r) { $r.powerOnHours } else { $null }
          startStopCycle= if ($r) { $r.startStopCycle } else { $null }
          readErrors    = if ($r) { $r.readErrors } else { $null }
          writeErrors   = if ($r) { $r.writeErrors } else { $null }
        }
      })
      smartPredictFailure = $smartFail
    } | ConvertTo-Json -Compress -Depth 4
