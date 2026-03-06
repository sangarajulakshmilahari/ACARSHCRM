# Next.js + TypeScript + Redux Sample

Features:
- Login page (demo credentials: admin / 1234)
- Employee CRUD with Next.js API routes
- Local JSON file persistence (`/data/employees.json`)
- Redux Toolkit for session and employee state

How to run:
1. npm install
2. npm run dev
3. Open http://localhost:3000

Project structure:
- app/                 -> Next.js app (pages, API routes)
- store/               -> Redux store + slices
- data/employees.json  -> JSON file used by API routes
