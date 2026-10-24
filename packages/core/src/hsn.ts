/**
 * HSN (goods) and SAC (services) suggestions from an item's name.
 *
 * A curated list of the codes small Indian businesses use most, matched by
 * keyword on the device: no lookup service. Where the right six-digit SAC
 * depends on detail we can't infer, the entry uses the four-digit heading,
 * which is valid on invoices for turnover up to ₹5 crore. Suggestions are a
 * starting point; the user confirms the code before it is saved.
 */

export type HsnKind = "service" | "goods";

export interface HsnEntry {
  code: string;
  description: string;
  kind: HsnKind;
  /** Words and phrases that point to this code, lower case. */
  keywords: readonly string[];
}

export const HSN_CATALOGUE: readonly HsnEntry[] = [
  // --- Professional, technical and business services (9983)
  s("998311", "Management consulting and management services", ["management consulting", "consulting", "consultancy", "consultant", "advisory", "strategy", "business plan"]),
  s("998312", "Business consulting services including public relations", ["business consulting", "public relations", "pr", "corporate communication"]),
  s("998313", "IT consulting and support services", ["it consulting", "it support", "technical support", "amc", "annual maintenance", "software support", "helpdesk", "it services", "erp implementation", "odoo"]),
  s("998314", "IT design and development services", ["software development", "web development", "website", "web design", "app development", "mobile app", "application development", "programming", "coding", "software", "development", "customisation", "customization", "api integration", "ui", "ux"]),
  s("998315", "Hosting and IT infrastructure provisioning services", ["hosting", "web hosting", "cloud", "server", "vps", "saas", "subscription", "data storage", "email hosting"]),
  s("998316", "IT infrastructure and network management services", ["network management", "it infrastructure", "managed services", "network setup", "firewall"]),
  s("998319", "Other information technology services", ["domain", "domain registration", "data entry", "data processing", "it"]),
  s("998321", "Architectural advisory services", ["architect", "architectural", "architecture"]),
  s("998331", "Engineering advisory services", ["engineering", "engineering consultancy", "structural design"]),
  s("998361", "Advertising services", ["advertising", "advertisement", "ads", "digital marketing", "marketing", "social media", "seo", "branding campaign", "campaign", "promotion"]),
  s("998365", "Sale of internet advertising space", ["online ads", "google ads", "facebook ads", "ad space", "banner ads"]),
  s("998371", "Market research services", ["market research", "survey", "research"]),
  s("998381", "Portrait photography services", ["portrait", "photo shoot", "wedding photography"]),
  s("998382", "Advertising and related photography services", ["photography", "product photography", "photographer", "photo"]),
  s("998391", "Specialty design services (interior, fashion, graphic, industrial)", ["design", "graphic design", "logo design", "interior design", "fashion design", "brand identity", "branding", "packaging design", "illustration"]),
  s("998393", "Scientific and technical consulting services", ["technical consulting", "scientific consulting"]),
  s("998395", "Translation and interpretation services", ["translation", "interpretation", "translator"]),
  s("998399", "Other professional, technical and business services", ["content writing", "copywriting", "writing", "professional services", "professional fees", "retainer"]),

  // --- Legal and accounting (9982)
  s("9982", "Legal and accounting services", ["legal", "lawyer", "advocate", "legal fees", "trademark filing", "contract drafting", "compliance"]),
  s("998221", "Financial auditing services", ["audit", "statutory audit", "auditor", "internal audit"]),
  s("998222", "Accounting and bookkeeping services", ["accounting", "bookkeeping", "accounts", "book keeping", "ca fees", "chartered accountant"]),
  s("998223", "Payroll services", ["payroll"]),
  s("998231", "Corporate tax consulting and preparation services", ["tax consulting", "gst filing", "gst return", "tax filing", "itr", "income tax", "tds return", "tax"]),

  // --- Support services (9985)
  s("998512", "Permanent placement services", ["recruitment", "placement", "hiring", "headhunting", "talent acquisition"]),
  s("998513", "Contract staffing services", ["contract staffing", "staffing", "manpower", "outsourced staff"]),
  s("9985", "Support services (security, call centre, office support)", ["security guard", "security services", "call centre", "call center", "bpo", "back office", "office support"]),
  s("998533", "General cleaning services", ["cleaning", "housekeeping", "janitorial", "deep cleaning"]),
  s("998551", "Reservation services for transportation", ["ticket booking", "air ticket", "flight booking", "travel agent"]),
  s("998552", "Reservation services for accommodation, cruises and package tours", ["hotel booking", "tour package", "package tour"]),
  s("998596", "Events, exhibitions, conventions and trade shows organisation", ["event", "event management", "exhibition", "conference", "trade show", "seminar organisation"]),

  // --- Education and training (9992)
  s("999293", "Commercial training and coaching services", ["training", "coaching", "workshop", "course", "tuition", "classes", "bootcamp", "certification course"]),

  // --- Licensing, rent and leasing
  s("997331", "Licensing services for the right to use computer software", ["software licence", "software license", "licence", "license", "license fee"]),
  s("997212", "Rental or leasing of non-residential property", ["rent", "office rent", "shop rent", "commercial rent", "warehouse rent", "lease"]),
  s("997211", "Rental or leasing of residential property", ["house rent", "residential rent", "flat rent"]),
  s("9973", "Leasing or rental services without operator", ["equipment rental", "machine rental", "car rental", "hire"]),

  // --- Trade, transport, accommodation, food
  s("996111", "Wholesale trade services on a fee or commission basis", ["commission", "brokerage", "agency commission", "commission agent"]),
  s("996511", "Road transport services of goods", ["transport", "freight", "logistics", "trucking", "goods transport", "gta", "delivery charges"]),
  s("9964", "Passenger transport services", ["cab", "taxi", "bus hire", "travel"]),
  s("996812", "Courier services", ["courier", "shipping", "parcel"]),
  s("996311", "Room or unit accommodation services", ["hotel", "accommodation", "room", "lodging", "stay"]),
  s("996331", "Services provided by restaurants and cafes", ["restaurant", "food", "cafe", "meals"]),
  s("9963", "Accommodation, food and beverage services", ["catering", "canteen", "outdoor catering"]),

  // --- Repairs, manufacturing services, construction
  s("998713", "Maintenance and repair of computers and peripherals", ["computer repair", "laptop repair", "printer repair"]),
  s("9987", "Maintenance, repair and installation services", ["repair", "maintenance", "installation", "servicing", "ac service"]),
  s("9988", "Manufacturing services on inputs owned by others (job work)", ["job work", "jobwork", "stitching", "dyeing", "printing job work", "fabrication"]),
  s("998912", "Printing and reproduction services on a fee or contract basis", ["printing", "print", "visiting cards", "flex printing", "brochure printing"]),
  s("9954", "Construction services", ["construction", "civil work", "contractor", "renovation", "interior work"]),
  s("999612", "Motion picture, video and TV programme production services", ["video production", "video editing", "film", "shoot", "animation", "reel"]),

  // --- Financial, telecom, other
  s("9971", "Financial and related services", ["bank charges", "interest", "insurance", "loan processing", "financial services"]),
  s("9984", "Telecommunications and internet services", ["internet", "broadband", "telephone", "mobile recharge", "telecom", "leased line"]),
  s("999799", "Other services", ["service charges", "miscellaneous services", "other services"]),

  // --- Goods: electronics and office
  g("8471", "Computers, laptops and data processing machines", ["laptop", "computer", "desktop", "server hardware", "cpu", "notebook computer"]),
  g("8473", "Parts and accessories of computers", ["keyboard", "mouse", "ram", "ssd", "hard disk", "computer parts", "motherboard"]),
  g("8528", "Monitors, projectors and televisions", ["monitor", "projector", "television", "tv", "led tv"]),
  g("8517", "Mobile phones, routers and network equipment", ["mobile phone", "smartphone", "phone", "router", "modem", "switch", "wifi"]),
  g("8443", "Printers, copiers and scanners", ["printer", "copier", "photocopier", "scanner"]),
  g("8504", "UPS, inverters, chargers and adapters", ["ups", "inverter", "charger", "adapter", "power supply"]),
  g("8507", "Batteries and accumulators", ["battery", "batteries"]),
  g("8544", "Cables and wires", ["cable", "wire", "hdmi", "lan cable"]),
  g("8523", "Storage media, pen drives and memory cards", ["pen drive", "usb drive", "memory card", "sd card"]),
  g("8518", "Speakers, headphones and microphones", ["speaker", "headphone", "earphone", "microphone", "headset"]),
  g("8525", "Cameras and CCTV", ["camera", "cctv", "webcam", "dvr"]),
  g("8536", "Switches, sockets and plugs", ["socket", "plug", "mcb", "electrical switch"]),
  g("8539", "LED lamps and bulbs", ["led", "bulb", "tube light", "lamp"]),
  g("8415", "Air conditioners", ["air conditioner", "ac", "split ac"]),
  g("8418", "Refrigerators", ["refrigerator", "fridge", "freezer"]),
  g("8516", "Electric heaters, kettles and irons", ["kettle", "heater", "geyser", "iron", "microwave"]),
  g("8509", "Mixers, grinders and food processors", ["mixer", "grinder", "juicer"]),
  g("9403", "Furniture", ["furniture", "table", "desk", "cupboard", "cabinet", "shelf", "rack"]),
  g("9401", "Chairs and seats", ["chair", "sofa", "seat", "stool"]),
  g("4802", "Paper (A4, copier paper)", ["a4 paper", "copier paper", "paper ream", "paper"]),
  g("4820", "Registers, notebooks and diaries", ["register", "notebook", "diary", "stationery"]),
  g("9608", "Pens and markers", ["pen", "pens", "marker", "ball pen"]),
  g("4819", "Cartons and boxes of paper", ["carton", "box", "corrugated box", "packaging box"]),
  g("4901", "Printed books", ["book", "books", "printed book"]),
  // --- Goods: textiles and apparel
  g("5208", "Woven cotton fabrics", ["cotton fabric", "cotton cloth", "fabric", "cloth"]),
  g("5407", "Woven synthetic filament fabrics", ["polyester fabric", "synthetic fabric", "nylon fabric"]),
  g("5205", "Cotton yarn", ["cotton yarn", "yarn"]),
  g("6109", "T-shirts and vests, knitted", ["t-shirt", "tshirt", "t shirt", "vest"]),
  g("6205", "Men's shirts", ["shirt", "shirts"]),
  g("6203", "Men's suits, trousers and jackets", ["trouser", "trousers", "pant", "suit", "blazer"]),
  g("6204", "Women's suits, dresses and skirts", ["kurti", "dress", "saree", "skirt", "salwar"]),
  g("6302", "Bed linen, towels and table linen", ["bedsheet", "bed sheet", "towel", "pillow cover"]),
  g("4202", "Bags, cases and wallets", ["bag", "backpack", "laptop bag", "wallet", "suitcase"]),
  g("6403", "Footwear with leather uppers", ["leather shoes", "shoes", "footwear", "sandals"]),
  // --- Goods: food, health, household
  g("1006", "Rice", ["rice", "basmati"]),
  g("1001", "Wheat", ["wheat"]),
  g("1701", "Sugar", ["sugar"]),
  g("0902", "Tea", ["tea"]),
  g("0901", "Coffee", ["coffee"]),
  g("2201", "Packaged drinking water", ["water", "mineral water", "drinking water"]),
  g("3004", "Medicines", ["medicine", "tablet", "capsule", "syrup"]),
  g("3401", "Soap", ["soap", "hand wash"]),
  g("3304", "Cosmetics and skin care", ["cosmetic", "cream", "lotion", "makeup"]),
  g("3305", "Hair care products", ["shampoo", "hair oil", "conditioner"]),
  g("9503", "Toys", ["toy", "toys", "game"]),
  g("7113", "Jewellery", ["jewellery", "jewelry", "ring", "necklace", "bangle"]),
  // --- Goods: industrial and building
  g("7308", "Iron or steel structures", ["steel structure", "shed", "fabricated structure"]),
  g("7318", "Screws, bolts and nuts", ["screw", "bolt", "nut", "washer"]),
  g("8205", "Hand tools", ["hand tool", "spanner", "hammer", "screwdriver"]),
  g("8413", "Pumps", ["pump", "water pump", "motor pump"]),
  g("8481", "Valves and taps", ["valve", "tap", "faucet"]),
  g("8708", "Motor vehicle parts", ["auto parts", "spare parts", "car parts"]),
  g("4011", "Tyres", ["tyre", "tire"]),
  g("2523", "Cement", ["cement"]),
  g("6907", "Ceramic tiles", ["tile", "tiles", "flooring tiles"]),
  g("3208", "Paints and varnishes", ["paint", "varnish", "enamel"]),
  g("3506", "Adhesives and glue", ["adhesive", "glue", "fevicol"]),
  g("3923", "Plastic packaging", ["plastic bag", "poly bag", "plastic container", "bottle"]),
  g("3926", "Other plastic articles", ["plastic"]),
  g("2710", "Petroleum oils (diesel, lubricants)", ["diesel", "petrol", "lubricant", "engine oil"]),
];

