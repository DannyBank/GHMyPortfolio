import { callClaude } from "./_aiClient.js";

// POST /api/ai-summary
// Body: { stats: {...portfolio snapshot...} }
// Returns: { summary: "2-4 sentence plain-English recap" }
//
// The frontend does all the arithmetic (totals, allocation %, day movers) —
// we only ask Claude to turn already-correct numbers into prose. This is
// deliberately cheaper and more reliable than asking a model to recompute
// financial figures itself.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { stats } = req.body || {};
    if (!stats || typeof stats !== "object") {
      res.status(400).json({ error: true, message: "Missing 'stats' in request body." });
      return;
    }

    const system = `You are a portfolio analyst writing a short, plain-English summary for a personal investor tracking their Ghana Stock Exchange (GSE) portfolio, T-Bills, and mutual funds.

Rules:
- Write 2-4 sentences of plain prose. No headers, no bullet points, no markdown, no emoji.
- Use only the numbers given to you — never invent or estimate a figure that isn't provided.
- Reference specific stock symbols or figures where it makes the summary concrete and useful.
- Keep the tone calm and factual, like a neutral analyst — not hype, not alarmist.
- Do not give investment advice, and do not recommend buying, selling, or rebalancing anything.
- All currency figures are in Ghanaian Cedis (GHS) unless a currency is stated otherwise.`;

    const user = `Here is the current portfolio snapshot as JSON:\n\n${JSON.stringify(stats, null, 2)}\n\nWrite the summary now.`;

    const summary = await callClaude({ system, user, maxTokens: 300 });
    res.status(200).json({ summary });
  } catch (err) {
    console.error("[ai-summary] failed:", err.message);
    res.status(err.code === "MISSING_API_KEY" ? 501 : 502).json({ error: true, message: err.message });
  }
}
