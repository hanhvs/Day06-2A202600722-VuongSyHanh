import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { z } from "zod";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const FORCE_MOCK_MODE = String(process.env.FORCE_MOCK_MODE || "false").toLowerCase() === "true";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 12000);
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("."));

const IntentEnum = z.enum([
  "general_vna_question",
  "baggage_policy_question",
  "checkin_question",
  "flight_document_question",
  "ticket_payment_issue",
  "baggage_addon_payment_issue",
  "unclear_payment_issue",
  "seat_selection_issue",
  "date_change_request",
  "refund_request",
  "other_addon_issue",
  "travel_place_recommendation"
]);

const RiskEnum = z.enum(["Low", "Medium", "High"]);

const KnownInfoSchema = z.object({
  bookingCode: z.string().nullable().default(null),
  route: z.string().nullable().default(null),
  purchaseChannel: z.string().nullable().default(null),
  paymentDeducted: z.boolean().default(false),
  paymentTime: z.string().nullable().default(null),
  transactionCode: z.string().nullable().default(null),
  emailStatus: z.string().nullable().default(null),
  baggageKg: z.string().nullable().default(null),
  errorMessage: z.string().nullable().default(null),
  errorScreenshot: z.boolean().default(false)
});

const IssueSchema = z.object({
  intent: IntentEnum,
  label: z.string(),
  confidence: z.enum(["Low", "Medium", "High"]).default("Medium"),
  evidence: z.string().default("")
});

const TravelSuggestionSchema = z.object({
  name: z.string(),
  city: z.string().nullable().default(null),
  category: z.string().default("điểm đến"),
  reason: z.string(),
  bestFor: z.string().default("tham quan nhẹ nhàng"),
  caution: z.string().default("Kiểm tra giờ mở cửa, phí và điều kiện thực tế trước khi đi.")
});

const TriageResponseSchema = z.object({
  source: z.enum(["llm", "fallback_mock"]).default("fallback_mock"),
  detectedIssues: z.array(IssueSchema).default([]),
  selectedIntent: IntentEnum.nullable().default(null),
  needsIntentSelection: z.boolean().default(false),
  riskLevel: RiskEnum.default("Low"),
  knownInfo: KnownInfoSchema.default({}),
  missingInfo: z.array(z.string()).default([]),
  riskSignals: z.array(z.string()).default([]),
  nextQuestions: z.array(z.string()).default([]),
  actionChecklist: z.array(z.string()).default([]),
  travelSuggestions: z.array(TravelSuggestionSchema).default([]),
  customerAnswer: z.string().default(""),
  handoffSummary: z.string().default(""),
  shouldHandoff: z.boolean().default(false),
  safetyNotice: z.string().default("Prototype demo, không xác nhận giao dịch thật và không truy cập dữ liệu booking nội bộ.")
});

const TriageRequestSchema = z.object({
  message: z.string().min(1),
  conversationState: z.object({
    selectedIntent: IntentEnum.nullable().optional(),
    knownInfo: KnownInfoSchema.partial().optional(),
    detectedIssues: z.array(IssueSchema).optional()
  }).passthrough().default({})
});

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

function uniqueByIntent(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    if (seen.has(issue.intent)) return false;
    seen.add(issue.intent);
    return true;
  });
}

function detectTravelCity(message) {
  const text = normalizeText(message);
  const cityAliases = [
    { city: "Đà Nẵng", patterns: [/da nang/, /danang/, /dad\b/] },
    { city: "Hà Nội", patterns: [/ha noi/, /hanoi/, /\bhan\b/] },
    { city: "Hội An", patterns: [/hoi an/] },
    { city: "TP.HCM", patterns: [/tp\.?hcm/, /ho chi minh/, /sai gon/, /saigon/, /\bsgn\b/] },
    { city: "Nha Trang", patterns: [/nha trang/] },
    { city: "Huế", patterns: [/\bhue\b/] },
    { city: "Phú Quốc", patterns: [/phu quoc/] }
  ];

  return cityAliases.find(({ patterns }) => patterns.some((pattern) => pattern.test(text)))?.city || null;
}

