# ⚠️ DEPRECATED — this sketch is stale, do not trust it

> As of 2026-07-11 this file is kept only for history. It predates most of the data model (it's missing `Content.agent_settings/topics/description/title_image`, the denormalized author fields, and the entire `ChatSession`, `StudentMemory`, `LearningHistory`, `Category`, and `Image` models, plus Google-auth's optional `password`/`googleId`).

**Use these instead:**

- **The source of truth:** the Mongoose models themselves — `server/src/models/*.model.ts`.
- **The mental model (ERD + entity lifecycles):** [`../../../docs/data-model.md`](../../../docs/data-model.md).
- **The field-level table:** [`../../CLAUDE.md`](../../CLAUDE.md) §"Data model".

Everything below is the **original 2026-era hand sketch**, preserved verbatim for historical reference only. **It is incomplete and out of date — do not use it to understand the current schema.**

---

## Historical sketch (stale)

```
User
├── name: String
├── email: String (unique)
├── password: String (hashed)
├── role: enum [admin, creator, learner]
└── status: enum [active, blocked, suspended]

User_data
├── user_id → User
├── avatar: String
├── bio: String
└── ...whatever huge data later

Content
├── owner_id → User
├── collaborators: [User]
├── title: String
├── tiptap_json: String
├── access_type: enum [public, link-only, private]
├── created_at: Date
└── updated_at: Date

User_content  (progress/answers tracker)
├── user_id → User
├── content_id → Content
├── answers: Map<component_id, any>
└── last_visited: Date
```
