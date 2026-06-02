# CLOUDFLARE SETUP — từng bước

## 0. Chuẩn bị
- Node ≥ 18, `npm i -g wrangler`, `wrangler login`.
- KV namespace đã có: id `bd8530d0f1b84b58a56284db011bdc81` (binding `ORDERS`) — đã điền sẵn trong `wrangler.toml`.

## 1. Connect worker
```bash
cd backend
wrangler whoami        # xác nhận đã đăng nhập
```
`wrangler.toml` đã đặt `name = "store"` → URL sẽ là `https://store.<account>.workers.dev`
(của bạn: `https://store.tdh1812.workers.dev`).

## 2. Set secrets (KHÔNG ghi vào file)
```bash
wrangler secret put BREVO_API_KEY        # ⚠️ DÁN KEY BREVO MỚI (key cũ đã lộ → xoá trên Brevo)
wrangler secret put BREVO_SENDER_EMAIL   # email đã verify trên Brevo
wrangler secret put BREVO_SENDER_NAME    # DigitalStore
wrangler secret put WEB3FORMS_KEY        # 8a7b89a3-6dd5-4b90-bd30-e5f7139910de
wrangler secret put ADMIN_TOKEN          # chuỗi ngẫu nhiên dài (openssl rand -hex 24)
wrangler secret put ADMIN_EMAIL          # cfvblue@gmail.com
wrangler secret put SUPPORT_EMAIL        # cfvblue@gmail.com
```

## 3. Paste worker URL vào frontend
Trong `js/app.js`:
```js
const WORKER_URL = 'https://store.tdh1812.workers.dev';
```
(Đã điền sẵn. Sửa nếu account subdomain của bạn khác.)

## 4. Deploy
```bash
wrangler deploy
curl https://store.tdh1812.workers.dev/order/NONE   # → {"error":"not_found"} là OK
```

## 5. Commit & push
```bash
git add -A && git commit -m "order automation" && git push
```
Đợi GitHub Pages build ~1 phút.

## Test (đúng quy trình khách)
1. Mở URL GitHub Pages của bạn.
2. Thêm 1 sản phẩm vào giỏ → "Bestellung abschicken".
3. Nhập Tên + Email của bạn → "Bestellung absenden".
   - **Email admin (Web3Forms)** đến NGAY (không cần Worker).
   - **Email xác nhận khách (Brevo)** đến nếu Worker + secret Brevo đã cấu hình.
4. Trong cửa sổ thành công: upload 1 file bằng chứng (PNG/JPG/PDF) → "Ich habe es gesendet".
   - Admin nhận email thứ 2 kèm file đính kèm.
5. Mở admin `/admin/` → sửa nội dung email → Lưu → đặt đơn lại để thấy email khách đổi theo.

## Kiểm tra nhanh /config
```bash
curl https://store.tdh1812.workers.dev/config           # → {"ok":true,"config":{...}}
curl https://store.tdh1812.workers.dev/order/NONE        # → {"error":"not_found"} là OK
```

## Khắc phục sự cố
| Triệu chứng | Nguyên nhân & cách sửa |
|-----|-----|
| Admin KHÔNG nhận đơn | Web3Forms key sai. Kiểm `WEB3FORMS_KEY` trong `js/app.js`, hoặc access_key trên web3forms.com. |
| Khách KHÔNG nhận email xác nhận | Worker chưa deploy / chưa set `BREVO_API_KEY` + `BREVO_SENDER_EMAIL`, hoặc **sender chưa verify** trên Brevo. Mở DevTools → Network → POST `/order` → xem trường `brevo` trong response (`ok:false` + `status`/`body` cho biết lý do). |
| CORS bị chặn | `ALLOWED_ORIGIN` trong wrangler.toml phải khớp origin GitHub Pages (vd `https://digitalstoregin.github.io`) → deploy lại. |
| 401 khi lưu /config | sai `x-admin-token` (phải khớp secret `ADMIN_TOKEN`). |
| 500 storage_unavailable | KV id sai trong wrangler.toml. |
