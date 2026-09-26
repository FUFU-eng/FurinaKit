import { localeTag as __localeTag } from "@/lib/language";
import { execFile } from "child_process";
import os from "os";

/**
 * 本机系统与硬件信息（只读）
 *
 * 全部通过 PowerShell 的 CIM/WMI 查询获取，不需要管理员权限的项都尽量用了替代来源：
 *   · 安全启动 —— Confirm-SecureBootUEFI 要管理员，改读注册表 UEFISecureBootEnabled
 *   · TPM      —— Win32_Tpm 要管理员，改读设备树里的安全设备
 *   · 电池设计容量 —— root/wmi 的 BatteryStaticData 在多数机型上取不到，
 *                     改用 powercfg 生成的电池报告
 * 确实需要管理员才能拿到的（NVMe 磨损度、SMART 预测失败等）不硬凑，界面上如实说明。
 */

export interface SysSection {
  [key: string]: unknown;
}

const PS_TIMEOUT = 25_000;

/**
 * 当前进程是否以管理员身份运行。
 * 主进程启动时会把它探测到的结果写进环境变量，这里优先读它；读不到再自己查一次。
 */
let elevatedCache: boolean | null = null;
export async function isElevated(): Promise<boolean> {
  if (elevatedCache !== null) return elevatedCache;
  if (process.env.FURINAKIT_ELEVATED === "1") {
    elevatedCache = true;
    return true;
  }
  elevatedCache = await new Promise<boolean>((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$id=[Security.Principal.WindowsIdentity]::GetCurrent();" +
          "$p=New-Object Security.Principal.WindowsPrincipal($id);" +
          "if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){'1'}else{'0'}",
      ],
      { timeout: 15_000, windowsHide: true, encoding: "utf8" },
      (err, stdout) => resolve(!err && String(stdout || "").trim().endsWith("1")),
    );
  });
  return elevatedCache;
}

/** 跑一段 PowerShell 并取回 JSON（脚本里用 ConvertTo-Json 输出） */
async function runPs(script: string): Promise<Record<string, unknown>> {
  const wrapped = `$ErrorActionPreference='SilentlyContinue';$ProgressPreference='SilentlyContinue';${script}`;
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", wrapped],
      { timeout: PS_TIMEOUT, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
      (err, stdout) => {
        if (err && !stdout) {
          resolve({ error: err.message });
          return;
        }
        const text = (stdout || "").trim();
        if (!text) {
          resolve({});
          return;
        }
        try {
          const parsed = JSON.parse(text);
          resolve(Array.isArray(parsed) ? { items: parsed } : parsed);
        } catch {
          resolve({ raw: text.slice(0, 400) });
        }
      },
    );
  });
}

const gb = (bytes: number | undefined | null) => (bytes ? Number((bytes / 1024 ** 3).toFixed(1)) : null);
const mb = (bytes: number | undefined | null) => (bytes ? Math.round(bytes / 1024 ** 2) : null);

/* ────────────────────────── 1. 设备概况 ────────────────────────── */

