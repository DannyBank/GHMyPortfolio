import { callClaude } from "./_aiClient.js";

// POST /api/ai-monthly-report
// Body: { month: "July 2026", trades: [...], portfolioContext: {...} }
// Returns: { report: "markdown report" }
//
// Like ai-summary, all figures come pre-computed from the frontend — Claude's
// job is turning that structured data into a readable written report, not
// doing the arithmetic itself.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { month, trades, portfolioContext } = req.body || {};
    if (!month || !Array.isArray(trades) || !trades.length) {
      res.status(400).json({ error: true, message: "Missing 'month' or 'trades' in request body." });
      return;
    }

    const system = `You are writing a monthly investment activity report for a personal investor tracking their Ghana Stock Exchange (GSE) portfolio, T-Bills, and mutual funds.

Write clean Markdown with exactly these three sections, in this order:
## Overview
2-3 sentences summarizing the month's activity at a glance (how much was invested, in how many trades/stocks).
## Activity This Month
A short narrative walking through what was bought or sold, referencing the actual symbols, share counts, and amounts given. Group by stock where it reads more naturally than a strict trade-by-trade list.
## Notes
Purely observational remarks worth flagging — e.g. concentration in one stock, a notably large single trade, a stock bought repeatedly (dollar-cost-averaging pattern). This is NOT investment advice — do not recommend buying, selling, or rebalancing anything. If there's nothing notable, say so briefly.

Rules:
- Use only the figures provided — never invent or estimate a number.
- Keep the whole report under 300 words.
- All currency figures are in Ghanaian Cedis (GHS) unless a currency is stated otherwise.`;

    const user = `Month: ${month}

Trades this month (JSON):
${JSON.stringify(trades, null, 2)}

Overall portfolio context (JSON, for background only — this report should focus on the month above):
${JSON.stringify(portfolioContext || {}, null, 2)}

Write the report now.`;

    const report = await callClaude({ system, user, maxTokens: 900 });
    res.status(200).json({ report });
  } catch (err) {
    console.error("[ai-monthly-report] failed:", err.message);
    res.status(err.code === "MISSING_API_KEY" ? 501 : 502).json({ error: true, message: err.message });
  }
}