function buildTravelSuggestions(message) {
  const city = detectTravelCity(message);
  const suggestionMap = {
    "Đà Nẵng": [
      {
        name: "Bãi biển Mỹ Khê",
        city: "Đà Nẵng",
        category: "biển",
        reason: "Phù hợp để đi dạo, tắm biển nhẹ và ngắm bình minh/hoàng hôn nếu bạn có ít thời gian.",
        bestFor: "nghỉ ngơi sau chuyến bay"
      },
      {
        name: "Bán đảo Sơn Trà",
        city: "Đà Nẵng",
        category: "thiên nhiên",
        reason: "Có cảnh biển, điểm ngắm thành phố và không khí thoáng, hợp với lịch trình nửa ngày.",
        bestFor: "ngắm cảnh và chụp ảnh"
      },
      {
        name: "Chợ Cồn",
        city: "Đà Nẵng",
        category: "ăn uống",
        reason: "Dễ thử nhiều món địa phương trong một điểm, phù hợp khi bạn muốn ăn nhẹ và khám phá nhanh.",
        bestFor: "ẩm thực địa phương"
      },
      {
        name: "Cầu Rồng và bờ sông Hàn",
        city: "Đà Nẵng",
        category: "đi dạo",
        reason: "Khu vực trung tâm, dễ di chuyển, hợp để kết thúc buổi tối sau khi ăn uống.",
        bestFor: "đi chơi buổi tối"
      }
    ],
    "Hà Nội": [
      {
        name: "Hồ Hoàn Kiếm",
        city: "Hà Nội",
        category: "đi dạo",
        reason: "Trung tâm, dễ đi bộ và kết hợp phố cổ nếu bạn chỉ có vài giờ rảnh.",
        bestFor: "lịch trình ngắn"
      },
      {
        name: "Văn Miếu - Quốc Tử Giám",
        city: "Hà Nội",
        category: "văn hóa",
        reason: "Không gian yên tĩnh, phù hợp nếu bạn muốn điểm tham quan có chiều sâu văn hóa.",
        bestFor: "tham quan văn hóa"
      },
      {
        name: "Phố cổ Hà Nội",
        city: "Hà Nội",
        category: "ăn uống",
        reason: "Có nhiều món địa phương và tuyến đi bộ linh hoạt theo thời gian của bạn.",
        bestFor: "ẩm thực và dạo phố"
      },
      {
        name: "Hồ Tây",
        city: "Hà Nội",
        category: "thư giãn",
        reason: "Hợp để ngồi cà phê, ngắm cảnh và di chuyển nhẹ nhàng sau chuyến bay.",
        bestFor: "nghỉ ngơi"
      }
    ],
    "Hội An": [
      {
        name: "Phố cổ Hội An",
        city: "Hội An",
        category: "văn hóa",
        reason: "Dễ đi bộ, nhiều góc chụp và phù hợp cho một buổi chiều/tối nhẹ nhàng.",
        bestFor: "tham quan và chụp ảnh"
      },
      {
        name: "Sông Hoài",
        city: "Hội An",
        category: "đi dạo",
        reason: "Không khí buổi tối đẹp, hợp để đi dạo sau bữa ăn.",
        bestFor: "buổi tối"
      },
      {
        name: "Làng rau Trà Quế",
        city: "Hội An",
        category: "trải nghiệm",
        reason: "Phù hợp nếu bạn muốn hoạt động nhẹ ngoài phố cổ.",
        bestFor: "gia đình hoặc nhóm nhỏ"
      }
    ],
    "TP.HCM": [
      {
        name: "Dinh Độc Lập",
        city: "TP.HCM",
        category: "lịch sử",
        reason: "Điểm tham quan trung tâm, dễ kết hợp với các địa điểm gần đó.",
        bestFor: "tham quan nửa ngày"
      },
      {
        name: "Bưu điện Thành phố và Nhà thờ Đức Bà",
        city: "TP.HCM",
        category: "kiến trúc",
        reason: "Hai điểm gần nhau, thuận tiện nếu bạn muốn đi bộ nhẹ và chụp ảnh.",
        bestFor: "lịch trình ngắn"
      },
      {
        name: "Chợ Bến Thành",
        city: "TP.HCM",
        category: "ăn uống/mua sắm",
        reason: "Dễ thử đồ ăn và mua quà, nhưng nên hỏi giá trước khi mua.",
        bestFor: "ẩm thực nhanh"
      },
      {
        name: "Phố đi bộ Nguyễn Huệ",
        city: "TP.HCM",
        category: "đi dạo",
        reason: "Phù hợp buổi tối, gần nhiều quán cà phê và khu trung tâm.",
        bestFor: "đi chơi tối"
      }
    ],
    "Nha Trang": [
      {
        name: "Bãi biển Nha Trang",
        city: "Nha Trang",
        category: "biển",
        reason: "Dễ tiếp cận, phù hợp để thư giãn nếu bạn có lịch trình ngắn.",
        bestFor: "nghỉ ngơi"
      },
      {
        name: "Tháp Bà Ponagar",
        city: "Nha Trang",
        category: "văn hóa",
        reason: "Điểm tham quan đặc trưng, không mất quá nhiều thời gian.",
        bestFor: "tham quan văn hóa"
      }
    ],
    "Huế": [
      {
        name: "Đại Nội Huế",
        city: "Huế",
        category: "di sản",
        reason: "Điểm chính để hiểu lịch sử và kiến trúc Huế.",
        bestFor: "tham quan văn hóa"
      },
      {
        name: "Sông Hương",
        city: "Huế",
        category: "thư giãn",
        reason: "Phù hợp đi dạo nhẹ hoặc ngắm cảnh khi có ít thời gian.",
        bestFor: "buổi chiều/tối"
      }
    ],
    "Phú Quốc": [
      {
        name: "Bãi Sao",
        city: "Phú Quốc",
        category: "biển",
        reason: "Hợp với lịch trình nghỉ dưỡng và tắm biển.",
        bestFor: "thư giãn"
      },
      {
        name: "Chợ đêm Phú Quốc",
        city: "Phú Quốc",
        category: "ăn uống",
        reason: "Dễ thử hải sản và đi dạo buổi tối.",
        bestFor: "ăn uống buổi tối"
      }
    ]
  };

  const genericSuggestions = [
    {
      name: "Khu trung tâm thành phố",
      city,
      category: "đi dạo",
      reason: "Thường dễ di chuyển và có nhiều lựa chọn ăn uống nếu bạn chưa chốt lịch trình.",
      bestFor: "lịch trình ngắn"
    },
    {
      name: "Một điểm văn hóa hoặc bảo tàng gần nơi lưu trú",
      city,
      category: "văn hóa",
      reason: "Giúp chuyến đi có điểm nhấn mà không cần di chuyển quá xa.",
      bestFor: "tham quan nhẹ"
    },
    {
      name: "Khu ẩm thực địa phương",
      city,
      category: "ăn uống",
      reason: "Phù hợp khi bạn muốn trải nghiệm nhanh sau chuyến bay.",
      bestFor: "ăn nhẹ"
    }
  ];

  return {
    city,
    suggestions: city && suggestionMap[city] ? suggestionMap[city] : genericSuggestions
  };
}

