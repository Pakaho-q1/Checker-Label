# 🚀 คำสั่ง `train` - สั่งเทรนโมเดล YOLO, Fine-Tuning & Data Augmentation

เครื่องมือสำหรับสั่งเทรนโมเดล YOLO (รองรับ YOLOv8, YOLOv9, YOLOv11, YOLOv12 และสถาปัตยกรรมที่รองรับโดย Ultralytics) พร้อมรองรับทั้งโมเดล Bounding Box ทั่วไป (`detect`) และโมเดล 4 จุด (`obb`)

---

## 🌟 ฟีเจอร์เด่น (Key Features)

1. **Flexible Training Modes**:
   - **From Scratch / Pretrained**: เริ่มต้นเทรนจาก Pretrained weights ของ Ultralytics เช่น `yolo11n.pt`, `yolo11s.pt`, `yolo11n-obb.pt`
   - **Fine-Tuning (FT)**: นำโมเดลเดิมที่มีอยู่ (`best.pt`) มาเทรนต่อบน Dataset ชุดใหม่ พร้อมปรับ Learning Rate และ Freeze Backbone
   - **Resume**: เทรนต่อจาก checkpoint ล่าสุด (`last.pt`) ได้ทันทีหากการเทรนหยุดชะงัก
2. **Backbone Layer Freezing**:
   - ล็อคชั้นประมวลผลฟีเจอร์หลัก (Backbone) เพื่อรักษาน้ำหนักเดิมไว้ แล้วเทรนเฉพาะ Detection Head เหมาะสำหรับการจูนโมเดลกับชุดข้อมูลขนาดเล็ก
3. **Comprehensive Augmentation Suite**:
   - ควบคุมการเพิ่มข้อมูลอัตโนมัติ (Augmentations) เช่น การหมุน 360 องศา, การพลิกภาพ, การปรับเฉดสี/ความสว่าง และการสุ่มบิดมุมมอง (Perspective)
   - ปิด Mosaic ในรอบสุดท้าย (`close_mosaic`) เพื่อให้ขอบเขต Bounding Box มีความแม่นยำสูงสุด
4. **Auto Export to ONNX**:
   - แปลงโมเดลเป็นฟอร์แมต ONNX พร้อมสร้างไฟล์ YAML สำหรับ AnyLabeling ให้อัตโนมัติเมื่อเทรนเสร็จสิ้น

---

## 💻 ตัวอย่างการใช้งาน

### 1. เทรนโมเดลใหม่จาก Pretrained Weights
```powershell
# โมเดล Bounding Box ปกติ
python main.py train --model yolo11n.pt --data data.yaml --epochs 100 --batch 16 --device 0

# โมเดล 4-point OBB (Oriented Bounding Box)
python main.py train --model yolo11n-obb.pt --data data.yaml --epochs 100 --batch 16 --device 0
```

### 2. Fine-Tuning (FT) จาก `best.pt` เดิม
```powershell
python main.py train --model runs/train/yolo_model/weights/best.pt --data data.yaml --epochs 50 --lr0 0.001 --freeze 10
```

### 3. Resume เทรนต่อจากจุดเดิม
```powershell
python main.py train --model runs/train/yolo_model/weights/last.pt --resume
```

### 4. ปิด Augmentation (สำหรับชุดข้อมูลที่ต้องการเทรนแบบ Clean Data)
```powershell
python main.py train --model yolo11n.pt --data data.yaml --no-augment
```

### 5. ปรับแต่งพารามิเตอร์ Augmentation เอง
```powershell
python main.py train --model yolo11n.pt --data data.yaml --degrees 90.0 --scale 0.3 --hsv-v 0.2
```

---

## 📋 พารามิเตอร์ทั้งหมด

| Flag | ชนิด | ค่าเริ่มต้น | คำอธิบาย |
|---|---|---|---|
| `--model`, `-m` | String | `yolo11n.pt` | โมเดลเริ่มต้น (`yolo11n.pt`, `yolo11s-obb.pt`, หรือพาธ `best.pt`) |
| `--data`, `-d` | Path | `data.yaml` | ไฟล์ config yaml ของ dataset |
| `--epochs`, `-e` | Int | `100` | จำนวนรอบการเทรน (Epochs) |
| `--batch`, `-b` | Int | `16` | ขนาด Batch size |
| `--imgsz` | Int | `640` | ขนาด Resolution ของภาพ |
| `--device` | String | `0` | การระบุ Device เช่น `0`, `0,1`, หรือ `cpu` |
| `--workers`, `-w` | Int | `4` | จำนวน Dataloader workers |
| `--patience`, `-p` | Int | `20` | Early stopping patience (หยุดเมื่อค่าไม่พัฒนาติดต่อกัน N epochs) |
| `--project` | String | `runs/train` | โฟลเดอร์ปลายทางสำหรับบันทึกผลลัพธ์ |
| `--name`, `-n` | String | `yolo_model` | ชื่อโฟลเดอร์รันย่อย |
| `--no-export` | Flag | `False` | ปิดการแปลงเป็น ONNX อัตโนมัติหลังเทรนเสร็จ |
| `--resume` | Flag | `False` | เทรนต่อจาก Checkpoint `last.pt` |
| `--freeze` | Int | `None` | ล็อคจำนวนชั้น Backbone layers (เช่น `10`) |
| `--lr0` | Float | `None` | Initial Learning rate (แนะนำ `0.001` สำหรับ Fine-Tuning) |
| `--augment` / `--no-augment` | Bool | `True` | เปิด/ปิด Data Augmentation ทั้งหมด |
| `--degrees` | Float | `180.0` | องศาสุ่มหมุนภาพ (0.0 ถึง 180.0) |
| `--fliplr` | Float | `0.5` | สัดส่วนการสุ่มพลิกภาพซ้าย-ขวา |
| `--flipud` | Float | `0.5` | สัดส่วนการสุ่มพลิกภาพบน-ล่าง |
| `--perspective` | Float | `0.001` | ระดับการสุ่มบิดมุมมอง Perspective |
| `--shear` | Float | `5.0` | องศาสุ่มดึงภาพเฉียง |
| `--scale` | Float | `0.5` | สัดส่วนการสุ่มย่อ-ขยายภาพ (+/- 50%) |
| `--hsv-v` | Float | `0.4` | สัดส่วนการสุ่มปรับความสว่าง |
| `--close-mosaic` | Int | `10` | จำนวนรอบสุดท้ายที่จะปิด Mosaic augmentation |
