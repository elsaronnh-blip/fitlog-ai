export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.OPENAI_API_KEY) {
    return response.status(500).json({ error: "OPENAI_API_KEY is not configured" });
  }

  const { name = "", minutes = "", intensity = "", link = "" } = request.body || {};
  const aiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      input:
        "Estimate calories burned for this workout. Return only JSON like " +
        '{"calories": 280, "confidence": "medium", "notes": "short reason"}. ' +
        `Workout: ${name}. Minutes: ${minutes}. Intensity: ${intensity}. Link or title: ${link}.`,
    }),
  });

  const data = await aiResponse.json();
  if (!aiResponse.ok) return response.status(aiResponse.status).json(data);

  const text = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.text)?.text || "{}";
  return response.status(200).json(parseJsonEstimate(text));
}

function parseJsonEstimate(text) {
  const match = text.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : text);
}
