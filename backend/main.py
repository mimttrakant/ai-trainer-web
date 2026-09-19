import json
import shutil
import zipfile

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from auth import hash_password, verify_password
from database import engine, get_db
from model_routes import router as model_router
from project_versioning import migrate_project_versions, save_project_version, snapshot_project, router as project_version_router
from dataset_service import (
    apply_scan_result,
    calculate_folder_size,
    get_dataset_folder,
    process_url_dataset,
    remove_dataset_folder,
    safe_extract_zip,
)
from models import (
    Base,
    Dataset,
    ModelVersion,
    Project,
    TrainingJob,
    TrainingMetric,
    User,
)
from schemas import (
    ArchitectureUpdate,
    DatasetUrlCreate,
    ProjectCreate,
    TrainingJobCreate,
    UserLogin,
    UserRegister,
)


Base.metadata.create_all(bind=engine)
migrate_project_versions(engine)


def ensure_dataset_scanner_columns() -> None:
    """
    create_all() ไม่เพิ่ม Column ให้ตารางเดิม
    ฟังก์ชันนี้เพิ่ม Column Scanner ให้ฐานข้อมูลเดิมโดยไม่ต้องลบข้อมูล
    """
    statements = [
        "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS dataset_format VARCHAR",
        "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS image_count INTEGER DEFAULT 0",
        "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS class_count INTEGER DEFAULT 0",
        "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS class_names_json TEXT DEFAULT '[]'",
        "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS supported BOOLEAN DEFAULT FALSE",
        "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS unsupported_reason TEXT",
        "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS split_type VARCHAR",
    ]

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


ensure_dataset_scanner_columns()

# Additive migration for databases created before model removal was supported.
with engine.begin() as connection:
    connection.execute(text("ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP"))