function mergeKnownInfo(message, state = {}) {
  const text = normalizeText(message);
  const prior = state.knownInfo || {};
  const knownInfo = KnownInfoSchema.parse({ ...prior });

  if (/(tien da tru|tien bi tru|bi tru tien|tai khoan.*tru|da thanh toan|thanh toan roi|payment deducted)/.test(text)) {
    knownInfo.paymentDeducted = true;
  }
  if (/(chua nhan email|chua co email|khong thay email|email xac nhan)/.test(text)) {
    knownInfo.emailStatus = "chưa nhận email xác nhận";
  }
  if (/(app bao loi|bao loi|loi thanh toan|khong thanh cong|failed|error)/.test(text)) {
    knownInfo.errorMessage = "user báo app/thanh toán lỗi";
  }
  if (/(anh loi|screenshot|hinh loi|chup man hinh)/.test(text)) {
    knownInfo.errorScreenshot = true;
  }
  if (/(website|web vietnam airlines)/.test(text)) knownInfo.purchaseChannel = "website";
  if (/(ung dung|app)/.test(text)) knownInfo.purchaseChannel = "app";
  if (/(dai ly|agent)/.test(text)) knownInfo.purchaseChannel = "đại lý";

  const kgMatch = message.match(/(\d{1,2})\s?(kg|ký|ki)/i);
  if (kgMatch) knownInfo.baggageKg = `${kgMatch[1]}kg`;

  const routeMatch = message.match(/([A-ZÀ-Ỵa-zà-ỵ\s]{2,24})\s*[-–]\s*([A-ZÀ-Ỵa-zà-ỵ\s]{2,24})/);
  if (routeMatch) knownInfo.route = `${routeMatch[1].trim()} - ${routeMatch[2].trim()}`;

  const travelCity = detectTravelCity(message);
  if (travelCity && /(di choi|choi gi|tham quan|du lich|goi y|dia diem|an uong|lich trinh|places|attractions|where to go|layla)/.test(text)) {
    knownInfo.route = travelCity;
  }

  const bookingMatch = message.match(/\b([A-Z0-9]{6})\b/i);
  if (bookingMatch && !/(HAN|SGN|DAD|TOKYO|HANOI)/i.test(bookingMatch[1])) {
    knownInfo.bookingCode = bookingMatch[1].toUpperCase();
  }

  return knownInfo;
}

function mergeKnownInfoValues(base = {}, override = {}) {
  const merged = { ...base };
  Object.entries(override || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    if (typeof value === "boolean") {
      merged[key] = Boolean(merged[key] || value);
      return;
    }
    merged[key] = value;
  });
  return merged;
}

function detectIssues(message) {
  const text = normalizeText(message);
  const issues = [];
  const hasPaymentOrError = /(app bao loi|bao loi|loi thanh toan|tien da tru|tien bi tru|bi tru tien|da thanh toan|chua xac nhan|chua nhan)/.test(text);

  if (/(check.?in|lam thu tuc|thu tuc truc tuyen|online checkin)/.test(text)) {
    issues.push({
      intent: "checkin_question",
      label: "Hỏi về check-in hoặc làm thủ tục bay",
      confidence: "High",
      evidence: "User nhắc check-in/làm thủ tục"
    });
  }

  if (/(giay to|ho chieu|passport|visa|cccd|can cuoc|tre em|em be)/.test(text)) {
    issues.push({
      intent: "flight_document_question",
      label: "Hỏi về giấy tờ hoặc điều kiện đi máy bay",
      confidence: "High",
      evidence: "User nhắc giấy tờ/visa/hộ chiếu/trẻ em"
    });
  }

  if (/(doi ngay|doi ve|doi lich|khuyen mai|fare|ngay bay)/.test(text)) {
    issues.push({
      intent: "date_change_request",
      label: "Đổi ngày vé hoặc điều kiện vé",
      confidence: "Medium",
      evidence: "User nhắc đổi ngày/vé khuyến mãi"
    });
  }

  if (/(chua nhan ve|chua co ve|chua nhan email|email xac nhan|ve.*thanh toan|thanh toan.*ve|dat ve)/.test(text)) {
    issues.push({
      intent: "ticket_payment_issue",
      label: "Đã thanh toán nhưng chưa nhận vé/email",
      confidence: "High",
      evidence: "User nhắc vé, email xác nhận hoặc thanh toán vé"
    });
  }

  if (/(hanh ly|baggage|kg|mua them)/.test(text) && hasPaymentOrError) {
    issues.push({
      intent: "baggage_addon_payment_issue",
      label: "Hành lý mua thêm bị lỗi hoặc cần chuẩn bị thông tin",
      confidence: "High",
      evidence: "User nhắc hành lý mua thêm"
    });
  }

  if (/(hanh ly|baggage|kg|vali|xach tay|ky gui)/.test(text) && !hasPaymentOrError) {
    issues.push({
      intent: "baggage_policy_question",
      label: "Hỏi về quy định hành lý",
      confidence: "High",
      evidence: "User hỏi về hành lý nhưng không báo lỗi giao dịch"
    });
  }

  if (/(chon ghe|ghe cua so|seat)/.test(text)) {
    issues.push({
      intent: "seat_selection_issue",
      label: "Chọn ghế hoặc dịch vụ chỗ ngồi",
      confidence: "Medium",
      evidence: "User nhắc chọn ghế"
    });
  }

  if (/(hoan tien|refund|tra tien)/.test(text)) {
    issues.push({
      intent: "refund_request",
      label: "Hoàn tiền",
      confidence: "Medium",
      evidence: "User nhắc hoàn tiền"
    });
  }

  if (/(di choi|choi gi|tham quan|du lich|goi y.*noi|goi y.*di|dia diem|noi nao|an uong|lich trinh|places|attractions|where to go|layla)/.test(text)) {
    issues.push({
      intent: "travel_place_recommendation",
      label: "Gợi ý nơi đi chơi",
      confidence: "High",
      evidence: "User hỏi gợi ý địa điểm/ăn uống/lịch trình nhẹ"
    });
  }

  if (
    issues.length === 0 &&
    /(app bao loi|bao loi|loi thanh toan|tien da tru|tien bi tru|bi tru tien|da thanh toan)/.test(text)
  ) {
    issues.push({
      intent: "unclear_payment_issue",
      label: "Lỗi thanh toán chưa rõ thuộc vé hay hành lý",
      confidence: "Low",
      evidence: "User nói app lỗi/tiền bị trừ nhưng chưa nói rõ dịch vụ"
    });
  }

  if (issues.length === 0) {
    issues.push({
      intent: "general_vna_question",
      label: "Câu hỏi chung về Vietnam Airlines",
      confidence: "Medium",
      evidence: "Fallback nhận diện là câu hỏi chung"
    });
  }

  return uniqueByIntent(issues);
}

