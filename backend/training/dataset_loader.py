from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import torch
from torch.utils.data import DataLoader, Dataset, random_split
from torchvision import datasets, transforms


IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".webp",
}

SPLIT_NAMES = {
    "train",
    "training",
    "val",
    "valid",
    "validation",
    "test",
    "testing",
}

IGNORED_FOLDER_NAMES = {
    "__macosx",
    ".git",
    ".idea",
    ".vscode",
}


@dataclass
class ClassificationDataLoaders:
    train_loader: DataLoader
    val_loader: DataLoader
    test_loader: DataLoader | None

    class_names: list[str]
    class_to_idx: dict[str, int]

    train_size: int
    val_size: int
    test_size: int

    class_root: str
    image_size: int


def is_image_file(path: Path) -> bool:
    return (
        path.is_file()
        and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def visible_directories(folder: Path) -> list[Path]:
    if not folder.exists() or not folder.is_dir():
        return []

    return sorted(
        [
            item
            for item in folder.iterdir()
            if item.is_dir()
            and not item.name.startswith(".")
            and item.name.lower() not in IGNORED_FOLDER_NAMES
        ],
        key=lambda item: item.name.lower(),
    )


def count_images(folder: Path) -> int:
    if not folder.exists():
        return 0

    return sum(
        1
        for path in folder.rglob("*")
        if is_image_file(path)
    )


def find_class_root(
    dataset_root: str | Path,
    max_depth: int = 6,
) -> Path:
    """
    หาโฟลเดอร์ที่มีโฟลเดอร์ลูกอย่างน้อย 2 โฟลเดอร์
    และแต่ละโฟลเดอร์ลูกมีรูปภาพ

    รองรับทั้ง:

    dataset/
        cat/
        dog/

    และ:

    dataset/
        images/
            cat/
            dog/
    """
    root = Path(dataset_root).resolve()

    if not root.exists():
        raise FileNotFoundError(
            f"Dataset folder not found: {root}"
        )

    queue: list[tuple[Path, int]] = [(root, 0)]
    candidates: list[tuple[int, Path]] = []

    while queue:
        current, depth = queue.pop(0)

        child_folders = [
            folder
            for folder in visible_directories(current)
            if folder.name.lower() not in SPLIT_NAMES
            and count_images(folder) > 0
        ]

        if len(child_folders) >= 2:
            total_images = sum(
                count_images(folder)
                for folder in child_folders
            )

            # ให้ความสำคัญกับจำนวน Class และจำนวนรูป
            # ลดคะแนนเล็กน้อยเมื่ออยู่ลึกมาก
            score = (
                len(child_folders) * 1_000_000
                + total_images
                - depth
            )

            candidates.append((score, current))

        if depth < max_depth:
            for child in visible_directories(current):
                queue.append((child, depth + 1))

    if not candidates:
        raise ValueError(
            "No image-classification structure was found. "
            "The dataset must contain at least 2 class folders, "
            "and each class folder must contain images."
        )

    candidates.sort(
        key=lambda item: item[0],
        reverse=True,
    )

    return candidates[0][1]


def normalize_split_name(name: str) -> str:
    lowered = name.lower()

    if lowered in {"train", "training"}:
        return "train"

    if lowered in {"val", "valid", "validation"}:
        return "val"

    if lowered in {"test", "testing"}:
        return "test"

    return lowered


def find_split_root(
    dataset_root: str | Path,
    max_depth: int = 6,
) -> tuple[Path, dict[str, Path]] | None:
    """
    ตรวจหาโครงสร้าง:

    dataset/
        train/
            cat/
            dog/
        val/
            cat/
            dog/
        test/
            cat/
            dog/
    """
    root = Path(dataset_root).resolve()
    queue: list[tuple[Path, int]] = [(root, 0)]

    while queue:
        current, depth = queue.pop(0)

        split_folders: dict[str, Path] = {}

        for folder in visible_directories(current):
            normalized = normalize_split_name(folder.name)

            if normalized in {"train", "val", "test"}:
                split_folders[normalized] = folder

        if "train" in split_folders:
            try:
                find_class_root(
                    split_folders["train"],
                    max_depth=2,
                )
                return current, split_folders
            except ValueError:
                pass

        if depth < max_depth:
            for child in visible_directories(current):
                queue.append((child, depth + 1))

    return None


def build_transforms(
    image_size: int,
) -> tuple[transforms.Compose, transforms.Compose]:
    train_transform = transforms.Compose(
        [
            transforms.Resize(
                (image_size, image_size)
            ),
            transforms.RandomHorizontalFlip(),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225],
            ),
        ]
    )

    evaluation_transform = transforms.Compose(
        [
            transforms.Resize(
                (image_size, image_size)
            ),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225],
            ),
        ]
    )

    return train_transform, evaluation_transform


