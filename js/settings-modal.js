// ============ Retrac Settings Modal ============
// Preferences only — API keys are managed server-side via .env

const RetracSettingsModal = {
    _injected: false,

    inject() {
        if (this._injected) return;
        this._injected = true;

        const modal = document.createElement('div');
        modal.id = 'settings-modal-root';
        modal.innerHTML = `
            <!-- Backdrop -->
            <div id="settings-backdrop" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px); z-index:10000;"></div>
            <!-- Modal -->
            <div id="settings-modal" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:10001; width:480px; max-height:85vh; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:20px; box-shadow:0 25px 60px rgba(0,0,0,0.6); overflow:hidden; flex-direction:column;">
                <!-- Header -->
                <div style="display:flex; align-items:center; justify-content:space-between; padding:20px 24px 16px; border-bottom:1px solid #2a2a2a;">
                    <h2 style="color:white; font-size:18px; font-weight:600; margin:0;">Settings</h2>
                    <button id="settings-close" style="background:none; border:none; cursor:pointer; color:#666; padding:4px; border-radius:8px;" onmouseover="this.style.color='white'" onmouseout="this.style.color='#666'">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>

                <!-- Content -->
                <div style="padding:20px 24px; overflow-y:auto; max-height:calc(85vh - 70px);">
                    <!-- Preferences -->
                    <div>
                        <p style="color:#888; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:16px;">Preferences</p>

                        <!-- Default Model -->
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
                            <span style="color:white; font-size:14px;">Default Model</span>
                            <select id="settings-default-model" style="background:#0e0e0e; border:1px solid #2a2a2a; border-radius:10px; padding:8px 12px; color:white; font-size:13px; outline:none; cursor:pointer;">
                                <option value="Claude Sonnet 4.5">Claude Sonnet 4.5</option>
                                <option value="Gemini 3 Pro">Gemini 3 Pro</option>
                                <option value="GPT-5.1">GPT-5.1</option>
                                <option value="GPT-5.2">GPT-5.2</option>
                            </select>
                        </div>

                        <!-- Streaming -->
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
                            <span style="color:white; font-size:14px;">Stream responses</span>
                            <div id="settings-streaming-toggle" class="settings-toggle on" style="width:40px; height:24px; background:#3b82f6; border-radius:20px; position:relative; cursor:pointer; transition:background 0.2s;">
                                <div style="width:20px; height:20px; background:white; border-radius:50%; position:absolute; top:2px; left:2px; transition:transform 0.2s; transform:translateX(16px);"></div>
                            </div>
                        </div>

                        <!-- Chat History -->
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
                            <span style="color:white; font-size:14px;">Save chat history</span>
                            <div id="settings-history-toggle" class="settings-toggle on" style="width:40px; height:24px; background:#3b82f6; border-radius:20px; position:relative; cursor:pointer; transition:background 0.2s;">
                                <div style="width:20px; height:20px; background:white; border-radius:50%; position:absolute; top:2px; left:2px; transition:transform 0.2s; transform:translateX(16px);"></div>
                            </div>
                        </div>
                    </div>

                    <div style="height:1px; background:#2a2a2a; margin:20px 0;"></div>

                    <!-- Data -->
                    <div>
                        <p style="color:#888; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:16px;">Data</p>
                        <button id="settings-clear-chats" style="background:#1e1e1e; border:1px solid #2a2a2a; color:#ef4444; border-radius:10px; padding:8px 16px; font-size:13px; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='#2a1515'" onmouseout="this.style.background='#1e1e1e'">Clear All Chats</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        this._setupEvents();
    },

    open() {
        this.inject();
        // Load saved default model
        const defModel = RetracSettings.get('default_model');
        if (defModel) {
            const sel = document.getElementById('settings-default-model');
            if (sel) sel.value = defModel;
        }
        document.getElementById('settings-backdrop').style.display = 'block';
        document.getElementById('settings-modal').style.display = 'flex';
    },

    close() {
        document.getElementById('settings-backdrop').style.display = 'none';
        document.getElementById('settings-modal').style.display = 'none';
    },

    _setupEvents() {
        document.getElementById('settings-close').addEventListener('click', () => this.close());
        document.getElementById('settings-backdrop').addEventListener('click', () => this.close());

        // Default model
        document.getElementById('settings-default-model').addEventListener('change', (e) => {
            RetracSettings.set('default_model', e.target.value);
        });

        // Toggles
        document.querySelectorAll('.settings-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                const dot = toggle.querySelector('div');
                const isOn = toggle.classList.contains('on');
                if (isOn) {
                    toggle.classList.remove('on');
                    toggle.style.background = '#4a4a4a';
                    dot.style.transform = 'translateX(0)';
                } else {
                    toggle.classList.add('on');
                    toggle.style.background = '#3b82f6';
                    dot.style.transform = 'translateX(16px)';
                }
            });
        });

        // Clear chats
        document.getElementById('settings-clear-chats').addEventListener('click', () => {
            this._showConfirm('Clear all chat history?', () => {
                RetracChatHistory.clearAll();
                if (typeof RetracChatUI !== 'undefined') {
                    RetracChatUI.newChat();
                    RetracChatUI.updateSidebarHistory();
                }
            });
        });
    },

    // Custom styled confirm dialog
    _showConfirm(message, onConfirm) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:20000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:16px;padding:24px;width:360px;box-shadow:0 20px 50px rgba(0,0,0,0.5);">
                <p style="color:white;font-size:15px;margin-bottom:20px;">${message}</p>
                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button class="confirm-cancel" style="background:#2a2a2a;color:white;border:none;border-radius:10px;padding:8px 20px;font-size:13px;cursor:pointer;">Cancel</button>
                    <button class="confirm-ok" style="background:#ef4444;color:white;border:none;border-radius:10px;padding:8px 20px;font-size:13px;cursor:pointer;">Confirm</button>
                </div>
            </div>
        `;
        overlay.querySelector('.confirm-cancel').addEventListener('click', () => overlay.remove());
        overlay.querySelector('.confirm-ok').addEventListener('click', () => {
            onConfirm();
            overlay.remove();
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }
};
