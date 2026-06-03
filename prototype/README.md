# Vietnam Airlines NEO Chatbot Cải Tiến

Prototype Track B - Travel & Hospitality cho phiên bản NEO chatbot cải tiến.

Scope trải nghiệm:

```text
Chatbot trả lời câu hỏi chung về Vietnam Airlines như vé, hành lý, check-in,
dịch vụ và gợi ý nơi đi chơi theo điểm đến.
Khi gặp tình huống mơ hồ hoặc rủi ro cao như tiền đã trừ, chưa nhận vé,
hoặc hành lý mua thêm chưa xác nhận, chatbot chuyển sang workflow an toàn hơn.
```

Build slice được xử lý sâu:

```text
AI triage cho hành khách gặp lỗi sau thanh toán vé hoặc hành lý mua thêm:
phân loại vấn đề, giữ context, hỏi thông tin thiếu,
đánh dấu rủi ro cao và tạo handoff summary.
```

Tính năng bổ sung kiểu Layla-lite:

```text
Khi khách hỏi về điểm đến, chatbot gợi ý một số nơi đi chơi/ăn uống nhẹ,
hiển thị thành card và có link "Xem trên bản đồ" qua Google Maps search.
Prototype không đặt khách sạn, tour, nhà hàng hoặc dịch vụ thật.
```

## Chạy local

```bash
cd prototype
npm install
copy .env.example .env
npm run dev
```

Mở:

```text
http://localhost:3000
```

## API key

File `.env` dùng cho local server:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=https://api.openai.com/v1
PORT=3000
LLM_TIMEOUT_MS=12000
FORCE_MOCK_MODE=false
```

Nếu chưa có API key, server tự dùng fallback mock. Có thể ép fallback:

```env
FORCE_MOCK_MODE=true
```

## Endpoint

```text
POST /api/triage
```

Output chính:

- `detectedIssues`
- `selectedIntent`
- `needsIntentSelection`
- `riskLevel`
- `knownInfo`
- `missingInfo`
- `nextQuestions`
- `actionChecklist`
- `travelSuggestions`
- `handoffSummary`
- `shouldHandoff`
- `source`

## Demo paths

Happy:

```text
Hành lý xách tay của Vietnam Airlines được mang bao nhiêu kg?
```

Low-confidence:

```text
App báo lỗi, tiền bị trừ rồi.
```

Failure:

```text
Tôi mua thêm hành lý nhưng app báo lỗi, tiền đã trừ.
```

Travel suggestion:

```text
Tôi có một ngày ở Đà Nẵng, gợi ý vài nơi đi chơi và ăn uống nhẹ nhàng.
```

Correction:

```text
Không phải vé, tôi đang nói về hành lý mua thêm.
```

Multi-intent:

```text
Tôi bay Hà Nội - Tokyo, vé mua khuyến mãi có đổi ngày được không?
Tôi đã thanh toán nhưng chưa nhận vé.
Tôi mua thêm hành lý nhưng app báo lỗi, tiền đã trừ.
```

## Acceptance checklist

- Demo chạy trên localhost.
- API key chỉ nằm ở local server qua `.env`.
- Fallback mock nằm ở server, frontend chỉ render JSON.
- Case có "tiền đã trừ" luôn là `riskLevel = High` và `shouldHandoff = true`.
- Bot không khẳng định vé/hành lý/giao dịch đã thành công nếu không có dữ liệu booking thật.
- Bot hỏi thông tin thiếu cụ thể theo intent.
- Bot hiển thị thông tin đã có và thông tin còn thiếu.
- Correction path giữ context `paymentDeducted = true`.
- Multi-intent path tạo `detectedIssues` và `needsIntentSelection = true`.
- UI có action checklist và copy handoff summary.
- UI có card gợi ý nơi đi chơi và link bản đồ khi user hỏi về điểm đến.

## Boundaries

Prototype không đặt vé thật, đổi vé thật, hoàn tiền thật, xác nhận booking thật, cập nhật hành lý thật, đặt khách sạn/tour/nhà hàng thật, hoặc truy cập dữ liệu nội bộ Vietnam Airlines.
