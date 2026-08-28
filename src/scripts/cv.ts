import { activeCV, analysesLeft, consumeAnalysis, formatDate, LIMIT_MESSAGE, load, putCV, update } from '../lib/store';
import { scoreCV } from '../lib/ats';
import { escapeHtml, renderCvDocument, renderFindings } from '../lib/render';
import { emptyCV } from '../lib/cv';
import type { AtsReport, CV } from '../lib/types';

const $ = <T extends HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);

let cv: CV = activeCV();

const listEl = $('[data-list]')!;
const docEl = $('[data-doc]')!;
const findingsEl = $('[data-findings]')!;
const barsEl = $('[data-bars]')!;
const toastEl = $('[data-toast]')!;

const BAR_LABELS: Record<string, string> = {
  structure: 'Структура',
  keywords: 'Ключови думи',
  impact: 'Измерими резултати',
  readability: 'Четимост',
  format: 'Формат',
};

function toast(message: string, ms = 3200): void {
  toastEl.textContent = message;
  toastEl.removeAttribute('hidden');
  window.setTimeout(() => toastEl.setAttribute('hidden', ''), ms);
}

function save(): void {
  cv = { ...cv, updatedAt: new Date().toISOString() };
  putCV(cv);
  renderList();
  renderPreview();
}

// ------------------------------------------------------------------ preview
function renderPreview(report?: AtsReport): void {
  const current = report ?? scoreCV(cv);
  docEl.innerHTML = renderCvDocument(cv);
  findingsEl.innerHTML = renderFindings(current);
  $('[data-score-value]')!.textContent = String(current.total);
  $('[data-score-label]')!.textContent = current.label;
  barsEl.innerHTML = Object.entries(current.dimensions)
    .map(([key, value]) => {
      const warn = value < 70;
      return `
        <div class="bar-row">
          <div style="display:flex;justify-content:space-between;margin-bottom:5px">
            <span>${BAR_LABELS[key] ?? key}</span>
            <span style="color:${warn ? 'var(--peach)' : 'var(--green-soft-2)'}">${value}</span>
          </div>
          <div class="meter meter-on-dark"><i style="width:${value}%${warn ? ';background:var(--peach)' : ''}"></i></div>
        </div>`;
    })
    .join('');
}

// --------------------------------------------------------------- CV listing
function renderList(): void {
  const state = load();
  listEl.innerHTML = state.cvs
    .map((item) => {
      const report = scoreCV(item);
      return `
        <button class="doc-item${item.id === cv.id ? ' current' : ''}" type="button" data-pick="${escapeHtml(item.id)}">
          <div class="doc-item-name">${escapeHtml(item.name)}</div>
          <div class="doc-item-meta">ATS ${report.total} · ${escapeHtml(formatDate(item.updatedAt))}</div>
        </button>`;
    })
    .join('');

  listEl.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((button) => {
    button.addEventListener('click', () => {
      const picked = load().cvs.find((item) => item.id === button.dataset.pick);
      if (!picked) return;
      cv = picked;
      update((draft) => { draft.activeCvId = picked.id; });
      hydrateForm();
      renderList();
      renderPreview();
    });
  });
}

// -------------------------------------------------------------------- forms
function hydrateForm(): void {
  $<HTMLInputElement>('[data-name]')!.value = cv.name;
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-bind]').forEach((field) => {
    const path = field.dataset.bind!;
    switch (path) {
      case 'contact.links': field.value = cv.contact.links.join(', '); break;
      case 'skills': field.value = cv.skills.join(', '); break;
      case 'languages': field.value = cv.languages.map((l) => `${l.name} — ${l.level}`).join('\n'); break;
      case 'summary': field.value = cv.summary; break;
      default: {
        const key = path.split('.')[1] as keyof CV['contact'];
        field.value = String(cv.contact[key] ?? '');
      }
    }
  });
  renderExperience();
  renderEducation();
}

