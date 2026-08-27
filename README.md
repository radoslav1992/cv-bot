# CV Bot

Разговорен помощник за автобиографии на български език. Astro приложение, което се
деплойва като **Cloudflare Worker** и работи изцяло върху **Cloudflare Workers AI**.

Интерфейсът следва предадения дизайн от Claude Design (`CV Bot.dc.html`) — същата
палитра, типография и екрани: начална страница, цени, чат, табло, CV-та, кандидатури,
шаблони, настройки, вход/регистрация и шестте правни документа.

---

## Какво прави

| Инструмент | Къде се вижда | Как работи |
| --- | --- | --- |
| CV от нула чрез разговор | `/chat` | Моделът задава по един въпрос и записва отговорите чрез function calling |
| Оценка на съществуващо CV | `/chat`, `/cv` | Детерминистичен ATS скор + написан анализ от модела |
| ATS оптимизация | навсякъде | Скор по 5 измерения с конкретни „+N точки“ препоръки |
| Качване на старо CV | `/chat`, `/tablo` | PDF/DOCX/изображение → Markdown през `AI.toMarkdown()` → структуриран JSON |
| Адаптиране към обява | `/chat` | Сравнение на ключови думи + ембединги, отделна версия на CV-то |
| Мотивационно писмо | `/chat`, `/cv` | Генерира се от CV-то и обявата, влиза в PDF-а като втора страница |
| Проследяване на кандидатури | `/kandidaturi` | Дъска по статус, попълва се и автоматично при адаптиране |
| Изтегляне в PDF | `/pechat` | Една колона, без таблици и изображения — три оформления |
| Износ и изтриване на данни | `/nastroyki` | JSON експорт и пълно локално изтриване (GDPR чл. 17 и чл. 20) |

## Използвани модели (Workers AI)

Всички се извикват през `AI` binding-а — няма външен доставчик.

| Задача | Модел | Файл |
| --- | --- | --- |
| Разговор + инструменти | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | `src/lib/ai.ts` |
| Бързи предложения, пренаписвания, извличане | `@cf/meta/llama-3.1-8b-instruct-fast` | `src/lib/ai.ts` |
| Смислово сходство CV ↔ обява | `@cf/baai/bge-m3` | `src/lib/ai.ts` |
| PDF/DOCX → Markdown | `AI.toMarkdown()` | `src/lib/extract.ts` |

Моделите се сменят през `vars` в `wrangler.jsonc` (`CVBOT_CHAT_MODEL`, `CVBOT_FAST_MODEL`,
`CVBOT_EMBEDDING_MODEL`) без промяна в кода.

**ATS скорът не се генерира от модел.** `src/lib/ats.ts` го изчислява детерминистично по
структура, ключови думи, измерими резултати, четимост и формат — за да е стабилен,
възпроизводим и обясним. Моделът пише само текста около числото.

## Стартиране

```bash
npm install
npm run preview        # astro build + wrangler dev на http://localhost:8787
```

Workers AI няма локална емулация — binding-ът винаги минава през Cloudflare. Затова преди
`npm run preview` изпълни веднъж:

```bash
npx wrangler login     # или: export CLOUDFLARE_API_TOKEN=...
```

Без вход приложението се зарежда, но всеки AI отговор връща честно съобщение, че моделът
не е свързан — нищо не се симулира.

```bash
npm run build          # продукционен билд
npm test               # тестове на ATS скора и AI слоя (28 теста)
npm run check          # TypeScript
```

## Деплой

`wrangler.jsonc` носи единствения нужен binding:

```jsonc
"ai": { "binding": "AI" }
```

Няма KV, D1 или R2 — нищо не се създава ръчно преди първия деплой.

### Ръчно

```bash
npm run deploy         # astro build && wrangler deploy
```

### През GitHub

Има два начина. **Избери един** — ако включиш и двата, всеки push ще деплойва два пъти.

#### Вариант А — Cloudflare Workers Builds (без секрети в GitHub)