export async function getOverview() {
  const data = await runPs(`
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
  `);

  const uptime = Number(data.uptimeSeconds || 0);
  return {
    ...data,
    totalMemoryGB: gb(Number(data.totalMemory)),
    freeMemoryGB: gb(Number(data.freeMemory)),
    diskTotalGB: gb(Number(data.diskTotal)),
    uptimeText: formatDuration(uptime),
    activatedText: Number(data.activated) === 1 ? "已激活" : Number(data.activated) === 0 ? "未激活" : "未知",
    nodeVersion: process.version,
    electronChrome: process.versions.chrome ?? null,
  };
}

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} 天 ${h} 小时 ${m} 分`;
  if (h) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
}

/* ────────────────────────── 2. 处理器与内存 ────────────────────────── */

export async function getCpuMemory() {
  const data = await runPs(`
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
                       part     = ($_.PartNumber -replace '\\s+$','')
                       maker    = $_.Manufacturer
                       slot     = $_.DeviceLocator
                       type     = $_.SMBIOSMemoryType
                     } })
    } | ConvertTo-Json -Compress -Depth 4
  `);

  const DDR = { 20: "DDR", 21: "DDR2", 24: "DDR3", 26: "DDR4", 34: "DDR5" } as Record<number, string>;
  const sticks = Array.isArray(data.sticks) ? data.sticks : data.sticks ? [data.sticks] : [];
  const total = Number(data.totalMem || 0);
  const free = Number(data.freeMem || 0);
  return {
    ...data,
    curClock: Number(data.curClock) || Number(data.maxClock),
    totalMemGB: gb(total),
    usedMemGB: gb(total - free),
    freeMemGB: gb(free),
    memUsage: total ? Math.round(((total - free) / total) * 1000) / 10 : 0,
    commitUsedGB: gb(Number(data.commitLimit || 0) - Number(data.commitFree || 0)),
    commitLimitGB: gb(Number(data.commitLimit)),
    l2Text: data.l2 ? `${(Number(data.l2) / 1024).toFixed(1)} MB` : null,
    l3Text: data.l3 ? `${(Number(data.l3) / 1024).toFixed(1)} MB` : null,
    sticks: sticks.map((s: Record<string, unknown>) => ({
      capacityGB: gb(Number(s.capacity)),
      speedMHz: s.speed,
      part: s.part,
      maker: s.maker,
      slot: s.slot,
      typeText: DDR[Number(s.type)] ?? (s.type ? `类型 ${s.type}` : null),
    })),
    coreUsage: Array.isArray(data.coreUsage) ? data.coreUsage : [],
  };
}

/* ────────────────────────── 3. 显卡与显示器 ────────────────────────── */

export async function getGpuDisplay() {
  const data = await runPs(`
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
  `);

  const gpus = Array.isArray(data.gpus) ? data.gpus : data.gpus ? [data.gpus] : [];
  const monitors = Array.isArray(data.monitors) ? data.monitors : data.monitors ? [data.monitors] : [];
  const sizes = Array.isArray(data.monitorSizes) ? data.monitorSizes : [];
  return {
    gpuLoad: Number(data.gpuLoad) || 0,
    gpus: gpus.map((g: Record<string, unknown>) => ({
      ...g,
      // WMI 的 AdapterRAM 是 32 位有符号数，超过 4GB 会溢出，这里标注一下
      vramGB: g.vram ? Number((Number(g.vram) / 1024 ** 3).toFixed(2)) : null,
      vramNote: Number(g.vram) > 4_000_000_000 ? "（WMI 上限，实际可能更大）" : "",
    })),
    monitors: monitors.map((m: Record<string, unknown>, i: number) => {
      const size = sizes[i] as Record<string, number> | undefined;
      const diag = size ? Math.round(Math.sqrt((size.maxH || 0) ** 2 + (size.maxV || 0) ** 2) / 2.54) : null;
      return { ...m, sizeInch: diag && diag > 5 && diag < 100 ? diag : null };
    }),
  };
}

/* ────────────────────────── 4. 主板与固件 ────────────────────────── */

export async function getBoardFirmware() {
  const data = await runPs(`
    $bb = Get-CimInstance Win32_BaseBoard
    $bios = Get-CimInstance Win32_BIOS
    $cs = Get-CimInstance Win32_ComputerSystem
    $sb = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecureBoot\\State' -Name UEFISecureBootEnabled -ErrorAction SilentlyContinue).UEFISecureBootEnabled
    # 下面两项需要管理员权限：提权后 Confirm-SecureBootUEFI 给出的是固件实测值，
    # Win32_Tpm 能给出 TPM 规范版本与厂商版本
    $sbReal = $null
    try { $sbReal = Confirm-SecureBootUEFI } catch { $sbReal = $null }
    $tpmDetail = $null
    try { $tpmDetail = Get-CimInstance -Namespace 'root\\CIMV2\\Security\\MicrosoftTpm' -ClassName Win32_Tpm -ErrorAction Stop } catch { $tpmDetail = $null }
    $tpmWmi = $null
    try { $tpmWmi = Get-CimInstance -ClassName Win32_Tpm -Namespace 'root\\CIMV2\\Security\\MicrosoftTpm' -ErrorAction Stop } catch { $tpmWmi = $null }
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
  `);
  return {
    ...data,
    biosDateText: data.biosDate ? new Date(String(data.biosDate)).toLocaleDateString(__localeTag()) : null,
    secureBootText:
      Number(data.secureBoot) === 1 ? "已开启" : Number(data.secureBoot) === 0 ? "未开启" : "无法读取",
    firmwareTypeText: String(data.firmwareType || "").toUpperCase().includes("UEFI") ? "UEFI" : String(data.firmwareType || "—"),
    tpmText: data.tpmName ? `${data.tpmName}（${data.tpmStatus === "OK" ? "正常" : data.tpmStatus}）` : "未检测到",
  };
}

/* ────────────────────────── 5. 硬盘健康 ────────────────────────── */

export async function getStorageHealth() {
  const data = await runPs(`
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
  `);

  const disks = Array.isArray(data.disks) ? data.disks : data.disks ? [data.disks] : [];
  const volumes = Array.isArray(data.volumes) ? data.volumes : data.volumes ? [data.volumes] : [];
  return {
    disks: disks.map((d: Record<string, unknown>) => ({
      ...d,
      sizeGB: gb(Number(d.size)),
      healthText: String(d.health) === "Healthy" ? "正常" : String(d.health) === "Warning" ? "警告" : String(d.health) || "未知",
      mediaText: String(d.mediaType) === "SSD" ? "固态硬盘" : String(d.mediaType) === "HDD" ? "机械硬盘" : String(d.mediaType) || "未知",
      busText: String(d.busType) || "未知",
      rpmText: Number(d.spindleSpeed) > 0 ? `${d.spindleSpeed} RPM` : null,
    })),
    volumes: volumes.map((v: Record<string, unknown>) => {
      const size = Number(v.size || 0);
      const free = Number(v.free || 0);
      return {
        ...v,
        sizeGB: gb(size),
        freeGB: gb(free),
        usedPercent: size ? Math.round(((size - free) / size) * 100) : 0,
      };
    }),
    driveCount: Number(data.driveCount) || 0,
    partitionCount: Number(data.partitionCount) || 0,
    // SMART 的磨损度与预测失败需要管理员权限，这里如实标注
    wearNote: "磨损度、通电时间等 SMART 明细需要以管理员身份运行才能读取",
  };
}

/* ────────────────────────── 6. 网络适配器 ────────────────────────── */

export async function getNetworkDevices() {
  const data = await runPs(`
    $adapters = Get-NetAdapter
    $up = Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' }
    $wlan = netsh wlan show interfaces
    $ssid = ($wlan | Select-String '^\\s+SSID\\s+:' | Select-Object -First 1) -replace '.*:\\s*',''
    $bssid = ($wlan | Select-String 'BSSID' | Select-Object -First 1) -replace '.*:\\s*',''
    $signal = ($wlan | Select-String 'Signal' | Select-Object -First 1) -replace '.*:\\s*',''
    $radio = ($wlan | Select-String 'Radio type' | Select-Object -First 1) -replace '.*:\\s*',''
    $channel = ($wlan | Select-String 'Channel' | Select-Object -First 1) -replace '.*:\\s*',''
    [pscustomobject]@{
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
  `);

  const adapters = Array.isArray(data.adapters) ? data.adapters : data.adapters ? [data.adapters] : [];
  const configs = Array.isArray(data.configs) ? data.configs : data.configs ? [data.configs] : [];
  return {
    adapters: adapters.map((a: Record<string, unknown>) => ({
      ...a,
      statusText: String(a.status) === "Up" ? "已连接" : String(a.status) === "Disconnected" ? "未连接" : String(a.status) || "—",
      isVirtual: a.virtual === true,
    })),
    configs,
    wifi: data.ssid ? { ssid: data.ssid, bssid: data.bssid, signal: data.signal, radio: data.radio, channel: data.channel } : null,
    hostname: os.hostname(),
  };
}

/* ────────────────────────── 7. 电源与温度 ────────────────────────── */

export async function getPowerSensors() {
  const data = await runPs(`
    $bat = Get-CimInstance Win32_Battery
    $full = (Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue).FullChargedCapacity
    $online = (Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue).PowerOnline
    $scheme = (powercfg /getactivescheme) -join ''
    $thermal = (Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue |
                ForEach-Object { [math]::Round($_.CurrentTemperature / 10 - 273.15, 1) })
    $fan = (Get-CimInstance Win32_Fan -ErrorAction SilentlyContinue | ForEach-Object { $_.DesiredSpeed })
    [pscustomobject]@{
      batteryName   = $bat.Name
      charge        = $bat.EstimatedChargeRemaining
      status        = $bat.BatteryStatus
      fullCharge    = $full
      powerOnline   = $online
      scheme        = "$scheme"
      thermal       = ($thermal)
      fan           = ($fan)
    } | ConvertTo-Json -Compress -Depth 3
  `);

  const BATTERY_STATUS: Record<number, string> = {
    1: "未充电（已接通电源）",
    2: "正在充电",
    3: "正在放电",
    4: "电量低",
    5: "电量极低",
    6: "正在充电（电量低）",
    7: "正在充电（电量极低）",
    8: "正在充电",
    9: "正在充电（电量高）",
    11: "部分充电",
  };
  const schemeMatch = String(data.scheme || "").match(/\(([^)]+)\)/);
  const thermal = Array.isArray(data.thermal) ? data.thermal.filter((t: number) => t > -100 && t < 150) : [];
  return {
    hasBattery: Boolean(data.batteryName),
    batteryName: data.batteryName,
    charge: Number(data.charge) || 0,
    statusText: BATTERY_STATUS[Number(data.status)] ?? "未知",
    powerOnline: data.powerOnline === true,
    fullChargeText: data.fullCharge ? `${Math.round(Number(data.fullCharge) / 1000)} Wh` : null,
    schemeText: schemeMatch ? schemeMatch[1] : String(data.scheme || "—").slice(0, 40),
    thermal: thermal.length ? thermal.slice(0, 6) : [],
    thermalNote: thermal.length ? null : "这台设备的固件没有开放温度传感器读数",
    fan: Array.isArray(data.fan) ? data.fan : [],
    fanNote: "风扇转速通常需要厂商驱动或管理员权限才能读取",
    uptime: formatDuration(os.uptime()),
    cpuLoad: os.loadavg()[0],
    logicalCpus: os.cpus().length,
  };
}

/* ────────────────────────── 统一入口 ────────────────────────── */

export const SYSTEM_SECTIONS = ["overview", "cpu", "gpu", "board", "storage", "network", "power"] as const;
export type SystemSection = (typeof SYSTEM_SECTIONS)[number];

export async function getSystemSection(section: SystemSection): Promise<SysSection> {
  switch (section) {
    case "overview":
      return getOverview();
    case "cpu":
      return getCpuMemory();
    case "gpu":
      return getGpuDisplay();
    case "board":
      return getBoardFirmware();
    case "storage":
      return getStorageHealth();
    case "network":
      return getNetworkDevices();
    case "power":
      return getPowerSensors();
    default:
      return {};
  }
}

export { mb };