function chooseSelectedIntent(message, issues, state = {}) {
  const text = normalizeText(message);
  const prior = state.selectedIntent || null;

  if (/(khong phai ve|khong phai ticket|dang noi ve hanh ly|la hanh ly)/.test(text)) {
    return "baggage_addon_payment_issue";
  }
  if (/(khong phai hanh ly|dang noi ve ve|la ve)/.test(text)) {
    return "ticket_payment_issue";
  }
  if (issues.some((issue) => issue.intent === "travel_place_recommendation") && /(di choi|choi gi|tham quan|du lich|goi y|dia diem|an uong|lich trinh|places|attractions|where to go|layla)/.test(text)) {
    return issues.length === 1 ? "travel_place_recommendation" : null;
  }
  if (/(xu ly ve|chon ve|issue ve|van de ve)/.test(text)) return "ticket_payment_issue";
  if (/(xu ly hanh ly|chon hanh ly|issue hanh ly|van de hanh ly)/.test(text)) return "baggage_addon_payment_issue";
  if (prior && !/(khong phai|doi sang|dang noi ve)/.test(text)) return prior;
  if (issues.length === 1) return issues[0].intent;
  return null;
}

function missingInfoFor(intent, knownInfo, riskLevel) {
  if (intent === "baggage_policy_question") {
    return [
      ["route", "Hành trình bay"],
      ["ticketClass", "Hạng vé hoặc loại vé nếu có"],
      ["baggageKg", "Số kg/kích thước hành lý bạn muốn kiểm tra"]
    ]
      .filter(([key]) => key === "ticketClass" || !knownInfo[key])
      .map(([, label]) => label);
  }

  if (intent === "checkin_question") {
    return ["Hành trình bay", "Bạn muốn check-in online hay tại sân bay?", "Bạn bay nội địa hay quốc tế?"];
  }

  if (intent === "flight_document_question") {
    return ["Hành trình bay", "Quốc tịch/độ tuổi hành khách nếu liên quan", "Bạn bay nội địa hay quốc tế?"];
  }

  if (intent === "general_vna_question") {
    return ["Thông tin cụ thể hơn về chuyến bay hoặc dịch vụ bạn đang hỏi"];
  }

  if (intent === "travel_place_recommendation") {
    const missing = [];
    if (!knownInfo.route) missing.push("Thành phố hoặc điểm đến bạn muốn khám phá");
    missing.push("Bạn có bao nhiêu thời gian rảnh?");
    missing.push("Sở thích chính: biển, ăn uống, văn hóa, gia đình hay đi dạo nhẹ?");
    return missing;
  }

  if (intent === "ticket_payment_issue") {
    return [
      ["bookingCode", "Mã đặt chỗ hoặc mã giao dịch"],
      ["purchaseChannel", "Kênh đặt vé: app, website hay đại lý"],
      ["paymentTime", "Thời điểm thanh toán gần đúng"],
      ["emailStatus", "Trạng thái email xác nhận"]
    ]
      .filter(([key]) => !knownInfo[key])
      .map(([, label]) => label);
  }

  if (intent === "baggage_addon_payment_issue") {
    const fields = [
      ["bookingCode", "Mã đặt chỗ"],
      ["purchaseChannel", "Kênh mua hành lý: app, website hay đại lý"],
      ["paymentTime", "Thời điểm thanh toán"],
      ["baggageKg", "Số kg hành lý mua thêm"],
      ["errorMessage", "Nội dung lỗi app/web hiển thị"]
    ];
    if (riskLevel === "High") fields.push(["errorScreenshot", "Ảnh chụp màn hình lỗi"]);
    return fields.filter(([key]) => !knownInfo[key]).map(([, label]) => label);
  }

  if (intent === "unclear_payment_issue") {
    return ["Loại giao dịch bị lỗi: vé, hành lý mua thêm, chọn ghế hay dịch vụ khác"];
  }

  return ["Chọn một vấn đề thuộc vé hoặc hành lý mua thêm để prototype xử lý sâu"];
}

