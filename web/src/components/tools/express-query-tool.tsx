import {useEffect,useRef,useState} from 'react';
import {Package,Search,History,RefreshCw,Loader2,ChevronLeft,ChevronRight,ExternalLink,Globe} from 'lucide-react';
import {Button,Input,Label,Select} from '@/components/ui/primitives';
import {useToolDraft} from '@/lib/use-tool-draft';
import {tr,uiMessage,useLanguage,localeTag} from '@/lib/language';
import {readExpressHistory,saveExpressRecord,type ExpressRecord,type ExpressResult} from '@/lib/express-history';

const CARRIERS: {code:string;name:string}[]=[
  { code: "shunfeng", name: "顺丰速运" },
  { code: "yuantong", name: "圆通速递" },
  { code: "zhongtong", name: "中通快递" },
  { code: "shentong", name: "申通快递" },
  { code: "yunda", name: "韵达速递" },
  { code: "jd", name: "京东物流" },
  { code: "jtexpress", name: "极兔速递" },
  { code: "youzhengguonei", name: "邮政快递包裹" },
  { code: "ems", name: "EMS" },
  { code: "debangkuaidi", name: "德邦快递" },
  { code: "huitongkuaidi", name: "百世快递" },
  { code: "tiantian", name: "天天快递" },
  { code: "zhaijisong", name: "宅急送" },
  { code: "youshuwuliu", name: "优速快递" },
  { code: "annengwuliu", name: "安能物流" },
  { code: "quanfengkuaidi", name: "全峰快递" },
  { code: "zhongyouwuliu", name: "中邮物流" },
  { code: "suer", name: "速尔快递" },
  { code: "yuefengwuliu", name: "越丰物流" },
  { code: "dhl", name: "DHL" },
  { code: "fedex", name: "FedEx" },
  { code: "ups", name: "UPS" },
  { code: "usps", name: "USPS" },
];

const OFFICIAL: Record<string,string> = {
  shunfeng:"https://www.sf-express.com/", zhongtong:"https://www.zto.com/", yuantong:"https://www.yto.net.cn/", shentong:"https://www.sto.cn/", yunda:"https://www.yundaex.com/", jtexpress:"https://www.jtexpress.com.cn/", jd:"https://www.jdl.com/", jingdong:"https://www.jdl.com/", ems:"https://www.ems.com.cn/", youzhengguonei:"https://www.ems.com.cn/", debangkuaidi:"https://www.deppon.com/", debangwuliu:"https://www.deppon.com/", dhl:"https://www.dhl.com/", fedex:"https://www.fedex.com/", ups:"https://www.ups.com/", usps:"https://www.usps.com/"
};

