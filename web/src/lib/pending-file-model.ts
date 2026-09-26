import {desktopBridge} from '@/bridge';
/** Shared, exact file matching. A category is not a file format. */
export type FileKind = 'image' | 'pdf' | 'audio' | 'video' | 'office' | 'other';
export interface PendingFileItem { name: string; path?: string; type: string; size?: number; dataUrl?: string; file?: File }
export const KIND_NAMES: Record<FileKind, string> = { image: '图片', pdf: 'PDF', audio: '音频', video: '视频', office: '文档', other: '其他' };
const MIMES: Record<string, string> = {
  jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif', bmp:'image/bmp', tif:'image/tiff', tiff:'image/tiff', svg:'image/svg+xml', ico:'image/x-icon', avif:'image/avif',
  pdf:'application/pdf', mp4:'video/mp4', m4v:'video/mp4', mov:'video/quicktime', mkv:'video/x-matroska', avi:'video/x-msvideo', webm:'video/webm', flv:'video/x-flv', wmv:'video/x-ms-wmv',
  mp3:'audio/mpeg', wav:'audio/wav', flac:'audio/flac', aac:'audio/aac', ogg:'audio/ogg', m4a:'audio/mp4', wma:'audio/x-ms-wma', opus:'audio/opus',
  txt:'text/plain', csv:'text/csv', json:'application/json', md:'text/markdown', zip:'application/zip',
};
export function fileMime(item: Pick<PendingFileItem,'name'|'type'>): string {
  return item.type.includes('/') && item.type !== 'application/octet-stream' ? item.type.toLowerCase() : MIMES[item.name.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream';
}
export function fileKind(item: Pick<PendingFileItem,'name'|'type'>): FileKind {
  const mime = fileMime(item);
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  return /\.(docx?|xlsx?|pptx?|txt|md|csv|json)$/i.test(item.name) ? 'office' : 'other';
}
export function acceptsFile(item: Pick<PendingFileItem,'name'|'type'>, accept = ''): boolean {
  if (!accept.trim()) return true;
  const mime = fileMime(item);
  return accept.split(',').some(raw => {
    const rule = raw.trim().toLowerCase();
    if (!rule) return false;
    if (rule === '*' || rule === '*/*') return true;
    if (rule.startsWith('.')) return item.name.toLowerCase().endsWith(rule);
    return rule.endsWith('/*') ? mime.startsWith(rule.slice(0, -1)) : mime === rule;
  });
}
export function groupFiles(files: PendingFileItem[]) {
  return (Object.keys(KIND_NAMES) as FileKind[]).map(kind => ({ kind, files: files.filter(f => fileKind(f) === kind) })).filter(g => g.files.length);
}
export function fromFiles(files: File[]): PendingFileItem[] {
  return files.map(file => ({ name:file.name, type:file.type, size:file.size, file, path:(file as File & {path?:string}).path }));
}
export async function loadPendingFile(item: PendingFileItem, valid:()=>boolean=()=>true): Promise<File> {
  if (item.file) return item.file;
  let url = item.dataUrl;
  if (!url && item.path) {
    const api=desktopBridge();
    const info=await api.pendingFileInfo(item.path);
    const parts:BlobPart[]=[];
    const chunkSize=4*1024*1024;
    for(let offset=0;offset<info.size;offset+=chunkSize){
      if(!valid())throw new Error('已取消载入');
      const length=Math.min(chunkSize,info.size-offset);
      const raw=await api.readPendingFileChunk(item.path,offset,length);
      const bytes=raw instanceof ArrayBuffer?raw:new Uint8Array(raw).buffer;
      if(bytes.byteLength!==length)throw new Error(`文件读取不完整：${item.name}`);
      parts.push(bytes);
    }
    const after=await api.pendingFileInfo(item.path);
    if(after.size!==info.size || after.modified!==info.modified)throw new Error(`文件在读取时发生变化，请重试：${item.name}`);
    return new File(parts,item.name,{type:fileMime(item)});
  }
  if (!url) throw new Error(`文件已不可用，请重新拖入：${item.name}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法读取：${item.name}`);
  return new File([await response.blob()], item.name, { type:fileMime(item) });
}
