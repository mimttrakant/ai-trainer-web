# Google Drive URL Fix

แก้ปัญหา:

download() got an unexpected keyword argument 'fuzzy'

สิ่งที่เปลี่ยน:
- ไม่ใช้ fuzzy=True แล้ว
- รองรับลิงก์ Google Drive แบบ /file/d/FILE_ID/view
- รองรับลิงก์ open?id=FILE_ID
- รองรับลิงก์ uc?id=FILE_ID
- แจ้งชัดเจนหากผู้ใช้ใส่ลิงก์ Google Drive Folder
- ยังต้องตั้ง Share เป็น Anyone with the link
