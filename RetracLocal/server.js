require('dotenv').config();
const express = require('express');
const cors = require('cors');
const os = require('os');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.RETRACLOCAL_PORT || 3456;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const API_KEY = process.env.API_KEY || '';

// ============ Middleware ============

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname + '/public'));

// ============ In-Memory Stats ============

const stats = {
    startedAt: Date.now(),
    requests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalDuration: 0,
    activeRequests: 0,
    history: [],       // last 200 request logs
    modelUsage: {},    // { modelName: { requests, inputTokens, outputTokens, totalDuration } }
    errors: 0
};

function logRequest(entry) {
    stats.requests++;
    stats.totalInputTokens += entry.inputTokens || 0;
    stats.totalOutputTokens += entry.outputTokens || 0;
    stats.totalDuration += entry.duration || 0;
    if (entry.error) stats.errors++;

    // Per-model stats
    const m = entry.model || 'unknown';
    if (!stats.modelUsage[m]) stats.modelUsage[m] = { requests: 0, inputTokens: 0, outputTokens: 0, totalDuration: 0 };
    stats.modelUsage[m].requests++;
    stats.modelUsage[m].inputTokens += entry.inputTokens || 0;
    stats.modelUsage[m].outputTokens += entry.outputTokens || 0;
    stats.modelUsage[m].totalDuration += entry.duration || 0;

    stats.history.unshift({ ...entry, timestamp: Date.now() });
    if (stats.history.length > 200) stats.history.length = 200;
}

// API key authentication (skip for stats/status when accessed from localhost dashboard)
app.use('/api', (req, res, next) => {
    if (!API_KEY) return next();
    // Allow dashboard endpoints from localhost without key
    const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
    const isDashboardRoute = req.path === '/stats' || req.path === '/status' || req.path === '/models';
    if (isLocal && isDashboardRoute) return next();
    const provided = req.headers['x-api-key'] || req.query.key;
    if (provided !== API_KEY) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    next();
});

// ============ Model Registry ============

const MODELS = {
    'Qwen 3 14B':      { id: 'qwen3:14b',       tags: ['general', 'creative', 'math', 'language', 'analysis'] },
    'Mistral 7B':       { id: 'mistral:7b',       tags: ['summary', 'routing'] },
    'Phi-3 14B':        { id: 'phi3:14b',          tags: ['science'] },
    'GLM-4 9B':         { id: 'glm4:9b',           tags: ['code'] },
    'DeepSeek V3 16B':  { id: 'deepseek-v3:16b',  tags: ['code', 'general'] },
    'Llama 3.2':        { id: 'llama3.2',          tags: ['general'] }
};

const SYSTEM_PROMPT = `You are Retrac AI, a helpful and intelligent assistant.

CRITICAL RULE — LANGUAGE: You MUST respond in the SAME language the user writes in. This is your #1 priority. If the user writes in German, your ENTIRE response must be in German. If the user writes in English, respond in English. If the user writes in French, respond in French. NEVER switch to English unless the user writes in English. This rule overrides everything else.

Follow these rules:
1. **Match the user's energy**: Greeting → short greeting back. Simple question → direct answer. Complex question → detailed answer.
2. **Be direct and useful**. No filler phrases like "Great question!" or "Sure!". Just answer.
3. **For homework/school tasks**: Give clean, numbered answers matching the task structure. No drama, no essays. Just solve correctly.
4. **For lists/hooks/ideas**: Number them, make each item specific and complete. Add brief explanation why each works.
5. **For creative writing**: Just write it. No meta-commentary.
6. **Have strong opinions** backed by evidence. Don't hedge with "it depends" without explaining what it depends on.
7. **Use markdown** for formatting: **bold** for emphasis, ## for headers, numbered lists, code blocks.
8. **Be concise but complete**. Every sentence should add value.

REMEMBER: Always respond in the user's language. German question = German answer. No exceptions.`;

