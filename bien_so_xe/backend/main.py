from fastapi import FastAPI, UploadFile, File, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from database import get_db, init_db, DetectionHistory, Student
from detector import LicensePlateDetector
import cv2, numpy as np, io, base64, json
from PIL import Image
from datetime import datetime, timedelta
import shutil
from pathlib import Path

app = FastAPI(title="Nhận diện biển số xe")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory="../frontend/static"), name="static")
app.mount("/frontend", StaticFiles(directory="../frontend", html=True), name="frontend")

detector = LicensePlateDetector()
init_db()

Path("../frontend/static/avatars").mkdir(parents=True, exist_ok=True)
app.mount("/avatars", StaticFiles(directory="../frontend/static/avatars"), name="avatars")

# ========== HELPER ==========
def get_event_type(plate_text: str, db: Session):
    """Xác định xe vào hay ra, tính thời gian đỗ"""
    last = db.query(DetectionHistory)\
        .filter(DetectionHistory.plate_text == plate_text)\
        .order_by(DetectionHistory.detected_at.desc())\
        .first()

    if last and last.event_type == "vào":
        event_type = "ra"
        duration = datetime.now() - last.detected_at
        minutes = int(duration.total_seconds() / 60)
        park_duration = f"{minutes} phút" if minutes < 60 else f"{minutes//60} giờ {minutes%60} phút"
    else:
        event_type = "vào"
        park_duration = None

    return event_type, park_duration

# ========== UPLOAD ẢNH ==========
@app.post("/api/detect/image")
async def detect_image(file: UploadFile = File(...), db: Session = Depends(get_db)):
    contents = await file.read()
    img = Image.open(io.BytesIO(contents)).convert("RGB")
    img_np = np.array(img)

    detections = detector.detect(img_np)

    for d in detections:
        x1, y1, x2, y2 = d["bbox"]
        plate_text = d["plate_text"]

        event_type, park_duration = get_event_type(plate_text, db)
        d["event_type"] = event_type
        d["park_duration"] = park_duration

        color = (0, 255, 0) if event_type == "vào" else (0, 0, 255)
        cv2.rectangle(img_np, (x1,y1), (x2,y2), color, 2)
        cv2.putText(img_np, f"{plate_text} ({event_type})", (x1, y1-10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)

        student = db.query(Student).filter(Student.bien_so_xe == plate_text).first()
        d["student"] = {
            "mssv": student.mssv,
            "ho_ten": student.ho_ten,
            "lop": student.lop,
            "avatar": student.avatar
        } if student else None

        db.add(DetectionHistory(
            plate_text=plate_text,
            confidence=d["detect_confidence"],
            source="upload",
            bbox=json.dumps(d["bbox"]),
            event_type=event_type,
            park_duration=park_duration
        ))

    db.commit()

    _, buffer = cv2.imencode(".jpg", cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR))
    img_b64 = base64.b64encode(buffer).decode()

    return JSONResponse({
        "detections": detections,
        "result_image": f"data:image/jpeg;base64,{img_b64}"
    })

# ========== CAMERA REALTIME ==========
@app.websocket("/ws/camera")
async def camera_ws(websocket: WebSocket, db: Session = Depends(get_db)):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            img_data = base64.b64decode(data.split(",")[1])
            img = Image.open(io.BytesIO(img_data)).convert("RGB")
            img_np = np.array(img)

            detections = detector.detect(img_np)

            for d in detections:
                x1, y1, x2, y2 = d["bbox"]
                plate_text = d["plate_text"]

                event_type, park_duration = get_event_type(plate_text, db)
                d["event_type"] = event_type
                d["park_duration"] = park_duration

                color = (0, 255, 0) if event_type == "vào" else (0, 0, 255)
                cv2.rectangle(img_np, (x1,y1), (x2,y2), color, 2)
                cv2.putText(img_np, f"{plate_text} ({event_type})", (x1, y1-10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)

                student = db.query(Student).filter(Student.bien_so_xe == plate_text).first()
                d["student"] = {
                    "mssv": student.mssv,
                    "ho_ten": student.ho_ten,
                    "lop": student.lop,
                    "avatar": student.avatar
                } if student else None

                if plate_text != "Không đọc được":
                    db.add(DetectionHistory(
                        plate_text=plate_text,
                        confidence=d["detect_confidence"],
                        source="camera",
                        bbox=json.dumps(d["bbox"]),
                        event_type=event_type,
                        park_duration=park_duration
                    ))

            db.commit()

            _, buffer = cv2.imencode(".jpg", cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR))
            result_b64 = base64.b64encode(buffer).decode()

            await websocket.send_json({
                "detections": detections,
                "frame": f"data:image/jpeg;base64,{result_b64}"
            })

    except WebSocketDisconnect:
        pass

