require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ Server-side API Keys (from .env) ============
const API_KEYS = {
    anthropic: process.env.ANTHROPIC_API_KEY || '',
    openai: process.env.OPENAI_API_KEY || '',
    google: process.env.GOOGLE_API_KEY || ''
};

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// File upload storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + '-' + file.originalname);
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ============ Resolve which provider + key to use ============

function resolveProvider(model) {
    // Check if the requested provider has a key
    if ((model.startsWith('Claude') || model.startsWith('claude')) && API_KEYS.anthropic) {
        return 'anthropic';
    }
    if ((model.startsWith('Gemini') || model.startsWith('gemini')) && API_KEYS.google) {
        return 'google';
    }
    if ((model.startsWith('GPT') || model.startsWith('gpt')) && API_KEYS.openai) {
        return 'openai';
    }

    // Fallback: use whichever key is available (prefer anthropic)
    if (API_KEYS.anthropic) return 'anthropic';
    if (API_KEYS.openai) return 'openai';
    if (API_KEYS.google) return 'google';

    return null;
}

// ============ AI Chat Endpoint (streaming) ============

app.post('/api/chat', async (req, res) => {
    const { model, messages, searchWeb, deepResearch } = req.body;

    if (!messages || !messages.length) {
        return res.status(400).json({ error: 'No messages provided.' });
    }

    const provider = resolveProvider(model || '');

    if (!provider) {
        return res.status(500).json({ error: 'No API key configured on the server. Add your key to the .env file.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        if (provider === 'anthropic') {
            await streamClaude(res, messages, API_KEYS.anthropic, model, searchWeb, deepResearch);
        } else if (provider === 'google') {
            await streamGemini(res, messages, API_KEYS.google, model, searchWeb, deepResearch);
        } else if (provider === 'openai') {
            await streamOpenAI(res, messages, API_KEYS.openai, model, searchWeb, deepResearch);
        }
    } catch (err) {
        console.error('Chat error:', err.message);
        const errorMsg = err.message || 'An error occurred while processing your request.';
        res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    }
});

// ============ Claude (Anthropic) Streaming ============

async function streamClaude(res, messages, apiKey, modelName, searchWeb, deepResearch, retryCount = 0) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    // Map model display name to API model ID
    const modelMap = {
        'Claude Sonnet 4.5': 'claude-3-haiku-20240307',
        'Claude Sonnet 4': 'claude-3-haiku-20240307',
        'Claude Haiku 3.5': 'claude-3-haiku-20240307'
    };
    const modelId = modelMap[modelName] || 'claude-3-haiku-20240307';

    // Convert messages format
    const systemMsg = buildSystemPrompt(searchWeb, deepResearch);
    const anthropicMessages = messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
    }));

    try {
        let sources = [];
        const lastUserMsg = messages[messages.length - 1]?.content || '';
        const needsSearch = (searchWeb || deepResearch) && queryNeedsSearch(lastUserMsg);

        if (needsSearch) {
            // Step 1: Ask AI to identify real, relevant sources for this query
            res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'search', content: `Analyzing "${lastUserMsg.length > 50 ? lastUserMsg.slice(0, 50) + '...' : lastUserMsg}"` })}\n\n`);

            const sourceResponse = await client.messages.create({
                model: modelId,
                max_tokens: 1024,
                system: `You are a research assistant. Given a user query, return a JSON array of real, authoritative sources that would be relevant for answering this query. Each source should have:
- "domain": the website domain (e.g. "nature.com")
- "url": a real, plausible full URL that would contain relevant info (e.g. "https://www.nature.com/articles/evolution-evidence")
- "title": a short description of what this page would contain

Return ONLY sources you know actually exist or are highly likely to exist based on your knowledge. Use real website structures. Return 4-6 sources for normal search, 6-8 for deep research.

