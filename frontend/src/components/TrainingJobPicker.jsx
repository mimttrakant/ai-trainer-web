import { useEffect, useId, useMemo, useRef, useState } from "react";
import { visibleTrainingJobs } from "../utils/trainingJobs";
import "./TrainingJobPicker.css";

const PAGE_SIZE = 10;
const normalize = (text) => text.toLocaleLowerCase().replace(/[\s#]+/g, "");

export default function TrainingJobPicker({ jobs, datasets, selectedJob, onSelect }) {
  const id = useId();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const entries = useMemo(() => {
    const names = new Map(datasets.map((dataset) => [dataset.id, dataset.name]));
    return visibleTrainingJobs(jobs, true).map((job) => {
      const label = `Job #${job.id} · ${names.get(job.dataset_id) || `Dataset #${job.dataset_id}`} · ${job.status}`;
      return { job, label, search: normalize(label) };
    });
  }, [jobs, datasets]);
  const search = normalize(query);
  const matches = useMemo(() => {
    if (!search) return entries;
    return entries.filter((entry) => entry.search.includes(search))
      // An exact job number comes before partial matches (e.g. 7 before 17).
      .sort((a, b) => Number(search === String(b.job.id) || search === `job${b.job.id}`)
        - Number(search === String(a.job.id) || search === `job${a.job.id}`));
  }, [entries, search]);
  const browsingHistory = showAll || Boolean(search);
  const pageCount = browsingHistory ? Math.max(1, Math.ceil(matches.length / PAGE_SIZE)) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  const options = matches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const active = activeIndex < options.length ? activeIndex : -1;
  const selectedLabel = entries.find((entry) => entry.job.id === selectedJob.id)?.label || `Job #${selectedJob.id}`;

  useEffect(() => {
    if (open && active >= 0) {
      listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
    }
  }, [open, active, currentPage]);

  function close() {
    setOpen(false);
    setQuery("");
    setShowAll(false);
    setPage(0);
    setActiveIndex(-1);
  }

  function choose(jobId) {
    close();
    onSelect(jobId);
  }

  function changePage(next) {
    // Keep focus inside the picker before the clicked paging button becomes
    // disabled or disappears, otherwise its blur would dismiss the popup.
    inputRef.current?.focus({ preventScroll: true });
    setPage(next);
    setActiveIndex(-1);
    listRef.current?.scrollTo({ top: 0 });
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(event.key === "ArrowDown"
        ? Math.min(active + 1, options.length - 1)
        : active <= 0 ? options.length - 1 : active - 1);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (active >= 0) choose(options[active].job.id);
    }
  }

  return (
    <div className="training-job-picker" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) close();
    }} onKeyDown={(event) => {
      if (event.key === "Escape") close();
    }}>
      <label htmlFor={id}>Training job</label>
      <input
        id={id}
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${id}-option-${options[active].job.id}` : undefined}
        aria-describedby={`${id}-hint`}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search Job # or dataset…"
        value={open ? query : selectedLabel}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setPage(0);
          setActiveIndex(-1);
          listRef.current?.scrollTo({ top: 0 });
        }}
        onKeyDown={handleKeyDown}
      />
      <span id={`${id}-hint`} className="training-job-picker__hint">Search all jobs by ID, dataset or status.</span>
      {open && (
        <div className="training-job-picker__popup">
          <div className="training-job-picker__info" role="status">
            {search ? `${matches.length} matching jobs` : showAll ? `All ${matches.length} jobs` : "Latest 10 jobs · active jobs first"}
          </div>
          <ul id={`${id}-list`} role="listbox" aria-label="Training job suggestions" ref={listRef}>
            {options.map(({ job, label }, index) => (
              <li
                key={job.id}
                id={`${id}-option-${job.id}`}
                role="option"
                aria-selected={job.id === selectedJob.id}
                className={index === active ? "training-job-picker__option--active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(job.id)}
              >
                {label}
              </li>
            ))}
          </ul>
          {matches.length === 0 && <p className="training-job-picker__info">No matching jobs. Try another ID or dataset.</p>}
          {!browsingHistory && matches.length > PAGE_SIZE && (
            <button type="button" className="training-job-picker__history" onClick={() => {
              setShowAll(true);
              changePage(0);
            }}>View all history ({matches.length})</button>
          )}
          {browsingHistory && pageCount > 1 && (
            <div className="training-job-picker__pages">
              <button type="button" disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>Previous suggestions</button>
              <span>Page {currentPage + 1} of {pageCount}</span>
              <button type="button" disabled={currentPage === pageCount - 1} onClick={() => changePage(currentPage + 1)}>Next suggestions</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
