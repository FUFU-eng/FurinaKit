// User patterns run off the UI thread; the caller terminates expensive expressions.
self.onmessage=(event:MessageEvent<{pattern:string;flags:string;text:string}>)=>{
 const {pattern,flags,text}=event.data;
 try{const re=new RegExp(pattern,flags);const matches:Array<{text:string;index:number;groups:string[]}>=[];let m:RegExpExecArray|null;
 while((m=re.exec(text))!==null){matches.push({text:m[0],index:m.index,groups:m.slice(1).map(v=>v??'')});if(matches.length>=200||(!re.global&&!re.sticky))break;if(m[0]==='')re.lastIndex+=(re.unicode&&(text.codePointAt(re.lastIndex)||0)>0xffff)?2:1;}
 self.postMessage({matches,error:'',limited:matches.length>=200});
 }catch(e){self.postMessage({matches:[],error:e instanceof Error?e.message:String(e),limited:false});}
};
export {};
