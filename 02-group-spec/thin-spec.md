# Thin SPEC — Vietnam Airlines NEO AI Triage

## 1. Track, product/app và user

**Track:** Track B — Travel & Hospitality  
**Product/app thật:** Vietnam Airlines — NEO chatbot  
**Prototype:** Vietnam Airlines NEO AI Triage  
**Build slice:** AI triage cho hành khách gặp lỗi sau thanh toán vé hoặc hành lý mua thêm.  
**User cụ thể:** Hành khách đã thanh toán vé hoặc mua thêm hành lý qua website/app Vietnam Airlines nhưng chưa nhận được xác nhận, app báo lỗi, hoặc không biết cần chuẩn bị thông tin gì để xử lý tiếp.  
**Nhóm có phải user thật không? Nếu không, khác ở đâu?** Nhóm là proxy user qua self-use evidence. Nhóm chưa có nguồn ngoài nhóm trong thời gian lab, nên sẽ kiểm chứng thêm bằng phỏng vấn nhanh 2-3 người từng đặt vé/mua hành lý online hoặc tìm review public về lỗi thanh toán/dịch vụ cộng thêm.

Prototype thuộc Track B — Travel & Hospitality vì tập trung vào trải nghiệm hỗ trợ hành khách sau giao dịch trên nền tảng hàng không. Đây không phải chatbot du lịch tổng quát, không gợi ý lịch trình, không gợi ý khách sạn/địa điểm du lịch, và không thực hiện đặt vé/đổi vé/hoàn tiền thật.

---

## 2. Evidence summary

| Evidence | Nguồn | User/pain nói lên điều gì? | SPEC phải đổi gì? |
| -------- | ----- | -------------------------- | ----------------- |
| [G1](./evidence/Screenshot_2026-06-03_151509.png) | Self-use NEO | User hỏi nhiều vấn đề trong một câu; bot trả dài và chưa tách intent để xử lý theo thứ tự. | Thêm multi-intent triage và hỏi user chọn một issue trước. |
| [G2](./evidence/Screenshot_2026-06-03_151533.png) | Self-use NEO | Case tiền/vé/hành lý lỗi có rủi ro cao nhưng bot vẫn thiên về trả thông tin chung. | Thêm risk level, high-risk guardrail và rule không kết luận thay hệ thống booking. |
| [G3](./evidence/Screenshot_2026-06-03_151556.png) | Self-use NEO | User muốn AI giải quyết vấn đề, nhưng bot hỏi lại chung chung, chưa nêu rõ cần thông tin nào. | Thêm checklist thông tin còn thiếu theo từng loại vấn đề. |
| [G4](./evidence/Screenshot_2026-06-03_151628.png) | Self-use NEO | User đã cung cấp context nhưng bot vẫn hỏi lại, làm mất niềm tin. | Thêm trạng thái "thông tin đã có" và "thông tin còn thiếu"; correction path phải giữ context. |

---

## 3. Pain statement

```text
Hành khách Vietnam Airlines gặp lỗi sau thanh toán vé hoặc hành lý mua thêm
đang khó biết bước xử lý tiếp theo,
vì NEO trả lời theo dạng thông tin chung, hỏi lại chưa cụ thể,
chưa phân biệt case rủi ro cao liên quan tiền/vé/dịch vụ,
và chưa tận dụng tốt context đã có trong hội thoại.

Bằng chứng chính là G2 và G4:
user nêu lỗi thanh toán hoặc mua thêm hành lý nhưng tiền đã trừ,
sau đó bot vẫn trả policy/hỏi lại chung chung thay vì triage thành checklist xử lý.
```

---

## 4. Build slice

```text
Cho hành khách Vietnam Airlines gặp lỗi sau thanh toán vé hoặc hành lý mua thêm,
prototype dùng AI để phân loại vấn đề, trích xuất thông tin đã có,
hỏi thông tin còn thiếu theo checklist,
tạo action checklist,
và xử lý failure mode "tiền đã trừ nhưng vé/dịch vụ chưa được xác nhận"
bằng risk warning + handoff summary cho nhân viên hỗ trợ.
```

