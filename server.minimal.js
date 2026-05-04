// ============================================
// MINIMAL SERVER (no DB, quick testing only)
// Run: node server.minimal.js
// ============================================

const express = require('express');
const { OpenAI } = require('openai');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ================= OPENROUTER =================
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
        "HTTP-Referer": process.env.FRONTEND_URL || "http://localhost:5173",
        "X-Title": "CodeShare App"
    }
});

// ================= HELPER =================
function parseAIResponse(text) {
    // Try strict [CODE]...[OUTPUT] format first
    if (text.includes("[CODE]")) {
        const code = text.split("[CODE]")[1]?.split("[OUTPUT]")[0]?.trim() || "";
        const output = text.split("[OUTPUT]")[1]?.trim() || "";
        return { code, output };
    }

    // Fallback: extract markdown code blocks ```lang ... ```
    const codeBlockMatch = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
        const code = codeBlockMatch[1].trim();
        const afterBlock = text.split(/```[\s\S]*?```/).pop()?.trim() || "";
        return { code, output: afterBlock };
    }

    // Last resort: treat entire response as code
    return { code: text.trim(), output: "" };
}

function buildPrompt(input) {
    return `You are a coding assistant.

STRICT:
- No explanation
- No comments
- Only format

[CODE]
<code>

[OUTPUT]
<output>

Question: ${input}`;
}

// ================= API =================
app.post('/api/generate', async (req, res) => {
    try {
        const { userInput } = req.body;

        if (!userInput) {
            return res.status(400).json({ error: "Input required" });
        }

        const prompt = buildPrompt(userInput);

        const completion = await openai.chat.completions.create({
            model: "openrouter/free",
            messages: [
                { role: "user", content: prompt }
            ],
            temperature: 0.2
        });

        const text = completion.choices[0].message.content;
        const { code, output } = parseAIResponse(text);

        res.json({
            success: true,
            code,
            output
        });

    } catch (err) {
        console.error("ERROR:", err.message);
        res.status(500).json({
            error: err.message,
            details: err.response?.data
        });
    }
});

// ================= HEALTH =================
app.get('/health', (req, res) => {
    res.json({ status: "ok" });
});

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Minimal server running on port ${PORT}`);
});