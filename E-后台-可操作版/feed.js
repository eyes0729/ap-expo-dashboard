/* ===========================================================================
 * 内容生成器   window.APFeed
 * ---------------------------------------------------------------------------
 * 为什么需要这一层：引擎的内容池太小，盯着看几分钟就会看出在循环 ——
 *
 *   商品名          6×6×6 = 每种语言只有 216 种（PRODUCT_WORDS 三组各 6 个词）
 *   路径            4 个模板 × 216 = 864 种
 *   爬虫来源        APGeo.DATACENTERS **只有 14 个城市**
 *
 * 日志以约 1.5 行/秒上屏，864 种路径不到 10 分钟就开始重复；
 * 地图/地球上的读取亮点更是只在 14 个位置反复闪。展会现场商家会站在屏前好几分钟，
 * 这种循环一眼就假。
 *
 * 这一层把三样都放大三个数量级以上，并且：
 *   · 商品名**按店铺行业**选品类池 —— 服饰店卖衣服、美妆店卖护肤品，不再串味；
 *   · 路径带真实 access log 的形态（变体参数、分页、筛选、sitemap/robots）；
 *   · 读取来源 = 14 个主数据中心（高权重）+ 边缘 PoP（低权重），坐标再加抖动，
 *     于是亮点位置几乎不重复。
 *
 * 随机一律走 APEngine.hash32（规格红线：不许 Math.random，彩排要能复现）。
 * 不改 _shared/engine.js —— 那是 A/B/C/D 与 C-LED 共用的。
 * =========================================================================== */
