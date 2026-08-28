/** Turns a template's field list plus the current CV into "which question comes
 *  next" — the single source of truth for the chat script, the step counter in
 *  the header and the suggested answers. */
import type { CV } from './types';
import { findTemplate, type CvTemplate, type FieldKey, type TemplateField } from './cvTemplates';

/** Whether a step is already answered, derived from the document itself so no
 *  separate progress state can drift out of sync with it. */
export function isFieldFilled(key: FieldKey, cv: CV): boolean {
  switch (key) {
    case 'name':
      return cv.contact.name.trim().length > 1;
    case 'contact':
      return Boolean(cv.contact.email.trim() || cv.contact.phone.trim());
    case 'currentRole':
      return cv.experience.length > 0;
    case 'achievements':
      return cv.experience.some((job) => job.bullets.length > 0);
    case 'previousRole':
      return cv.experience.length > 1;
    case 'education':
      return cv.education.length > 0;
    case 'skills':
      return cv.skills.length >= 3;
    case 'languages':
      return cv.languages.length > 0;
    case 'summary':
      return cv.summary.trim().length > 20;
  }
}

export interface FlowProgress {
  template: CvTemplate;
  fields: TemplateField[];
  /** 1-based position of the question being asked right now. */
  step: number;
  total: number;
  /** Undefined once every required field is answered. */
  current?: TemplateField;
  /** „Стъпка 3 от 9“ — the label the design puts in the chat header. */
  label: string;
  section: string;
  done: boolean;
  remaining: FieldKey[];
}

/** Null when the CV was not started from a template — the bot then falls back
 *  to the free-form conversation. */
export function flowProgress(cv: CV): FlowProgress | null {
  const template = findTemplate(cv.templateId);
  if (!template) return null;

  const fields = template.fields;
  const remaining = fields.filter((field) => !isFieldFilled(field.key, cv));

  // Optional steps never block completion, but they are still offered in order.
  const current = remaining[0];
  const blocking = remaining.filter((field) => !field.optional);
  const answered = fields.length - remaining.length;
  const step = Math.min(fields.length, answered + 1);

  return {
    template,
    fields,
    step,
    total: fields.length,
    current,
    label: current ? `Стъпка ${step} от ${fields.length}` : 'Готово',
    section: current?.section ?? 'Готово CV',
    done: blocking.length === 0,
    remaining: remaining.map((field) => field.key),
  };
}

/** Tappable answers for the question on screen. Skills fall back to the
 *  template's suggested set when the field itself lists none. */
export function suggestionsFor(progress: FlowProgress | null): string[] {
  if (!progress?.current) return [];
  const { current, template } = progress;
  if (current.suggestions?.length) return current.suggestions.slice(0, 4);
  if (current.key === 'skills' && template.suggestedSkills.length) {
    return [template.suggestedSkills.slice(0, 5).join(', ')];
  }
  return [];
}

/** The opening message when a template is picked — states the deal up front:
 *  N short questions, and the person only supplies the answers. */
export function templateGreeting(template: CvTemplate): string {
  const required = template.fields.filter((field) => !field.optional).length;
  return [
    `Избра шаблона „${template.name}“. Структурата е готова — остава да я напълним.`,
    `${required} кратки въпроса и CV-то е готово за изтегляне. Отговаряй свободно, аз подреждам.`,
    template.fields[0]?.question ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
