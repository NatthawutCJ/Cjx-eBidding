#!/bin/bash
# ---------------------------------------------------------------------------
# สำรองฐานข้อมูล Supabase ลงเครื่องตัวเอง
#
#   ครั้งแรก:  ./scripts/backup-db.sh --set-url     (วาง connection string ครั้งเดียว)
#   ครั้งต่อไป: ./scripts/backup-db.sh
#
# ทำไมต้องมี: โปรเจกต์แพ็กเกจฟรีของ Supabase "ไม่มีการสำรองอัตโนมัติ" และกู้เองไม่ได้
# ข้อมูลที่หายไปแล้วจึงหายถาวร ไฟล์นี้คือสิ่งเดียวที่กันเรื่องนั้นได้
#
# ไฟล์ที่ได้เก็บไว้ที่ backups/ (ไม่เข้า git) เอาไปไว้ที่อื่นด้วยจะปลอดภัยกว่า
# ---------------------------------------------------------------------------
set -u
cd "$(dirname "$0")/.." || exit 1

URL_FILE=".db-url"
OUT_DIR="backups"
STAMP=$(date +%Y-%m-%d_%H%M)

if [ "${1:-}" = "--set-url" ]; then
  echo "เอา connection string มาจาก: Supabase → Project Settings → Database →"
  echo "  Connection string → เลือกแบบ URI แล้วใส่รหัสผ่านฐานข้อมูลแทน [YOUR-PASSWORD]"
  echo
  printf 'วาง connection string แล้วกด Enter: '
  read -r db_url
  case "$db_url" in
    postgres://*|postgresql://*) ;;
    *) echo "ไม่ใช่ connection string — ต้องขึ้นต้นด้วย postgres:// หรือ postgresql://"; exit 1 ;;
  esac
  case "$db_url" in
    *"[YOUR-PASSWORD]"*) echo "ยังไม่ได้ใส่รหัสผ่านจริงแทน [YOUR-PASSWORD]"; exit 1 ;;
  esac
  printf '%s\n' "$db_url" > "$URL_FILE"
  chmod 600 "$URL_FILE"
  echo "บันทึกแล้วที่ app/$URL_FILE (อ่านได้เฉพาะเจ้าของเครื่อง ไม่เข้า git)"
  echo "สำรองข้อมูลได้เลยด้วย:  ./scripts/backup-db.sh"
  exit 0
fi

if [ ! -f "$URL_FILE" ]; then
  echo "ยังไม่ได้ตั้ง connection string — รัน:  ./scripts/backup-db.sh --set-url"
  exit 1
fi
DB_URL=$(cat "$URL_FILE")
mkdir -p "$OUT_DIR"

# โครงสร้าง (ตาราง ฟังก์ชัน policy) กับข้อมูล แยกไฟล์กัน
# โครงสร้างไว้สร้างระบบใหม่ ข้อมูลไว้กู้ของที่หาย
echo "กำลังสำรอง… (ครั้งแรกจะช้าหน่อยเพราะต้องโหลด Supabase CLI)"
npx --yes supabase@latest db dump --db-url "$DB_URL" -f "$OUT_DIR/$STAMP-schema.sql"        || exit 1
npx --yes supabase@latest db dump --db-url "$DB_URL" -f "$OUT_DIR/$STAMP-data.sql" --data-only || exit 1

echo
echo "เสร็จแล้ว:"
ls -lh "$OUT_DIR"/"$STAMP"-*.sql | awk '{print "  " $9 "  " $5}'
echo
echo "เก็บสำเนาไว้นอกเครื่องด้วย (OneDrive / Google Drive) — ถ้าเครื่องหายจะได้ไม่หายตาม"
echo "วิธีกู้กลับ: เปิดไฟล์ -data.sql แล้ววางใน SQL Editor หรือใช้ psql กับ connection string เดิม"
