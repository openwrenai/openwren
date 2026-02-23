# Vector Embeddings for Memory Search

## Problem

Current `memory_search` uses keyword matching (OR logic) — if any word from the query appears in a file, it's a match. Works fine with a handful of files but gets noisy as memory grows. Also can't find semantic matches (e.g. "auth bug" won't find a file about "authentication issues").

## What Vector Embeddings Are

Instead of matching literal words, text is converted into a big array of numbers (e.g. 1536 floats) that represent the **meaning** of the text. Texts with similar meaning end up close together in that number space.

So `"auth bug"` and `"authentication issues"` produce very similar vectors, even though they share zero words.

## What's Needed

### 1. An Embedding Model

Something that converts text → vector. Two options:

- **Cloud:** OpenAI's `text-embedding-3-small` or Voyage AI — one API call, get back a vector. Cheap (~$0.02 per million tokens)
- **Local:** Run an embedding model through Ollama (`nomic-embed-text`, `mxbai-embed-large`). Free, offline, no API calls — fits the project philosophy. Hit `http://localhost:11434/api/embeddings` the same way we already hit Ollama for chat

### 2. Storage

Do **NOT** need a vector database. Three tiers:

| Option | What it is | When it makes sense |
|---|---|---|
| **JSON file** | Store vectors as arrays in a flat file, brute-force cosine similarity on search | < 1,000 memories. Dead simple, no dependencies |
| **SQLite + extension** | `sqlite-vec` or `sqlite-vss` extension adds vector search to SQLite | 1,000–100,000 memories. Single file, no server |
| **Vector DB** | Pinecone, Qdrant, ChromaDB, etc. | Millions of records, multi-user, production SaaS |

For a personal bot with a few hundred memory files — **a JSON file is more than enough**.

### 3. Implementation Sketch

```typescript
// On save_memory:
const vector = await embed(content);  // [0.023, -0.11, 0.87, ...]
memories.push({ key, content, vector });
writeFileSync("memory-vectors.json", JSON.stringify(memories));

// On memory_search:
const queryVector = await embed(query);
const results = memories
  .map(m => ({ ...m, score: cosineSimilarity(m.vector, queryVector) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 5);  // top 5 matches
```

Cosine similarity is ~10 lines of math. Brute-forcing 500 vectors takes < 1ms. No database needed. The whole upgrade to `memory.ts` would be maybe 40 lines of code.

## When to Upgrade

**Keyword search is fine right now** because:
- Small number of memory files
- OR-matching catches most things
- Zero dependencies, zero latency

**Vector search becomes worth it when:**
- 50+ memory files and keyword matches get noisy
- Want semantic matching ("what did we discuss about performance?" finds a file titled `atlas-optimization-notes` that never contains the word "performance")
- Already running Ollama anyway, so embedding locally is free

## Recommendation

Go with Ollama `nomic-embed-text` when the time comes — keeps everything local and offline. Store vectors in a JSON file alongside the memory directory. No new dependencies, no external services.


-------

What vector embeddings are
Instead of matching literal words, you convert text into a big array of numbers (e.g. 1536 floats) that represent the meaning of the text. Texts with similar meaning end up close together in that number space.

So "auth bug" and "authentication issues" would produce very similar vectors, even though they share zero words.

What you'd need
1. An embedding model — something that converts text → vector. Two options:

Cloud: OpenAI's text-embedding-3-small or Anthropic's Voyage AI — one API call, get back a vector. Cheap (~$0.02 per million tokens)
Local: Run an embedding model through Ollama (nomic-embed-text, mxbai-embed-large). Free, offline, same idea

2. Storage — here's where it gets interesting. You do NOT need a vector database. You have three options:

[Option]	[What it is]	[When it makes sense]
JSON file |	Store vectors as arrays in a flat file, brute-force cosine similarity on search	| < 1,000 memories. Dead simple, no dependencies
SQLite + extension |	sqlite-vec or sqlite-vss extension adds vector search to SQLite |	1,000–100,000 memories. Single file, no server
Vector DB |	Pinecone, Qdrant, ChromaDB, etc. |	Millions of records, multi-user, production SaaS


For a personal bot with maybe a few hundred memory files? A JSON file is more than enough. You'd literally just:

// On save_memory:
const vector = await embed(content);  // [0.023, -0.11, 0.87, ...]  
memories.push({ key, content, vector });
writeFileSync("memory-vectors.json", JSON.stringify(memories));

// On memory_search:
const queryVector = await embed(query);
const results = memories
  .map(m => ({ ...m, score: cosineSimilarity(m.vector, queryVector) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 5);  // top 5 matches

Cosine similarity is ~10 lines of math. Brute-forcing 500 vectors takes < 1ms. No database needed.

3. That's it. Seriously — embedding model + a JSON file + cosine similarity function. The whole upgrade to memory.ts would be maybe 40 lines of code.

The tradeoff for your project
Right now keyword search is fine because:

You have 3 memory files
OR-matching catches most things
Zero dependencies, zero latency
Vector search becomes worth it when:

You have 50+ memory files and keyword matches get noisy
You want "what did we discuss about performance?" to find a file titled atlas-optimization-notes that never contains the word "performance"
You're already running Ollama anyway, so embedding locally is free
If you go the Ollama route (nomic-embed-text), it stays fully local and offline — no API calls, no cost, fits the project philosophy. You'd just hit http://localhost:11434/api/embeddings the same way you already hit Ollama for chat.