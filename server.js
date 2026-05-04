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

    pool.on('error', (err) => {
        console.error('Unexpected DB error:', err.message);
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

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['.py', '.js', '.ts', '.java', '.cpp', '.c', '.go', '.rs', '.sql', '.txt', '.jsx', '.tsx'];
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, allowed.includes(ext));
    }
});

// ================= MODEL CONFIG =================
// Using openrouter/free — auto-selects from available free models, never 404s
const MODELS = {
    fast: "openrouter/free",
    standard: "openrouter/free"
};

// ================= UTIL =================
function generateSlug() {
    return crypto.randomBytes(8).toString('base64url').slice(0, 12);
}

// REPLACE your current parseAIResponse with this:
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
        // Everything after the code block is the output
        const afterBlock = text.split(/```[\s\S]*?```/).pop()?.trim() || "";
        return { code, output: afterBlock };
    }

    // Last resort: treat entire response as code
    return { code: text.trim(), output: "" };
}

function classifyInput(userInput) {
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

// ================= PROMPT TEMPLATES =================
let PROMPT_TEMPLATES = {};
try {
    PROMPT_TEMPLATES = JSON.parse(
        fs.readFileSync(path.join(__dirname, '08_prompt_templates.json'), 'utf-8')
    );
} catch (e) {
    console.warn('Could not load 08_prompt_templates.json, using fallback prompts.');
    PROMPT_TEMPLATES = {
        question: "You are an expert programmer.\n\nLanguage: {language}\nQuestion: {user_input}\n\nRespond ONLY in this exact format:\n[CODE]\n<code here>\n\n[OUTPUT]\n<output here>",
        code: "You are a code cleaner. Fix and clean this code.\n\nLanguage: {language}\nCode:\n{user_input}\n\nRespond ONLY in this exact format:\n[CODE]\n<clean code>\n\n[OUTPUT]\n<expected output>",
        file: "You are a code extraction assistant. Extract and fix the code from this file.\n\nLanguage: {language}\nFile Content:\n{user_input}\n\nRespond ONLY in this exact format:\n[CODE]\n<extracted code>\n\n[OUTPUT]\n<expected output>"
    };
}

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
        const { userInput, language = 'Auto', mode = 'standard' } = req.body;

        if (!userInput || !userInput.trim()) {
            return res.status(400).json({ error: "Input required" });
        }

        const inputType = classifyInput(userInput);
        const model = mode === 'fast' ? MODELS.fast : MODELS.standard;
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
        const detectedLanguage = language === 'Auto' ? detectLanguageFromCode(code) : language;
        const modelUsed = completion.model || model;

        if (pool) {
            try {
                await pool.query(
                    `INSERT INTO snippets (slug, input_type, language, user_input, generated_code, generated_output, model_used)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [slug, inputType, detectedLanguage, userInput, code, output || '', modelUsed]
                );

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
            } catch (dbErr) {
                console.error('DB insert error:', dbErr.message);
                // Don't fail the request over a DB error
            }
        }

        res.json({
            success: true,
            slug,
            shareUrl: `${process.env.FRONTEND_URL || "http://localhost:5173"}/s/${slug}`,
            code,
            output,
            language: detectedLanguage,
            meta: {
                model: modelUsed,
                tokens: completion.usage?.total_tokens || 0,
                latencyMs,
                inputType
            }
        });

    } catch (err) {
        console.error('Generate error:', err.message);
        res.status(500).json({ error: "AI generation failed", details: err.message });
    }
});

// ================= API: FILE UPLOAD =================
app.post('/api/upload', upload.single('file'), async (req, res) => {
    const startTime = Date.now();

    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded or file type not allowed" });
        }

        const fileText = fs.readFileSync(req.file.path, 'utf-8');
        const language = req.body.language || 'Auto';
        const model = MODELS.standard;
        const prompt = buildPrompt(fileText, 'file', language);

        const completion = await openai.chat.completions.create({
            model,
            messages: [{ role: "user", content: prompt }]
        });

        const latencyMs = Date.now() - startTime;
        const text = completion.choices[0].message.content;
        const { code, output } = parseAIResponse(text);
        const slug = generateSlug();
        const detectedLanguage = language === 'Auto' ? detectLanguageFromCode(code) : language;
        const modelUsed = completion.model || model;

        if (pool) {
            try {
                const snippetResult = await pool.query(
                    `INSERT INTO snippets (slug, input_type, language, user_input, generated_code, generated_output, model_used)
                     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                    [slug, 'file', detectedLanguage, fileText, code, output || '', modelUsed]
                );

                const snippetId = snippetResult.rows[0].id;

                await pool.query(
                    `INSERT INTO file_uploads (snippet_id, original_filename, stored_filename, file_size_bytes, mime_type)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [snippetId, req.file.originalname, req.file.filename, req.file.size, req.file.mimetype]
                );

                await pool.query(
                    `INSERT INTO api_logs (request_type, prompt_tokens, completion_tokens, total_tokens, latency_ms)
                     VALUES ($1, $2, $3, $4, $5)`,
                    ['upload', completion.usage?.prompt_tokens || 0, completion.usage?.completion_tokens || 0, completion.usage?.total_tokens || 0, latencyMs]
                );
            } catch (dbErr) {
                console.error('DB insert error:', dbErr.message);
            }
        }

        // Clean up temp file
        try { fs.unlinkSync(req.file.path); } catch (_) {}

        res.json({
            success: true,
            slug,
            shareUrl: `${process.env.FRONTEND_URL || "http://localhost:5173"}/s/${slug}`,
            code,
            output,
            language: detectedLanguage,
            meta: {
                model: modelUsed,
                tokens: completion.usage?.total_tokens || 0,
                latencyMs,
                inputType: 'file'
            }
        });

    } catch (err) {
        console.error('Upload error:', err.message);
        res.status(500).json({ error: "Upload failed", details: err.message });
    }
});

// ================= API: GET SNIPPET =================
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
        console.error('Fetch snippet error:', err.message);
        res.status(500).json({ error: "Failed to fetch snippet" });
    }
});

// ================= API: GET RAW CODE =================
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
        console.error('Fetch raw error:', err.message);
        res.status(500).json({ error: "Failed to fetch raw snippet" });
    }
});

// ================= API: STATS =================
app.get('/api/stats', async (req, res) => {
    try {
        if (!pool) {
            return res.status(503).json({ error: "Database not configured" });
        }

        const [snippets, logs] = await Promise.all([
            pool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(view_count), 0) AS total_views FROM snippets`),
            pool.query(`SELECT COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(AVG(latency_ms), 0) AS avg_latency_ms FROM api_logs`)
        ]);

        res.json({
            success: true,
            stats: {
                totalSnippets: parseInt(snippets.rows[0].total),
                totalViews: parseInt(snippets.rows[0].total_views),
                totalTokensUsed: parseInt(logs.rows[0].total_tokens),
                avgLatencyMs: Math.round(parseFloat(logs.rows[0].avg_latency_ms))
            }
        });

    } catch (err) {
        console.error('Stats error:', err.message);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

// ================= HEALTH =================
async function healthHandler(req, res) {
    let dbStatus = 'not configured';
    if (pool) {
        try {
            await pool.query('SELECT 1');
            dbStatus = 'connected';
        } catch {
            dbStatus = 'error';
        }
    }
    res.json({ status: "ok", db: dbStatus, model: MODELS.standard });
}

// Both paths so the frontend's testConnection() (/api/health) and
// direct curl checks (/health) both work.
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`DB: ${process.env.DATABASE_URL ? 'configured' : 'not configured'}`);
    console.log(`Model: ${MODELS.standard}`);
});