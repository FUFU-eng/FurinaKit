"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { Copy, Check, Download, Trash2, Star, Plus, Film, BookOpen, Tv } from "lucide-react";

// ==================== 繁简转换 ====================

// 常用简繁对照表（简体 -> 繁体）
const S2T_MAP: Record<string, string> = {
  "爱":"愛","碍":"礙","暗":"暗","袄":"襖","奥":"奧","罢":"罷","坝":"壩","摆":"擺","败":"敗","办":"辦","板":"闆","版":"版","半":"半","宝":"寶","报":"報","币":"幣","毙":"斃","标":"標","表":"表","别":"別","宾":"賓","补":"補","才":"才","参":"參","层":"層","搀":"攙","谗":"讒","馋":"饞","缠":"纏","产":"產","忏":"懺","偿":"償","厂":"廠","长":"長","车":"車","彻":"徹","尘":"塵","陈":"陳","衬":"襯","称":"稱","惩":"懲","迟":"遲","冲":"沖","虫":"蟲","筹":"籌","处":"處","触":"觸","出":"齣","础":"礎","辞":"辭","词":"詞","聪":"聰","从":"從","丛":"叢","窜":"竄","达":"達","带":"帶","贷":"貸","担":"擔","单":"單","当":"當","档":"檔","党":"黨","导":"導","灯":"燈","邓":"鄧","敌":"敵","涤":"滌","递":"遞","点":"點","电":"電","垫":"墊","东":"東","冬":"鼕","动":"動","栋":"棟","斗":"鬥","独":"獨","断":"斷","对":"對","队":"隊","吨":"噸","夺":"奪","堕":"墮","鹅":"鵝","儿":"兒","尔":"爾","发":"發","罚":"罰","矾":"礬","范":"範","飞":"飛","废":"廢","费":"費","坟":"墳","奋":"奮","粪":"糞","风":"風","丰":"豐","凤":"鳳","肤":"膚","妇":"婦","复":"復","负":"負","盖":"蓋","干":"幹","赶":"趕","个":"個","巩":"鞏","贡":"貢","沟":"溝","构":"構","购":"購","谷":"穀","顾":"顧","刮":"颳","关":"關","观":"觀","广":"廣","归":"歸","龟":"龜","国":"國","过":"過","汉":"漢","号":"號","合":"閤","轰":"轟","后":"後","胡":"鬍","壶":"壺","沪":"滬","护":"護","划":"劃","怀":"懷","坏":"壞","欢":"歡","环":"環","还":"還","回":"迴","汇":"匯","会":"會","秽":"穢","伙":"夥","获":"獲","机":"機","击":"擊","积":"積","极":"極","际":"際","剂":"劑","济":"濟","计":"計","记":"記","纪":"紀","夹":"夾","价":"價","艰":"艱","歼":"殲","茧":"繭","检":"檢","减":"減","荐":"薦","见":"見","键":"鍵","将":"將","浆":"漿","桨":"槳","奖":"獎","讲":"講","酱":"醬","胶":"膠","阶":"階","节":"節","杰":"傑","结":"結","仅":"僅","紧":"緊","进":"進","尽":"盡","劲":"勁","荆":"荊","惊":"驚","竞":"競","旧":"舊","剧":"劇","据":"據","巨":"鉅","惧":"懼","卷":"捲","觉":"覺","开":"開","克":"剋","垦":"墾","恳":"懇","夸":"誇","块":"塊","矿":"礦","亏":"虧","困":"睏","扩":"擴","蜡":"蠟","腊":"臘","来":"來","赖":"賴","兰":"蘭","拦":"攔","篮":"籃","阑":"闌","蓝":"藍","烂":"爛","劳":"勞","乐":"樂","类":"類","累":"纍","离":"離","里":"裡","历":"歷","丽":"麗","俩":"倆","联":"聯","怜":"憐","炼":"煉","练":"練","粮":"糧","两":"兩","辆":"輛","了":"瞭","猎":"獵","临":"臨","邻":"鄰","灵":"靈","龄":"齡","岭":"嶺","庐":"廬","芦":"蘆","炉":"爐","陆":"陸","驴":"驢","乱":"亂","仑":"侖","罗":"羅","马":"馬","买":"買","卖":"賣","麦":"麥","门":"門","黾":"黽","梦":"夢","面":"麵","庙":"廟","灭":"滅","悯":"憫","酿":"釀","鸟":"鳥","聂":"聶","宁":"寧","农":"農","疟":"瘧","盘":"盤","辟":"闢","苹":"蘋","凭":"憑","扑":"撲","仆":"僕","朴":"樸","齐":"齊","气":"氣","迁":"遷","佥":"僉","签":"簽","千":"韆","牵":"牽","纤":"纖","钱":"錢","强":"強","墙":"牆","抢":"搶","乔":"喬","桥":"橋","窍":"竅","切":"竊","亲":"親","寝":"寢","庆":"慶","穷":"窮","琼":"瓊","秋":"鞦","区":"區","曲":"麯","权":"權","劝":"勸","确":"確","让":"讓","扰":"擾","热":"熱","认":"認","荣":"榮","软":"軟","萨":"薩","赛":"賽","三":"叄","丧":"喪","扫":"掃","涩":"澀","杀":"殺","晒":"曬","伤":"傷","舍":"捨","设":"設","沈":"瀋","声":"聲","胜":"勝","圣":"聖","师":"師","湿":"濕","诗":"詩","时":"時","识":"識","实":"實","势":"勢","适":"適","寿":"壽","书":"書","术":"術","树":"樹","帅":"帥","双":"雙","谁":"誰","松":"鬆","苏":"蘇","肃":"肅","虽":"雖","随":"隨","孙":"孫","锁":"鎖","台":"臺","态":"態","坛":"壇","叹":"嘆","誊":"謄","体":"體","条":"條","粜":"糶","铁":"鐵","听":"聽","厅":"廳","头":"頭","图":"圖","涂":"塗","团":"團","椭":"橢","万":"萬","为":"為","韦":"韋","违":"違","围":"圍","唯":"維","伟":"偉","伪":"偽","网":"網","卫":"衛","稳":"穩","务":"務","雾":"霧","牺":"犧","习":"習","系":"係","戏":"戲","虾":"蝦","吓":"嚇","写":"寫","协":"協","胁":"脅","泻":"瀉","亵":"褻","衅":"釁","兴":"興","须":"須","虚":"虛","选":"選","旋":"鏇","悬":"懸","学":"學","寻":"尋","压":"壓","盐":"鹽","阳":"陽","养":"養","痒":"癢","样":"樣","钥":"鑰","药":"藥","爷":"爺","业":"業","页":"頁","医":"醫","义":"義","艺":"藝","亿":"億","忆":"憶","应":"應","痈":"癰","拥":"擁","佣":"傭","踊":"踴","优":"優","邮":"郵","余":"餘","与":"與","誉":"譽","吁":"籲","郁":"鬱","御":"禦","渊":"淵","远":"遠","园":"園","愿":"願","跃":"躍","运":"運","酝":"醞","杂":"雜","灾":"災","赃":"贓","脏":"髒","凿":"鑿","枣":"棗","灶":"竈","斋":"齋","毡":"氈","战":"戰","赵":"趙","这":"這","折":"摺","征":"徵","症":"癥","证":"證","只":"隻","致":"緻","制":"製","质":"質","钟":"鐘","肿":"腫","种":"種","众":"眾","昼":"晝","猪":"豬","筑":"築","注":"註","驻":"駐","专":"專","庄":"莊","装":"裝","壮":"壯","状":"狀","锥":"錐","准":"準","浊":"濁","总":"總","钻":"鑽","组":"組","妆":"妝","丝":"絲","丢":"丟","严":"嚴","举":"舉","么":"麼","乌":"烏","乡":"鄉","争":"爭","于":"於","云":"雲","亚":"亞","亩":"畝","仓":"倉","仪":"儀","们":"們","伛":"傴","传":"傳","伦":"倫","侠":"俠","侣":"侶","侥":"僥","侦":"偵","侧":"側","侨":"僑","侩":"儈","侪":"儕","侬":"儂","俣":"俁","俦":"儔","俨":"儼","俪":"儷","俭":"儉","债":"債","倾":"傾","偬":"傯","偻":"僂","偾":"僨","储":"儲","催":"催","傥":"儻","傧":"儐","傩":"儺","兑":"兌","兖":"兗","内":"內","冈":"岡","册":"冊","军":"軍","冯":"馮","决":"決","况":"況","冻":"凍","净":"淨","凄":"淒","凉":"涼","凋":"凋","凑":"湊","凛":"凜","几":"幾","凫":"鳧","凯":"凱","刍":"芻","刘":"劉","则":"則","刚":"剛","创":"創","删":"刪","刬":"剗","刭":"剄","刹":"剎","刽":"劊","刿":"劌","剀":"剴","剐":"剮","剑":"劍","剥":"剝","励":"勵","勋":"勛","勐":"勐","勘":"勘","匀":"勻","匦":"匭","匮":"匱","华":"華","卢":"盧","卤":"鹵","却":"卻","厉":"厲","厌":"厭","厍":"庫","厐":"龐","厕":"廁","厘":"釐","厢":"廂","厦":"廈","厨":"廚","厩":"廄","县":"縣","叁":"叄","变":"變","叙":"敘","叠":"疊","叶":"葉","叽":"嘰","吕":"呂","吗":"嗎","启":"啟","吴":"吳","呐":"吶","呒":"嘸","呓":"囈","呕":"嘔","呖":"嚦","呗":"唄","员":"員","呙":"咼","呛":"嗆","呜":"嗚","咏":"詠","咙":"嚨","咛":"嚀","咝":"噝","咤":"吒","哑":"啞","哒":"噠","哓":"嘵","哔":"嗶","哕":"噦","哗":"嘩","哙":"噲","哜":"嚌","哝":"噥","哟":"喲","唛":"嘜","唝":"嗊","唠":"嘮","唡":"啢","唢":"嗩","唤":"喚","啧":"嘖","啬":"嗇","啭":"囀","啮":"嚙","啴":"嘽","啸":"嘯","喷":"噴","喽":"嘍","喾":"嚳","嗫":"囁","嗳":"噯","嘘":"噓","嘤":"嚶","嘱":"囑","噜":"嚕","嚣":"囂","囊":"囊","囅":"囅","箩":"籮","籁":"籟","籴":"糴","籾":"籾","渔":"漁","渑":"澠","汤":"湯","汹":"洶","浅":"淺","浏":"瀏","浐":"滻","浑":"渾","浓":"濃","泽":"澤","泾":"涇","洼":"窪","洁":"潔","洒":"灑","浃":"漬","测":"測","浍":"澮","浒":"滸","浔":"潯","浕":"濜","涛":"濤","涝":"澇","涞":"淶","涟":"漣","涠":"潿","涡":"渦","涣":"渙","润":"潤","涧":"澗","涨":"漲","渌":"淥","渍":"漬","渎":"瀆","渐":"漸","渖":"瀋","渗":"滲","温":"溫","湾":"灣","溃":"潰","溅":"濺","溆":"漵","滗":"潷","滚":"滾","滞":"滯","滟":"灩","滠":"灄","满":"滿","滢":"瀅","滤":"濾","滥":"濫","滦":"灤","滨":"濱","滩":"灘","滪":"澦","漤":"灠","潄":"潄","潜":"潛","潴":"潴","潋":"瀲","潍":"濰","澜":"瀾","濑":"瀨","濒":"瀕","灏":"灝","灿":"燦","炀":"煬","炖":"燉","炜":"煒","炝":"熗","炽":"熾","烁":"爍","烃":"烴","烛":"燭","烟":"煙","烦":"煩","烧":"燒","烨":"燁","烩":"燴","烫":"燙","烬":"燼","焕":"煥","焖":"燜","焘":"燾","煴":"煴","牍":"牘","牦":"犛","犷":"獷","犸":"獁","犹":"猶","狈":"狽","狝":"獮","狞":"獰","狭":"狹","狮":"獅","狯":"獪","狰":"猙","狱":"獄","狲":"猻","猡":"玀","猕":"獼","猫":"貓","猬":"蝟","献":"獻","獭":"獺","玑":"璣","玙":"璵","玛":"瑪","玮":"瑋","现":"現","玱":"瑲","玺":"璽","珐":"琺","珑":"瓏","珰":"璫","珲":"琿","琏":"璉","琐":"瑣","瑶":"瑤","瑷":"璦","璎":"瓔","瓒":"瓚","瓮":"甕","瓯":"甌","画":"畫","畅":"暢","畴":"疇","疗":"療","疖":"癤","疠":"癘","疡":"瘍","疬":"癧","疮":"瘡","疯":"瘋","疱":"皰","疴":"痾","痉":"痙","痖":"瘂","痨":"癆","痫":"癇","瘅":"癉","瘆":"瘮","瘗":"瘞","瘘":"瘻","瘪":"癟","瘫":"癱","癫":"癲","皑":"皚","皱":"皺","盏":"盞","监":"監","盗":"盜","眍":"瞘","眦":"眥","眬":"矓","着":"著","睁":"睜","睐":"睞","睑":"瞼","瞆":"瞶","瞩":"矚","矫":"矯","矶":"磯","砀":"碭","码":"碼","砖":"磚","砗":"硨","砚":"硯","砜":"碸","砺":"礪","砻":"礱","砾":"礫","硁":"硜","硕":"碩","硖":"峽","硗":"磽","硙":"磑","硚":"礄","硌":"硌","铸":"鑄","碛":"磧","碜":"磣","礼":"禮","祎":"禕","祯":"禎","祷":"禱","祸":"禍","禀":"稟","秃":"禿","秾":"穠","稆":"穭","税":"稅","稣":"穌","穑":"穡","窃":"竊","窎":"窵","窑":"窯","窝":"窩","窥":"窺","窭":"窶","竖":"竪","笃":"篤","笋":"筍","笔":"筆","笕":"筧","笺":"箋","笼":"籠","笾":"籩","筚":"篳","筛":"篩","筜":"簹","筝":"箏","简":"簡","箓":"籙","箦":"簀","箧":"篋","箨":"籜","箪":"簞","箫":"簫","篑":"簣","篓":"簍","簖":"籪","籯":"籯","籼":"秈","粝":"糲","粤":"粵","糁":"糝","糇":"餱","絷":"縶","纟":"糹","纠":"糾","红":"紅","纣":"紂","纥":"紇","约":"約","级":"級","纨":"紈","纩":"纊","纫":"紉","纬":"緯","纭":"紜","纯":"純","纰":"紕","纱":"紗","纲":"綱","纳":"納","纴":"紝","纵":"縱","纶":"綸","纷":"紛","纸":"紙","纹":"紋","纺":"紡","纽":"紐","纾":"紓","线":"線","绀":"紺","绁":"紲","绂":"紱","绅":"紳","细":"細","织":"織","终":"終","绉":"縐","绊":"絆","绋":"紼","绌":"絀","绍":"紹","绎":"繹","经":"經","绑":"綁","绒":"絨","绔":"絝","绕":"繞","绖":"絰","绗":"絎","绘":"繪","给":"給","绚":"絢","绛":"絳","络":"絡","绝":"絕","绞":"絞","统":"統","绠":"綆","绡":"綃","绢":"絹","绣":"繡","绤":"綌","绥":"綏","绦":"絛","继":"繼","绨":"綈","绩":"績","绪":"緒","绫":"綾","续":"續","绮":"綺","绯":"緋","绰":"綽","绱":"緔","绲":"緄","绳":"繩","维":"維","绵":"綿","绶":"綬","绷":"繃","绸":"綢","绹":"綯","绺":"綹","绻":"綣","综":"綜","绽":"綻","绾":"綰","绿":"綠","缀":"綴","缁":"緇","缂":"緙","缃":"緗","缇":"緹","缈":"緲","缉":"緝","缊":"縕","缋":"繢","缌":"緦","缍":"綞","缎":"緞","缏":"緶","缐":"線","缑":"緱","缒":"縋","缓":"緩","缔":"締","缕":"縷","编":"編","缗":"緡","缘":"緣","缙":"縉","缚":"縛","缛":"縟","缜":"縝","缝":"縫","缟":"縞","缡":"縭","缢":"縊","缣":"縑","缤":"繽","缥":"縹","缦":"縵","缧":"縲","缨":"纓","缩":"縮","缪":"繆","缫":"繅","缬":"纈","缭":"繚","缮":"繕","缯":"繒","缰":"韁","缱":"繾","缲":"繰","缳":"繯","缴":"繳","罂":"罌","骂":"罵","骘":"騭","骇":"駭","骈":"駢","骁":"驍","骅":"驊","骆":"駱","骊":"驪","骋":"騁","验":"驗","骍":"騂","骎":"駸","骏":"駿","骐":"騏","骑":"騎","骒":"騍","骓":"騅","骔":"騌","骕":"驌","骖":"驂","骗":"騙","骙":"騤","骚":"騷","骛":"騖","骜":"驁","骝":"騮","骞":"騫","骟":"騸","骠":"驃","骡":"騾","骢":"驄","骣":"驏","骤":"驟","骥":"驥","骦":"驦","骧":"驤","髅":"髏","髋":"髖","髌":"髕","鬓":"鬢","魇":"魘","鱼":"魚","鱽":"魛","鱾":"魢","鱿":"魷","鲀":"魨","鲁":"魯","鲂":"魴","鲃":"鮁","鲄":"魺","鲅":"鮁","鲆":"鮃","鲇":"鮎","鲈":"鱸","鲉":"鮋","鲊":"鮓","鲋":"鮒","鲌":"鮊","鲍":"鮑","鲎":"鱟","鲏":"鮍","鲐":"鮐","鲑":"鮭","鲒":"鮚","鲓":"鮳","鲔":"鮪","鲕":"鮞","鲖":"鮦","鲗":"鰂","鲘":"鮜","鲙":"鱠","鲚":"鱭","鲛":"鮫","鲜":"鮮","鲝":"鮺","鲞":"鯗","鲟":"鱘","鲠":"鯁","鲡":"鱺","鲢":"鰱","鲣":"鰹","鲤":"鯉","鲥":"鰣","鲦":"鰷","鲧":"鯀","鲨":"鯊","鲩":"鯇","鲪":"鰾","鲫":"鯽","鲬":"鯒","鲭":"鯖","鲮":"鯪","鲯":"鯕","鲰":"鯫","鲱":"鯡","鲲":"鯤","鲳":"鯧","鲴":"鯝","鲵":"鯢","鲶":"鯰","鲷":"鯛","鲸":"鯨","鲺":"鯴","鲻":"鯔","鲼":"鱝","鲽":"鰈","鲾":"鰏","鲿":"鱨","鳀":"鯷","鳁":"鰮","鳂":"鰃","鳃":"鰓","鳄":"鱷","鳅":"鰍","鳆":"鰒","鳇":"鰉","鳈":"鰁","鳉":"鱂","鳊":"鯿","鳋":"鰠","鳌":"鰲","鳍":"鰭","鳎":"鰨","鳏":"鰥","鳐":"鰩","鳑":"鰟","鳒":"鶼","鳓":"鰳","鳔":"鰾","鳕":"鱈","鳖":"鱉","鳗":"鰻","鳘":"鰵","鳙":"鱅","鳚":"䲁","鳛":"鰼","鳜":"鱖","鳝":"鱔","鳞":"鱗","鳟":"鱒","鳠":"鱯","鳡":"鱤","鳢":"鱧","鳣":"鱣","鳤":"䲘","鸠":"鳩","鸡":"雞","鸢":"鳶","鸣":"鳴","鸤":"鳲","鸥":"鷗","鸦":"鴉","鸧":"鶬","鸨":"鴇","鸩":"鴆","鸪":"鴣","鸫":"鶇","鸬":"鸕","鸭":"鴨","鸮":"鴞","鸯":"鴦","鸰":"鴒","鸱":"鴟","鸲":"鴝","鸳":"鴛","鸴":"鷽","鸵":"鴕","鸶":"鷥","鸷":"鷙","鸸":"鴯","鸹":"鴰","鸺":"鵂","鸻":"鴴","鸼":"鵃","鸽":"鴿","鸾":"鸞","鸿":"鴻","鹀":"鵐","鹁":"鵓","鹂":"鸝","鹃":"鵑","鹄":"鵠","鹆":"鵒","鹇":"鷳","鹈":"鵜","鹉":"鵡","鹊":"鵲","鹋":"鶓","鹌":"鵪","鹍":"鵾","鹎":"鵯","鹏":"鵬","鹐":"鵮","鹑":"鶉","鹒":"鶊","鹓":"鵷","鹔":"鷫","鹕":"鶘","鹖":"鶡","鹗":"鶚","鹘":"鶻","鹙":"鶖","鹚":"鶿","鹛":"鶥","鹜":"鶩","鹝":"鷊","鹞":"鷂","鹠":"鶹","鹡":"鶺","鹢":"鷁","鹣":"鶼","鹤":"鶴","鹥":"鷖","鹦":"鸚","鹧":"鷓","鹨":"鷚","鹩":"鷯","鹪":"鷦","鹫":"鷲","鹬":"鷸","鹭":"鷺","鹮":"䴉","鹯":"鸇","鹰":"鷹","鹱":"鸌","鹲":"鸏","鹳":"鸛","鹴":"鸘","麸":"麩","黄":"黃","黌":"黌","黡":"黶","黩":"黷","鼋":"黿","鼍":"鼉","齑":"齏","齿":"齒","龀":"齔","龁":"齕","龂":"齗","龃":"齟","龅":"齙","龆":"齠","龇":"齜","龈":"齦","龉":"齬","龊":"齪","龋":"齲","龌":"齷","龙":"龍","龚":"龔","龛":"龕"
};