// ============ Helpers ============

function extractText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.filter(p => p.type === 'text').map(p => p.text).join('\n');
    }
    return String(content);
}

function prepareMessages(messages) {
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: extractText(m.content)
        }))
    ];
}

async function ollamaFetch(endpoint, body, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(`${OLLAMA_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error(`Ollama ${res.status}: ${res.statusText}`);
            return res;
        } catch (err) {
            if (attempt === retries) throw err;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

// ============ Routes ============

// Health check + available models
app.get('/api/status', async (req, res) => {
    try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, {
            signal: AbortSignal.timeout(5000)
        });
        const data = await r.json();
        const installed = (data.models || []).map(m => m.name);

        // Check which of our models are available
        const available = {};
        for (const [name, info] of Object.entries(MODELS)) {
            const baseId = info.id.split(':')[0];
            available[name] = installed.some(m => m.startsWith(baseId));
        }

        // Check media backends
        let fooocusOnline = false, comfyuiOnline = false;
        try { const r = await fetch(`${FOOOCUS_URL}/docs`, { signal: AbortSignal.timeout(2000) }); fooocusOnline = r.ok; } catch {}
        try { const r = await fetch(`${COMFYUI_URL}/api/object_info`, { signal: AbortSignal.timeout(2000) }); comfyuiOnline = r.ok; } catch {}
        if (fooocusOnline) available['Juggernaut XL'] = true;
        if (comfyuiOnline) available['Wan 2.1'] = true;

        res.json({ online: true, models: available, ollama: OLLAMA_URL, media: { fooocus: fooocusOnline, comfyui: comfyuiOnline } });
    } catch {
        res.json({ online: false, models: {}, ollama: OLLAMA_URL });
    }
});

// List all models
app.get('/api/models', (req, res) => {
    const list = Object.entries(MODELS).map(([name, info]) => ({
        name,
        id: info.id,
        tags: info.tags
    }));
    res.json({ models: list });
});

// ============ Chat Streaming (SSE) ============

app.post('/api/chat', async (req, res) => {
    const { model, messages } = req.body;
    if (!model || !messages) {
        return res.status(400).json({ error: 'Missing model or messages' });
    }

    // Smart Ensemble
    if (model === 'Smart Ensemble') {
        return streamEnsemble(res, messages);
    }

    const modelInfo = MODELS[model];
    if (!modelInfo) {
        return res.status(400).json({ error: `Unknown model: ${model}` });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reqStart = Date.now();
    stats.activeRequests++;

    try {
        const ollamaRes = await ollamaFetch('/api/chat', {
            model: modelInfo.id,
            messages: prepareMessages(messages),
            stream: true
        });

        res.write(`data: ${JSON.stringify({ type: 'thinking', content: `Processing with ${model} (local)...` })}\n\n`);

        const reader = ollamaRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let usage = { input: 0, output: 0 };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    if (json.message?.content) {
                        res.write(`data: ${JSON.stringify({ type: 'text', content: json.message.content })}\n\n`);
                    }
                    if (json.done) {
                        usage.input = json.prompt_eval_count || 0;
                        usage.output = json.eval_count || 0;
                    }
                } catch {}
            }
        }

        logRequest({ model, inputTokens: usage.input, outputTokens: usage.output, duration: Date.now() - reqStart });
        stats.activeRequests--;
        res.write(`data: ${JSON.stringify({ type: 'usage', input_tokens: usage.input, output_tokens: usage.output })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    } catch (err) {
        stats.activeRequests--;
        logRequest({ model, error: err.message, duration: 0 });
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        } else {
            res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
        }
    }
});

// ============ Smart Ensemble ============

