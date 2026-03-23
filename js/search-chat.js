// ============ Search Chat Popup (shared across all pages) ============

const RetracSearchChat = {
    _injected: false,

    inject() {
        if (this._injected) return;
        this._injected = true;

        const wrapper = document.createElement('div');
        wrapper.id = 'search-chat-root';
        wrapper.innerHTML = `
            <div id="search-backdrop" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px); z-index:9998;"></div>
            <div id="search-popup" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:9999; width:600px; max-height:70vh; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:16px; box-shadow:0 25px 50px rgba(0,0,0,0.5); overflow:hidden; flex-direction:column;">
                <div style="display:flex; align-items:center; padding:16px 20px; border-bottom:1px solid #2a2a2a;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" style="flex-shrink:0;">
                        <circle cx="11" cy="11" r="8"></circle>
                        <path d="M21 21l-4.3-4.3"></path>
                    </svg>
                    <input id="search-chat-input" type="text" placeholder="Search..." style="flex:1; background:transparent; border:none; outline:none; color:white; font-size:16px; padding:0 12px; font-family:inherit;" />
                    <button id="search-chat-close" style="background:none; border:none; cursor:pointer; color:#666; padding:4px;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div id="search-chat-results" style="flex:1; overflow-y:auto; padding:16px 8px;">
                    <p style="padding:4px 12px 8px; font-size:12px; color:#666; font-weight:600;">Actions</p>
                    <a href="index.html" class="search-chat-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#252525] transition-colors text-left" style="display:flex; text-decoration:none;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.8">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        <span style="color:white; font-size:14px; font-weight:500;">Create New Chat</span>
                    </a>
                    <div id="search-chat-history"></div>
                </div>
            </div>
        `;
        document.body.appendChild(wrapper);

        this._setupEvents();
        this._renderHistory();
    },

    open() {
        this.inject();
        this._renderHistory();
        document.getElementById('search-backdrop').style.display = 'block';
        document.getElementById('search-popup').style.display = 'flex';
        const input = document.getElementById('search-chat-input');
        input.value = '';
        input.focus();
    },

    close() {
        document.getElementById('search-backdrop').style.display = 'none';
        document.getElementById('search-popup').style.display = 'none';
    },

    _setupEvents() {
        document.getElementById('search-chat-close').addEventListener('click', () => this.close());
        document.getElementById('search-backdrop').addEventListener('click', () => this.close());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.getElementById('search-popup')?.style.display === 'flex') {
                this.close();
            }
        });

        document.getElementById('search-chat-input').addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            document.querySelectorAll('.search-chat-item').forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(query) ? '' : 'none';
            });
        });
    },

    _renderHistory() {
        const container = document.getElementById('search-chat-history');
        if (!container) return;

        let chats = [];
        try {
            chats = JSON.parse(localStorage.getItem('retrac_chats') || '[]');
        } catch (e) {}

        if (chats.length === 0) {
            container.innerHTML = `
                <p style="padding:16px 12px 8px; font-size:12px; color:#666; font-weight:600;">Today</p>
                <a href="index.html" class="search-chat-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#252525] transition-colors text-left" style="display:flex; text-decoration:none;">
                    <span style="color:white; font-size:14px;">General Chat</span>
                </a>
            `;
            return;
        }

        const now = Date.now();
        const dayMs = 86400000;
        const today = chats.filter(c => now - c.createdAt < dayMs);
        const older = chats.filter(c => now - c.createdAt >= dayMs);

        let html = '';
        if (today.length > 0) {
            html += '<p style="padding:16px 12px 8px; font-size:12px; color:#666; font-weight:600;">Today</p>';
            html += today.map(c => `
                <a href="index.html?chat=${c.id}" class="search-chat-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#252525] transition-colors" style="display:flex; text-decoration:none;">
                    <span style="color:white; font-size:14px;">${this._escapeHtml(c.title)}</span>
                </a>
            `).join('');
        }
        if (older.length > 0) {
            html += '<p style="padding:16px 12px 8px; font-size:12px; color:#666; font-weight:600;">Previous</p>';
            html += older.slice(0, 20).map(c => `
                <a href="index.html?chat=${c.id}" class="search-chat-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#252525] transition-colors" style="display:flex; text-decoration:none;">
                    <span style="color:white; font-size:14px;">${this._escapeHtml(c.title)}</span>
                </a>
            `).join('');
        }
        if (!html) {
            html = '<p style="padding:16px 12px 8px; font-size:12px; color:#666; font-weight:600;">Today</p><a href="index.html" class="search-chat-item" style="display:flex; text-decoration:none; padding:8px 12px;"><span style="color:white; font-size:14px;">General Chat</span></a>';
        }
        container.innerHTML = html;
    },

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
