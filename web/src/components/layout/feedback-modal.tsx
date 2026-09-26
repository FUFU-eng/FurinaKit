"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/layout/feedback-modal.tsx");

import { useEscapeDismiss } from "@/lib/use-escape-dismiss";

import React, { useState } from "react";
import {
  MessageSquareHeart,
  Sparkles,
  Send,
  X,
  CheckCircle2,
  Lightbulb,
  Wrench,
  Bug,
  Heart,
  Loader2,
  ImagePlus,
} from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { getSystemEnvironmentInfo } from "@/lib/analytics";

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES = [
  { id: "新工具心愿", label: "新工具心愿", icon: Lightbulb, color: "text-amber-500" },
  { id: "现有功能优化", label: "现有功能优化", icon: Wrench, color: "text-sky-500" },
  { id: "遇到Bug报错", label: "遇到Bug/报错", icon: Bug, color: "text-rose-500" },
  { id: "对芙芙说的话", label: "对芙芙说的话", icon: Heart, color: "text-pink-500" },
];

/** 查询码存本地，下次打开自动带上，用户不用一直记着 */
const CODE_KEY = "furina:feedback-code";

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const __locale = __useLanguage();
  const [category, setCategory] = useState("新工具心愿");
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [images,setImages]=useState<{file:File;url:string}[]>([]);
  const imagesRef=React.useRef(images);
  const [preparing,setPreparing]=useState(false);
  const preparingRef=React.useRef(false),submitRef=React.useRef(false),imageEpoch=React.useRef(0),alive=React.useRef(true);
  const [attachmentWarning,setAttachmentWarning]=useState("");
  React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;imageEpoch.current++;imagesRef.current.forEach(item=>URL.revokeObjectURL(item.url));};},[]);
  React.useEffect(()=>{if(!open){imageEpoch.current++;preparingRef.current=false;setPreparing(false);}},[open]);
  const addImages=async(files:File[])=>{
    if(submitRef.current)return;
    if(preparingRef.current){setErrorMsg("正在准备上一批图片，请稍候再添加。");return;}
    preparingRef.current=true;setPreparing(true);setErrorMsg(null);const epoch=++imageEpoch.current;
    const current=()=>alive.current&&imageEpoch.current===epoch;
    try{
      const converted:File[]=[];const available=4-imagesRef.current.length;
      if(!available)throw new Error("最多附加4张图片，请先移除不需要的图片");
      for(const file of files.slice(0,available)){
        if(!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)&&!((!file.type||file.type==="application/octet-stream")&&/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)))throw new Error("请选择PNG、JPEG、WEBP等图片");
        if(file.size>50*1024*1024)throw new Error("原图过大，请先缩小到50 MiB以内");
        const input=URL.createObjectURL(file);
        try{const image=new Image();image.src=input;await image.decode();if(!current())return;
          const scale=Math.min(1,2000/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const ctx=canvas.getContext("2d");if(!ctx)throw new Error("无法准备图片");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
          const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("图片处理失败")),"image/jpeg",.92));if(!current())return;if(blob.size>4*1024*1024)throw new Error("图片压缩后仍超过4 MiB，请缩小后重试");converted.push(new File([blob],`feedback-${Date.now()}-${converted.length}.jpg`,{type:"image/jpeg"}));
        }finally{URL.revokeObjectURL(input);}
      }
      if(!current())return;
      const next=[...imagesRef.current,...converted.slice(0,4-imagesRef.current.length).map(file=>({file,url:URL.createObjectURL(file)}))];imagesRef.current=next;setImages(next);
      if(files.length>available)setErrorMsg("最多附加4张图片，超出部分未添加。");
    }catch(e){if(current())setErrorMsg(e instanceof Error?e.message:String(e));}
    finally{if(current()){preparingRef.current=false;setPreparing(false);}}
  };
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** 提交成功后拿到的查询码（= 作者后台看到的那条留言编号） */
  const [myCode, setMyCode] = useState("");
  /** 查回复 */
  const [showReplies, setShowReplies] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [replyResult, setReplyResult] = useState<{ found: boolean; text?: string; status?: string; at?: string; note?: string } | null>(null);

  // 打开时把上次的查询码带出来
  React.useEffect(() => {
    if (!open) return;
    try {
      const saved = localStorage.getItem(CODE_KEY) || "";
      if (saved) {
        setMyCode((prev) => prev || saved);
        setCodeInput((prev) => prev || saved);
      }
    } catch {}
  }, [open]);

  const attachmentInput=React.useRef<HTMLInputElement>(null);
  useEscapeDismiss(onClose,open,100);
  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if(submitRef.current)return;
    if(preparingRef.current){setErrorMsg("图片准备完成后才能提交");return;}
    const trimmed = content.trim();
    if (!trimmed) {
      setErrorMsg("请写下你的宝贵建议或想对芙芙说的话哦~");
      return;
    }

    submitRef.current=true;setSubmitting(true);
    setErrorMsg(null);

    try {
      const sys = getSystemEnvironmentInfo();
      const form=new FormData();
      for(const [key,value] of Object.entries({content:trimmed,category,contact:contact.trim(),version:APP_VERSION,os:`${sys.os} (${sys.screenResolution})`}))form.append(key,value);
      imagesRef.current.forEach(image=>form.append("images",image.file));
      const res = await fetch("/api/feedback", { method:"POST", body:form });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "发送失败，请稍后重试");
      }

      // 记下查询码：作者回复后，用户凭它查看
      if (data.code) {
        setMyCode(data.code);
        setCodeInput(data.code);
        try {
          localStorage.setItem(CODE_KEY, data.code);
        } catch {}
      }
      if(!alive.current)return;
      setAttachmentWarning([...(Array.isArray(data.attachmentErrors)?data.attachmentErrors:[]),data.localBackupError?`本地历史保存失败：${data.localBackupError}`:""].filter(Boolean).join("；"));
      setSubmitted(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "提交失败，请检查网络后重试";
      if(alive.current)setErrorMsg(message);
    } finally {
      submitRef.current=false;if(alive.current)setSubmitting(false);
    }
  };

  /** 用查询码看作者回复了没 */
  const handleCheckReply = async () => {
    const code = codeInput.trim();
    if (!code) return;
    setChecking(true);
    setReplyResult(null);
    try {
      const res = await fetch(`/api/feedback/replies?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "查询失败");
      setReplyResult({ found: !!data.found, text: data.text, status: data.status, at: data.at, note: data.note });
      if (data.found) {
        try {
          localStorage.setItem(CODE_KEY, code);
        } catch {}
      }
    } catch (err) {
      setReplyResult({ found: false, note: err instanceof Error ? err.message : "查询失败，请检查网络" });
    } finally {
      setChecking(false);
    }
  };

  const handleReset = () => {
    setContent("");
    imageEpoch.current++;imagesRef.current.forEach(item=>URL.revokeObjectURL(item.url));imagesRef.current=[];setImages([]);setAttachmentWarning("");
    setContact("");
    setSubmitted(false);
    setErrorMsg(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] overflow-y-auto w-[560px] max-w-[94vw] rounded-2xl border border-primary/30 bg-background/95 p-6 shadow-2xl backdrop-blur-md dark:border-primary/40"
        role="dialog" aria-modal="true" aria-label={__ui("提交反馈")}
        onClick={(e) => e.stopPropagation()}
        onPaste={e=>{const files=Array.from(e.clipboardData.files);if(files.length){e.preventDefault();void addImages(files);}}}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X size={18} />
        </button>

        {submitted ? (
          /* 提交成功回执卡片 */
          <div className="py-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 size={36} />
            </div>
            <h3 className="mt-4 text-[18px] font-bold text-foreground">
              {__ui("芙芙已经收到你的宝贵建议啦！✨")}</h3>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
              {__ui("“哼哼~ 每一个建议芙芙都会亲自认真阅读并记录进开发日程哦！感谢你让芙宁娜工具箱变得更加出色与全能~”")}</p>

            {attachmentWarning&&<p role="alert" className="mt-3 text-xs text-destructive">{__ui("文字已送达，附件或本地留底存在以下问题：")}{attachmentWarning}{__ui("。请勿重复提交已送达的文字。")}</p>}
            {/* 查询码：作者回复后凭它查看（作者后台看到的就是这个编号） */}
            {myCode && (
              <div className="mx-auto mt-5 max-w-md rounded-xl border border-primary/25 bg-primary/[0.06] p-3 text-left">
                <p className="text-[12px] font-medium text-foreground">
                  {__ui("🔖 你的查询码")}<span className="ml-2 font-mono text-[13px] font-bold text-primary select-all">{myCode}</span>
                </p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  {__ui("芙芙回复后会在这里显示。查询码已经记在这台电脑上，下次打开这个窗口点「查看芙芙的回复」就能看到， 不用特意记住。")}</p>
                <button
                  type="button"
                  onClick={() => {
                    setShowReplies(true);
                    setSubmitted(false);
                    setTimeout(() => void handleCheckReply(), 50);
                  }}
                  className="mt-2 h-8 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:opacity-90"
                >
                  {__ui("查看芙芙的回复")}</button>
              </div>
            )}

            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={handleReset}
                className="h-9 rounded-xl bg-primary px-6 text-[13px] font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
              >
                {__ui("好的，芙芙")}</button>
            </div>
          </div>
        ) : (
          /* 建议填写表单 */
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 头部标题与芙芙心愿文案 */}
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MessageSquareHeart size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[17px] font-bold text-foreground">
                    {__ui("提建议与工具心愿")}</h2>
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    <Sparkles size={11} />
                    {__ui("直达作者后台")}</span>
                </div>
                {/* 核心文案：严格遵守用户指定文案 */}
                <p className="mt-1 text-[13px] font-medium leading-relaxed text-primary/90 dark:text-primary/80">
                  {__ui("有什么建议想对芙芙说的吗，或者你还希望添加什么工具，尽管告诉芙芙吧！")}</p>
              </div>
            </div>

            {/* 分类标签选择 */}
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-muted-foreground">
                {__ui("建议类型")}</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const isSelected = category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategory(cat.id)}
                      className={`flex items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-[12px] font-medium transition-all ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                          : "border-border/60 bg-muted/40 text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      <Icon size={14} className={isSelected ? "text-primary" : cat.color} />
                      <span>{__ui(cat.label)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 内容输入框 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-medium text-muted-foreground">
                  {__ui("详细描述")}</label>
                <span className="text-[11px] text-muted-foreground font-mono">
                  {content.length}/500
                </span>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={500}
                rows={4}
                placeholder={__ui("例如：希望加入批量图片压缩格式转换、或者视频剪辑片段提取，或某个工具的使用体验建议...")}
                className="w-full resize-none rounded-xl border border-border/70 bg-muted/30 p-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="rounded-xl border border-dashed border-primary/30 bg-primary/[0.04] p-3" data-furinakit-file-field>
              <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[14px] font-semibold">{__ui("附加图片")}<span className="ml-1 text-[13px] font-normal text-muted-foreground">{images.length} / 4</span></p><p className="mt-1 text-[13px] text-muted-foreground">{__ui("支持点击选择、粘贴或拖入图片")}</p></div><button type="button" disabled={submitting||preparing||images.length>=4} onClick={()=>attachmentInput.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"><ImagePlus size={18}/>{preparing?__ui("准备中…"):__ui("添加图片")}</button></div><input ref={attachmentInput} type="file" aria-label={__ui("选择反馈图片")} accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" multiple disabled={submitting||preparing||images.length>=4} className="hidden" onChange={e=>{void addImages(Array.from(e.currentTarget.files||[]));e.currentTarget.value="";}}/>

              {!!images.length&&<div className="mt-3 flex gap-2">{images.map((item,index)=><div key={item.url} className="relative"><img src={item.url} alt={__msg("反馈图片{0}", index+1)} className="h-20 w-24 rounded-lg border border-border object-cover"/><button type="button" aria-label={__ui("移除图片")} disabled={submitting||preparing} onClick={()=>{if(submitRef.current||preparingRef.current)return;URL.revokeObjectURL(item.url);imagesRef.current=imagesRef.current.filter(i=>i!==item);setImages(imagesRef.current);}} className="absolute -right-1 -top-1 rounded-full bg-background p-1"><X size={12}/></button></div>)}</div>}
              <p className="mt-3 text-[14px] leading-7 text-muted-foreground">{__ui("图片会去除元数据，提交后文字与图片都会传达给芙芙哦，说不定下次版本更新时就能看到你想要的内容了！")}</p><p className="mt-1 text-[13px] leading-6 text-muted-foreground">{__ui("温馨提醒：反馈并非私密消息，请先遮盖密码等敏感内容。")}</p>
            </div>
            {/* 选填联系方式 */}
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-muted-foreground">
                {__ui("联系方式 (选填)")}</label>
              <input
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={__ui("邮箱 / QQ / 微信 / GitHub，方便芙芙在实现后向你汇报~")}
                className="w-full rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* 查看作者回复（用查询码） */}
            {showReplies ? (
              <div className="space-y-2 rounded-xl border border-primary/25 bg-primary/[0.05] p-3">
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-medium text-foreground">{__ui("查看芙芙的回复")}</label>
                  <button
                    type="button"
                    onClick={() => setShowReplies(false)}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {__ui("收起")}</button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    placeholder={__ui("填写你的查询码，例如 hDgTtSFU9fzx")}
                    className="min-w-0 flex-1 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={handleCheckReply}
                    disabled={checking || !codeInput.trim()}
                    className="h-9 shrink-0 rounded-xl bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {checking ? __ui("查询中…") : __ui("查询")}
                  </button>
                </div>
                {replyResult &&
                  (replyResult.found ? (
                    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2.5">
                      <div className="flex items-center gap-2 text-[11.5px] text-emerald-600 dark:text-emerald-400">
                        {replyResult.status && (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold">{__msg(replyResult.status)}</span>
                        )}
                        {replyResult.at && <span>{replyResult.at}</span>}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground">{replyResult.text}</p>
                    </div>
                  ) : (
                    <p className="text-[11.5px] text-muted-foreground">{__ui(replyResult.note) || __ui("还没有回复")}</p>
                  ))}
              </div>
            ) : null}

            {/* 错误提示 */}
            {errorMsg && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-2.5 text-[12px] text-destructive">
                {__msg(errorMsg)}
              </div>
            )}

            {/* 底部按钮栏 */}
            <div className="flex items-center justify-between pt-2 border-t border-border/60">
              <span className="text-[11px] text-muted-foreground font-mono">
                v{APP_VERSION}
              </span>
              <div className="flex items-center gap-2">

                {!showReplies && (
                  <button
                    type="button"
                    onClick={() => setShowReplies(true)}
                    className="h-9 rounded-xl border border-border/70 px-3 text-[12.5px] font-medium text-muted-foreground hover:bg-muted transition-colors"
                  >
                    {__ui("查看芙芙的回复")}</button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 rounded-xl border border-border/70 px-4 text-[13px] font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  {__ui("取消")}</button>
                <button
                  type="submit"
                  disabled={submitting || preparing || !content.trim()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-5 text-[13px] font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>{__ui("正在送达...")}</span>
                    </>
                  ) : (
                    <>
                      <Send size={14} />
                      <span>{__ui("发送给芙芙")}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