function s(code: string, description: string, keywords: string[]): HsnEntry {
  return { code, description, kind: "service", keywords };
}
function g(code: string, description: string, keywords: string[]): HsnEntry {
  return { code, description, kind: "goods", keywords };
}

export interface HsnSuggestion {
  code: string;
  description: string;
  kind: HsnKind;
  /** "history" when the org already used this code for a similar item. */
  source: "history" | "catalogue";
  score: number;
}

const STOP = new Set(["and", "of", "for", "the", "a", "an", "to", "in", "on", "with", "per", "by", "&", "services", "service", "charges", "fees", "fee", "month", "monthly", "day", "hour", "hours", "annual"]);

/** Lower-cased words with simple plural endings removed. */
export function hsnWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

function stem(w: string): string {
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

function scoreEntry(entry: HsnEntry, text: string, words: Set<string>): number {
  let score = 0;
  for (const kw of entry.keywords) {
    const parts = kw.split(/[\s-]+/).map(stem);
    if (parts.length > 1) {
      // A phrase counts only when it appears whole; longer phrases are stronger evidence.
      if (` ${text} `.includes(` ${kw} `) || parts.every((p) => words.has(p))) score = Math.max(score, 2 + parts.length);
    } else if (words.has(parts[0]!)) {
      score = Math.max(score, kw.length <= 3 ? 1.5 : 2);
    }
  }
  return score;
}

/**
 * Likely HSN/SAC codes for an item name, best first. Codes the org already
 * gave to items with similar names come first, since they reflect its own
 * (or its accountant's) choices.
 */
export function suggestHsn(
  name: string,
  opts: { kind?: HsnKind; history?: readonly { name: string; hsnSac: string | null }[]; limit?: number } = {},
): HsnSuggestion[] {
  const limit = opts.limit ?? 3;
  const words = new Set(hsnWords(name));
  if (words.size === 0) return [];
  const text = name.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
  const out = new Map<string, HsnSuggestion>();

  for (const h of opts.history ?? []) {
    if (!h.hsnSac) continue;
    const theirs = new Set(hsnWords(h.name));
    const shared = [...words].filter((w) => theirs.has(w)).length;
    if (shared === 0) continue;
    const score = 10 + shared / Math.max(words.size, theirs.size);
    const known = HSN_CATALOGUE.find((e) => e.code === h.hsnSac);
    const prev = out.get(h.hsnSac);
    if (!prev || prev.score < score) {
      out.set(h.hsnSac, {
        code: h.hsnSac,
        description: known ? known.description : `Used for "${h.name}"`,
        kind: known?.kind ?? (h.hsnSac.startsWith("99") ? "service" : "goods"),
        source: "history",
        score,
      });
    }
  }

  for (const entry of HSN_CATALOGUE) {
    let score = scoreEntry(entry, text, words);
    if (score === 0 || out.has(entry.code)) continue;
    if (opts.kind && entry.kind !== opts.kind) score -= 1.5;
    if (score <= 0) continue;
    out.set(entry.code, { code: entry.code, description: entry.description, kind: entry.kind, source: "catalogue", score });
  }

  return [...out.values()]
    .sort((a, b) => b.score - a.score || b.code.length - a.code.length)
    .slice(0, limit);
}

/** The single code to fill in automatically, or null when the name doesn't point clearly to one. */
export function autoHsn(...args: Parameters<typeof suggestHsn>): HsnSuggestion | null {
  const [best, next] = suggestHsn(args[0], { ...args[1], limit: 2 });
  if (!best) return null;
  if (best.source === "history") return best;
  // Two different codes scoring the same means we're guessing.
  if (next && next.score === best.score) return best.score >= 3 ? best : null;
  return best.score >= 1.5 ? best : null;
}
