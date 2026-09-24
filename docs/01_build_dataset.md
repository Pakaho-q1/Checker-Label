# 📦 คำสั่ง `build_dataset` - สร้าง Dataset และแยก Train/Val/Test

เครื่องมือสำหรับสแกนรูปภาพและไฟล์ Annotation JSON จาก **X-AnyLabeling** เพื่อจัดทำเป็นชุดข้อมูลมาตรฐานสำหรับเทรน YOLO พร้อมคุณสมบัติขั้นสูงสำหรับการจัดการข้อมูลขนาดใหญ่

---

## 🌟 ฟีเจอร์เด่น (Key Features)

1. **Smart Folder Detection**:
   - รองรับทั้งการเก็บรูปและ JSON รวมกันในโฟลเดอร์เดียว หรือแยกโฟลเดอร์รูปภาพกับ Label (ระบบจะตรวจสอบโครงสร้างและจับคู่อัตโนมัติ)
2. **Automatic Negative Samples (Background Images)**:
   - ตรวจจับรูปภาพที่ไม่มีวัตถุ (ทั้งรูปที่ไม่มีไฟล์ JSON และรูปที่ JSON ว่างเปล่า `shapes: []`)
   - สร้างไฟล์ `.txt` ว่างเปล่า (0 bytes) ให้โดยอัตโนมัติตามข้อกำหนดของ Ultralytics YOLO เพื่อช่วยลดปัญหา False Positive
   - รายงานสถิติจำนวนภาพ Negative ในตารางสรุปผล
3. **Smart Class Auto-Discovery**:
   - ค้นหาไฟล์ `classes.txt` โดยอัตโนมัติจากโฟลเดอร์ภาพ, โฟลเดอร์ label หรือโฟลเดอร์แม่
   - รวบรวม Class เพิ่มเติมที่มีอยู่ใน Annotation ทั้งหมดเข้ามาให้อย่างครบถ้วน
4. **Human-in-the-Loop & Verification-Aware Split (Gold Standard)**:
   - ตรวจสอบสถานะการยืนยัน (`checked: true`) ที่ได้จากเครื่องมือ Web Reviewer หรือ X-AnyLabeling
   - จัดสรรไฟล์ที่มนุษย์ตรวจสอบแล้ว 100% ไปเป็นชุด **Validation (`val`)** และ **Test (`test`)** เป็นลำดับแรก เพื่อให้ได้ชุดวัดผลที่เชื่อถือได้ ปราศจาก Label Noise
   - หากไฟล์ที่ตรวจสอบแล้วมีมากกว่าโควต้า Val/Test ส่วนเกินจะถูกส่งกลับเข้าไปใน **Train** เพื่อเป็น Ground Truth สำหรับโมเดล
   - มีโหมด `--only-verified` สำหรับเลือกเทรนเฉพาะข้อมูลที่ผ่านการตรวจสอบแล้วเท่านั้น
5. **Greedy Multilabel Stratified Split**:
   - เกลี่ยสัดส่วนของทุกคลาส รวมถึงภาพ Negative กระจายลงใน `train`, `val`, และ `test` อย่างสมดุลที่สุด
6. **Zero-Copy NTFS Hardlink**:
   - เชื่อมโยงไฟล์ภาพไปยัง `datasets/images/` ด้วย **Hardlink** ทำให้ไม่เปลืองพื้นที่จัดเก็บบนดิสก์ซ้ำซ้อน และประมวลผลเสร็จในระดับเสี้ยววินาที (หากปลายทางอยู่ต่างไดรฟ์จะสลับเป็น Copy อัตโนมัติ)
7. **Auto-Generate `data.yaml`**:
   - สร้างหรืออัปเดตไฟล์ config YAML สำหรับ YOLO ให้ตรงกับชุดคลาสและโครงสร้างพาธทันที

---

## 💻 ตัวอย่างการใช้งาน

### 1. สร้าง Dataset แบบมาตรฐาน (แนะนำ: จัดสรรไฟล์ที่ตรวจแล้วเป็น Val/Test อัตโนมัติ)
```powershell
python main.py build_dataset --xanylabeling raw_datasets/images raw_datasets/labels --split 80/10/10 --task detect
```

### 2. เทรนเฉพาะไฟล์ที่ผ่านการตรวจสอบแล้วเท่านั้น (`--only-verified`)
```powershell
python main.py build_dataset --xanylabeling raw_datasets/images raw_datasets/labels --only-verified --split 80/10/10
```

### 3. กรณีที่รูปภาพและ JSON รวมอยู่ในโฟลเดอร์เดียวกัน
```powershell
python main.py build_dataset --xanylabeling my_dataset/ --split 70/20/10
```

### 4. สร้าง Dataset สำหรับโมเดล 4-Point OBB (`--task obb`)
```powershell
python main.py build_dataset --xanylabeling raw_datasets/images raw_datasets/labels --task obb --split 80/10/10
```

---

## 📋 พารามิเตอร์ทั้งหมด

| Flag | รูปแบบ | ค่าเริ่มต้น | คำอธิบาย |
|---|---|---|---|
| `--xanylabeling`, `-x` | Path(s) | *จำเป็น* | โฟลเดอร์อินพุต (1 โฟลเดอร์รวม หรือ 2 โฟลเดอร์แยกภาพ/json) |
| `--output`, `-o` | Path | `datasets` | โฟลเดอร์ปลายทางที่จะสร้าง `images/` และ `labels/` |
| `--split`, `-s` | String | `70/20/10` | สัดส่วน Train/Val/Test เช่น `70/20/10`, `80-10-10`, `80/20` |
| `--task`, `-t` | String | `detect` | รูปแบบ Annotation: `detect` (Bounding Box ปกติ) หรือ `obb` (4-point OBB) |
| `--classes-file`, `-c`| Path | `classes.txt` | ไฟล์อ้างอิงลำดับคลาส (มี Smart Auto-Discovery ค้นหาให้อัตโนมัติ) |
| `--data-yaml`, `-d` | Path | `data.yaml` | ไฟล์ config yaml สำหรับนำไปสั่งเทรน YOLO |
| `--prioritize-verified` / `--no-prioritize-verified` | Bool | `True` | จัดสรรไฟล์ที่ยืนยันแล้ว (`checked: true`) ให้เป็น Val และ Test ก่อนเสมอ |
| `--only-verified` | Flag | `False` | กรองใช้เฉพาะไฟล์ที่ตรวจสอบแล้วเท่านั้นในการสร้าง Dataset |
| `--strict-val-test` / `--no-strict-val-test` | Bool | `True` | สงวนชุด Val และ Test ให้มีเฉพาะไฟล์ที่ตรวจแล้ว 100% เท่านั้น |
