$bb = Get-CimInstance Win32_BaseBoard
    $bios = Get-CimInstance Win32_BIOS
    $cs = Get-CimInstance Win32_ComputerSystem
    $sb = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State' -Name UEFISecureBootEnabled -ErrorAction SilentlyContinue).UEFISecureBootEnabled
    # 下面两项需要管理员权限：提权后 Confirm-SecureBootUEFI 给出的是固件实测值，
    # Win32_Tpm 能给出 TPM 规范版本与厂商版本
    $sbReal = $null
    try { $sbReal = Confirm-SecureBootUEFI } catch { $sbReal = $null }
    $tpmDetail = $null
    try { $tpmDetail = Get-CimInstance -Namespace 'root\CIMV2\Security\MicrosoftTpm' -ClassName Win32_Tpm -ErrorAction Stop } catch { $tpmDetail = $null }
    $tpmWmi = $null
    try { $tpmWmi = Get-CimInstance -ClassName Win32_Tpm -Namespace 'root\CIMV2\Security\MicrosoftTpm' -ErrorAction Stop } catch { $tpmWmi = $null }
    $bitlocker = $null
    try { $bitlocker = (Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop).ProtectionStatus } catch { $bitlocker = $null }
    $tpm = Get-PnpDevice -Class SecurityDevices -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -like '*TPM*' -or $_.FriendlyName -like '*信任*' } | Select-Object -First 1
    $fw = (Get-ComputerInfo -Property BiosFirmwareType).BiosFirmwareType
    [pscustomobject]@{
      boardMaker   = $bb.Manufacturer
      boardProduct = $bb.Product
      boardVersion = $bb.Version
      boardSerial  = $bb.SerialNumber
      biosVendor   = $bios.Manufacturer
      biosVersion  = $bios.SMBIOSBIOSVersion
      biosDate     = $bios.ReleaseDate
      biosDesc     = $bios.Description
      secureBoot   = $sb
      secureBootReal = $sbReal
      tpmSpec      = $tpmDetail.SpecVersion
      tpmVendor    = $tpmDetail.ManufacturerVersion
      tpmEnabled   = $tpmDetail.IsEnabled_InitialValue
      tpmActivated = $tpmDetail.IsActivated_InitialValue
      bitlocker    = "$bitlocker"
      firmwareType = "$fw"
      tpmName      = $tpm.FriendlyName
      tpmStatus    = "$($tpm.Status)"
      hypervisorPresent = $cs.HypervisorPresent
      systemType   = $cs.SystemType
      domain       = $cs.Domain
      workgroup    = $cs.Workgroup
    } | ConvertTo-Json -Compress
