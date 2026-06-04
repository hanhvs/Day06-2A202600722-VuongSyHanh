const defaultKnownInfo = {
  bookingCode: null,
  route: null,
  purchaseChannel: null,
  paymentDeducted: false,
  paymentTime: null,
  transactionCode: null,
  emailStatus: null,
  baggageKg: null,
  errorMessage: null,
  errorScreenshot: false
};

const defaultState = {
  selectedIntent: null,
  detectedIssues: [],
  knownInfo: structuredClone(defaultKnownInfo)
};

let conversationState = structuredClone(defaultState);
let lastResponse = null;

const testMessages = {
  happy: "Hành lý xách tay của Vietnam Airlines được mang bao nhiêu kg?",
  low: "App báo lỗi, tiền bị trừ rồi.",
  failure: "Tôi mua thêm hành lý nhưng app báo lỗi, tiền đã trừ.",
  correction: "Không phải vé, tôi đang nói về hành lý mua thêm.",
  travel: "Tôi có một ngày ở Đà Nẵng, gợi ý vài nơi đi chơi và ăn uống nhẹ nhàng.",
  multi: `Tôi bay Hà Nội - Tokyo, vé mua khuyến mãi có đổi ngày được không?
Tôi đã thanh toán nhưng chưa nhận vé.
Tôi mua thêm hành lý nhưng app báo lỗi, tiền đã trừ.`
};

const intentLabels = {
  general_vna_question: "Câu hỏi chung về Vietnam Airlines",
  baggage_policy_question: "Quy định hành lý",
  checkin_question: "Check-in và làm thủ tục",
  flight_document_question: "Giấy tờ bay",
  ticket_payment_issue: "Vé đã thanh toán nhưng chưa xác nhận",
  baggage_addon_payment_issue: "Hành lý mua thêm",
  unclear_payment_issue: "Lỗi thanh toán chưa rõ loại dịch vụ",
  seat_selection_issue: "Chọn ghế",
  date_change_request: "Đổi ngày vé",
  refund_request: "Hoàn tiền",
  other_addon_issue: "Dịch vụ cộng thêm khác",
  travel_place_recommendation: "Gợi ý nơi đi chơi"
};

const knownInfoLabels = {
  bookingCode: "Mã đặt chỗ",
  route: "Hành trình / điểm đến",
  purchaseChannel: "Kênh mua",
  paymentDeducted: "Tiền đã trừ",
  paymentTime: "Thời điểm thanh toán",
  transactionCode: "Mã giao dịch",
  emailStatus: "Email xác nhận",
  baggageKg: "Số kg hành lý",
  errorMessage: "Lỗi hiển thị",
  errorScreenshot: "Ảnh lỗi"
};

const customerFieldLabels = {
  bookingCode: "Mã đặt chỗ",
  route: "Hành trình / điểm đến",
  purchaseChannel: "Kênh mua: app, website hay đại lý",
  paymentDeducted: "Trạng thái tiền đã bị trừ",
  paymentTime: "Thời điểm thanh toán",
  transactionCode: "Mã giao dịch",
  emailStatus: "Email xác nhận",
  baggageKg: "Số kg hành lý mua thêm",
  errorMessage: "Nội dung lỗi hiển thị trên app/web",
  errorScreenshot: "Ảnh chụp màn hình lỗi"
};

const triageForm = document.querySelector("#triageForm");
const messageInput = document.querySelector("#messageInput");
const submitButton = document.querySelector("#submitButton");
const resetButton = document.querySelector("#resetButton");
const copyButton = document.querySelector("#copyButton");
const chatMessages = document.querySelector("#chatMessages");

const welcomeMessage = `
  <article class="message assistant">
    <div class="avatar">NEO</div>
    <div class="bubble">
      <p>Chào bạn, mình là NEO phiên bản cải tiến. Bạn có thể hỏi về vé, hành lý, check-in hoặc các vấn đề sau thanh toán.</p>
      <p class="bubble-note">Mình cũng có thể gợi ý vài nơi đi chơi theo điểm đến của bạn. Với giao dịch thật như vé, thanh toán hoặc hành lý, mình sẽ không kết luận khi chưa có xác nhận chính thức.</p>
    </div>
  </article>
`;

