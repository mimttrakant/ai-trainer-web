from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path


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

# ชื่อเหล่านี้ไม่ใช่ชื่อคลาสแบบ fix
# ใช้เพียงช่วยให้ Scanner เข้าใจว่าเป็นโฟลเดอร์ครอบ Dataset
COMMON_WRAPPER_NAMES = {
    "archive",
    "dataset",
    "data",
    "images",
    "image",
    "imgs",
    "photos",
    "pictures",
}


@dataclass
class DatasetScanResult:
    dataset_format: str
    image_count: int
    class_count: int
    class_names: list[str]
    supported: bool
    unsupported_reason: str | None
    split_type: str
    class_counts: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def is_image_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS


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


def folder_has_direct_or_nested_images(folder: Path) -> bool:
    return count_images(folder) > 0


def iter_candidate_directories(root: Path, max_depth: int = 5):
    """
    เดินหาโฟลเดอร์ที่อาจเป็นจุดเริ่มต้นของ Dataset
    โดยไม่ fix ว่าคลาสต้องชื่อ cat หรือ dog
    """
    root = root.resolve()
    queue: list[tuple[Path, int]] = [(root, 0)]

    while queue:
        current, depth = queue.pop(0)
        yield current, depth

        if depth >= max_depth:
            continue

        for child in visible_directories(current):
            queue.append((child, depth + 1))


def class_folders_from_root(root: Path) -> list[Path]:
    """
    ทุกโฟลเดอร์ลูกที่มีรูปอยู่ภายใน จะถูกมองเป็น Candidate Class
    ยกเว้นชื่อที่เป็น train/val/test
    """
    candidates = []

    for folder in visible_directories(root):
        if folder.name.lower() in SPLIT_NAMES:
            continue

        if folder_has_direct_or_nested_images(folder):
            candidates.append(folder)

    return candidates


def get_split_folders(root: Path) -> dict[str, Path]:
    return {
        folder.name.lower(): folder
        for folder in visible_directories(root)
        if folder.name.lower() in SPLIT_NAMES
    }


def normalize_split_name(name: str) -> str:
    lowered = name.lower()

    if lowered in {"train", "training"}:
        return "train"
    if lowered in {"val", "valid", "validation"}:
        return "val"
    if lowered in {"test", "testing"}:
        return "test"

    return lowered


def find_best_split_root(extract_path: Path) -> tuple[Path, dict[str, Path]] | None:
    best_result = None
    best_score = -1

    for candidate, depth in iter_candidate_directories(extract_path):
        split_folders = get_split_folders(candidate)

        if not split_folders:
            continue

        normalized = {
            normalize_split_name(name): path
            for name, path in split_folders.items()
        }

        preferred = normalized.get("train") or next(iter(normalized.values()))
        class_folders = class_folders_from_root(preferred)

        score = (
            len(normalized) * 1000
            + len(class_folders) * 100
            + count_images(candidate)
            - depth
        )

        if score > best_score:
            best_result = (candidate, normalized)
            best_score = score

    return best_result


def find_best_classification_root(extract_path: Path) -> Path | None:
    """
    เลือกโฟลเดอร์ที่มีโฟลเดอร์ลูกอย่างน้อย 2 โฟลเดอร์
    และแต่ละโฟลเดอร์ลูกมีรูปภาพอยู่ภายใน

    ตัวอย่างที่ตรวจเจอ:
    archive/classic, archive/flat
    archive/images/classic, archive/images/flat
    dataset/apple, dataset/banana, dataset/orange
    """
    best_root = None
    best_score = -1

    for candidate, depth in iter_candidate_directories(extract_path):
        class_folders = class_folders_from_root(candidate)

        if len(class_folders) < 2:
            continue

        image_count = sum(count_images(folder) for folder in class_folders)

        # ให้คะแนนโฟลเดอร์ที่พบหลายคลาสและหลายรูปมากกว่า
        score = (
            len(class_folders) * 100000
            + image_count * 10
            - depth
        )

        # ถ้าเป็นชื่อ wrapper ยอดนิยม เช่น images/ ให้คะแนนเพิ่มเล็กน้อย
        if candidate.name.lower() in COMMON_WRAPPER_NAMES:
            score += 50

        if score > best_score:
            best_root = candidate
            best_score = score

    return best_root