function nextQuestionsFor(intent, missingInfo) {
  if (intent === "unclear_payment_issue") {
    return [
      "Lỗi này thuộc vé đã thanh toán, hành lý mua thêm, chọn ghế hay dịch vụ khác?",
      "Bạn có bị trừ tiền chưa?"
    ];
  }
  if (intent === "travel_place_recommendation") {
    return missingInfo.slice(0, 3).map((item) => `Bạn cho mình biết ${item.toLowerCase()} nhé?`);
  }
  return missingInfo.slice(0, 4).map((item) => `Bạn cho mình biết ${item.toLowerCase()} được không?`);
}

function checklistFor(intent, riskLevel, knownInfo) {
  if (intent === "baggage_policy_question") {
    return [
      "Cho NEO biết hành trình bay, hạng vé và loại hành lý bạn muốn kiểm tra.",
      "Không tự kết luận theo một con số chung nếu thiếu hành trình hoặc hạng vé.",
      "Kiểm tra lại thông tin chính thức trên website/app Vietnam Airlines trước khi ra sân bay."
    ];
  }

  if (intent === "checkin_question") {
    return [
      "Xác định bạn muốn làm thủ tục online hay tại sân bay.",
      "Chuẩn bị mã đặt chỗ/thông tin vé và giấy tờ bay phù hợp.",
      "Kiểm tra thời gian mở check-in chính thức trên website/app Vietnam Airlines."
    ];
  }

  if (intent === "flight_document_question") {
    return [
      "Xác định hành trình nội địa hay quốc tế.",
      "Chuẩn bị giấy tờ tùy thân/hộ chiếu/visa theo hành trình.",
      "Kiểm tra lại yêu cầu giấy tờ chính thức trước ngày bay."
    ];
  }

  if (intent === "general_vna_question") {
    return [
      "NEO có thể trả lời câu hỏi chung, nhưng sẽ hỏi thêm nếu thiếu dữ liệu quan trọng.",
      "Với thông tin có thể thay đổi như phí, giờ, điều kiện vé, nên kiểm tra lại nguồn chính thức.",
      "Nếu câu hỏi liên quan tiền/vé/dịch vụ chưa xác nhận, NEO sẽ chuyển sang luồng hỗ trợ an toàn hơn."
    ];
  }

  if (intent === "travel_place_recommendation") {
    return [
      "Chọn 3-5 gợi ý phù hợp với thành phố, thời gian rảnh và sở thích của bạn.",
      "Ưu tiên điểm dễ di chuyển nếu bạn đang nối chuyến hoặc vừa đáp chuyến bay.",
      "Kiểm tra giờ mở cửa, thời tiết, phí và thời gian di chuyển trước khi đi.",
      "NEO chỉ gợi ý tham khảo; không đặt vé, khách sạn, nhà hàng hoặc dịch vụ thật."
    ];
  }

  if (intent === "ticket_payment_issue") {
    return [
      "Chưa kết luận vé đã hợp lệ cho tới khi hệ thống đặt chỗ chính thức xác nhận.",
      "Kiểm tra email xác nhận từ Vietnam Airlines, gồm cả spam/promotions.",
      "Mở mục Quản lý đặt chỗ trên website/app để kiểm tra trạng thái booking.",
      "Chuẩn bị mã đặt chỗ/mã giao dịch, kênh đặt vé và thời điểm thanh toán.",
      riskLevel === "High"
        ? "Nếu tiền đã trừ nhưng vẫn chưa có vé/email xác nhận, nên chuyển nhân viên hỗ trợ kiểm tra."
        : "Nếu chỉ đang hỏi chuẩn bị thông tin, lưu checklist này trước khi liên hệ support."
    ];
  }

  if (intent === "baggage_addon_payment_issue") {
    return [
      "Chưa xác nhận hành lý mua thêm đã thành công nếu hệ thống đặt chỗ chính thức chưa cập nhật.",
      "Kiểm tra lại mục Quản lý đặt chỗ để xem dịch vụ hành lý đã được cập nhật chưa.",
      "Chuẩn bị mã đặt chỗ, kênh mua, thời điểm thanh toán, số kg hành lý và ảnh lỗi nếu có.",
      knownInfo.paymentDeducted
        ? "Vì tiền đã bị trừ, nên chuyển nhân viên hỗ trợ nếu chưa thấy hành lý được cập nhật."
        : "Nếu chưa thanh toán hoặc chỉ chuẩn bị mua, dùng checklist này để tránh thiếu thông tin."
    ];
  }

  if (intent === "unclear_payment_issue") {
    return [
      "Không đoán ngay lỗi thuộc vé hay hành lý.",
      "Hỏi user chọn một nhóm vấn đề trước.",
      "Giữ tín hiệu tiền đã trừ trong context để khi user chọn vấn đề, risk vẫn là High."
    ];
  }

  return ["Intent này nằm ngoài Core MVP; chỉ nhận diện và đưa về vé/hành lý nếu user muốn xử lý sâu."];
}

