# zQueue

Честная очередь на сдачу: случайный порядок с накопленным приоритетом и отдельные комнаты
по предметам. Работает на Cloudflare Workers + D1.

## Как устроено

- `src/domain.ts` — логика очереди: проверка команд и их применение к состоянию комнаты.
- `src/worker.ts` — API (`/api/rooms/...`) и раздача страницы из `public/`.
- `migrations/` — схема базы. В журнал `events` пишется всё, что влияет на порядок
  и начисления (список `LOGGED` в `src/domain.ts`); триггеры запрещают менять и удалять эти
  записи. Вкладка «История» строится по этому журналу.
- `public/` — интерфейс: стартовая страница и страница комнаты.

Доступ: смотреть комнату может любой по коду. Менять — создатель и редакторы, которым он
выдал ссылку-ключ (`/r/КОД#key=...`). Ключ хранится в браузере, на сервере — только его хеш.

## Запуск локально

Нужен Node.js (LTS).

```bash
npm install
npm run db:migrate:local
npm run dev
```

Сайт откроется на http://localhost:8787. Данные из старой версии (`queue-data.json`)
переносятся через «Настройки → Перенос из старой версии» в новой комнате.

## Публикация

```bash
npx wrangler login
npx wrangler d1 create queue-db
```

Скопируйте `database_id` из вывода в `wrangler.jsonc`, затем:

```bash
npm run db:migrate
npm run deploy
```

Сайт будет доступен по адресу `queue.<аккаунт>.workers.dev`. Свой домен подключается в
панели Cloudflare: Workers → queue → Settings → Domains & Routes.

Резервная копия базы:

```bash
npx wrangler d1 export queue-db --remote --output backup.sql
```
