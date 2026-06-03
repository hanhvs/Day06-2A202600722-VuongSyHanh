# Evidence Pack — Vietnam Airlines NEO AI Triage

## 1. Nhóm và track

**Tên nhóm:** Nhóm AI Product Labs  
**Track:** Track B — Travel & Hospitality  
**Product/app đã chọn:** Vietnam Airlines — NEO chatbot  
**Prototype đề xuất:** Vietnam Airlines NEO AI Triage  
**Build slice đang nghĩ:** AI triage cho hành khách gặp lỗi sau thanh toán vé hoặc hành lý mua thêm: phân loại vấn đề, giữ context, hỏi thông tin còn thiếu, đánh dấu rủi ro cao và tạo handoff summary khi cần chuyển nhân viên.

---

## 2. Self-use evidence

Nhóm tự dùng NEO với các câu hỏi mô phỏng tình huống hành khách gặp vấn đề sau khi đặt vé hoặc mua dịch vụ.

| Observation | Screenshot/link | Path liên quan | Điều học được |
| ----------- | --------------- | -------------- | ------------- |
| User hỏi một câu gồm nhiều vấn đề: đi HCM, mang 50kg hành lý, muốn ngồi cửa sổ. Bot trả thông tin dài nhưng chưa tách rõ từng vấn đề để xử lý theo thứ tự. | [G1](./evidence/Screenshot_2026-06-03_151509.png) | Low-confidence / Multi-intent | Bot cần nhận diện nhiều intent và hỏi user muốn xử lý vấn đề nào trước. |
| User hỏi cùng lúc 3 vấn đề: đổi ngày vé khuyến mãi, thanh toán chưa nhận vé, mua thêm hành lý lỗi nhưng tiền đã trừ. Bot chia mục nhưng vẫn thiên về trả thông tin chung. | [G2](./evidence/Screenshot_2026-06-03_151533.png) | Failure / Weak recovery | Case tiền/vé/hành lý cần được đánh dấu high risk và xử lý bằng checklist, không chỉ trả policy. |
| User nói muốn AI giải quyết vấn đề chứ không phải liên hệ tiếp viên. Bot yêu cầu cung cấp thông tin cụ thể nhưng chưa nêu rõ cần thông tin nào. | [G3](./evidence/Screenshot_2026-06-03_151556.png) | Low-confidence | Bot cần hỏi theo checklist cụ thể tùy loại vấn đề. |
| User nói đã cung cấp thông tin bên trên rồi. Bot vẫn hỏi lại chung chung thay vì trích xuất thông tin đã có. | [G4](./evidence/Screenshot_2026-06-03_151628.png) | Correction / Recovery failure | Bot cần hiển thị "thông tin đã có" và "thông tin còn thiếu" để tránh bắt user lặp lại. |

---

## 3. User / review / social evidence

Chưa có nguồn ngoài nhóm trong thời gian lab.

```text
Đây là giả định dựa trên self-use evidence. Nhóm sẽ kiểm bằng phỏng vấn nhanh 2-3 người từng đặt vé/mua hành lý online hoặc tìm review public về lỗi thanh toán/dịch vụ cộng thêm trước checkpoint M1 Day 06.
```

| Quote / review / observation | Nguồn | User là ai? | Pain/failure mode |
| ---------------------------- | ----- | ----------- | ----------------- |
| Người dùng thường không biết cần cung cấp mã đặt chỗ, thời điểm thanh toán, kênh mua hoặc ảnh lỗi khi gặp lỗi giao dịch. | Giả định cần kiểm chứng | Hành khách tự đặt vé/mua dịch vụ online | Bot hỏi chung chung làm user không biết trả lời thế nào. |
| Case "tiền đã trừ nhưng chưa nhận vé/dịch vụ" là case rủi ro cao vì ảnh hưởng trực tiếp đến quyền bay và tiền của user. | Giả định cần kiểm chứng | Hành khách gặp lỗi thanh toán | Bot trả lời quá tự tin hoặc quá chung có thể khiến user hiểu nhầm. |
| Khi bị chuyển support, user muốn nhân viên hiểu context trước đó thay vì hỏi lại từ đầu. | Giả định cần kiểm chứng | Hành khách đang cần xử lý nhanh | Handoff thiếu summary gây lặp thông tin và giảm niềm tin. |

---

## 4. Competitor / analog evidence

| App / mô hình tham khảo | Họ xử lý task này thế nào? | Pattern học được | Có áp dụng trong 1 ngày không? |
| ----------------------- | -------------------------- | ---------------- | ------------------------------ |
| Banking dispute support | Phân loại giao dịch, hỏi thông tin bắt buộc, đánh dấu case rủi ro, chuyển nhân viên khi cần. | Triage theo risk level và checklist thông tin. | Có, bằng mock flow. |
| E-commerce order support | Cho user chọn vấn đề: chưa nhận hàng, thanh toán lỗi, hoàn tiền, đổi trả. | Multi-intent cần được tách thành từng issue. | Có, bằng quick replies. |
| Airline manage booking flow | Yêu cầu mã đặt chỗ, họ tên/email, hành trình để kiểm tra booking. | Không kết luận nếu thiếu dữ liệu booking. | Có, bằng simulated data / mock state. |
| Layla-style prototype guide | Dùng chat-first UI, structured cards và map/visual panel như tham khảo UI/UX. | Có thể học cách trình bày result rõ ràng, nhưng không đổi product/spec chính. | Có, chỉ dùng làm cảm hứng UI, không dùng làm evidence chính. |

---

## 5. Evidence -> Insight

```text
Evidence nổi bật nhất:
G2 và G4 cho thấy khi user gặp vấn đề tiền/vé/hành lý hoặc đã cung cấp context trước đó,
NEO vẫn trả lời theo dạng thông tin chung và hỏi lại chưa cụ thể.

Insight:
User không chỉ cần thông tin chính sách.
Thật ra họ cần một luồng triage giúp biến vấn đề mơ hồ thành bước xử lý rõ ràng,
vì các vấn đề vé/thanh toán/hành lý mua thêm có rủi ro cao và thường thiếu dữ liệu quan trọng.

Opportunity:
AI có thể giúp bằng cách phân loại vấn đề, trích xuất thông tin đã có,
hỏi thông tin còn thiếu theo checklist,
đưa action checklist,
và tạo handoff summary khi cần chuyển nhân viên.
```

---

## 6. Evidence đổi SPEC như thế nào?

- [x] Đổi user chính sang hành khách gặp lỗi sau giao dịch.
- [x] Đổi pain statement từ "cần biết policy" sang "cần workflow triage".
- [x] Đổi build slice sang lỗi vé hoặc hành lý mua thêm sau thanh toán.
- [x] Đổi Auto/Aug decision sang conditional automation.
- [x] Đổi 4 paths: happy, low-confidence, failure, correction.
- [x] Đổi failure mode sang case "tiền đã trừ nhưng vé/dịch vụ chưa xác nhận".
- [x] Đổi owner/test plan theo prototype NEO AI Triage.

Ghi rõ thay đổi quan trọng:

```text
Trước evidence, nhóm có thể định làm chatbot trả lời quy định hành lý tốt hơn.
Sau evidence, nhóm đổi thành AI triage cho lỗi sau thanh toán vé hoặc hành lý mua thêm.

Lý do:
Evidence nhóm cho thấy vấn đề mạnh hơn nằm ở workflow xử lý case thật:
multi-intent, lỗi giao dịch, tiền đã trừ, context loss và handoff chưa đủ tốt.
```
