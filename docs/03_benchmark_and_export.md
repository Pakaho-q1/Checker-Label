# 📊 คำสั่ง `benchmark`, `convert` & `export`

ชุดคำสั่งสำหรับการประเมินผลโมเดล (Evaluation), การสลับฟอร์แมต Annotation และการส่งออกโมเดลสำหรับนำไปใช้งานต่อ

---

## 1. 📈 `benchmark` - ประเมินประสิทธิภาพโมเดล

ประเมินคะแนนความแม่นยำอย่างเป็นทางการ (mAP50, mAP50-95, Precision, Recall) บนชุดข้อมูล `val` หรือ `test`

### ตัวอย่างคำสั่ง:
```powershell
# วัดผลบน Test Set
python main.py benchmark --weights runs/train/yolo_model/weights/best.pt --data data.yaml --split test

# วัดผลบน Validation Set
python main.py benchmark --weights runs/train/yolo_model/weights/best.pt --data data.yaml --split val
```

### พารามิเตอร์:
* `--weights`, `-w`: พาธไปยังไฟล์ weight โมเดล *(จำเป็น)*
* `--data`, `-d`: ไฟล์ `data.yaml` (ค่าเริ่มต้น: `data.yaml`)
* `--split`: ชุดข้อมูลที่ต้องการวัดผล (`val` หรือ `test`) (ค่าเริ่มต้น: `test`)
* `--batch`, `-b`: ขนาด Batch size (ค่าเริ่มต้น: `16`)
* `--device`: อุปกรณ์ประมวลผล เช่น `0` หรือ `cpu`

---

## 2. 🔄 `convert` - สลับฟอร์แมต TXT <-> JSON

ใช้สำหรับแปลงข้อมูลสลับไปมาระหว่าง **YOLO TXT** และ **Annotation JSON** เพื่อความสะดวกในการเปิดตรวจทานหรือแก้ไขในโปรแกรม Annotation

### ตัวอย่างคำสั่ง:
```powershell
# แปลงจาก YOLO TXT ไปเป็น Annotation JSON (บันทึกคู่กับไฟล์ภาพ)
python main.py convert --data data.yaml --mode txt_to_json

# แปลงจาก Annotation JSON กลับเป็น YOLO TXT (เซฟลง labels/)
python main.py convert --data data.yaml --mode json_to_txt
```

### พารามิเตอร์:
* `--data`, `-d`: พาธไปยังไฟล์ `data.yaml` (ค่าเริ่มต้น: `data.yaml`)
* `--mode`, `-m`: โหมดการแปลง: `txt_to_json` หรือ `json_to_txt` (ค่าเริ่มต้น: `txt_to_json`)
* `--split`, `-s`: ชุดข้อมูลที่ต้องการแปลง เช่น `train`, `val`, `test` หรือ `all` (ค่าเริ่มต้น: `all`)
* `--limit`, `-l`: จำกัดจำนวนไฟล์ที่ต้องการแปลง (สำหรับการทดสอบ)

---

## 3. 📤 `export` - ส่งออกโมเดล ONNX พร้อมไฟล์ Config

แปลงโมเดล `.pt` เป็นฟอร์แมต `.onnx` มาตรฐาน พร้อมสร้างไฟล์ตั้งค่า `custom_model.yaml` สำหรับนำไปโหลดเข้าโปรแกรม Annotation หรือนำไป Deploy ใช้งานต่อได้ทันที

### ตัวอย่างคำสั่ง:
```powershell
python main.py export --weights runs/train/yolo_model/weights/best.pt --imgsz 640 --opset 12
```

### พารามิเตอร์:
* `--weights`, `-w`: พาธไปยังไฟล์โมเดล `.pt` *(จำเป็น)*
* `--imgsz`: Resolution ภาพสำหรับ Export (ค่าเริ่มต้น: `640`)
* `--opset`: เวอร์ชัน ONNX Opset (ค่าเริ่มต้น: `12`)