// 构建繁体->简体映射
const T2S_MAP: Record<string, string> = {};
Object.entries(S2T_MAP).forEach(([s, t]) => {
  T2S_MAP[t] = s;
});

// 常见多义词组（简->繁），用于词组优先匹配，避免一词多义错误
const S2T_PHRASES: Record<string, string> = {
  "头发": "頭髮", "出发": "出發", "发现": "發現", "发展": "發展",
  "里面": "裡面", "公里": "公里", "后面": "後面", "皇后": "皇后",
  "面食": "麵食", "面条": "麵條", "面粉": "麵粉", "面包": "麵包",
  "干净": "乾淨", "干杯": "乾杯", "干燥": "乾燥", "干部": "幹部",
  "干活": "幹活", "才干": "才幹", "树干": "樹幹",
  "日历": "日曆", "历史": "歷史", "经历": "經歷", "来历": "來歷",
  "台风": "颱風", "柜台": "櫃檯", "台灯": "檯燈",
  "松绑": "鬆綁", "轻松": "輕鬆", "放松": "放鬆",
  "谷物": "穀物", "稻谷": "稻穀", "山谷": "山谷",
  "目录": "目錄", "记录": "記錄", "登录": "登錄",
  "犹豫": "猶豫", "犹如": "猶如",
};

