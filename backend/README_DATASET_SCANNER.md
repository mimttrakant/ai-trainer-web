# Dataset Scanner v2

Scanner ไม่ได้ fix ชื่อ Class ว่าต้องเป็น cat หรือ dog

หลักการ:
- ค้นหาโฟลเดอร์ที่มีโฟลเดอร์ลูกอย่างน้อย 2 โฟลเดอร์
- แต่ละโฟลเดอร์ลูกต้องมีรูปภาพ
- ชื่อโฟลเดอร์ลูกจะกลายเป็นชื่อ Class อัตโนมัติ

รองรับตัวอย่าง:

archive.zip
- images/
  - classic/
  - flat/
- exercises.csv
- exercises.json

ผล:
- class_names = ["classic", "flat"]
- class_count = 2
- dataset_format = folder_classification
- supported = true

รองรับ train/val/test ที่ซ้อนอยู่ในโฟลเดอร์ชั้นในได้เช่นกัน
