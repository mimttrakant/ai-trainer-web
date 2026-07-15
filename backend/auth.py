from passlib.context import CryptContext

# ใช้ bcrypt สำหรับเข้ารหัสและตรวจสอบรหัสผ่าน
pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
)


def hash_password(password: str) -> str:
    """เข้ารหัสรหัสผ่านก่อนบันทึกลงฐานข้อมูล"""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """ตรวจสอบรหัสผ่านที่ผู้ใช้กรอกกับ hash ในฐานข้อมูล"""
    return pwd_context.verify(plain_password, hashed_password)