function convertText(text: string, map: Record<string, string>, phrases: Record<string, string>): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    // 先尝试匹配最长的词组（最多4字）
    let matched = false;
    for (let len = Math.min(4, text.length - i); len >= 2; len--) {
      const phrase = text.substring(i, i + len);
      if (phrases[phrase]) {
        result += phrases[phrase];
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      result += map[text[i]] || text[i];
      i++;
    }
  }
  return result;
}

export function ChineseConverterTool() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"s2t" | "t2s">("s2t");
  const { toast } = useToast();

  const output = useMemo(() => {
    const map = mode === "s2t" ? S2T_MAP : T2S_MAP;
    const phrases = mode === "s2t" ? S2T_PHRASES : {};
    return convertText(input, map, phrases);
  }, [input, mode]);

  const copyResult = () => {
    navigator.clipboard.writeText(output);
    toast({ title: "已复制到剪贴板" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label>转换方向</Label>
        <Select value={mode} onChange={(e) => setMode(e.target.value as "s2t" | "t2s")}>
          <option value="s2t">简体 → 繁体</option>
          <option value="t2s">繁体 → 简体</option>
        </Select>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label>输入文本</Label>
          {input && (
            <button
              type="button"
              onClick={() => setInput("")}
              className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
            >
              清空
            </button>
          )}
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="请输入需要转换的文本..."
          rows={10}
          className="min-h-[220px] text-sm leading-relaxed resize-y"
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>转换结果</Label>
          <Button onClick={copyResult} size="sm" variant="outline">
            <Copy size={12} className="mr-1" /> 复制
          </Button>
        </div>
        <div
          className="min-h-[220px] rounded-xl border p-4 text-sm whitespace-pre-wrap leading-relaxed overflow-auto"
          style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))", color: "hsl(var(--foreground))" }}
        >
          {output || "转换结果将显示在这里..."}
        </div>
      </div>
    </div>
  );
}

