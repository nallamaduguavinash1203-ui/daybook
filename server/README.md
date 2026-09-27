# Daybook AI server

This server keeps the OpenAI API key out of the React frontend.

## Setup

1. Open a terminal in this `server` folder.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Put your OpenAI API key in `OPENAI_API_KEY`.
5. Run `npm run dev`.

The API listens on `http://localhost:8787` by default.

The React app calls `POST /api/course-plan`.
Set `VITE_DAYBOOK_AI_URL` if the backend is hosted somewhere other than `http://localhost:8787`.
