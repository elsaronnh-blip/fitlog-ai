export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.OPENAI_API_KEY) {
    return response.status(500).json({ error: "OPENAI_API_KEY is not configured" });
  }

  const { meal = "", photo = null } = request.body || {};
  const content = [
    {
      type: "input_text",
      text:
        "Estimate calories for this meal. Return only JSON like " +
        '{"calories": 620, "confidence": "medium", "notes": "short reason"}. ' +
        `Meal notes: ${meal || "No notes provided."}`,
    },
  ];
  if (photo) content.push({ type: "input_image", image_url: photo, detail: "low" });

  const aiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      input: [{ role: "user", content }],
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