def calculate_split_sizes(
    total_size: int,
    val_ratio: float,
    test_ratio: float,
) -> tuple[int, int, int]:
    if total_size < 3:
        raise ValueError(
            "Dataset must contain at least 3 images."
        )

    if not 0 <= val_ratio < 1:
        raise ValueError(
            "val_ratio must be between 0 and 1."
        )

    if not 0 <= test_ratio < 1:
        raise ValueError(
            "test_ratio must be between 0 and 1."
        )

    if val_ratio + test_ratio >= 1:
        raise ValueError(
            "val_ratio + test_ratio must be less than 1."
        )

    val_size = max(1, round(total_size * val_ratio))
    test_size = (
        max(1, round(total_size * test_ratio))
        if test_ratio > 0
        else 0
    )

    train_size = total_size - val_size - test_size

    if train_size < 1:
        raise ValueError(
            "The selected split ratios leave no training images."
        )

    return train_size, val_size, test_size


def verify_same_classes(
    reference: datasets.ImageFolder,
    other: datasets.ImageFolder,
    split_name: str,
) -> None:
    if reference.class_to_idx != other.class_to_idx:
        raise ValueError(
            f"Class folders in the {split_name} split "
            "do not match the training split."
        )


def create_loader(
    dataset: Dataset,
    batch_size: int,
    shuffle: bool,
    num_workers: int,
) -> DataLoader:
    return DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=num_workers,
        pin_memory=torch.cuda.is_available(),
    )


def build_from_pre_split_dataset(
    split_folders: dict[str, Path],
    batch_size: int,
    image_size: int,
    num_workers: int,
) -> ClassificationDataLoaders:
    train_transform, evaluation_transform = (
        build_transforms(image_size)
    )

    train_root = find_class_root(
        split_folders["train"],
        max_depth=2,
    )

    train_dataset = datasets.ImageFolder(
        root=str(train_root),
        transform=train_transform,
    )

    if len(train_dataset.classes) < 2:
        raise ValueError(
            "At least 2 classes are required."
        )

    if "val" in split_folders:
        val_root = find_class_root(
            split_folders["val"],
            max_depth=2,
        )

        val_dataset = datasets.ImageFolder(
            root=str(val_root),
            transform=evaluation_transform,
        )

        verify_same_classes(
            train_dataset,
            val_dataset,
            "validation",
        )
    else:
        # ถ้าไม่มี val ให้แบ่งจาก train อัตโนมัติ
        evaluation_dataset = datasets.ImageFolder(
            root=str(train_root),
            transform=evaluation_transform,
        )

        train_size, val_size, _ = calculate_split_sizes(
            len(train_dataset),
            val_ratio=0.2,
            test_ratio=0,
        )

        generator = torch.Generator().manual_seed(42)

        train_indices, val_indices = random_split(
            range(len(train_dataset)),
            [train_size, val_size],
            generator=generator,
        )

        train_dataset = torch.utils.data.Subset(
            train_dataset,
            train_indices.indices,
        )

        val_dataset = torch.utils.data.Subset(
            evaluation_dataset,
            val_indices.indices,
        )

    test_dataset = None

    if "test" in split_folders:
        test_root = find_class_root(
            split_folders["test"],
            max_depth=2,
        )

        test_dataset = datasets.ImageFolder(
            root=str(test_root),
            transform=evaluation_transform,
        )

        # train_dataset อาจกลายเป็น Subset หากไม่มี val
        reference_dataset = (
            train_dataset.dataset
            if isinstance(
                train_dataset,
                torch.utils.data.Subset,
            )
            else train_dataset
        )

        verify_same_classes(
            reference_dataset,
            test_dataset,
            "test",
        )

    reference_dataset = (
        train_dataset.dataset
        if isinstance(
            train_dataset,
            torch.utils.data.Subset,
        )
        else train_dataset
    )

    return ClassificationDataLoaders(
        train_loader=create_loader(
            train_dataset,
            batch_size,
            shuffle=True,
            num_workers=num_workers,
        ),
        val_loader=create_loader(
            val_dataset,
            batch_size,
            shuffle=False,
            num_workers=num_workers,
        ),
        test_loader=(
            create_loader(
                test_dataset,
                batch_size,
                shuffle=False,
                num_workers=num_workers,
            )
            if test_dataset is not None
            else None
        ),
        class_names=list(reference_dataset.classes),
        class_to_idx=dict(
            reference_dataset.class_to_idx
        ),
        train_size=len(train_dataset),
        val_size=len(val_dataset),
        test_size=(
            len(test_dataset)
            if test_dataset is not None
            else 0
        ),
        class_root=str(train_root),
        image_size=image_size,
    )