async function streamEnsemble(res, messages) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const lastMsg = extractText(messages[messages.length - 1].content);

    res.write(`data: ${JSON.stringify({ type: 'thinking', content: 'Analyzing question...' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'search', content: 'Routing to specialists...' })}\n\n`);

    // Step 1: ROUTER — classify the question
    const routerPrompt = `Classify this question into categories. Pick the 3 most relevant from: [general, creative, math, code, science, language, analysis, summary]. Return ONLY a JSON array of 3 strings. Question: "${lastMsg.substring(0, 500)}"`;

    let categories = ['general', 'creative', 'analysis'];
    try {
        const routerRes = await ollamaFetch('/api/generate', {
            model: 'mistral:7b',
            prompt: routerPrompt,
            stream: false
        });
        const routerData = await routerRes.json();
        const parsed = JSON.parse(routerData.response.match(/\[.*\]/)?.[0] || '["general","creative","analysis"]');
        if (Array.isArray(parsed) && parsed.length >= 2) categories = parsed.slice(0, 3);
    } catch (e) {
        console.warn('Router fallback to defaults:', e.message);
    }

    // Map categories to specialist models
    const specialistMap = {
        'general': 'qwen3:14b',    'creative': 'qwen3:14b',
        'math': 'qwen3:14b',       'code': 'glm4:9b',
        'science': 'phi3:14b',     'language': 'qwen3:14b',
        'analysis': 'qwen3:14b',   'summary': 'mistral:7b'
    };
    const specialistNames = {
        'qwen3:14b': 'Qwen 3 14B',   'glm4:9b': 'GLM-4 9B',
        'phi3:14b': 'Phi-3 14B',      'mistral:7b': 'Mistral 7B'
    };

    const selectedModels = [...new Set(categories.map(c => specialistMap[c] || 'qwen3:14b'))];
    if (selectedModels.length < 2) selectedModels.push('mistral:7b');
    const models = selectedModels.slice(0, 3);

    res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'search', content: `Selected specialists: ${models.map(m => specialistNames[m]).join(', ')}` })}\n\n`);

    // Step 2: Query each specialist (sequentially — single GPU)
    const ollamaMessages = prepareMessages(messages);
    const responses = [];

    for (let i = 0; i < models.length; i++) {
        const model = models[i];
        const name = specialistNames[model];
        res.write(`data: ${JSON.stringify({ type: 'thinking', content: `${name} is thinking... (${i + 1}/${models.length})` })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'activity', activity: 'evaluate', content: `Querying ${name}...` })}\n\n`);

        try {
            const ollamaRes = await ollamaFetch('/api/chat', {
                model, messages: ollamaMessages, stream: false
            });
            const data = await ollamaRes.json();
            responses.push({ model: name, response: data.message?.content || '' });
        } catch (e) {
            console.warn(`Ensemble: ${name} failed:`, e.message);
            responses.push({ model: name, response: '' });
        }
    }

    // Step 3: JUDGE — combine the best parts
    res.write(`data: ${JSON.stringify({ type: 'thinking', content: 'Judge is combining results...' })}\n\n`);

    const validResponses = responses.filter(r => r.response.length > 0);

    if (validResponses.length === 0) {
        res.write(`data: ${JSON.stringify({ type: 'text', content: 'Ensemble failed — no models responded. Make sure Ollama is running with the required models.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
    }

    if (validResponses.length === 1) {
        res.write(`data: ${JSON.stringify({ type: 'text', content: validResponses[0].response })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
    }

    const judgePrompt = `You are a Judge AI. You received answers from ${validResponses.length} specialist AI models to the same question.

CRITICAL: You MUST write your answer in the EXACT SAME LANGUAGE as the original question below. If the question is in German, your ENTIRE answer must be in German. If in English, answer in English. NO EXCEPTIONS.

Your job:
1. Identify the BEST parts of each answer
2. Combine them into ONE superior answer
3. Fix any errors or contradictions
4. Do NOT mention that multiple models were used. Just write the best possible answer.

ORIGINAL QUESTION: "${lastMsg}"

${validResponses.map(r => `--- ANSWER FROM ${r.model} ---\n${r.response}\n`).join('\n')}

Now write the FINAL combined answer (in the same language as the question):`;

    try {
        const judgeRes = await ollamaFetch('/api/chat', {
            model: 'qwen3:14b',
            messages: [{ role: 'user', content: judgePrompt }],
            stream: true
        });

        const reader = judgeRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    if (json.message?.content) {
                        res.write(`data: ${JSON.stringify({ type: 'text', content: json.message.content })}\n\n`);
                    }
                } catch {}
            }
        }
    } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Judge failed: ' + err.message })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
}

// ============ Non-streaming chat (for simple integrations) ============

app.post('/api/chat/sync', async (req, res) => {
    const { model, messages } = req.body;
    const modelInfo = MODELS[model];
    if (!modelInfo) return res.status(400).json({ error: `Unknown model: ${model}` });

    try {
        const ollamaRes = await ollamaFetch('/api/chat', {
            model: modelInfo.id,
            messages: prepareMessages(messages),
            stream: false
        });
        const data = await ollamaRes.json();
        res.json({
            content: data.message?.content || '',
            model: model,
            usage: {
                input_tokens: data.prompt_eval_count || 0,
                output_tokens: data.eval_count || 0
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ Pull model ============

app.post('/api/models/pull', async (req, res) => {
    const { model } = req.body;
    const modelInfo = MODELS[model];
    if (!modelInfo) return res.status(400).json({ error: `Unknown model: ${model}` });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');

    try {
        const pullRes = await fetch(`${OLLAMA_URL}/api/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: modelInfo.id, stream: true })
        });

        const reader = pullRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    res.write(`data: ${JSON.stringify(json)}\n\n`);
                } catch {}
            }
        }

        res.write('data: [DONE]\n\n');
        res.end();
    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        } else {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        }
    }
});