function customerAnswerFor(intent, knownInfo, riskLevel) {
  if (intent === "baggage_policy_question") {
    return "Mình có thể giúp bạn kiểm tra thông tin hành lý. Quy định hành lý có thể thay đổi theo hành trình, hạng vé và loại vé, nên mình cần thêm một vài thông tin trước khi kết luận.";
  }
  if (intent === "checkin_question") {
    return "Mình có thể hướng dẫn bạn về check-in. Thời gian và điều kiện làm thủ tục có thể khác nhau giữa chuyến bay nội địa/quốc tế và kênh online/sân bay.";
  }
  if (intent === "flight_document_question") {
    return "Mình có thể giúp bạn chuẩn bị giấy tờ bay. Yêu cầu giấy tờ phụ thuộc vào hành trình nội địa/quốc tế, quốc tịch và độ tuổi hành khách.";
  }
  if (intent === "general_vna_question") {
    return "Mình có thể trả lời câu hỏi chung về Vietnam Airlines. Nếu câu hỏi cần thông tin cụ thể như hành trình, hạng vé hoặc trạng thái booking, mình sẽ hỏi thêm để tránh trả lời sai.";
  }
  if (intent === "travel_place_recommendation") {
    return "Mình có thể gợi ý vài nơi đi chơi theo điểm đến và sở thích của bạn. Các gợi ý dưới đây mang tính tham khảo để bạn lên ý tưởng nhanh; giờ mở cửa, phí và điều kiện thực tế nên kiểm tra lại trước khi đi.";
  }
  if (intent === "ticket_payment_issue") {
    return "Mình hiểu bạn đang gặp vấn đề với vé hoặc xác nhận sau thanh toán. Vì liên quan đến vé/tiền, mình chưa thể kết luận giao dịch đã thành công nếu chưa có xác nhận từ hệ thống đặt chỗ.";
  }
  if (intent === "baggage_addon_payment_issue") {
    return "Mình hiểu bạn đang gặp vấn đề với hành lý mua thêm. Nếu tiền đã bị trừ hoặc dịch vụ chưa xác nhận, nhân viên nên kiểm tra lại trước khi kết luận giao dịch thành công.";
  }
  if (intent === "unclear_payment_issue") {
    return "Mình thấy bạn báo lỗi thanh toán nhưng chưa rõ lỗi thuộc vé, hành lý hay dịch vụ khác. Mình cần bạn chọn nhóm vấn đề trước để hỗ trợ đúng hơn.";
  }
  return "Mình đã nhận diện vấn đề bạn đang hỏi và sẽ gợi ý bước xử lý tiếp theo.";
}

function makeHandoffSummary(intent, knownInfo, missingInfo, riskLevel) {
  if (riskLevel !== "High") return "";
  const problem =
    intent === "ticket_payment_issue"
      ? "khách đã thanh toán vé nhưng chưa nhận vé/email xác nhận"
      : intent === "baggage_addon_payment_issue"
        ? "khách mua thêm hành lý nhưng giao dịch/dịch vụ chưa được xác nhận"
        : "khách báo lỗi thanh toán nhưng chưa rõ thuộc vé hay dịch vụ nào";

  return [
    `Tóm tắt cho nhân viên: ${problem}.`,
    `Trạng thái tiền: ${knownInfo.paymentDeducted ? "đã bị trừ/đã thanh toán" : "chưa xác định"}.`,
    `Mã đặt chỗ: ${knownInfo.bookingCode || "chưa có"}.`,
    `Kênh mua: ${knownInfo.purchaseChannel || "chưa có"}.`,
    `Thông tin còn thiếu: ${missingInfo.length ? missingInfo.join(", ") : "không còn thiếu thông tin chính trong demo"}.`,
    "Không xác nhận giao dịch thành công nếu chưa kiểm tra hệ thống booking."
  ].join(" ");
}

