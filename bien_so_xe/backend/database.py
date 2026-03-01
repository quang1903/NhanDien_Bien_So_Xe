from sqlalchemy import create_engine, Column, Integer, String, DateTime, Float, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

DATABASE_URL = "sqlite:///./bien_so.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class DetectionHistory(Base):
    __tablename__ = "detections"
    id          = Column(Integer, primary_key=True, index=True)
    plate_text  = Column(String)
    confidence  = Column(Float)
    source      = Column(String)
    detected_at = Column(DateTime, default=datetime.now)
    bbox        = Column(Text)
    event_type  = Column(String, default="vào")
    park_duration = Column(String, nullable=True) 

class Student(Base):
    __tablename__ = "students"
    id         = Column(Integer, primary_key=True, index=True)
    mssv       = Column(String(20), unique=True, nullable=False)
    ho_ten     = Column(String(100))
    lop        = Column(String(50))
    bien_so_xe = Column(String(20))
    avatar      = Column(String, nullable=True)  # ← thêm dòng này

def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
