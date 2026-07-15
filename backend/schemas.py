from pydantic import BaseModel, EmailStr, Field


class UserRegister(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(min_length=6, max_length=72)


class UserLogin(BaseModel):
    # รองรับการ Login ได้ทั้ง Username และ Email
    identifier: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=72)


class ProjectCreate(BaseModel):
    name: str
    description: str
    owner_id: int


class ArchitectureUpdate(BaseModel):
    architecture_json: str