function applyRiskGuardrails(result, message, state = {}) {
  const text = normalizeText(message);
  const knownInfo = KnownInfoSchema.parse(result.knownInfo || {});
  const riskSignals = new Set(result.riskSignals || []);
  const deterministicIssues = detectIssues(message);
  const deterministicIntents = new Set(deterministicIssues.map((issue) => issue.intent));

  if (deterministicIntents.has("baggage_addon_payment_issue")) {
    result.selectedIntent = "baggage_addon_payment_issue";
  } else if (deterministicIntents.has("ticket_payment_issue") && result.selectedIntent === "general_vna_question") {
    result.selectedIntent = "ticket_payment_issue";
  } else if (deterministicIntents.has("travel_place_recommendation") && !knownInfo.paymentDeducted) {
    result.selectedIntent = deterministicIntents.size === 1 ? "travel_place_recommendation" : result.selectedIntent;
  }

  if (!result.detectedIssues?.length || result.source === "llm") {
    result.detectedIssues = uniqueByIntent([...(result.detectedIssues || []), ...deterministicIssues]);
  }

  if (
    knownInfo.paymentDeducted ||
    /(tien da tru|tien bi tru|bi tru tien|da thanh toan|chua nhan ve|chua nhan email|dich vu chua.*xac nhan|thanh toan loi)/.test(text)
  ) {
    knownInfo.paymentDeducted = knownInfo.paymentDeducted || /(tien da tru|tien bi tru|bi tru tien|da thanh toan)/.test(text);
    riskSignals.add("payment_or_ticket_high_risk");
    result.riskLevel = "High";
    result.shouldHandoff = true;
  }

  if (result.selectedIntent === "unclear_payment_issue" && knownInfo.paymentDeducted) {
    riskSignals.add("unclear_payment_deducted");
    result.riskLevel = "High";
    result.shouldHandoff = true;
  }

  result.knownInfo = knownInfo;
  result.riskSignals = [...riskSignals];

  if (result.selectedIntent) {
    result.missingInfo = missingInfoFor(result.selectedIntent, knownInfo, result.riskLevel);
    result.nextQuestions = nextQuestionsFor(result.selectedIntent, result.missingInfo);
    result.actionChecklist = checklistFor(result.selectedIntent, result.riskLevel, knownInfo);
    if (result.selectedIntent === "travel_place_recommendation") {
      const travelData = buildTravelSuggestions(message);
      result.travelSuggestions = result.travelSuggestions?.length ? result.travelSuggestions : travelData.suggestions;
    } else {
      result.travelSuggestions = [];
    }
    result.customerAnswer = result.customerAnswer || customerAnswerFor(result.selectedIntent, knownInfo, result.riskLevel);
    if (
      ["baggage_policy_question", "checkin_question", "flight_document_question", "date_change_request", "refund_request"].includes(result.selectedIntent) &&
      !/chính thức|official|website\/app/i.test(result.customerAnswer)
    ) {
      result.customerAnswer = `${result.customerAnswer} Bạn nên kiểm tra lại trên website/app chính thức của Vietnam Airlines vì quy định có thể thay đổi theo hành trình và loại vé.`;
    }
    result.handoffSummary = result.shouldHandoff
      ? makeHandoffSummary(result.selectedIntent, knownInfo, result.missingInfo, result.riskLevel)
      : "";
  }

  return result;
}

function fallbackTriage(message, conversationState = {}, fallbackReason = "LLM unavailable") {
  const knownInfo = mergeKnownInfo(message, conversationState);
  const issues = detectIssues(message);
  const selectedIntent = chooseSelectedIntent(message, issues, conversationState);
  const isMultiIntent = issues.length > 1 && !selectedIntent;
  const effectiveIntent = selectedIntent || (isMultiIntent ? null : issues[0]?.intent || "unclear_payment_issue");

  let riskLevel = knownInfo.paymentDeducted ? "High" : "Low";
  if (effectiveIntent === "unclear_payment_issue" && knownInfo.paymentDeducted) riskLevel = "High";
  if (effectiveIntent === "ticket_payment_issue" && (knownInfo.emailStatus || knownInfo.paymentDeducted)) riskLevel = "High";
  if (effectiveIntent === "baggage_addon_payment_issue" && (knownInfo.paymentDeducted || knownInfo.errorMessage)) {
    riskLevel = knownInfo.paymentDeducted ? "High" : "Medium";
  }

  if (isMultiIntent) {
    const result = {
      source: "fallback_mock",
      detectedIssues: issues,
      selectedIntent: null,
      needsIntentSelection: true,
      riskLevel: knownInfo.paymentDeducted ? "High" : "Medium",
      knownInfo,
      missingInfo: ["Chọn một vấn đề để xử lý trước"],
      riskSignals: knownInfo.paymentDeducted ? ["payment_or_ticket_high_risk", fallbackReason] : [fallbackReason],
      nextQuestions: ["Bạn muốn xử lý vấn đề nào trước: vé chưa nhận, hành lý mua thêm, đổi ngày hay chọn ghế?"],
      actionChecklist: [
        "Tách vấn đề thành từng issue để tránh trả lời policy dài.",
        "Ưu tiên xử lý issue liên quan tiền/vé trước vì rủi ro cao.",
        "Không xử lý tất cả cùng lúc trong demo MVP."
      ],
      travelSuggestions: [],
      customerAnswer: "Mình thấy bạn đang hỏi nhiều vấn đề trong một tin nhắn. Để hỗ trợ chính xác hơn, mình sẽ tách từng vấn đề và hỏi bạn muốn xử lý mục nào trước.",
      handoffSummary: knownInfo.paymentDeducted
        ? "User có nhiều vấn đề trong một câu và có tín hiệu tiền đã trừ. Cần chọn issue trước khi kiểm tra sâu."
        : "",
      shouldHandoff: knownInfo.paymentDeducted,
      safetyNotice: "Prototype không đổi vé, hoàn tiền, xác nhận booking hoặc cập nhật hành lý thật."
    };
    return TriageResponseSchema.parse(applyRiskGuardrails(result, message, conversationState));
  }

  const missingInfo = missingInfoFor(effectiveIntent, knownInfo, riskLevel);
  const shouldHandoff = riskLevel === "High";
  const result = {
    source: "fallback_mock",
    detectedIssues: issues.length
      ? issues
      : [{
          intent: "unclear_payment_issue",
          label: "Lỗi thanh toán chưa rõ thuộc vé hay hành lý",
          confidence: "Low",
          evidence: "Fallback không thấy intent rõ"
        }],
    selectedIntent: effectiveIntent,
    needsIntentSelection: effectiveIntent === "unclear_payment_issue",
    riskLevel,
    knownInfo,
    missingInfo,
    riskSignals: [fallbackReason],
    nextQuestions: nextQuestionsFor(effectiveIntent, missingInfo),
    actionChecklist: checklistFor(effectiveIntent, riskLevel, knownInfo),
    travelSuggestions: effectiveIntent === "travel_place_recommendation" ? buildTravelSuggestions(message).suggestions : [],
    customerAnswer: customerAnswerFor(effectiveIntent, knownInfo, riskLevel),
    handoffSummary: shouldHandoff ? makeHandoffSummary(effectiveIntent, knownInfo, missingInfo, riskLevel) : "",
    shouldHandoff,
    safetyNotice: "Prototype không truy cập dữ liệu nội bộ, không xác nhận booking/thanh toán thật và không yêu cầu nhập mã đặt chỗ thật."
  };

  return TriageResponseSchema.parse(applyRiskGuardrails(result, message, conversationState));
}

