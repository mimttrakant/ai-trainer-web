from pydantic import BaseModel, EmailStr, Field, HttpUrl


class UserRegister(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(min_length=6, max_length=72)


class UserLogin(BaseModel):
    identifier: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=72)


class ProjectCreate(BaseModel):
    name: str
    description: str
    owner_id: int


class ArchitectureUpdate(BaseModel):
    architecture_json: str = Field(max_length=2_000_000)
    owner_id: int = Field(gt=0)
    model_name: str = Field(min_length=1, max_length=150)
    expected_version: int = Field(ge=0)


class DatasetUrlCreate(BaseModel):
    owner_id: int
    name: str = Field(min_length=1, max_length=150)
    description: str = Field(default="", max_length=1000)
    source_url: HttpUrl


class TrainingJobCreate(BaseModel):
    owner_id: int
    project_id: int
    dataset_id: int
    project_version: int | None = Field(default=None, gt=0)

    mode: str = "new"      # new / continue / finetune

    total_epochs: int = 20
    batch_size: int = 32
    learning_rate: float = 0.001
    optimizer: str = "adam"


class TrainingJobResponse(BaseModel):
    id: int

    owner_id: int
    project_id: int
    dataset_id: int

    mode: str
    status: str

    current_epoch: int
    total_epochs: int

    learning_rate: float
    batch_size: int
    optimizer: str

    class Config:
        from_attributes = True