// ============ Stats API (for dashboard) ============

app.get('/api/stats', (req, res) => {
    const uptime = Date.now() - stats.startedAt;
    res.json({
        uptime,
        requests: stats.requests,
        errors: stats.errors,
        activeRequests: stats.activeRequests,
        totalInputTokens: stats.totalInputTokens,
        totalOutputTokens: stats.totalOutputTokens,
        totalTokens: stats.totalInputTokens + stats.totalOutputTokens,
        avgDuration: stats.requests > 0 ? Math.round(stats.totalDuration / stats.requests) : 0,
        modelUsage: stats.modelUsage,
        history: stats.history.slice(0, 50)
    });
});

// ============ System Monitor API ============

function getCpuUsage() {
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    for (const cpu of cpus) {
        for (const type in cpu.times) totalTick += cpu.times[type];
        totalIdle += cpu.times.idle;
    }
    return { cores: cpus.length, model: cpus[0]?.model || 'Unknown', idlePct: totalIdle / totalTick };
}

// Track CPU over time for delta calculation
let prevCpuIdle = 0, prevCpuTotal = 0;
function getCpuPercent() {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    for (const cpu of cpus) {
        for (const type in cpu.times) total += cpu.times[type];
        idle += cpu.times.idle;
    }
    const diffIdle = idle - prevCpuIdle;
    const diffTotal = total - prevCpuTotal;
    prevCpuIdle = idle;
    prevCpuTotal = total;
    if (diffTotal === 0) return 0;
    return Math.round((1 - diffIdle / diffTotal) * 100);
}

function getGpuInfo() {
    try {
        // NVIDIA GPU via nvidia-smi
        const raw = execSync('nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits', { timeout: 3000, encoding: 'utf-8' });
        const parts = raw.trim().split(',').map(s => s.trim());
        return {
            available: true,
            name: parts[0],
            utilization: parseInt(parts[1]) || 0,
            memUsed: parseInt(parts[2]) || 0,
            memTotal: parseInt(parts[3]) || 0,
            temp: parseInt(parts[4]) || 0,
            power: parseFloat(parts[5]) || 0
        };
    } catch {
        return { available: false };
    }
}

