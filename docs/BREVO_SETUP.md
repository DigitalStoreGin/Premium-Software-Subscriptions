# BREVO SETUP

Bạn có 2 cách gửi email khách. Worker hỗ trợ **Cách A mặc định**.

## ⚠️ Trước tiên
Brevo key từng dán trong chat đã lộ → **Brevo → SMTP & API → API Keys → xoá key cũ → tạo key mới**.
Tạo key dạng **API key** (cho REST `api.brevo.com`). Đặt qua `wrangler secret put BREVO_API_KEY`.

## Verify sender
Brevo → **Senders, Domains & Dedicated IPs → Senders → Add a sender** → xác nhận email gửi
(vd `no-reply@domain` hoặc Gmail). Đặt qua `wrangler secret put BREVO_SENDER_EMAIL`.

## Cách A — Worker render HTML (mặc định, KHÔNG cần tạo template trên Brevo)
Worker `backend/worker.js` hàm `renderEmail()` dựng email **theo cấu hình online** (KV key `__email_config`):
- **Top:** sản phẩm khách mua (động) + Gesamtsumme.
- **Middle:** mục "Das könnte Sie auch interessieren" (do bạn tự sửa trong `/admin/`).
- **Bottom:** khối "Persönlicher Support" + nút email hỗ trợ.
Bạn sửa lời cảm ơn, danh sách sản phẩm gợi ý, chữ ký… tại `/admin/` → lưu → email khách tự đổi theo.
Không cần làm gì thêm trên Brevo ngoài API key + sender đã verify.

## Cách B — Brevo Template (nếu bạn thích quản lý template trên dashboard)
1. Brevo → **Campaigns → Templates → New template** (Drag & Drop hoặc Code your own).
2. Dán HTML mẫu có biến Brevo:
```
{% for item in params.items %}
  <tr><td>{{ item.name }}</td><td style="text-align:right">€{{ item.price }}</td></tr>
{% endfor %}
  <tr><td>Gesamtsumme</td><td style="text-align:right">€{{ params.total }}</td></tr>
```
   (giữ 8 sản phẩm tĩnh + khối support như Cách A).
3. Lưu, lấy **template ID** (số).
4. Sửa Worker: thay khối `sendinblue smtp/email` bằng:
```js
body: JSON.stringify({
  templateId: <ID>,
  to:[{email,name}],
  params:{ name, order_id:orderId, items: norm.map(i=>({name:i.name, price:num(i.qty*i.price)})), subtotal:num(subtotal), total:num(order.total) }
})
```
Biến template: `name`, `order_id`, `items`, `subtotal`, `total`.
