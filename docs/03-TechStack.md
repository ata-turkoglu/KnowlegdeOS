# Tech Stack

## Backend

- Node.js
- TypeScript
- Fastify
- PostgreSQL
- Drizzle ORM
- pgvector
- pg_trgm
- unaccent

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui optional

## AI

- Ollama
- qwen3:8b default
- qwen3:4b lightweight option
- embedding provider abstraction

## Embeddings

İlk adaylar:

- multilingual-e5-small
- bge-m3
- nomic-embed-text

Türkçe belgeler için multilingual modeller tercih edilmelidir.

## Local-only

Projede şunlar olmayacak:

- Authentication
- Tenant
- Billing
- Cloud upload
- External AI API
- Hosted vector DB

## Çalıştırma Yolları

### Development

```bash
pnpm install
pnpm dev
```

### Docker

```bash
docker compose up -d
```

Docker taşınabilirlik için desteklenir ama uygulama Docker'a tamamen bağımlı olmamalıdır.

## .env.example

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/knowledgeos
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_LLM_MODEL=qwen3:8b
OLLAMA_EMBEDDING_MODEL=multilingual-e5-small
STORAGE_ROOT=./storage
API_PORT=4000
WEB_PORT=3000
```
