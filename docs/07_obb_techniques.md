# 💡 เทคนิคสำหรับโมเดล 4-Point OBB (Oriented Bounding Box)

ในงาน Computer Vision หลายประเภท วัตถุที่ต้องการตรวจจับมักไม่ได้วางตัวขนานกับแกนภาพ เช่น ป้ายทะเบียนรถยนต์, บัตรประชาชน/เครดิตการ์ด, ฉลากสินค้า, หน้าจอ, ใบเสร็จ หรือตัวอักษรที่เอียงตามมุมกล้อง การใช้ Bounding Box สี่เหลี่ยมปกติ (`detect`) จะทำให้มีพื้นที่พื้นหลังปะปนเข้ามามาก การใช้ **Oriented Bounding Box (OBB)** จึงช่วยเพิ่มความแม่นยำได้อย่างมหาศาล

---

## 📐 ความแตกต่างระหว่าง Detect vs OBB

| คุณสมบัติ | Standard Detect (Axis-Aligned) | Oriented Bounding Box (4-Point OBB) |
|---|---|---|
| **ฟอร์แมตพิกัด** | `class_id x_center y_center width height` (5 ค่า) | `class_id x1 y1 x2 y2 x3 y3 x4 y4` (9 ค่า) |
| **มุมของกรอบ** | ขนานกับแกน X และ Y เสมอ | หมุนและเอียงตามแนวระนาบของวัตถุได้อิสระ |
| **ความเหมาะสม** | วัตถุตั้งตรงทั่วไป เช่น คน, รถยนต์, สัตว์ | วัตถุที่หมุน เอียง หรือต้องการดัดภาพ เช่น การ์ด, เอกสาร, ป้าย |
| **โมเดลที่แนะนำ** | `yolo11n.pt`, `yolo11s.pt`, `yolo11m.pt` | `yolo11n-obb.pt`, `yolo11s-obb.pt` |

---

## 🛠️ ขั้นตอนการทำ Workflow สำหรับ 4-Point OBB

### 1. การ Label ข้อมูลบน X-AnyLabeling
* **เครื่องมือ Polygon / Rotation Box**:
  * ใช้เครื่องมือ **Polygon** ปักจุด 4 จุดเรียงตามมุมเข็มนาฬิกา: บนซ้าย -> บนขวา -> ล่างขวา -> ล่างซ้าย
  * หรือใช้เครื่องมือ **Rotation Box / Rectangle** เพื่อกำหนดกรอบพร้อมมุมเอียง
* **การตั้งชื่อ Class**:
  * กำหนดชื่อคลาสตามวัตถุ เช่น `license_plate`, `id_card`, `receipt_box`, `screen_display`, `label_rotated`

### 2. การสร้าง Dataset ด้วย `--task obb`
เมื่อรันคำสั่ง `build_dataset` ให้ระบุ flag `--task obb`:
```powershell
python main.py build_dataset --xanylabeling raw_datasets/images raw_datasets/labels --task obb --split 80/10/10
```
ระบบจะดึงพิกัดจุด 4 จุดจากไฟล์ JSON มาแปลงเป็นพิกัด Normalize 8 ค่าตามมาตรฐาน YOLO OBB โดยอัตโนมัติ

### 3. การสั่งเทรนโมเดล OBB
ใช้โมเดล OBB Pretrained weights เช่น `yolo11n-obb.pt`:
```powershell
python main.py train --model yolo11n-obb.pt --data data.yaml --epochs 100 --batch 16 --device 0
```

### 4. การนำผลทำนาย 4 จุดไปดัดระนาบตรง (Perspective Warp)
เมื่อโมเดลทำนายพิกัด 4 จุด (`pts`) ออกมาได้ สามารถนำไปตัดและดัดภาพให้ขนานตรง 100% ด้วยฟังก์ชัน OpenCV:

```python
import cv2
import numpy as np

def warp_perspective_crop(image, pts_4points, target_w=640, target_h=400):
    """
    ดัดภาพตามพิกัด 4 จุดให้เป็นสี่เหลี่ยมระนาบตรงคมชัด
    pts_4points: array shape (4, 2) เรียง [top-left, top-right, bottom-right, bottom-left]
    """
    dst_pts = np.array([
        [0, 0],
        [target_w - 1, 0],
        [target_w - 1, target_h - 1],
        [0, target_h - 1]
    ], dtype=np.float32)

    src_pts = np.array(pts_4points, dtype=np.float32)
    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    warped = cv2.warpPerspective(image, M, (target_w, target_h))
    return warped
```

> **ผลลัพธ์**: ภาพวัตถุที่ผ่านการ Warp จะมีความตรงและขอบขนานระนาบ 100% พร้อมสำหรับการส่งต่อไปยัง OCR สำหรับอ่านตัวหนังสือ หรือโมเดลจำแนกคุณลักษณะต่อไป