Cloudflare се свързва директно с репозиторито и билдва при всеки push.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. Избери `cv-bot` и клона, от който да се деплойва (`main`).
3. Настройки на билда:

   | Поле | Стойност |
   | --- | --- |
   | Root directory | `/` |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |

   Версията на Node се взима от `.node-version` (22).
4. Готово. Всеки push към `main` деплойва; за pull request Cloudflare качва preview версия с отделен URL.

При този вариант изтрий `.github/workflows/deploy.yml` (или го остави само на
`workflow_dispatch`), за да няма двоен деплой. `ci.yml` остава полезен —
проверява типовете, тестовете и бъндъла на всеки PR.

#### Вариант Б — GitHub Actions

`.github/workflows/deploy.yml` деплойва при push към `main` и ръчно от
**Actions → Deploy → Run workflow**. Преди първия път добави два секрета в
**Settings → Secrets and variables → Actions → New repository secret**:

| Секрет | Откъде |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → **API Tokens** → Create Token → шаблон **Edit Cloudflare Workers** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → колоната вдясно, **Account ID** |

Workflow-ът пуска тестовете и билда, преди да деплойва, и записва URL-а на
Worker-а в GitHub Deployments. Ако секрет липсва, първата стъпка спира с ясно
съобщение вместо да се провали по средата.

`.github/workflows/ci.yml` върви на всеки pull request: TypeScript, тестове, билд
и `wrangler deploy --dry-run` — така счупен binding или прекалено голям бъндъл
падат на PR-а, не при деплоя. Не иска секрети и работи и от форк.

## Как е устроено

```
src/
  pages/
    index, ceni, chat, tablo, cv, kandidaturi, shabloni, nastroyki   екрани
    vhod, registraciya, zabravena-parola, nova-parola, potvarzhdenie  вход
    pravna/[doc]                                                     6 правни документа
    pechat                                                           PDF изглед
    api/chat, analyze, tailor, cover-letter, extract, ats            SSR endpoints
  lib/
    ai.ts        Workers AI обвивка (стрийминг, tool calls, ембединги, toMarkdown)
    tools.ts     11 инструмента за function calling + изпълнението им
    ats.ts       детерминистичен ATS скор и извличане на ключови думи
    extract.ts   качен документ → структурирано CV
    prompts.ts   системните промптове (на български)
    store.ts     workspace в localStorage
    render.ts    рендериране на документа (чат, редактор, печат)
  styles/global.css   токените от дизайна
  scripts/            клиентска логика на чата, таблото, CV-то, кандидатурите
```

### Поток на един чат ход

1. Браузърът праща историята **и текущото CV** към `POST /api/chat`.
2. Worker-ът вика модела с 11 инструмента. Извиканите се изпълняват на сървъра
   (`src/lib/tools.ts`) и променят CV-то.
3. Финалният отговор се стриймва като NDJSON: `delta`, `action`, `cv`, `score`, `replies`.
4. Браузърът рисува текста дума по дума, обновява прегледа вдясно и записва локално.

### Къде се пазят данните

CV-тата, разговорите и кандидатурите живеят в `localStorage` на потребителя. Worker-ът е
без състояние — съдържанието стига до него само докато трае една заявка. Това отговаря на
обещанието в Политиката за поверителност и прави деплоя безсхемен.

## Съзнателни ограничения

- **Вход/регистрация** са екрани с локална сесия (валидация, запазване на профил в
  браузъра). Няма сървърна автентикация, база с потребители и реални имейли — това е
  следващата стъпка преди продукция.
- **Планът Про** се превключва демонстративно от Настройки. Лимитът от 3 анализа е
  продуктов guard-rail в браузъра, не платежна интеграция.
- **PDF-ът** се получава през диалога за печат на браузъра (`Запази като PDF`), а не през
  генератор на сървъра — така кирилицата излиза правилно без вграждане на шрифтове.
- Пътят с истински модел е тестван само чрез мокнат binding (`test/ai.test.ts`); за
  проверка с реални отговори е нужен Cloudflare акаунт.
