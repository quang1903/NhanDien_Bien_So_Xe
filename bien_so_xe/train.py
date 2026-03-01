from ultralytics import YOLO

if __name__ == '__main__':
    model = YOLO("yolov8n.pt")

    model.train(
        data="dataset/Vietnam license-plate.v1i.yolov8/data.yaml",
        epochs=50,
        imgsz=640,
        batch=16,
        name="bien_so_vn",
        device=0,
        workers=0
    )

    print("✅ Train xong!")
    print("📁 File best.pt nằm ở: runs/detect/bien_so_vn/weights/best.pt")