// ==================== 网速测试 ====================
// 使用 Cloudflare Speed Test 边缘节点，大文件+长时间+实时采样，结果更准确
export function SpeedTestTool() {
  const [testing, setTesting] = useState(false);
  const [phase, setPhase] = useState("");
  const [downloadSpeed, setDownloadSpeed] = useState<number | null>(null);
  const [uploadSpeed, setUploadSpeed] = useState<number | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [jitter, setJitter] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  const startTest = async () => {
    setTesting(true);
    setDownloadSpeed(null);
    setUploadSpeed(null);
    setCurrentSpeed(null);
    setLatency(null);
    setJitter(null);
    setProgress(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // ===== 1. 测试延迟和抖动（10次 ping 取平均）=====
      setPhase("正在测试延迟...");
      const latencies: number[] = [];
      const pingUrl = "https://speed.cloudflare.com/__down?bytes=1000";
      
      for (let i = 0; i < 10; i++) {
        if (controller.signal.aborted) break;
        const start = performance.now();
        try {
          await fetch(`${pingUrl}&_t=${Date.now()}-${i}`, { 
            cache: "no-store", 
            signal: controller.signal 
          });
          const lat = performance.now() - start;
          if (lat > 0 && lat < 5000) latencies.push(lat);
        } catch {}
        setProgress(5 + i * 2);
      }
      
      if (latencies.length > 1) {
        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        setLatency(Math.round(avg));
        const variance = latencies.reduce((s, l) => s + Math.pow(l - avg, 2), 0) / latencies.length;
        setJitter(Math.round(Math.sqrt(variance)));
      }

      // ===== 2. 测试下载速度（25MB文件+持续10秒+实时采样）=====
      setPhase("正在测试下载速度...");
      const TEST_DURATION = 10000;
      const startTime = performance.now();
      let totalBytes = 0;
      let lastSampleTime = startTime;
      let lastSampleBytes = 0;
      const speedSamples: number[] = [];

      const testFileUrl = "https://speed.cloudflare.com/__down?bytes=25000000";
      
      try {
        const response = await fetch(`${testFileUrl}&_t=${Date.now()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        
        if (!response.body) throw new Error("No response body");
        
        const reader = response.body.getReader();
        
        while (true) {
          if (controller.signal.aborted) break;
          
          const elapsed = performance.now() - startTime;
          if (elapsed >= TEST_DURATION) {
            controller.abort();
            break;
          }
          
          const { done, value } = await reader.read();
          if (done) break;
          
          totalBytes += value.length;
          
          // 每 500ms 采样一次当前速度
          const now = performance.now();
          if (now - lastSampleTime >= 500) {
            const sampleElapsed = (now - lastSampleTime) / 1000;
            const sampleBytes = totalBytes - lastSampleBytes;
            const sampleSpeed = (sampleBytes * 8) / sampleElapsed / 1024 / 1024;
            
            if (sampleSpeed > 0 && sampleSpeed < 10000) {
              speedSamples.push(sampleSpeed);
              setCurrentSpeed(Math.round(sampleSpeed * 100) / 100);
            }
            
            lastSampleTime = now;
            lastSampleBytes = totalBytes;
          }
          
          const testProgress = Math.min(95, 30 + (elapsed / TEST_DURATION) * 65);
          setProgress(Math.round(testProgress));
        }
        
        reader.cancel().catch(() => {});
      } catch (e) {
        if (e instanceof Error && e.name !== "AbortError") {
          console.warn("下载测试出错:", e);
        }
      }

      // 计算最终速度（取90分位数，更稳定准确）
      if (speedSamples.length > 0) {
        speedSamples.sort((a, b) => a - b);
        const p90Index = Math.floor(speedSamples.length * 0.9);
        const finalSpeed = speedSamples[Math.min(p90Index, speedSamples.length - 1)];
        setDownloadSpeed(Math.round(finalSpeed * 100) / 100);
      } else if (totalBytes > 0) {
        const totalTime = (performance.now() - startTime) / 1000;
        const avgSpeed = (totalBytes * 8) / totalTime / 1024 / 1024;
        setDownloadSpeed(Math.round(avgSpeed * 100) / 100);
      }

      // ===== 3. 测试上传速度（POST数据到Cloudflare，持续8秒）=====
      // 使用独立的 AbortController，避免被下载阶段的 abort 影响
      const uploadController = new AbortController();
      setPhase("正在测试上传速度...");
      const UPLOAD_DURATION = 8000;
      const uploadStartTime = performance.now();
      let uploadTotalBytes = 0;
      const uploadChunkSize = 1024 * 1024; // 1MB chunks
      const uploadSpeedSamples: number[] = [];
      let lastUploadSampleTime = uploadStartTime;
      let lastUploadSampleBytes = 0;

      try {
        while (performance.now() - uploadStartTime < UPLOAD_DURATION) {
          if (uploadController.signal.aborted) break;
          const chunk = new Uint8Array(uploadChunkSize);
          // 浏览器 crypto.getRandomValues 单次最多 65536 字节，分块填充
          for (let off = 0; off < chunk.length; off += 65536) {
            crypto.getRandomValues(chunk.subarray(off, Math.min(off + 65536, chunk.length)));
          }
          const uploadStart = performance.now();
          await fetch("https://speed.cloudflare.com/__up", {
            method: "POST",
            body: chunk,
            cache: "no-store",
            signal: uploadController.signal,
          });
          const uploadElapsed = (performance.now() - uploadStart) / 1000;
          uploadTotalBytes += uploadChunkSize;
          if (uploadElapsed > 0) {
            const instantSpeed = (uploadChunkSize * 8) / uploadElapsed / 1024 / 1024;
            if (instantSpeed > 0 && instantSpeed < 10000) {
              uploadSpeedSamples.push(instantSpeed);
            }
          }
          const now = performance.now();
          if (now - lastUploadSampleTime >= 1000) {
            const sampleElapsed = (now - lastUploadSampleTime) / 1000;
            const sampleBytes = uploadTotalBytes - lastUploadSampleBytes;
            const sampleSpeed = (sampleBytes * 8) / sampleElapsed / 1024 / 1024;
            if (sampleSpeed > 0 && sampleSpeed < 10000) {
              setCurrentSpeed(Math.round(sampleSpeed * 100) / 100);
            }
            lastUploadSampleTime = now;
            lastUploadSampleBytes = uploadTotalBytes;
          }
          const uploadProgress = Math.min(98, 80 + ((performance.now() - uploadStartTime) / UPLOAD_DURATION) * 18);
          setProgress(Math.round(uploadProgress));
        }
      } catch (e) {
        if (e instanceof Error && e.name !== "AbortError") {
          console.warn("上传测试出错:", e);
        }
      }

      // 计算上传最终速度
      if (uploadSpeedSamples.length > 0) {
        uploadSpeedSamples.sort((a, b) => a - b);
        const p90Idx = Math.floor(uploadSpeedSamples.length * 0.9);
        setUploadSpeed(Math.round(uploadSpeedSamples[Math.min(p90Idx, uploadSpeedSamples.length - 1)] * 100) / 100);
      } else if (uploadTotalBytes > 0) {
        const totalTime = (performance.now() - uploadStartTime) / 1000;
        setUploadSpeed(Math.round((uploadTotalBytes * 8) / totalTime / 1024 / 1024 * 100) / 100);
      }

      setPhase("测试完成");
      setProgress(100);
      setCurrentSpeed(null);
      toast({ title: "网速测试完成" });
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") {
        toast({ title: "测试失败", description: e.message, variant: "error" });
      }
    } finally {
      setTesting(false);
      abortRef.current = null;
    }
  };

  const stopTest = () => {
    abortRef.current?.abort();
    setTesting(false);
    setPhase("已停止");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button onClick={startTest} disabled={testing} size="lg">
          {testing ? "测试中..." : "开始测试"}
        </Button>
        {testing && (
          <Button onClick={stopTest} variant="outline" size="lg">
            停止
          </Button>
        )}
        {phase && <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>{phase}</span>}
      </div>

      {testing && (
        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: "hsl(var(--border))" }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, backgroundColor: "hsl(var(--primary))" }}
            />
          </div>
          {currentSpeed !== null && (
            <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              当前速度: <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>{currentSpeed} Mbps</span>
            </p>
          )}
        </div>
      )}

      {(downloadSpeed !== null || uploadSpeed !== null || latency !== null) && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border p-4" style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}>
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>下载速度</p>
            <p className="mt-1 text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
              {downloadSpeed !== null ? `${downloadSpeed} Mbps` : "--"}
            </p>
          </div>
          <div className="rounded-xl border p-4" style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}>
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>上传速度</p>
            <p className="mt-1 text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
              {uploadSpeed !== null ? `${uploadSpeed} Mbps` : "--"}
            </p>
          </div>
          <div className="rounded-xl border p-4" style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}>
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>延迟</p>
            <p className="mt-1 text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
              {latency !== null ? `${latency} ms` : "--"}
            </p>
          </div>
          <div className="rounded-xl border p-4" style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}>
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>抖动</p>
            <p className="mt-1 text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
              {jitter !== null ? `${jitter} ms` : "--"}
            </p>
          </div>
        </div>
      )}

      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
        使用 Cloudflare 全球边缘节点测试，下载持续10秒、上传持续8秒实时采样，结果取90分位数，更接近实际使用体验。
      </p>
    </div>
  );
}

// ==================== 配色灵感工具 ====================

const KEYWORD_PALETTES: Record<string, string[][]> = {
  "雨夜": [["#1a1a2e", "#16213e", "#0f3460", "#533483", "#e94560"], ["#2c3e50", "#34495e", "#74b9ff", "#a29bfe", "#dfe6e9"]],
  "荒原": [["#d4a574", "#c4956a", "#8b6f47", "#5d4e37", "#3d2f1f"], ["#e8c39e", "#c9a876", "#a67c52", "#6b4423", "#2d1b0e"]],
  "古堡": [["#4a4a4a", "#6b5b4f", "#8b7d6b", "#a89878", "#d4c5a9"], ["#2f2f2f", "#5c4033", "#8b6914", "#b8860b", "#daa520"]],
  "海洋": [["#006994", "#40e0d0", "#7fffd4", "#b0e0e6", "#e0ffff"], ["#001f3f", "#0074d9", "#39cccc", "#7fdbff", "#f0f8ff"]],
  "森林": [["#2d5016", "#4a7c23", "#6b9b37", "#95c11f", "#d4e157"], ["#1b4332", "#2d6a4f", "#40916c", "#52b788", "#b7e4c7"]],
  "日落": [["#ff6b6b", "#ffa502", "#ffd166", "#ff9ff3", "#f368e0"], ["#ee5a24", "#f0932b", "#f9ca24", "#ff7979", "#eb4d4b"]],
  "星空": [["#0c0c1d", "#1a1a3e", "#2d2d6b", "#4a4a9e", "#7b7bd4"], ["#000033", "#1a1a66", "#333399", "#6666cc", "#9999ff"]],
  "樱花": [["#ffb7c5", "#ffc0cb", "#ffd1dc", "#ffe4e1", "#fff0f5"], ["#f8bbd0", "#f48fb1", "#f06292", "#ec407a", "#e91e63"]],
  "极光": [["#00ff87", "#60efff", "#0061ff", "#8338ec", "#fb5607"], ["#00f5d4", "#00bbf9", "#9b5de5", "#f15bb5", "#fee440"]],
  "沙漠": [["#edc9af", "#e6b89c", "#c68b59", "#9c6644", "#5c3a21"], ["#f4d58d", "#e8ac65", "#c77d3f", "#8b4513", "#3e2723"]],
};

export function ColorPaletteTool() {
  const [keyword, setKeyword] = useState("");
  const [palettes, setPalettes] = useState<string[][]>([]);
  const [imageColors, setImageColors] = useState<string[]>([]);
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const generateByKeyword = () => {
    if (!keyword.trim()) {
      toast({ title: "请输入关键词" });
      return;
    }

    // 查找匹配的预设配色
    const matched = KEYWORD_PALETTES[keyword.trim()];
    if (matched) {
      setPalettes(matched);
    } else {
      // 没有匹配的关键词，提示并随机生成和谐配色
      toast({ title: `未找到"${keyword.trim()}"的预设配色，已为你随机生成和谐配色` });
      const randomPalette = generateHarmoniousPalette();
      setPalettes([randomPalette, generateHarmoniousPalette()]);
    }
    setImageColors([]);
  };

  // 生成和谐配色
  const generateHarmoniousPalette = (): string[] => {
    const baseHue = Math.floor(Math.random() * 360);
    const colors: string[] = [];
    // 类似色 + 互补色
    const offsets = [0, 30, 60, 180, 210];
    offsets.forEach((offset) => {
      const hue = (baseHue + offset) % 360;
      const sat = 50 + Math.random() * 30;
      const light = 35 + Math.random() * 30;
      colors.push(hslToHex(hue, sat, light));
    });
    return colors;
  };

  const hslToHex = (h: number, s: number, l: number): string => {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };

  // 从图片提取配色
  const extractFromImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const maxSize = 100;
        const scale = Math.min(maxSize / img.width, maxSize / img.height);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;
        const colorBuckets: Record<string, number> = {};

        // 量化颜色
        for (let i = 0; i < pixels.length; i += 4) {
          const r = Math.round(pixels[i] / 32) * 32;
          const g = Math.round(pixels[i + 1] / 32) * 32;
          const b = Math.round(pixels[i + 2] / 32) * 32;
          const key = `${r},${g},${b}`;
          colorBuckets[key] = (colorBuckets[key] || 0) + 1;
        }

        // 取出现频率最高的颜色
        const sorted = Object.entries(colorBuckets)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([key]) => {
            const [r, g, b] = key.split(",").map(Number);
            return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
          });

        setImageColors(sorted);
        setPalettes([]);
        toast({ title: `提取了 ${sorted.length} 个主色` });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // 导出色卡
  const exportPalette = (colors: string[]) => {
    const canvas = document.createElement("canvas");
    const blockWidth = 160;
    const blockHeight = 200;
    canvas.width = blockWidth * colors.length;
    canvas.height = blockHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    colors.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(i * blockWidth, 0, blockWidth, blockHeight - 40);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(i * blockWidth, blockHeight - 40, blockWidth, 40);
      ctx.fillStyle = "#333";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(color.toUpperCase(), i * blockWidth + blockWidth / 2, blockHeight - 15);
    });

    const link = document.createElement("a");
    link.download = "色卡.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast({ title: "色卡已导出" });
  };

  const copyColor = (color: string) => {
    navigator.clipboard.writeText(color);
    toast({ title: `已复制 ${color}` });
  };

  return (
    <div className="space-y-6">
      {/* 关键词生成 */}
      <div>
        <Label>关键词生成配色</Label>
        <div className="mt-2 flex gap-2">
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="输入关键词，如：雨夜、荒原、古堡、海洋、森林、日落、星空..."
            onKeyDown={(e) => e.key === "Enter" && generateByKeyword()}
          />
          <Button onClick={generateByKeyword}>生成配色</Button>
        </div>
      </div>

      {/* 图片提取 */}
      <div>
        <Label>从图片提取配色</Label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={extractFromImage}
          className="mt-2 block w-full text-sm"
          style={{ color: "hsl(var(--foreground))" }}
        />
      </div>

      {/* 配色展示 */}
      {palettes.length > 0 && (
        <div className="space-y-4">
          {palettes.map((palette, idx) => (
            <div key={idx}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>配色方案 {idx + 1}</span>
                <Button onClick={() => exportPalette(palette)} size="sm" variant="outline">
                  <Download size={12} className="mr-1" /> 导出色卡
                </Button>
              </div>
              <div className="flex gap-2 overflow-hidden rounded-xl">
                {palette.map((color, i) => (
                  <div
                    key={i}
                    className="flex-1 cursor-pointer transition-transform hover:scale-105"
                    style={{ backgroundColor: color, height: "100px" }}
                    onClick={() => copyColor(color)}
                    title="点击复制色值"
                  >
                    <div className="flex h-full items-end justify-center pb-2">
                      <span className="rounded bg-black/30 px-2 py-0.5 text-xs text-white">
                        {color.toUpperCase()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {imageColors.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>图片提取的主色</span>
            <Button onClick={() => exportPalette(imageColors)} size="sm" variant="outline">
              <Download size={12} className="mr-1" /> 导出色卡
            </Button>
          </div>
          <div className="flex gap-2 overflow-hidden rounded-xl">
            {imageColors.map((color, i) => (
              <div
                key={i}
                className="flex-1 cursor-pointer transition-transform hover:scale-105"
                style={{ backgroundColor: color, height: "100px" }}
                onClick={() => copyColor(color)}
                title="点击复制色值"
              >
                <div className="flex h-full items-end justify-center pb-2">
                  <span className="rounded bg-black/30 px-2 py-0.5 text-xs text-white">
                    {color.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
        点击色块可复制色值，支持导出色卡图片。内置关键词：雨夜、荒原、古堡、海洋、森林、日落、星空、樱花、极光、沙漠。
      </p>
    </div>
  );
}

// ==================== 观影读书记录器 ====================

interface MediaRecord {
  id: string;
  type: "book" | "movie" | "anime";
  title: string;
  rating: number;
  review: string;
  date: string;
  episodes?: string;
}

export function MediaTrackerTool() {
  const [records, setRecords] = useState<MediaRecord[]>(() => {
    try {
      const saved = localStorage.getItem("furinakit-media-tracker");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [filter, setFilter] = useState<"all" | "book" | "movie" | "anime">("all");
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<"book" | "movie" | "anime">("anime");
  const [formTitle, setFormTitle] = useState("");
  const [formRating, setFormRating] = useState(5);
  const [formReview, setFormReview] = useState("");
  const [formEpisodes, setFormEpisodes] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    localStorage.setItem("furinakit-media-tracker", JSON.stringify(records));
  }, [records]);

  const addRecord = () => {
    if (!formTitle.trim()) {
      toast({ title: "请输入标题" });
      return;
    }
    const newRecord: MediaRecord = {
      id: Date.now().toString(),
      type: formType,
      title: formTitle.trim(),
      rating: formRating,
      review: formReview.trim(),
      date: new Date().toISOString().split("T")[0],
      episodes: formType === "anime" && formEpisodes.trim() ? formEpisodes.trim() : undefined,
    };
    setRecords([newRecord, ...records]);
    setFormTitle("");
    setFormReview("");
    setFormEpisodes("");
    setFormRating(5);
    setShowForm(false);
    toast({ title: "记录已添加" });
  };

  const deleteRecord = (id: string) => {
    setRecords(records.filter((r) => r.id !== id));
    toast({ title: "记录已删除" });
  };

  const filteredRecords = records.filter((r) => filter === "all" || r.type === filter);

  const stats = useMemo(() => {
    const books = records.filter((r) => r.type === "book");
    const movies = records.filter((r) => r.type === "movie");
    const animes = records.filter((r) => r.type === "anime");
    const avgRating = records.length > 0
      ? (records.reduce((sum, r) => sum + r.rating, 0) / records.length).toFixed(1)
      : "--";
    return { bookCount: books.length, movieCount: movies.length, animeCount: animes.length, avgRating };
  }, [records]);

  // 生成年度回顾
  const generateYearReview = () => {
    if (records.length === 0) {
      toast({ title: "还没有记录" });
      return;
    }
    const year = new Date().getFullYear();
    const yearRecords = records.filter((r) => r.date.startsWith(String(year)));
    const books = yearRecords.filter((r) => r.type === "book");
    const movies = yearRecords.filter((r) => r.type === "movie");
    const animes = yearRecords.filter((r) => r.type === "anime");
    const avgRating = yearRecords.length > 0
      ? (yearRecords.reduce((sum, r) => sum + r.rating, 0) / yearRecords.length).toFixed(1)
      : "--";

    // 生成回顾图片
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 540;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 背景
    const gradient = ctx.createLinearGradient(0, 0, 0, 540);
    gradient.addColorStop(0, "#0d1526");
    gradient.addColorStop(1, "#1a1a3e");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 800, 540);

    // 标题
    ctx.fillStyle = "#ffd166";
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${year} 年度回顾`, 400, 75);

    // 统计数据
    ctx.fillStyle = "#f4f7ff";
    ctx.font = "20px sans-serif";
    ctx.fillText(`📚 书籍 ${books.length} 本   🎬 电影 ${movies.length} 部   📺 番剧 ${animes.length} 部`, 400, 160);
    ctx.fillText(`⭐ 综合平均评分 ${avgRating}`, 400, 210);

    // Top 5
    const top5 = [...yearRecords].sort((a, b) => b.rating - a.rating).slice(0, 5);
    ctx.font = "18px sans-serif";
    ctx.fillStyle = "#6ad4ff";
    ctx.fillText("年度精选推荐", 400, 280);
    ctx.fillStyle = "#f4f7ff";
    ctx.font = "16px sans-serif";
    top5.forEach((r, i) => {
      const icon = r.type === "book" ? "📖" : r.type === "anime" ? "📺" : "🎞️";
      ctx.fillText(`${i + 1}. ${icon} ${r.title} (${r.rating}星)`, 400, 320 + i * 26);
    });

    const link = document.createElement("a");
    link.download = `${year}年度影视书影回顾.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast({ title: "年度回顾图片已生成" });
  };

  return (
    <div className="space-y-4">
      {/* 统计栏 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-lg border p-3 text-center" style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}>
          <div className="text-xl font-bold" style={{ color: "hsl(var(--success))" }}>{stats.bookCount}</div>
          <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>书籍</div>
        </div>
        <div className="rounded-lg border p-3 text-center" style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}>
          <div className="text-xl font-bold" style={{ color: "hsl(var(--primary))" }}>{stats.movieCount}</div>
          <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>电影</div>
        </div>
        <div className="rounded-lg border p-3 text-center" style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}>
          <div className="text-xl font-bold" style={{ color: "#ec4899" }}>{stats.animeCount}</div>
          <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>番剧</div>
        </div>
        <div className="rounded-lg border p-3 text-center" style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}>
          <div className="text-xl font-bold" style={{ color: "#f59e0b" }}>{stats.avgRating}</div>
          <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>平均评分</div>
        </div>
        <div className="col-span-2 sm:col-span-1 flex flex-row sm:flex-col gap-2 justify-center">
          <Button onClick={() => setShowForm(!showForm)} size="sm" className="w-full">
            <Plus size={14} className="mr-1" /> 添加
          </Button>
          <Button onClick={generateYearReview} size="sm" variant="outline" className="w-full">
            年度回顾
          </Button>
        </div>
      </div>

      {/* 添加表单 */}
      {showForm && (
        <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label>类型</Label>
              <Select value={formType} onChange={(e) => setFormType(e.target.value as "book" | "movie" | "anime")}>
                <option value="anime">番剧</option>
                <option value="movie">电影</option>
                <option value="book">书籍</option>
              </Select>
            </div>
            <div>
              <Label>评分</Label>
              <Select value={formRating} onChange={(e) => setFormRating(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{"★".repeat(n)}{"☆".repeat(5 - n)}</option>
                ))}
              </Select>
            </div>
            {formType === "anime" && (
              <div>
                <Label>集数/观看进度 (选填)</Label>
                <Input value={formEpisodes} onChange={(e) => setFormEpisodes(e.target.value)} placeholder="如：12集全、第5集" />
              </div>
            )}
          </div>
          <div>
            <Label>标题</Label>
            <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="番剧、电影或书籍名称" />
          </div>
          <div>
            <Label>短评 / 心得</Label>
            <Textarea value={formReview} onChange={(e) => setFormReview(e.target.value)} placeholder="写点感想评价..." rows={3} />
          </div>
          <div className="flex gap-2">
            <Button onClick={addRecord}>保存</Button>
            <Button onClick={() => setShowForm(false)} variant="outline">取消</Button>
          </div>
        </div>
      )}

      {/* 筛选 */}
      <div className="flex gap-2">
        {[
          { value: "all", label: "全部" },
          { value: "anime", label: "番剧" },
          { value: "movie", label: "电影" },
          { value: "book", label: "书籍" },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value as typeof filter)}
            className="rounded-lg px-4 py-1.5 text-sm transition-all"
            style={{
              backgroundColor: filter === f.value ? "hsl(var(--primary))" : "transparent",
              color: filter === f.value ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
              border: `1px solid ${filter === f.value ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 记录列表 */}
      <div className="space-y-2">
        {filteredRecords.length === 0 ? (
          <div className="py-12 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            还没有记录，点击「添加」开始记录吧
          </div>
        ) : (
          filteredRecords.map((record) => (
            <div
              key={record.id}
              className="flex items-start gap-3 rounded-lg border p-3"
              style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}
            >
              <div
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                style={{
                  backgroundColor:
                    record.type === "book"
                      ? "hsl(var(--success)/0.13)"
                      : record.type === "anime"
                      ? "rgba(236, 72, 153, 0.13)"
                      : "hsl(var(--primary)/0.13)",
                }}
              >
                {record.type === "book" ? (
                  <BookOpen size={18} style={{ color: "hsl(var(--success))" }} />
                ) : record.type === "anime" ? (
                  <Tv size={18} style={{ color: "#ec4899" }} />
                ) : (
                  <Film size={18} style={{ color: "hsl(var(--primary))" }} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium" style={{ color: "hsl(var(--foreground))" }}>{record.title}</span>
                  {record.episodes && (
                    <span className="rounded bg-pink-500/10 px-1.5 py-0.5 text-[11px] font-medium text-pink-500">
                      {record.episodes}
                    </span>
                  )}
                  <span className="text-xs" style={{ color: "#f59e0b" }}>
                    {"★".repeat(record.rating)}{"☆".repeat(5 - record.rating)}
                  </span>
                </div>
                {record.review && (
                  <p className="mt-1 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>{record.review}</p>
                )}
                <span className="mt-1 block text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{record.date}</span>
              </div>
              <button
                onClick={() => deleteRecord(record.id)}
                className="flex-shrink-0 rounded-lg p-1.5 transition-colors hover:bg-red-500/10"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
