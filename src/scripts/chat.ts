import { activeCV, activeThread, analysesLeft, consumeAnalysis, LIMIT_MESSAGE, load, putCV, update, type ChatThread } from '../lib/store';
import { formatMessage, nextStepHint, renderCvDocument, renderFindings } from '../lib/render';
import { scoreCV } from '../lib/ats';
import type { AtsReport, CV, ChatMessage } from '../lib/types';
import { cvFromTemplate, emptyCV } from '../lib/cv';
import { flowProgress, suggestionsFor, templateGreeting } from '../lib/flow';
import { findTemplate } from '../lib/cvTemplates';

const $ = <T extends HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);

const messagesEl = $('[data-messages]')!;
const repliesEl = $('[data-replies]')!;
const scrollEl = $('[data-scroll]')!;
const inputEl = $<HTMLTextAreaElement>('[data-input]')!;
const formEl = $<HTMLFormElement>('[data-form]')!;
const sendBtn = $<HTMLButtonElement>('[data-send]')!;
const docEl = $('[data-doc]')!;
const findingsEl = $('[data-findings]')!;
const nextEl = $('[data-next]')!;
const scoreEl = $('[data-live-score]')!;
const letterEl = $('[data-letter]')!;
const letterTab = $('[data-letter-tab]')!;
const fileInput = $<HTMLInputElement>('[data-file]')!;
const modal = $('[data-modal]')!;
const modalError = $('[data-modal-error]')!;
const toastEl = $('[data-toast]')!;
const threadTitle = $('[data-thread-title]')!;
const threadSub = $('[data-thread-sub]')!;
const meterEl = $('[data-step-meter]')!;
const meterFill = $('[data-step-fill]')!;

const GREETING =
  'Здравей! Аз съм CV Bot. Ще направим CV, което минава през ATS филтрите и звучи като теб.\n\nОт какво да започнем?';
const DEFAULT_REPLIES = ['Създай CV от нула', 'Анализирай моето CV', 'Адаптирай към обява'];

let thread: ChatThread = pickThread();
let cv: CV = currentCV();
let busy = false;

function pickThread(): ChatThread {
  const requested = new URLSearchParams(location.search).get('thread');
  const state = load();
  if (requested) {
    const found = state.threads.find((item) => item.id === requested);
    if (found) {
      update((draft) => { draft.activeThreadId = requested; });
      return found;
    }
  }
  return activeThread();
}

function currentCV(): CV {
  const state = load();
  const linked = state.cvs.find((item) => item.id === thread.cvId);
  return linked ?? activeCV(state) ?? emptyCV();
}

function persist(): void {
  update((state) => {
    const index = state.threads.findIndex((item) => item.id === thread.id);
    const stored: ChatThread = { ...thread, updatedAt: new Date().toISOString(), cvId: cv.id };
    if (index >= 0) state.threads[index] = stored;
    else state.threads.unshift(stored);
    state.activeThreadId = thread.id;

    const cvIndex = state.cvs.findIndex((item) => item.id === cv.id);
    if (cvIndex >= 0) state.cvs[cvIndex] = cv;
    else state.cvs.unshift(cv);
    state.activeCvId = cv.id;
  });
}

function toast(message: string, ms = 3600): void {
  toastEl.textContent = message;
  toastEl.removeAttribute('hidden');
  window.setTimeout(() => toastEl.setAttribute('hidden', ''), ms);
}

function scrollToEnd(): void {
  requestAnimationFrame(() => { scrollEl.scrollTop = scrollEl.scrollHeight; });
}

// ---------------------------------------------------------------- rendering
function messageNode(message: ChatMessage): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cvb-in';

  if (message.role === 'user') {
    wrap.innerHTML = `<div class="msg-user"><div></div></div>`;
    wrap.querySelector('.msg-user > div')!.textContent = message.content;
    return wrap;
  }

  const actions = message.actions?.length
    ? `<div class="msg-actions">${message.actions.map((a) => `<span class="msg-action">${a}</span>`).join('')}</div>`
    : '';
  wrap.innerHTML = `
    <div class="msg-bot">
      <div class="msg-avatar" aria-hidden="true">CV</div>
      <div class="msg-body">${formatMessage(message.content)}${actions}</div>
    </div>`;
  return wrap;
}

function renderMessages(): void {
  messagesEl.innerHTML = '';
  for (const message of thread.messages) messagesEl.append(messageNode(message));
  scrollToEnd();
}

/** Inside a template flow the script decides what can be tapped — an empty list
 *  is a valid answer and means "type it yourself". */
