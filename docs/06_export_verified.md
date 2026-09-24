# 📁 คำสั่ง `export_verified` - คัดแยก/คัดลอก/Hardlink ไฟล์ที่ตรวจสอบแล้ว

คำสั่งสำหรับดึงเฉพาะรูปภาพและ Label ที่ผ่านการตรวจสอบสถานะ (`"checked": true` จาก Web Reviewer หรือ X-AnyLabeling) ส่งออกไปยังโฟลเดอร์ปลายทางที่กำหนด โดยสามารถเลือกสร้างเป็น **Hardlink** (ค่าเริ่มต้น: รวดเร็วทันที ไม่กินพื้นที่ดิสก์), **Copy** (คัดลอกไฟล์จริง) หรือ **Move** (ย้ายไฟล์) พร้อมทั้งสามารถสั่งแปลง Label เป็นฟอร์แมต YOLO `.txt` ควบคู่ไปด้วยได้

---

## 🌟 ฟีเจอร์เด่น (Key Features)

* **Verification Filtering**: กรองเฉพาะคู่ไฟล์ภาพและ JSON ที่มีสถานะ `"checked": true` เพื่อแยกข้อมูลคุณภาพสูงออกมา
* **Zero Storage Overhead (Hardlink Default)**: โหมด `hardlink` ไม่ต้องคัดลอกข้อมูลจริง ประหยัดพื้นที่จัดเก็บบนดิสก์ 100%
* **Direct Destination Control**: กำหนดปลายทางแยกอิสระระหว่าง `--image` และ `--label` หรือจะใช้โฟลเดอร์หลักผ่าน `--output` ให้สร้างโฟลเดอร์ย่อยอัตโนมัติก็ได้
* **Simultaneous YOLO TXT Conversion (`--to-yolo`)**: แปลง Label JSON ออกมาเป็นไฟล์ `.txt` พิกัด Normalize ตามมาตรฐาน YOLO พร้อมจัดเก็บคู่กันในโฟลเดอร์ label ปลายทาง
* **Auto-Discovery of Labels**: หากไม่ระบุ `--labels` ระบบจะค้นหาโฟลเดอร์ `label/` หรือ `labels/` ข้างเคียงให้อัตโนมัติ

---

## 💻 ตัวอย่างการใช้งาน

### 1. กำหนดโฟลเดอร์ปลายทาง `--image` และ `--label` โดยตรง (โหมด Hardlink)
```powershell
python main.py export_verified -i raw_datasets/images -l raw_datasets/labels --image verified_data/images --label verified_data/labels
```

### 2. กำหนดโฟลเดอร์ปลายทางหลักด้วย `--output`
```powershell
python main.py export_verified -i raw_datasets/images -l raw_datasets/labels -o verified_data/
```

### 3. สั่งแปลง Label เป็น YOLO `.txt` ควบคู่ไปด้วยในคำสั่งเดียว
```powershell
python main.py export_verified -i raw_datasets/images -l raw_datasets/labels --image verified_data/images --label verified_data/labels --to-yolo -c classes.txt
```

### 4. สลับโหมดเป็น Copy ไฟล์จริง (`--mode copy`) หรือ Move (`--mode move`)
```powershell
# คัดลอกไฟล์จริง
python main.py export_verified -i raw_datasets/images -l raw_datasets/labels -o verified_data/ --mode copy

# ย้ายไฟล์จริง
python main.py export_verified -i raw_datasets/images -l raw_datasets/labels -o verified_data/ --mode move
```

---

## 📋 พารามิเตอร์ทั้งหมด

| Flag | รูปแบบ | ค่าเริ่มต้น | คำอธิบาย |
|---|---|---|---|
| `--images`, `-i` | Path | *จำเป็น* | พาธโฟลเดอร์รูปภาพต้นทาง |
| `--labels`, `-l` | Path | `None` | พาธโฟลเดอร์ Label JSON ต้นทาง (หากไม่ระบุจะค้นหาโฟลเดอร์ข้างเคียงให้อัตโนมัติ) |
| `--image`, `--output-images` | Path | `None` | พาธโฟลเดอร์ปลายทางสำหรับจัดเก็บรูปภาพที่ตรวจสอบแล้ว |
| `--label`, `--output-labels` | Path | `None` | พาธโฟลเดอร์ปลายทางสำหรับจัดเก็บ Label ที่ตรวจสอบแล้ว |
| `--output`, `-o` | Path | `None` | โฟลเดอร์ปลายทางหลัก (หากระบุ จะสร้าง `images/` และ `labels/` ให้โดยอัตโนมัติ) |
| `--mode`, `-m` | Choice | `hardlink` | รูปแบบการจัดการไฟล์: `'hardlink'`, `'copy'`, หรือ `'move'` |
| `--to-yolo` | Flag | `False` | แปลง Label เป็นไฟล์ YOLO `.txt` ควบคู่ไปด้วย |
| `--classes-file`, `-c` | Path | `None` | ไฟล์ `classes.txt` สำหรับอ้างอิงลำดับ Class Index เมื่อแปลงเป็น YOLO |
| `--task`, `-t` | Choice | `detect` | รูปแบบ Annotation สำหรับ YOLO: `'detect'` หรือ `'obb'` |
