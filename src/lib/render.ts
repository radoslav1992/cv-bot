/** Browser-side rendering helpers shared by the chat preview and the print page. */
import type { AtsReport, CV } from './types';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Minimal, safe formatting for bot messages: paragraphs + **bold**. */
export function formatMessage(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .concat('</p>');
}

function contactLine(cv: CV): string {
  return [cv.contact.title, cv.contact.city, cv.contact.email, cv.contact.phone, ...cv.contact.links]
    .filter(Boolean)
    .map(escapeHtml)
    .join(' · ');
}

function section(label: string, body: string): string {
  return body ? `<div class="doc-label">${escapeHtml(label)}</div>${body}` : '';
}

/** The CV document itself. Used at preview scale in the chat and full size on
 *  the print page — same markup, different CSS. */
export function renderCvDocument(cv: CV): string {
  const name = cv.contact.name || 'Твоето име';

  const experience = cv.experience
    .map(
      (job) => `
        <div class="doc-entry">
          <div class="doc-role">${escapeHtml([job.role, job.company].filter(Boolean).join(' · '))}</div>
          ${job.period ? `<div class="doc-period">${escapeHtml(job.period)}</div>` : ''}
          ${
            job.bullets.length
              ? `<ul class="doc-bullets">${job.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
              : ''
          }
        </div>`,
    )
    .join('');

  const education = cv.education
    .map(
      (item) => `
        <div class="doc-entry">
          <div class="doc-role">${escapeHtml([item.degree, item.school].filter(Boolean).join(' · '))}</div>
          ${item.period ? `<div class="doc-period">${escapeHtml(item.period)}</div>` : ''}
        </div>`,
    )
    .join('');

  const skills = cv.skills.length
    ? `<div class="doc-chips">${cv.skills.map((skill) => `<span>${escapeHtml(skill)}</span>`).join('')}</div>`
    : '';

  const languages = cv.languages.length
    ? `<div class="doc-inline">${cv.languages.map((l) => escapeHtml(`${l.name} — ${l.level}`)).join(' · ')}</div>`
    : '';

  const projects = cv.projects.length
    ? cv.projects
        .map(
          (project) => `
            <div class="doc-entry">
              <div class="doc-role">${escapeHtml(project.name)}</div>
              <div class="doc-text">${escapeHtml(project.description)}</div>
            </div>`,
        )
        .join('')
    : '';

  const certificates = cv.certificates.length
    ? `<div class="doc-inline">${cv.certificates.map(escapeHtml).join(' · ')}</div>`
    : '';

  return `
    <div class="doc-name">${escapeHtml(name)}</div>
    <div class="doc-contact">${contactLine(cv) || 'Позиция · Град · имейл'}</div>
    <div class="doc-rule"></div>
    ${section('Обобщение', cv.summary ? `<div class="doc-text">${escapeHtml(cv.summary)}</div>` : '')}
    ${section('Опит', experience)}
    ${section('Образование', education)}
    ${section('Умения', skills)}
    ${section('Езици', languages)}
    ${section('Проекти', projects)}
    ${section('Сертификати', certificates)}
  `;
}

export function renderFindings(report: AtsReport): string {
  if (!report.findings.length) {
    return '<div class="finding good"><span>✓</span><span>Няма критични бележки. CV-то е готово за изпращане.</span></div>';
  }
  return report.findings
    .map((finding) => {
      const tone = finding.severity === 'good' ? 'good' : 'warn';
      const mark = finding.severity === 'good' ? '✓' : '!';
      return `<div class="finding ${tone}"><span>${mark}</span><span><b>+${finding.points} точки</b> ${escapeHtml(finding.text)}</span></div>`;
    })
    .join('');
}

export function nextStepHint(cv: CV): string {
  if (!cv.contact.title) return 'Кажи за каква позиция кандидатстваш, за да настроим CV-то към нея.';
  if (!cv.experience.length) return 'Разкажи за последната си работа — къде, колко време и с какво се занимаваше.';
  if (!cv.experience.some((job) => job.bullets.length)) return 'Добави по едно конкретно постижение към всяка позиция.';
  if (!cv.summary) return 'Липсва обобщение в началото. Кажи ми с една дума какъв е профилът ти.';
  if (!cv.education.length || !cv.languages.length) return 'Добави образование и езици, за да завършим документа.';
  if (!cv.targetJob) return 'Постави текста на конкретна обява и ще адаптираме CV-то за нея.';
  return 'CV-то е пълно. Можеш да го изтеглиш или да напишем мотивационно писмо.';
}

export function scoreColour(score: number): string {
  return score >= 70 ? 'var(--green)' : 'var(--accent)';
}
