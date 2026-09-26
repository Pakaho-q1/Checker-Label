import sys
import argparse
from pathlib import Path

# ปรับ encoding สำหรับ Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from core.dataset_builder import build_dataset
from core.trainer import train_yolo
from core.benchmarker import benchmark_model
from core.converter import load_yaml_config, convert_text_to_json, convert_json_to_text
from core.exporter import export_model
from core.auto_labeler import run_auto_label
from core.web.server import start_web_server
from core.verified_exporter import export_verified_dataset
from core.auditor import run_audit


def main():
    parser = argparse.ArgumentParser(
        prog="main.py",
        description="🛠️ YOLO All-in-One CLI Toolkit (Training, Benchmarking, Dataset Building, Web Reviewer & Verification Exporter)",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    subparsers = parser.add_subparsers(dest="command", help="คำสั่งที่ต้องการรัน")

    # -------------------------------------------------------------
    # Subcommand: build_dataset
    # -------------------------------------------------------------
    build_parser = subparsers.add_parser(
        "build_dataset",
        aliases=["build_datasets", "build-dataset"],
        help="สร้าง YOLO Dataset จาก Annotation JSON พร้อม Hardlink และ Stratified Split"
    )
    build_parser.add_argument(
        "--source", "--inputs", "-i", "--raw", "-r", "--xanylabeling", "-x",
        dest="source",
        nargs="+",
        required=True,
        help="พาธโฟลเดอร์รูปภาพและ Annotation JSON ต้นทาง (ระบุ 1 โฟลเดอร์รวม หรือ 2 โฟลเดอร์ที่แยกภาพกับ json)"
    )
    build_parser.add_argument(
        "--output", "-o",
        type=str,
        default="datasets",
        help="โฟลเดอร์ปลายทางสำหรับ YOLO dataset (ค่าเริ่มต้น: datasets)"
    )
    build_parser.add_argument(
        "--split", "-s",
        type=str,
        default="70/20/10",
        help="สัดส่วน Train/Val/Test เช่น 70/20/10 หรือ 80-10-10 หรือ 80/20 (ค่าเริ่มต้น: 70/20/10)"
    )
    build_parser.add_argument(
        "--task", "-t",
        type=str,
        choices=["detect", "obb"],
        default="detect",
        help="รูปแบบ Annotation: 'detect' (Bbox ทั่วไป) หรือ 'obb' (4-Point Oriented Bounding Box) (ค่าเริ่มต้น: detect)"
    )
    build_parser.add_argument(
        "--classes-file", "-c",
        type=str,
        default="classes.txt",
        help="ไฟล์ classes.txt ที่ระบุลำดับคลาส (ถ้ามี)"
    )
    build_parser.add_argument(
        "--data-yaml", "-d",
        type=str,
        default="data.yaml",
        help="พาธไฟล์ data.yaml ที่จะสร้างหรืออัปเดต (ค่าเริ่มต้น: data.yaml)"
    )
    build_parser.add_argument(
        "--prioritize-verified",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="ให้ความสำคัญกับไฟล์ที่ผ่านการตรวจสอบแล้ว (checked: true) นำไปใส่ใน Val และ Test เสมอ (ค่าเริ่มต้น: True)"
    )
    build_parser.add_argument(
        "--only-verified",
        action="store_true",
        default=False,
        help="ใช้เฉพาะไฟล์ที่ตรวจสอบแล้วเท่านั้นในการสร้าง Dataset (ตัดไฟล์ที่ยังไม่ตรวจออกทั้งหมด)"
    )
    build_parser.add_argument(
        "--strict-val-test",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="กำหนดให้ชุด Val และ Test มีเฉพาะไฟล์ที่ตรวจแล้ว 100%% เท่านั้น (ค่าเริ่มต้น: True)"
    )

    # -------------------------------------------------------------
    # Subcommand: train
    # -------------------------------------------------------------
    train_parser = subparsers.add_parser(
        "train",
        help="สั่งเทรนโมเดล YOLO (รองรับทั้ง Detect และ OBB 4-point)"
    )
    train_parser.add_argument(
        "--template", "-t",
        type=str,
        default=None,
        help="พาทไฟล์ YAML สำหรับตั้งค่า Training (ถ้าใช้ จะละเว้น config ใน command line บางส่วน)"
    )
    train_parser.add_argument(
        "--model", "-m",
        type=str,
        default="yolo11n.pt",
        help="โมเดลตั้งต้นหรือ checkpoint (เช่น yolo11n.pt, yolo11n-obb.pt, yolov8n.pt)"
    )
    train_parser.add_argument(
        "--data", "-d",
        type=str,
        default="data.yaml",
        help="พาธไปยังไฟล์ data.yaml (ค่าเริ่มต้น: data.yaml)"
    )
    train_parser.add_argument(
        "--epochs", "-e",
        type=int,
        default=100,
        help="จำนวนรอบการเทรน (ค่าเริ่มต้น: 100)"
    )
    train_parser.add_argument(
        "--batch", "-b",
        type=int,
        default=16,
        help="ขนาด Batch size (ค่าเริ่มต้น: 16)"
    )
    train_parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="ขนาด Resolution ภาพ (ค่าเริ่มต้น: 640)"
    )
    train_parser.add_argument(
        "--device",
        type=str,
        default="0",
        help="Device ที่ใช้เทรน: '0', '1', หรือ 'cpu' (ค่าเริ่มต้น: 0)"
    )
    train_parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="จำนวน Worker threads (ค่าเริ่มต้น: 4)"
    )
    train_parser.add_argument(
        "--patience",
        type=int,
        default=20,
        help="Early stopping patience epochs (ค่าเริ่มต้น: 20)"
    )
    train_parser.add_argument(
        "--project",
        type=str,
        default="runs/train",
        help="โฟลเดอร์ปลายทางสำหรับเก็บผลลัพธ์ (ค่าเริ่มต้น: runs/train)"
    )
    train_parser.add_argument(
        "--name",
        type=str,
        default="yolo_model",
        help="ชื่อโมเดลย่อย (ค่าเริ่มต้น: yolo_model)"
    )
    train_parser.add_argument(
        "--no-export",
        action="store_true",
        help="ปิดการ Auto-export เป็น ONNX หลังเทรนเสร็จ"
    )
    train_parser.add_argument(
        "--resume",
        action="store_true",
        help="เทรนต่อจาก checkpoint ล่าสุด (last.pt) อัตโนมัติ"
    )
    train_parser.add_argument(
        "--freeze",
        type=int,
        default=None,
        help="Freeze จำนวนชั้น backbone layers สำหรับ Fine-tuning (เช่น 10)"
    )
    train_parser.add_argument(
        "--lr0",
        type=float,
        default=None,
        help="Initial Learning Rate สำหรับ Fine-tuning (เช่น 0.001 หรือ 0.0005)"
    )
    # Augmentation Configs
    train_parser.add_argument(
        "--augment",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="เปิด/ปิด Data Augmentation (เปิดใช้งานเป็นค่าเริ่มต้น, ใช้ --no-augment เพื่อปิด)"
    )
    train_parser.add_argument(
        "--degrees",
        type=float,
        default=180.0,
        help="องศาการสุ่มหมุนภาพ (ค่าเริ่มต้น: 180.0)"
    )
    train_parser.add_argument(
        "--fliplr",
        type=float,
        default=0.5,
        help="ความน่าจะเป็นในการพลิกซ้าย-ขวา (ค่าเริ่มต้น: 0.5 หรือ 50%%)"
    )
    train_parser.add_argument(
        "--flipud",
        type=float,
        default=0.5,
        help="ความน่าจะเป็นในการพลิกบน-ล่าง (ค่าเริ่มต้น: 0.5 หรือ 50%%)"
    )
    train_parser.add_argument(
        "--perspective",
        type=float,
        default=0.001,
        help="ระดับการสุ่มบิดมุมมอง Perspective (ค่าเริ่มต้น: 0.001)"
    )
    train_parser.add_argument(
        "--shear",
        type=float,
        default=5.0,
        help="องศาการสุ่มดึงเฉียงภาพ Shear (ค่าเริ่มต้น: 5.0)"
    )
    train_parser.add_argument(
        "--scale",
        type=float,
        default=0.5,
        help="สัดส่วนการสุ่มย่อ-ขยาย Scale (ค่าเริ่มต้น: 0.5 หรือบวกลบ 50%%)"
    )
    train_parser.add_argument(
        "--hsv-v",
        type=float,
        default=0.4,
        help="สัดส่วนการสุ่มปรับความสว่าง Value (ค่าเริ่มต้น: 0.4)"
    )
    train_parser.add_argument(
        "--close-mosaic",
        type=int,
        default=10,
        help="จำนวนรอบสุดท้ายที่จะปิด Mosaic augmentation (ค่าเริ่มต้น: 10)"
    )

    # -------------------------------------------------------------
    # Subcommand: benchmark
    # -------------------------------------------------------------
    bench_parser = subparsers.add_parser(
        "benchmark",
        aliases=["val"],
        help="วัดผลและประเมินประสิทธิภาพโมเดลบนชุดข้อมูล Val หรือ Test"
    )
    bench_parser.add_argument(
        "--weights", "-w",
        type=str,
        required=True,
        help="พาธไปยังไฟล์ weight โมเดล เช่น runs/train/yolo_model/weights/best.pt"
    )
    bench_parser.add_argument(
        "--data", "-d",
        type=str,
        default="data.yaml",
        help="พาธไปยังไฟล์ data.yaml (ค่าเริ่มต้น: data.yaml)"
    )
    bench_parser.add_argument(
        "--split",
        type=str,
        default="test",
        choices=["test", "val", "train"],
        help="ชุดข้อมูลที่ต้องการวัดผล (ค่าเริ่มต้น: test)"
    )
    bench_parser.add_argument(
        "--batch", "-b",
        type=int,
        default=16,
        help="ขนาด Batch size (ค่าเริ่มต้น: 16)"
    )
    bench_parser.add_argument(
        "--device",
        type=str,
        default="0",
        help="Device ที่ใช้ประเมินผล: '0' หรือ 'cpu' (ค่าเริ่มต้น: 0)"
    )

    # -------------------------------------------------------------
    # Subcommand: convert
    # -------------------------------------------------------------
    conv_parser = subparsers.add_parser(
        "convert",
        help="แปลงสลับฟอร์แมตเดิมระหว่าง YOLO TXT <-> Annotation JSON"
    )
    conv_parser.add_argument(
        "--data", "-d",
        type=str,
        required=True,
        help="พาธไปยังไฟล์ data.yaml"
    )
    conv_parser.add_argument(
        "--mode", "-m",
        type=str,
        choices=["txt_to_json", "json_to_txt"],
        required=True,
        help="โหมดการแปลง: 'txt_to_json' หรือ 'json_to_txt'"
    )
    conv_parser.add_argument(
        "--split",
        type=str,
        default="all",
        choices=["all", "train", "val", "test"],
        help="เลือก Split ที่ต้องการแปลง (ค่าเริ่มต้น: all)"
    )
    conv_parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="จำกัดจำนวนไฟล์ (ค่าเริ่มต้น: ทั้งหมด)"
    )

    # -------------------------------------------------------------
    # Subcommand: export
    # -------------------------------------------------------------
    exp_parser = subparsers.add_parser(
        "export",
        help="Export โมเดลเป็น ONNX พร้อมสร้าง config yaml สำหรับโปรแกรม Label"
    )
    exp_parser.add_argument(
        "--weights", "-w",
        type=str,
        required=True,
        help="พาธไปยังไฟล์ weight โมเดล เช่น runs/train/yolo_model/weights/best.pt"
    )
    exp_parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Resolution ภาพ (ค่าเริ่มต้น: 640)"
    )
    exp_parser.add_argument(
        "--opset",
        type=int,
        default=12,
        help="ONNX Opset version (ค่าเริ่มต้น: 12)"
    )

    # -------------------------------------------------------------
    # Subcommand: auto_label
    # -------------------------------------------------------------
    auto_parser = subparsers.add_parser(
        "auto_label",
        aliases=["autolabel"],
        help="รันโมเดล Auto-Labeling บน GPU ทั้งโฟลเดอร์เพื่อสร้าง Annotation JSON"
    )
    auto_parser.add_argument(
        "--model", "-m",
        type=str,
        default=None,
        help="พาธโมเดล เช่น runs/train/yolo_model/weights/best.pt"
    )
    auto_parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="พาทไฟล์ YAML สำหรับตั้งค่า Ensemble"
    )
    auto_parser.add_argument(
        "--images", "-i",
        type=str,
        required=True,
        help="พาธโฟลเดอร์รูปภาพที่ต้องการ Auto-label"
    )
    auto_parser.add_argument(
        "--output", "-o",
        type=str,
        default=None,
        help="โฟลเดอร์สำหรับแยกบันทึกไฟล์ JSON (หากไม่ระบุจะบันทึกเคียงข้างรูปภาพเดิม)"
    )
    auto_parser.add_argument(
        "--conf", "-c",
        type=float,
        default=0.45,
        help="Confidence threshold หลัก สำหรับบันทึกกล่องลงใน shapes (ค่าเริ่มต้น: 0.45)"
    )
    auto_parser.add_argument(
        "--conf-min", "--raw-conf",
        type=float,
        default=0.15,
        help="Confidence ขั้นต่ำสำหรับเก็บ candidate ลง raw_shapes เพื่อตรวจใน Web UI (ค่าเริ่มต้น: 0.15)"
    )
    auto_parser.add_argument(
        "--iou",
        type=float,
        default=0.45,
        help="IOU / NMS threshold (ค่าเริ่มต้น: 0.45)"
    )
    auto_parser.add_argument(
        "--batch", "-b",
        type=int,
        nargs="?",
        const=16,
        default=16,
        help="ขนาด Batch size ในการรันบน GPU (ค่าเริ่มต้น: 16)"
    )
    auto_parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Resolution ภาพ (ค่าเริ่มต้น: 640)"
    )
    auto_parser.add_argument(
        "--device",
        type=str,
        default="0",
        help="Device ที่ใช้ประมวลผล: '0' (GPU) หรือ 'cpu' (ค่าเริ่มต้น: 0)"
    )
    auto_parser.add_argument(
        "--no-half",
        action="store_true",
        help="ปิดการประมวลผลแบบ FP16 (ปกติเปิดใช้งานอัตโนมัติบน GPU)"
    )

    # -------------------------------------------------------------
    # Subcommand: web
    # -------------------------------------------------------------
    web_parser = subparsers.add_parser(
        "web",
        help="เปิด Web UI สำหรับตรวจสอบและแก้ไข BBox บนมือถือ/PC"
    )
    web_parser.add_argument(
        "--images", "-i",
        type=str,
        required=True,
        help="พาธโฟลเดอร์รูปภาพ"
    )
    web_parser.add_argument(
        "--labels", "-l",
        type=str,
        default=None,
        help="พาธโฟลเดอร์ label JSON (หากไม่ระบุจะค้นหาในโฟลเดอร์เดียวกับภาพ)"
    )
    web_parser.add_argument(
        "--classes", "-c",
        type=str,
        default=None,
        help="พาธไฟล์ classes.txt หรือ data.yaml สำหรับอ่านรายชื่อคลาส"
    )
    web_parser.add_argument(
        "--host",
        type=str,
        default="0.0.0.0",
        help="IP Address สำหรับ Bind เซิร์ฟเวอร์ (ค่าเริ่มต้น: 0.0.0.0)"
    )
    web_parser.add_argument(
        "--port", "-p",
        type=int,
        default=8000,
        help="Port สำหรับรัน Web Server (ค่าเริ่มต้น: 8000)"
    )

    # -------------------------------------------------------------
    # Subcommand: audit
    # -------------------------------------------------------------
    audit_parser = subparsers.add_parser(
        "audit",
        help="ตรวจสอบและกรองรูปภาพที่ไม่ได้คุณภาพ (ภาพเล็ก, ภาพซ้ำ) ออกจาก Dataset"
    )
    audit_parser.add_argument(
        "--images", "-i",
        type=str,
        required=True,
        help="พาธโฟลเดอร์รูปภาพ"
    )
    audit_parser.add_argument(
        "--labels", "-l",
        type=str,
        default=None,
        help="พาธโฟลเดอร์ JSON"
    )
    audit_parser.add_argument(
        "--out-images", "-o",
        type=str,
        default=None,
        help="โฟลเดอร์ปลายทางสำหรับย้ายไฟล์ขยะ (ภาพ) ไปกักกัน (Quarantine)"
    )
    audit_parser.add_argument(
        "--template", "-t",
        type=str,
        default=None,
        help="พาทไฟล์ YAML สำหรับตั้งค่า Audit"
    )
    audit_parser.add_argument(
        "--out-labels",
        type=str,
        default=None,
        help="โฟลเดอร์ปลายทางสำหรับย้ายไฟล์ขยะ (JSON) ไปกักกัน"
    )
    audit_parser.add_argument(
        "--mode", "-m",
        type=str,
        choices=["move", "copy", "hardlink"],
        default="move",
        help="วิธีการจัดการไฟล์ขยะ (move = ย้ายออก, copy = คัดลอก, hardlink)"
    )
    audit_parser.add_argument(
        "--width", "-w",
        type=int,
        default=0,
        help="ความกว้างขั้นต่ำ (น้อยกว่านี้ = ไฟล์ขยะ)"
    )
    audit_parser.add_argument(
        "--height",
        type=int,
        default=0,
        help="ความสูงขั้นต่ำ (น้อยกว่านี้ = ไฟล์ขยะ)"
    )
    audit_parser.add_argument(
        "--duplicate", "-d",
        type=int,
        default=-1,
        help="ระดับความเหมือนของภาพซ้ำ (0=เหมือน 100%, 2-4=คล้ายมาก) แนะนำ: 2"
    )

    # -------------------------------------------------------------
    # Subcommand: export_verified
    # -------------------------------------------------------------
    exp_ver_parser = subparsers.add_parser(
        "export_verified",
        aliases=["export-verified", "filter_verified", "filter-verified"],
        help="คัดแยก / คัดลอก / Hardlink ไฟล์ภาพและ Label ที่ตรวจสอบแล้ว (checked: true) ไปยังโฟลเดอร์ปลายทาง"
    )
    exp_ver_parser.add_argument(
        "--images", "-i",
        type=str,
        required=True,
        help="พาธโฟลเดอร์รูปภาพต้นทาง"
    )
    exp_ver_parser.add_argument(
        "--labels", "-l",
        type=str,
        default=None,
        help="พาธโฟลเดอร์ Label JSON ต้นทาง (หากไม่ระบุจะค้นหาในโฟลเดอร์เดียวกับภาพหรือโฟลเดอร์ label ข้างเคียง)"
    )
    exp_ver_parser.add_argument(
        "--image", "--output-images",
        type=str,
        default=None,
        help="พาธโฟลเดอร์ปลายทางสำหรับรูปภาพที่ตรวจสอบแล้ว"
    )
    exp_ver_parser.add_argument(
        "--label", "--output-labels",
        type=str,
        default=None,
        help="พาธโฟลเดอร์ปลายทางสำหรับ Label ที่ตรวจสอบแล้ว"
    )
    exp_ver_parser.add_argument(
        "--output", "-o",
        type=str,
        default=None,
        help="โฟลเดอร์ปลายทางหลัก (หากระบุ จะสร้างโฟลเดอร์ย่อย images/ และ labels/ ให้โดยอัตโนมัติ)"
    )
    exp_ver_parser.add_argument(
        "--mode", "-m",
        type=str,
        choices=["hardlink", "copy", "move"],
        default="hardlink",
        help="รูปแบบการจัดการไฟล์: 'hardlink' (ไม่เปลืองพื้นที่ดิสก์), 'copy' (คัดลอกไฟล์จริง), หรือ 'move' (ย้ายไฟล์) (ค่าเริ่มต้น: hardlink)"
    )
    exp_ver_parser.add_argument(
        "--to-yolo",
        action="store_true",
        default=False,
        help="แปลง Label เป็นไฟล์ YOLO .txt ควบคู่ไปด้วย"
    )
    exp_ver_parser.add_argument(
        "--classes-file", "-c",
        type=str,
        default=None,
        help="ไฟล์ classes.txt สำหรับอ้างอิงลำดับ Class เมื่อแปลงเป็น YOLO (ถ้ามี)"
    )
    exp_ver_parser.add_argument(
        "--task", "-t",
        type=str,
        choices=["detect", "obb"],
        default="detect",
        help="รูปแบบ Annotation สำหรับ YOLO: 'detect' หรือ 'obb' (ค่าเริ่มต้น: detect)"
    )

    # Parse args
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    if args.command in ["build_dataset", "build_datasets", "build-dataset"]:
        classes_path = Path(args.classes_file) if args.classes_file else None
        build_dataset(
            source_paths=args.source,
            output_dir=Path(args.output),
            split_str=args.split,
            task=args.task,
            classes_file=classes_path,
            data_yaml_path=Path(args.data_yaml) if args.data_yaml else None,
            prioritize_verified=args.prioritize_verified,
            only_verified=args.only_verified,
            strict_val_test=args.strict_val_test
        )

    elif args.command == "train":
        train_yolo(
            model_name=args.model,
            data_yaml=args.data,
            epochs=args.epochs,
            imgsz=args.imgsz,
            batch=args.batch,
            device=args.device,
            workers=args.workers,
            patience=args.patience,
            project=args.project,
            name=args.name,
            auto_export=not args.no_export,
            resume=args.resume,
            freeze=args.freeze,
            lr0=args.lr0,
            augment=args.augment,
            degrees=args.degrees,
            fliplr=args.fliplr,
            flipud=args.flipud,
            perspective=args.perspective,
            shear=args.shear,
            scale=args.scale,
            hsv_v=args.hsv_v,
            close_mosaic=args.close_mosaic,
            config_file=args.template
        )

    elif args.command in ["benchmark", "val"]:
        benchmark_model(
            weights_path=args.weights,
            data_yaml=args.data,
            split=args.split,
            batch=args.batch,
            device=args.device
        )

    elif args.command == "convert":
        base_path, id_to_name, name_to_id, splits = load_yaml_config(Path(args.data).resolve())
        if args.split != "all":
            splits = [s for s in splits if (s[0] if isinstance(s, tuple) else str(s)) == args.split]

        if args.mode == "txt_to_json":
            convert_text_to_json(base_path, splits, id_to_name, limit=args.limit)
        elif args.mode == "json_to_txt":
            convert_json_to_text(base_path, splits, name_to_id, limit=args.limit)

    elif args.command == "export":
        export_model(
            weights_path=args.weights,
            imgsz=args.imgsz,
            opset=args.opset
        )

    elif args.command in ["auto_label", "autolabel"]:
        run_auto_label(
            model_path=args.model,
            images_dir=args.images,
            output_dir=args.output,
            conf_threshold=args.conf,
            conf_min=args.conf_min,
            iou_threshold=args.iou,
            batch_size=args.batch,
            imgsz=args.imgsz,
            device=args.device,
            half=not args.no_half,
            config_file=args.config
        )

    elif args.command == "web":
        start_web_server(
            images_dir=args.images,
            labels_dir=args.labels,
            classes_file=args.classes,
            host=args.host,
            port=args.port
        )

    elif args.command == "audit":
        run_audit(
            images_dir=args.images,
            labels_dir=args.labels,
            out_images=args.out_images,
            out_labels=args.out_labels,
            mode=args.mode,
            min_width=args.width,
            min_height=args.height,
            dup_threshold=args.duplicate,
            config_file=args.template
        )

    elif args.command in ["export_verified", "export-verified", "filter_verified", "filter-verified"]:
        export_verified_dataset(
            source_images=args.images,
            source_labels=args.labels,
            output_image=args.image,
            output_label=args.label,
            output_base=args.output,
            mode=args.mode,
            to_yolo=args.to_yolo,
            task=args.task,
            classes_file=args.classes_file
        )


if __name__ == "__main__":
    main()