def build_from_class_folders(
    dataset_root: Path,
    batch_size: int,
    image_size: int,
    val_ratio: float,
    test_ratio: float,
    num_workers: int,
) -> ClassificationDataLoaders:
    train_transform, evaluation_transform = (
        build_transforms(image_size)
    )

    class_root = find_class_root(dataset_root)

    train_source = datasets.ImageFolder(
        root=str(class_root),
        transform=train_transform,
    )

    evaluation_source = datasets.ImageFolder(
        root=str(class_root),
        transform=evaluation_transform,
    )

    if len(train_source.classes) < 2:
        raise ValueError(
            "At least 2 classes are required."
        )

    split_sizes = calculate_split_sizes(
        len(train_source),
        val_ratio=val_ratio,
        test_ratio=test_ratio,
    )

    generator = torch.Generator().manual_seed(42)

    train_split, val_split, test_split = random_split(
        range(len(train_source)),
        split_sizes,
        generator=generator,
    )

    train_dataset = torch.utils.data.Subset(
        train_source,
        train_split.indices,
    )

    val_dataset = torch.utils.data.Subset(
        evaluation_source,
        val_split.indices,
    )

    test_dataset = (
        torch.utils.data.Subset(
            evaluation_source,
            test_split.indices,
        )
        if len(test_split.indices) > 0
        else None
    )

    return ClassificationDataLoaders(
        train_loader=create_loader(
            train_dataset,
            batch_size,
            shuffle=True,
            num_workers=num_workers,
        ),
        val_loader=create_loader(
            val_dataset,
            batch_size,
            shuffle=False,
            num_workers=num_workers,
        ),
        test_loader=(
            create_loader(
                test_dataset,
                batch_size,
                shuffle=False,
                num_workers=num_workers,
            )
            if test_dataset is not None
            else None
        ),
        class_names=list(train_source.classes),
        class_to_idx=dict(train_source.class_to_idx),
        train_size=len(train_dataset),
        val_size=len(val_dataset),
        test_size=(
            len(test_dataset)
            if test_dataset is not None
            else 0
        ),
        class_root=str(class_root),
        image_size=image_size,
    )


def build_classification_dataloaders(
    dataset_path: str | Path,
    batch_size: int = 32,
    image_size: int = 128,
    val_ratio: float = 0.2,
    test_ratio: float = 0.0,
    num_workers: int = 0,
) -> ClassificationDataLoaders:
    """
    ฟังก์ชันหลักสำหรับสร้าง DataLoader ของ Image Classification
    """
    root = Path(dataset_path).resolve()

    if batch_size < 1:
        raise ValueError(
            "batch_size must be at least 1."
        )

    split_result = find_split_root(root)

    if split_result:
        _, split_folders = split_result

        return build_from_pre_split_dataset(
            split_folders=split_folders,
            batch_size=batch_size,
            image_size=image_size,
            num_workers=num_workers,
        )

    return build_from_class_folders(
        dataset_root=root,
        batch_size=batch_size,
        image_size=image_size,
        val_ratio=val_ratio,
        test_ratio=test_ratio,
        num_workers=num_workers,
    )