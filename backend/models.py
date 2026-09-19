from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
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
    model_name = Column(String, nullable=True)
    version = Column(Integer, nullable=False, default=0)


class ProjectVersion(Base):
    __tablename__ = "project_versions"
    __table_args__ = (UniqueConstraint("project_id", "version", name="uq_project_version"),)

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, nullable=False, index=True)
    owner_id = Column(Integer, nullable=False, index=True)
    version = Column(Integer, nullable=False)
    model_name = Column(String, nullable=False)
    architecture_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ProjectEditorSession(Base):
    __tablename__ = "project_editor_sessions"
    session_id = Column(String, primary_key=True)
    project_id = Column(Integer, nullable=False, index=True)
    owner_id = Column(Integer, nullable=False)
    last_seen = Column(DateTime, nullable=False, index=True)


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


class TrainingJob(Base):
    __tablename__ = "training_jobs"

    id = Column(Integer, primary_key=True, index=True)

    owner_id = Column(Integer, nullable=False, index=True)
    project_id = Column(Integer, nullable=False, index=True)
    dataset_id = Column(Integer, nullable=False, index=True)
    dataset_name = Column(String, nullable=True)

    # new / continue / finetune
    mode = Column(String, default="new")

    # ใช้เมื่อ Train ต่อจาก Weight เดิม
    source_model_version_id = Column(Integer, nullable=True)
    project_version = Column(Integer, nullable=True)
    model_name = Column(String, nullable=True)
    architecture_json = Column(Text, nullable=True)

    # queued / training / completed / failed
    status = Column(String, default="queued")

    current_epoch = Column(Integer, default=0)
    total_epochs = Column(Integer, default=10)

    train_loss = Column(Float, nullable=True)
    val_loss = Column(Float, nullable=True)
    train_accuracy = Column(Float, nullable=True)
    val_accuracy = Column(Float, nullable=True)

    learning_rate = Column(Float, default=0.001)
    batch_size = Column(Integer, default=32)
    optimizer = Column(String, default="adam")

    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )
    finished_at = Column(DateTime, nullable=True)


class ModelVersion(Base):
    __tablename__ = "model_versions"

    id = Column(Integer, primary_key=True, index=True)

    owner_id = Column(Integer, nullable=False, index=True)
    project_id = Column(Integer, nullable=False, index=True)
    dataset_id = Column(Integer, nullable=False, index=True)
    dataset_name = Column(String, nullable=True)
    training_job_id = Column(Integer, nullable=False, index=True)

    name = Column(String, nullable=False)
    description = Column(Text, default="")
    version = Column(Integer, default=1)
    project_version = Column(Integer, nullable=True)

    pt_path = Column(Text, nullable=True)
    checkpoint_path = Column(Text, nullable=True)
    onnx_path = Column(Text, nullable=True)

    architecture_json = Column(Text, default="{}")
    class_names_json = Column(Text, default="[]")
    class_count = Column(Integer, default=0)

    best_accuracy = Column(Float, nullable=True)
    best_loss = Column(Float, nullable=True)
    epoch = Column(Integer, default=0)

    # private / public
    visibility = Column(String, default="private")

    allow_download = Column(Boolean, default=True)
    download_count = Column(Integer, default=0)
    use_count = Column(Integer, default=0)

    # Recoverable removal; retained rows prevent reusing exported version paths.
    deleted_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class TrainingMetric(Base):
    __tablename__ = "training_metrics"

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    training_job_id = Column(
        Integer,
        nullable=False,
        index=True,
    )

    epoch = Column(
        Integer,
        nullable=False,
    )

    train_loss = Column(
        Float,
        nullable=True,
    )

    val_loss = Column(
        Float,
        nullable=True,
    )

    train_accuracy = Column(
        Float,
        nullable=True,
    )

    val_accuracy = Column(
        Float,
        nullable=True,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )
