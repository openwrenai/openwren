---
name: brave-search
description: Search the web using Brave Search API. Use when the user asks about current events, recent news, or anything that benefits from a live web search.
requires:
  env: [BRAVE_API_KEY]
---

You have access to a `search_web` tool.

**When to search:**
- Current events, news, or recent information
- Facts you're unsure about or that may have changed
- Technical documentation or API references
- Anything the user explicitly asks you to look up

**Best practices:**
- Prefer 2-3 focused searches over one broad query
- Always cite your sources by including the URL in your response
- If the first search doesn't give good results, try rephrasing
- Don't search for things you already know well