### Core MVP

Prototype chỉ xử lý sâu 3 intent:

```text
ticket_payment_issue
baggage_addon_payment_issue
unclear_payment_issue
```

### Backlog chỉ nhận diện cơ bản

Các intent sau chỉ được nhận diện trong multi-intent, không xử lý sâu trong Day 06:

```text
seat_selection_issue
date_change_request
refund_request
other_addon_issue
```

### Out of scope

- Không đặt vé thật.
- Không đổi vé thật.
- Không hoàn tiền thật.
- Không xác nhận vé/dịch vụ đã thành công nếu không có dữ liệu booking thật.
- Không truy cập dữ liệu nội bộ hoặc mã đặt chỗ thật.
- Không build chatbot du lịch tổng quát, gợi ý lịch trình, khách sạn hoặc địa điểm du lịch.
- Không biến prototype thành full AI travel planner kiểu Layla; `layla-style-prototype-guide.md` chỉ là tham khảo UI/UX nếu cần.

---

## 5. Auto/Aug decision

- [ ] **Augmentation:** AI chỉ gợi ý/draft/phân loại, user quyết cuối.
- [x] **Conditional automation:** AI tự triage trong scope hẹp; case mơ hồ/rủi ro cao chuyển người.
- [ ] **Automation:** AI tự quyết và tự hành động.

**Lý do chọn:** Case vé/thanh toán/hành lý mua thêm có rủi ro cao. AI có thể tự động phân loại, hỏi thông tin thiếu, tạo checklist và handoff summary, nhưng không được xác nhận thay hệ thống booking hoặc quyết định giao dịch thật.  
**Human role:** rescuer / support agent.

---

## 6. Four paths

| Path | Input mẫu | Prototype phải thể hiện gì? |
| ---- | --------- | --------------------------- |
| Happy | `Tôi muốn mua thêm hành lý nhưng chưa biết cần chuẩn bị thông tin gì.` | Bot phân loại là baggage add-on preparation/helper path, risk Low, không handoff, đưa checklist thông tin cần chuẩn bị. |
| Low-confidence | `App báo lỗi, tiền bị trừ rồi.` | Bot không đoán ngay, đánh dấu risk High vì có tín hiệu tiền bị trừ, hỏi lỗi thuộc vé hay hành lý mua thêm. |
| Failure | `Tôi mua thêm hành lý nhưng app báo lỗi, tiền đã trừ.` | Bot chọn `baggage_addon_payment_issue`, risk High, không xác nhận dịch vụ thành công, hỏi thông tin bắt buộc và tạo handoff summary. |
| Correction | `Không phải vé, tôi đang nói về hành lý mua thêm.` | Bot đổi intent sang `baggage_addon_payment_issue`, giữ context `paymentDeducted = true`, và hỏi checklist phù hợp. |

### Multi-intent test

```text
Tôi bay Hà Nội - Tokyo, vé mua khuyến mãi có đổi ngày được không?
Tôi đã thanh toán nhưng chưa nhận vé.
Tôi mua thêm hành lý nhưng app báo lỗi, tiền đã trừ.
```

Expected:

1. `detectedIssues` có ít nhất 3 issue.
2. `needsIntentSelection = true`.
3. Bot hỏi user muốn xử lý vấn đề nào trước.
4. Bot không cố xử lý toàn bộ issue cùng lúc.

---

## 7. Failure mode nguy hiểm nhất

```text
Nếu user gặp case tiền đã trừ nhưng vé/hành lý mua thêm chưa được xác nhận,
AI có thể trả lời quá tự tin hoặc đưa hướng dẫn chung,
khiến user tưởng giao dịch đã được xử lý trong khi thực tế chưa được xác nhận.
```

**Impact:** User có thể ra sân bay với vé/dịch vụ chưa hợp lệ, bị mất tiền, mất thời gian hoặc bỏ lỡ chuyến bay.

Prototype xử lý bằng:

