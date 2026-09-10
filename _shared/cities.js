/* ===========================================================================
 * AP 展会大屏 · 共享地理数据
 * 全部为真实城市经纬度。两个用途：
 *   1) 地球上打点 —— 只用真实城市，大陆轮廓会自然浮现，不需要贴图/GeoJSON
 *   2) 假数据的地域一致性 —— 国家/语言/货币/城市严格绑定，德国站永远 EUR + 德语
 * 依赖：无。用 <script src> 引入（不要用 ES module，file:// 下会被 CORS 拦）
 * =========================================================================== */
(function (root) {
  'use strict';

  /* --- 市场（消费者/商家所在地）：locale 与 currency 钉死绑定 --------------- */
  var MARKETS = [
    { cc: 'US', locale: 'en-US', currency: 'USD', weight: 34, lang: 'en' },
    { cc: 'GB', locale: 'en-GB', currency: 'GBP', weight: 9,  lang: 'en' },
    { cc: 'DE', locale: 'de-DE', currency: 'EUR', weight: 9,  lang: 'de' },
    { cc: 'FR', locale: 'fr-FR', currency: 'EUR', weight: 6,  lang: 'fr' },
    { cc: 'CA', locale: 'en-CA', currency: 'CAD', weight: 6,  lang: 'en' },
    { cc: 'AU', locale: 'en-AU', currency: 'AUD', weight: 5,  lang: 'en' },
    { cc: 'JP', locale: 'ja-JP', currency: 'JPY', weight: 5,  lang: 'ja' },
    { cc: 'NL', locale: 'nl-NL', currency: 'EUR', weight: 4,  lang: 'nl' },
    { cc: 'IT', locale: 'it-IT', currency: 'EUR', weight: 3,  lang: 'it' },
    { cc: 'ES', locale: 'es-ES', currency: 'EUR', weight: 3,  lang: 'es' },
    { cc: 'SE', locale: 'sv-SE', currency: 'SEK', weight: 2,  lang: 'sv' },
    { cc: 'KR', locale: 'ko-KR', currency: 'KRW', weight: 2,  lang: 'ko' },
    { cc: 'SG', locale: 'en-SG', currency: 'SGD', weight: 2,  lang: 'en' },
    { cc: 'AE', locale: 'ar-AE', currency: 'AED', weight: 2,  lang: 'ar' },
    { cc: 'BR', locale: 'pt-BR', currency: 'BRL', weight: 2,  lang: 'pt' },
    { cc: 'MX', locale: 'es-MX', currency: 'MXN', weight: 2,  lang: 'es' },
    { cc: 'PL', locale: 'pl-PL', currency: 'PLN', weight: 1,  lang: 'pl' },
    { cc: 'DK', locale: 'da-DK', currency: 'DKK', weight: 1,  lang: 'da' }
  ];

  /* --- 城市：[名称, 纬度, 经度, 国家码, 权重] --------------------------------
   * 权重决定打点亮度与被选中概率。约 120 座，覆盖六大洲主要人口带，
   * 球面上足以让北美东西岸、西欧、东亚、南亚、澳洲的轮廓自然可辨。 */
  var CITIES = [
    ['New York',40.71,-74.01,'US',10],['Los Angeles',34.05,-118.24,'US',9],
    ['Chicago',41.88,-87.63,'US',7],['Houston',29.76,-95.37,'US',6],
    ['Phoenix',33.45,-112.07,'US',5],['Philadelphia',39.95,-75.17,'US',5],
    ['San Antonio',29.42,-98.49,'US',4],['San Diego',32.72,-117.16,'US',5],
    ['Dallas',32.78,-96.80,'US',6],['Austin',30.27,-97.74,'US',5],
    ['San Francisco',37.77,-122.42,'US',7],['San Jose',37.34,-121.89,'US',5],
    ['Seattle',47.61,-122.33,'US',6],['Denver',39.74,-104.99,'US',5],
    ['Boston',42.36,-71.06,'US',6],['Atlanta',33.75,-84.39,'US',6],
    ['Miami',25.76,-80.19,'US',6],['Portland',45.52,-122.68,'US',4],
    ['Minneapolis',44.98,-93.27,'US',4],['Detroit',42.33,-83.05,'US',4],
    ['Nashville',36.16,-86.78,'US',4],['Las Vegas',36.17,-115.14,'US',4],
    ['Salt Lake City',40.76,-111.89,'US',3],['Kansas City',39.10,-94.58,'US',3],
    ['Columbus',39.96,-83.00,'US',3],['Charlotte',35.23,-80.84,'US',3],
    ['Ashburn',39.04,-77.49,'US',3],['Council Bluffs',41.26,-95.86,'US',2],
    ['Toronto',43.65,-79.38,'CA',7],['Vancouver',49.28,-123.12,'CA',5],
    ['Montreal',45.50,-73.57,'CA',5],['Calgary',51.05,-114.07,'CA',3],
    ['Mexico City',19.43,-99.13,'MX',7],['Guadalajara',20.67,-103.35,'MX',3],
    ['Monterrey',25.69,-100.32,'MX',3],
    ['Sao Paulo',-23.55,-46.63,'BR',8],['Rio de Janeiro',-22.91,-43.17,'BR',5],
    ['Buenos Aires',-34.60,-58.38,'AR',5],['Santiago',-33.45,-70.67,'CL',4],
    ['Lima',-12.05,-77.04,'PE',4],['Bogota',4.71,-74.07,'CO',4],
    ['London',51.51,-0.13,'GB',10],['Manchester',53.48,-2.24,'GB',4],
    ['Dublin',53.35,-6.26,'IE',4],['Paris',48.86,2.35,'FR',8],
    ['Lyon',45.76,4.84,'FR',3],['Marseille',43.30,5.37,'FR',3],
    ['Amsterdam',52.37,4.90,'NL',6],['Rotterdam',51.92,4.48,'NL',3],
    ['Brussels',50.85,4.35,'BE',4],['Berlin',52.52,13.40,'DE',8],
    ['Munich',48.14,11.58,'DE',5],['Hamburg',53.55,9.99,'DE',4],
    ['Frankfurt',50.11,8.68,'DE',5],['Cologne',50.94,6.96,'DE',3],
    ['Zurich',47.38,8.54,'CH',4],['Vienna',48.21,16.37,'AT',4],
    ['Milan',45.46,9.19,'IT',5],['Rome',41.90,12.50,'IT',5],
    ['Madrid',40.42,-3.70,'ES',6],['Barcelona',41.39,2.17,'ES',5],
    ['Lisbon',38.72,-9.14,'PT',4],['Copenhagen',55.68,12.57,'DK',4],
    ['Stockholm',59.33,18.07,'SE',4],['Oslo',59.91,10.75,'NO',3],
    ['Helsinki',60.17,24.94,'FI',3],['Warsaw',52.23,21.01,'PL',4],
    ['Prague',50.08,14.44,'CZ',3],['Budapest',47.50,19.04,'HU',3],
    ['Bucharest',44.43,26.10,'RO',3],['Athens',37.98,23.73,'GR',3],
    ['Istanbul',41.01,28.98,'TR',6],['Kyiv',50.45,30.52,'UA',3],
    ['Dubai',25.20,55.27,'AE',6],['Abu Dhabi',24.45,54.38,'AE',3],
    ['Riyadh',24.71,46.68,'SA',5],['Tel Aviv',32.09,34.78,'IL',4],
    ['Cairo',30.04,31.24,'EG',5],['Casablanca',33.57,-7.59,'MA',3],
    ['Lagos',6.52,3.38,'NG',5],['Nairobi',-1.29,36.82,'KE',4],
    ['Johannesburg',-26.20,28.05,'ZA',5],['Cape Town',-33.92,18.42,'ZA',4],
    ['Mumbai',19.08,72.88,'IN',8],['Delhi',28.61,77.21,'IN',8],
    ['Bengaluru',12.97,77.59,'IN',6],['Chennai',13.08,80.27,'IN',5],
    ['Hyderabad',17.39,78.49,'IN',4],['Kolkata',22.57,88.36,'IN',5],
    ['Karachi',24.86,67.01,'PK',5],['Dhaka',23.81,90.41,'BD',5],
    ['Bangkok',13.76,100.50,'TH',6],['Singapore',1.35,103.82,'SG',7],
    ['Kuala Lumpur',3.14,101.69,'MY',5],['Jakarta',-6.21,106.85,'ID',7],
    ['Manila',14.60,120.98,'PH',6],['Ho Chi Minh City',10.82,106.63,'VN',5],
    ['Hanoi',21.03,105.85,'VN',4],
    ['Tokyo',35.68,139.69,'JP',10],['Osaka',34.69,135.50,'JP',6],
    ['Nagoya',35.18,136.91,'JP',4],['Fukuoka',33.59,130.40,'JP',3],
    ['Seoul',37.57,126.98,'KR',8],['Busan',35.18,129.08,'KR',4],
    ['Taipei',25.03,121.57,'TW',5],['Hong Kong',22.32,114.17,'HK',7],
    ['Shanghai',31.23,121.47,'CN',8],['Beijing',39.90,116.41,'CN',8],
    ['Shenzhen',22.54,114.06,'CN',7],['Guangzhou',23.13,113.26,'CN',6],
    ['Chengdu',30.57,104.07,'CN',5],['Hangzhou',30.27,120.16,'CN',5],
    ['Sydney',-33.87,151.21,'AU',7],['Melbourne',-37.81,144.96,'AU',6],
    ['Brisbane',-27.47,153.03,'AU',4],['Perth',-31.95,115.86,'AU',3],
    ['Auckland',-36.85,174.76,'NZ',4]
  ];

  /* --- AI 爬虫出口数据中心 ---------------------------------------------------
   * 真实云区域城市 + 真实 ASN 名。IP 只显示前两段（完整 IP 会被观众当真去查）。
   * 可核对来源：openai.com/gptbot.json、claude.com/crawling/bots.json 等，
   * 开发期抓一次落成静态文件即可，现场绝不联网拉取。 */
  var DATACENTERS = [
    { city:'Ashburn',        lat:39.04, lon:-77.49, asn:'Microsoft Azure', ip:'20.171' },
    { city:'Des Moines',     lat:41.59, lon:-93.62, asn:'Microsoft Azure', ip:'52.230' },
    { city:'San Jose',       lat:37.34, lon:-121.89,asn:'Cloudflare',      ip:'104.28' },
    { city:'Boardman',       lat:45.84, lon:-119.70,asn:'Amazon AWS',      ip:'44.221' },
    { city:'Council Bluffs', lat:41.26, lon:-95.86, asn:'Google Cloud',    ip:'34.122' },
    { city:'Dublin',         lat:53.35, lon:-6.26,  asn:'Microsoft Azure', ip:'20.49'  },
    { city:'Frankfurt',      lat:50.11, lon:8.68,   asn:'Amazon AWS',      ip:'18.184' },
    { city:'Amsterdam',      lat:52.37, lon:4.90,   asn:'Google Cloud',    ip:'34.90'  },
    { city:'London',         lat:51.51, lon:-0.13,  asn:'Microsoft Azure', ip:'20.68'  },
    { city:'Singapore',      lat:1.35,  lon:103.82, asn:'Amazon AWS',      ip:'13.212' },
    { city:'Tokyo',          lat:35.68, lon:139.69, asn:'Google Cloud',    ip:'34.84'  },
    { city:'Sydney',         lat:-33.87,lon:151.21, asn:'Amazon AWS',      ip:'13.237' },
    { city:'Sao Paulo',      lat:-23.55,lon:-46.63, asn:'Microsoft Azure', ip:'20.206' },
    { city:'Mumbai',         lat:19.08, lon:72.88,  asn:'Amazon AWS',      ip:'13.234' }
  ];

  var marketByCC = {};
  for (var i = 0; i < MARKETS.length; i++) marketByCC[MARKETS[i].cc] = MARKETS[i];

  /* 按国家码索引城市，便于「德国站 -> 德国城市」这种一致性取值 */
  var citiesByCC = {};
  for (var j = 0; j < CITIES.length; j++) {
    var cc = CITIES[j][3];
    if (!citiesByCC[cc]) citiesByCC[cc] = [];
    citiesByCC[cc].push(CITIES[j]);
  }

  root.APGeo = {
    MARKETS: MARKETS,
    CITIES: CITIES,
    DATACENTERS: DATACENTERS,
    marketByCC: marketByCC,
    citiesByCC: citiesByCC,
    /** 经纬度 -> 单位球面坐标（Y 轴朝北极，右手系，lon=0 朝 +Z） */
    toVec3: function (latDeg, lonDeg, r) {
      r = (r === undefined) ? 1 : r;
      var la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180;
      return {
        x: r * Math.cos(la) * Math.sin(lo),
        y: r * Math.sin(la),
        z: r * Math.cos(la) * Math.cos(lo)
      };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
