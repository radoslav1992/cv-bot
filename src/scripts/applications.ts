import { formatDate, load, update } from '../lib/store';
import { STATUS_LABELS } from '../lib/cv';
import { escapeHtml } from '../lib/render';
import type { Application } from '../lib/types';

const STATUSES = Object.keys(STATUS_LABELS) as Application['status'][];

function render(): void {
  const state = load();

  for (const status of STATUSES) {
    const host = document.querySelector<HTMLElement>(`[data-column="${status}"]`);
    const tally = document.querySelector<HTMLElement>(`[data-tally="${status}"]`);
    if (!host) continue;

    const items = state.applications.filter((application) => application.status === status);
    if (tally) tally.textContent = String(items.length);

    host.innerHTML = items.length
      ? items
          .map(
            (application) => `
              <div class="app-card">
                <div class="app-card-company">${escapeHtml(application.company)}</div>
                <div class="app-card-position">${escapeHtml(application.position)} · ${escapeHtml(formatDate(application.date))}</div>
                <div class="app-card-foot">
                  <select data-status="${escapeHtml(application.id)}" aria-label="Статус">
                    ${STATUSES.map(
                      (option) => `<option value="${option}"${option === application.status ? ' selected' : ''}>${STATUS_LABELS[option]}</option>`,
                    ).join('')}
                  </select>
                  <button class="remove" type="button" data-remove="${escapeHtml(application.id)}">Изтрий</button>
                </div>
              </div>`,
          )
          .join('')
      : '<p class="column-empty">Няма записи.</p>';
  }

  document.querySelectorAll<HTMLSelectElement>('[data-status]').forEach((select) => {
    select.addEventListener('change', () => {
      update((draft) => {
        const application = draft.applications.find((item) => item.id === select.dataset.status);
        if (application) application.status = select.value as Application['status'];
      });
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      update((draft) => {
        draft.applications = draft.applications.filter((item) => item.id !== button.dataset.remove);
      });
      render();
    });
  });
}

document.querySelector<HTMLFormElement>('[data-add]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const company = String(data.get('company') ?? '').trim();
  const position = String(data.get('position') ?? '').trim();
  if (!company || !position) return;

  update((state) => {
    state.applications.unshift({
      id: `app_${Math.random().toString(36).slice(2, 9)}`,
      company,
      position,
      status: (data.get('status') as Application['status']) ?? 'draft',
      date: new Date().toISOString().slice(0, 10),
      cvId: state.activeCvId,
    });
  });

  form.reset();
  render();
});

render();
