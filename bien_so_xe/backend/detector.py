from ultralytics import YOLO
import cv2
import numpy as np
import re
import requests
import base64

PLATE_RECOGNIZER_TOKEN = "baa1b973545d60ef7bd628778974dbe1b876e119"

class LicensePlateDetector:
    def __init__(self, model_path="../weights/best.pt"):
        try:
            self.model = YOLO(model_path)
            print("✅ Loaded model fine-tuned")
        except:
            print("⚠️  Dùng yolov8n.pt tạm thời")
            self.model = YOLO("yolov8n.pt")
        print("✅ Dùng Plate Recognizer API")

    def clean_plate(self, text):
        text = text.upper()
        text = re.sub(r'[^A-Z0-9]', '', text)
        return text

    def ocr_with_api(self, img_np):
        """Gọi Plate Recognizer API để đọc biển số"""
        try:
            _, buffer = cv2.imencode('.jpg', img_np)
            img_base64 = base64.b64encode(buffer).decode('utf-8')

            response = requests.post(
                'https://api.platerecognizer.com/v1/plate-reader/',
                data=dict(upload=f'data:image/jpeg;base64,{img_base64}'),
                headers={'Authorization': f'Token {PLATE_RECOGNIZER_TOKEN}'}
            )

            data = response.json()

            if 'results' in data and len(data['results']) > 0:
                result = data['results'][0]
                plate = self.clean_plate(result['plate'])
                score = float(result['score'])
                return plate, score

        except Exception as e:
            print(f"API error: {e}")

        return "Không đọc được", 0.0

    def detect(self, img_np):
        # Thử dùng API trực tiếp trên ảnh gốc trước
        plate_text, ocr_conf = self.ocr_with_api(img_np)

        if plate_text != "Không đọc được" and len(plate_text) >= 6:
            # API đọc được rồi, vẽ bbox luôn
            h, w = img_np.shape[:2]
            return [{
                "bbox": [0, 0, w, h],
                "plate_text": plate_text,
                "detect_confidence": 1.0,
                "ocr_confidence": ocr_conf
            }]

        # Nếu API không đọc được thì dùng YOLO crop rồi gọi API
        results = self.model(img_np, conf=0.5)
        detections = []

        for box in results[0].boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            conf = float(box.conf[0])

            pad = 8
            x1 = max(0, x1 - pad)
            y1 = max(0, y1 - pad)
            x2 = min(img_np.shape[1], x2 + pad)
            y2 = min(img_np.shape[0], y2 + pad)

            cropped = img_np[y1:y2, x1:x2]
            if cropped.size == 0:
                continue

            plate_text, ocr_conf = self.ocr_with_api(cropped)

            detections.append({
                "bbox": [x1, y1, x2, y2],
                "plate_text": plate_text,
                "detect_confidence": conf,
                "ocr_confidence": ocr_conf
            })

        return detections