app.get('/api/system', (req, res) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpuPct = getCpuPercent();
    const gpu = getGpuInfo();

    res.json({
        cpu: {
            percent: cpuPct,
            cores: os.cpus().length,
            model: os.cpus()[0]?.model || 'Unknown'
        },
        ram: {
            total: totalMem,
            used: usedMem,
            free: freeMem,
            percent: Math.round((usedMem / totalMem) * 100)
        },
        gpu,
        platform: os.platform(),
        hostname: os.hostname(),
        nodeVersion: process.version,
        processMemory: process.memoryUsage().rss
    });
});

// ============ Local Image Generation (Fooocus-API / Juggernaut XL) ============

const FOOOCUS_URL = process.env.FOOOCUS_URL || 'http://127.0.0.1:8888';
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';

app.get('/api/media-status', async (req, res) => {
    let fooocus = false, comfyui = false;
    try { const r = await fetch(`${FOOOCUS_URL}/docs`, { signal: AbortSignal.timeout(3000) }); fooocus = r.ok; } catch {}
    try { const r = await fetch(`${COMFYUI_URL}/api/object_info`, { signal: AbortSignal.timeout(3000) }); comfyui = r.ok; } catch {}
    res.json({ fooocus, comfyui, models: {
        'Juggernaut XL': fooocus,
        'Wan 2.1': comfyui
    }});
});

