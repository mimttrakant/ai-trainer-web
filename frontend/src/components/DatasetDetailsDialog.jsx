import { useEffect, useMemo, useRef, useState } from "react";
import "./DatasetLibrary.css";

const PAGE_SIZE = 10;

export default function DatasetDetailsDialog({ dataset, ownerId, apiUrl, onClose, detailsPath }) {
  const dialog = useRef(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const processing = ["uploading", "processing"].includes(dataset.status);

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, []);

  useEffect(() => {
    if (processing || dataset.status === "failed") return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let disposed = false;
    const load = async () => {
      try {
        const response = await fetch(`${apiUrl}${detailsPath || `/datasets/${dataset.id}/details?owner_id=${ownerId}`}`, {
          signal: controller.signal, cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok || !result.success || !Array.isArray(result.classes)) {
          throw new Error(result.detail || "ไม่สามารถโหลดจำนวนภาพรายคลาสได้");
        }
        if (!disposed) setData(result);
      } catch (cause) {
        if (!disposed) setError(controller.signal.aborted ? "การนับภาพใช้เวลานาน กรุณาลองโหลดใหม่อีกครั้ง" : cause.message);
      } finally {
        clearTimeout(timeout);
        if (!disposed) setLoading(false);
      }
    };
    // Defer starting I/O so StrictMode's setup/cleanup probe cannot double-scan.
    const start = setTimeout(load, 0);
    return () => { disposed = true; clearTimeout(start); clearTimeout(timeout); controller.abort(); };
  }, [apiUrl, dataset.id, dataset.status, detailsPath, ownerId, processing, retry]);

  const classes = useMemo(() => (data?.classes || []).filter(row => row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [data, query]);
  const pages = Math.max(1, Math.ceil(classes.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const rows = classes.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const preSplit = dataset.split_type === "pre_split";

  return (
    <dialog ref={dialog} className="dataset-details" aria-labelledby="dataset-details-title"
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div>
        <header className="dataset-details__header">
          <div><h2 id="dataset-details-title">รายละเอียด Dataset: {dataset.name}</h2><p>Dataset #{dataset.id} · {dataset.status}</p></div>
          <button type="button" onClick={onClose} aria-label="ปิดรายละเอียด Dataset">×</button>
        </header>
        <p>{dataset.description || "ไม่มีคำอธิบาย"}</p>
        <p>การแบ่งข้อมูล: {preSplit ? "เตรียม train / val / test มาแล้ว" : dataset.split_type === "auto_split" ? "ระบบแบ่ง Train / Validation ตอนเริ่มฝึก" : "ยังไม่พบโครงสร้างที่รองรับ"}</p>
        {dataset.unsupported_reason && <p className="dataset-details__error">{dataset.unsupported_reason}</p>}
        {processing ? <p role="status">กำลังนำเข้าและสแกน Dataset รอให้เสร็จก่อนดูจำนวนภาพรายคลาส</p>
          : dataset.status === "failed" ? <p role="alert">นำเข้าไม่สำเร็จ: {dataset.error_message || "ไม่สามารถนับภาพรายคลาสได้"}</p>
            : loading ? <p role="status">กำลังโหลดสถิติที่บันทึกไว้ในฐานข้อมูล…</p>
              : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => { setError(""); setLoading(true); setRetry(value => value + 1); }}>ลองโหลดใหม่</button></div>
                : <>
                  <div className="dataset-details__totals">
                    <strong>{data?.detected_class_count || 0} คลาสที่ตรวจพบ</strong>
                    <strong>{data?.classified_image_count || 0} ภาพในคลาส</strong>
                  </div>
                  {data?.unassigned_image_count > 0 && <p>อีก {data.unassigned_image_count} ภาพไม่ได้อยู่ในโครงสร้างคลาสที่ตรวจพบ</p>}
                  <label className="dataset-details__search">ค้นหาชื่อคลาส
                    <input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="เช่น apple" />
                  </label>
                  {rows.length ? <div className="dataset-details__table"><table>
                    <caption>จำนวนไฟล์ภาพแยกตามชื่อโฟลเดอร์คลาส</caption>
                    <thead><tr><th scope="col">ชื่อคลาส</th><th scope="col">ภาพรวม</th>{preSplit && <><th scope="col">Train</th><th scope="col">Validation</th><th scope="col">Test</th></>}</tr></thead>
                    <tbody>{rows.map(row => <tr key={row.name}><th scope="row">{row.name}</th><td>{row.image_count}</td>
                      {preSplit && <><td>{row.splits.train || 0}</td><td>{row.splits.val || 0}</td><td>{row.splits.test || 0}</td></>}</tr>)}</tbody>
                  </table></div> : <p>{data?.classes.length ? "ไม่พบชื่อคลาสที่ค้นหา" : "ไม่พบคลาสในโครงสร้างที่ระบบตรวจจับได้"}</p>}
                  <nav aria-label="หน้ารายการคลาส" className="dataset-details__pages">
                    <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>ก่อนหน้า</button>
                    <span>หน้า {currentPage + 1} / {pages} · {classes.length} คลาส</span>
                    <button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>ถัดไป</button>
                  </nav>
                  <p className="dataset-details__hint">สถิติจากการสแกนไฟล์นามสกุลภาพที่รองรับ ไม่ได้ตรวจความสมบูรณ์ของภาพทุกไฟล์ {preSplit ? "จำนวนแยกชุดเป็นข้อมูลที่จัดมาใน ZIP" : "ยังไม่แสดงจำนวนต่อคลาสหลังสุ่มแบ่ง Train / Validation"}</p>
                </>}
      </div>
    </dialog>
  );
}
