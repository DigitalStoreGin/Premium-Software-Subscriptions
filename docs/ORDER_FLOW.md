# ORDER FLOW

```
Khách (storefront)
  → sinh Order ID  DS-YYMMDD-XXXX
  → submitOrder()
       ├─(A) POST Worker /order  ─┬─ KV: lưu {order_id,customer,items,subtotal,total,status,created_at}
       │                          ├─ Web3Forms → email admin
       │                          └─ Brevo → email khách (top động + 8 tĩnh + nút support)
       └─ fallback mailto nếu mạng lỗi
  → Success modal: Order ID + IBAN + Verwendungszweck=Order ID + nút Upload bằng chứng
  → Upload proof → POST /order/:id/proof → status=proof_uploaded + đính kèm Web3Forms
Admin (admin/orders.html)
  → GET /orders  → bảng đơn
  → POST /order/:id/status → verified → credentials_sent → completed
  → "Gửi credentials" mở email soạn sẵn cho khách
```

## ORDER OBJECT (trong KV)
```json
{ "order_id":"DS-260602-AB12", "status":"awaiting_payment",
  "customer":{"name":"...","email":"..."},
  "items":[{"name":"...","variant":"...","qty":1,"price":25}],
  "subtotal":25, "discount":0, "total":25, "currency":"EUR",
  "proof":null, "created_at":"...", "updated_at":"...", "history":[...] }
```

## STATUS
`created → awaiting_payment → proof_uploaded → verified → credentials_sent → completed`  (hoặc `cancelled`)
