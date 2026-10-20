# Brown-chat API

FastAPI backend for Brown-chat.

```bash
uv sync --dev
uv run uvicorn app.main:app --reload
```

## Chat API

Brown-Chat stores conversations before requesting a model response. All routes require the
Brown-Chat authentication cookie.

- `POST /api/v1/chat/sessions` — create a session and store its first user input
- `GET /api/v1/chat/sessions` — list the current user's recent sessions
- `GET /api/v1/chat/sessions/{session_id}` — load one owned session and its messages
- `POST /api/v1/chat/sessions/{session_id}/messages` — add the next user input
- `POST /api/v1/chat/sessions/{session_id}/generate` — call the configured model and store output

The provider must expose an OpenAI-compatible `POST /v1/chat/completions` endpoint. Configure
`CHAT_API_BASE_URL`, `CHAT_API_MODEL`, and optionally `CHAT_API_KEY` in `.env`. Until those values
are provided, inputs remain stored and the generation route returns `503`, so the UI can retry.

