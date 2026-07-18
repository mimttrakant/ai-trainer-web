from datetime import datetime

from sqlalchemy import BigInteger, Boolean, Column, DateTime, Integer, String, Text
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True)
    email = Column(String, unique=True)
    password = Column(String)
    role = Column(String, default="user")


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    description = Column(String)
    owner_id = Column(Integer)
    status = Column(String, default="draft")
    architecture_json = Column(String, default="{}")


class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, nullable=False, index=True)

    name = Column(String, nullable=False)
    description = Column(Text, default="")

    source_type = Column(String, nullable=False)
    source_url = Column(Text, nullable=True)
    original_filename = Column(String, nullable=True)
    storage_path = Column(Text, nullable=True)
    size_bytes = Column(BigInteger, default=0)

    status = Column(String, default="processing")
    error_message = Column(Text, nullable=True)

    # ผลลัพธ์จาก Dataset Scanner
    dataset_format = Column(String, nullable=True)
    image_count = Column(Integer, default=0)
    class_count = Column(Integer, default=0)
    class_names_json = Column(Text, default="[]")
    supported = Column(Boolean, default=False)
    unsupported_reason = Column(Text, nullable=True)
    split_type = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )
