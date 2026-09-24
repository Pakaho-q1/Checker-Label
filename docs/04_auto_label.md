# ⚡ คำสั่ง `auto_label` - Batch GPU Auto-Labeling ทั้งโฟลเดอร์

คำสั่งสำหรับนำโมเดล YOLO ที่เทรนเสร็จแล้วมารัน Inference บนการ์ดจอ (GPU) แบบ **Batch Processing** เพื่อตรวจจับและสร้างไฟล์ Annotation `.json` ของ **X-AnyLabeling** ให้กับรูปภาพใหม่ทั้งโฟลเดอร์โดยอัตโนมัติ

---

## 🌟 ฟีเจอร์เด่น (Key Features)

* **High-Speed GPU Batching**: รองรับการส่งภาพเข้าโมเดลแบบ Batch (เช่น 16 หรือ 32 ภาพต่อรอบ) ทำให้ประมวลผลเร็วกว่าการรันทีละภาพหลายเท่าตัว
* **FP16 Half-Precision Acceleration**: เปิดใช้งานโหมด Half Precision อัตโนมัติบน GPU เพื่อเพิ่มความเร็วในการ Inference สูงสุดและประหยัด VRAM
* **X-AnyLabeling Compatible Output**: สร้างไฟล์ `.json` ที่มีโครงสร้างตรงตามมาตรฐาน X-AnyLabeling ทันที พร้อมเปิดตรวจทานและแก้ไขได้ในคลิกเดียว
* **Flexible Destination**: สามารถเลือกบันทึกไฟล์ `.json` ไว้เคียงข้างรูปภาพเดิม หรือแยกออกไปยังโฟลเดอร์ใหม่ได้อย่างอิสระ

---

## 💻 ตัวอย่างการใช้งาน

### 1. บันทึกไฟล์ JSON เคียงข้างรูปภาพเดิม (Default)
```powershell
python main.py auto_label --model runs/train/yolo_model/weights/best.pt --images new_images/ --batch 16 --device 0
```

### 2. แยกบันทึกไฟล์ JSON ไปยังโฟลเดอร์ปลายทางอื่น (`--output`)
```powershell
python main.py auto_label --model runs/train/yolo_model/weights/best.pt --images new_images/ --output auto_labels/ --batch 16
```

### 3. ปรับค่าความมั่นใจ (Confidence) และ IOU Threshold
```powershell
python main.py auto_label --model runs/train/yolo_model/weights/best.pt --images new_images/ --conf 0.50 --iou 0.40
```

---

## 📋 พารามิเตอร์ทั้งหมด

| Flag | รูปแบบ | ค่าเริ่มต้น | คำอธิบาย |
|---|---|---|---|
| `--model`, `-m` | Path | *จำเป็น* | พาธไฟล์โมเดล เช่น `runs/train/yolo_model/weights/best.pt` |
| `--images`, `-i` | Path | *จำเป็น* | พาธโฟลเดอร์รูปภาพที่ต้องการสั่ง Auto-label |
| `--output`, `-o` | Path | `None` | โฟลเดอร์สำหรับแยกบันทึกไฟล์ JSON (หากไม่ระบุจะบันทึกข้างรูปภาพเดิม) |
| `--conf`, `-c` | Float | `0.45` | ระดับ Confidence Threshold ในการตรวจจับวัตถุ |
| `--iou` | Float | `0.45` | ระดับ NMS IOU Threshold สำหรับตัดกรอบซ้อนทับ |
| `--batch`, `-b` | Int | `16` | ขนาด Batch size บน GPU |
| `--imgsz` | Int | `640` | ขนาด Resolution ของภาพสำหรับ Inference |
| `--device` | String | `0` | อุปกรณ์ประมวลผล เช่น `0` (GPU) หรือ `cpu` |
| `--no-half` | Flag | `False` | ปิด FP16 (ปกติจะเปิดใช้งานอัตโนมัติเมื่อรันบน GPU) |
