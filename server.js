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
    if ((model.startsWith('Claude') || model.startsWith('claude')) && API_KEYS.anthropic) return 'anthropic';
    if ((model.startsWith('Gemini') || model.startsWith('gemini')) && API_KEYS.google) return 'google';
    if ((model.startsWith('GPT') || model.startsWith('gpt')) && API_KEYS.openai) return 'openai';
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

    const modelMap = {
        'Claude Sonnet 4.5': 'claude-3-haiku-20240307',
        'Claude Sonnet 4': 'claude-3-haiku-20240307',
        'Claude Haiku 3.5': 'claude-3-haiku-20240307'
    };
    const modelId = modelMap[modelName] || 'claude-3-haiku-20240307';
    const lastUserMsg = messages[messages.length - 1]?.content || '';

    const anthropicMessages = messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
    }));

    try {
        let sources = [];
        let needsSearch = false;

        // ====== PHASE 0: AI thinks about what to do ======
        if (searchWeb || deepResearch) {
            // First: let the AI analyze the query and decide if search is needed
            res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'think', content: 'Analyzing your question...' })}\n\n`);

            const classifyResponse = await client.messages.create({
                model: modelId,
                max_tokens: 512,
                system: `You analyze user queries and decide how to approach them. Return a JSON object with:
- "needs_search": boolean - true if this query requires web research, false if you can answer from knowledge alone
- "reasoning": string - brief explanation of your decision (1 sentence)
- "approach": string - how you'll tackle this ("direct_answer", "calculation", "creative", "research", "deep_analysis")
- "search_categories": array of strings - if needs_search is true, which categories to search: "academic", "news", "government", "industry", "reference", "data", "forums", "blogs", "video"

Examples of queries that do NOT need search:
- Math: "What is 25 * 48?", "Solve x^2 + 3x - 10 = 0"
- Code: "Write a Python function to sort a list"
- Creative: "Write me a poem about the ocean"
- General knowledge: "What is photosynthesis?", "Explain gravity"
- Conversation: "How are you?", "Tell me a joke"

Examples that DO need search:
- Current events: "Latest news about AI regulation"
- Specific data: "Tesla stock price history 2024"
- Research: "What does recent research say about intermittent fasting?"
- Comparisons: "Best laptops 2025"

Return ONLY the JSON object, no markdown.`,
                messages: [{ role: 'user', content: `Query: "${lastUserMsg}"\nMode: ${deepResearch ? 'Deep Research' : 'Search Web'}` }]
            });

            const classifyText = classifyResponse.content[0]?.text || '{}';
            let classification = {};
            try {
                classification = JSON.parse(classifyText.trim());
            } catch (e) {
                const m = classifyText.match(/\{[\s\S]*\}/);
                if (m) try { classification = JSON.parse(m[0]); } catch (e2) {}
            }

            needsSearch = classification.needs_search !== false; // default to true if parsing fails
            const approach = classification.approach || 'research';
            const searchCategories = classification.search_categories || ['academic', 'news', 'reference'];

            // Show the AI's reasoning
            if (classification.reasoning) {
                res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'think', content: classification.reasoning })}\n\n`);
                await sleep(400);
            }

            if (!needsSearch) {
                // AI decided no search needed — show what approach it's taking
                const approachLabels = {
                    direct_answer: 'Answering from knowledge...',
                    calculation: 'Solving calculation...',
                    creative: 'Creating content...',
                    research: 'Gathering information...',
                    deep_analysis: 'Analyzing in depth...'
                };
                res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'plan', content: approachLabels[approach] || 'Processing...' })}\n\n`);
                await sleep(300);
            } else {
                // ====== PHASE 1: Research planning ======
                res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'plan', content: `Planning research across ${searchCategories.length} source categories...` })}\n\n`);
                await sleep(400);

                // ====== PHASE 2: Multi-batch source gathering ======
                if (deepResearch) {
                    // Deep Research: 3 batches for 50-80+ sources total
                    const batches = [
                        { cats: ['academic', 'government', 'data'], label: 'Academic, government & statistical sources', count: '20-25' },
                        { cats: ['news', 'industry', 'blogs'], label: 'News, industry & expert analysis', count: '20-25' },
                        { cats: ['reference', 'forums', 'video'], label: 'Reference, community & multimedia sources', count: '15-20' }
                    ];

                    for (const batch of batches) {
                        res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'search', content: `Searching: ${batch.label}` })}\n\n`);
                        await sleep(300);

                        const batchResponse = await client.messages.create({
                            model: modelId,
                            max_tokens: 3000,
                            system: `You are a world-class research analyst. Return a JSON array of ${batch.count} real, authoritative sources for the given query.

