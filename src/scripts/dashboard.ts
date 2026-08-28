import { activeCV, formatDate, load, putCV, update } from '../lib/store';
import { scoreCV } from '../lib/ats';
import { escapeHtml } from '../lib/render';
import { STATUS_LABELS } from '../lib/cv';
import type { AtsReport, CV } from '../lib/types';

const $ = <T extends HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);

const state = load();
const cv = activeCV(state);

// ------------------------------------------------------------------ heading
const firstName = (state.user?.name ?? '').split(' ')[0];
$('[data-greeting]')!.textContent = firstName ? `Здравей, ${firstName}` : 'Здравей';

// --------------------------------------------------------------- CV listing
const reports = new Map<string, AtsReport>();
for (const item of state.cvs) reports.set(item.id, scoreCV(item));

const listEl = $('[data-cv-list]')!;
$('[data-cv-count]')!.textContent = `${state.cvs.length} ${state.cvs.length === 1 ? 'документ' : 'документа'}`;

function renderList(cvs: CV[]): void {
  if (!cvs.length) {
    listEl.innerHTML = '<p class="empty">Още нямаш CV. Започни разговор с бота или качи съществуващ документ.</p>';
    return;
  }
  listEl.innerHTML = cvs
    .map((item) => {
      const report = reports.get(item.id) ?? scoreCV(item);
      const meta = item.targetJob?.company
        ? `Адаптирано на ${formatDate(item.updatedAt)} · за конкретна обява`
        : `Обновено на ${formatDate(item.updatedAt)} · ${item.experience.length} позиции`;
      return `
        <div class="cv-row">
          <div>
            <div class="cv-row-name">${escapeHtml(item.name)}</div>
            <div class="cv-row-meta">${escapeHtml(meta)}</div>
          </div>
          <span class="pill ${report.total >= 70 ? 'pill-good' : 'pill-warn'}">ATS ${report.total}</span>
          <button class="cv-row-open" type="button" data-open="${escapeHtml(item.id)}">Отвори</button>
        </div>`;
    })
    .join('');

  listEl.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((button) => {
    button.addEventListener('click', () => {
      update((draft) => { draft.activeCvId = button.dataset.open!; });
      window.location.href = '/cv';
    });
  });
}
renderList(state.cvs);

// ------------------------------------------------------------------- scores
const report = reports.get(cv.id) ?? scoreCV(cv);

const ring = $('[data-score-ring="dash"]');
if (ring) {
  ring.style.background = `conic-gradient(var(--peach) 0 ${report.total}%, rgba(246,242,233,.16) ${report.total}% 100%)`;
  ring.setAttribute('aria-label', `ATS резултат ${report.total} от 100`);
  const value = ring.querySelector('[data-score-value]');
  if (value) value.textContent = String(report.total);
}

const AVERAGE = 74;
const gap = AVERAGE - report.total;
$('[data-score-note]')!.innerHTML =
  `Средно за твоята роля: ${AVERAGE}.<br>${
    gap <= 0 ? `Ти си ${Math.abs(gap)} точки над средното.` : `До средното остават ${gap} точки.`
  }`;

const BAR_LABELS: Record<string, string> = {
  structure: 'Структура',
  keywords: 'Ключови думи',
  impact: 'Измерими резултати',
  readability: 'Четимост',
  format: 'Формат',
};

$('[data-bars]')!.innerHTML = Object.entries(report.dimensions)
  .map(([key, value]) => {
    const warn = value < 70;
    return `
      <div class="bar-row">
        <div><span>${BAR_LABELS[key] ?? key}</span><span class="val${warn ? ' warn' : ''}">${value}</span></div>
        <div class="meter meter-on-dark"><i style="width:${value}%${warn ? ';background:var(--peach)' : ''}"></i></div>
      </div>`;
  })
  .join('');

const topFinding = report.findings[0];
$('[data-headline]')!.textContent = topFinding
  ? `Имаш ${report.findings.length} ${report.findings.length === 1 ? 'препоръка' : 'препоръки'}, които ще вдигнат скора ти с ${report.findings.reduce((sum, f) => sum + f.points, 0)} точки.`
  : 'CV-то ти е в добра форма. Готово за изпращане.';

// -------------------------------------------------------------- suggestions
const recsEl = $('[data-recs]')!;
recsEl.innerHTML = report.findings.length
  ? report.findings
      .slice(0, 3)
      .map(
        (finding) => `
          <div class="rec ${finding.severity === 'good' ? 'good' : 'warn'}">
            <div class="rec-points">+${finding.points} точки</div>
            <div class="rec-text">${escapeHtml(finding.text)}</div>
          </div>`,
      )
      .join('')
  : '<p class="empty">Няма открити слабости. Пробвай да адаптираш CV-то към конкретна обява.</p>';

// ------------------------------------------------------------------ history
const historyEl = $('[data-history]')!;
const history = state.cvs
  .map((item) => ({
    label: item.targetJob?.company ? `${item.targetJob.title || item.contact.title}, ${item.targetJob.company}` : item.name,
    score: (reports.get(item.id) ?? scoreCV(item)).total,
  }))
  .slice(0, 6);

historyEl.innerHTML = history.length
  ? history
      .map(
        (row) => `
          <div class="hist-row">
            <span>${escapeHtml(row.label)}</span>
            <span class="hist-score${row.score < 70 ? ' warn' : ''}">${row.score}</span>
          </div>`,
      )
      .join('')
  : '<p class="empty">Още няма анализи.</p>';

// ------------------------------------------------------------- applications
const counts = state.applications.reduce<Record<string, number>>((acc, application) => {
  acc[application.status] = (acc[application.status] ?? 0) + 1;
  return acc;
}, {});

const ORDER: { key: keyof typeof STATUS_LABELS; hot?: boolean }[] = [
  { key: 'interview', hot: true },
  { key: 'sent' },
  { key: 'waiting' },
  { key: 'rejected' },
];

$('[data-apps]')!.innerHTML = ORDER.map(
  (item) => `
    <div class="app-row${item.hot ? ' hot' : ''}">
      <span>${STATUS_LABELS[item.key]}</span>
      <b>${counts[item.key] ?? 0}</b>
    </div>`,
).join('');

// ------------------------------------------------------------------- upload
const fileInput = $<HTMLInputElement>('[data-file]')!;
$('[data-upload]')?.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;

  const button = $<HTMLButtonElement>('[data-upload]')!;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Чета файла…';

  try {
    const data = new FormData();
    data.append('file', file);
    const response = await fetch('/api/extract', { method: 'POST', body: data });
    const payload = (await response.json()) as { cv?: CV; error?: string; warning?: string };
    if (!response.ok || !payload.cv) throw new Error(payload.error || payload.warning || `HTTP ${response.status}`);

    putCV(payload.cv);
    window.location.href = '/cv';
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    alert(`Файлът не можа да бъде обработен: ${error instanceof Error ? error.message : 'неизвестна грешка'}`);
  }
});
