// Thin wrapper around the Anthropic Messages API, shared by the AI-powered
// endpoints (portfolio insights, monthly reports).
//
// Requires an ANTHROPIC_API_KEY environment variable set in your Vercel
// project (Project Settings → Environment Variables). Get a key at
// https://console.anthropic.com/settings/keys — this calls the API directly
// with your own key, so usage is billed to your Anthropic account.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export async function callClaude({ system, user, maxTokens = 600 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "AI features aren't set up yet. Add an ANTHROPIC_API_KEY in your Vercel project's Environment Variables, then redeploy."
    );
    err.code = "MISSING_API_KEY";
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  let res;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
  } catch (err) {
    throw new Error(err.name === "AbortError" ? "Claude API timed out." : `Claude API request failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude API returned ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find(b => b.type === "text");
  if (!textBlock) throw new Error("Claude API returned an empty response.");
  return textBlock.text.trim();
}