function repliesFor(fallback: string[]): string[] {
  const progress = flowProgress(cv);
  return progress ? suggestionsFor(progress) : fallback;
}

function renderReplies(items: string[]): void {
  repliesEl.innerHTML = '';
  if (busy) return;
  for (const item of items) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'reply-chip';
    chip.textContent = item;
    chip.addEventListener('click', () => send(item));
    repliesEl.append(chip);
  }
}

function renderPanel(report?: AtsReport): void {
  const current = report ?? scoreCV(cv);
  docEl.innerHTML = renderCvDocument(cv);
  findingsEl.innerHTML = renderFindings(current);
  nextEl.textContent = nextStepHint(cv);

  scoreEl.textContent = `ATS ${current.total}`;
  scoreEl.className = `pill ${current.total >= 70 ? 'pill-good' : 'pill-warn'}`;

  if (cv.coverLetter) {
    letterTab.removeAttribute('hidden');
    letterEl.textContent = cv.coverLetter;
  } else {
    letterTab.setAttribute('hidden', '');
  }

  threadTitle.textContent = thread.title;

  const progress = flowProgress(cv);
  if (progress) {
    threadSub.textContent = `${progress.label} · ${progress.section}`;
    meterEl.hidden = false;
    meterFill.style.width = `${Math.round(((progress.step - 1) / progress.total) * 100)}%`;
  } else {
    meterEl.hidden = true;
    const filled = cv.experience.length + (cv.summary ? 1 : 0) + (cv.education.length ? 1 : 0);
    threadSub.textContent = cv.contact.title
      ? `${cv.contact.title} · ${filled} попълнени секции`
      : 'Разкажи ни за себе си — ботът пише вместо теб.';
  }
}

function setBusy(next: boolean): void {
  busy = next;
  sendBtn.disabled = next;
  inputEl.disabled = next;
  sendBtn.textContent = next ? 'Пиша…' : 'Изпрати';
  if (next) repliesEl.innerHTML = '';
}

// ------------------------------------------------------------------ sending
async function send(text: string): Promise<void> {
  const content = text.trim();
  if (!content || busy) return;

  thread.messages.push({ role: 'user', content });
  messagesEl.append(messageNode({ role: 'user', content }));
  inputEl.value = '';
  inputEl.style.height = 'auto';
  setBusy(true);
  scrollToEnd();

  const holder = document.createElement('div');
  holder.className = 'cvb-in';
  holder.innerHTML = `
    <div class="msg-bot">
      <div class="msg-avatar" aria-hidden="true">CV</div>
      <div class="msg-body"><span class="typing"><i></i><i></i><i></i></span></div>
    </div>`;
  messagesEl.append(holder);
  const body = holder.querySelector<HTMLElement>('.msg-body')!;
  scrollToEnd();

  let answer = '';
  const actions: string[] = [];
  let report: AtsReport | undefined;
  let replies = DEFAULT_REPLIES;

  const paint = () => {
    const chips = actions.length
      ? `<div class="msg-actions">${actions.map((a) => `<span class="msg-action">${a}</span>`).join('')}</div>`
      : '';
    body.innerHTML = (answer ? formatMessage(answer) : '<span class="typing"><i></i><i></i><i></i></span>') + chips;
    scrollToEnd();
  };

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cv,
        messages: thread.messages.map((message) => ({ role: message.role, content: message.content })),
      }),
    });

    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineAt: number;
      while ((newlineAt = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineAt).trim();
        buffer = buffer.slice(newlineAt + 1);
        if (!line) continue;

        let event: Record<string, any>;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        switch (event.type) {
          case 'delta':
            answer += String(event.text ?? '');
            paint();
            break;
          case 'action':
            if (typeof event.label === 'string') { actions.push(event.label); paint(); }
            break;
          case 'actions':
            if (Array.isArray(event.items)) {
              for (const label of event.items) if (typeof label === 'string' && !actions.includes(label)) actions.push(label);
              paint();
            }
            break;
          case 'cv':
            if (event.cv) { cv = event.cv as CV; renderPanel(report); }
            break;
          case 'score':
            report = event.report as AtsReport;
            renderPanel(report);
            break;
          case 'replies':
            if (Array.isArray(event.items) && event.items.length) replies = event.items as string[];
            break;
          case 'error':
            answer = answer || String(event.message ?? 'Възникна грешка.');
            holder.classList.add('msg-error');
            paint();
            break;
        }
      }
    }
  } catch (error) {
    answer = answer || `Връзката с бота прекъсна (${error instanceof Error ? error.message : 'неизвестна грешка'}). Опитай отново.`;
    holder.classList.add('msg-error');
    paint();
  }

  thread.messages.push({ role: 'assistant', content: answer, actions: [...actions] });
  if (thread.messages.filter((m) => m.role === 'user').length === 1) {
    thread.title = cv.contact.title ? `Ново CV — ${cv.contact.title}` : content.slice(0, 32);
  }
  persist();
  setBusy(false);
  renderPanel(report);

  renderReplies(repliesFor(replies));
}