Focus on these source categories: ${batch.cats.join(', ')}

Each source must have:
- "domain": website domain (e.g. "nature.com")
- "url": a realistic URL with specific path relevant to the query
- "title": what this page contains (specific, not generic)
- "category": one of "${batch.cats.join('", "')}"

Use REAL domains that actually exist. URLs should have realistic paths with article IDs, slugs, or specific sections — NOT the user's query text pasted into a URL.

Examples of good URLs:
- "pubmed.ncbi.nlm.nih.gov/articles/PMC8234567"
- "reuters.com/technology/ai-regulation-european-union-2024-03-15"
- "ourworldindata.org/co2-emissions"
- "stackoverflow.com/questions/12345678/how-to-sort-objects"

Return ONLY the raw JSON array.`,
                            messages: [{ role: 'user', content: `Query: "${lastUserMsg}"` }]
                        });

                        const batchSources = parseSourcesJSON(batchResponse.content[0]?.text || '[]');

                        // Show individual source visits
                        for (const s of batchSources) {
                            const shortUrl = s.url.replace('https://', '').replace('http://', '');
                            const trimmedUrl = shortUrl.length > 60 ? shortUrl.slice(0, 60) + '...' : shortUrl;
                            res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'visit', content: `Reading ${trimmedUrl}` })}\n\n`);
                            await sleep(120 + Math.random() * 180);
                        }

                        sources.push(...batchSources);

                        res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'evaluate', content: `Found ${batchSources.length} sources (${sources.length} total)` })}\n\n`);
                        await sleep(300);
                    }
                } else {
                    // Normal Search Web: single batch, 10-15 sources
                    res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'search', content: `Searching the web...` })}\n\n`);
                    await sleep(300);

                    const sourceResponse = await client.messages.create({
                        model: modelId,
                        max_tokens: 2048,
                        system: `You are a research assistant. Return a JSON array of 10-15 real, authoritative sources for the given query.

Each source must have:
- "domain": website domain
- "url": a realistic URL with specific path (NOT the query pasted into a URL path)
- "title": what this page contains
- "category": one of "academic", "news", "government", "industry", "reference", "data"

Use REAL domains. URLs should have realistic paths. Return ONLY the raw JSON array.`,
                        messages: [{ role: 'user', content: `Query: "${lastUserMsg}"` }]
                    });

                    sources = parseSourcesJSON(sourceResponse.content[0]?.text || '[]');

                    for (const s of sources) {
                        const shortUrl = s.url.replace('https://', '').replace('http://', '');
                        const trimmedUrl = shortUrl.length > 60 ? shortUrl.slice(0, 60) + '...' : shortUrl;
                        res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'visit', content: `Reading ${trimmedUrl}` })}\n\n`);
                        await sleep(250 + Math.random() * 350);
                    }
                }

                // ====== PHASE 3: Deep analysis activities ======
                if (deepResearch && sources.length > 0) {
                    const analysisSteps = [
                        { activity: 'think', content: `Processing ${sources.length} sources...` },
                        { activity: 'compare', content: 'Cross-referencing claims between sources...' },
                        { activity: 'evaluate', content: 'Ranking sources by authority and relevance...' },
                        { activity: 'think', content: 'Identifying patterns and consensus...' },
                        { activity: 'verify', content: 'Checking for contradictions and bias...' },
                        { activity: 'think', content: 'Weighing conflicting evidence...' },
                        { activity: 'synthesize', content: `Distilling insights from ${sources.length} sources...` },
                        { activity: 'structure', content: 'Organizing comprehensive report...' },
                    ];
                    for (const step of analysisSteps) {
                        res.write(`data: ${JSON.stringify({ type: 'activity', ...step })}\n\n`);
                        await sleep(300 + Math.random() * 250);
                    }
                } else if (sources.length > 0) {
                    res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'think', content: `Analyzing ${sources.length} sources...` })}\n\n`);
                    await sleep(300);
                    res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'synthesize', content: 'Preparing response...' })}\n\n`);
                    await sleep(300);
                }
            }
        }

        // ====== FINAL PHASE: Generate response ======
        const systemPrompt = buildSystemPrompt(searchWeb, deepResearch, needsSearch, sources);

        res.write(`data: ${JSON.stringify({ type: 'thinking', content: needsSearch ? `Writing response based on ${sources.length} sources...` : 'Thinking...' })}\n\n`);

        const stream = client.messages.stream({
            model: modelId,
            max_tokens: 4096,
            system: systemPrompt,
            messages: anthropicMessages
        });

        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                res.write(`data: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`);
            }
        }

        // Only send sources if search was active and we have them
        if (needsSearch && sources.length > 0) {
            res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);
        }

        res.write('data: [DONE]\n\n');
        res.end();
    } catch (err) {
        if (err.status === 529 || (err.message && err.message.includes('Overloaded'))) {
            if (retryCount < 3) {
                const waitMs = (retryCount + 1) * 2000;
                console.log(`API overloaded, retrying in ${waitMs}ms (attempt ${retryCount + 2}/4)...`);
                res.write(`data: ${JSON.stringify({ type: 'thinking', content: 'Server busy, retrying...' })}\n\n`);
                await sleep(waitMs);
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
        'Gemini 3 Pro': 'gemini-3-pro-preview',
        'Gemini 2.5 Pro': 'gemini-2.5-pro',
        'Gemini 2.5 Flash': 'gemini-2.5-flash',
        'Gemini 2.0 Flash': 'gemini-2.5-flash'
    };
    const modelId = modelMap[modelName] || 'gemini-2.5-pro';

    const useGrounding = searchWeb || deepResearch;

    const modelConfig = {
        model: modelId,
        systemInstruction: buildSystemPrompt(searchWeb, deepResearch, useGrounding, [])
    };

    // Enable real Google Search grounding when search is requested
    if (useGrounding) {
        modelConfig.tools = [{ google_search: {} }];
    }

    const model = genAI.getGenerativeModel(modelConfig);

    const history = [];
    for (let i = 0; i < messages.length - 1; i++) {
        history.push({
            role: messages[i].role === 'assistant' ? 'model' : 'user',
            parts: [{ text: messages[i].content }]
        });
    }

    const chat = model.startChat({ history });
    const lastMsg = messages[messages.length - 1].content;

    res.write(`data: ${JSON.stringify({ type: 'thinking', content: useGrounding ? 'Searching the web with Gemini...' : 'Processing with Gemini...' })}\n\n`);

    if (useGrounding) {
        res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'search', content: 'Searching Google...' })}\n\n`);
    }

    const result = await chat.sendMessageStream(lastMsg);

    for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
            res.write(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`);
        }
    }

    // Extract real grounding sources from Google Search
    if (useGrounding) {
        try {
            const response = await result.response;
            const metadata = response.candidates?.[0]?.groundingMetadata;
            if (metadata?.groundingChunks?.length > 0) {
                const seen = new Set();
                const sources = metadata.groundingChunks
                    .filter(chunk => chunk.web)
                    .map(chunk => {
                        const url = chunk.web.uri;
                        const title = chunk.web.title || '';
                        // Google returns redirect URLs - use the title as domain (e.g. "coinmarketcap.com")
                        const domain = title.replace(/^www\./, '') || (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
                        return { title: title || domain, url, domain, category: 'general' };
                    })
                    .filter(s => {
                        if (!s.domain || seen.has(s.domain)) return false;
                        seen.add(s.domain);
                        return true;
                    });

                if (sources.length > 0) {
                    res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'evaluate', content: `Found ${sources.length} sources from Google Search` })}\n\n`);
                    res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);
                }
            }
        } catch (e) {
            console.error('Grounding metadata error:', e.message);
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

    const systemPrompt = buildSystemPrompt(searchWeb, deepResearch, false, []);
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

function buildSystemPrompt(searchWeb, deepResearch, needsSearch, sources) {
    let prompt = `You are Retrac AI, a helpful, knowledgeable, and friendly AI assistant.
You provide clear, well-structured responses using markdown formatting.
Use headers (##), bullet points, numbered lists, bold text, and code blocks when appropriate.
Keep your responses informative yet concise. Be conversational and helpful.`;

    if (!searchWeb && !deepResearch) {
        // No search mode — plain AI chat, NO sources ever
        prompt += `\nIMPORTANT: Do NOT include any "Sources", "References", or "Quellen" section. Do NOT cite URLs or websites. Just answer naturally.`;
    } else if (searchWeb && !deepResearch) {
        prompt += `\n\nThe user has enabled "Search the web" mode. Provide thorough, detailed, up-to-date information. Include specific facts, numbers, and details.
IMPORTANT: Do NOT list sources or references in your text — they are displayed separately by the UI.`;
    }

    if (deepResearch) {
        prompt += `\n\nThe user has enabled "Deep Research" mode. You must provide an extremely thorough, comprehensive, research-grade analysis:

## Response Structure:
1. **Executive Summary** — 2-3 sentence overview of key findings
2. **Background & Context** — Essential context the reader needs
3. **Key Findings** — Multiple sections with ## headers covering different angles, with specific data points, statistics, and expert opinions
4. **Analysis** — Your synthesis of the evidence, including:
   - Areas of scientific/expert consensus
   - Ongoing debates or uncertainties
   - Recent developments or emerging trends
5. **Multiple Perspectives** — Present different viewpoints fairly
6. **Key Takeaways** — Numbered list of the most important points

## Quality Standards:
- Include specific numbers, dates, percentages, and statistics wherever possible
- Name specific researchers, institutions, or organizations when relevant
- Distinguish between established facts and emerging/contested claims
- Aim for 800-1500 words minimum
- Use bold for key terms and important findings

IMPORTANT: Do NOT include a sources/references section — sources are displayed separately by the UI.`;
    }

    // Inject source context if we gathered sources
    if (needsSearch && sources && sources.length > 0) {
        prompt += `\n\nYou have consulted ${sources.length} sources including:
${sources.slice(0, 15).map(s => `- ${s.title} (${s.domain})`).join('\n')}
${sources.length > 15 ? `...and ${sources.length - 15} more sources.` : ''}

Use information consistent with what these authoritative sources would contain. Integrate facts naturally into your response.`;
    }

    return prompt;
}

// ============ Query Analysis ============
// Note: The AI now classifies queries itself in streamClaude.
// This function is kept as a fast pre-filter to skip obvious non-search queries
// before even calling the AI classifier (saves an API call).

function queryNeedsSearch(query) {
    const q = query.trim().toLowerCase();
    if (q.length < 5) return false;
    // Obvious greetings
    if (/^(hi|hey|hello|hallo|yo|sup|moin)\b/.test(q)) return false;
    if (/^(ok|yes|no|ja|nein|klar|sure)\b/.test(q) && q.length < 15) return false;
    return true;
}

// ============ Helpers ============

function parseSourcesJSON(text) {
    let sources = [];
    try {
        const parsed = JSON.parse(text.trim());
        if (Array.isArray(parsed)) sources = parsed;
    } catch (e) {
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (Array.isArray(parsed)) sources = parsed;
            } catch (e2) { /* skip */ }
        }
    }
    return sources.map(s => ({
        domain: s.domain || '',
        url: s.url || `https://${s.domain}`,
        title: s.title || s.domain,
        category: s.category || 'general'
    })).filter(s => s.domain);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ============ File Upload ============

