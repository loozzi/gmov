# Backup & restore DB (Mục 16)

## Cơ chế

- Service `db-backup` (image `postgres:17-alpine`, chạy bằng UID host) dump DB
  **mỗi ngày** (`BACKUP_INTERVAL_SECONDS`, mặc định 86400) bằng
  `pg_dump --clean --if-exists` nén gzip → file
  `pgbackups/gmov-YYYYmmdd-Day-HHMMSS.sql.gz` (ví dụ
  `gmov-20250915-Mon-030000.sql.gz`).
- File nằm ở volume riêng **`pgbackups`**, tách khỏi `pgdata`.
- Rotation tự động mỗi lần dump:
  - bản ngày thường quá `BACKUP_RETENTION_DAYS` (mặc định 7) → xóa;
  - bản Chủ nhật (`*-Sun-*`) quá `BACKUP_RETENTION_WEEKS` (mặc định 4) → xóa.
- Backup thủ công ngay: `docker compose exec db-backup sh
  /usr/local/bin/db-backup.sh once`.
- Healthcheck của service = "đã có ít nhất 1 file backup".

## Khôi phục

```bash
./scripts/restore.sh [--yes] [--service db] <đường-dẫn-file-.sql.gz>
```

Script pipe file qua `docker compose exec -T db psql` nên **không cần psql
trên host**. File dump chứa DROP statements nên restore đè object hiện có;
xong script tự in số row 4 bảng để đối chiếu.

Lấy file backup từ volume ra host (để chép đi nơi khác hoặc restore):

```bash
docker run --rm -v gmov_pgbackups:/b -v /tmp:/o alpine cp /b/<file> /o/
```

## Test khôi phục thật (đã chạy 2026-09-15, xem báo cáo dưới)

Quy trình chuẩn để tự kiểm tra định kỳ:

1. `docker compose up -d` (stack sạch), tạo dữ liệu: register user, PUT
   progress, POST favorite.
2. Ghi nhận số liệu: `users / favorites / watch_progress` qua API.
3. Chạy backup thủ công (`... once`), copy file ra `/tmp`.
4. Giả lập mất dữ liệu: `docker compose stop db && docker volume rm gmov_pgdata`
   (volume `pgbackups` GIỮ NGUYÊN).
5. `docker compose up -d db` (volume mới trống, api tự migrate tạo schema trống).
6. `./scripts/restore.sh --yes /tmp/<file>`.
7. Verify: login được (bảng users), `continue-watching` và favorites còn nguyên.

## Báo cáo test khôi phục 2026-09-15 — ✅ PASS

Môi trường: stack compose build mới, `down -v` từ đầu.

1. **Seed**: register `restoreuser`, PUT progress
   (`mao/tap-7@777s`, `ve-dep/tap-full@100s`), POST favorite `mao`.
   Ground truth qua API: continue-watching
   `[(ve-dep,tap-full,100), (mao,tap-7,777)]`, favorites `[mao]`.
2. **Dump**: `exec db-backup ... once` → `gmov-20260915-Tue-073758.sql.gz`
   (2.0K). Soi dump: đủ 5 bảng + chứa `restoreuser`/`tap-7`.
3. **Wipe**: `stop db` → `rm -f db` → `volume rm gmov_pgdata` (volume
   `pgbackups` giữ nguyên) → `up -d db` → `restart api` (migrate lại schema
   trống). Verify: `users=0 progress=0 fav=0`.
4. **Restore**: `./scripts/restore.sh --yes /tmp/restore-test.sql.gz` →
   `users=1 favorites=1 watch_progress=2 refresh_tokens=1`, exit 0.
5. **Verify chức năng**: login `restoreuser` OK; continue-watching
   `[(mao,tap-7,777), (ve-dep,tap-full,100)]`; favorites `[mao]`;
   resume `mao` → `tap-7@777`. **Khớp 100% ground truth.**
6. **Rotation** (file giả đổi mtime): Mon 10 ngày tuổi bị xóa, Sun 40 ngày
   tuổi bị xóa, Sun 10 ngày tuổi được giữ, file hôm nay giữ nguyên.

Hai sự cố gặp lúc test (đã fix trước khi commit):
- Container chạy bằng UID host không ghi được volume mới (root-owned) →
  bỏ `user:`, chạy root, file 644 host vẫn đọc được.
- `docker volume rm` thất bại khi container stopped nhưng chưa `rm` →
  quy trình đúng ghi ở mục "Test khôi phục" trên.