document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-bind]').forEach((field) => {
  field.addEventListener('input', () => {
    const path = field.dataset.bind!;
    const value = field.value;
    switch (path) {
      case 'contact.links':
        cv = { ...cv, contact: { ...cv.contact, links: value.split(',').map((s) => s.trim()).filter(Boolean) } };
        break;
      case 'skills':
        cv = { ...cv, skills: value.split(',').map((s) => s.trim()).filter(Boolean) };
        break;
      case 'languages':
        cv = {
          ...cv,
          languages: value
            .split('\n')
            .map((line) => line.split(/[—\-–:]/))
            .map(([name, level]) => ({ name: (name ?? '').trim(), level: (level ?? '').trim() }))
            .filter((item) => item.name),
        };
        break;
      case 'summary':
        cv = { ...cv, summary: value };
        break;
      default: {
        const key = path.split('.')[1]!;
        cv = { ...cv, contact: { ...cv.contact, [key]: value } };
      }
    }
    save();
  });
});

$<HTMLInputElement>('[data-name]')!.addEventListener('input', (event) => {
  cv = { ...cv, name: (event.target as HTMLInputElement).value };
  save();
});

function renderExperience(): void {
  const host = $('[data-exp-list]')!;
  host.innerHTML = cv.experience
    .map(
      (job, index) => `
        <div class="exp-card">
          <div class="exp-grid">
            <input class="input" placeholder="Длъжност" value="${escapeHtml(job.role)}" data-exp="${index}" data-key="role" />
            <input class="input" placeholder="Компания" value="${escapeHtml(job.company)}" data-exp="${index}" data-key="company" />
          </div>
          <input class="input" placeholder="Период, напр. 2022 — сега" value="${escapeHtml(job.period)}" data-exp="${index}" data-key="period" style="margin-bottom:10px" />
          <textarea class="textarea" style="min-height:80px" placeholder="Постижения — по едно на ред, с числа" data-exp="${index}" data-key="bullets">${escapeHtml(job.bullets.join('\n'))}</textarea>
          <div class="exp-head" style="margin-top:8px"><button class="remove" type="button" data-remove-exp="${index}">Премахни</button></div>
        </div>`,
    )
    .join('');

  host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-exp]').forEach((field) => {
    field.addEventListener('input', () => {
      const index = Number(field.dataset.exp);
      const key = field.dataset.key!;
      const experience = [...cv.experience];
      const job = { ...experience[index]! };
      if (key === 'bullets') job.bullets = field.value.split('\n').map((s) => s.trim()).filter(Boolean);
      else (job as unknown as Record<string, string>)[key] = field.value;
      experience[index] = job;
      cv = { ...cv, experience };
      save();
    });
  });

  host.querySelectorAll<HTMLButtonElement>('[data-remove-exp]').forEach((button) => {
    button.addEventListener('click', () => {
      cv = { ...cv, experience: cv.experience.filter((_, i) => i !== Number(button.dataset.removeExp)) };
      save();
      renderExperience();
    });
  });
}

function renderEducation(): void {
  const host = $('[data-edu-list]')!;
  host.innerHTML = cv.education
    .map(
      (item, index) => `
        <div class="edu-card">
          <div class="exp-grid">
            <input class="input" placeholder="Специалност / степен" value="${escapeHtml(item.degree)}" data-edu="${index}" data-key="degree" />
            <input class="input" placeholder="Учебно заведение" value="${escapeHtml(item.school)}" data-edu="${index}" data-key="school" />
          </div>
          <input class="input" placeholder="Период" value="${escapeHtml(item.period)}" data-edu="${index}" data-key="period" />
          <div class="exp-head" style="margin-top:8px"><button class="remove" type="button" data-remove-edu="${index}">Премахни</button></div>
        </div>`,
    )
    .join('');

  host.querySelectorAll<HTMLInputElement>('[data-edu]').forEach((field) => {
    field.addEventListener('input', () => {
      const index = Number(field.dataset.edu);
      const education = [...cv.education];
      education[index] = { ...education[index]!, [field.dataset.key!]: field.value } as (typeof education)[number];
      cv = { ...cv, education };
      save();
    });
  });

  host.querySelectorAll<HTMLButtonElement>('[data-remove-edu]').forEach((button) => {
    button.addEventListener('click', () => {
      cv = { ...cv, education: cv.education.filter((_, i) => i !== Number(button.dataset.removeEdu)) };
      save();
      renderEducation();
    });
  });
}

