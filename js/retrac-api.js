// ============ Retrac API Client ============
// Shared across all pages for AI chat, file upload, and settings
// API keys are managed server-side via .env — no client-side key needed

const RetracAPI = {
    // Base URL - auto-detect from current host
    baseUrl: window.location.origin,

    // Send chat message with streaming
    async streamChat({ model, messages, onThinking, onText, onError, onDone, onActivity, onSources }) {
        const searchWeb = RetracSettings.get('searchWeb') || false;
        const deepResearch = RetracSettings.get('deepResearch') || false;

        try {
            const response = await fetch(this.baseUrl + '/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, messages, searchWeb, deepResearch })
            });

            if (!response.ok) {
                const err = await response.json();
                onError(err.error || 'Server error');
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // keep incomplete line

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        onDone();
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.error) {
                            onError(parsed.error);
                            return;
                        }
                        if (parsed.type === 'thinking') {
                            onThinking(parsed.content);
                        } else if (parsed.type === 'activity') {
                            if (onActivity) onActivity(parsed.activity, parsed.content);
                        } else if (parsed.type === 'sources') {
                            if (onSources) onSources(parsed.sources);
                        } else if (parsed.type === 'text') {
                            onText(parsed.content);
                        }
                    } catch (e) {
                        // skip malformed JSON
                    }
                }
            }
            onDone();
        } catch (err) {
            onError('Connection error: ' + err.message + '. Make sure the server is running (npm start).');
        }
    },

    // Upload files
    async uploadFiles(files) {
        const formData = new FormData();
        for (const file of files) {
            formData.append('files', file);
        }
        const res = await fetch(this.baseUrl + '/api/upload', {
            method: 'POST',
            body: formData
        });
        return res.json();
    },

    // Generate image
    async generateImage(prompt) {
        const res = await fetch(this.baseUrl + '/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });
        return res.json();
    }
};

// ============ Settings Manager ============

const RetracSettings = {
    _cache: null,

    _load() {
        if (!this._cache) {
            this._cache = JSON.parse(localStorage.getItem('retrac_settings') || '{}');
        }
        return this._cache;
    },

    get(key) {
        return this._load()[key] || null;
    },

    set(key, value) {
        const s = this._load();
        s[key] = value;
        localStorage.setItem('retrac_settings', JSON.stringify(s));
    },

    remove(key) {
        const s = this._load();
        delete s[key];
        localStorage.setItem('retrac_settings', JSON.stringify(s));
    }
};

// ============ Chat History Manager ============

const RetracChatHistory = {
    _key: 'retrac_chats',

    getAll() {
        return JSON.parse(localStorage.getItem(this._key) || '[]');
    },

    save(chats) {
        localStorage.setItem(this._key, JSON.stringify(chats));
    },

    getCurrent() {
        const id = sessionStorage.getItem('retrac_current_chat_id');
        if (!id) return null;
        const chats = this.getAll();
        return chats.find(c => c.id === id) || null;
    },

    createNew(title) {
        const chat = {
            id: 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            title: title || 'New Chat',
            messages: [],
            model: null,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        const chats = this.getAll();
        chats.unshift(chat);
        this.save(chats);
        sessionStorage.setItem('retrac_current_chat_id', chat.id);
        return chat;
    },

    addMessage(chatId, role, content) {
        const chats = this.getAll();
        const chat = chats.find(c => c.id === chatId);
        if (!chat) return;
        chat.messages.push({ role, content, timestamp: Date.now() });
        chat.updatedAt = Date.now();
        // Auto-title from first user message
        if (chat.messages.length === 1 && role === 'user') {
            chat.title = content.length > 50 ? content.slice(0, 50) + '...' : content;
        }
        this.save(chats);
        return chat;
    },

    deleteChat(chatId) {
        let chats = this.getAll();
        chats = chats.filter(c => c.id !== chatId);
        this.save(chats);
    },

    clearAll() {
        this.save([]);
        sessionStorage.removeItem('retrac_current_chat_id');
    }
};