const CARRIER_TRACK_URLS: Record<string, (nu: string) => string> = {
  shunfeng: (nu) => `https://www.sf-express.com/cn/sc/dynamic_function/waybill/#search/bill-detail/${nu}`,
  zhongtong: (nu) => `https://www.zto.com/express/expressCheck.html?txtBill=${nu}`,
  shentong: (nu) => `https://www.sto.cn/track.html?bill=${nu}`,
  yunda: () => `https://www.yundaex.com/cn/index.php`,
  yuantong: () => `https://trace.yto.net.cn/`,
  jtexpress: () => `https://www.jtexpress.com.cn/`,
  jd: () => `https://www.jdl.com/`,
  jingdong: () => `https://www.jdl.com/`,
  debangkuaidi: () => `https://www.deppon.com/`,
  debangwuliu: () => `https://www.deppon.com/`,
  ems: () => `https://www.ems.com.cn/`,
  youzhengguonei: () => `https://www.ems.com.cn/`,
  dhl: (nu) => `https://www.dhl.com/cn-zh/home/tracking/tracking-express.html?submit=1&tracking-id=${nu}`,
  fedex: (nu) => `https://www.fedex.com/fedextrack/?trknbr=${nu}`,
  ups: (nu) => `https://www.ups.com/track?loc=zh_CN&tracknum=${nu}`,
  usps: (nu) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${nu}`,
};

function eventDate(value:string): number | null {
  const m=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if(!m)return null;const [y,mo,d,h,mi,se]=m.slice(1).map(Number);const dt=new Date(y,mo-1,d,h,mi,se);
  return dt.getFullYear()===y&&dt.getMonth()===mo-1&&dt.getDate()===d&&h<24&&mi<60&&se<60?dt.getTime():null;
}

const card='min-w-0 rounded-2xl border border-border bg-card p-5';

export function ExpressQueryTool(){
  useLanguage();
  const [number,setNumber]=useToolDraft('express-query','number',''),[company,setCompany]=useToolDraft('express-query','company','');
  const [phone,setPhone]=useState(''),[result,setResult]=useState<ExpressResult|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[stored,setStored]=useState(false),[at,setAt]=useState(0),[storageError,setStorageError]=useState(''),[revision,setRevision]=useState(0),[candidates,setCandidates]=useState<{code:string;name:string}[]>([]);
  const [history,setHistory]=useState<{rows:ExpressRecord[];total:number}>({rows:[],total:0}),[historyQuery,setHistoryQuery]=useState(''),[page,setPage]=useState(0),[historyBusy,setHistoryBusy]=useState(false);
  const lock=useRef(false);
  const owner=useRef(0);
  const [shippedAfter,setShippedAfter]=useState('');

  useEffect(()=>{return()=>{owner.current++;};},[]);

  const targetNumber = (number || result?.number || '').trim().replace(/\s/g,'');
  const targetCompany = company || result?.companyCode || '';
  const kuaidi100Url = targetNumber
    ? `https://www.kuaidi100.com/chaxun?${targetCompany ? `com=${targetCompany}&` : ''}nu=${targetNumber}`
    : 'https://www.kuaidi100.com/';
  const carrierTrackFn = (CARRIER_TRACK_URLS as Record<string, ((nu: string) => string) | undefined>)[targetCompany];
  const carrierTrackUrl = typeof carrierTrackFn === 'function' && targetNumber ? carrierTrackFn(targetNumber) : (OFFICIAL[targetCompany] || '');

  const openUrl = async (url: string) => {
    if (!url) return;
    try {
      if (window.furinakit?.openExternal) {
        await window.furinakit.openExternal(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch(e) {
      setError(String(e));
    }
  };

  useEffect(()=>{let active=true;setHistoryBusy(true);const timer=setTimeout(()=>{void readExpressHistory(page,historyQuery).then(h=>{if(active)setHistory(h);}).catch(e=>{if(active)setStorageError(String(e));}).finally(()=>{if(active)setHistoryBusy(false);});},160);return()=>{active=false;clearTimeout(timer);};},[page,historyQuery,revision]);

  const reset=()=>{owner.current++;setResult(null);setError('');setStored(false);setAt(0);};

  const query=async()=>{
    const n=number.replace(/\s/g,'');if(lock.current||!n)return;
    if(phone.trim() && !/^\d{4}$/.test(phone.trim())){
      setResult(null);
      setError(tr('手机号格式有误，请输入4位纯数字后重试。','Phone number must be exactly 4 digits.'));
      return;
    }
    lock.current=true;setBusy(true);setResult(null);setError('');setStored(false);setStorageError('');
    const token=++owner.current;
    const record:ExpressRecord={id:crypto.randomUUID(),at:Date.now(),number:n,company,result:null,error:''};
    try {
      const response=await fetch('/api/net/express',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({number:n,company,phone:phone.trim()})});
      const d=await response.json();
      if(token!==owner.current)return;
      if(!response.ok||!d.success){if(Array.isArray(d.candidates))setCandidates(d.candidates);throw new Error(d.error||tr('查询失败','Query failed'));}
      if(d.number?.toLowerCase()!==n.toLowerCase()||(company && d.companyCode?.toLowerCase()!==company.toLowerCase())||!Array.isArray(d.traces)||!d.traces.length){
        throw new Error(tr('响应单号或轨迹格式不匹配，未展示不确定结果。','Response tracking format does not match. Unverified results were not displayed.'));
      }
      const notBefore=shippedAfter?new Date(shippedAfter+'T00:00:00').getTime():null;
      for(const event of d.traces){
        if(typeof event.time!=='string'||typeof event.context!=='string'||!event.context.trim())throw new Error(tr('服务返回不完整轨迹，请改用官方查询。','The service returned incomplete events. Use official tracking.'));
        const when=eventDate(event.time);
        if(when!==null&&when>Date.now()+86400000)throw new Error(tr('轨迹包含异常的未来日期，已拒绝展示，请先确认本机时间并核对官方结果。','The timeline contains future dates. Check your system clock and official tracking.'));
        if(notBefore!==null&&(when===null||when<notBefore))throw new Error(tr('轨迹早于你填写的寄件日期，或日期无法核对；可能是旧单号轨迹，已拒绝展示。请使用官方查询。','Events predate your shipping date or cannot be dated. This may be a reused tracking number. Use official tracking.'));
      }
      record.at=Date.now();record.result={...d,checkedAt:new Date(record.at).toISOString()};record.company=d.companyCode;setResult(record.result);setAt(record.at);setCandidates([]);
    } catch(e) {
      if(token!==owner.current)return;
      record.error=e instanceof Error?e.message:String(e);
      setError(record.error);
      setAt(record.at);
    }
    finally {
      if(token===owner.current){try{await saveExpressRecord(record);if(token===owner.current){setPage(0);setRevision(r=>r+1);}}catch(e){if(token===owner.current)setStorageError(tr('本次查询未能写入历史：','This query could not be saved: ')+String(e));}lock.current=false;setBusy(false);}
    }
  };

  const openRecord=(r:ExpressRecord)=>{if(busy)return;owner.current++;setShippedAfter('');setNumber(r.number);setCompany(r.company);setPhone('');setResult(r.result);setError(r.error);setAt(r.at);setStored(true);setCandidates([]);};
  const choices=Array.from(new Map([...CARRIERS,...candidates,...(company&&!CARRIERS.some(c=>c.code===company)?[{code:company,name:company}]:[])].map(c=>[c.code,c])).values());

  return <div className="grid gap-5 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
    <aside className="min-w-0 space-y-4">
      <section className={card}><h2 className="mb-4 flex items-center gap-2 font-semibold"><Package size={18}/>{tr('快递单号查询','Parcel tracking')}</h2><div className="space-y-3">
        <Label htmlFor="express-number">{tr('快递单号','Tracking number')}</Label>
        <Input id="express-number" value={number} disabled={busy} onChange={e=>{setNumber(e.target.value);setCandidates([]);reset();}} onKeyDown={e=>{if(e.key==='Enter')void query();}} placeholder={tr('输入或粘贴单号','Enter or paste a tracking number')}/>
        
        <Label htmlFor="express-company">{tr('快递公司','Carrier')}</Label>
        <Select id="express-company" value={company} disabled={busy} onChange={e=>{setCompany(e.target.value);reset();}}>
          <option value="">{tr('自动识别','Auto-detect')}</option>
          {choices.map(c=><option key={c.code} value={c.code}>{uiMessage(c.name)}</option>)}
        </Select>
        {candidates.length>0&&<p className="text-xs text-amber-600">{tr('请先确认实际承运公司再查询，不自动猜测单号归属。','Confirm the actual carrier before querying; detection is only a suggestion.')}</p>}
        
        <Label htmlFor="express-phone">{tr('手机号后四位（可选，顺丰等隐私件可填）','Last four phone digits (optional, for sensitive SF parcels)')}</Label>
        <Input id="express-phone" value={phone} disabled={busy} maxLength={4} inputMode="numeric" autoComplete="off" onChange={e=>{setPhone(e.target.value);reset();}} placeholder={tr('选填，不填亦可查询基础轨迹','Optional; basic tracking works without phone number')}/>
        
        <Label htmlFor="express-date">{tr('寄件日期（可选，用于排除旧单号轨迹）','Shipping date (optional; reject older parcel events)')}</Label>
        <Input id="express-date" type="date" value={shippedAfter} disabled={busy} onChange={e=>{setShippedAfter(e.target.value);reset();}}/>
        
        <div className="space-y-2 pt-1">
          <Button className="w-full gap-2" disabled={busy||!number.trim()} onClick={()=>void query()}>
            {busy?<Loader2 size={16} className="animate-spin"/>:stored?<RefreshCw size={16}/>:<Search size={16}/>}
            {busy?tr('查询中…','Querying…'):stored?tr('重新查询最新轨迹','Refresh tracking'):tr('查询物流轨迹','Query tracking')}
          </Button>
          
          {targetNumber && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" onClick={()=>void openUrl(kuaidi100Url)}>
                <Globe size={13}/>
                {tr('网页版查询','Kuaidi100')}
                <ExternalLink size={11} className="opacity-60"/>
              </Button>
              {carrierTrackUrl && (
                <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" onClick={()=>void openUrl(carrierTrackUrl)}>
                  <ExternalLink size={13}/>
                  {tr('官网单号直达','Carrier Site')}
                </Button>
              )}
            </div>
          )}
        </div>

        <p className="text-xs leading-5 text-muted-foreground pt-1">{tr('数据来源：快递100公开接口。部分快递（如顺丰、中通）受反爬及隐私保护限制，第三方更新可能有所延迟；若遇到查无结果或与实际不符，请点击上方「网页版查询」或「官网直达」核对。','Source: Kuaidi100 public service. Some carriers (SF, ZTO) restrict automated queries. Use web or carrier links if live data is delayed.')}</p>
      </div></section>
      
      <section className={card}><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><History size={16}/>{tr('完整查询历史','Query history')} <span className="text-muted-foreground">{history.total}</span></h3>
        <Input value={historyQuery} onChange={e=>{setHistoryQuery(e.target.value);setPage(0);}} placeholder={tr('搜索单号或快递公司','Search tracking number or carrier')} aria-label={tr('搜索查询历史','Search history')}/>
        <p className="my-2 text-xs leading-5 text-muted-foreground">{tr('每次查询及完整轨迹保存在本机，不自动清理。点击记录查看当时结果，更新轨迹需重新查询。','Every query and its full timeline are stored locally. Open a record to view that snapshot; refresh to request current tracking.')}</p>
        <div className="max-h-[480px] space-y-1 overflow-y-auto">{historyBusy?<p className="p-3 text-xs">{tr('读取历史…','Loading history…')}</p>:history.rows.map(r=><button key={r.id} type="button" disabled={busy} onClick={()=>openRecord(r)} className="w-full rounded-xl border border-transparent px-3 py-2 text-left hover:border-border hover:bg-muted/50 disabled:opacity-50"><span className="block break-all font-mono text-xs">{r.number}</span><span className="mt-1 block text-xs text-muted-foreground">{r.result?.company||r.company||tr('自动识别','Auto-detect')} · {(r.result?.stateText?uiMessage(r.result.stateText):tr('查询未成功','Query unsuccessful'))}</span><time className="mt-1 block text-[11px] text-muted-foreground">{new Date(r.at).toLocaleString(localeTag())}</time></button>)}{!historyBusy&&!history.total&&<p className="p-4 text-xs text-muted-foreground">{tr('暂无匹配记录','No matching records')}</p>}</div>
        {history.total>25&&<div className="mt-3 flex items-center justify-between"><Button variant="outline" size="sm" disabled={!page||historyBusy} onClick={()=>setPage(p=>p-1)} aria-label={tr('上一页','Previous page')}><ChevronLeft size={14}/></Button><span className="text-xs">{page+1} / {Math.ceil(history.total/25)}</span><Button variant="outline" size="sm" disabled={(page+1)*25>=history.total||historyBusy} onClick={()=>setPage(p=>p+1)} aria-label={tr('下一页','Next page')}><ChevronRight size={14}/></Button></div>}
      </section>
    </aside>

    <section className={card}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{tr('物流轨迹','Tracking timeline')}</h2>
          {Boolean(at)&&(result||error)&&<p className="mt-1 text-xs text-muted-foreground">{stored?tr('历史快照 · ','History snapshot · '):tr('本次查询 · ','Queried · ')}{new Date(at).toLocaleString(localeTag())}</p>}
        </div>
        <div className="flex items-center gap-2">
          {result&&<span className="rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">{uiMessage(result.stateText)}</span>}
          {targetNumber&&<Button type="button" size="sm" variant="ghost" className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={()=>void openUrl(kuaidi100Url)}><Globe size={13}/>{tr('在网页查看','View Web')}<ExternalLink size={11}/></Button>}
        </div>
      </header>
      
      {storageError&&<p role="alert" className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">{uiMessage(storageError)}</p>}
      
      {error&&(
        <div role="alert" className="mb-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm space-y-3">
          <p className="text-foreground leading-relaxed">{uiMessage(error)}</p>
          {targetNumber&&(
            <div className="pt-2 border-t border-border/50 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{tr('推荐通过外部直链查看完整物流：','Recommended: open direct link for full tracking:')}</span>
              <Button type="button" size="sm" variant="default" className="gap-1.5 h-8 text-xs" onClick={()=>void openUrl(kuaidi100Url)}>
                <Globe size={13}/>
                {tr('在快递100网页中查看此单','View on Kuaidi100 Web')}
                <ExternalLink size={12}/>
              </Button>
              {carrierTrackUrl&&(
                <Button type="button" size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={()=>void openUrl(carrierTrackUrl)}>
                  <ExternalLink size={13}/>
                  {tr('前往承运商官网查询','Carrier Official Site')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {result ? (
        <>
          <div className="mb-5 grid gap-2 rounded-xl bg-muted/40 p-3 text-xs sm:grid-cols-2">
            <span>{result.company}</span>
            <span className="break-all font-mono">{result.number}</span>
            <span>{tr('快递100 · ','Kuaidi100 · ')}{result.traces.length} {tr('条轨迹','events')}</span>
            <span>{result.orderVerified?tr('按时间倒序','Newest first'):tr('保持服务方返回顺序','Order provided by the service')}</span>
          </div>
          <p className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-6">
            {tr('以下为第三方返回的原始轨迹，单号可能重复使用。若城市或路线不符，可点击右上角「在网页查看」或承运商官网核对最新动态。','These are third-party events. Tracking numbers may be reused. Use the web view or official carrier link to cross-check latest dispatch status.')}
          </p>
          <ol className="space-y-0 pl-2">
            {result.traces.map((t,i)=>(
              <li key={`${i}:${t.time}`} className="relative border-l border-border pb-5 pl-5 last:pb-0">
                <span className={`absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full ${i===0?'bg-primary':'bg-muted-foreground/40'}`}/>
                <time className="text-xs text-muted-foreground font-mono">{t.time}</time>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{t.context}</p>
              </li>
            ))}
          </ol>
        </>
      ) : !error && (
        <div className="grid min-h-64 place-content-center gap-3 text-center text-muted-foreground">
          <Package size={32} className="mx-auto"/>
          <p className="text-sm">{busy?tr('正在向查询服务获取轨迹…','Requesting tracking data…'):tr('输入单号查询，或从历史中查看完整轨迹。','Enter a tracking number or open a saved timeline.')}</p>
        </div>
      )}
    </section>
  </div>;
}
