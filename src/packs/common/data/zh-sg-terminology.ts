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

  // === Food ===

  // Hawker centre → 熟食中心 / 小贩中心
  // Non-standard: 美食广场 (HK), 大排档
  '美食广场': '熟食中心',
  '大排档': '熟食中心',
};
