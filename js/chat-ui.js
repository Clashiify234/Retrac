// ============ Retrac Chat UI Engine ============
// Renders chat messages, handles streaming, markdown rendering

const RetracChatUI = {
    chatContainer: null,
    scrollContainer: null,
    textarea: null,
    currentModel: 'Gemini 3 Pro',
    isStreaming: false,
    currentChat: null,
    attachedFiles: [],
    showChatView: null,  // set by page during init

    // Initialize chat UI
    init(options = {}) {
        this.chatContainer = options.chatContainer;
        this.scrollContainer = options.scrollContainer || options.chatContainer;
        this.textarea = options.textarea;
        this.showChatView = options.showChatView || (() => {});
        this.onChatCreated = options.onChatCreated || (() => {});

        // Load existing chat if any
        this.currentChat = this._freshChat();
        if (this.currentChat && this.currentChat.messages.length > 0) {
            this.showChatView();
            this.renderChatHistory();
        }

        // Inject CSS for animations
        if (!document.getElementById('retrac-chat-styles')) {
            const style = document.createElement('style');
            style.id = 'retrac-chat-styles';
            style.textContent = `
                @keyframes fadeSlideIn {
                    from { opacity: 0; transform: translateY(-4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .thinking-toggle { cursor: pointer; user-select: none; }
                .thinking-toggle:hover { opacity: 0.8; }
                .thinking-content { overflow: hidden; transition: max-height 0.3s ease, opacity 0.3s ease; }
                .thinking-content.collapsed { max-height: 0 !important; opacity: 0; padding: 0 !important; margin: 0 !important; border: none !important; }
                .thinking-chevron { transition: transform 0.2s ease; }
                .thinking-chevron.collapsed { transform: rotate(-90deg); }
            `;
            document.head.appendChild(style);
        }
    },

    // Get fresh chat data from localStorage (avoids stale references)
    _freshChat() {
        const id = sessionStorage.getItem('retrac_current_chat_id');
        if (!id) return null;
        const chats = RetracChatHistory.getAll();
        return chats.find(c => c.id === id) || null;
    },

    // Refresh current chat from localStorage
    _refreshCurrentChat() {
        if (!this.currentChat) return;
        this.currentChat = this._freshChat();
    },

    // Set current model
    setModel(model) {
        this.currentModel = model;
    },

    // Send a message
    async sendMessage(text, files = []) {
        if (!text.trim() && files.length === 0) return;
        if (this.isStreaming) return;

        // Create chat if none exists
        if (!this.currentChat) {
            this.currentChat = RetracChatHistory.createNew(text);
            this.onChatCreated(this.currentChat);
        }

        // Switch to chat view
        this.showChatView();

        // Add user message to storage
        RetracChatHistory.addMessage(this.currentChat.id, 'user', text);
        this._refreshCurrentChat(); // sync in-memory with localStorage

        // Render user message
        this.renderUserMessage(text, files);

        // Clear input
        if (this.textarea) {
            this.textarea.value = '';
            this.textarea.style.height = 'auto';
        }

        // Build messages array for API from fresh localStorage data
        const apiMessages = (this.currentChat.messages || []).map(m => ({
            role: m.role,
            content: m.content
        }));

        // Safety: ensure at least the current user message is present
        if (apiMessages.length === 0) {
            apiMessages.push({ role: 'user', content: text });
        }

        // Create assistant message container
        const assistantEl = this.createAssistantMessageEl();
        this.isStreaming = true;
        let fullResponse = '';
        let activities = [];
        let sources = [];

        await RetracAPI.streamChat({
            model: this.currentModel,
            messages: apiMessages,
            onActivity: (activityType, content) => {
                activities.push({ type: activityType, text: content });
                this.addActivity(assistantEl, activityType, content);
            },
            onThinking: (content) => {
                this.updateThinkingStatus(assistantEl, content);
            },
            onText: (content) => {
                fullResponse += content;
                this.updateAssistantMessage(assistantEl, fullResponse);
            },
            onSources: (srcList) => {
                sources = srcList;
            },
            onError: (error) => {
                this.showErrorInMessage(assistantEl, error);
                this.isStreaming = false;
            },
            onDone: () => {
                if (fullResponse) {
                    RetracChatHistory.addMessage(this.currentChat.id, 'assistant', fullResponse);
                    this._refreshCurrentChat();
                    this.finalizeAssistantMessage(assistantEl, fullResponse, activities, sources);
                }
                this.isStreaming = false;
                this.updateSidebarHistory();
            }
        });
    },

    // Render full chat history
    renderChatHistory() {
        if (!this.chatContainer || !this.currentChat) return;
        this.chatContainer.innerHTML = '';

        for (const msg of this.currentChat.messages) {
            if (msg.role === 'user') {
                this.renderUserMessage(msg.content);
            } else {
                const el = this.createAssistantMessageEl();
                this.finalizeAssistantMessage(el, msg.content);
            }
        }
    },

    // Render a user message bubble
    renderUserMessage(text, files = []) {
        if (!this.chatContainer) return;

        const user = JSON.parse(localStorage.getItem('retrac_current_user') || '{}');
        const initial = (user.name || user.email || 'U')[0].toUpperCase();
        const avatarHTML = user.picture
            ? `<img src="${user.picture}" class="w-8 h-8 rounded-full object-cover shrink-0" referrerpolicy="no-referrer" />`
            : `<div class="w-8 h-8 rounded-full bg-[#444] flex items-center justify-center text-white text-[13px] font-semibold shrink-0">${initial}</div>`;

        const msgEl = document.createElement('div');
        msgEl.className = 'flex gap-3 justify-end mb-6 chat-message user-message';
        msgEl.innerHTML = `
            <div class="max-w-[75%]">
                ${files.length > 0 ? `<div class="flex flex-wrap gap-2 mb-2 justify-end">${files.map(f => `<span class="bg-[#3a3a3a] text-[#ccc] text-[12px] px-3 py-1 rounded-full">${f}</span>`).join('')}</div>` : ''}
                <div class="bg-[#383838] rounded-2xl rounded-tr-md px-4 py-3 text-[15px] text-white leading-relaxed">${this.escapeHtml(text)}</div>
            </div>
            ${avatarHTML}
        `;
        this.chatContainer.appendChild(msgEl);
        this.scrollToBottom();
    },

    // Create assistant message element (for streaming)
    createAssistantMessageEl() {
        if (!this.chatContainer) return document.createElement('div');

        const modelIcon = this.getModelIcon(this.currentModel);

        const msgEl = document.createElement('div');
        msgEl.className = 'flex gap-3 mb-6 chat-message assistant-message';
        msgEl.innerHTML = `
            <div class="w-8 h-8 rounded-full bg-[#2a2a2a] border border-[#3a3a3a] flex items-center justify-center shrink-0 mt-1">
                ${modelIcon}
            </div>
            <div class="flex-1 min-w-0 max-w-[85%]">
                <div class="thinking-block mb-3">
                    <div class="thinking-status flex items-center gap-2 mb-1">
                        <div class="w-4 h-4 border-2 border-[#555] border-t-white rounded-full animate-spin"></div>
                        <span class="text-[#888] text-[13px]">Thinking...</span>
                    </div>
                    <div class="activity-list"></div>
                </div>
                <div class="assistant-content prose prose-invert text-[15px] leading-relaxed"></div>
                <div class="message-actions hidden items-center gap-2 mt-3 pt-2 border-t border-[#2a2a2a]">
                    <button class="copy-btn flex items-center gap-1.5 text-[#666] hover:text-white text-[12px] transition-colors px-2 py-1 rounded hover:bg-[#2a2a2a]">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        Copy
                    </button>
                    <button class="reply-btn flex items-center gap-1.5 text-[#666] hover:text-white text-[12px] transition-colors px-2 py-1 rounded hover:bg-[#2a2a2a]">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 17 20 12 15 7"></polyline><path d="M4 18v-2a4 4 0 0 1 4-4h12"></path></svg>
                        Reply
                    </button>
                    <button class="retry-btn flex items-center gap-1.5 text-[#666] hover:text-white text-[12px] transition-colors px-2 py-1 rounded hover:bg-[#2a2a2a]">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>
                        Retry
                    </button>
                </div>
            </div>
        `;

        this.chatContainer.appendChild(msgEl);
        this.scrollToBottom();
        return msgEl;
    },

    // Add a live activity item (search, visit, analyze)
    addActivity(el, activityType, text) {
        const activityList = el.querySelector('.activity-list');
        if (!activityList) return;

        const icons = {
            search: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.3-4.3"></path></svg>`,
            visit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`,
            think: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>`,
            analyze: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`
        };

        const item = document.createElement('div');
        item.className = 'flex items-center gap-2 py-1 activity-item';
        item.style.cssText = 'animation: fadeSlideIn 0.3s ease-out forwards; opacity: 0;';
        item.innerHTML = `${icons[activityType] || icons.think}<span class="text-[#999] text-[12px]">${this.escapeHtml(text)}</span>`;
        activityList.appendChild(item);

        const statusSpan = el.querySelector('.thinking-status span');
        if (statusSpan) statusSpan.textContent = text;

        this.scrollToBottom();
    },

    // Update thinking status
    updateThinkingStatus(el, text) {
        const thinkingEl = el.querySelector('.thinking-status span');
        if (thinkingEl) thinkingEl.textContent = text;
    },

    // Update assistant message during streaming
    updateAssistantMessage(el, fullText) {
        const contentEl = el.querySelector('.assistant-content');
        if (!contentEl) return;

        // Hide spinner
        const thinkingStatus = el.querySelector('.thinking-status');
        if (thinkingStatus) thinkingStatus.style.display = 'none';

        // Collapse activity list during streaming
        const activityList = el.querySelector('.activity-list');
        if (activityList && activityList.children.length > 0 && !activityList.dataset.collapsed) {
            activityList.dataset.collapsed = 'true';
            activityList.style.maxHeight = '0';
            activityList.style.overflow = 'hidden';
            activityList.style.transition = 'max-height 0.3s ease';
        }

        contentEl.innerHTML = this.renderMarkdown(fullText);
        this.scrollToBottom();
    },

    // Finalize assistant message
    finalizeAssistantMessage(el, fullText, activities = [], sources = []) {
        const contentEl = el.querySelector('.assistant-content');
        if (!contentEl) return;

        // Convert thinking block to collapsible
        const thinkingBlock = el.querySelector('.thinking-block');
        const activityList = el.querySelector('.activity-list');

        if (thinkingBlock && activities.length > 0) {
            const count = activities.length;
            thinkingBlock.innerHTML = `
                <div class="thinking-toggle flex items-center gap-2 py-1.5" onclick="this.parentElement.querySelector('.thinking-content').classList.toggle('collapsed'); this.querySelector('.thinking-chevron').classList.toggle('collapsed');">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" class="shrink-0"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
                    <span class="text-[#888] text-[13px] font-medium">Thought for ${count} steps</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2.5" class="thinking-chevron collapsed shrink-0"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
                <div class="thinking-content collapsed bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-2 mt-1 mb-2" style="max-height: 300px; overflow-y: auto;">
                    ${activities.map(act => {
                        const colors = { search: '#3b82f6', visit: '#8b5cf6', think: '#f59e0b', analyze: '#22c55e' };
                        const c = colors[act.type] || '#888';
                        const iconMap = {
                            search: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.3-4.3"></path></svg>`,
                            visit: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`,
                            think: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>`,
                            analyze: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`
                        };
                        return `<div class="flex items-center gap-2 py-1">${iconMap[act.type] || iconMap.think}<span class="text-[#777] text-[12px]">${this.escapeHtml(act.text)}</span></div>`;
                    }).join('')}
                </div>
            `;
        } else if (thinkingBlock) {
            thinkingBlock.style.display = 'none';
        }

        // Final render
        contentEl.innerHTML = this.renderMarkdown(fullText);

        // Render sources bar if we have sources
        if (sources.length > 0) {
            this.renderSourcesBar(el, sources);
        }

        // Show action buttons
        const actions = el.querySelector('.message-actions');
        if (actions) {
            actions.classList.remove('hidden');
            actions.style.display = 'flex';

            actions.querySelector('.copy-btn')?.addEventListener('click', () => {
                navigator.clipboard.writeText(fullText);
                const btn = actions.querySelector('.copy-btn');
                const origHTML = btn.innerHTML;
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!`;
                setTimeout(() => { btn.innerHTML = origHTML; }, 2000);
            });

            actions.querySelector('.reply-btn')?.addEventListener('click', () => {
                if (this.textarea) this.textarea.focus();
            });

            actions.querySelector('.retry-btn')?.addEventListener('click', () => {
                this._refreshCurrentChat();
                if (!this.currentChat) return;
                const msgs = this.currentChat.messages;
                if (msgs.length >= 2 && msgs[msgs.length - 1].role === 'assistant') {
                    const userMsg = msgs[msgs.length - 2].content;
                    // Remove both from storage
                    const allChats = RetracChatHistory.getAll();
                    const chat = allChats.find(c => c.id === this.currentChat.id);
                    if (chat) {
                        chat.messages.pop();
                        chat.messages.pop();
                        RetracChatHistory.save(allChats);
                    }
                    this._refreshCurrentChat();
                    el.remove();
                    this.sendMessage(userMsg);
                }
            });
        }

        // Code block copy buttons
        contentEl.querySelectorAll('pre').forEach(pre => {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'absolute top-2 right-2 text-[#666] hover:text-white bg-[#1a1a1a] hover:bg-[#333] px-2 py-1 rounded text-[11px] transition-colors';
            copyBtn.textContent = 'Copy';
            copyBtn.addEventListener('click', () => {
                const code = pre.querySelector('code')?.textContent || pre.textContent;
                navigator.clipboard.writeText(code);
                copyBtn.textContent = 'Copied!';
                setTimeout(() => copyBtn.textContent = 'Copy', 2000);
            });
            pre.style.position = 'relative';
            pre.appendChild(copyBtn);
        });

        this.scrollToBottom();
    },

    // Render sources bar below the response
    renderSourcesBar(el, sources) {
        const contentWrapper = el.querySelector('.flex-1.min-w-0');
        if (!contentWrapper) return;

        const actions = el.querySelector('.message-actions');
        const sourcesBar = document.createElement('div');
        sourcesBar.className = 'sources-bar mt-3 mb-1';

        const VISIBLE_COUNT = 3;
        const visibleSources = sources.slice(0, VISIBLE_COUNT);
        const hiddenSources = sources.slice(VISIBLE_COUNT);
        const hasMore = hiddenSources.length > 0;

        // Get favicon URL for a domain
        const favicon = (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

        sourcesBar.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="text-[#666] text-[12px] font-medium">Sources</span>
                <div class="flex items-center gap-1">
                    ${visibleSources.map(s => `
                        <a href="${this.escapeHtml(s.url)}" target="_blank" rel="noopener" class="w-6 h-6 rounded-full bg-[#2a2a2a] border border-[#333] flex items-center justify-center hover:border-[#555] transition-colors" title="${this.escapeHtml(s.domain)}">
                            <img src="${favicon(s.domain)}" width="14" height="14" class="rounded-sm" onerror="this.style.display='none'" />
                        </a>
                    `).join('')}
                    ${hasMore ? `
                        <button class="sources-expand-btn h-6 px-2.5 rounded-full bg-[#2a2a2a] border border-[#333] text-[#888] text-[11px] font-medium hover:border-[#555] hover:text-white transition-colors">
                            +${hiddenSources.length}
                        </button>
                    ` : ''}
                </div>
            </div>
            <div class="sources-expanded hidden mt-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
                ${sources.map(s => `
                    <a href="${this.escapeHtml(s.url)}" target="_blank" rel="noopener" class="flex items-center gap-3 px-3 py-2 hover:bg-[#252525] transition-colors">
                        <img src="${favicon(s.domain)}" width="16" height="16" class="rounded-sm shrink-0" onerror="this.style.display='none'" />
                        <span class="text-[#999] text-[12px] truncate">${this.escapeHtml(s.domain)}</span>
                        <span class="text-[#555] text-[11px] truncate flex-1 text-right">${this.escapeHtml(s.url.replace('https://', ''))}</span>
                    </a>
                `).join('')}
            </div>
        `;

        // Insert before actions
        if (actions) {
            contentWrapper.insertBefore(sourcesBar, actions);
        } else {
            contentWrapper.appendChild(sourcesBar);
        }

        // Expand/collapse toggle
        const expandBtn = sourcesBar.querySelector('.sources-expand-btn');
        const expandedList = sourcesBar.querySelector('.sources-expanded');
        if (expandBtn && expandedList) {
            expandBtn.addEventListener('click', () => {
                const isHidden = expandedList.classList.contains('hidden');
                expandedList.classList.toggle('hidden');
                expandBtn.textContent = isHidden ? `−${hiddenSources.length}` : `+${hiddenSources.length}`;
            });
        }
    },

    // Show error in message
    showErrorInMessage(el, error) {
        const thinking = el.querySelector('.thinking-block');
        if (thinking) thinking.style.display = 'none';

        const contentEl = el.querySelector('.assistant-content');
        if (contentEl) {
            contentEl.innerHTML = `
                <div class="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" class="shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    <div>
                        <p class="text-red-400 text-[14px] font-medium mb-1">Error</p>
                        <p class="text-red-300/80 text-[13px]">${this.escapeHtml(error)}</p>
                    </div>
                </div>
            `;
        }
    },

    // Markdown renderer
    renderMarkdown(text) {
        if (!text) return '';
        let html = text;
        html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
            const langLabel = lang ? `<div class="text-[11px] text-[#666] px-4 py-1.5 bg-[#1a1a1a] border-b border-[#2a2a2a] font-mono">${lang}</div>` : '';
            return `<pre class="bg-[#0e0e0e] border border-[#2a2a2a] rounded-xl overflow-hidden my-3">${langLabel}<code class="block px-4 py-3 text-[13px] leading-relaxed overflow-x-auto font-mono text-[#e2e2e2]">${code.trim()}</code></pre>`;
        });
        html = html.replace(/`([^`]+)`/g, '<code class="bg-[#2a2a2a] text-[#e8b4b8] px-1.5 py-0.5 rounded text-[13px] font-mono">$1</code>');
        html = html.replace(/^#### (.+)$/gm, '<h4 class="text-white text-[15px] font-semibold mt-4 mb-2">$1</h4>');
        html = html.replace(/^### (.+)$/gm, '<h3 class="text-white text-[16px] font-semibold mt-5 mb-2">$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2 class="text-white text-[18px] font-bold mt-6 mb-3">$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1 class="text-white text-[20px] font-bold mt-6 mb-3">$1</h1>');
        html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em class="text-[#ccc]">$1</em>');
        html = html.replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 mb-1.5 text-[#d1d5db] list-decimal list-inside"><span>$2</span></li>');
        html = html.replace(/^[\-\*] (.+)$/gm, '<li class="flex items-start gap-2 mb-1.5 text-[#d1d5db]"><span class="text-[#555] mt-2 shrink-0">•</span><span>$1</span></li>');
        html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="border-l-2 border-[#444] pl-4 py-1 my-2 text-[#999] italic">$1</blockquote>');
        html = html.replace(/^---$/gm, '<hr class="border-[#2a2a2a] my-4" />');
        html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" class="text-[#5a9ae6] hover:underline">$1</a>');
        html = html.replace(/\n\n/g, '</p><p class="mb-3 text-[#d1d5db] leading-relaxed">');
        html = '<p class="mb-3 text-[#d1d5db] leading-relaxed">' + html + '</p>';
        html = html.replace(/<p class="mb-3 text-\[#d1d5db\] leading-relaxed"><\/p>/g, '');
        html = html.replace(/<p class="mb-3 text-\[#d1d5db\] leading-relaxed">(<(?:h[1-4]|pre|li|blockquote|hr))/g, '$1');
        html = html.replace(/(<\/(?:h[1-4]|pre|li|blockquote)>)<\/p>/g, '$1');
        return html;
    },

    getModelIcon(model) {
        const icons = {
            'Claude Sonnet 4.5': '<img src="https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/dark/claude-color.png" width="18" height="18" />',
            'Gemini 3 Pro': '<img src="https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/dark/gemini-color.png" width="18" height="18" />',
            'GPT-5.1': '<img src="https://img.icons8.com/ios11/512/FFFFFF/chatgpt.png" width="18" height="18" />',
            'GPT-5.2': '<img src="https://img.icons8.com/ios11/512/FFFFFF/chatgpt.png" width="18" height="18" />'
        };
        return icons[model] || '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.8"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v4"></path><path d="M12 18v4"></path></svg>';
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    scrollToBottom() {
        // Scroll the scrollable container (not the inner content div)
        const target = this.scrollContainer || this.chatContainer;
        if (target) {
            target.scrollTop = target.scrollHeight;
        }
    },

    // Build a single chat entry HTML
    _chatEntryHTML(chat) {
        return `<div class="chat-entry group flex items-center py-2 px-3 rounded-lg hover:bg-[#232323] transition-colors cursor-pointer relative" data-chat-id="${chat.id}">
            <a href="index.html?chat=${chat.id}" class="flex-1 min-w-0 text-[#e0e0e0] group-hover:text-white text-[14px] truncate" style="text-decoration:none;">${this.escapeHtml(chat.title)}</a>
            <div class="flex items-center gap-0.5 shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button class="chat-rename-btn p-1 text-[#666] hover:text-white rounded transition-colors" title="Rename">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                </button>
                <button class="chat-delete-btn p-1 text-[#666] hover:text-red-500 rounded transition-colors" title="Delete">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        </div>`;
    },

    // Wire up events on chat entries
    _wireChatEntryEvents(container) {
        // Rename buttons
        container.querySelectorAll('.chat-rename-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const entry = btn.closest('.chat-entry');
                const chatId = entry.dataset.chatId;
                this._showRenamePopup(chatId, entry);
            });
        });

        // Delete buttons
        container.querySelectorAll('.chat-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const chatId = btn.closest('.chat-entry').dataset.chatId;
                this._deleteChat(chatId);
            });
        });

        // Right-click context menu
        container.querySelectorAll('.chat-entry').forEach(entry => {
            entry.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const chatId = entry.dataset.chatId;
                this._showContextMenu(e.clientX, e.clientY, chatId, entry);
            });
        });
    },

    // Context menu on right-click
    _showContextMenu(x, y, chatId, entry) {
        // Remove any existing context menu
        document.getElementById('chat-context-menu')?.remove();

        const menu = document.createElement('div');
        menu.id = 'chat-context-menu';
        menu.style.cssText = `position:fixed; left:${x}px; top:${y}px; z-index:10000; background:#2a2a2a; border:1px solid #3e3e3e; border-radius:12px; padding:4px; box-shadow:0 12px 40px rgba(0,0,0,0.6); min-width:160px;`;
        menu.innerHTML = `
            <button class="ctx-rename w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#353535] transition-colors text-left">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                <span class="text-[#e0e0e0] text-[13px]">Rename</span>
            </button>
            <button class="ctx-delete w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#353535] transition-colors text-left">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                <span class="text-red-400 text-[13px]">Delete</span>
            </button>
        `;

        // Keep menu within viewport
        document.body.appendChild(menu);
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

        menu.querySelector('.ctx-rename').addEventListener('click', () => {
            menu.remove();
            this._showRenamePopup(chatId, entry);
        });
        menu.querySelector('.ctx-delete').addEventListener('click', () => {
            menu.remove();
            this._deleteChat(chatId);
        });

        // Close on click outside
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    },

    // Rename popup (inline or modal)
    _showRenamePopup(chatId, entry) {
        const chats = RetracChatHistory.getAll();
        const chat = chats.find(c => c.id === chatId);
        if (!chat) return;

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:20000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:16px;padding:24px;width:360px;box-shadow:0 20px 50px rgba(0,0,0,0.5);">
                <p style="color:white;font-size:15px;font-weight:600;margin-bottom:16px;">Rename Chat</p>
                <input type="text" class="rename-input" value="${this.escapeHtml(chat.title)}" style="width:100%;background:#0e0e0e;border:1px solid #2a2a2a;border-radius:10px;padding:10px 14px;color:white;font-size:14px;outline:none;box-sizing:border-box;margin-bottom:16px;" />
                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button class="cancel-btn" style="background:#2a2a2a;color:white;border:none;border-radius:10px;padding:8px 20px;font-size:13px;cursor:pointer;">Cancel</button>
                    <button class="save-btn" style="background:#2D8CFF;color:white;border:none;border-radius:10px;padding:8px 20px;font-size:13px;cursor:pointer;">Save</button>
                </div>
            </div>
        `;

        const input = overlay.querySelector('.rename-input');
        overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        overlay.querySelector('.save-btn').addEventListener('click', () => {
            const newTitle = input.value.trim();
            if (!newTitle) return;
            chat.title = newTitle;
            RetracChatHistory.save(chats);
            this.updateSidebarHistory();
            overlay.remove();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') overlay.querySelector('.save-btn').click();
            if (e.key === 'Escape') overlay.remove();
        });

        document.body.appendChild(overlay);
        input.focus();
        input.select();
    },

    // Delete chat
    _deleteChat(chatId) {
        RetracChatHistory.deleteChat(chatId);

        // If we just deleted the current chat, reset
        if (this.currentChat && this.currentChat.id === chatId) {
            this.newChat();
            // Show welcome view if available
            const welcomeView = document.getElementById('welcome-view');
            const chatOuter = document.getElementById('chat-messages');
            if (welcomeView) welcomeView.style.display = '';
            if (chatOuter) chatOuter.classList.add('hidden');
        }

        this.updateSidebarHistory();
    },

    updateSidebarHistory() {
        const historyContainer = document.getElementById('chat-history-container') || document.querySelector('.sidebar-hide.mt-6');
        if (!historyContainer) return;

        const chats = RetracChatHistory.getAll();
        const today = [], yesterday = [], older = [];
        const now = Date.now(), dayMs = 86400000;

        for (const chat of chats) {
            const age = now - chat.createdAt;
            if (age < dayMs) today.push(chat);
            else if (age < dayMs * 2) yesterday.push(chat);
            else older.push(chat);
        }

        let html = '';
        if (today.length > 0) {
            html += '<p class="text-[#666] text-[12px] font-medium mb-2 px-3">Today</p>';
            html += today.map(c => this._chatEntryHTML(c)).join('');
        }
        if (yesterday.length > 0) {
            html += '<p class="text-[#666] text-[12px] font-medium mb-2 mt-4 px-3">Yesterday</p>';
            html += yesterday.map(c => this._chatEntryHTML(c)).join('');
        }
        if (older.length > 0) {
            html += '<p class="text-[#666] text-[12px] font-medium mb-2 mt-4 px-3">Previous</p>';
            html += older.slice(0, 10).map(c => this._chatEntryHTML(c)).join('');
        }
        if (!html) html = '<p class="text-[#555] text-[13px] px-3">No chats yet</p>';
        historyContainer.innerHTML = html;

        // Wire up events on the new entries
        this._wireChatEntryEvents(historyContainer);
    },

    newChat() {
        this.currentChat = null;
        sessionStorage.removeItem('retrac_current_chat_id');
        if (this.chatContainer) {
            this.chatContainer.innerHTML = '';
        }
        if (this.textarea) {
            this.textarea.value = '';
            this.textarea.focus();
        }
    }
};
