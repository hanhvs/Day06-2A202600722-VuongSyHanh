import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { z } from "zod";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const FORCE_MOCK_MODE = String(process.env.FORCE_MOCK_MODE || "false").toLowerCase() === "true";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 30000);
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(".", { extensions: ["html"] }));
app.use("/evidence", express.static("../02-group-spec/evidence"));

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
  "travel_place_recommendation",
  "flight_status_query"
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

const FlightResultSchema = z.object({
  flightNumber: z.string().nullable().default(null),
  airline: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  departureIata: z.string().nullable().default(null),
  departureAirport: z.string().nullable().default(null),
  departureScheduled: z.string().nullable().default(null),
  departureEstimated: z.string().nullable().default(null),
  arrivalIata: z.string().nullable().default(null),
  arrivalAirport: z.string().nullable().default(null),
  arrivalScheduled: z.string().nullable().default(null),
  arrivalEstimated: z.string().nullable().default(null),
  delayMinutes: z.number().nullable().default(null)
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
  flightResults: z.array(FlightResultSchema).default([]),
  customerAnswer: z.string().default(""),
  handoffSummary: z.string().default(""),
  shouldHandoff: z.boolean().default(false),
  safetyNotice: z.string().default("Prototype demo, không xác nhận giao dịch thật và không truy cập dữ liệu booking nội bộ.")
});

const MessageHistorySchema = z.array(
  z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string()
  })
).default([]);