$('[data-add-exp]')?.addEventListener('click', () => {
  cv = {
    ...cv,
    experience: [...cv.experience, { id: `exp_${Math.random().toString(36).slice(2, 8)}`, role: '', company: '', period: '', bullets: [] }],
  };
  save();
  renderExperience();
});

$('[data-add-edu]')?.addEventListener('click', () => {
  cv = {
    ...cv,
    education: [...cv.education, { id: `edu_${Math.random().toString(36).slice(2, 8)}`, degree: '', school: '', period: '' }],
  };
  save();
  renderEducation();
});

$('[data-new]')?.addEventListener('click', () => {
  cv = emptyCV('Ново CV');
  putCV(cv);
  hydrateForm();
  renderList();
  renderPreview();
});

// ------------------------------------------------------------------ actions
$('[data-print]')?.addEventListener('click', () => {
  save();
  window.open(`/pechat?cv=${encodeURIComponent(cv.id)}`, '_blank', 'noopener');
});

$('[data-export]')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(cv, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${cv.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast('CV-то е свалено като JSON.');
});

const reviewBox = $('[data-review]')!;
const reviewBody = $('[data-review-body]')!;
$('[data-review-close]')?.addEventListener('click', () => reviewBox.setAttribute('hidden', ''));

$('[data-analyze]')?.addEventListener('click', async (event) => {
  const button = event.currentTarget as HTMLButtonElement;

  if (analysesLeft() <= 0) {
    reviewBox.removeAttribute('hidden');
    reviewBody.textContent = LIMIT_MESSAGE;
    return;
  }

  button.disabled = true;
  button.textContent = 'Анализирам…';
  reviewBox.removeAttribute('hidden');
  reviewBody.textContent = 'Моделът чете CV-то…';

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cv, jobText: cv.targetJob?.description }),
    });
    const payload = (await response.json()) as { report?: AtsReport; review?: string; warning?: string; error?: string };
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);

    reviewBody.textContent =
      payload.review ||
      payload.warning ||
      (payload.report?.findings.map((finding) => `• +${finding.points} точки: ${finding.text}`).join('\n') ?? '');
    if (payload.report) renderPreview(payload.report);
    consumeAnalysis();
  } catch (error) {
    reviewBody.textContent = `Анализът не успя: ${error instanceof Error ? error.message : 'неизвестна грешка'}`;
  }

  button.disabled = false;
  button.textContent = 'Анализирай';
});

$('[data-letter]')?.addEventListener('click', async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  button.textContent = 'Пиша…';
  reviewBox.removeAttribute('hidden');
  reviewBody.textContent = 'Пиша мотивационното писмо…';

  try {
    const response = await fetch('/api/cover-letter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cv, company: cv.targetJob?.company, jobText: cv.targetJob?.description }),
    });
    const payload = (await response.json()) as { letter?: string; error?: string };
    if (!response.ok || !payload.letter) throw new Error(payload.error || `HTTP ${response.status}`);
    cv = { ...cv, coverLetter: payload.letter };
    save();
    reviewBody.textContent = payload.letter;
  } catch (error) {
    reviewBody.textContent = `Писмото не се получи: ${error instanceof Error ? error.message : 'неизвестна грешка'}`;
  }

  button.disabled = false;
  button.textContent = 'Мотивационно писмо';
});

// ------------------------------------------------------------------ startup
hydrateForm();
renderList();
renderPreview();