(function (root) {
  'use strict';

  var E = root.APEngine;
  function h(seed, salt) { return E.hash32(seed, salt); }
  function pick(arr, seed, salt) { return arr[(h(seed, salt) * arr.length) | 0]; }

  /* ── 商品名：[系列] [质地/工艺] [材质] [品类] [– 变体] ────────────────────
   * 结构照真实 Shopify 商品名来（`Merino Wool Crew Neck – Charcoal / M`）。 */

  var SERIES = ['', '', '', '', 'Heritage', 'Everyday', 'Studio', 'Atelier', 'Signature',
    'Classic', 'Essential', 'Weekend', 'Coastal', 'Nordic', 'Alpine', 'Harbor',
    'Meadow', 'Terra', 'Aurora', 'Solstice', 'Pioneer', 'Union'];

  /* 形容词也得分池。通用池会生成「Quilted Cleansing Oil」（绗缝洁面油）
   * 这种词性不搭的组合 —— 绗缝、双面针织只适合织物。 */
  var ADJ_SET = {
    textile: ['Merino', 'Organic', 'Brushed', 'Heavyweight', 'Waxed', 'Combed',
      'Garment-Dyed', 'Stone-Washed', 'Double-Knit', 'Ribbed', 'Quilted', 'Recycled',
      'Unbleached', 'Featherweight', 'Oversized', 'Tailored', 'Relaxed', 'Boucle'],
    craft: ['Hand-Finished', 'Hand-Thrown', 'Kiln-Fired', 'Reinforced', 'Small-Batch',
      'Recycled', 'Organic', 'Air-Dried', 'Matte', 'Glazed', 'Solid', 'Turned',
      'Hand-Poured', 'Heirloom'],
    pure: ['Organic', 'Cold-Pressed', 'Slow-Cured', 'Small-Batch', 'Unrefined',
      'Fragrance-Free', 'Gentle', 'Daily', 'Nourishing', 'Barrier-Repair',
      'Lightweight', 'Rich'],
    edible: ['Organic', 'Cold-Pressed', 'Slow-Cured', 'Small-Batch', 'Unrefined',
      'Artisan', 'Estate', 'Reserve', 'Wild-Harvested', 'Aged', 'Raw'],
    gear: ['Reinforced', 'Featherweight', 'Weatherproof', 'Packable', 'Insulated',
      'Ultralight', 'Rugged', 'Compact', 'Quick-Dry', 'High-Vis', 'Recycled'],
    device: ['Reinforced', 'Compact', 'Braided', 'Fast-Charge', 'Low-Profile',
      'Anti-Slip', 'Magnetic', 'Foldable', 'Shock-Absorbing', 'Recycled']
  };

  /* 材质必须按品类分池，否则会生成「玻璃宠物床」「帆布须后油」这种一眼假的组合。
   * 空串表示这一档可以不出现（食品/美妆很多商品名里根本没有材质词）。 */
  var MAT_SET = {
    fabric: ['Cotton', 'Wool', 'Linen', 'Cashmere', 'Bamboo', 'Hemp', 'Denim',
      'Corduroy', 'Flannel', 'Canvas', 'Merino', 'Jersey'],
    hard: ['Ceramic', 'Oak', 'Walnut', 'Brass', 'Stoneware', 'Porcelain', 'Glass',
      'Aluminium', 'Rattan', 'Marble', 'Terrazzo', 'Linen'],
    tech: ['Aluminium', 'Titanium', 'Silicone', 'Carbon', 'Nylon', 'Leather', 'Felt'],
    gear: ['Nylon', 'Ripstop', 'Canvas', 'Merino', 'Fleece', 'Leather', 'Cork', 'Neoprene'],
    /* 食品专用：这些词只配得上咖啡/茶/油。放进美妆池会生成
     * 「Cold-Brew Shampoo Bar」这种一眼假的东西（实测出现过）。 */
    food: ['', '', '', 'Single-Origin', 'Cold-Brew', 'Hand-Roasted', 'Stone-Ground'],
    /* 美妆专用：不带材质词的居多，带也只能是配方类的 */
    care: ['', '', '', 'Botanical', 'Mineral', 'Plant-Based', 'Ceramide'],
    soft: ['Cotton', 'Bamboo', 'Muslin', 'Fleece', 'Jersey', 'Wool', 'Linen'],
    pet: ['Nylon', 'Canvas', 'Leather', 'Fleece', 'Rattan', 'Silicone', 'Rope'],
    paper: ['Linen', 'Kraft', 'Leather', 'Brass', 'Walnut', 'Cloth', 'Recycled']
  };

  /* 品类按行业分池。键对应 shops.js 的 IND（报表里的行业名）。 */
  var KIND = {
    apparel: ['Crew Neck', 'Chore Jacket', 'Oxford Shirt', 'Chino Trouser', 'Knit Cardigan',
      'Hoodie', 'Overshirt', 'Tee', 'Polo', 'Blazer', 'Trench Coat', 'Puffer Vest',
      'Wide-Leg Pant', 'Midi Skirt', 'Wrap Dress', 'Jumpsuit', 'Beanie', 'Scarf',
      'Belt', 'Tote', 'Crossbody Bag', 'Weekender', 'Loafer', 'Chelsea Boot',
      'Sneaker', 'Sock Set', 'Cap', 'Bucket Hat'],
    beauty: ['Face Serum', 'Day Cream', 'Night Balm', 'Cleansing Oil', 'Clay Mask',
      'Lip Butter', 'Hand Salve', 'Body Lotion', 'Shampoo Bar', 'Conditioner',
      'Scalp Tonic', 'Beard Oil', 'Eye Cream', 'Toner Mist', 'Sunscreen',
      'Exfoliant', 'Perfume Oil', 'Nail Care Set', 'Bath Soak', 'Deodorant'],
    home: ['Mug', 'Duvet Cover', 'Desk Lamp', 'Throw Blanket', 'Cushion Cover',
      'Dinner Plate', 'Serving Bowl', 'Cutting Board', 'Storage Basket', 'Planter',
      'Wall Mirror', 'Side Table', 'Floor Rug', 'Curtain Panel', 'Candle',
      'Diffuser', 'Coaster Set', 'Tea Towel', 'Apron', 'Vase', 'Bookend',
      'Laundry Hamper', 'Shower Curtain', 'Bath Mat'],
    tech: ['USB-C Cable', 'Charging Dock', 'Laptop Sleeve', 'Phone Case', 'Screen Guard',
      'Power Bank', 'Desk Mat', 'Keyboard Case', 'Earbud Case', 'Cable Organizer',
      'Monitor Stand', 'Webcam Cover', 'Stylus', 'Card Reader', 'Travel Adapter',
      'Wireless Charger', 'Controller Grip', 'Headset Stand', 'Mouse Pad', 'Hub'],
    outdoor: ['Daypack', 'Trail Runner', 'Rain Shell', 'Base Layer', 'Trekking Pole',
      'Water Bottle', 'Camp Stove', 'Sleeping Pad', 'Dry Bag', 'Headlamp',
      'Climbing Chalk', 'Yoga Mat', 'Resistance Band', 'Jump Rope', 'Foam Roller',
      'Bike Light', 'Saddle Bag', 'Helmet Liner', 'Gaiter', 'Cooler Tote'],
    food: ['Coffee Beans', 'Loose Leaf Tea', 'Olive Oil', 'Honey Jar', 'Chocolate Bar',
      'Granola', 'Nut Butter', 'Hot Sauce', 'Sea Salt', 'Spice Blend',
      'Pasta', 'Balsamic Vinegar', 'Matcha Tin', 'Cold Brew Kit', 'Biscuit Tin',
      'Jam', 'Miso Paste', 'Maple Syrup'],
    baby: ['Swaddle', 'Baby Blanket', 'Bib Set', 'Onesie', 'Sleep Sack',
      'Teether', 'Rattle', 'Stacking Ring', 'Play Mat', 'Wooden Puzzle',
      'Bath Toy', 'Bottle Brush', 'Nursery Lamp', 'Changing Pad', 'Pram Liner',
      'Soft Book', 'Building Block Set'],
    pet: ['Dog Collar', 'Lead', 'Harness', 'Pet Bed', 'Feeding Bowl',
      'Chew Toy', 'Grooming Brush', 'Cat Tree', 'Litter Mat', 'Travel Carrier',
      'Treat Pouch', 'Water Fountain', 'Paw Balm', 'Raincoat', 'Scratch Post'],
    office: ['Notebook', 'Fountain Pen', 'Pencil Case', 'Desk Organizer', 'Sticky Note Set',
      'Planner', 'Card Holder', 'Letter Tray', 'Bookmark Set', 'Washi Tape',
      'Ink Refill', 'Sketchbook', 'Ruler', 'Paper Clip Tin', 'Document Folder',
      'Wall Calendar', 'Stamp Set'],
    general: ['Gift Box', 'Starter Kit', 'Sample Set', 'Travel Pouch', 'Keyring',
      'Water Bottle', 'Tote', 'Mug', 'Candle', 'Notebook', 'Blanket', 'Apron',
      'Storage Tin', 'Umbrella', 'Card Set', 'Puzzle', 'Board Game', 'Poster']
  };

  /* 每个品类池绑定：材质集 + 允许的变体类型。
   * 变体类型限死才不会出现「帽子 200ml」「橡木摇铃 1L」。 */
  var POOL = {
    apparel: { mat: 'fabric', adj: 'textile', vars: ['color', 'colorsize'] },
    beauty:  { mat: 'care',   adj: 'pure',    vars: ['cap'] },
    home:    { mat: 'hard',   adj: 'craft',   vars: ['color'] },
    tech:    { mat: 'tech',   adj: 'device',  vars: ['color', 'len'] },
    outdoor: { mat: 'gear',   adj: 'gear',    vars: ['color', 'colorsize', 'vol'] },
    food:    { mat: 'food',   adj: 'edible',  vars: ['cap'] },
    baby:    { mat: 'soft',   adj: 'textile', vars: ['color', 'agesize'] },
    pet:     { mat: 'pet',    adj: 'gear',    vars: ['color', 'petsize'] },
    office:  { mat: 'paper',  adj: 'craft',   vars: ['color'] },
    general: { mat: 'hard',   adj: 'craft',   vars: ['color'] }
  };

  /* 报表里的行业名 → 品类池 */
  var IND_MAP = {
    '服饰与配饰': 'apparel', '健康与美容': 'beauty', '家居与园艺': 'home',
    '工具与电子': 'tech', '手机与配件': 'tech', '游戏设备': 'tech',
    '户外运动': 'outdoor', '食品饮料': 'food', '母婴玩具': 'baby',
    '宠物用品': 'pet', '文创办公': 'office',
    '综合零售': 'general', '礼品与综合零售': 'general', '其他': 'general',
    '情趣用品': 'general'
  };

  var COLOR = ['Charcoal', 'Oatmeal', 'Sand', 'Olive', 'Navy', 'Rust', 'Ecru', 'Slate',
    'Moss', 'Clay', 'Indigo', 'Bone', 'Umber', 'Sage', 'Plum', 'Chestnut',
    'Off-White', 'Black', 'Stone', 'Terracotta', 'Denim Blue', 'Forest'];
  var SIZE = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
  var CAP = ['30ml', '50ml', '100ml', '200ml', '250g', '500g', '1kg', '12 ct', '24 ct'];
  var VOL = ['500ml', '750ml', '1L', '1.5L', '18L', '24L', '35L'];
  var LEN = ['0.5m', '1m', '1.5m', '2m', '3m'];
  var AGES = ['0-3M', '3-6M', '6-12M', '1-2Y', '2-4Y'];
  var PETS = ['XS', 'S', 'M', 'L'];

  /** 商品名。ind = 店铺行业（报表口径），可空。 */
  function product(seed, ind) {
    var poolKey = IND_MAP[ind] || 'general';
    var pl = POOL[poolKey] || POOL.general;
    var kinds = KIND[poolKey] || KIND.general;
    var mats = MAT_SET[pl.mat] || MAT_SET.hard;
    var s = pick(SERIES, seed, 1201);
    var a = pick(ADJ_SET[pl.adj] || ADJ_SET.craft, seed, 1213);
    var m = pick(mats, seed, 1217);
    var k = pick(kinds, seed, 1223);
    var out = (s ? s + ' ' : '') + a + ' ' + (m ? m + ' ' : '') + k;
    /* 约 45% 带变体后缀，类型受品类池限制 */
    if (h(seed, 1229) < 0.45) {
      var vt = pick(pl.vars, seed, 1231);
      if (vt === 'color') out += ' – ' + pick(COLOR, seed, 1237);
      else if (vt === 'colorsize') out += ' – ' + pick(COLOR, seed, 1241) + ' / ' + pick(SIZE, seed, 1249);
      else if (vt === 'cap') out += ' – ' + pick(CAP, seed, 1259);
      else if (vt === 'vol') out += ' – ' + pick(VOL, seed, 1277);
      else if (vt === 'len') out += ' – ' + pick(LEN, seed, 1279);
      else if (vt === 'agesize') out += ' – ' + pick(AGES, seed, 1283);
      else if (vt === 'petsize') out += ' – ' + pick(PETS, seed, 1289);
    }
    return out;
  }

  function slugify(s) {
    return String(s).toLowerCase()
      .replace(/[–—]/g, '-')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  /* ── 路径：照真实 access log 的形态 ─────────────────────────────────────
   * AI 爬虫读得最多的是商品页与集合页，但也会先摸 sitemap / robots，
   * 而且带查询参数的请求在真实日志里占相当比例。 */
  var COLLECTIONS = ['all', 'new-arrivals', 'best-sellers', 'sale', 'gifts', 'bundles',
    'apparel', 'accessories', 'home', 'outdoor', 'seasonal', 'last-chance',
    'under-50', 'restocked', 'limited', 'archive'];
  var BLOG_SLUGS = ['how-to-care-for-merino', 'behind-the-fabric', 'studio-notes',
    'sizing-guide', 'shipping-and-returns', 'material-sourcing', 'a-day-in-the-studio',
    'gift-guide', 'care-and-repair', 'why-we-use-linen', 'field-notes',
    'the-making-of', 'seasonal-lookbook'];
  var PAGES = ['about', 'contact', 'faq', 'shipping', 'returns', 'size-guide',
    'sustainability', 'stockists', 'care', 'terms', 'privacy'];
  var SEARCH = ['linen shirt', 'wool coat', 'gift under 50', 'ceramic mug', 'tote bag',
    'organic cotton', 'desk lamp', 'rain jacket', 'baby blanket', 'dog collar',
    'coffee beans', 'notebook'];

  /** 路径。prodName 用来生成商品 slug。
   *
   *  商品页给到 64%（对齐引擎 PAGE_TYPES 里 product 的权重 62，也符合真实爬虫行为 ——
   *  有价值的内容都在商品页）。这一档的 slug 跟着商品名走，唯一性最高；
   *  collections / blogs / pages 这些在真实店铺里本来就只有十几个，
   *  重复是**真实的**，所以只压低它们的占比、并给参数留出变化，不去硬造。 */
  function path(seed, prodName) {
    var r = h(seed, 1301);
    var slug = slugify(prodName).slice(0, 46);
    if (r < 0.64) {
      var p = '/products/' + slug;
      var q = h(seed, 1303);
      /* 变体参数：真实日志里很常见，而且能让同一个商品页产生不同 URL */
      if (q < 0.30) p += '?variant=' + (40000000000 + ((h(seed, 1307) * 9999999999) | 0));
      else if (q < 0.36) p += '?utm_source=' + pick(['chatgpt', 'perplexity', 'gemini', 'claude'], seed, 1311);
      return p;
    }
    if (r < 0.82) {
      var c = '/collections/' + pick(COLLECTIONS, seed, 1309);
      var q2 = h(seed, 1313);
      if (q2 < 0.30) c += '/products/' + slug;                /* 集合内商品页，唯一性高 */
      else if (q2 < 0.44) c += '?page=' + (2 + ((h(seed, 1319) * 8) | 0));
      else if (q2 < 0.56) c += '?filter.v.price.gte=' + (10 + ((h(seed, 1321) * 9) | 0) * 10);
      else if (q2 < 0.64) c += '?sort_by=' + pick(['best-selling', 'created-descending',
        'price-ascending', 'price-descending', 'manual'], seed, 1323);
      return c;
    }
    if (r < 0.895) return '/blogs/journal/' + pick(BLOG_SLUGS, seed, 1327);
    if (r < 0.935) return '/pages/' + pick(PAGES, seed, 1361);
    if (r < 0.965) return '/search?q=' + encodeURIComponent(pick(SEARCH, seed, 1367)).replace(/%20/g, '+');
    if (r < 0.982) return '/sitemap.xml';
    if (r < 0.994) return '/sitemap_products_' + (1 + ((h(seed, 1373) * 4) | 0)) + '.xml';
    return '/robots.txt';
  }

  /* ── 读取来源：14 个主数据中心 + 边缘 PoP + 坐标抖动 ──────────────────
   * 引擎只有 14 个 DATACENTERS，地图/地球上的读取亮点就在那 14 个点反复闪。
   * 云厂商的核心区确实是少数几个（语义上没错），但 AI 爬虫也会从边缘节点出口，
   * 所以补一批 PoP；再给坐标加 ±0.55° 抖动（同城不同机房），
   * 于是亮点位置几乎不重复。 */
  var origins = null;
  function buildOrigins() {
    var Geo = root.APGeo;
    origins = [];
    var i, seen = {};
    if (Geo && Geo.DATACENTERS) {
      for (i = 0; i < Geo.DATACENTERS.length; i++) {
        var d = Geo.DATACENTERS[i];
        origins.push({ city: d.city, lat: d.lat, lon: d.lon, w: 9 });
        seen[d.city] = 1;
      }
    }
    /* 边缘 PoP：从真实城市里挑权重高的，避开已有的核心区 */
    if (Geo && Geo.CITIES) {
      var pool = [];
      for (i = 0; i < Geo.CITIES.length; i++) {
        var c = Geo.CITIES[i];
        if (seen[c[0]]) continue;
        pool.push({ city: c[0], lat: c[1], lon: c[2], wt: c[4] || 1 });
      }
      pool.sort(function (a, b) { return b.wt - a.wt; });
      for (i = 0; i < pool.length && i < 42; i++) {
        origins.push({ city: pool[i].city, lat: pool[i].lat, lon: pool[i].lon, w: 2 });
      }
    }
    if (!origins.length) origins.push({ city: 'Ashburn', lat: 39.04, lon: -77.49, w: 1 });
    var tot = 0;
    for (i = 0; i < origins.length; i++) { tot += origins[i].w; origins[i].acc = tot; }
    origins.total = tot;
  }

  /** 返回 { city, lat, lon }。抖动让同一个城市每次的坐标都不同。
   *
   *  抖动幅度 ±2.2°（约 ±13px @ R=352）不是随便定的：
   *  平铺地图把坐标量化到 64×26 的格子（5.6° × 5°），抖动小于半个格就**完全看不出来**
   *  —— 先前给的 ±0.55° 只有 ±3.4px，打点还是死死钉在同一格，于是「一直循环」。
   *  ±2.2° 能让约四成的打点落到相邻格，可见位置从 56 个涨到 120 个以上；
   *  在全屏地球上（不量化）则是连续散布。
   *  语义上也站得住：一个云区域的 IP 段地理定位精度本来就是几十公里，
   *  同区多可用区出口更是常态 —— 城市名不变，只有坐标散开。 */
  function origin(seed) {
    if (!origins) buildOrigins();
    var t = h(seed, 1409) * origins.total, i;
    var o = origins[origins.length - 1];
    for (i = 0; i < origins.length; i++) {
      if (t <= origins[i].acc) { o = origins[i]; break; }
    }
    return {
      city: o.city,
      lat: o.lat + (h(seed, 1423) - 0.5) * 4.4,
      lon: o.lon + (h(seed, 1427) - 0.5) * 4.4
    };
  }

  root.APFeed = {
    product: product,
    path: path,
    origin: origin,
    slugify: slugify,
    /* 组合数自检用 */
    stats: function () {
      var kinds = 0, k;
      for (k in KIND) if (Object.prototype.hasOwnProperty.call(KIND, k)) kinds += KIND[k].length;
      if (!origins) buildOrigins();
      return {
        series: SERIES.length, adj: ADJ_SET.textile.length, mat: MAT_SET.fabric.length,
        kindPools: Object.keys(KIND).length, kindsTotal: kinds,
        variants: 1 + COLOR.length + COLOR.length * SIZE.length + CAP.length,
        origins: origins.length,
        /* 单个行业池的商品名组合数（不含变体） */
        productCombosPerInd: SERIES.length * ADJ_SET.textile.length * MAT_SET.fabric.length *
          Math.round(kinds / Object.keys(KIND).length)
      };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
