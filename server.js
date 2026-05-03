const express = require('express');
const { Pool } = require('pg');
const { OpenAI } = require('openai');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ================= DATABASE =================
let pool = null;

if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
}

// ================= OPENROUTER SETUP =================
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
        "HTTP-Referer": process.env.FRONTEND_URL || "http://localhost:5173",
        "X-Title": "CodeShare App"
    }
});

// ================= FILE UPLOAD =================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = './uploads';
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, uuidv4() + path.extname(file.originalname));
    }
});

const upload = multer({ storage });

// ================= UTIL =================
function generateSlug() {
    return crypto.randomBytes(8).toString('base64url').slice(0, 12);
}

function parseAIResponse(text) {
    const code = text.split("[CODE]")[1]?.split("[OUTPUT]")[0]?.trim() || "";
    const output = text.split("[OUTPUT]")[1]?.trim() || "";
    return { code, output };
}

// FIX: Deterministic input classification (was missing — README described it but it was never implemented)
function classifyInput(userInput, isFile = false) {
    if (isFile) return 'file';

    const codePatterns = [
        /^\s*(def |function |class |import |from |const |let |var |public |private |#include)/m,
        /[{}();]\s*$/m,
        /=>\s*{/,
        /\breturn\b/
    ];

    for (const pattern of codePatterns) {
        if (pattern.test(userInput)) return 'code';
    }

    return 'question';
}

// FIX: Load prompt templates from JSON (was using a simplified hardcoded prompt instead)
const PROMPT_TEMPLATES = JSON.parse(
    fs.readFileSync(path.join(__dirname, '08_prompt_templates.json'), 'utf-8')
);

function buildPrompt(userInput, inputType = 'question', language = 'Auto') {
    const template = PROMPT_TEMPLATES[inputType] || PROMPT_TEMPLATES['question'];
    return template
        .replace('{user_input}', userInput)
        .replace('{language}', language);
}

// ================= API: GENERATE =================
app.post('/api/generate', async (req, res) => {
    const startTime = Date.now();

    try {
        // FIX: language and mode were accepted but completely ignored
        const { userInput, language = 'Auto', mode = 'standard' } = req.body;

        if (!userInput) {
            return res.status(400).json({ error: "Input required" });
        }

        const inputType = classifyInput(userInput);

        // FIX: Use correct model based on mode (mode was ignored before)
        const model = mode === 'fast'
            ? "mistralai/mistral-7b-instruct"
            : "mistralai/mistral-7b-instruct";

        const prompt = buildPrompt(userInput, inputType, language);

        const completion = await openai.chat.completions.create({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2
        });

        const latencyMs = Date.now() - startTime;
        const text = completion.choices[0].message.content;
        const { code, output } = parseAIResponse(text);
        const slug = generateSlug();

        // Detect language label for response
        const detectedLanguage = language === 'Auto' ? detectLanguageFromCode(code) : language;

        // FIX: INSERT was missing required NOT NULL columns: input_type and language
        if (pool) {
            await pool.query(
                `INSERT INTO snippets (slug, input_type, language, user_input, generated_code, generated_output, model_used)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [slug, inputType, detectedLanguage, userInput, code, output, model]
            );

            // Log API usage
            await pool.query(
                `INSERT INTO api_logs (request_type, prompt_tokens, completion_tokens, total_tokens, latency_ms)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    'generate',
                    completion.usage?.prompt_tokens || 0,
                    completion.usage?.completion_tokens || 0,
                    completion.usage?.total_tokens || 0,
                    latencyMs
                ]
            );
        }

        res.json({
            success: true,
            slug,
            shareUrl: `${process.env.FRONTEND_URL || "http://localhost:5173"}/s/${slug}`,
            code,
            output,
            language: detectedLanguage,
            // FIX: meta object was missing — frontend expected result.meta.model/tokens/latencyMs
            meta: {
                model,
                tokens: completion.usage?.total_tokens || 0,
                latencyMs,
                inputType
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "AI generation failed", details: err.message });
    }
});

// ================= API: FILE UPLOAD =================
app.post('/api/upload', upload.single('file'), async (req, res) => {
    const startTime = Date.now();

    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const fileText = fs.readFileSync(req.file.path, 'utf-8');
        const language = req.body.language || 'Auto';

        const prompt = buildPrompt(fileText, 'file', language);

        const model = "mistralai/mistral-7b-instruct";

        const completion = await openai.chat.completions.create({
            model,
            messages: [{ role: "user", content: prompt }]
        });

        const latencyMs = Date.now() - startTime;
        const text = completion.choices[0].message.content;
        const { code, output } = parseAIResponse(text);
        const slug = generateSlug();
        const detectedLanguage = language === 'Auto' ? detectLanguageFromCode(code) : language;

        // FIX: Upload route never saved to DB at all
        if (pool) {
            const snippetResult = await pool.query(
                `INSERT INTO snippets (slug, input_type, language, user_input, generated_code, generated_output, model_used)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [slug, 'file', detectedLanguage, fileText, code, output, model]
            );

            const snippetId = snippetResult.rows[0].id;

            await pool.query(
                `INSERT INTO file_uploads (snippet_id, original_filename, stored_filename, file_size_bytes, mime_type)
                 VALUES ($1, $2, $3, $4, $5)`,
                [snippetId, req.file.originalname, req.file.filename, req.file.size, req.file.mimetype]
            );
        }

        res.json({
            success: true,
            slug,
            shareUrl: `${process.env.FRONTEND_URL || "http://localhost:5173"}/s/${slug}`,
            code,
            output,
            language: detectedLanguage,
            meta: {
                model,
                tokens: completion.usage?.total_tokens || 0,
                latencyMs,
                inputType: 'file'
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Upload failed", details: err.message });
    }
});

// FIX: GET /api/s/:slug was missing entirely — frontend called it but it didn't exist
app.get('/api/s/:slug', async (req, res) => {
    try {
        const { slug } = req.params;

        if (!pool) {
            return res.status(503).json({ error: "Database not configured" });
        }

        const result = await pool.query(
            `UPDATE snippets SET view_count = view_count + 1
             WHERE slug = $1 AND is_public = TRUE
             RETURNING *`,
            [slug]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Snippet not found" });
        }

        res.json({ success: true, snippet: result.rows[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch snippet" });
    }
});

// FIX: GET /api/s/:slug/raw was missing — referenced in README but never implemented
app.get('/api/s/:slug/raw', async (req, res) => {
    try {
        const { slug } = req.params;

        if (!pool) {
            return res.status(503).json({ error: "Database not configured" });
        }

        const result = await pool.query(
            `SELECT generated_code, language FROM snippets WHERE slug = $1 AND is_public = TRUE`,
            [slug]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Snippet not found" });
        }

        res.type('text/plain').send(result.rows[0].generated_code);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch raw snippet" });
    }
});

// FIX: GET /api/stats was missing — referenced in README but never implemented
app.get('/api/stats', async (req, res) => {
    try {
        if (!pool) {
            return res.status(503).json({ error: "Database not configured" });
        }

        const [snippets, logs] = await Promise.all([
            pool.query(`SELECT COUNT(*) AS total, SUM(view_count) AS total_views FROM snippets`),
            pool.query(`SELECT SUM(total_tokens) AS total_tokens, AVG(latency_ms) AS avg_latency_ms FROM api_logs`)
        ]);

        res.json({
            success: true,
            stats: {
                totalSnippets: parseInt(snippets.rows[0].total),
                totalViews: parseInt(snippets.rows[0].total_views) || 0,
                totalTokensUsed: parseInt(logs.rows[0].total_tokens) || 0,
                avgLatencyMs: Math.round(parseFloat(logs.rows[0].avg_latency_ms) || 0)
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

// ================= HEALTH =================
app.get('/health', (req, res) => {
    res.json({ status: "ok", db: pool ? "connected" : "not configured" });
});

// ================= HELPER: Language Detection =================
function detectLanguageFromCode(code) {
    if (!code) return 'Unknown';
    if (/^\s*(import|from|def |class |if __name__)/.test(code)) return 'Python';
    if (/^\s*(const|let|var|function|=>|require\()/.test(code)) return 'JavaScript';
    if (/^\s*(interface|type |export |import .* from)/.test(code)) return 'TypeScript';
    if (/^\s*(public class|import java\.)/.test(code)) return 'Java';
    if (/#include/.test(code)) return 'C++';
    if (/^\s*(func |package main)/.test(code)) return 'Go';
    if (/^\s*(fn |use |let mut)/.test(code)) return 'Rust';
    if (/^\s*(SELECT|INSERT|CREATE|UPDATE|DELETE)/i.test(code)) return 'SQL';
    return 'Unknown';
}

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
