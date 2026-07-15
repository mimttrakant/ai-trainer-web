from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import or_

from database import engine, get_db
from models import Base, User, Project
from schemas import UserRegister, UserLogin, ProjectCreate, ArchitectureUpdate
from auth import hash_password, verify_password


Base.metadata.create_all(bind=engine)

app = FastAPI()

# อนุญาตให้ React ที่รันบน localhost:5173 เรียก FastAPI ได้
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {
        "message": "AI Trainer Backend Ready"
    }


@app.post("/register")
def register(
    user: UserRegister,
    db: Session = Depends(get_db)
):
    existing_user = (
        db.query(User)
        .filter(
            or_(
                User.email == user.email,
                User.username == user.username
            )
        )
        .first()
    )

    if existing_user:
        if existing_user.email == user.email:
            message = "Email already exists"
        else:
            message = "Username already exists"

        return {
            "success": False,
            "message": message
        }

    new_user = User(
        username=user.username,
        email=user.email,
        password=hash_password(user.password),
        role="user"
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "success": True,
        "message": "User created"
    }


@app.post("/login")
def login(
    user: UserLogin,
    db: Session = Depends(get_db)
):
    db_user = (
        db.query(User)
        .filter(
            or_(
                User.email == user.identifier,
                User.username == user.identifier
            )
        )
        .first()
    )

    if not db_user:
        return {
            "success": False,
            "message": "Username or email not found"
        }

    if not verify_password(user.password, db_user.password):
        return {
            "success": False,
            "message": "Incorrect password"
        }

    return {
        "success": True,
        "message": "Login success",
        "user": {
            "id": db_user.id,
            "username": db_user.username,
            "email": db_user.email,
            "role": db_user.role
        }
    }


@app.post("/projects")
def create_project(
    project: ProjectCreate,
    db: Session = Depends(get_db)
):
    new_project = Project(
        name=project.name,
        description=project.description,
        owner_id=project.owner_id,
        status="draft",
        architecture_json="{}"
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
            "status": new_project.status
        }
    }


@app.get("/projects/{owner_id}")
def get_projects(
    owner_id: int,
    db: Session = Depends(get_db)
):
    projects = (
        db.query(Project)
        .filter(Project.owner_id == owner_id)
        .all()
    )

    return {
        "success": True,
        "projects": projects
    }

@app.get("/project/{project_id}")
def get_project(
    project_id: int,
    db: Session = Depends(get_db)
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if not project:
        return {
            "success": False,
            "message": "Project not found"
        }

    return {
        "success": True,
        "project": {
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "owner_id": project.owner_id,
            "status": project.status,
            "architecture_json": project.architecture_json
        }
    }


@app.delete("/projects/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db)
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if not project:
        return {
            "success": False,
            "message": "Project not found"
        }

    db.delete(project)
    db.commit()

    return {
        "success": True,
        "message": "Project deleted"
    }

@app.put("/projects/{project_id}/architecture")
def update_architecture(
    project_id: int,
    data: ArchitectureUpdate,
    db: Session = Depends(get_db)
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if not project:
        return {
            "success": False,
            "message": "Project not found"
        }

    project.architecture_json = data.architecture_json

    db.commit()
    db.refresh(project)

    return {
        "success": True,
        "message": "Architecture saved"
    }
@app.get("/admin/users")
def admin_get_users(db: Session = Depends(get_db)):
    users = db.query(User).all()

    return {
        "success": True,
        "users": [
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "role": user.role
            }
            for user in users
        ]
    }


@app.delete("/admin/users/{user_id}")
def admin_delete_user(
    user_id: int,
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        return {
            "success": False,
            "message": "User not found"
        }

    db.query(Project).filter(Project.owner_id == user_id).delete()

    db.delete(user)
    db.commit()

    return {
        "success": True,
        "message": "User and projects deleted"
    }


@app.get("/admin/projects")
def admin_get_projects(db: Session = Depends(get_db)):
    projects = db.query(Project).all()

    return {
        "success": True,
        "projects": projects
    }

@app.delete("/admin/projects/{project_id}")
def admin_delete_project(
    project_id: int,
    db: Session = Depends(get_db)
):
    project = db.query(Project).filter(Project.id == project_id).first()

    if not project:
        return {
            "success": False,
            "message": "Project not found"
        }

    db.delete(project)
    db.commit()

    return {
        "success": True,
        "message": "Project deleted"
    }