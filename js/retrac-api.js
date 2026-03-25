// ============ Retrac API Client ============
// Shared across all pages for AI chat, file upload, and settings
// API keys are managed server-side via .env — no client-side key needed

const RetracAPI = {
    // Base URL - auto-detect from current host
    baseUrl: window.location.origin,

    // Send chat message with streaming
    currentAbortController: null,

    abortStream() {
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
        }
    },

    async streamChat({ model, messages, onThinking, onText, onError, onDone, onActivity, onSources }) {
        const searchWeb = RetracSettings.get('searchWeb') || false;
        const deepResearch = RetracSettings.get('deepResearch') || false;
        const handwriting = RetracSettings.get('handwriting') || false;

        this.currentAbortController = new AbortController();

        try {
            const response = await fetch(this.baseUrl + '/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, messages, searchWeb, deepResearch, handwriting }),
                signal: this.currentAbortController.signal
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
            if (err.name === 'AbortError') {
                onDone();
                return;
            }
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
    async generateImage(prompt, model, aspectRatio, referenceImage) {
        const res = await fetch(this.baseUrl + '/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, model, aspectRatio, referenceImage })
        });
        return res.json();
    },

    // Generate video
    async generateVideo(prompt, model, aspectRatio, duration) {
        const res = await fetch(this.baseUrl + '/api/generate-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, model, aspectRatio, duration })
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

    addMessage(chatId, role, content, model) {
        const chats = this.getAll();
        const chat = chats.find(c => c.id === chatId);
        if (!chat) return;
        const msg = { role, content, timestamp: Date.now() };
        if (model) msg.model = model;
        chat.messages.push(msg);
        chat.updatedAt = Date.now();
        // Save the model used in this chat
        if (role === 'assistant' && model) chat.model = model;
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

// ============ Sidebar Chat History Renderer ============
// Works on ALL pages — renders chat history into #chat-history-container

function renderSidebarChatHistory() {
    const container = document.getElementById('chat-history-container');
    if (!container) return;

    const chats = RetracChatHistory.getAll();
    const today = [], yesterday = [], older = [];
    const now = Date.now(), dayMs = 86400000;

    for (const chat of chats) {
        const age = now - (chat.updatedAt || chat.createdAt);
        if (age < dayMs) today.push(chat);
        else if (age < dayMs * 2) yesterday.push(chat);
        else older.push(chat);
    }

    function chatEntryHTML(c) {
        const title = c.title || 'New Chat';
        const displayTitle = title.length > 30 ? title.slice(0, 30) + '...' : title;
        return `<div class="chat-history-entry group flex items-center py-2 px-3 rounded-lg hover:bg-[#232323] transition-colors cursor-pointer" data-chat-id="${c.id}">
            <a href="index.html?chat=${c.id}" class="flex-1 min-w-0 text-[#e0e0e0] hover:text-white text-[14px] truncate" style="text-decoration:none;">${displayTitle}</a>
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                <button class="rename-chat-btn p-1 text-[#666] hover:text-white transition-colors" data-chat-id="${c.id}" title="Rename">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="delete-chat-btn p-1 text-[#666] hover:text-red-500 transition-colors" data-chat-id="${c.id}" title="Delete">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        </div>`;
    }

    let html = '';
    if (today.length > 0) {
        html += '<p class="text-[#666] text-[12px] font-medium mb-2 px-3">Today</p>';
        html += today.map(chatEntryHTML).join('');
    }
    if (yesterday.length > 0) {
        html += '<p class="text-[#666] text-[12px] font-medium mb-2 mt-4 px-3">Yesterday</p>';
        html += yesterday.map(chatEntryHTML).join('');
    }
    if (older.length > 0) {
        html += '<p class="text-[#666] text-[12px] font-medium mb-2 mt-4 px-3">Previous</p>';
        html += older.slice(0, 10).map(chatEntryHTML).join('');
    }
    if (!html) html = '<p class="text-[#555] text-[13px] px-3">No chats yet</p>';
    container.innerHTML = html;

    // Wire rename buttons
    container.querySelectorAll('.rename-chat-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const chatId = btn.dataset.chatId;
            const chats = RetracChatHistory.getAll();
            const chat = chats.find(c => c.id === chatId);
            if (!chat) return;

            // Custom rename popup
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:20000;display:flex;align-items:center;justify-content:center;';
            overlay.innerHTML = `
                <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:16px;padding:24px;width:400px;box-shadow:0 20px 50px rgba(0,0,0,0.5);">
                    <p style="color:white;font-size:16px;font-weight:600;margin-bottom:16px;">Rename Chat</p>
                    <input type="text" class="rename-input" value="${chat.title}" style="width:100%;background:#0e0e0e;border:1px solid #2a2a2a;border-radius:10px;padding:10px 14px;color:white;font-size:14px;outline:none;margin-bottom:16px;box-sizing:border-box;" />
                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                        <button class="cancel-rename" style="background:#2a2a2a;color:white;border:none;border-radius:10px;padding:8px 20px;font-size:13px;cursor:pointer;">Cancel</button>
                        <button class="confirm-rename" style="background:#2D8CFF;color:white;border:none;border-radius:10px;padding:8px 20px;font-size:13px;cursor:pointer;">Rename</button>
                    </div>
                </div>`;
            overlay.querySelector('.cancel-rename').addEventListener('click', () => overlay.remove());
            overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
            const input = overlay.querySelector('.rename-input');
            overlay.querySelector('.confirm-rename').addEventListener('click', () => {
                const newTitle = input.value.trim();
                if (newTitle) {
                    chat.title = newTitle;
                    RetracChatHistory.save(chats);
                    renderSidebarChatHistory();
                    if (typeof RetracChatUI !== 'undefined' && RetracChatUI.updateSidebarHistory) {
                        RetracChatUI.updateSidebarHistory();
                    }
                }
                overlay.remove();
            });
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') overlay.querySelector('.confirm-rename').click();
                if (ev.key === 'Escape') overlay.remove();
            });
            document.body.appendChild(overlay);
            input.focus();
            input.select();
        });
    });

    // Wire delete buttons
    container.querySelectorAll('.delete-chat-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const chatId = btn.dataset.chatId;
            RetracChatHistory.deleteChat(chatId);
            renderSidebarChatHistory();
            if (typeof RetracChatUI !== 'undefined' && RetracChatUI.updateSidebarHistory) {
                RetracChatUI.updateSidebarHistory();
            }
        });
    });

    // Right-click context menu
    container.querySelectorAll('.chat-history-entry').forEach(entry => {
        entry.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // Remove existing context menus
            document.querySelectorAll('.chat-context-menu').forEach(m => m.remove());

            const chatId = entry.dataset.chatId;
            const menu = document.createElement('div');
            menu.className = 'chat-context-menu';
            menu.style.cssText = `position:fixed;top:${e.clientY}px;left:${e.clientX}px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:4px;z-index:20000;box-shadow:0 10px 30px rgba(0,0,0,0.5);min-width:140px;`;
            menu.innerHTML = `
                <button class="ctx-rename" style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;background:none;border:none;color:white;font-size:13px;cursor:pointer;border-radius:6px;text-align:left;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    Rename
                </button>
                <button class="ctx-delete" style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;background:none;border:none;color:#f87171;font-size:13px;cursor:pointer;border-radius:6px;text-align:left;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    Delete
                </button>`;

            // Hover styles
            menu.querySelectorAll('button').forEach(b => {
                b.addEventListener('mouseenter', () => { b.style.background = '#2a2a2a'; });
                b.addEventListener('mouseleave', () => { b.style.background = 'none'; });
            });

            menu.querySelector('.ctx-rename').addEventListener('click', () => {
                menu.remove();
                entry.querySelector('.rename-chat-btn')?.click();
            });
            menu.querySelector('.ctx-delete').addEventListener('click', () => {
                menu.remove();
                entry.querySelector('.delete-chat-btn')?.click();
            });

            document.body.appendChild(menu);
            const closeMenu = (ev) => {
                if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeMenu); }
            };
            setTimeout(() => document.addEventListener('click', closeMenu), 0);
        });
    });
}

// Auto-render on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderSidebarChatHistory);
} else {
    renderSidebarChatHistory();
}
