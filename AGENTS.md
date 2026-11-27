# Read the project rules first

This backend serves the **live production app**. Before you change anything here, read and follow
[`../AGENTS.md`](../AGENTS.md): look first, ask before changing the existing system, and never break login, orders,
payments or chat.

Backend reminders:

- Auth (`src/modules/auth/`, including the JWT strategy) and Redis (`src/redis/`) are on the path of every request.
  Treat them as protected.
- Do not change API routes, DTO shapes or socket events without approval. `master-web` depends on them.
- Schema changes and migrations always need approval and a rollback plan.
- Run the tests and the build before you report a change as done.
