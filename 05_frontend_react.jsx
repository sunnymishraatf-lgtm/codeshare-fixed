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

            if (!res.ok || !data.success) {
                throw new Error(data.error || `Server error ${res.status}`);
            }

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
    const uploadFile = async (file, language = 'Auto') => {
        setLoading(true);
        setError(null);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('language', language);

        try {
            const res = await fetch(`${API_URL}/api/upload`, {
                method: 'POST',
                body: formData
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || `Server error ${res.status}`);
            }

            setResult(data);
            return data;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Fetch shared snippet by slug
    const fetchSnippet = async (slug) => {
        try {
            const res = await fetch(`${API_URL}/api/s/${slug}`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Not found');
            return data.snippet;
        } catch (err) {
            setError(err.message);
            throw err;
        }
    };

    // Fetch platform stats
    const fetchStats = async () => {
        const res = await fetch(`${API_URL}/api/stats`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        return data.stats;
    };

    return { generate, uploadFile, fetchSnippet, fetchStats, loading, result, error };
}

// ============================================
// COMPONENT USAGE EXAMPLE
// ============================================

function CodeGenerator() {
    const { generate, uploadFile, loading, result, error } = useCodeGenerator();
    const [input, setInput] = useState('');
    const [language, setLanguage] = useState('Auto');
    const [mode, setMode] = useState('standard'); // 'standard' | 'fast'
    const [copied, setCopied] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim()) return;
        await generate(input, language, mode);
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (file) await uploadFile(file, language);
    };

    const copyShareLink = () => {
        if (result?.shareUrl) {
            navigator.clipboard.writeText(result.shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const copyCode = () => {
        if (result?.code) {
            navigator.clipboard.writeText(result.code);
        }
    };

    return (
        <div className="code-generator">
            {/* Mode Toggle */}
            <div className="mode-toggle">
                <button
                    onClick={() => setMode('standard')}
                    className={mode === 'standard' ? 'active' : ''}
                >
                    ⚡ Standard
                </button>
                <button
                    onClick={() => setMode('fast')}
                    className={mode === 'fast' ? 'active' : ''}
                >
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
                <button type="submit" disabled={loading || !input.trim()}>
                    {loading ? 'Generating...' : 'Generate'}
                </button>
            </form>

            {/* File Upload */}
            <div className="file-upload">
                <label>
                    📎 Upload File
                    <input
                        type="file"
                        onChange={handleFileUpload}
                        accept=".py,.js,.ts,.java,.cpp,.c,.go,.rs,.sql,.txt,.jsx,.tsx"
                        hidden
                    />
                </label>
            </div>

            {/* Error */}
            {error && <div className="error">❌ {error}</div>}

            {/* Results */}
            {result && (
                <div className="results">
                    <div className="code-block">
                        <div className="header">
                            <span>{result.language || 'Code'}</span>
                            <div className="actions">
                                <button onClick={copyCode}>📋 Copy Code</button>
                                <button onClick={copyShareLink}>
                                    🔗 {copied ? 'Copied!' : 'Share Link'}
                                </button>
                            </div>
                        </div>
                        <pre><code>{result.code}</code></pre>
                    </div>

                    {result.output && (
                        <div className="output-block">
                            <div className="header">Output</div>
                            <pre>{result.output}</pre>
                        </div>
                    )}

                    {/* Meta info — safely accessed with optional chaining */}
                    {result.meta && (
                        <div className="meta">
                            <span>Model: {result.meta.model}</span>
                            <span>Tokens: {result.meta.tokens}</span>
                            <span>Latency: {result.meta.latencyMs}ms</span>
                            <span>Type: {result.meta.inputType}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default CodeGenerator;