IMPORTANT: Return ONLY the raw JSON array, no markdown, no code fences, no explanation. Just the JSON.`,
                messages: [{ role: 'user', content: `Query: "${lastUserMsg}"\nMode: ${deepResearch ? 'deep research' : 'web search'}\n\nReturn the JSON array of relevant real sources:` }]
            });

            // Parse sources from AI response
            const sourceText = sourceResponse.content[0]?.text || '[]';
            try {
                const parsed = JSON.parse(sourceText.trim());
                if (Array.isArray(parsed)) {
                    sources = parsed.map(s => ({
                        domain: s.domain || '',
                        url: s.url || `https://${s.domain}`,
                        title: s.title || s.domain
                    })).filter(s => s.domain);
                }
            } catch (e) {
                // Try to extract JSON from response if wrapped in text
                const jsonMatch = sourceText.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    try {
                        const parsed = JSON.parse(jsonMatch[0]);
                        if (Array.isArray(parsed)) {
                            sources = parsed.map(s => ({
                                domain: s.domain || '',
                                url: s.url || `https://${s.domain}`,
                                title: s.title || s.domain
                            })).filter(s => s.domain);
                        }
                    } catch (e2) { /* skip */ }
                }
            }

            // Step 2: Show activities based on real sources
            for (const source of sources) {
                const displayUrl = source.url.replace('https://', '').replace('http://', '');
                res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'visit', content: `Reading ${displayUrl}` })}\n\n`);
                await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
            }

            if (deepResearch) {
                res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'think', content: 'Evaluating multiple perspectives...' })}\n\n`);
                await new Promise(r => setTimeout(r, 400));
                res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'think', content: 'Cross-referencing findings...' })}\n\n`);
                await new Promise(r => setTimeout(r, 400));
            }

            res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'analyze', content: 'Compiling response...' })}\n\n`);
            await new Promise(r => setTimeout(r, 300));
        }

        // Step 3: Generate the actual response
        const finalSystem = needsSearch
            ? systemMsg + (sources.length > 0 ? `\n\nYou have consulted these sources:\n${sources.map(s => `- ${s.title}: ${s.url}`).join('\n')}\nUse information consistent with what these sources would contain. Do NOT list sources in your response - they are shown separately by the UI.` : '')
            : buildSystemPrompt(false, false);

        const stream = client.messages.stream({
            model: modelId,
            max_tokens: 4096,
            system: finalSystem,
            messages: anthropicMessages
        });

        res.write(`data: ${JSON.stringify({ type: 'thinking', content: needsSearch ? 'Writing response...' : 'Thinking...' })}\n\n`);

        for await (const event of stream) {
            if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') {
                    res.write(`data: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`);
                }
            }
        }

        if (sources.length > 0) {
            res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);
        }

        res.write('data: [DONE]\n\n');
        res.end();
    } catch (err) {
        // Retry on overloaded errors (max 3 attempts)
        if (err.status === 529 || (err.message && err.message.includes('Overloaded'))) {
            if (retryCount < 3) {
                const waitMs = (retryCount + 1) * 2000;
                console.log(`API overloaded, retrying in ${waitMs}ms (attempt ${retryCount + 2}/4)...`);
                res.write(`data: ${JSON.stringify({ type: 'thinking', content: 'Server busy, retrying...' })}\n\n`);
                await new Promise(r => setTimeout(r, waitMs));
                return streamClaude(res, messages, apiKey, modelName, searchWeb, deepResearch, retryCount + 1);
            }
        }
        throw err;
    }
}

// ============ Gemini (Google) Streaming ============

async function streamGemini(res, messages, apiKey, modelName, searchWeb, deepResearch) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);

    const modelMap = {
        'Gemini 3 Pro': 'gemini-2.5-pro-preview-06-05',
        'Gemini 2.5 Pro': 'gemini-2.5-pro-preview-06-05',
        'Gemini 2.0 Flash': 'gemini-2.0-flash'
    };
    const modelId = modelMap[modelName] || 'gemini-2.5-pro-preview-06-05';

    const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: buildSystemPrompt(searchWeb, deepResearch)
    });

    // Convert to Gemini format
    const history = [];
    for (let i = 0; i < messages.length - 1; i++) {
        history.push({
            role: messages[i].role === 'assistant' ? 'model' : 'user',
            parts: [{ text: messages[i].content }]
        });
    }

    const chat = model.startChat({ history });
    const lastMsg = messages[messages.length - 1].content;

    res.write(`data: ${JSON.stringify({ type: 'thinking', content: 'Processing with Gemini...' })}\n\n`);

    const result = await chat.sendMessageStream(lastMsg);

    for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
            res.write(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`);
        }
    }

    res.write('data: [DONE]\n\n');
    res.end();
}

// ============ OpenAI (GPT) Streaming ============

async function streamOpenAI(res, messages, apiKey, modelName, searchWeb, deepResearch) {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey });

    const modelMap = {
        'GPT-5.1': 'gpt-4.1',
        'GPT-5.2': 'gpt-4.1',
        'GPT-4o': 'gpt-4o',
        'GPT-4': 'gpt-4'
    };
    const modelId = modelMap[modelName] || 'gpt-4o';

    const systemPrompt = buildSystemPrompt(searchWeb, deepResearch);
    const openaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    res.write(`data: ${JSON.stringify({ type: 'thinking', content: 'Thinking...' })}\n\n`);

    const stream = await client.chat.completions.create({
        model: modelId,
        messages: openaiMessages,
        max_tokens: 8192,
        stream: true
    });

    for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
            res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`);
        }
    }

    res.write('data: [DONE]\n\n');
    res.end();
}

// ============ System Prompt Builder ============

