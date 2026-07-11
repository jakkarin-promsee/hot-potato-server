# models/ — the data contract (Mongoose)

> Updated 2026-07-11 · local quick-reference. **These files are the source of truth.** Mental model + ERD + lifecycles: [`../../../docs/data-model.md`](../../../docs/data-model.md). Field table: [`../../CLAUDE.md`](../../CLAUDE.md) §"Data model".

Nine models. Two spines (`User`, `Content`); the rest hang off the user or the (user, content) pair. `timestamps` add `createdAt`/`updatedAt` unless overridden.

## Files

| File | Model · one-line |
| --- | --- |
| `user.model.ts` | **User** — account; bcrypt `pre("save")` hash, `comparePassword`; `password` optional (Google), `googleId` unique+sparse; role/status |
| `user_data.model.ts` | **UserData** — optional profile extension (avatar/bio/`metadata`) |
| `content.model.ts` | **Content** — the lesson: `tiptap_json`, `access_type`, `agent_settings`, topics/description, denormalized `author_name`/`collaborator_names` |
| `user_content.model.ts` | **UserContent** — per (user, content) `answers: Map<blockId, any>` + `last_visited` (unique compound) |
| `learning_history.model.ts` | **LearningHistory** — per (user, content) recency for "recently opened" |
| `chat_session.model.ts` | **ChatSession** — per (user, content, block) tutor thread; 50-msg cap (pre-save) |
| `student_memory.model.ts` | **StudentMemory** — one sketch per user (interests/strengths/…) + `tutor_personality` |
| `category.model.ts` | **Category** — image-library folder (unique per user+name; `created_at` only) |
| `image.model.ts` | **Image** — Cloudinary metadata (`public_id` unique) |
| `schema.md` | ⚠️ **Deprecated** stale hand-sketch — see [`../../../docs/data-model.md`](../../../docs/data-model.md) |

## Gotchas
- **Access control is NOT here** — it's in the controllers.
- **No cascade deletes** — deleting a Content/User leaves dependent rows (a future delete-account flow must cascade).
- Denormalized author fields are maintained by `services/contentAuthorSnapshot.service` — don't "fix" them with a join.
