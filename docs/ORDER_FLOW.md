# ORDER FLOW

```
Khách (storefront index.html)
  → chọn sản phẩm → giỏ hàng → "Bestellung abschicken"
  → nhập Tên + Email → "Bestellung absenden"  (submitOrder)
       ├─ (A) POST trực tiếp Web3Forms  → email admin (LUÔN chạy, không phụ thuộc Worker)
       └─ (B) POST Worker /order        → Brevo gửi email xác nhận cho khách
                                          (Worker trả về { brevo: {ok,status} } để chẩn đoán)
  → Cửa sổ "Bestellung erfolgreich": Bankverbindung (Name/IBAN/Betrag/Verwendungszweck)
  → Upload bằng chứng chuyển khoản (BẮT BUỘC — PNG/JPG/PDF, ≤4 MB)
  → nút "Ich habe es gesendet" (chỉ bật sau khi đã chọn file)
       └─ POST trực tiếp Web3Forms (multipart): toàn bộ đơn + file đính kèm → email admin
          (đồng thời báo Worker /order/:id/proof để cập nhật trạng thái — best-effort)
```

## Vì sao admin luôn nhận được đơn
- Bước 1 và bước 2 đều gửi **trực tiếp** tới Web3Forms từ trình duyệt → không phụ thuộc Worker.
- Brevo (email xác nhận cho khách) cần Worker + secret. Nếu chưa cấu hình, khách sẽ không nhận email
  nhưng admin vẫn nhận đơn (qua Web3Forms). Xem `CLOUDFLARE_SETUP.md` → mục Khắc phục sự cố.

## ORDER OBJECT (trong KV)
```json
{ "order_id":"DS-260602-AB12", "status":"awaiting_payment",
  "customer":{"name":"...","email":"..."},
  "items":[{"name":"...","variant":"...","qty":1,"price":25}],
  "subtotal":25, "discount":0, "total":25, "currency":"EUR",
  "proof":null, "created_at":"...", "updated_at":"...", "history":[...] }
```

## STATUS
`awaiting_payment → proof_uploaded → verified → credentials_sent → completed`  (hoặc `cancelled`)
> Order ID vẫn được sinh nội bộ để khớp 2 email (đặt hàng + bằng chứng), nhưng KHÔNG hiển thị cho khách.
