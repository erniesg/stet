/**
 * Singapore Chinese terminology — maps non-standard forms to official SG equivalents.
 * Source: Singaporean Mandarin Database (languagecouncils.sg)
 */
export const ZH_SG_TERMINOLOGY: Record<string, string> = {
  // === Transport ===

  // Taxi → 德士 (SG standard, transliteration of "taxi")
  // Non-standard: Mainland 出租车/出租汽车/的士, Taiwan 计程车
  '出租车': '德士',
  '出租汽车': '德士',
  '的士': '德士',
  '计程车': '德士',

  // Bus → 巴士 (SG standard)
  // Non-standard: Mainland 公共汽车/公交车/公车
  '公共汽车': '巴士',
  '公交车': '巴士',
  '公车': '巴士',

  // Bus lane → 巴士道 / 巴士专用道
  // Non-standard: Mainland 公交车道/公车专用道
  '公交车道': '巴士道',
  '公车专用道': '巴士专用道',
  '公交专用道': '巴士专用道',

  // Articulated bus → 双节巴士
  // Non-standard: Mainland 铰接式公共汽车/通道车
  '铰接巴士': '双节巴士',
  '铰接式公共汽车': '双节巴士',
  '通道车': '双节巴士',

  // LRT → 轻轨列车
  // Non-standard: Malaysia 轻快铁, HK 单轨铁路
  '轻快铁': '轻轨列车',

  // ERP → 公路电子收费
  // Non-standard: Mainland 电子不停车收费系统, HK 电子道路收费
  '电子不停车收费系统': '公路电子收费',
  '电子道路收费': '公路电子收费',

  // Ez-link card → 易通卡
  // Non-standard: MY 一触即通卡, TW 悠游卡, HK 八达通
  '交通卡': '易通卡',

  // Bus interchange → 巴士转换站
  '公交枢纽': '巴士转换站',
  '公交总站': '巴士转换站',

  // === Housing ===

  // HDB flat → 组屋
  // Non-standard: 公共住房/政府公寓
  '公共住房': '组屋',

  // HDB → 建屋发展局 / 建屋局
  // Non-standard: 住房发展局/住房局
  '住房发展局': '建屋发展局',
  '住房局': '建屋局',

  // === Government / Institutions ===

  // Town Council → 市镇理事会
  '市镇议会': '市镇理事会',

  // Residents' Committee → 居民委员会 / 居委会
  // Note: 居民委 is incomplete abbreviation
  '居民委': '居民委员会',

  // CDC → 社区发展理事会 / 社理会
  '社区理事会': '社区发展理事会',

  // LTA → 陆路交通管理局 / 陆交局
  '陆路交通局': '陆路交通管理局',

  // === Food & Dining ===

  // Hawker centre → 熟食中心 / 小贩中心
  // Non-standard: 美食广场 (HK), 大排档
  '美食广场': '熟食中心',
  '大排档': '熟食中心',

  // Market → 巴刹 (SG standard, from Malay "pasar")
  // Non-standard: Mainland 菜市场/市场/农贸市场
  '菜市场': '巴刹',
  '农贸市场': '巴刹',

  // Kopitiam / coffee shop → 㗝呸店
  // Non-standard: Mainland 咖啡店 (too generic)
  '咖啡店': '㗝呸店',

  // Food court → 食阁 (SG standard)
  // Non-standard: Mainland 美食城/大食代
  '美食城': '食阁',

  // Instant noodles → 快熟面 (SG standard)
  // Non-standard: Mainland 方便面/速食面, TW 泡面
  '方便面': '快熟面',
  '速食面': '快熟面',
  '泡面': '快熟面',

  // Pineapple → 黄梨 (SG standard)
  // Non-standard: Mainland 菠萝, TW 凤梨
  '菠萝': '黄梨',
  '凤梨': '黄梨',

  // Cabbage → 高丽菜 (SG standard)
  // Non-standard: Mainland 卷心菜/包菜/大白菜
  '卷心菜': '高丽菜',
  '包菜': '高丽菜',

  // Chocolate → 朱古力 (SG standard, from Cantonese)
  // Non-standard: Mainland 巧克力
  '巧克力': '朱古力',

  // Straw → 水草 (SG standard)
  // Non-standard: Mainland 吸管
  '吸管': '水草',

  // Plastic → 塑胶 (SG standard)
  // Non-standard: Mainland 塑料
  '塑料': '塑胶',

  // Plastic bag → 塑胶袋 (SG standard)
  // Non-standard: Mainland 塑料袋
  '塑料袋': '塑胶袋',

  // === Transport (additional) ===

  // Lorry → 罗厘 (SG standard, transliteration)
  // Non-standard: Mainland 卡车/货车
  '卡车': '罗厘',
  '货车': '罗厘',

  // Motorcycle → 摩托车 (both SG and Mainland use this)
  // Non-standard: Mainland 摩托/机车 (TW)
  '机车': '摩托车',

  // Passenger → 搭客 (SG standard)
  // Non-standard: Mainland 乘客/旅客
  '乘客': '搭客',

  // To ride → 乘搭 (SG standard)
  // Non-standard: Mainland 搭乘/乘坐
  '搭乘': '乘搭',
  '乘坐': '乘搭',

  // Expressway → 快速公路 (SG standard)
  // Non-standard: Mainland 高速公路
  '高速公路': '快速公路',

  // Flyover/viaduct → 汽车天桥 (SG standard)
  // Non-standard: Mainland 立交桥/高架桥
  '立交桥': '汽车天桥',
  '高架桥': '汽车天桥',

  // Road hump → 路隆 (SG standard)
  // Non-standard: Mainland 减速带/减速丘
  '减速带': '路隆',
  '减速丘': '路隆',

  // U-turn → 调头 (SG standard)
  // Non-standard: Mainland 掉头
  '掉头': '调头',

  // === Housing (additional) ===

  // Terrace house → 排屋 (SG standard)
  // Non-standard: Mainland 联排别墅/排别墅
  '联排别墅': '排屋',

  // Semi-detached house → 半独立式洋房 (SG standard)
  // Non-standard: Mainland 半独立住宅
  '半独立住宅': '半独立式洋房',

  // Detached house → 独立式洋房 (SG standard)
  // Non-standard: Mainland 独栋别墅
  '独栋别墅': '独立式洋房',

  // Condominium → 共管式公寓 (SG standard)
  // Non-standard: HK/MY 公寓
  // Note: 公寓 is too generic to map

  // Corridor → 廊道 (SG standard for HDB corridor)
  // Non-standard: Mainland 走廊/过道
  '过道': '廊道',

  // Lease → 屋契 (SG standard)
  // Non-standard: Mainland 房契/产权证
  '房契': '屋契',

  // === Government & Institutions (additional) ===

  // Polytechnic → 理工学院 (SG standard)
  // Non-standard: Mainland 高等专科学校/大专
  '高等专科学校': '理工学院',

  // Polyclinic → 综合诊疗所 (SG standard)
  // Non-standard: Mainland 社区医院/社区卫生中心
  '社区医院': '综合诊疗所',
  '社区卫生中心': '综合诊疗所',

  // Permanent Resident → 永久居民 (SG standard)
  // Non-standard: Mainland 永久居留者/永居
  '永久居留者': '永久居民',

  // Work permit → 工作准证 (SG standard)
  // Non-standard: Mainland 工作许可/工作许可证
  '工作许可证': '工作准证',
  '工作许可': '工作准证',

  // Migrant worker → 客工 (SG standard)
  // Non-standard: Mainland 外劳/外来务工人员/农民工
  '外劳': '客工',
  '外来务工人员': '客工',
  '农民工': '客工',

  // Public holiday → 公共假日 (SG standard)
  // Non-standard: Mainland 法定假日/公休日
  '法定假日': '公共假日',

  // Grassroots leaders → 基层领袖 (SG standard)
  // Non-standard: Mainland 基层干部
  '基层干部': '基层领袖',

  // === Daily Life ===

  // To take a shower → 冲凉 (SG standard)
  // Non-standard: Mainland 洗澡/淋浴
  '洗澡': '冲凉',
  '淋浴': '冲凉',

  // Percent → 巴仙 (SG standard, from Malay "peratus")
  // Non-standard: Mainland 百分比/百分之
  // Note: 巴仙 is used as a noun (e.g., "五个巴仙"), while 百分比 is structural;
  //       only flag 百分比 when used as a unit.
  '百分比': '巴仙',

  // Air-conditioner → 冷气 (SG standard)
  // Non-standard: Mainland 空调
  '空调': '冷气',

  // Coupon → 固本 (SG standard)
  // Non-standard: Mainland 优惠券
  '优惠券': '固本',

  // Senior citizen → 乐龄 (SG standard, lit. "happy age")
  // Non-standard: Mainland 老年人/老人/老人家
  '老年人': '乐龄',

  // Tips → 贴士 (SG standard, from English "tips")
  // Non-standard: Mainland 小贴士/小窍门/提示
  // Note: only map the loanword form
  '小贴士': '贴士',

  // Internet → 网际网络 (SG standard)
  // Non-standard: Mainland 互联网/因特网
  '互联网': '网际网络',
  '因特网': '网际网络',

  // Hacker → 骇客 (SG standard)
  // Non-standard: Mainland 黑客
  '黑客': '骇客',

  // Spoon → 汤匙 (SG standard)
  // Non-standard: Mainland 调羹/勺子
  '调羹': '汤匙',
  '勺子': '汤匙',

  // Correction fluid → 涂改剂 (SG standard)
  // Non-standard: Mainland 涂改液/修正液
  '涂改液': '涂改剂',
  '修正液': '涂改剂',

  // Kindergarten → 幼稚园 (SG standard)
  // Non-standard: Mainland 幼儿园
  '幼儿园': '幼稚园',

  // Physically disabled → 残障 (SG standard)
  // Non-standard: Mainland 残疾
  '残疾': '残障',

  // Disc jockey → 唱片骑师 (SG standard)
  // Non-standard: Mainland DJ (English left as-is in most SG copy too)

  // Space shuttle → 太空梭 (SG standard)
  // Non-standard: Mainland 航天飞机, TW 太空梭 (same)
  '航天飞机': '太空梭',

  // Barbecue → 烧烤会 (SG standard for the event)
  // Non-standard: Mainland 烧烤派对
  // Note: 烧烤 alone is fine in both; only the event form differs

  // Brainstorm → 脑力激荡 (SG standard)
  // Non-standard: Mainland 头脑风暴/脑力激荡
  '头脑风暴': '脑力激荡',

  // Orchid → 胡姬 (SG standard, from Malay "orkid")
  // Non-standard: Mainland 兰花
  // Note: only in SG context; 兰花 is too generic for a global find-replace

  // Dialysis → 洗肾 (SG standard)
  // Non-standard: Mainland 透析/血液透析
  '透析': '洗肾',
  '血液透析': '洗肾',

  // Recycle → 再循环 (SG standard)
  // Non-standard: Mainland 回收/再利用
  // Note: 回收 is generic; map the full form only
  '回收利用': '再循环',

  // Forklift → 插车 (SG standard)
  // Non-standard: Mainland 叉车/铲车
  '叉车': '插车',
  '铲车': '插车',

  // Post-it notes → 便利贴 (both SG and Mainland)
  // (same term, no mapping needed)

  // === Finance & Business ===

  // GST → 消费税 (SG standard)
  // Non-standard: Mainland 增值税
  '增值税': '消费税',

  // GIRO → 财路 (SG standard)
  // Non-standard: Mainland 银行转账/自动转账
  '自动转账': '财路',

  // Reverse takeover → 买壳上市 (SG standard)
  // Non-standard: Mainland 借壳上市
  '借壳上市': '买壳上市',

  // Deposit → 按柜金 (SG standard)
  // Non-standard: Mainland 押金/保证金
  '押金': '按柜金',
  '保证金': '按柜金',

  // Pawnshop → 当店 (SG standard)
  // Non-standard: Mainland 当铺/典当行
  '当铺': '当店',
  '典当行': '当店',

  // === Media & Entertainment ===

  // TV channel → 波道 (SG standard, from English "board")
  // Non-standard: Mainland 频道
  '频道': '波道',

  // Talk show → 清谈节目 (SG standard)
  // Non-standard: Mainland 脱口秀/访谈节目
  '脱口秀': '清谈节目',
  '访谈节目': '清谈节目',

  // Comedian → 谐星 (SG standard)
  // Non-standard: Mainland 喜剧演员
  '喜剧演员': '谐星',

  // === Uniquely SG verbs & expressions ===

  // To reach (a place) → 抵步 (SG standard)
  // Non-standard: Mainland 抵达/到达
  '抵达': '抵步',

  // To reach (an objective) → 达致 (SG standard)
  // Non-standard: Mainland 达到/达成
  '达到': '达致',
  '达成': '达致',

  // Caning → 鞭刑 (SG standard, refers to judicial caning)
  // Non-standard: Mainland has no direct equivalent; 鞭刑 is the SG legal term

  // Donation of blood → 捐血 (SG standard)
  // Non-standard: Mainland 献血
  '献血': '捐血',

  // Drink-driving → 醉酒驾车 (SG standard)
  // Non-standard: Mainland 醉驾/酒驾/酒后驾车
  '醉驾': '醉酒驾车',
  '酒驾': '醉酒驾车',
  '酒后驾车': '醉酒驾车',

  // To postpone/extend → 展延 (SG standard)
  // Non-standard: Mainland 延期/推迟
  '延期': '展延',
  '推迟': '展延',

  // Freehold → 永久地契 (SG standard)
  // Non-standard: Mainland 永久产权
  '永久产权': '永久地契',
};
