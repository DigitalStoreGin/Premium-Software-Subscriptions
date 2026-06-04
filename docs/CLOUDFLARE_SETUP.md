# CLOUDFLARE SETUP — từng bước

## 0. Chuẩn bị
- Node ≥ 18, `npm i -g wrangler`, `wrangler login`.
- KV: `bd8530d0f1b84b58a56284db011bdc81` (binding `ORDERS`), R2: `digitalstore-proof` (binding `PROOFS`).
- File cấu hình chính: **`wrangler.toml` ở thư mục gốc repo** (để GitHub deploy không mất bindings).

## ⚠️ Dashboard báo "Bindings (0)" / mất flow KV–R2
GitHub kết nối Worker nhưng deploy **không** đọc `backend/wrangler.toml` → version không có KV/R2.

**Cách sửa (một lần):**
```bash
# Từ thư mục gốc repo (có wrangler.toml)
wrangler deploy
```
Sau đó refresh Cloudflare → Workers → **store** → Overview: phải thấy **ORDERS** (KV) và **PROOFS** (R2).

## 1. Connect worker
```bash
wrangler whoami
```
URL: `https://store.tdh1812.workers.dev`

## 2. Secrets — lưu trên Cloudflare (online, không local)

**Cách A — Dashboard (khuyên dùng, không mất khi đổi máy):**
1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **store**
2. **Settings** → **Variables and Secrets**
3. Thêm **Secret** (Encrypt):

| Tên | Giá trị |
|-----|--------|
| `BREVO_API_KEY` | API key Brevo (`xkeysib-...`) |
| `WEB3FORMS_KEY` | Key Web3Forms |
| `ADMIN_TOKEN` | (đặt token ngẫu nhiên — KHÔNG ghi giá trị thật vào repo) |
| `ADMIN_PASS_HASH` | SHA-256 của mật khẩu admin (64 ký tự hex), **không** gõ plain password |
| `DEEPL_API_KEY` | *(tùy chọn)* Key DeepL để tự dịch email DE→EN/RU. Gói free: key kết thúc `:fx`. Không có key thì email luôn tiếng Đức. |

4. **Environment variables** (plain text, đã có trong `wrangler.toml`): `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `ADMIN_EMAIL`, `SUPPORT_EMAIL`

**Cách B — CLI:**
```bash
wrangler secret put BREVO_API_KEY
wrangler secret put WEB3FORMS_KEY
wrangler secret put ADMIN_TOKEN
wrangler secret put ADMIN_PASS_HASH
```
Hoặc: `powershell -File scripts/set-cloudflare-secrets.ps1`

## 3. Paste worker URL vào frontend
Trong `js/app.js`:
```js
const WORKER_URL = 'https://store.tdh1812.workers.dev';
```
(Đã điền sẵn. Sửa nếu account subdomain của bạn khác.)

## 4. Deploy
```bash
# Luôn chạy từ thư mục gốc repo (file wrangler.toml gốc)
wrangler deploy
curl https://store.tdh1812.workers.dev/config      # → {"ok":true,...}
curl https://store.tdh1812.workers.dev/order/NONE  # → {"error":"not_found"} là OK
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
| Bindings (0) trên dashboard | Deploy lại từ **gốc repo** (`wrangler deploy`), không chỉ push GitHub nếu chưa có `wrangler.toml` gốc. |
| Secrets trống sau deploy | Set lại trên Dashboard → Variables and Secrets (secrets **không** nằm trong git). |
| GET /config → 404 | Worker đang chạy bản “autoconfig” không có code — `wrangler deploy` từ repo. |