def scan_split_dataset(
    split_root: Path,
    split_folders: dict[str, Path],
) -> DatasetScanResult:
    preferred_split = (
        split_folders.get("train")
        or split_folders.get("val")
        or split_folders.get("test")
        or next(iter(split_folders.values()))
    )

    class_folders = class_folders_from_root(preferred_split)
    class_names = [folder.name for folder in class_folders]

    counts = {}
    for split_name, split_folder in split_folders.items():
        for folder in class_folders_from_root(split_folder):
            row = counts.setdefault(folder.name, {"name": folder.name, "image_count": 0, "splits": {}})
            amount = count_images(folder)
            row["image_count"] += amount
            row["splits"][split_name] = amount
    class_counts = sorted(counts.values(), key=lambda row: row["name"].lower())

    image_count = sum(
        count_images(folder)
        for folder in split_folders.values()
    )

    if len(class_names) < 2:
        return DatasetScanResult(
            dataset_format="train_val_test",
            image_count=image_count,
            class_count=len(class_names),
            class_names=class_names,
            supported=False,
            unsupported_reason=(
                "Train/validation/test structure was found, "
                "but at least 2 class folders are required."
            ),
            split_type="pre_split",
            class_counts=class_counts,
        )

    # ตรวจว่าคลาสใน split อื่น ๆ สอดคล้องกันหรือไม่
    expected_classes = set(class_names)
    inconsistent_splits = []

    for split_name, split_folder in split_folders.items():
        split_classes = {
            folder.name
            for folder in class_folders_from_root(split_folder)
        }

        if split_classes and split_classes != expected_classes:
            inconsistent_splits.append(split_name)

    if inconsistent_splits:
        return DatasetScanResult(
            dataset_format="train_val_test",
            image_count=image_count,
            class_count=len(class_names),
            class_names=class_names,
            supported=False,
            unsupported_reason=(
                "Class folders are inconsistent between dataset splits: "
                + ", ".join(sorted(inconsistent_splits))
            ),
            split_type="pre_split",
            class_counts=class_counts,
        )

    return DatasetScanResult(
        dataset_format="train_val_test",
        image_count=image_count,
        class_count=len(class_names),
        class_names=class_names,
        supported=True,
        unsupported_reason=None,
        split_type="pre_split",
        class_counts=class_counts,
    )


def scan_folder_classification(class_root: Path) -> DatasetScanResult:
    class_folders = class_folders_from_root(class_root)
    class_names = [folder.name for folder in class_folders]
    class_counts = [{"name": folder.name, "image_count": count_images(folder), "splits": {}} for folder in class_folders]
    image_count = sum(row["image_count"] for row in class_counts)

    return DatasetScanResult(
        dataset_format="folder_classification",
        image_count=image_count,
        class_count=len(class_names),
        class_names=class_names,
        supported=True,
        unsupported_reason=None,
        split_type="auto_split",
        class_counts=class_counts,
    )


def scan_dataset(extract_path: Path) -> DatasetScanResult:
    if not extract_path.exists():
        return DatasetScanResult(
            dataset_format="unknown",
            image_count=0,
            class_count=0,
            class_names=[],
            supported=False,
            unsupported_reason="Dataset folder was not found.",
            split_type="unknown",
        )

    split_candidate = find_best_split_root(extract_path)

    if split_candidate:
        split_root, split_folders = split_candidate
        return scan_split_dataset(split_root, split_folders)

    class_root = find_best_classification_root(extract_path)

    if class_root:
        return scan_folder_classification(class_root)

    total_images = count_images(extract_path)
    csv_files = list(extract_path.rglob("*.csv"))
    json_files = list(extract_path.rglob("*.json"))

    if total_images == 0 and (csv_files or json_files):
        return DatasetScanResult(
            dataset_format="tabular_or_annotation_only",
            image_count=0,
            class_count=0,
            class_names=[],
            supported=False,
            unsupported_reason=(
                "CSV/JSON files were found, but no supported image files "
                "were detected. Version 1 supports image classification only."
            ),
            split_type="unknown",
        )

    if total_images > 0:
        return DatasetScanResult(
            dataset_format="unlabeled_images",
            image_count=total_images,
            class_count=0,
            class_names=[],
            supported=False,
            unsupported_reason=(
                "Images were found, but at least 2 class folders were not detected. "
                "Place images inside folders that represent their classes."
            ),
            split_type="unknown",
        )

    return DatasetScanResult(
        dataset_format="unknown",
        image_count=0,
        class_count=0,
        class_names=[],
        supported=False,
        unsupported_reason=(
            "No supported image-classification structure was detected."
        ),
        split_type="unknown",
    )
