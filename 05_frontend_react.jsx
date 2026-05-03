// ============================================
// FRONTEND INTEGRATION (React Hook)
// File: useCodeGenerator.js
// ============================================

import { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function useCodeGenerator() {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    // Generate from text input
    const generate = async (userInput, language = 'Auto', mode = 'standard') => {
        setLoading(true);
        setError(null);

        try {
            const res = await fetch(`${API_URL}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userInput, language, mode })
            });

            const data = await res.json();
            if (!data.success) throw new Error(data.error);

            setResult(data);
            return data;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Upload file
    const uploadFile = async (file) => {
        setLoading(true);
        setError(null);

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(`${API_URL}/api/upload`, {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (!data.success) throw new Error(data.error);

            setResult(data);
            return data;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // FIX: fetchSnippet called /api/s/:slug which didn't exist on the server — now it does
    const fetchSnippet = async (slug) => {
        const res = await fetch(`${API_URL}/api/s/${slug}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        return data.snippet;
    };

    return { generate, uploadFile, fetchSnippet, loading, result, error };
}

// ============================================
// COMPONENT USAGE
// ============================================

function CodeGenerator() {
    const { generate, uploadFile, loading, result, error } = useCodeGenerator();
    const [input, setInput] = useState('');
    const [language, setLanguage] = useState('Auto');
    const [mode, setMode] = useState('standard'); // 'standard' | 'fast'

    const handleSubmit = async (e) => {
        e.preventDefault();
        await generate(input, language, mode);
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (file) await uploadFile(file);
    };

    const copyShareLink = () => {
        if (result?.shareUrl) {
            navigator.clipboard.writeText(result.shareUrl);
            // Show toast...
        }
    };

    return (
        <div className="code-generator">
            {/* Mode Toggle */}
            <div className="mode-toggle">
                <button onClick={() => setMode('standard')} className={mode === 'standard' ? 'active' : ''}>
                    ⚡ Standard
                </button>
                <button onClick={() => setMode('fast')} className={mode === 'fast' ? 'active' : ''}>
                    🚀 Fast
                </button>
            </div>

            {/* Language Selector */}
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="Auto">🔍 Auto Detect</option>
                <option value="Python">Python</option>
                <option value="JavaScript">JavaScript</option>
                <option value="TypeScript">TypeScript</option>
                <option value="Java">Java</option>
                <option value="C++">C++</option>
                <option value="Go">Go</option>
                <option value="Rust">Rust</option>
                <option value="SQL">SQL</option>
            </select>

            {/* Text Input */}
            <form onSubmit={handleSubmit}>
                <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask a question or paste code..."
                    rows={6}
                />
                <button type="submit" disabled={loading}>
                    {loading ? 'Generating...' : 'Generate'}
                </button>
            </form>

            {/* File Upload */}
            <div className="file-upload">
                <label>
                    📎 Upload File
                    <input type="file" onChange={handleFileUpload} accept=".py,.js,.ts,.java,.cpp,.c,.go,.rs,.sql,.txt" hidden />
                </label>
            </div>

            {/* Results */}
            {result && (
                <div className="results">
                    <div className="code-block">
                        <div className="header">
                            {/* FIX: result.language was used but server never returned it */}
                            <span>{result.language || 'Unknown'}</span>
                            <button onClick={copyShareLink}>🔗 Copy Share Link</button>
                        </div>
                        <pre><code>{result.code}</code></pre>
                    </div>

                    {result.output && (
                        <div className="output-block">
                            <div className="header">Output</div>
                            <pre>{result.output}</pre>
                        </div>
                    )}

                    {/* FIX: result.meta was used but server never returned the meta object */}
                    {result.meta && (
                        <div className="meta">
                            <span>Model: {result.meta.model}</span>
                            <span>Tokens: {result.meta.tokens}</span>
                            <span>Latency: {result.meta.latencyMs}ms</span>
                        </div>
                    )}
                </div>
            )}

            {error && <div className="error">{error}</div>}
        </div>
    );
}
