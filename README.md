# Code Share API — Full System

AI-powered code generation, cleaning, and sharing platform.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│    API      │────▶│   OpenAI    │
│  (React/Vue)│◀────│  (Express)  │◀────│   (GPT-4.1) │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │  PostgreSQL │
                    │  (Snippets) │
                    └─────────────┘
```

## Quick Start

```bash
# 1. Clone & install
cd code-share-api
npm install

# 2. Set up environment
cp 03_.env.example .env
# Edit .env with your OPENAI_API_KEY and DATABASE_URL

# 3. Run database migrations
npm run db:migrate

# 4. Start server
npm run dev
```

## Or use Docker:

```bash
docker-compose up
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/generate` | Generate/clean code from text |
| POST | `/api/upload` | Upload and process code file |
| GET | `/api/s/:slug` | Get shared snippet |
| GET | `/api/s/:slug/raw` | Get raw code only |
| GET | `/api/stats` | Admin statistics |

## Input Classification Logic

The system uses **deterministic classification** (not AI) to decide which prompt to use:

1. **File** — triggered by file upload (detected by extension)
2. **Code** — triggered by code patterns (functions, imports, braces, etc.)
3. **Question** — default fallback for natural language

This prevents AI misclassification and saves tokens.

## Prompt Strategy

Three specialized prompts instead of one "universal" prompt:
- **Question** → Generate new code
- **Code** → Clean/fix existing code  
- **File** → Extract and correct from file content

Each prompt is optimized for its specific task with strict formatting rules.

## Database Schema

- `snippets` — main storage for all generated code
- `file_uploads` — metadata for uploaded files
- `api_logs` — request tracking and analytics
- `users` — optional user accounts
