import { $, escapeHtml, showToast } from "./app-utils.js";
import { jobHistoryPageSizeOptions, saveSettings, state } from "./settings-state.js";

export function bindJobHistoryControls({ openJob, deleteJob }) {
  $("#job-history-list")?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : undefined;
    const deleteButton = target?.closest("[data-delete-job-id]");
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      void deleteJob?.(deleteButton.dataset.deleteJobId);
      return;
    }
    const item = target?.closest("[data-job-id]");
    if (!item) return;
    void openJob(item.dataset.jobId);
  });
  $("#job-history-search")?.addEventListener("input", (event) => {
    state.jobHistorySearch = event.target.value;
    state.jobHistoryPage = 1;
    renderJobHistory(state.jobHistoryJobs ?? []);
  });
  $("#job-history-page-size")?.addEventListener("change", (event) => {
    const nextSize = readPageSize(event.target.value);
    state.jobHistoryPageSize = nextSize;
    state.jobHistoryPage = 1;
    saveSettings();
    renderJobHistory(state.jobHistoryJobs ?? []);
    showToast(`작업 히스토리를 ${nextSize}개씩 표시합니다.`);
  });
  $("#job-history-pages")?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : undefined;
    const pageButton = target?.closest("[data-job-history-page]");
    if (!pageButton) return;
    state.jobHistoryPage = readPage(pageButton.dataset.jobHistoryPage);
    renderJobHistory(state.jobHistoryJobs ?? []);
  });
}

export function renderJobHistory(jobs) {
  const orderedJobs = normalizeJobs(jobs);
  state.jobHistoryJobs = orderedJobs;
  renderPageSizeControl();
  renderSearchControl();
  const list = $("#job-history-list");
  if (!list) return;
  if (!orderedJobs.length) {
    list.innerHTML = "<li class=\"job-history-empty\">아직 저장된 생성 작업이 없습니다.</li>";
    updateHistorySummary({ visibleCount: 0, filteredCount: 0, totalCount: 0, page: 0, totalPages: 0 });
    renderHistoryPages(0, 0);
    return;
  }
  const filteredJobs = filterJobs(orderedJobs);
  const pageSize = state.jobHistoryPageSize;
  const totalPages = Math.ceil(filteredJobs.length / pageSize);
  if (!filteredJobs.length) {
    updateHistorySummary({
      visibleCount: 0,
      filteredCount: 0,
      totalCount: orderedJobs.length,
      page: 0,
      totalPages: 0,
    });
    renderHistoryPages(0, 0);
    list.innerHTML = "<li class=\"job-history-empty\">검색 결과가 없습니다.</li>";
    return;
  }
  const page = clampPage(state.jobHistoryPage, totalPages);
  state.jobHistoryPage = page;
  const start = (page - 1) * pageSize;
  const visibleJobs = filteredJobs.slice(start, start + pageSize);
  updateHistorySummary({
    visibleCount: visibleJobs.length,
    filteredCount: filteredJobs.length,
    totalCount: orderedJobs.length,
    page,
    totalPages,
  });
  renderHistoryPages(page, totalPages);
  list.innerHTML = visibleJobs.map((job) => `
    <li class="job-history-row">
      <button class="job-history-item" type="button" data-job-id="${escapeHtml(job.id)}">
        <span>
          <strong>${escapeHtml(job.title ?? "생성 작업")}</strong>
          <small>${escapeHtml(new Date(job.createdAt).toLocaleString("ko-KR"))} · ${escapeHtml(formatElapsed(job.elapsedMs ?? 0))}</small>
        </span>
        <em class="pill ${jobStatusClass(job.status)}">${escapeHtml(jobStatusLabel(job.status))}</em>
      </button>
      <button class="btn btn-danger job-history-delete" type="button" data-delete-job-id="${escapeHtml(job.id)}" aria-label="${escapeHtml(job.title ?? "생성 작업")} 삭제">삭제</button>
    </li>
  `).join("");
}

function normalizeJobs(jobs) {
  if (!Array.isArray(jobs)) return [];
  return [...jobs]
    .filter((job) => job && typeof job.id === "string")
    .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt));
}

function timestamp(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function jobStatusLabel(status) {
  if (status === "queued") return "대기 중";
  if (status === "running") return "생성 중";
  if (status === "cancelling") return "취소 중";
  if (status === "completed") return "완료";
  if (status === "failed") return "실패";
  if (status === "cancelled") return "취소됨";
  return "작업 없음";
}

export function jobStatusClass(status) {
  if (status === "completed") return "good";
  if (status === "failed") return "error";
  if (status === "queued" || status === "running" || status === "cancelling" || status === "cancelled") return "warn";
  return "";
}

function renderPageSizeControl() {
  const select = $("#job-history-page-size");
  if (!select) return;
  if (!select.children.length) {
    select.innerHTML = jobHistoryPageSizeOptions.map((size) => `<option value="${size}">${size}개</option>`).join("");
  }
  select.value = String(state.jobHistoryPageSize);
}

function renderSearchControl() {
  const input = $("#job-history-search");
  if (!input) return;
  if (input.value !== state.jobHistorySearch) input.value = state.jobHistorySearch;
}

function renderHistoryPages(page, totalPages) {
  const pages = $("#job-history-pages");
  if (!pages) return;
  if (totalPages <= 0) {
    pages.innerHTML = "<span class=\"job-history-page-empty\">표시할 페이지 없음</span>";
    return;
  }
  pages.innerHTML = Array.from({ length: totalPages }, (_, index) => {
    const pageNumber = index + 1;
    const active = pageNumber === page;
    return `<button class="job-history-page-btn ${active ? "active" : ""}" type="button" data-job-history-page="${pageNumber}" aria-current="${active ? "page" : "false"}">${pageNumber}p</button>`;
  }).join("");
}

function updateHistorySummary({ visibleCount, filteredCount, totalCount, page, totalPages }) {
  const summary = $("#job-history-summary");
  if (!summary) return;
  if (totalCount <= 0) {
    summary.textContent = "0개";
    return;
  }
  const pageText = `${page}p/${totalPages}p`;
  summary.textContent = filteredCount === totalCount
    ? `${pageText} · 최근 ${visibleCount}/${totalCount}개`
    : `${pageText} · 검색 ${visibleCount}/${filteredCount}개 · 전체 ${totalCount}개`;
}

function readPageSize(value) {
  const numeric = Number.parseInt(value, 10);
  return jobHistoryPageSizeOptions.includes(numeric) ? numeric : state.jobHistoryPageSize;
}

function readPage(value) {
  const numeric = Number.parseInt(value, 10);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : state.jobHistoryPage;
}

function clampPage(page, totalPages) {
  const numeric = Number.parseInt(page, 10);
  if (!Number.isSafeInteger(numeric)) return 1;
  return Math.min(totalPages, Math.max(1, numeric));
}

function filterJobs(jobs) {
  const query = state.jobHistorySearch.trim().toLocaleLowerCase("ko-KR");
  if (!query) return jobs;
  return jobs.filter((job) => jobSearchText(job).includes(query));
}

function jobSearchText(job) {
  return [
    job.id,
    job.title,
    job.status,
    jobStatusLabel(job.status),
    formatElapsed(job.elapsedMs ?? 0),
    new Date(job.createdAt).toLocaleString("ko-KR"),
  ].filter(Boolean).join(" ").toLocaleLowerCase("ko-KR");
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}분 ${String(remainder).padStart(2, "0")}초` : `${remainder}초`;
}