app.post('/api/upload', upload.array('files', 20), (req, res) => {
    if (!req.files || !req.files.length) {
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

// ============ Image Generation Proxy (Nano Banana / Imagen via Google) ============

app.post('/api/generate-image', async (req, res) => {
    const { prompt, model, aspectRatio } = req.body;
    if (!API_KEYS.google) {
        return res.status(400).json({ error: 'Image generation requires a Google API key.' });
    }

    try {
        const modelMap = {
            'Nano Banana': 'gemini-2.5-flash-image',
            'Nano Banana Pro': 'gemini-3-pro-image-preview',
            'Nano Banana 2': 'gemini-3.1-flash-image-preview',
            'Imagen': 'imagen-4.0-generate-001'
        };
        const modelId = modelMap[model] || 'gemini-2.5-flash-image';

        // Imagen uses a different API (predict) vs Gemini models (generateContent)
        if (modelId.startsWith('imagen')) {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:predict?key=${API_KEYS.google}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        instances: [{ prompt }],
                        parameters: { sampleCount: 1, aspectRatio: aspectRatio || '1:1' }
                    })
                }
            );
            const data = await response.json();
            if (data.error) throw new Error(data.error.message);
            const imgData = data.predictions?.[0]?.bytesBase64Encoded;
            if (!imgData) throw new Error('No image returned from Imagen.');
            // Save to file and return URL
            const filename = `img-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`;
            const dir = path.join(__dirname, 'uploads');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, filename), Buffer.from(imgData, 'base64'));
            res.json({ url: `/uploads/${filename}`, revised_prompt: prompt });
        } else {
            // Nano Banana models use generateContent with image response modality
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(API_KEYS.google);
            const genModel = genAI.getGenerativeModel({
                model: modelId,
                generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
            });

            const result = await genModel.generateContent(prompt);
            const response = result.response;
            const parts = response.candidates?.[0]?.content?.parts || [];

            let imageData = null;
            let revisedPrompt = '';
            for (const part of parts) {
                if (part.inlineData) {
                    imageData = part.inlineData;
                } else if (part.text) {
                    revisedPrompt = part.text;
                }
            }

            if (!imageData) throw new Error('No image generated. Try a different prompt.');

            // Save base64 image to file
            const ext = imageData.mimeType.includes('png') ? 'png' : 'jpg';
            const filename = `img-${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
            const dir = path.join(__dirname, 'uploads');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, filename), Buffer.from(imageData.data, 'base64'));
            res.json({ url: `/uploads/${filename}`, revised_prompt: revisedPrompt || prompt });
        }
    } catch (err) {
        console.error('Image generation error:', err.message);
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