1. Đánh dấu `riskLevel = High`.
2. Đặt `shouldHandoff = true` với case tiền đã trừ/chưa nhận vé/chưa xác nhận dịch vụ.
3. Không xác nhận thay hệ thống booking.
4. Hỏi thông tin bắt buộc: mã đặt chỗ dạng mask, kênh mua, thời điểm thanh toán, ảnh lỗi, số kg hành lý nếu liên quan hành lý.
5. Tạo action checklist.
6. Tạo handoff summary ngắn cho nhân viên hỗ trợ.

Owner kiểm thử path này là: Long / thành viên phụ trách test failure path.

---

## 8. Prototype requirements

### Must have

1. Web mock chạy trên localhost.
2. Frontend có chat/input area và quick test buttons.
3. UI hiển thị detected issues, selected intent, `needsIntentSelection`, risk level.
4. UI hiển thị thông tin đã có, thông tin còn thiếu, câu hỏi tiếp theo, action checklist.
5. UI tạo handoff summary và có nút copy summary.
6. Local Node server expose `POST /api/triage`.
7. OpenAI API key chỉ nằm ở server qua `.env`, không nằm trong frontend.
8. Có fallback mock server-side nếu thiếu API key/API lỗi/quota/timeout.
9. Có deterministic risk guardrails: case tiền đã trừ luôn High và shouldHandoff true.
10. Có privacy notice: không nhập thông tin cá nhân hoặc mã đặt chỗ thật.

### Should have

1. Source badge: `llm` hoặc `fallback_mock`.
2. Reset conversation.
3. Multi-intent issue list có thể click chọn.
4. README hướng dẫn chạy local và bật fallback.
5. UI/UX có thể học từ `layla-style-prototype-guide.md`: bố cục rõ, cards dễ scan, trạng thái/nguồn dữ liệu minh bạch.

---

## 9. Acceptance criteria

Prototype được xem là đạt nếu:

1. Demo chạy được trên localhost.
2. API key không xuất hiện trong frontend.
3. Fallback mock nằm ở local Node server và trả đủ schema.
4. Với case "tiền đã trừ", bot luôn đánh dấu High và shouldHandoff true.
5. Bot không khẳng định giao dịch thành công nếu không có dữ liệu booking thật.
6. Bot hỏi thông tin thiếu cụ thể, không hỏi chung chung.
7. Bot hiển thị được thông tin đã có từ hội thoại.
8. Bot xử lý correction bằng cách đổi intent mà vẫn giữ context.
9. Bot tạo handoff summary ngắn, đủ cho nhân viên hỗ trợ.
10. Multi-intent input tạo `detectedIssues` và `needsIntentSelection = true`.
11. Demo đủ 4 paths và multi-intent trong 3-5 phút.

---

## 10. Owner plan cho Day 06

| Thành viên | Việc phụ trách | Bằng chứng cần có trong repo |
| ---------- | -------------- | ---------------------------- |
| Hạnh | Research / evidence | Evidence screenshots trong `02-group-spec/evidence/` và `evidence-pack.md` |
| Kiên | SPEC | `prd-ai-triage-neo.md`, `thin-spec.md`, `synthesis-decide-toolkit.md` |
| Long / prototype owner | Prototype | `prototype/` web mock, server, README, `.env.example` |
| Khoa / test owner | Test / failure path | 4 paths + multi-intent test; screenshot demo nếu cần |
| Đức / demo owner | Demo script / repo | README, plan/steps, handoff summary demo |

---

## 11. Câu chốt cuối

```text
Dựa trên evidence NEO trả lời dài, hỏi lại chung chung và chưa xử lý tốt case tiền/vé/hành lý rủi ro cao,
nhóm sẽ build prototype AI triage cho hành khách gặp lỗi sau thanh toán vé hoặc hành lý mua thêm,
để giúp user biết bước xử lý tiếp theo,
bằng cách AI phân loại vấn đề, hỏi thông tin còn thiếu, tạo checklist và handoff summary,
và sẽ test failure path "tiền đã trừ nhưng vé/dịch vụ chưa được xác nhận".
```