app = FastAPI()
app.include_router(model_router)
app.include_router(project_version_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


def parse_class_names(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []

    try:
        value = json.loads(raw_value)
        return value if isinstance(value, list) else []
    except json.JSONDecodeError:
        return []


def serialize_dataset(dataset: Dataset) -> dict:
    return {
        "id": dataset.id,
        "owner_id": dataset.owner_id,
        "name": dataset.name,
        "description": dataset.description,
        "source_type": dataset.source_type,
        "source_url": dataset.source_url,
        "original_filename": dataset.original_filename,
        "storage_path": dataset.storage_path,
        "size_bytes": dataset.size_bytes,
        "status": dataset.status,
        "error_message": dataset.error_message,

        "dataset_format": dataset.dataset_format,
        "image_count": dataset.image_count or 0,
        "class_count": dataset.class_count or 0,
        "class_names": parse_class_names(dataset.class_names_json),
        "supported": bool(dataset.supported),
        "unsupported_reason": dataset.unsupported_reason,
        "split_type": dataset.split_type,

        "created_at": (
            dataset.created_at.isoformat()
            if dataset.created_at
            else None
        ),
        "updated_at": (
            dataset.updated_at.isoformat()
            if dataset.updated_at
            else None
        ),
    }


def serialize_training_job(training_job: TrainingJob) -> dict:
    return {
        "id": training_job.id,
        "owner_id": training_job.owner_id,
        "project_id": training_job.project_id,
        "dataset_id": training_job.dataset_id,
        "mode": training_job.mode,
        "source_model_version_id": training_job.source_model_version_id,
        "project_version": training_job.project_version,
        "model_name": training_job.model_name,
        "status": training_job.status,

        "current_epoch": training_job.current_epoch or 0,
        "total_epochs": training_job.total_epochs or 0,

        "train_loss": training_job.train_loss,
        "val_loss": training_job.val_loss,
        "train_accuracy": training_job.train_accuracy,
        "val_accuracy": training_job.val_accuracy,

        "learning_rate": training_job.learning_rate,
        "batch_size": training_job.batch_size,
        "optimizer": training_job.optimizer,

        "error_message": training_job.error_message,

        "created_at": (
            training_job.created_at.isoformat()
            if training_job.created_at
            else None
        ),
        "updated_at": (
            training_job.updated_at.isoformat()
            if training_job.updated_at
            else None
        ),
        "finished_at": (
            training_job.finished_at.isoformat()
            if training_job.finished_at
            else None
        ),
    }


def serialize_model_version(model_version: ModelVersion) -> dict:
    return {
        "id": model_version.id,
        "owner_id": model_version.owner_id,
        "project_id": model_version.project_id,
        "dataset_id": model_version.dataset_id,
        "training_job_id": model_version.training_job_id,

        "name": model_version.name,
        "description": model_version.description,
        "version": model_version.version,
        "project_version": model_version.project_version,

        "pt_path": model_version.pt_path,
        "checkpoint_path": model_version.checkpoint_path,
        "onnx_path": model_version.onnx_path,

        "class_names": parse_class_names(
            model_version.class_names_json
        ),

        "class_count": model_version.class_count,

        "best_accuracy": model_version.best_accuracy,
        "best_loss": model_version.best_loss,
        "epoch": model_version.epoch,

        "visibility": model_version.visibility,
        "allow_download": model_version.allow_download,

        "created_at": (
            model_version.created_at.isoformat()
            if model_version.created_at
            else None
        ),
    }


@app.get("/training/job/{job_id}/metrics")
def get_training_metrics(
    job_id: int,
    owner_id: int,
    db: Session = Depends(get_db),
):
    job = (
        db.query(TrainingJob)
        .filter(
            TrainingJob.id == job_id,
            TrainingJob.owner_id == owner_id,
        )
        .first()
    )

    if not job:
        return {
            "success": False,
            "message": "Training job not found or access denied",
        }

    metrics = (
        db.query(TrainingMetric)
        .filter(
            TrainingMetric.training_job_id == job_id
        )
        .order_by(
            TrainingMetric.epoch.asc()
        )
        .all()
    )

    return {
        "success": True,
        "job_id": job_id,

        "metrics": [
            {
                "epoch": metric.epoch,

                "train_loss": metric.train_loss,
                "val_loss": metric.val_loss,

                "train_accuracy": (
                    metric.train_accuracy
                ),

                "val_accuracy": (
                    metric.val_accuracy
                ),
            }
            for metric in metrics
        ],
    }


@app.get("/")
def root():
    return {"message": "AI Trainer Backend Ready"}


@app.post("/register")
def register(
    user: UserRegister,
    db: Session = Depends(get_db),
):
    existing_user = (
        db.query(User)
        .filter(
            or_(
                User.email == user.email,
                User.username == user.username,
            )
        )
        .first()
    )

    if existing_user:
        message = (
            "Email already exists"
            if existing_user.email == user.email
            else "Username already exists"
        )

        return {
            "success": False,
            "message": message,
        }

    new_user = User(
        username=user.username,
        email=user.email,
        password=hash_password(user.password),
        role="user",
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "success": True,
        "message": "User created",
    }


@app.post("/login")
def login(
    user: UserLogin,
    db: Session = Depends(get_db),
):
    db_user = (
        db.query(User)
        .filter(
            or_(
                User.email == user.identifier,
                User.username == user.identifier,
            )
        )
        .first()
    )

    if not db_user:
        return {
            "success": False,
            "message": "Username or email not found",
        }

    if not verify_password(user.password, db_user.password):
        return {
            "success": False,
            "message": "Incorrect password",
        }

    return {
        "success": True,
        "message": "Login success",
        "user": {
            "id": db_user.id,
            "username": db_user.username,
            "email": db_user.email,
            "role": db_user.role,
        },
    }


@app.post("/projects")
def create_project(
    project: ProjectCreate,
    db: Session = Depends(get_db),
):
    new_project = Project(
        name=project.name,
        description=project.description,
        owner_id=project.owner_id,
        status="draft",
        architecture_json="{}",
        model_name=project.name,
        version=0,
    )

    db.add(new_project)
    db.commit()
    db.refresh(new_project)

    return {
        "success": True,
        "message": "Project created",
        "project": {
            "id": new_project.id,
            "name": new_project.name,
            "description": new_project.description,
            "owner_id": new_project.owner_id,
            "status": new_project.status,
            "model_name": new_project.model_name,
            "version": new_project.version,
        },
    }


@app.get("/projects/{owner_id}")
def get_projects(
    owner_id: int,
    db: Session = Depends(get_db),
):
    projects = (
        db.query(Project)
        .filter(Project.owner_id == owner_id)
        .all()
    )

    return {
        "success": True,
        "projects": projects,
    }


@app.get("/project/{project_id}")
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if not project:
        return {
            "success": False,
            "message": "Project not found",
        }

    return {
        "success": True,
        "project": {
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "owner_id": project.owner_id,
            "status": project.status,
            "architecture_json": project.architecture_json,
            "model_name": project.model_name,
            "version": project.version,
        },
    }


@app.delete("/projects/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if not project:
        return {
            "success": False,
            "message": "Project not found",
        }

    db.delete(project)
    db.commit()

    return {
        "success": True,
        "message": "Project deleted",
    }


@app.put("/projects/{project_id}/architecture")
def update_architecture(
    project_id: int,
    data: ArchitectureUpdate,
    db: Session = Depends(get_db),
):
    return save_project_version(db, project_id, data)


@app.post("/datasets/upload")
def upload_dataset_zip(
    owner_id: int = Form(...),
    name: str = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    owner = (
        db.query(User)
        .filter(User.id == owner_id)
        .first()
    )

    if not owner:
        return {
            "success": False,
            "message": "User not found",
        }

    if not file.filename or not file.filename.lower().endswith(".zip"):
        return {
            "success": False,
            "message": "Only ZIP files are supported",
        }

    dataset = Dataset(
        owner_id=owner_id,
        name=name.strip(),
        description=description.strip(),
        source_type="zip",
        original_filename=file.filename,
        status="uploading",
    )

    db.add(dataset)
    db.commit()
    db.refresh(dataset)

    folder = get_dataset_folder(owner_id, dataset.id)
    zip_path = folder / "source.zip"
    extract_path = folder / "files"

    try:
        folder.mkdir(parents=True, exist_ok=True)

        with zip_path.open("wb") as output:
            shutil.copyfileobj(
                file.file,
                output,
                length=1024 * 1024,
            )

        if not zipfile.is_zipfile(zip_path):
            raise ValueError(
                "Uploaded file is not a valid ZIP file"
            )

        dataset.status = "processing"
        db.commit()

        safe_extract_zip(zip_path, extract_path)

        dataset.storage_path = str(folder)
        dataset.size_bytes = calculate_folder_size(extract_path)

        apply_scan_result(dataset, extract_path)

        dataset.error_message = None
        zip_path.unlink(missing_ok=True)

        db.commit()
        db.refresh(dataset)

        message = (
            "Dataset uploaded and is ready for training"
            if dataset.supported
            else "Dataset uploaded, but its structure is not supported"
        )

        return {
            "success": True,
            "message": message,
            "dataset": serialize_dataset(dataset),
        }

    except Exception as exc:
        dataset.status = "failed"
        dataset.error_message = str(exc)
        db.commit()

        return {
            "success": False,
            "message": str(exc),
            "dataset": serialize_dataset(dataset),
        }

    finally:
        file.file.close()


@app.post("/datasets/url")
def create_dataset_from_url(
    data: DatasetUrlCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    owner = (
        db.query(User)
        .filter(User.id == data.owner_id)
        .first()
    )

    if not owner:
        return {
            "success": False,
            "message": "User not found",
        }

    dataset = Dataset(
        owner_id=data.owner_id,
        name=data.name.strip(),
        description=data.description.strip(),
        source_type="url",
        source_url=str(data.source_url),
        status="processing",
    )

    db.add(dataset)
    db.commit()
    db.refresh(dataset)

    background_tasks.add_task(
        process_url_dataset,
        dataset.id,
    )

    return {
        "success": True,
        "message": "Dataset download started",
        "dataset": serialize_dataset(dataset),
    }


@app.get("/datasets/{owner_id}")
def get_user_datasets(
    owner_id: int,
    db: Session = Depends(get_db),
):
    datasets = (
        db.query(Dataset)
        .filter(Dataset.owner_id == owner_id)
        .order_by(Dataset.created_at.desc())
        .all()
    )

    return {
        "success": True,
        "datasets": [
            serialize_dataset(item)
            for item in datasets
        ],
    }


@app.get("/dataset/{dataset_id}")
def get_dataset(
    dataset_id: int,
    db: Session = Depends(get_db),
):
    dataset = (
        db.query(Dataset)
        .filter(Dataset.id == dataset_id)
        .first()
    )

    if not dataset:
        return {
            "success": False,
            "message": "Dataset not found",
        }

    return {
        "success": True,
        "dataset": serialize_dataset(dataset),
    }


@app.delete("/datasets/{dataset_id}")
def delete_dataset(
    dataset_id: int,
    owner_id: int,
    db: Session = Depends(get_db),
):
    dataset = (
        db.query(Dataset)
        .filter(
            Dataset.id == dataset_id,
            Dataset.owner_id == owner_id,
        )
        .first()
    )

    if not dataset:
        return {
            "success": False,
            "message": "Dataset not found or access denied",
        }

    storage_path = (
        dataset.storage_path
        or str(
            get_dataset_folder(
                dataset.owner_id,
                dataset.id,
            )
        )
    )

    remove_dataset_folder(storage_path)

    db.delete(dataset)
    db.commit()

    return {
        "success": True,
        "message": "Dataset and files deleted",
    }


@app.post("/training/jobs")
def create_training_job(
    job: TrainingJobCreate,
    db: Session = Depends(get_db),
):
    # 1. ตรวจสอบว่าผู้ใช้มีอยู่จริง
    owner = (
        db.query(User)
        .filter(User.id == job.owner_id)
        .first()
    )

    if not owner:
        return {
            "success": False,
            "message": "User not found",
        }

    # 2. ตรวจสอบว่า Project มีอยู่และเป็นของผู้ใช้นี้
    project = (
        db.query(Project)
        .filter(
            Project.id == job.project_id,
            Project.owner_id == job.owner_id,
        )
        .with_for_update()
        .populate_existing()
        .first()
    )

    if not project:
        return {
            "success": False,
            "message": "Project not found or access denied",
        }

    # 3. ตรวจสอบว่า Dataset มีอยู่และเป็นของผู้ใช้นี้
    dataset = (
        db.query(Dataset)
        .filter(
            Dataset.id == job.dataset_id,
            Dataset.owner_id == job.owner_id,
        )
        .first()
    )

    if not dataset:
        return {
            "success": False,
            "message": "Dataset not found or access denied",
        }

    # 4. Dataset ต้องผ่าน Scanner และรองรับการ Train
    if not dataset.supported:
        return {
            "success": False,
            "message": (
                dataset.unsupported_reason
                or "This dataset is not supported for training"
            ),
        }

    # 5. Project ต้องมี Architecture ที่บันทึกไว้
    if not project.architecture_json or project.architecture_json == "{}":
        return {
            "success": False,
            "message": "Please save the model architecture before training",
        }

    # 6. ตรวจสอบค่าที่ผู้ใช้กรอก
    if job.total_epochs < 1:
        return {
            "success": False,
            "message": "Total epochs must be at least 1",
        }

    if job.batch_size < 1:
        return {
            "success": False,
            "message": "Batch size must be at least 1",
        }

    if job.learning_rate <= 0:
        return {
            "success": False,
            "message": "Learning rate must be greater than 0",
        }

    allowed_modes = {"new", "continue", "finetune"}

    if job.mode not in allowed_modes:
        return {
            "success": False,
            "message": "Mode must be new, continue, or finetune",
        }

    allowed_optimizers = {"adam", "sgd", "adamw"}

    if job.optimizer.lower() not in allowed_optimizers:
        return {
            "success": False,
            "message": "Optimizer must be adam, sgd, or adamw",
        }

    # 7. สร้าง Training Job
    training_job = TrainingJob(
        **snapshot_project(project, db, job.project_version),
        owner_id=job.owner_id,
        project_id=job.project_id,
        dataset_id=job.dataset_id,
        mode=job.mode,
        status="queued",
        current_epoch=0,
        total_epochs=job.total_epochs,
        learning_rate=job.learning_rate,
        batch_size=job.batch_size,
        optimizer=job.optimizer.lower(),
    )

    db.add(training_job)
    db.commit()
    db.refresh(training_job)

    return {
        "success": True,
        "message": "Training job created",
        "job": serialize_training_job(training_job),
    }


@app.get("/training/projects/{project_id}/jobs")
def get_project_training_jobs(
    project_id: int,
    owner_id: int,
    db: Session = Depends(get_db),
):
    project = (
        db.query(Project)
        .filter(
            Project.id == project_id,
            Project.owner_id == owner_id,
        )
        .first()
    )

    if not project:
        return {
            "success": False,
            "message": "Project not found or access denied",
        }

    jobs = (
        db.query(TrainingJob)
        .filter(
            TrainingJob.project_id == project_id,
            TrainingJob.owner_id == owner_id,
        )
        .order_by(
            TrainingJob.created_at.desc()
        )
        .all()
    )

    return {
        "success": True,
        "jobs": [
            serialize_training_job(job)
            for job in jobs
        ],
    }


@app.get("/training/projects/{project_id}/models")
def get_project_model_versions(
    project_id: int,
    owner_id: int,
    db: Session = Depends(get_db),
):
    project = (
        db.query(Project)
        .filter(
            Project.id == project_id,
            Project.owner_id == owner_id,
        )
        .first()
    )

    if not project:
        return {
            "success": False,
            "message": "Project not found or access denied",
        }

    models = (
        db.query(ModelVersion)
        .filter(
            ModelVersion.project_id == project_id,
            ModelVersion.owner_id == owner_id,
            ModelVersion.deleted_at.is_(None),
        )
        .order_by(
            ModelVersion.version.desc()
        )
        .all()
    )


    model_results = []

    for model in models:
        item = serialize_model_version(model)

        dataset = (
            db.query(Dataset)
            .filter(Dataset.id == model.dataset_id)
            .first()
        )

        item["dataset_name"] = (
            dataset.name
            if dataset
            else f"Dataset #{model.dataset_id}"
        )

        model_results.append(item)

    return {
        "success": True,
        "models": model_results,
    }


@app.get("/models/{model_id}/lineage")
def get_model_lineage(
    model_id: int,
    owner_id: int,
    db: Session = Depends(get_db),
):
    current_model = (
        db.query(ModelVersion)
        .filter(
            ModelVersion.id == model_id,
            ModelVersion.owner_id == owner_id,
        )
        .first()
    )

    if not current_model:
        return {
            "success": False,
            "message": "Model version not found or access denied",
        }

    lineage = []
    visited_model_ids = set()

    model_version = current_model

    while model_version:
        if model_version.id in visited_model_ids:
            break

        visited_model_ids.add(model_version.id)

        job = (
            db.query(TrainingJob)
            .filter(
                TrainingJob.id == model_version.training_job_id
            )
            .first()
        )

        if not job:
            break

        dataset = (
            db.query(Dataset)
            .filter(
                Dataset.id == job.dataset_id
            )
            .first()
        )

        lineage.append(
            {
                "model_version_id": model_version.id,
                "version": model_version.version,
                "training_job_id": job.id,
                "dataset_id": job.dataset_id,
                "dataset_name": (
                    dataset.name
                    if dataset
                    else f"Dataset #{job.dataset_id}"
                ),
                "mode": job.mode,
                "source_model_version_id": (
                    job.source_model_version_id
                ),
                "best_accuracy": (
                    model_version.best_accuracy
                ),
                "best_loss": (
                    model_version.best_loss
                ),
                "epoch": (
                    model_version.epoch
                ),
            }
        )

        if not job.source_model_version_id:
            break

        model_version = (
            db.query(ModelVersion)
            .filter(
                ModelVersion.id
                == job.source_model_version_id
            )
            .first()
        )

    lineage.reverse()

    return {
        "success": True,
        "model_id": current_model.id,
        "version": current_model.version,
        "lineage": lineage,
    }


@app.get("/training/jobs/{owner_id}")
def get_training_jobs(
    owner_id: int,
    db: Session = Depends(get_db),
):
    owner = (
        db.query(User)
        .filter(User.id == owner_id)
        .first()
    )

    if not owner:
        return {
            "success": False,
            "message": "User not found",
        }

    training_jobs = (
        db.query(TrainingJob)
        .filter(TrainingJob.owner_id == owner_id)
        .order_by(TrainingJob.created_at.desc())
        .all()
    )

    return {
        "success": True,
        "jobs": [
            serialize_training_job(training_job)
            for training_job in training_jobs
        ],
    }


@app.get("/training/job/{job_id}")
def get_training_job(
    job_id: int,
    owner_id: int,
    db: Session = Depends(get_db),
):
    training_job = (
        db.query(TrainingJob)
        .filter(
            TrainingJob.id == job_id,
            TrainingJob.owner_id == owner_id,
        )
        .first()
    )

    if not training_job:
        return {
            "success": False,
            "message": "Training job not found or access denied",
        }

    return {
        "success": True,
        "job": serialize_training_job(training_job),
    }


@app.get("/admin/users")
def admin_get_users(
    db: Session = Depends(get_db),
):
    users = db.query(User).all()

    return {
        "success": True,
        "users": [
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "role": user.role,
            }
            for user in users
        ],
    }


@app.delete("/admin/users/{user_id}")
def admin_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
):
    user = (
        db.query(User)
        .filter(User.id == user_id)
        .first()
    )

    if not user:
        return {
            "success": False,
            "message": "User not found",
        }

    user_datasets = (
        db.query(Dataset)
        .filter(Dataset.owner_id == user_id)
        .all()
    )

    for dataset in user_datasets:
        storage_path = (
            dataset.storage_path
            or str(
                get_dataset_folder(
                    dataset.owner_id,
                    dataset.id,
                )
            )
        )
        remove_dataset_folder(storage_path)
        db.delete(dataset)

    db.query(Project).filter(
        Project.owner_id == user_id
    ).delete()

    db.delete(user)
    db.commit()

    return {
        "success": True,
        "message": "User, projects and datasets deleted",
    }


@app.get("/admin/projects")
def admin_get_projects(
    db: Session = Depends(get_db),
):
    projects = db.query(Project).all()

    return {
        "success": True,
        "projects": projects,
    }


@app.delete("/admin/projects/{project_id}")
def admin_delete_project(
    project_id: int,
    db: Session = Depends(get_db),
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if not project:
        return {
            "success": False,
            "message": "Project not found",
        }

    db.delete(project)
    db.commit()

    return {
        "success": True,
        "message": "Project deleted",
    }


@app.get("/admin/datasets")
def admin_get_datasets(
    db: Session = Depends(get_db),
):
    datasets = (
        db.query(Dataset)
        .order_by(Dataset.created_at.desc())
        .all()
    )

    return {
        "success": True,
        "datasets": [
            serialize_dataset(dataset)
            for dataset in datasets
        ],
    }


@app.delete("/admin/datasets/{dataset_id}")
def admin_delete_dataset(
    dataset_id: int,
    db: Session = Depends(get_db),
):
    dataset = (
        db.query(Dataset)
        .filter(Dataset.id == dataset_id)
        .first()
    )

    if not dataset:
        return {
            "success": False,
            "message": "Dataset not found",
        }

    storage_path = (
        dataset.storage_path
        or str(
            get_dataset_folder(
                dataset.owner_id,
                dataset.id,
            )
        )
    )

    remove_dataset_folder(storage_path)

    db.delete(dataset)
    db.commit()

    return {
        "success": True,
        "message": "Dataset and files deleted",
    }