const TriageRequestSchema = z.object({
  message: z.string().min(1),
  conversationState: z.object({
    selectedIntent: IntentEnum.nullable().optional(),
    knownInfo: KnownInfoSchema.partial().optional(),
    detectedIssues: z.array(IssueSchema).optional(),
    messageHistory: MessageHistorySchema.optional()
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
  if (
    bookingMatch &&
    !/(HAN|SGN|DAD|TOKYO|HANOI)/i.test(bookingMatch[1]) &&
    !FLIGHT_CODE_REGEX.test(bookingMatch[1])
  ) {
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

const FLIGHT_CODE_REGEX = /\b(vn|qh|vj|bl|0v|hvn)\s?\d{1,4}\b/i;

function extractFlightCode(message) {
  const match = String(message || "").match(FLIGHT_CODE_REGEX);
  if (!match) return null;
  return match[0].replace(/\s+/g, "").toUpperCase();
}

function detectIssues(message) {
  const text = normalizeText(message);
  const issues = [];
  const hasPaymentOrError = /(app bao loi|bao loi|loi thanh toan|tien da tru|tien bi tru|bi tru tien|da thanh toan|chua xac nhan|chua nhan)/.test(text);
  const flightCode = extractFlightCode(message);
  const hasFlightStatusKeyword = /(trang thai chuyen|tinh trang chuyen|tre chuyen|chuyen tre|delay chuyen|chuyen.*may gio|may gio.*bay|may gio.*den|may gio.*ha canh|da bay chua|da dap chua|da ha canh chua|track flight|flight status|chuyen.*den noi chua)/.test(text);
  const hasFlightSearchIntent = /(tim chuyen bay|tim ve\b|chuyen bay tu|chuyen tu .* (den|di)\b|flight from .* to\b)/.test(text);
  const iataCodes = text.match(/\b(han|sgn|dad|hph|cxr|hui|pqc|vca|dli|vcs|vii|thd)\b/g) || [];
  const hasIataPair = new Set(iataCodes).size >= 2;
  const cityWord = "(ha noi|sai gon|tp\\.?ho chi minh|tp\\.?hcm|tphcm|ho chi minh|da nang|hai phong|nha trang|hue|phu quoc|can tho|da lat|con dao|vinh|thanh hoa)";
  const hasCityPair = new RegExp(`${cityWord}.{0,25}\\b(di|den|to|-|–|>)\\b.{0,25}${cityWord}`).test(text);
  const mentionsFlightWord = /(chuyen bay|chuyen|flight|bay)/.test(text);

  if ((flightCode || hasFlightStatusKeyword || hasFlightSearchIntent || hasIataPair || (hasCityPair && mentionsFlightWord)) && !hasPaymentOrError) {
    issues.push({
      intent: "flight_status_query",
      label: flightCode
        ? `Tra cứu trạng thái chuyến ${flightCode}`
        : "Tra cứu trạng thái chuyến bay",
      confidence: "High",
      evidence: flightCode
        ? `User nhắc mã chuyến ${flightCode}`
        : "User hỏi về trạng thái/giờ đến/đi của chuyến bay"
    });
  }

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

  if (intent === "flight_status_query") {
    return [
      "Mã hiệu chuyến bay (ví dụ VN123, QH245)",
      "Ngày bay nếu khác hôm nay"
    ];
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

  if (intent === "flight_status_query") {
    return [
      "NEO tra dữ liệu chuyến bay realtime/lịch từ Aviationstack, cập nhật 30-60 giây.",
      "Nếu trạng thái khác app/website Vietnam Airlines, ưu tiên hệ thống đặt chỗ chính thức.",
      "Dữ liệu chuyến bay không xác nhận tình trạng vé, hành khách hay hành lý của bạn.",
      "Đến sân bay theo giờ check-in chính thức ngay cả khi chuyến bị báo trễ trên dữ liệu live."
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
  if (intent === "flight_status_query") {
    return "Mình có thể tra trạng thái chuyến bay realtime. Bạn cho mình mã hiệu chuyến (ví dụ VN123) và ngày bay (nếu khác hôm nay) để mình tra giúp nhé.";
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
  } else if (
    deterministicIntents.has("flight_status_query") &&
    !knownInfo.paymentDeducted &&
    (result.selectedIntent === "general_vna_question" || deterministicIntents.size === 1)
  ) {
    result.selectedIntent = "flight_status_query";
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
    if (result.selectedIntent !== "flight_status_query") {
      result.flightResults = [];
    } else if (Array.isArray(result.flightResults) && result.flightResults.length) {
      const seen = new Set();
      result.flightResults = result.flightResults
        .filter((f) => {
          const key = f?.flightNumber || JSON.stringify(f);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => {
          const ta = a?.departureScheduled || "";
          const tb = b?.departureScheduled || "";
          return ta.localeCompare(tb);
        });
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
Always return JSON matching this shape (intents enum below is exhaustive):
{
  "detectedIssues": [{"intent": "general_vna_question|baggage_policy_question|checkin_question|flight_document_question|ticket_payment_issue|baggage_addon_payment_issue|unclear_payment_issue|seat_selection_issue|date_change_request|refund_request|other_addon_issue|travel_place_recommendation|flight_status_query", "label": "string", "confidence": "Low|Medium|High", "evidence": "string"}],
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
  "flightResults": [{"flightNumber": "VN217", "airline": "Vietnam Airlines", "status": "scheduled|active|landed|cancelled|incident|diverted", "departureIata": "HAN", "departureAirport": "Noibai International", "departureScheduled": "17:00", "departureEstimated": "17:10", "arrivalIata": "SGN", "arrivalAirport": "Tan Son Nhat International", "arrivalScheduled": "19:10", "arrivalEstimated": null, "delayMinutes": 10}],
  "customerAnswer": "friendly answer to the passenger in Vietnamese",
  "handoffSummary": "string",
  "shouldHandoff": boolean,
  "safetyNotice": "string"
}

Tools available:
- search_flights — Aviationstack realtime/schedule lookup. CALL this tool whenever the user is asking about:
  • a specific flight code (e.g. "VN123 hôm nay sao rồi", "chuyến QH245"). → pass flight_iata.
  • a route between two airports/cities (e.g. "tìm chuyến HAN to SGN", "chuyến từ Hà Nội đi Đà Nẵng", "HAN-SGN tối nay"). → pass dep_iata + arr_iata. If user didn't mention a date, LEAVE flight_date blank (realtime endpoint returns today by default). Do NOT ask the user for a date first.
  • an airline + day (e.g. "Vietnam Airlines hôm nay có chuyến nào trễ"). → pass airline_iata. Vietnam Airlines airline_iata = "VN".
  Use intent flight_status_query for all of these.

  Vietnam airport IATA cheatsheet (use these directly without re-asking the user):
    HAN = Hà Nội (Nội Bài), SGN = TP.HCM / Sài Gòn (Tân Sơn Nhất), DAD = Đà Nẵng,
    HPH = Hải Phòng, CXR = Nha Trang / Cam Ranh, HUI = Huế, PQC = Phú Quốc,
    VCA = Cần Thơ, DLI = Đà Lạt, VCS = Côn Đảo, VII = Vinh, THD = Thanh Hóa.

  IMPORTANT — you DO have realtime flight data access via search_flights. NEVER tell the user "hiện tại tôi chưa thể truy cập dữ liệu chuyến bay thực tế", "tôi không có dữ liệu realtime", or similar. Always call the tool first. The "do not access internal data" rule applies to Vietnam Airlines booking/passenger/payment systems, NOT to public flight schedules.

  DO NOT call this tool for: baggage rules, check-in steps, document/visa, travel-place suggestions, payment/refund/ticket-issue triage, or general FAQ.

  After the tool returns:
  - If flights are returned, populate "flightResults" with EVERY flight from the tool result, up to 25. Include ALL airlines (Vietnam Airlines, VietJet, Bamboo, Vietravel, foreign carriers, …) — do NOT filter to Vietnam Airlines unless the user explicitly named an airline. The user wants the full comparison list.
  - Sort flightResults STRICTLY by departureScheduled ascending (earliest first). Double-check the sort.
  - Dedupe by flightNumber (codeshares often appear twice — keep the first).
  - Keep "customerAnswer" SHORT — ONE sentence. If pagination.total > flightResults.length, mention both: "Có X chuyến HAN → SGN hôm nay (hiển thị Y gần nhất), sắp xếp theo giờ khởi hành." Otherwise "Có X chuyến HAN → SGN hôm nay, sắp xếp theo giờ khởi hành.". Do NOT list any flight numbers/times in customerAnswer; the UI renders cards from flightResults.
  - Map tool result → flightResults fields: flight.iata → flightNumber, airline.name → airline, flight_status → status (keep enum value), departure.iata → departureIata, departure.airport → departureAirport, departure.scheduled → departureScheduled (FORMAT as "HH:mm" 24-hour from the ISO string), departure.estimated → departureEstimated (same HH:mm format, null if same as scheduled or null in source), departure.delay → delayMinutes (integer minutes; null if source is null). Same shape for arrival.
  - If zero flights, leave flightResults empty and say so in customerAnswer; ask user to verify flight number/airline/route.
  - If error code "function_access_restricted", explain in customerAnswer that the free Aviationstack plan only supports realtime (today's) flights, and ask if user wants to check a different flight today instead.
  - If other error, say so in customerAnswer honestly and ask user to try again later.
  - You may call the tool at most twice per turn.

Conversation history:
- Prior user/assistant turns are provided as separate role messages before this user turn. The "message" field in the user JSON is ONLY the latest user message.
- Treat short follow-up replies (just a city name, "có"/"không", a flight code, a date, "tối nay", …) as CONTINUATIONS of the most recent unresolved question — do NOT restart from scratch.
- Example: if you just asked "bạn muốn biết thời tiết ở thành phố nào?" and user replies "Hà Nội", you are still in a weather conversation, NOT a travel_place_recommendation conversation.
- The "conversationState" inside user JSON only carries selectedIntent / knownInfo / detectedIssues from the previous turn (not text). Combine with the role messages above to reconstruct context.

Out of scope (NEO does NOT have tools/data for these):
- Weather forecast (today / tomorrow / hourly).
- Hotel / restaurant / tour booking and availability.
- Currency exchange, prices, fares (NEO does not know ticket price).
- Visa rules of foreign countries (only general guidance about flight documents).
- Realtime traffic, road conditions.
When user asks any of these, answer briefly in Vietnamese: nói thẳng NEO không có dữ liệu đó, gợi ý nguồn ngoài phù hợp (app dự báo thời tiết, agoda/booking, website ngân hàng, đại sứ quán…). Use intent general_vna_question. DO NOT fall back to travel_place_recommendation as catch-all. DO NOT generate travelSuggestions for these.

Rules:
- Product is Vietnam Airlines NEO, Track B Travel & Hospitality.
- The chatbot can answer general Vietnam Airlines questions, but the improved slice is stronger handling for vague, multi-intent, high-risk, and flight-status cases.
- For general airline questions, answer briefly in Vietnamese and ask for missing details if route/fare/time affects the answer.
- If the user asks for travel inspiration, places to visit, food areas, or a light itinerary at a destination, use intent travel_place_recommendation and return 3-5 travelSuggestions in Vietnamese.
- TravelSuggestions should be practical, friendly, and lightweight, but do not claim live opening hours, prices, availability, distance, or map coordinates.
- Do not book hotels, restaurants, tours, attractions, flights, change ticket, refund, confirm ticket validity, or update baggage.
- If the user says money was deducted, payment completed, ticket/email missing, or service not confirmed, riskLevel must be High and shouldHandoff true.
- flight_status_query is informational only; do NOT mark it High risk unless combined with a payment/ticket issue.
- If user asks multiple issues, list detectedIssues and ask them to choose one first.
- If user corrects from ticket to baggage, keep paymentDeducted from conversationState.
- Ask concrete missing info, not generic questions.
- Do not expose internal field names like bookingCode or selectedIntent in customerAnswer.
- For policies that can change, say to verify on official Vietnam Airlines website/app.
`;
}

const MAX_TOOL_ITERATIONS = 3;
const TOOL_RESULT_MAX_CHARS = 20000;

function nowInVietnamISO() {
  const offsetMs = 7 * 3600 * 1000;
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 10);
}

const TOOLS = {
  search_flights: {
    schema: {
      type: "function",
      function: {
        name: "search_flights",
        description:
          "Tra realtime/lịch chuyến bay qua Aviationstack. " +
          "GỌI ngay khi user hỏi: (a) một mã chuyến cụ thể như VN123, " +
          "(b) một tuyến hai sân bay (HAN-SGN, Hà Nội đi Đà Nẵng), " +
          "(c) một hãng + ngày cụ thể. " +
          "flight_date: CHỈ truyền khi user nói ngày khác hôm nay (vd 'ngày mai', '10/6'). " +
          "Cho câu hỏi về hôm nay hoặc không nói ngày, BỎ TRỐNG flight_date (endpoint realtime tự trả chuyến hôm nay; gói free chỉ hỗ trợ realtime, không hỗ trợ flight_date). " +
          "Đây là cách DUY NHẤT để biết dữ liệu chuyến bay thật — đừng nói 'tôi không có dữ liệu realtime' mà phải gọi tool. " +
          "KHÔNG gọi cho: quy định hành lý, check-in, giấy tờ, đặt/hoàn vé, " +
          "vấn đề thanh toán, hay gợi ý du lịch.",
        parameters: {
          type: "object",
          properties: {
            flight_iata: {
              type: "string",
              description: "Mã hiệu IATA chuyến bay (vd 'VN123', 'QH245'). Ưu tiên nếu user cho mã."
            },
            flight_date: {
              type: "string",
              description: "Ngày bay YYYY-MM-DD. 'Hôm nay' theo giờ VN dùng currentDateVN trong user payload."
            },
            dep_iata: { type: "string", description: "IATA 3 ký tự sân bay đi (HAN, SGN, DAD, ...)." },
            arr_iata: { type: "string", description: "IATA 3 ký tự sân bay đến." },
            airline_iata: { type: "string", description: "IATA 2 ký tự hãng. Vietnam Airlines = VN." },
            flight_status: {
              type: "string",
              enum: ["scheduled", "active", "landed", "cancelled", "incident", "diverted"]
            },
            limit: { type: "integer", minimum: 5, maximum: 30, default: 25, description: "Lấy đủ để user so sánh. Mặc định 25." }
          },
          required: []
        }
      }
    },
    async execute(args) {
      const parsed = FlightsQuerySchema.safeParse(args || {});
      if (!parsed.success) {
        return { error: "Tham số tool không hợp lệ", details: parsed.error.flatten() };
      }
      return await callAviationstack(parsed.data);
    },
    stageLabelForCall(args = {}) {
      if (args.flight_iata) return `Đang tra Aviationstack — chuyến ${args.flight_iata}`;
      if (args.dep_iata && args.arr_iata) return `Đang tra Aviationstack — ${args.dep_iata} → ${args.arr_iata}`;
      return "Đang tra Aviationstack — danh sách chuyến bay";
    },
    stageLabelForResult(result) {
      if (result?.error) return `Aviationstack lỗi: ${result.error}`;
      return `Aviationstack trả ${result?.flights?.length || 0} chuyến`;
    }
  }
};

async function callOpenAI(message, conversationState, onEvent) {
  if (FORCE_MOCK_MODE || !process.env.OPENAI_API_KEY) {
    throw new Error(FORCE_MOCK_MODE ? "FORCE_MOCK_MODE enabled" : "Missing OPENAI_API_KEY");
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    timeout: LLM_TIMEOUT_MS
  });

  const rawHistory = Array.isArray(conversationState?.messageHistory) ? conversationState.messageHistory : [];
  const history = rawHistory.slice(-10).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 2000)
  }));

  const stateForLLM = {
    selectedIntent: conversationState?.selectedIntent ?? null,
    knownInfo: conversationState?.knownInfo ?? {},
    detectedIssues: conversationState?.detectedIssues ?? []
  };

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...history,
    {
      role: "user",
      content: JSON.stringify({
        message,
        conversationState: stateForLLM,
        currentDateVN: nowInVietnamISO()
      })
    }
  ];
  const toolSchemas = Object.values(TOOLS).map((tool) => tool.schema);

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.2,
      tools: toolSchemas,
      tool_choice: "auto",
      messages
    });
    const msg = completion.choices?.[0]?.message;
    if (!msg) throw new Error("OpenAI returned empty choice");
    messages.push(msg);

    const toolCalls = msg.tool_calls || [];
    if (toolCalls.length === 0) {
      console.log(`[llm] iter=${iter} no tool_calls -> final JSON`);
      if (!msg.content) throw new Error("OpenAI returned no content and no tool calls");
      return JSON.parse(msg.content);
    }

    console.log(`[llm] iter=${iter} tool_calls=${toolCalls.map((c) => c.function?.name).join(",")}`);

    for (const call of toolCalls) {
      const name = call.function?.name;
      const tool = TOOLS[name];
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = {};
      }
      onEvent?.({ type: "stage", label: tool?.stageLabelForCall?.(args) || `Đang gọi tool ${name}` });

      const result = tool
        ? await tool.execute(args)
        : { error: `Tool không tồn tại: ${name}` };

      onEvent?.({ type: "stage", label: tool?.stageLabelForResult?.(result) || `Tool ${name} hoàn tất` });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, TOOL_RESULT_MAX_CHARS)
      });
    }
  }

  throw new Error(`OpenAI tool loop vượt ${MAX_TOOL_ITERATIONS} vòng — có thể model bị kẹt`);
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
    hasAviationstackKey: Boolean(process.env.AVIATIONSTACK_API_KEY),
    model: OPENAI_MODEL
  });
});

const FlightStatusEnum = z.enum([
  "scheduled",
  "active",
  "landed",
  "cancelled",
  "incident",
  "diverted"
]);

const FlightsQuerySchema = z.object({
  dep_iata: z.string().trim().length(3).optional(),
  arr_iata: z.string().trim().length(3).optional(),
  dep_icao: z.string().trim().length(4).optional(),
  arr_icao: z.string().trim().length(4).optional(),
  flight_iata: z.string().trim().min(2).max(10).optional(),
  flight_icao: z.string().trim().min(3).max(10).optional(),
  flight_number: z.string().trim().min(1).max(5).optional(),
  airline_iata: z.string().trim().length(2).optional(),
  airline_icao: z.string().trim().length(3).optional(),
  flight_status: FlightStatusEnum.optional(),
  flight_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "flight_date phải YYYY-MM-DD").optional(),
  min_delay_dep: z.coerce.number().int().min(0).optional(),
  max_delay_dep: z.coerce.number().int().min(0).optional(),
  min_delay_arr: z.coerce.number().int().min(0).optional(),
  max_delay_arr: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0)
});

function normalizeEndpoint(node) {
  if (!node) return null;
  return {
    airport: node.airport ?? null,
    iata: node.iata ?? null,
    icao: node.icao ?? null,
    terminal: node.terminal ?? null,
    gate: node.gate ?? null,
    timezone: node.timezone ?? null,
    scheduledAt: node.scheduled ?? null,
    estimatedAt: node.estimated ?? null,
    actualAt: node.actual ?? null,
    delayMinutes: node.delay ?? null
  };
}

function normalizeFlight(row) {
  if (!row || typeof row !== "object") return null;
  return {
    flightDate: row.flight_date ?? null,
    status: row.flight_status ?? null,
    airline: row.airline
      ? {
          name: row.airline.name ?? null,
          iata: row.airline.iata ?? null,
          icao: row.airline.icao ?? null
        }
      : null,
    flight: row.flight
      ? {
          number: row.flight.number ?? null,
          iata: row.flight.iata ?? null,
          icao: row.flight.icao ?? null,
          codeshared: row.flight.codeshared ?? null
        }
      : null,
    departure: normalizeEndpoint(row.departure),
    arrival: normalizeEndpoint(row.arrival),
    aircraft: row.aircraft
      ? {
          registration: row.aircraft.registration ?? null,
          iata: row.aircraft.iata ?? null,
          icao: row.aircraft.icao ?? null,
          icao24: row.aircraft.icao24 ?? null
        }
      : null,
    live: row.live
      ? {
          updatedAt: row.live.updated ?? null,
          latitude: row.live.latitude ?? null,
          longitude: row.live.longitude ?? null,
          altitude: row.live.altitude ?? null,
          directionDeg: row.live.direction ?? null,
          speedHorizontalKmh: row.live.speed_horizontal ?? null,
          speedVerticalKmh: row.live.speed_vertical ?? null,
          isOnGround: Boolean(row.live.is_ground)
        }
      : null
  };
}

async function callAviationstack(query) {
  const apiKey = process.env.AVIATIONSTACK_API_KEY;
  if (!apiKey) {
    return {
      error: "AVIATIONSTACK_API_KEY chưa được set trong .env",
      code: "missing_key",
      hint: "Đăng ký free key tại https://aviationstack.com rồi gán vào .env"
    };
  }

  const baseUrl = process.env.AVIATIONSTACK_BASE_URL || "https://api.aviationstack.com/v1";
  const timeoutMs = Number(process.env.AVIATIONSTACK_TIMEOUT_MS || 15000);

  const todayVN = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const effectiveQuery = { ...(query || {}) };
  if (effectiveQuery.flight_date === todayVN) {
    delete effectiveQuery.flight_date;
  }

  const params = new URLSearchParams({ access_key: apiKey });
  for (const [key, value] of Object.entries(effectiveQuery)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }

  const summary = Object.entries(effectiveQuery)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`[aviationstack] -> ${baseUrl}/flights ${summary || "(no filters)"}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const upstream = await fetch(`${baseUrl}/flights?${params.toString()}`, {
      signal: controller.signal
    });
    const body = await upstream.json().catch(() => null);
    const elapsedMs = Date.now() - startedAt;

    if (!upstream.ok || body?.error) {
      console.log(`[aviationstack] <- ${upstream.status} ${body?.error?.code || ""} ${elapsedMs}ms`);
      return {
        error: body?.error?.message || `Aviationstack trả ${upstream.status}`,
        code: body?.error?.code || null,
        status: upstream.status,
        details: body?.error?.context || null
      };
    }

    const rows = Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.results)
        ? body.results
        : [];

    console.log(`[aviationstack] <- ${upstream.status} count=${rows.length} total=${body?.pagination?.total ?? "?"} ${elapsedMs}ms`);

    return {
      pagination: body?.pagination || null,
      flights: rows.map(normalizeFlight).filter(Boolean)
    };
  } catch (err) {
    console.log(`[aviationstack] <- error: ${err?.message}`);
    return {
      error: err?.name === "AbortError"
        ? `Aviationstack timeout sau ${timeoutMs}ms`
        : err?.message || "Aviationstack call failed",
      code: err?.name === "AbortError" ? "timeout" : "fetch_failed"
    };
  } finally {
    clearTimeout(timer);
  }
}

function statusForAviationstackResult(result) {
  if (!result.error) return 200;
  if (result.code === "missing_key") return 503;
  if (result.code === "invalid_access_key" || result.code === "missing_access_key" || result.code === "inactive_user") return 401;
  if (result.code === "rate_limit_reached" || result.code === "usage_limit_reached") return 429;
  if (result.code === "function_access_restricted" || result.code === "invalid_api_function") return 403;
  if (result.code === "timeout") return 504;
  if (typeof result.status === "number" && result.status >= 400 && result.status < 600) return result.status;
  return 502;
}

app.get("/api/flights", async (req, res) => {
  const parsed = FlightsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Tham số không hợp lệ",
      details: parsed.error.flatten()
    });
  }

  const result = await callAviationstack(parsed.data);
  if (result.error) {
    return res.status(statusForAviationstackResult(result)).json(result);
  }

  console.log(`[flights] count=${result.flights.length} dep=${parsed.data.dep_iata || "-"} arr=${parsed.data.arr_iata || "-"} flight=${parsed.data.flight_iata || "-"}`);
  res.json(result);
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
    console.error("[triage] LLM path threw:", error?.message);
    if (error?.issues) console.error("[triage] zod issues:", JSON.stringify(error.issues, null, 2));
    const result = fallbackTriage(message, conversationState, error?.message || "LLM unavailable");
    console.log(`[triage] source=fallback_mock intent=${result.selectedIntent || "selection"} risk=${result.riskLevel}`);
    res.json(result);
  }
});

app.post("/api/triage/stream", async (req, res) => {
  const parsed = TriageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Request must include message and valid conversationState." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const { message, conversationState } = parsed.data;

  try {
    send({ type: "stage", label: "Đang đọc tin nhắn của bạn" });
    await pause(200);

    const previewIssues = detectIssues(message);
    const intentLabel = previewIssues.length === 1
      ? `1 vấn đề: ${previewIssues[0].label}`
      : `${previewIssues.length} vấn đề có thể liên quan`;
    send({ type: "stage", label: `Đang phân loại — ${intentLabel}` });
    await pause(260);

    const previewKnown = mergeKnownInfo(message, conversationState);
    const knownCount = Object.values(previewKnown).filter((v) => v !== null && v !== false && v !== "").length;
    send({
      type: "stage",
      label: knownCount
        ? `Đang trích ${knownCount} thông tin có sẵn từ hội thoại`
        : "Đang trích thông tin có sẵn từ hội thoại"
    });
    await pause(220);

    let result;
    if (FORCE_MOCK_MODE || !process.env.OPENAI_API_KEY) {
      send({ type: "stage", label: "Đang dùng dữ liệu demo (fallback mock)" });
      await pause(220);
      result = fallbackTriage(
        message,
        conversationState,
        FORCE_MOCK_MODE ? "FORCE_MOCK_MODE enabled" : "Missing OPENAI_API_KEY"
      );
    } else {
      send({ type: "stage", label: `Đang hỏi AI (${OPENAI_MODEL})` });
      try {
        const raw = await callOpenAI(message, conversationState, send);
        send({ type: "stage", label: "Đang ghép câu trả lời AI với guardrails" });
        await pause(180);
        result = fillAndValidate(raw, message, conversationState, "llm");
      } catch (err) {
        send({ type: "stage", label: "AI không phản hồi — chuyển sang dữ liệu demo" });
        await pause(220);
        result = fallbackTriage(message, conversationState, err?.message || "LLM unavailable");
      }
    }

    send({ type: "stage", label: `Đang kiểm tra rủi ro (mức ${result.riskLevel})` });
    await pause(220);

    console.log(`[triage-stream] source=${result.source} intent=${result.selectedIntent || "selection"} risk=${result.riskLevel}`);
    send({ type: "done", result });
  } catch (err) {
    console.error("[triage-stream] error:", err);
    try { send({ type: "error", message: err?.message || "Server lỗi" }); } catch {}
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Vietnam Airlines NEO AI Triage running at http://localhost:${PORT}`);
});