# ========== LỊCH SỬ ==========
@app.get("/api/history")
def get_history(
    limit: int = 100,
    event_type: str = None,  # "vào", "ra", None = tất cả
    filter_by: str = None,   # "today", "week", "month"
    db: Session = Depends(get_db)
):
    query = db.query(DetectionHistory)

    # Lọc theo loại sự kiện
    if event_type:
        query = query.filter(DetectionHistory.event_type == event_type)

    # Lọc theo thời gian
    now = datetime.now()
    if filter_by == "today":
        query = query.filter(DetectionHistory.detected_at >= now.replace(hour=0, minute=0, second=0))
    elif filter_by == "week":
        query = query.filter(DetectionHistory.detected_at >= now - timedelta(days=7))
    elif filter_by == "month":
        query = query.filter(DetectionHistory.detected_at >= now - timedelta(days=30))

    records = query.order_by(DetectionHistory.detected_at.desc()).limit(limit).all()

    return [{
        "id": r.id,
        "plate_text": r.plate_text,
        "confidence": round(r.confidence * 100, 1),
        "source": r.source,
        "detected_at": r.detected_at.strftime("%Y-%m-%d %H:%M:%S"),
        "event_type": r.event_type or "vào",
        "park_duration": r.park_duration
    } for r in records]

@app.delete("/api/history/{id}")
def delete_record(id: int, db: Session = Depends(get_db)):
    db.query(DetectionHistory).filter(DetectionHistory.id == id).delete()
    db.commit()
    return {"message": "Đã xóa"}

# ========== SINH VIÊN ==========
@app.post("/api/student")
def add_student(data: dict, db: Session = Depends(get_db)):
    existing = db.query(Student).filter(Student.mssv == data.get("mssv")).first()
    if existing:
        return JSONResponse(status_code=400, content={"message": "MSSV đã tồn tại!"})
    student = Student(**data)
    db.add(student)
    db.commit()
    db.refresh(student)
    return {"message": "Đã thêm sinh viên", "id": student.id}

@app.put("/api/student/{id}")
def update_student(id: int, data: dict, db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == id).first()
    if not student:
        return JSONResponse(status_code=404, content={"message": "Không tìm thấy"})
    for key, value in data.items():
        setattr(student, key, value)
    db.commit()
    return {"message": "Đã cập nhật"}

@app.delete("/api/student/{id}")
def delete_student(id: int, db: Session = Depends(get_db)):
    db.query(Student).filter(Student.id == id).delete()
    db.commit()
    return {"message": "Đã xóa"}

@app.post("/api/student/{id}/avatar")
async def upload_avatar(id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == id).first()
    if not student:
        return JSONResponse(status_code=404, content={"message": "Không tìm thấy"})

    ext = file.filename.split('.')[-1]
    filename = f"avatar_{id}.{ext}"
    path = f"../frontend/static/avatars/{filename}"

    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    student.avatar = f"/avatars/{filename}"
    db.commit()
    return {"avatar": student.avatar}

@app.get("/api/student/{bien_so}")
def get_student(bien_so: str, db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.bien_so_xe == bien_so).first()
    if not student:
        return JSONResponse(status_code=404, content={"message": "Không tìm thấy"})
    return {
        "id": student.id,
        "mssv": student.mssv,
        "ho_ten": student.ho_ten,
        "lop": student.lop,
        "bien_so_xe": student.bien_so_xe,
        "avatar": student.avatar
    }

@app.get("/api/students")
def get_all_students(db: Session = Depends(get_db)):
    students = db.query(Student).all()
    return [{
        "id": s.id,
        "mssv": s.mssv,
        "ho_ten": s.ho_ten,
        "lop": s.lop,
        "bien_so_xe": s.bien_so_xe,
        "avatar": s.avatar
    } for s in students]