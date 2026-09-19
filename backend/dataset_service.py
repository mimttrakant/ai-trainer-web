import json
import re
import shutil
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import gdown
import httpx

from database import SessionLocal
from dataset_scanner import scan_dataset
from models import Dataset


STORAGE_ROOT = Path("/app/storage/datasets")
CHUNK_SIZE = 1024 * 1024


def get_dataset_folder(owner_id: int, dataset_id: int) -> Path:
    return STORAGE_ROOT / f"user_{owner_id}" / f"dataset_{dataset_id}"


def safe_extract_zip(zip_path: Path, extract_to: Path) -> None:
    extract_to.mkdir(parents=True, exist_ok=True)
    target_root = extract_to.resolve()

    with zipfile.ZipFile(zip_path, "r") as archive:
        for member in archive.infolist():
            member_path = (extract_to / member.filename).resolve()

            try:
                member_path.relative_to(target_root)
            except ValueError as exc:
                raise ValueError(
                    f"Unsafe path in ZIP: {member.filename}"
                ) from exc

        archive.extractall(extract_to)


def calculate_folder_size(folder: Path) -> int:
    if not folder.exists():
        return 0

    return sum(
        path.stat().st_size
        for path in folder.rglob("*")
        if path.is_file()
    )


def remove_dataset_folder(storage_path: str | None) -> None:
    if storage_path and Path(storage_path).exists():
        shutil.rmtree(storage_path)


def is_google_drive_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()

    return (
        host == "drive.google.com"
        or host.endswith(".drive.google.com")
    )


def is_google_drive_folder_url(url: str) -> bool:
    parsed = urlparse(url)
    return "/folders/" in parsed.path


def extract_google_drive_file_id(url: str) -> str | None:
    """
    รองรับลิงก์ Google Drive แบบ:
    - https://drive.google.com/file/d/FILE_ID/view
    - https://drive.google.com/open?id=FILE_ID
    - https://drive.google.com/uc?id=FILE_ID
    """

    parsed = urlparse(url)

    # รูปแบบ /file/d/FILE_ID/
    match = re.search(r"/file/d/([^/]+)", parsed.path)

    if match:
        return match.group(1)

    # รูปแบบ ?id=FILE_ID
    query = parse_qs(parsed.query)
    file_ids = query.get("id")

    if file_ids:
        return file_ids[0]

    return None


def download_google_drive_file(
    source_url: str,
    destination: Path,
) -> None:
    if is_google_drive_folder_url(source_url):
        raise ValueError(
            "Google Drive folder links are not supported. "
            "Please upload one ZIP file to Google Drive and share that file."
        )

    file_id = extract_google_drive_file_id(source_url)

    if not file_id:
        raise ValueError(
            "Unable to read the Google Drive file ID from this URL."
        )

    direct_url = f"https://drive.google.com/uc?id={file_id}"

    result = gdown.download(
        url=direct_url,
        output=str(destination),
        quiet=False,
    )

    if not result or not destination.exists():
        raise RuntimeError(
            "Unable to download the ZIP file from Google Drive. "
            "Make sure sharing is set to 'Anyone with the link'."
        )


def download_direct_url(url: str, destination: Path) -> None:
    with httpx.stream(
        "GET",
        url,
        follow_redirects=True,
        timeout=None,
    ) as response:
        response.raise_for_status()

        with destination.open("wb") as output:
            for chunk in response.iter_bytes(CHUNK_SIZE):
                if chunk:
                    output.write(chunk)


def apply_scan_result(dataset: Dataset, extract_path: Path) -> None:
    scan_result = scan_dataset(extract_path)

    dataset.dataset_format = scan_result.dataset_format
    dataset.image_count = scan_result.image_count
    dataset.class_count = scan_result.class_count
    dataset.class_names_json = json.dumps(
        scan_result.class_names,
        ensure_ascii=False,
    )
    dataset.class_counts_json = json.dumps(scan_result.class_counts, ensure_ascii=False)
    dataset.supported = scan_result.supported
    dataset.unsupported_reason = scan_result.unsupported_reason
    dataset.split_type = scan_result.split_type

    dataset.status = (
        "ready"
        if scan_result.supported
        else "unsupported"
    )


def process_url_dataset(dataset_id: int) -> None:
    db = SessionLocal()
    dataset = None

    try:
        dataset = (
            db.query(Dataset)
            .filter(Dataset.id == dataset_id)
            .first()
        )

        if not dataset:
            return

        dataset.status = "processing"
        dataset.error_message = None
        db.commit()

        folder = get_dataset_folder(
            dataset.owner_id,
            dataset.id,
        )
        folder.mkdir(parents=True, exist_ok=True)

        zip_path = folder / "source.zip"
        extract_path = folder / "files"
        source_url = str(dataset.source_url)

        if is_google_drive_url(source_url):
            download_google_drive_file(
                source_url,
                zip_path,
            )
        else:
            download_direct_url(
                source_url,
                zip_path,
            )

        if not zipfile.is_zipfile(zip_path):
            raise ValueError(
                "The downloaded file is not a valid ZIP file."
            )

        safe_extract_zip(zip_path, extract_path)

        dataset.original_filename = "source.zip"
        dataset.storage_path = str(folder)
        dataset.size_bytes = calculate_folder_size(extract_path)

        apply_scan_result(dataset, extract_path)

        dataset.error_message = None
        zip_path.unlink(missing_ok=True)

        db.commit()

    except Exception as exc:
        if dataset:
            dataset.status = "failed"
            dataset.error_message = str(exc)
            db.commit()

    finally:
        db.close()