// -------------------------------------------------------------------- tools
async function uploadCV(file: File): Promise<void> {
  if (busy) return;
  setBusy(true);
  const notice: ChatMessage = { role: 'assistant', content: `Чета „${file.name}“… Извличам опита и уменията.` };
  thread.messages.push(notice);
  messagesEl.append(messageNode(notice));
  scrollToEnd();

  try {
    const data = new FormData();
    data.append('file', file);
    const response = await fetch('/api/extract', { method: 'POST', body: data });
    const payload = (await response.json()) as { cv?: CV; report?: AtsReport; error?: string; warning?: string };

    if (!response.ok || !payload.cv) throw new Error(payload.error || payload.warning || `HTTP ${response.status}`);

    cv = payload.cv;
    putCV(cv);
    const report = payload.report ?? scoreCV(cv);
    const summary = [
      `Готово. Извлякох ${cv.experience.length} позиции, ${cv.skills.length} умения и ${cv.education.length} записа за образование.`,
      `ATS резултатът на това CV е ${report.total}/100 — ${report.label.toLowerCase()}.`,
      report.findings[0] ? `Най-голямата печалба: ${report.findings[0].text}` : '',
      'Да го подобрим ли заедно?',
    ]
      .filter(Boolean)
      .join('\n\n');

    const botMessage: ChatMessage = { role: 'assistant', content: summary, actions: ['Прочетох качения файл'] };
    thread.messages.push(botMessage);
    messagesEl.append(messageNode(botMessage));
    renderPanel(report);
    renderReplies(repliesFor(['Подобри описанията', 'Адаптирай към обява', 'Какво липсва?']));
  } catch (error) {
    const message = `Файлът не можа да бъде обработен: ${error instanceof Error ? error.message : 'неизвестна грешка'}`;
    const botMessage: ChatMessage = { role: 'assistant', content: message };
    thread.messages.push(botMessage);
    messagesEl.append(messageNode(botMessage));
  }

  persist();
  setBusy(false);
  scrollToEnd();
}

async function tailor(company: string, position: string, jobText: string): Promise<void> {
  setBusy(true);
  modal.setAttribute('hidden', '');

  const notice: ChatMessage = { role: 'assistant', content: 'Чета обявата и адаптирам CV-то към нея…' };
  thread.messages.push(notice);
  messagesEl.append(messageNode(notice));
  scrollToEnd();

  try {
    const response = await fetch('/api/tailor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cv, jobText, company, position }),
    });
    const payload = (await response.json()) as {
      cv?: CV; before?: AtsReport; after?: AtsReport; similarity?: number | null; notes?: string[]; error?: string; warning?: string;
    };
    if (!response.ok || !payload.cv) throw new Error(payload.error || payload.warning || `HTTP ${response.status}`);

    cv = payload.cv;
    putCV(cv);

    const before = payload.before?.total ?? 0;
    const after = payload.after?.total ?? before;
    const text = [
      `Готово. Съвпадението с обявата се вдигна от ${before} на ${after} от 100${
        typeof payload.similarity === 'number' ? `, смислово сходство ${payload.similarity}%` : ''
      }.`,
      payload.after?.missingKeywords.length
        ? `Все още липсват: ${payload.after.missingKeywords.slice(0, 5).join(', ')}. Имаш ли опит с тях?`
        : 'Всички ключови думи от обявата присъстват.',
      payload.notes?.length ? payload.notes.slice(0, 3).map((note) => `• ${note}`).join('\n') : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const botMessage: ChatMessage = {
      role: 'assistant',
      content: text,
      actions: [`Адаптирах към ${company || 'обявата'}`],
    };
    thread.messages.push(botMessage);
    messagesEl.append(messageNode(botMessage));

    update((state) => {
      state.applications.unshift({
        id: `app_${Math.random().toString(36).slice(2, 9)}`,
        company: company || 'Без име',
        position: position || cv.contact.title,
        status: 'draft',
        date: new Date().toISOString().slice(0, 10),
        cvId: cv.id,
      });
    });

    renderPanel(payload.after);
    renderReplies(repliesFor(['Напиши мотивационно писмо', 'Изтегли PDF', 'Какво още да добавя?']));
  } catch (error) {
    const botMessage: ChatMessage = {
      role: 'assistant',
      content: `Адаптирането не успя: ${error instanceof Error ? error.message : 'неизвестна грешка'}`,
    };
    thread.messages.push(botMessage);
    messagesEl.append(messageNode(botMessage));
  }

  persist();
  setBusy(false);
  scrollToEnd();
}

