import { localeTag as __localeTag } from "@/lib/language";
// Pure display conversion shared with the legacy CIM contract; no Node/OS access.
const gb = (n: number) => n ? Number((n / 1024 ** 3).toFixed(1)) : null;



function overview(data: Record<string, unknown>) {
const uptime = Number(data.uptimeSeconds || 0);
  return {
    ...data,
    totalMemoryGB: gb(Number(data.totalMemory)),
    freeMemoryGB: gb(Number(data.freeMemory)),
    diskTotalGB: gb(Number(data.diskTotal)),
    uptimeText: formatDuration(uptime),
    activatedText: Number(data.activated) === 1 ? "已激活" : Number(data.activated) === 0 ? "未激活" : "未知",
    nodeVersion: null,
    electronChrome: null,
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

function cpu(data: Record<string, unknown>) {
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

function gpu(data: Record<string, unknown>) {
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

function board(data: Record<string, unknown>) {
return {
    ...data,
    biosDateText: data.biosDate ? new Date(String(data.biosDate)).toLocaleDateString(__localeTag()) : null,
    secureBootText:
      Number(data.secureBoot) === 1 ? "已开启" : Number(data.secureBoot) === 0 ? "未开启" : "无法读取",
    firmwareTypeText: String(data.firmwareType || "").toUpperCase().includes("UEFI") ? "UEFI" : String(data.firmwareType || "—"),
    tpmText: data.tpmName ? `${data.tpmName}（${data.tpmStatus === "OK" ? "正常" : data.tpmStatus}）` : "未检测到",
  };
}

function storage(data: Record<string, unknown>) {
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

function network(data: Record<string, unknown>) {
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
    hostname: data.hostname ?? null,
  };
}

function power(data: Record<string, unknown>) {
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
    uptime: formatDuration(Number(data.uptimeSeconds || 0)),
    cpuLoad: null,
    logicalCpus: Number(data.logicalCpus) || null,
  };
}

const converters = { overview, cpu, gpu, board, storage, network, power };
export function normalizeSystemInfo(section: string, data: Record<string, unknown>): Record<string, unknown> {
  const convert = converters[section as keyof typeof converters];
  if (!convert) throw new Error("不支持的硬件信息分区");
  return convert(data);
}
