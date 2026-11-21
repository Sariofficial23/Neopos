# NeoPos

Система автоматизации для кафе и ресторанов. Техзадание: [docs/TZ-v1.md](docs/TZ-v1.md).

## Состав

- `server/` — сервер (Node.js, Fastify, Drizzle). База: PostgreSQL, для разработки — встроенный PGlite (файлы в `server/data`, ставить ничего не нужно).
- `panel/` — панель управления (React, Tailwind).
- Терминал продаж и Telegram-бот — следующие этапы.

## Запуск для разработки

```powershell
npm install
npm run seed        # демо-заведение; логин и пароль — в server/data/demo-credentials.txt
npm run dev:server  # http://127.0.0.1:4000
npm run dev:panel   # http://localhost:5190
```

## Боевой режим

Задать `DATABASE_URL` (PostgreSQL), `JWT_SECRET`, `NODE_ENV=production`.
Чтобы закрыть свободную регистрацию заведений: `ALLOW_REGISTER=false`.

После изменения `server/src/db/schema.ts` — `npm run db:generate`.