async function coverLetter(): Promise<void> {
  if (busy) return;
  setBusy(true);
  const notice: ChatMessage = { role: 'assistant', content: 'Пиша мотивационното писмо…' };
  thread.messages.push(notice);
  messagesEl.append(messageNode(notice));
  scrollToEnd();

  try {
    const response = await fetch('/api/cover-letter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cv, company: cv.targetJob?.company, jobText: cv.targetJob?.description }),
    });
    const payload = (await response.json()) as { letter?: string; error?: string };
    if (!response.ok || !payload.letter) throw new Error(payload.error || `HTTP ${response.status}`);

    cv = { ...cv, coverLetter: payload.letter, updatedAt: new Date().toISOString() };
    putCV(cv);

    const botMessage: ChatMessage = {
      role: 'assistant',
      content: 'Писмото е готово — отвори раздел „Писмо“ вдясно. Кажи ми, ако искаш по-кратък или по-официален вариант.',
      actions: ['Написах мотивационно писмо'],
    };
    thread.messages.push(botMessage);
    messagesEl.append(messageNode(botMessage));
    renderPanel();
    switchTab('letter');
  } catch (error) {
    const botMessage: ChatMessage = {
      role: 'assistant',
      content: `Писмото не се получи: ${error instanceof Error ? error.message : 'неизвестна грешка'}`,
    };
    thread.messages.push(botMessage);
    messagesEl.append(messageNode(botMessage));
  }

  persist();
  setBusy(false);
  scrollToEnd();
}

async function analyse(): Promise<void> {
  if (busy) return;

  if (analysesLeft() <= 0) {
    const notice: ChatMessage = { role: 'assistant', content: LIMIT_MESSAGE };
    thread.messages.push(notice);
    messagesEl.append(messageNode(notice));
    persist();
    scrollToEnd();
    return;
  }

  setBusy(true);
  const notice: ChatMessage = { role: 'assistant', content: 'Анализирам CV-то…' };
  thread.messages.push(notice);
  messagesEl.append(messageNode(notice));
  scrollToEnd();

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cv, jobText: cv.targetJob?.description }),
    });
    const payload = (await response.json()) as { report?: AtsReport; review?: string; warning?: string };
    const report = payload.report ?? scoreCV(cv);

    const text = [
      `ATS резултат: ${report.total}/100 — ${report.label.toLowerCase()}.`,
      payload.review || report.findings.map((finding) => `• +${finding.points} точки: ${finding.text}`).join('\n'),
      payload.warning ?? '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const botMessage: ChatMessage = { role: 'assistant', content: text, actions: [`Изчислих ATS скор: ${report.total}`] };
    thread.messages.push(botMessage);
    messagesEl.append(messageNode(botMessage));

    consumeAnalysis();
    renderPanel(report);
  } catch (error) {
    const botMessage: ChatMessage = {
      role: 'assistant',
      content: `Анализът не успя: ${error instanceof Error ? error.message : 'неизвестна грешка'}`,
    };
    thread.messages.push(botMessage);
    messagesEl.append(messageNode(botMessage));
  }

  persist();
  setBusy(false);
  scrollToEnd();
}

// --------------------------------------------------------------------- tabs
function switchTab(name: string): void {
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach((tab) => {
    tab.classList.toggle('current', tab.dataset.tab === name);
  });
  document.querySelectorAll<HTMLElement>('[data-tab-panel]').forEach((panel) => {
    if (panel.dataset.tabPanel === name) panel.removeAttribute('hidden');
    else panel.setAttribute('hidden', '');
  });
}

// ------------------------------------------------------------------- wiring
formEl.addEventListener('submit', (event) => {
  event.preventDefault();
  void send(inputEl.value);
});

inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void send(inputEl.value);
  }
});

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(160, inputEl.scrollHeight)}px`;
});

document.querySelectorAll<HTMLElement>('[data-tab]').forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab!));
});

$('[data-reset]')?.addEventListener('click', () => {
  if (!confirm('Да започнем ли нов разговор? Текущият остава в списъка „Скорошни“.')) return;
  const template = findTemplate(cv.templateId);
  const fresh = template ? cvFromTemplate(template) : emptyCV('Ново CV');
  const id = `thread_${Math.random().toString(36).slice(2, 9)}`;
  thread = {
    id,
    title: template ? template.name : 'Нов разговор',
    cvId: fresh.id,
    updatedAt: new Date().toISOString(),
    messages: [{ role: 'assistant', content: template ? templateGreeting(template) : GREETING }],
  };
  cv = fresh;
  persist();
  renderMessages();
  renderPanel();
  renderReplies(repliesFor(DEFAULT_REPLIES));
});

$('[data-download]')?.addEventListener('click', () => {
  persist();
  window.open(`/pechat?cv=${encodeURIComponent(cv.id)}`, '_blank', 'noopener');
});

document.querySelectorAll<HTMLElement>('[data-tool]').forEach((button) => {
  button.addEventListener('click', () => {
    switch (button.dataset.tool) {
      case 'upload':
        fileInput.click();
        break;
      case 'job':
        modalError.setAttribute('hidden', '');
        modal.removeAttribute('hidden');
        $<HTMLTextAreaElement>('[data-job-text]')?.focus();
        break;
      case 'letter':
        void coverLetter();
        break;
      case 'analyze':
        void analyse();
        break;
    }
  });
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void uploadCV(file);
  fileInput.value = '';
});

$('[data-modal-close]')?.addEventListener('click', () => modal.setAttribute('hidden', ''));
modal.addEventListener('click', (event) => {
  if (event.target === modal) modal.setAttribute('hidden', '');
});

$('[data-modal-submit]')?.addEventListener('click', () => {
  const jobText = $<HTMLTextAreaElement>('[data-job-text]')!.value.trim();
  if (jobText.length < 60) {
    modalError.textContent = 'Постави пълния текст на обявата — нужни са поне няколко изречения.';
    modalError.removeAttribute('hidden');
    return;
  }
  void tailor(
    $<HTMLInputElement>('[data-job-company]')!.value.trim(),
    $<HTMLInputElement>('[data-job-position]')!.value.trim(),
    jobText,
  );
});

$('[data-copy-letter]')?.addEventListener('click', async () => {
  if (!cv.coverLetter) return;
  try {
    await navigator.clipboard.writeText(cv.coverLetter);
    toast('Писмото е копирано.');
  } catch {
    toast('Копирането не е разрешено от браузъра.');
  }
});

// Drag & drop an existing CV anywhere over the thread.
['dragover', 'drop'].forEach((type) => {
  document.addEventListener(type, (event) => event.preventDefault());
});
document.addEventListener('drop', (event) => {
  const file = (event as DragEvent).dataTransfer?.files?.[0];
  if (file) void uploadCV(file);
});

// The design's full placeholder wraps to two lines on a phone; shorten it there.
if (window.matchMedia('(max-width: 700px)').matches) {
  inputEl.placeholder = 'Напиши отговор…';
}

// ------------------------------------------------------------------ startup
// Opening /chat?template=frontend starts a fresh CV on that template.
const requestedTemplate = findTemplate(new URLSearchParams(location.search).get('template') ?? undefined);
if (requestedTemplate && !cv.templateId) {
  cv = cvFromTemplate(requestedTemplate);
  thread = {
    id: `thread_${Math.random().toString(36).slice(2, 9)}`,
    title: requestedTemplate.name,
    cvId: cv.id,
    updatedAt: new Date().toISOString(),
    messages: [{ role: 'assistant', content: templateGreeting(requestedTemplate) }],
  };
  persist();
  history.replaceState(null, '', `/chat?thread=${thread.id}`);
}

if (!thread.messages.length) {
  const template = findTemplate(cv.templateId);
  thread.messages.push({ role: 'assistant', content: template ? templateGreeting(template) : GREETING });
}

renderMessages();
renderPanel();

renderReplies(
  repliesFor(
    thread.messages.length <= 1 ? DEFAULT_REPLIES : ['Продължи', 'Анализирай CV-то', 'Адаптирай към обява'],
  ),
);

// A starter picked on /shabloni opens the chat with that message already sent.
const pending = sessionStorage.getItem('cvbot.pendingPrompt');
if (pending) {
  sessionStorage.removeItem('cvbot.pendingPrompt');
  void send(pending);
}
