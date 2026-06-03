# Toolkit — Từ Evidence Đến Build Slice

Dùng sau khi nhóm đã có evidence. Mục tiêu là chốt một build slice đủ nhỏ cho Day 06.

## 1. Gom evidence thành cụm

Gom theo **workflow/pain**, không gom theo tên feature.

| Cụm evidence | Evidence liên quan | Pattern thấy được | Quyết định sản phẩm |
| ------------ | ------------------ | ----------------- | ------------------- |
| User hỏi nhiều vấn đề cùng lúc | [G1](./evidence/Screenshot_2026-06-03_151509.png), [G2](./evidence/Screenshot_2026-06-03_151533.png) | User gộp hành lý, chọn ghế, đổi ngày, thanh toán trong một câu. Bot trả dài nhưng chưa hỏi user muốn xử lý issue nào trước. | Prototype cần `detectedIssues`, `needsIntentSelection`, và không xử lý mọi issue cùng lúc. |
| Case tiền/vé/hành lý có rủi ro cao | [G2](./evidence/Screenshot_2026-06-03_151533.png) | User nói đã thanh toán/chưa nhận vé/mua thêm hành lý lỗi nhưng tiền đã trừ; bot vẫn thiên về policy chung. | Case có "tiền đã trừ" phải là `riskLevel = High`, `shouldHandoff = true`, không khẳng định giao dịch thành công. |
| Bot hỏi lại chung chung | [G3](./evidence/Screenshot_2026-06-03_151556.png) | User muốn AI giải quyết vấn đề nhưng bot chỉ yêu cầu "cung cấp thông tin cụ thể" mà chưa nói cần gì. | Output phải là missing-info checklist và next questions theo intent. |
| Bot chưa tận dụng context | [G4](./evidence/Screenshot_2026-06-03_151628.png) | User nói đã cung cấp thông tin trước đó nhưng bot vẫn hỏi lại. | Prototype phải hiển thị "thông tin đã có", "thông tin còn thiếu" và giữ context qua correction path. |

---

## 2. Viết insight

Form:

```text
User [segment] không chỉ cần [surface need].
Họ thật ra cần [deeper need],
vì [evidence pattern].
```

Insight của nhóm:

```text
Hành khách Vietnam Airlines gặp lỗi sau thanh toán không chỉ cần đọc chính sách.
Họ thật ra cần một workflow triage giúp biến vấn đề mơ hồ thành bước xử lý rõ ràng,
vì evidence cho thấy NEO trả lời dài, hỏi lại chung chung,
chưa ưu tiên case rủi ro cao liên quan tiền/vé/hành lý,
và chưa giữ context đủ tốt khi user sửa hoặc bổ sung thông tin.
```

Insight quan trọng nhất: vấn đề không phải "bot thiếu kiến thức", mà là "bot thiếu workflow xử lý case rủi ro cao".

---

## 3. Viết opportunity

Form:

```text
Cơ hội là dùng AI để [augment/automate hành động hẹp],
giúp user [kết quả],
trong khi vẫn kiểm soát [failure/risk].
```

Opportunity của nhóm:

```text
Cơ hội là dùng AI để triage một hành động hẹp:
phân loại lỗi sau thanh toán vé hoặc hành lý mua thêm,
trích xuất thông tin đã có,
hỏi thông tin còn thiếu,
tạo action checklist,
và tạo handoff summary khi case có rủi ro cao.

Nhờ đó user biết cần làm gì tiếp theo,
trong khi vẫn kiểm soát rủi ro bằng guardrail:
AI không xác nhận vé/dịch vụ/thanh toán thành công nếu không có dữ liệu booking thật.
```

---

## 4. Chọn build slice

Build slice tốt phải qua 5 câu hỏi:

| Câu hỏi | Đạt khi | Câu trả lời của nhóm |
| ------- | ------- | -------------------- |
| User cụ thể chưa? | Nói được ai dùng, trong bối cảnh nào. | Có: hành khách Vietnam Airlines sau giao dịch vé/hành lý. |
| Task đủ hẹp chưa? | Demo được trong 3-5 phút. | Có: chỉ triage lỗi sau thanh toán vé hoặc hành lý mua thêm. |
| AI decision rõ chưa? | AI gợi ý/tự làm một việc cụ thể. | Có: phân loại intent, risk, known/missing info, next questions, checklist/handoff. |
| Failure path rõ chưa? | Có một case AI không chắc hoặc sai để test. | Có: tiền đã trừ nhưng vé/dịch vụ chưa xác nhận. |
| Có evidence không? | Có bằng chứng từ self-use/review/user/competitor. | Có self-use evidence G1-G4 và analog evidence trong `evidence-pack.md`; nguồn ngoài nhóm sẽ kiểm thêm nếu còn thời gian. |

Build slice được chọn:

```text
Cho hành khách Vietnam Airlines gặp lỗi sau thanh toán vé hoặc hành lý mua thêm,
prototype dùng AI để phân loại vấn đề, giữ context, hỏi thông tin còn thiếu,
tạo action checklist,
và chuyển nhân viên kèm handoff summary với case rủi ro cao.
```

---

## 5. Quyết định: giữ, giảm scope, hay đổi hướng?

| Tình huống | Quyết định |
| ---------- | ---------- |
| Evidence yếu, user mơ hồ | Không phải tình huống hiện tại; đã có G1-G4 chỉ rõ workflow pain. |
| Ý tưởng quá rộng | Giữ domain Vietnam Airlines/Travel & Hospitality, cắt xuống một flow hậu giao dịch. |
| AI không cần thiết | AI có vai trò rõ: phân loại intent, trích xuất context, hỏi missing info, tạo checklist/handoff. |
| Rủi ro cao | Chọn conditional automation; human support giữ vai trò rescuer/final handler. |
| Không demo được trong 1 ngày | Đưa chọn ghế, đổi ngày, hoàn tiền, dịch vụ khác vào backlog; giữ vé + hành lý mua thêm. |

**Quyết định cuối:** Giữ Vietnam Airlines NEO làm product chính. Không pivot spec/evidence sang Layla. File `layla-style-prototype-guide.md` chỉ là tham khảo cách thiết kế UI/UX prototype đẹp, không thay thế build slice chính.

---

## 6. Câu chốt cuối

Điền câu này trước khi rời lớp:

```text
Dựa trên evidence G1-G4 cho thấy NEO trả lời dài, hỏi lại chung chung,
chưa xử lý tốt multi-intent và case tiền/vé/hành lý rủi ro cao,
nhóm sẽ build Vietnam Airlines NEO AI Triage,
cho hành khách gặp lỗi sau thanh toán vé hoặc hành lý mua thêm,
để giúp user biết bước xử lý tiếp theo,
bằng cách AI phân loại vấn đề, hỏi thông tin còn thiếu, tạo checklist và handoff summary,
và sẽ test failure path "tiền đã trừ nhưng vé/dịch vụ chưa được xác nhận".
```

---

## 7. Backlog

Những thứ **không build trong Day 06**:

- Đổi ngày bay thật.
- Hoàn tiền thật.
- Chọn ghế hoặc cập nhật chỗ ngồi thật.
- Xác minh booking thật.
- Upload ảnh lỗi thật.
- Kết nối hệ thống CRM/tổng đài thật.
- Full AI travel planner kiểu Layla.
- Gợi ý lịch trình, khách sạn hoặc địa điểm du lịch.