function buildSystemPrompt() {
  return `
You are an improved Vietnam Airlines NEO chatbot prototype.
Return only JSON matching this shape:
{
  "detectedIssues": [{"intent": "general_vna_question|baggage_policy_question|checkin_question|flight_document_question|ticket_payment_issue|baggage_addon_payment_issue|unclear_payment_issue|seat_selection_issue|date_change_request|refund_request|other_addon_issue|travel_place_recommendation", "label": "string", "confidence": "Low|Medium|High", "evidence": "string"}],
  "selectedIntent": "intent or null",
  "needsIntentSelection": boolean,
  "riskLevel": "Low|Medium|High",
  "knownInfo": {
    "bookingCode": "string|null",
    "route": "string|null",
    "purchaseChannel": "string|null",
    "paymentDeducted": boolean,
    "paymentTime": "string|null",
    "transactionCode": "string|null",
    "emailStatus": "string|null",
    "baggageKg": "string|null",
    "errorMessage": "string|null",
    "errorScreenshot": boolean
  },
  "missingInfo": ["string"],
  "riskSignals": ["string"],
  "nextQuestions": ["string"],
  "actionChecklist": ["string"],
  "travelSuggestions": [{"name": "string", "city": "string|null", "category": "string", "reason": "string", "bestFor": "string", "caution": "string"}],
  "customerAnswer": "friendly answer to the passenger in Vietnamese",
  "handoffSummary": "string",
  "shouldHandoff": boolean,
  "safetyNotice": "string"
}

Rules:
- Product is Vietnam Airlines NEO, Track B Travel & Hospitality.
- The chatbot can answer general Vietnam Airlines questions, but the improved slice is stronger handling for vague, multi-intent, and high-risk cases.
- For general airline questions, answer briefly in Vietnamese and ask for missing details if route/fare/time affects the answer.
- If the user asks for travel inspiration, places to visit, food areas, or a light itinerary at a destination, use intent travel_place_recommendation and return 3-5 travelSuggestions in Vietnamese.
- TravelSuggestions should be practical, friendly, and lightweight like a travel assistant, but do not claim live opening hours, prices, availability, distance, or map coordinates.
- Do not book hotels, restaurants, tours, attractions, flights, change ticket, refund, confirm ticket validity, or update baggage.
- If the user says money was deducted, payment completed, ticket/email missing, or service not confirmed, riskLevel must be High and shouldHandoff true.
- If user asks multiple issues, list detectedIssues and ask them to choose one first.
- If user corrects from ticket to baggage, keep paymentDeducted from conversationState.
- Ask concrete missing info, not generic questions.
- Do not expose internal field names like bookingCode or selectedIntent in customerAnswer.
- For policies that can change, say to verify on official Vietnam Airlines website/app.
`;
}

async function callOpenAI(message, conversationState) {
  if (FORCE_MOCK_MODE || !process.env.OPENAI_API_KEY) {
    throw new Error(FORCE_MOCK_MODE ? "FORCE_MOCK_MODE enabled" : "Missing OPENAI_API_KEY");
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    timeout: LLM_TIMEOUT_MS
  });

  const completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: JSON.stringify({ message, conversationState }) }
    ]
  });

  const content = completion.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");
  return JSON.parse(content);
}

function fillAndValidate(raw, message, conversationState, source) {
  const fallback = fallbackTriage(message, conversationState, "Schema defaults");
  const merged = {
    ...fallback,
    ...raw,
    source,
    knownInfo: mergeKnownInfoValues(fallback.knownInfo, raw?.knownInfo || {})
  };
  return TriageResponseSchema.parse(applyRiskGuardrails(merged, message, conversationState));
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    product: "Vietnam Airlines NEO AI Triage",
    endpoint: "/api/triage",
    forceMockMode: FORCE_MOCK_MODE,
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
    model: OPENAI_MODEL
  });
});

app.post("/api/triage", async (req, res) => {
  const parsed = TriageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Request must include message and valid conversationState." });
  }

  const { message, conversationState } = parsed.data;
  try {
    const raw = await callOpenAI(message, conversationState);
    const result = fillAndValidate(raw, message, conversationState, "llm");
    console.log(`[triage] source=llm intent=${result.selectedIntent || "selection"} risk=${result.riskLevel}`);
    res.json(result);
  } catch (error) {
    const result = fallbackTriage(message, conversationState, error?.message || "LLM unavailable");
    console.log(`[triage] source=fallback_mock intent=${result.selectedIntent || "selection"} risk=${result.riskLevel}`);
    res.json(result);
  }
});

app.listen(PORT, () => {
  console.log(`Vietnam Airlines NEO AI Triage running at http://localhost:${PORT}`);
});
