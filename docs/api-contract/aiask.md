# Ask Peuin API contract

| Method | Endpoint | Responsibility |
| --- | --- | --- |
| POST | `/api/v1/ai/ask` | Chat with Peuin and optionally request food recommendations |
| GET | `/api/v1/ai/sessions/today` | Get or create the authenticated user's daily chat session |
| POST | `/api/v1/ai/recommendations/feedback` | Save feedback for an owned recommendation |
| POST | `/api/v1/ai/personality/reply` | Generate a raw personality-grounded Gemini reply from supplied context |
| GET | `/api/v1/ai/personality/health` | Verify the personality markdown source is readable |

All endpoints require a Supabase Bearer token. Session and recommendation ownership are enforced by the existing `ask-peuin` function and its RLS-aware queries.

The existing `/ask-peuin`, `/user/ask-peuin`, `/personality`, and `/user/personality` routes remain hidden compatibility aliases.