app.post('/api/generate-image', async (req, res) => {
    const startTime = Date.now();
    const { prompt, aspectRatio } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });

    const resMap = { '1:1': '1024*1024', '4:3': '1152*896', '3:4': '896*1152', '16:9': '1344*768', '9:16': '768*1344' };
    const aspectRes = resMap[aspectRatio] || '1024*1024';

    try {
        const response = await fetch(`${FOOOCUS_URL}/v1/generation/text-to-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                negative_prompt: 'cartoon, painting, illustration, worst quality, low quality, blurry',
                style_selections: ['Fooocus V2', 'Fooocus Enhance', 'Fooocus Sharp'],
                performance_selection: 'Speed',
                aspect_ratios_selection: aspectRes,
                image_number: 1, image_seed: -1, sharpness: 2, guidance_scale: 7,
                base_model_name: 'juggernautXL_v8Rundiffusion.safetensors',
                refiner_model_name: 'None',
                loras: [{ enabled: true, model_name: 'sd_xl_offset_example-lora_1.0.safetensors', weight: 0.1 }]
            })
        });
        if (!response.ok) throw new Error('Fooocus-API not available');
        const data = await response.json();

        if (data?.[0]?.url) {
            const imgRes = await fetch(data[0].url);
            if (imgRes.ok) {
                const buf = Buffer.from(await imgRes.arrayBuffer());
                return res.json({ url: `data:image/png;base64,${buf.toString('base64')}`, duration: Date.now() - startTime });
            }
        }
        if (data?.[0]?.base64) {
            return res.json({ url: `data:image/png;base64,${data[0].base64}`, duration: Date.now() - startTime });
        }
        throw new Error('No image returned');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/generate-video', async (req, res) => {
    const startTime = Date.now();
    const { prompt, aspectRatio, image } = req.body;
    if (!prompt && !image) return res.status(400).json({ error: 'Prompt or image required.' });

    const WebSocket = require('ws');
    const resMap = { '16:9': [832, 480], '9:16': [480, 832], '1:1': [640, 640], '4:3': [704, 528], '3:4': [528, 704] };
    const [width, height] = resMap[aspectRatio] || [832, 480];

    try {
        const workflow = {
            '1': { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.1_t2v_1.3B_bf16.safetensors', weight_dtype: 'default' } },
            '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' } },
            '3': { class_type: 'VAELoader', inputs: { vae_name: 'wan_2.1_vae.safetensors' } },
            '4': { class_type: 'CLIPTextEncode', inputs: { text: prompt || 'camera slowly panning', clip: ['2', 0] } },
            '5': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low quality, distorted, watermark', clip: ['2', 0] } },
            '6': { class_type: 'EmptyHunyuanLatentVideo', inputs: { width, height, length: 33, batch_size: 1 } },
            '7': { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift: 8.0 } },
            '8': { class_type: 'KSampler', inputs: {
                model: ['7', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0],
                seed: Math.floor(Math.random() * 1e15), control_after_generate: 'randomize',
                steps: 30, cfg: 6.0, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1.0
            }},
            '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
            '10': { class_type: 'CreateVideo', inputs: { images: ['9', 0], fps: 16 } },
            '11': { class_type: 'SaveVideo', inputs: { video: ['10', 0], filename_prefix: 'video/RetracVideo', format: 'auto', codec: 'auto' } }
        };

        const clientId = 'retraclocal_' + Date.now();
        const promptRes = await fetch(`${COMFYUI_URL}/api/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: workflow, client_id: clientId })
        });
        if (!promptRes.ok) throw new Error('ComfyUI not available');
        const { prompt_id } = await promptRes.json();

        const result = await new Promise((resolve, reject) => {
            const ws = new WebSocket(`${COMFYUI_URL.replace('http', 'ws')}/ws?clientId=${clientId}`);
            const timeout = setTimeout(() => { ws.close(); reject(new Error('Video generation timed out (5 min).')); }, 300000);
            ws.on('message', (raw) => {
                try {
                    const msg = JSON.parse(raw.toString());
                    if (msg.type === 'executed' && msg.data?.output?.images?.[0]) {
                        clearTimeout(timeout); ws.close(); resolve(msg.data.output.images[0]);
                    } else if (msg.type === 'execution_error') {
                        clearTimeout(timeout); ws.close(); reject(new Error(msg.data?.exception_message || 'ComfyUI error'));
                    }
                } catch {}
            });
            ws.on('error', (err) => { clearTimeout(timeout); reject(new Error('ComfyUI connection error')); });
        });

        const videoUrl = `${COMFYUI_URL}/api/view?filename=${encodeURIComponent(result.filename)}&subfolder=${encodeURIComponent(result.subfolder || '')}&type=${result.type || 'output'}`;
        const videoRes = await fetch(videoUrl);
        if (!videoRes.ok) throw new Error('Failed to fetch video');
        const videoBuf = Buffer.from(await videoRes.arrayBuffer());
        const mime = result.filename?.endsWith('.webm') ? 'video/webm' : 'video/mp4';
        res.json({ url: `data:${mime};base64,${videoBuf.toString('base64')}`, duration: Date.now() - startTime });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Dashboard
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/dashboard.html');
});

// ============ Start ============

app.listen(PORT, () => {
    console.log(`\n  RetracLocal API running on http://localhost:${PORT}`);
    console.log(`  Ollama backend: ${OLLAMA_URL}`);
    console.log(`  API key: ${API_KEY ? 'enabled' : 'disabled (open access)'}\n`);
    console.log(`  Fooocus-API: ${FOOOCUS_URL}`);
    console.log(`  ComfyUI: ${COMFYUI_URL}\n`);
    console.log('  Endpoints:');
    console.log('    GET  /api/status       — health check + available models');
    console.log('    GET  /api/models       — list all supported models');
    console.log('    GET  /api/media-status — image/video backends status');
    console.log('    POST /api/generate-image — generate image (Juggernaut XL)');
    console.log('    POST /api/generate-video — generate video (Wan 2.1)');
    console.log('    POST /api/chat         — streaming chat (SSE)');
    console.log('    POST /api/chat/sync    — non-streaming chat');
    console.log('    POST /api/models/pull  — download a model\n');
});