function displayValue(value) {
  if (typeof value === "boolean") return value ? "Có" : "Chưa có";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Chưa có";
  return value || "Chưa có";
}

function badgeClassForRisk(risk) {
  if (risk === "High") return "high";
  if (risk === "Medium") return "medium";
  if (risk === "Low") return "low";
  return "neutral";
}

function riskLabel(risk) {
  if (risk === "High") return "Cần hỗ trợ ngay";
  if (risk === "Medium") return "Cần kiểm tra thêm";
  if (risk === "Low") return "Thông thường";
  return "-";
}

function sourceLabel(source) {
  if (source === "llm") return "AI đang hỗ trợ";
  if (source === "fallback_mock") return "Dữ liệu demo";
  return "-";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function scrollChatToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function resetChat() {
  chatMessages.innerHTML = welcomeMessage;
  scrollChatToBottom();
}

function appendUserMessage(message) {
  const article = document.createElement("article");
  article.className = "message user";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = message;
  article.append(bubble);
  chatMessages.append(article);
  scrollChatToBottom();
}

function appendAssistantMessage(html) {
  const article = document.createElement("article");
  article.className = "message assistant";
  article.innerHTML = `
    <div class="avatar">NEO</div>
    <div class="bubble">${html}</div>
  `;
  chatMessages.append(article);
  scrollChatToBottom();
}

function appendTypingIndicator() {
  const article = document.createElement("article");
  article.className = "message assistant typing";
  article.innerHTML = `
    <div class="avatar">NEO</div>
    <div class="bubble typing-bubble" aria-live="polite">
      <span class="typing-dots"><span></span><span></span><span></span></span>
      <span class="typing-label">Đang chuẩn bị…</span>
    </div>
  `;
  chatMessages.append(article);
  scrollChatToBottom();
  return article;
}

function setTypingLabel(typingEl, label) {
  const labelEl = typingEl?.querySelector(".typing-label");
  if (labelEl) labelEl.textContent = label;
  scrollChatToBottom();
}

async function streamTriage(message, typingEl) {
  const response = await fetch("/api/triage/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    },
    body: JSON.stringify({ message, conversationState })
  });
  if (!response.ok || !response.body) {
    throw new Error(`Server lỗi (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;
  let streamError = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separator;
    while ((separator = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      let event;
      try {
        event = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }
      if (event.type === "stage") {
        setTypingLabel(typingEl, event.label);
      } else if (event.type === "done") {
        finalResult = event.result;
      } else if (event.type === "error") {
        streamError = new Error(event.message || "Server lỗi");
      }
    }
  }

  if (streamError) throw streamError;
  if (!finalResult) throw new Error("Stream kết thúc nhưng chưa có kết quả.");
  return finalResult;
}

function renderMiniList(items, maxItems = 4) {
  const visibleItems = (items || []).slice(0, maxItems);
  if (!visibleItems.length) return "";
  return `<ul>${visibleItems.map((item) => `<li>${escapeHtml(humanizeText(item))}</li>`).join("")}</ul>`;
}

const flightStatusBadges = {
  scheduled: { label: "Đúng lịch", className: "ok" },
  active: { label: "Đang bay", className: "ok" },
  landed: { label: "Đã hạ cánh", className: "ok" },
  cancelled: { label: "Đã huỷ", className: "warn" },
  incident: { label: "Sự cố", className: "warn" },
  diverted: { label: "Đổi hướng", className: "warn" }
};

function formatTimeCell(scheduled, estimated, delayMinutes) {
  const sched = scheduled ? escapeHtml(scheduled) : "—";
  const hasDelay = typeof delayMinutes === "number" && delayMinutes > 0;
  const showEstimated = estimated && estimated !== scheduled;
  if (hasDelay || showEstimated) {
    const est = estimated ? escapeHtml(estimated) : sched;
    const delayLabel = hasDelay ? ` (+${delayMinutes}ph)` : "";
    return `<span class="leg-sched">${sched}</span><span class="leg-est">→ ${est}${delayLabel}</span>`;
  }
  return `<span class="leg-sched">${sched}</span>`;
}

function renderFlightCards(flights = []) {
  if (!flights.length) return "";
  return `
    <p class="flight-list-header">${flights.length} chuyến tìm được · sắp xếp theo giờ khởi hành</p>
    <div class="flight-suggestions" aria-label="Chuyến bay tìm được">
      ${flights
        .map((flight) => {
          const number = flight.flightNumber ? escapeHtml(flight.flightNumber) : "—";
          const airline = flight.airline ? escapeHtml(flight.airline) : "";
          const dep = flight.departureIata ? escapeHtml(flight.departureIata) : "—";
          const arr = flight.arrivalIata ? escapeHtml(flight.arrivalIata) : "—";
          const depAirport = flight.departureAirport ? escapeHtml(flight.departureAirport) : "";
          const arrAirport = flight.arrivalAirport ? escapeHtml(flight.arrivalAirport) : "";
          const depTime = formatTimeCell(flight.departureScheduled, flight.departureEstimated, flight.delayMinutes);
          const arrTime = formatTimeCell(flight.arrivalScheduled, flight.arrivalEstimated, null);
          const badge = flightStatusBadges[flight.status] || { label: flight.status || "—", className: "neutral" };
          return `
            <article class="flight-card">
              <header class="flight-card-top">
                <strong>${number}</strong>
                <span class="flight-badge ${badge.className}">${escapeHtml(badge.label)}</span>
              </header>
              ${airline ? `<small class="flight-airline">${airline}</small>` : ""}
              <div class="flight-row">
                <div class="flight-leg">
                  <span class="leg-iata">${dep}</span>
                  <span class="leg-airport">${depAirport}</span>
                  <span class="leg-times">${depTime}</span>
                </div>
                <span class="leg-arrow" aria-hidden="true">→</span>
                <div class="flight-leg">
                  <span class="leg-iata">${arr}</span>
                  <span class="leg-airport">${arrAirport}</span>
                  <span class="leg-times">${arrTime}</span>
                </div>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderTravelSuggestionCards(suggestions = []) {
  if (!suggestions.length) return "";
  return `
    <div class="travel-suggestions" aria-label="Gợi ý nơi đi chơi">
      ${suggestions
        .slice(0, 5)
        .map((item) => {
          const mapQuery = encodeURIComponent(`${item.name || ""} ${item.city || ""}`.trim());
          return `
          <article class="travel-card">
            <div class="travel-card-top">
              <strong>${escapeHtml(item.name)}</strong>
              <span>${escapeHtml(item.category || "điểm đến")}</span>
            </div>
            <p>${escapeHtml(item.reason)}</p>
            <small>${escapeHtml(item.bestFor || "tham quan nhẹ nhàng")}</small>
            ${item.caution ? `<em>${escapeHtml(item.caution)}</em>` : ""}
            <a class="map-link" href="https://www.google.com/maps/search/?api=1&query=${mapQuery}" target="_blank" rel="noreferrer">Xem trên bản đồ</a>
          </article>
        `;
        })
        .join("")}
    </div>
  `;
}

function humanizeText(value) {
  return customerFieldLabels[value] || value;
}

function buildAssistantReply(response) {
  if (response.needsIntentSelection) {
    const issueList = (response.detectedIssues || [])
      .map((issue) => `<li>${escapeHtml(issue.label || intentLabels[issue.intent] || "Một vấn đề cần xử lý")}</li>`)
      .join("");
    return `
      <p>Mình thấy bạn đang nhắc đến nhiều vấn đề cùng lúc.</p>
      ${issueList ? `<ol>${issueList}</ol>` : ""}
      <p>Để tránh trả lời dài và sai trọng tâm, bạn muốn mình xử lý vấn đề nào trước?</p>
      <p class="bubble-note">Nếu có tiền bị trừ hoặc chưa nhận xác nhận, nhân viên nên kiểm tra lại trước khi kết luận giao dịch đã thành công.</p>
    `;
  }

  const selectedLabel = response.selectedIntent
    ? intentLabels[response.selectedIntent] || "vấn đề bạn vừa nêu"
    : "vấn đề bạn vừa nêu";

  const answer = response.customerAnswer
    ? `<p>${escapeHtml(response.customerAnswer)}</p>`
    : response.shouldHandoff
      ? `<p>Mình hiểu vấn đề của bạn là <strong>${escapeHtml(selectedLabel)}</strong>. Vì tình huống này liên quan đến tiền, vé hoặc dịch vụ chưa được xác nhận, mình chưa thể kết luận giao dịch đã thành công.</p>`
      : `<p>Mình hiểu câu hỏi của bạn thuộc nhóm <strong>${escapeHtml(selectedLabel)}</strong>. Mình sẽ hướng dẫn ngắn gọn và hỏi thêm nếu cần.</p>`;

  const hasFlightResults = Boolean(response.flightResults?.length);
  const flightResults = hasFlightResults
    ? renderFlightCards(response.flightResults)
    : "";

  const missing = response.missingInfo?.length && !hasFlightResults
    ? `<p>Để kiểm tra nhanh hơn, bạn nên chuẩn bị:</p>${renderMiniList(response.missingInfo, 5)}`
    : "";

  const travelSuggestions = response.travelSuggestions?.length
    ? `<p>Một vài gợi ý bạn có thể cân nhắc:</p>${renderTravelSuggestionCards(response.travelSuggestions)}`
    : "";

  const checklist = response.actionChecklist?.length
    ? `<p>Các bước nên làm tiếp theo:</p>${renderMiniList(response.actionChecklist, 4)}`
    : "";

  const isSupportCase = ["ticket_payment_issue", "baggage_addon_payment_issue", "unclear_payment_issue"].includes(response.selectedIntent);

  const staff = response.shouldHandoff
    ? `<p>Nếu bạn liên hệ nhân viên hỗ trợ, mình đã chuẩn bị sẵn tóm tắt ở khung bên phải để bạn copy.</p>`
    : isSupportCase
      ? `<p>Hiện tại bạn có thể tự kiểm tra trước. Nếu vẫn chưa thấy thông tin cập nhật, hãy chuyển nhân viên hỗ trợ.</p>`
      : response.selectedIntent === "travel_place_recommendation"
        ? `<p>Bạn có thể hỏi tiếp theo kiểu “mình thích biển”, “mình đi cùng gia đình” hoặc “chỉ có buổi tối” để NEO lọc gợi ý sát hơn.</p>`
      : `<p>Bạn có thể hỏi tiếp bằng ngôn ngữ tự nhiên, hoặc bổ sung hành trình/hạng vé để NEO trả lời sát hơn.</p>`;

  return `
    ${answer}
    ${flightResults}
    ${travelSuggestions}
    ${missing}
    ${checklist}
    ${staff}
  `;
}

function seedCorrectionDemoState() {
  conversationState = {
    selectedIntent: "ticket_payment_issue",
    detectedIssues: [
      {
        intent: "ticket_payment_issue",
        label: "Đã thanh toán nhưng chưa nhận vé/email",
        confidence: "High",
        evidence: "Context demo trước đó"
      }
    ],
    knownInfo: {
      ...structuredClone(defaultKnownInfo),
      paymentDeducted: true,
      emailStatus: "chưa nhận email xác nhận"
    }
  };
  renderState();
}

function renderState() {
  const statePreview = document.querySelector("#statePreview");
  statePreview.innerHTML = "";

  const items = {
    "Vấn đề đang xử lý": conversationState.selectedIntent
      ? intentLabels[conversationState.selectedIntent] || conversationState.selectedIntent
      : null,
    "Tiền đã trừ": conversationState.knownInfo.paymentDeducted,
    "Mã đặt chỗ": conversationState.knownInfo.bookingCode,
    "Kênh mua": conversationState.knownInfo.purchaseChannel,
    "Số kg hành lý": conversationState.knownInfo.baggageKg
  };

  Object.entries(items).forEach(([label, value]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = displayValue(value);
    statePreview.append(dt, dd);
  });
}

function renderList(selector, items, emptyText = "Chưa có.") {
  const list = document.querySelector(selector);
  list.innerHTML = "";

  if (!items || items.length === 0) {
    const item = document.createElement("li");
    item.textContent = emptyText;
    list.append(item);
    return;
  }

  items.forEach((value) => {
    const item = document.createElement("li");
    item.textContent = humanizeText(value);
    list.append(item);
  });
}

function renderChecklist(items) {
  const list = document.querySelector("#actionChecklist");
  list.innerHTML = "";
  if (!items || items.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Chưa có bước xử lý.";
    list.append(item);
    return;
  }
  items.forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  });
}

function renderKnownInfo(knownInfo = {}) {
  const container = document.querySelector("#knownInfo");
  container.innerHTML = "";

  const entries = Object.entries(knownInfoLabels).filter(([key]) => {
    const value = knownInfo[key];
    return typeof value === "boolean" ? value : Boolean(value);
  });

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-text";
    empty.textContent = "Chưa có thông tin nào được trích xuất.";
    container.append(empty);
    return;
  }

  entries.forEach(([key, label]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = displayValue(knownInfo[key]);
    if (key === "paymentDeducted" && knownInfo[key]) dd.className = "danger-text";
    container.append(dt, dd);
  });
}

function renderIssues(response) {
  const container = document.querySelector("#detectedIssues");
  container.innerHTML = "";

  if (!response.detectedIssues || response.detectedIssues.length === 0) {
    const empty = document.createElement("p");
    empty.className = "summary-copy";
    empty.textContent = "Chưa có vấn đề nào được nhận diện.";
    container.append(empty);
    return;
  }

  response.detectedIssues.forEach((issue, index) => {
    const issueLabel = intentLabels[issue.intent] || issue.label || "Một vấn đề cần xử lý";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `issue-card ${response.selectedIntent === issue.intent ? "active" : ""}`;
    button.innerHTML = `
      <span class="issue-index">${index + 1}</span>
      <span class="issue-main">
        <strong>${issueLabel}</strong>
        <small>${response.selectedIntent === issue.intent ? "Đang xử lý mục này" : "Có thể chọn để xử lý trước"}</small>
      </span>
    `;
    button.addEventListener("click", () => {
      conversationState.selectedIntent = issue.intent;
      messageInput.value = `Xử lý ${issueLabel}`;
      runTriage(messageInput.value);
    });
    container.append(button);
  });
}

function updateState(response) {
  conversationState = {
    selectedIntent: response.selectedIntent || conversationState.selectedIntent,
    detectedIssues: response.detectedIssues || conversationState.detectedIssues,
    knownInfo: {
      ...conversationState.knownInfo,
      ...(response.knownInfo || {})
    }
  };
}

function renderResponse(response) {
  lastResponse = response;
  updateState(response);
  appendAssistantMessage(buildAssistantReply(response));

  const selectedLabel = response.selectedIntent
    ? intentLabels[response.selectedIntent] || response.selectedIntent
    : response.needsIntentSelection
      ? "Bạn muốn xử lý vấn đề nào trước?"
      : "NEO chưa rõ vấn đề";

  document.querySelector("#intentTitle").textContent = selectedLabel;
  document.querySelector("#resultSummary").textContent = response.needsIntentSelection
    ? "Bạn đang nêu nhiều vấn đề cùng lúc. Hãy chọn một vấn đề để NEO hướng dẫn chính xác hơn."
    : response.selectedIntent === "travel_place_recommendation"
      ? "NEO đang gợi ý nơi đi chơi theo điểm đến và sở thích. Các gợi ý chỉ để tham khảo, bạn nên kiểm tra lại giờ mở cửa, phí và điều kiện thực tế trước khi đi."
    : response.shouldHandoff
      ? "Tình huống này liên quan đến tiền, vé hoặc dịch vụ chưa xác nhận. NEO sẽ giúp chuẩn bị thông tin để nhân viên kiểm tra nhanh hơn."
      : "Tình huống này có thể bắt đầu bằng các bước kiểm tra ngắn bên dưới.";

  const sourceBadge = document.querySelector("#sourceBadge");
  sourceBadge.className = `badge ${response.source === "llm" ? "low" : "medium"}`;
  sourceBadge.textContent = `Chế độ: ${sourceLabel(response.source)}`;

  const riskBadge = document.querySelector("#riskBadge");
  riskBadge.className = `badge ${badgeClassForRisk(response.riskLevel)}`;
  riskBadge.textContent = `Mức hỗ trợ: ${riskLabel(response.riskLevel)}`;

  const handoffBadge = document.querySelector("#handoffBadge");
  handoffBadge.className = `badge ${response.shouldHandoff ? "high" : "low"}`;
  handoffBadge.textContent = response.shouldHandoff ? "Nhân viên nên kiểm tra" : "Có thể tự kiểm tra trước";

  const selectionBadge = document.querySelector("#selectionBadge");
  selectionBadge.className = `badge ${response.needsIntentSelection ? "medium" : "low"}`;
  selectionBadge.textContent = response.needsIntentSelection ? "Cần chọn" : "Đã chọn";

  document.querySelector("#fallbackNotice").hidden = response.source !== "fallback_mock";

  renderState();
  renderIssues(response);
  renderKnownInfo(response.knownInfo);
  renderList("#missingInfo", response.missingInfo, "Không còn thiếu thông tin chính trong demo.");
  renderList("#nextQuestions", response.nextQuestions, "Chưa cần hỏi thêm.");
  renderChecklist(response.actionChecklist);
  document.querySelector("#handoffSummary").textContent = response.handoffSummary || "Tình huống này chưa cần tóm tắt cho nhân viên.";
  document.querySelector("#safetyNotice").textContent = response.safetyNotice || "Bản demo không xác nhận vé, thanh toán hoặc hành lý thật.";
}

async function runTriage(message) {
  const trimmed = message.trim();
  if (!trimmed) return;

  appendUserMessage(trimmed);
  messageInput.value = "";
  submitButton.disabled = true;
  submitButton.textContent = "Đang gửi…";
  const typingEl = appendTypingIndicator();

  try {
    const result = await streamTriage(trimmed, typingEl);
    typingEl.remove();
    renderResponse(result);
  } catch (error) {
    typingEl.remove();
    document.querySelector("#resultSummary").textContent = `Chưa kết nối được bản demo. Bạn thử chạy lại server hoặc dùng lại sau.`;
    appendAssistantMessage("<p>Mình chưa kết nối được bản demo lúc này. Bạn thử lại sau hoặc kiểm tra server local đang chạy nhé.</p>");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Gửi";
  }
}

document.querySelectorAll(".test-button").forEach((button) => {
  button.addEventListener("click", () => {
    const testType = button.dataset.test;
    if (testType === "correction") seedCorrectionDemoState();
    const message = testMessages[testType];
    messageInput.value = message;
    runTriage(message);
  });
});

triageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runTriage(messageInput.value);
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!submitButton.disabled) runTriage(messageInput.value);
  }
});

resetButton.addEventListener("click", () => {
  conversationState = structuredClone(defaultState);
  lastResponse = null;
  messageInput.value = "";
  resetChat();
  document.querySelector("#fallbackNotice").hidden = true;
  document.querySelector("#intentTitle").textContent = "Chưa có kết quả";
  document.querySelector("#resultSummary").textContent = "Nhập tình huống hoặc chọn một ví dụ để NEO kiểm tra.";
  document.querySelector("#sourceBadge").className = "badge neutral";
  document.querySelector("#sourceBadge").textContent = "Chế độ: -";
  document.querySelector("#riskBadge").className = "badge neutral";
  document.querySelector("#riskBadge").textContent = "Mức hỗ trợ: -";
  document.querySelector("#handoffBadge").className = "badge neutral";
  document.querySelector("#handoffBadge").textContent = "Nhân viên: -";
  document.querySelector("#selectionBadge").className = "badge neutral";
  document.querySelector("#selectionBadge").textContent = "Trạng thái: -";
  document.querySelector("#handoffSummary").textContent = "Chưa có tóm tắt.";
  document.querySelector("#safetyNotice").textContent = "Bản demo không xác nhận vé, thanh toán hoặc hành lý thật.";
  renderState();
  renderIssues({ detectedIssues: [] });
  renderKnownInfo(defaultKnownInfo);
  renderList("#missingInfo");
  renderList("#nextQuestions");
  renderChecklist([]);
});

copyButton.addEventListener("click", async () => {
  if (!lastResponse?.handoffSummary) return;
  await navigator.clipboard.writeText(lastResponse.handoffSummary);
  copyButton.textContent = "Đã copy";
  setTimeout(() => {
    copyButton.textContent = "Copy tóm tắt";
  }, 1000);
});

renderState();
resetChat();
renderIssues({ detectedIssues: [] });
renderKnownInfo(defaultKnownInfo);
renderList("#missingInfo");
renderList("#nextQuestions");
renderChecklist([]);