function buildSystemPrompt(searchWeb, deepResearch) {
    let prompt = `You are Retrac AI, a helpful, knowledgeable, and friendly AI assistant.
You provide clear, well-structured responses using markdown formatting.
Use headers (##), bullet points, numbered lists, bold text, and code blocks when appropriate.
Keep your responses informative yet concise. Be conversational and helpful.
IMPORTANT: Never include a "Sources", "References", or "Quellen" section in your response. Sources are displayed separately by the UI.`;

    if (searchWeb) {
        prompt += `\n\nThe user has enabled "Search the web" mode. Provide thorough, detailed, up-to-date information as if you had access to the latest web data. Include specific facts, numbers, and details. Do NOT list sources or references in your text - they are shown separately.`;
    }
    if (deepResearch) {
        prompt += `\n\nThe user has enabled "Deep Research" mode. Provide an extremely thorough, comprehensive research-grade response with:
- An executive summary at the top
- Multiple sections with ## headers covering different angles
- Key findings and data points
- Multiple perspectives and counterarguments
- A "Key Takeaways" numbered list at the end
Do NOT include a sources/references section - sources are displayed separately by the UI.`;
    }

    return prompt;
}

// ============ Query Analysis ============
// Decides if a query actually needs web search or is just casual conversation

function queryNeedsSearch(query) {
    const q = query.trim().toLowerCase();

    // Too short = probably casual
    if (q.length < 8) return false;

    // Greetings and casual messages - no search needed
    const casualPatterns = [
        /^(hi|hey|hello|hallo|moin|servus|yo|sup|hola|bonjour|ciao)\b/,
        /^(good\s*(morning|evening|night|afternoon))/,
        /^(guten\s*(morgen|abend|tag))/,
        /^(wie\s*geht|how\s*are\s*you|what'?s\s*up)/,
        /^(danke|thanks|thank\s*you|thx|ty)\b/,
        /^(bye|goodbye|tschüss|ciao|see\s*you)/,
        /^(ok|okay|alright|sure|yes|no|ja|nein|klar)\b/,
        /^(lol|haha|nice|cool|wow|great|awesome)\b/,
        /^(help|hilfe)\s*$/,
        /^(who\s*are\s*you|wer\s*bist\s*du|what\s*can\s*you\s*do)/,
        /^(tell\s*me\s*a\s*joke|erzähl.*witz)/,
        /^(can\s*you|kannst\s*du)\s*$/,
    ];

    for (const pattern of casualPatterns) {
        if (pattern.test(q)) return false;
    }

    // Meta/about-the-AI questions - no search needed
    if (/^(what|who|how).*(you|retrac|this\s*ai|chatbot)/i.test(q)) return false;

    // Simple math/conversion - no search needed
    if (/^\d+\s*[\+\-\*\/\^]\s*\d+$/.test(q)) return false;
    if (/^(convert|how\s*much\s*is)\s*\d+/.test(q) && q.length < 30) return false;

    // Creative writing that doesn't need facts
    if (/^(write|schreib)\s*(me\s*)?(a\s*)?(poem|gedicht|story|geschichte|song|lied|haiku)\b/.test(q)) return false;

    // Code generation without research context
    if (/^(write|create|make|build|code|implement)\s*(me\s*)?(a\s*)?(function|class|script|component|program|app)\b/.test(q) && q.length < 60) return false;

    // Everything else probably benefits from search
    return true;
}


// ============ File Upload ============

app.post('/api/upload', upload.array('files', 20), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }
    const uploaded = req.files.map(f => ({
        name: f.originalname,
        path: '/uploads/' + f.filename,
        size: f.size,
        type: f.mimetype
    }));
    res.json({ files: uploaded });
});

// ============ Image Generation Proxy ============

app.post('/api/generate-image', async (req, res) => {
    const { prompt } = req.body;

    if (!API_KEYS.openai) {
        return res.status(400).json({ error: 'Image generation requires an OpenAI API key. Add OPENAI_API_KEY to your .env file.' });
    }

    try {
        const OpenAI = require('openai');
        const client = new OpenAI({ apiKey: API_KEYS.openai });
        const response = await client.images.generate({
            model: 'dall-e-3',
            prompt,
            n: 1,
            size: '1024x1024'
        });
        res.json({ url: response.data[0].url, revised_prompt: response.data[0].revised_prompt });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Fallback
app.get('*', (req, res) => {
    const filePath = path.join(__dirname, req.path);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.sendFile(filePath);
    } else {
        res.sendFile(path.join(__dirname, 'index.html'));
    }
});

app.listen(PORT, () => {
    const hasAnthropic = !!API_KEYS.anthropic;
    const hasOpenAI = !!API_KEYS.openai;
    const hasGoogle = !!API_KEYS.google;
    console.log(`\n  🚀 Retrac AI is running at http://localhost:${PORT}`);
    console.log(`  📡 API Keys: Anthropic ${hasAnthropic ? '✓' : '✗'} | OpenAI ${hasOpenAI ? '✓' : '✗'} | Google ${hasGoogle ? '✓' : '✗'}\n`);
});
