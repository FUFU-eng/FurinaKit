const messages:Record<string,string>={
 "正在启动独立分离进程…":"Starting the isolated separation process…",
 "正在载入分离引擎…":"Loading the separation engine…",
 "正在校验分离模型…":"Verifying the separation model…",
 "正在载入 ONNX 模型…":"Loading the ONNX model…",
 "正在解码音频…":"Decoding audio…",
 "正在写出人声音轨…":"Writing the vocal track…",
 "正在写出伴奏音轨…":"Writing the instrumental track…",
 "双音轨已生成，正在核对结果…":"Both tracks are generated; checking results…",
 "正在打包人声与伴奏…":"Packaging the vocal and instrumental tracks…",
 "在途中":"In transit","已揽收":"Collected","疑难件":"Delivery exception","已签收":"Delivered","已退签":"Returned after delivery","派送中":"Out for delivery","退回中":"Returning","转单":"Transferred","待清关":"Awaiting customs clearance","清关中":"In customs","已清关":"Customs cleared","清关异常":"Customs exception","已拒签":"Delivery refused","服务方未提供可识别状态":"Unrecognized service status"
};
export function v67Message(value:string,language:string):string|undefined {
 if(language!=="en")return undefined;
 if(Object.prototype.hasOwnProperty.call(messages,value))return messages[value];
 let m=/^正在分离第 (\d+)\/(\d+) 块 · (CPU 推理|合并推理)$/.exec(value);
 if(m)return `Separating chunk ${m[1]}/${m[2]} · ${m[3]==='CPU 推理'?'CPU inference':'Combining inference'}`;
 m=/^已完成 (\d+)\/(\d+) 块分离$/.exec(value);if(m)return `Separated ${m[1]}/${m[2]} chunks`;
 return undefined;
}
