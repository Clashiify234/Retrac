// ============ Retrac Auth Modal ============
// Shared auth modal that works on ALL pages
// Shows sign-in/sign-up popup when non-logged-in users click any button

const RetracAuth = (() => {
    // Auth helpers
    function getUsers() {
        return JSON.parse(localStorage.getItem('retrac_users') || '{}');
    }
    function saveUsers(users) {
        localStorage.setItem('retrac_users', JSON.stringify(users));
    }
    function getCurrentUser() {
        return JSON.parse(localStorage.getItem('retrac_current_user') || 'null');
    }
    function setCurrentUser(user) {
        localStorage.setItem('retrac_current_user', JSON.stringify(user));
    }
    function logoutUser() {
        localStorage.removeItem('retrac_current_user');
        location.reload();
    }
    function checkEmailExists(email) {
        return !!getUsers()[email];
    }
    function registerUser(email, password) {
        const users = getUsers();
        if (users[email]) return { error: 'Account already exists.' };
        users[email] = { email, password, createdAt: Date.now() };
        saveUsers(users);
        setCurrentUser({ email });
        return { error: null };
    }
    function loginUser(email, password) {
        const users = getUsers();
        if (!users[email]) return { error: 'No account found with this email.' };
        if (users[email].password !== password) return { error: 'Wrong password. Please try again.' };
        setCurrentUser({ email });
        return { error: null };
    }

    let authMode = 'login';
    let currentEmail = '';
    let _injected = false;

    function injectModal() {
        if (_injected) return;
        // Don't inject if we're on index.html (it has its own modal)
        if (document.getElementById('ghost-backdrop') && document.getElementById('ghost-card')) {
            _injected = true;
            _bindExisting();
            return;
        }
        _injected = true;

        // Inject backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'ghost-backdrop';
        backdrop.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px); z-index:9998;';
        document.body.appendChild(backdrop);

        // Inject card
        const card = document.createElement('div');
        card.id = 'ghost-card';
        card.style.cssText = 'display:none; position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:9999; background:#0e0e0e; border:1px solid #222; border-radius:24px; box-shadow:0 25px 50px rgba(0,0,0,0.5); overflow:hidden; max-height:90vh;';
        card.innerHTML = `
            <button id="ghost-close" style="position:absolute; top:16px; right:16px; background:none; border:none; cursor:pointer; color:#888; z-index:10;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <div style="display:flex; width:1050px; height:700px;">
                <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px; overflow-y:auto; border-right:1px solid #222;">
                    <div style="display:flex; flex-direction:column; align-items:center; margin-bottom:24px;">
                        <div style="text-align:center;">
                            <p style="color:#aaa; font-size:15px; font-weight:500;">#1</p>
                            <p style="color:#aaa; font-size:18px;">AI Chatbot</p>
                            <div style="display:flex; gap:2px; justify-content:center;"><span style="color:#facc15; font-size:18px;">★★★★★</span></div>
                            <p style="color:white; font-size:28px; font-weight:bold;">35M+ users</p>
                        </div>
                    </div>
                    <p style="color:#888; font-size:13px; margin-bottom:4px;">Available on</p>
                    <div style="width:1px; height:16px; background:#333; margin-bottom:8px;"></div>
                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:32px;">
                        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Google_%22G%22_logo.svg/120px-Google_%22G%22_logo.svg.png" width="32" height="32" style="border-radius:8px;" />
                        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Firefox_logo%2C_2019.svg/120px-Firefox_logo%2C_2019.svg.png" width="32" height="32" style="border-radius:8px;" />
                        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Safari_browser_logo.svg/120px-Safari_browser_logo.svg.png" width="32" height="32" style="border-radius:8px;" />
                    </div>
                    <h2 style="color:white; font-size:20px; font-weight:bold; margin-top:24px; margin-bottom:24px;">Trusted by Millions</h2>
                    <div style="width:100%; overflow:hidden; mask-image:linear-gradient(to right, transparent, black 5%, black 95%, transparent);">
                        <div class="auth-carousel-track" style="display:flex; gap:16px; width:max-content; animation: authCarouselScroll 30s linear infinite;">
                            ${_generateReviewCards()}
                        </div>
                    </div>
                </div>
                <div style="width:420px; flex-shrink:0; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:48px;">
                    <div id="auth-signup-view">
                        <p style="color:#888; font-size:13px; margin-bottom:16px; text-align:center;">Powered By</p>
                        <div style="display:flex; align-items:center; gap:32px; background:#1e1e1e; border:1px solid #333; border-radius:12px; padding:20px 40px; margin-bottom:32px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <img src="https://img.icons8.com/ios11/512/FFFFFF/chatgpt.png" width="22" height="22" />
                                <span style="color:white; font-size:15px;">OpenAI</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <img src="https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/dark/claude-color.png" width="22" height="22" />
                                <span style="color:white; font-size:15px;">Anthropic</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <img src="https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/dark/gemini-color.png" width="22" height="22" />
                                <span style="color:white; font-size:15px;">Google</span>
                            </div>
                        </div>
                        <h2 style="color:white; font-size:26px; font-weight:bold; text-align:center; line-height:1.3; margin-bottom:32px;">Join Millions of<br>Happy Users</h2>
                        <button id="google-login-btn" style="width:100%; display:flex; align-items:center; justify-content:center; gap:8px; background:white; color:black; font-weight:500; padding:14px; border-radius:12px; margin-bottom:16px; border:none; cursor:pointer; font-size:14px;">
                            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                            Continue with Google
                        </button>
                        <button id="apple-login-btn" style="width:100%; display:flex; align-items:center; justify-content:center; gap:8px; background:#1e1e1e; color:white; border:1px solid #333; font-weight:500; padding:14px; border-radius:12px; margin-bottom:24px; cursor:pointer; font-size:14px;">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                            Continue with Apple
                        </button>
                        <div style="display:flex; align-items:center; gap:12px; width:100%; margin-bottom:24px;">
                            <div style="flex:1; height:1px; background:#333;"></div>
                            <span style="color:#666; font-size:13px;">or</span>
                            <div style="flex:1; height:1px; background:#333;"></div>
                        </div>
                        <input id="ghost-email-input" type="email" placeholder="Enter your email" style="width:100%; background:#1e1e1e; border:1px solid #333; color:white; border-radius:12px; padding:14px 20px; font-size:14px; outline:none; margin-bottom:16px; box-sizing:border-box;" />
                        <button id="ghost-email-btn" style="width:100%; display:flex; align-items:center; justify-content:center; gap:8px; background:#1e1e1e; color:white; border:1px solid #333; font-weight:500; padding:14px; border-radius:12px; margin-bottom:32px; cursor:pointer; font-size:14px;">
                            <img src="image.png" width="18" height="18" alt="Email" style="filter: invert(1);" onerror="this.style.display='none'" />
                            Continue with Email
                        </button>
                        <p style="color:#666; font-size:11px; text-align:center; line-height:1.6;">By proceeding, you agree to our <span style="text-decoration:underline; cursor:pointer;">Terms of Service</span> and acknowledge that you have read our <span style="text-decoration:underline; cursor:pointer;">Privacy Policy</span>.</p>
                    </div>
                    <div id="auth-password-view" style="display:none; width:100%;">
                        <p style="color:#888; font-size:13px; margin-bottom:16px; text-align:center;">Powered By</p>
                        <div style="display:flex; align-items:center; justify-content:center; gap:32px; background:#1e1e1e; border:1px solid #333; border-radius:12px; padding:20px 40px; margin-bottom:32px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <img src="https://img.icons8.com/ios11/512/FFFFFF/chatgpt.png" width="22" height="22" />
                                <span style="color:white; font-size:15px;">OpenAI</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <img src="https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/dark/claude-color.png" width="22" height="22" />
                                <span style="color:white; font-size:15px;">Anthropic</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <img src="https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/dark/gemini-color.png" width="22" height="22" />
                                <span style="color:white; font-size:15px;">Google</span>
                            </div>
                        </div>
                        <h2 style="color:white; font-size:26px; font-weight:bold; text-align:center; line-height:1.3; margin-bottom:32px;">Join Millions of<br>Happy Users</h2>
                        <p style="color:#ccc; font-size:13px; font-weight:600; margin-bottom:8px;">Email address</p>
                        <input id="ghost-email-display" type="email" readonly style="width:100%; background:#1e1e1e; border:1px solid #333; color:white; border-radius:12px; padding:14px 20px; font-size:14px; outline:none; margin-bottom:20px; box-sizing:border-box;" />
                        <p style="color:#ccc; font-size:13px; font-weight:600; margin-bottom:8px;">Password</p>
                        <div style="position:relative; width:100%;" id="ghost-pw-wrapper">
                            <input id="ghost-password" type="password" placeholder="Password" style="width:100%; background:#1e1e1e; border:1px solid #333; color:white; border-radius:12px; padding:14px 20px; font-size:14px; outline:none; box-sizing:border-box; padding-right:48px;" />
                            <button id="ghost-toggle-pw" style="position:absolute; right:16px; top:50%; transform:translateY(-50%); background:none; border:none; color:#666; cursor:pointer;" type="button">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                            </button>
                        </div>
                        <div id="ghost-pw-hints" style="display:none; margin-top:12px; margin-bottom:24px;">
                            <p id="pw-hint-empty" style="display:flex; align-items:center; gap:8px; font-size:13px; color:#f87171; margin-bottom:4px;">
                                <span>✕</span> Password can't be empty.
                            </p>
                            <p id="pw-hint-length" style="display:flex; align-items:center; gap:8px; font-size:13px; color:#f87171;">
                                <span>✕</span> Must be at least 6 characters
                            </p>
                        </div>
                        <div id="ghost-pw-spacer" style="margin-bottom:32px;"></div>
                        <p id="ghost-auth-error" style="display:none; color:#f87171; font-size:12px; text-align:center; margin-bottom:16px;"></p>
                        <button id="ghost-continue-btn" style="width:100%; background:white; color:black; font-weight:500; padding:14px; border-radius:12px; margin-bottom:24px; border:none; cursor:pointer; font-size:14px;">Continue</button>
                        <p id="ghost-forgot-pw" style="text-align:center; margin-bottom:32px;"><a href="#" style="color:#888; font-size:13px; text-decoration:none;">Forgot password</a></p>
                        <p style="text-align:center;"><a href="#" id="ghost-back-signup" style="color:#888; font-size:13px; text-decoration:none;">Already have an account? Log in</a></p>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(card);

        // Add carousel animation
        if (!document.getElementById('auth-carousel-style')) {
            const style = document.createElement('style');
            style.id = 'auth-carousel-style';
            style.textContent = `
                @keyframes authCarouselScroll {
                    0% { transform: translateX(0); }
                    100% { transform: translateX(-50%); }
                }
            `;
            document.head.appendChild(style);
        }

        _bindEvents();
    }

    function _generateReviewCards() {
        const reviews = [
            { name: 'Emma Taylor', role: 'Product Manager', title: 'Super user friendly', text: "This is the most user-friendly AI app I've used so far. Love it for any question I have.", img: 1 },
            { name: 'Noah Johnson', role: 'Content Writer', title: 'The perfect all-in-one app!', text: 'It is crazy how complex and intelligent this is, but also how excellent the feedback inspires or help you.', img: 11 },
            { name: 'Liam Smith', role: 'Digital Marketer', title: 'Loving the AI', text: "So personalized and so fast! I'm loving how this AI app responds to anything immediately.", img: 12 },
            { name: 'Sophia Brown', role: 'Customer Support', title: 'Perfect AI Tool', text: "It's a great time-saver to access all the latest AI models through a simple interface.", img: 5 },
            { name: 'William Davis', role: 'Software Developer', title: 'Very Cool', text: 'It is an amazing app for generating fun and useful content and creating great ideas!', img: 14 },
        ];
        const cardHTML = (r) => `
            <div style="width:220px; flex-shrink:0; background:#141414; border:1px solid #222; border-radius:12px; padding:20px; display:flex; flex-direction:column;">
                <p style="color:white; font-weight:600; font-size:13px; margin-bottom:4px;">${r.title}</p>
                <div style="margin-bottom:6px;"><span style="color:#facc15; font-size:11px;">★★★★★</span></div>
                <p style="color:#888; font-size:11px; line-height:1.5; flex:1;">${r.text}</p>
                <div style="display:flex; align-items:center; gap:8px; margin-top:12px;">
                    <img src="https://i.pravatar.cc/48?img=${r.img}" style="width:24px; height:24px; border-radius:50%; object-fit:cover;" />
                    <div><p style="color:white; font-size:11px; font-weight:500;">${r.name}</p><p style="color:#555; font-size:9px;">${r.role}</p></div>
                </div>
            </div>`;
        return reviews.map(cardHTML).join('') + reviews.map(cardHTML).join('');
    }

    function _bindExisting() {
        // index.html already has the modal, just set up the global click interceptor
        _setupGlobalClickGuard();
    }

    function _bindEvents() {
        const ghostBackdrop = document.getElementById('ghost-backdrop');
        const ghostCard = document.getElementById('ghost-card');
        const signupView = document.getElementById('auth-signup-view');
        const passwordView = document.getElementById('auth-password-view');
        const ghostEmailInput = document.getElementById('ghost-email-input');
        const ghostEmailDisplay = document.getElementById('ghost-email-display');
        const ghostPassword = document.getElementById('ghost-password');
        const ghostPwHints = document.getElementById('ghost-pw-hints');
        const ghostPwSpacer = document.getElementById('ghost-pw-spacer');
        const ghostForgotPw = document.getElementById('ghost-forgot-pw');
        const ghostAuthError = document.getElementById('ghost-auth-error');
        const ghostContinueBtn = document.getElementById('ghost-continue-btn');
        const ghostBackBtn = document.getElementById('ghost-back-signup');
        const pwHintEmpty = document.getElementById('pw-hint-empty');
        const pwHintLength = document.getElementById('pw-hint-length');

        function closePopup() {
            ghostBackdrop.style.display = 'none';
            ghostCard.style.display = 'none';
            if (passwordView) passwordView.style.display = 'none';
            if (signupView) signupView.style.display = 'block';
            if (ghostEmailInput) ghostEmailInput.value = '';
            if (ghostPassword) ghostPassword.value = '';
            if (ghostAuthError) ghostAuthError.style.display = 'none';
            if (ghostPassword) {
                ghostPassword.style.borderColor = '#333';
            }
        }

        document.getElementById('ghost-close')?.addEventListener('click', closePopup);
        ghostBackdrop?.addEventListener('click', closePopup);

        function showPasswordView(mode) {
            authMode = mode;
            signupView.style.display = 'none';
            passwordView.style.display = 'block';
            ghostPassword.value = '';
            ghostAuthError.style.display = 'none';
            ghostPassword.style.borderColor = '#333';

            if (mode === 'register') {
                ghostPwHints.style.display = 'block';
                ghostPwSpacer.style.display = 'none';
                ghostForgotPw.style.display = 'none';
                ghostBackBtn.textContent = 'Already have an account? Log in';
            } else {
                ghostPwHints.style.display = 'none';
                ghostPwSpacer.style.display = 'block';
                ghostForgotPw.style.display = 'block';
                ghostBackBtn.textContent = "Don't have an account? Sign up";
            }
            ghostPassword.focus();
        }

        // Email continue
        document.getElementById('ghost-email-btn')?.addEventListener('click', () => {
            const email = ghostEmailInput.value.trim();
            if (!email || !email.includes('@')) return;
            currentEmail = email;
            ghostEmailDisplay.value = email;
            showPasswordView(checkEmailExists(email) ? 'login' : 'register');
        });

        ghostEmailInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('ghost-email-btn')?.click();
        });

        // Password hints
        ghostPassword?.addEventListener('input', () => {
            if (authMode !== 'register') return;
            const pw = ghostPassword.value;
            if (pw.length > 0) {
                pwHintEmpty.style.color = '#4ade80';
                pwHintEmpty.querySelector('span').textContent = '✓';
            } else {
                pwHintEmpty.style.color = '#f87171';
                pwHintEmpty.querySelector('span').textContent = '✕';
            }
            if (pw.length >= 6) {
                pwHintLength.style.color = '#4ade80';
                pwHintLength.querySelector('span').textContent = '✓';
            } else {
                pwHintLength.style.color = '#f87171';
                pwHintLength.querySelector('span').textContent = '✕';
            }
            ghostPassword.style.borderColor = (pw.length > 0 && pw.length < 6) ? '#ef4444' : '#333';
        });

        // Toggle password visibility
        document.getElementById('ghost-toggle-pw')?.addEventListener('click', () => {
            ghostPassword.type = ghostPassword.type === 'password' ? 'text' : 'password';
        });

        // Continue (login or register)
        ghostContinueBtn?.addEventListener('click', () => {
            const pw = ghostPassword.value;
            ghostAuthError.style.display = 'none';

            if (!pw) {
                ghostAuthError.textContent = 'Please enter a password.';
                ghostAuthError.style.display = 'block';
                return;
            }
            if (authMode === 'register' && pw.length < 6) {
                ghostAuthError.textContent = 'Password must be at least 6 characters.';
                ghostAuthError.style.display = 'block';
                return;
            }

            let result;
            if (authMode === 'login') {
                result = loginUser(currentEmail, pw);
            } else {
                result = registerUser(currentEmail, pw);
            }

            if (result.error) {
                ghostAuthError.textContent = result.error;
                ghostAuthError.style.display = 'block';
                if (result.error.includes('already exists')) {
                    showPasswordView('login');
                    ghostPassword.value = pw;
                }
            } else {
                closePopup();
                location.reload();
            }
        });

        ghostPassword?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') ghostContinueBtn?.click();
        });

        ghostBackBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            showPasswordView(authMode === 'register' ? 'login' : 'register');
        });

        _setupGlobalClickGuard();
    }

    function _setupGlobalClickGuard() {
        // Global click interceptor: if not logged in, show auth modal for any interactive click
        document.addEventListener('click', (e) => {
            if (getCurrentUser()) return; // Logged in, allow everything

            const target = e.target;

            // Allow clicks on the auth modal itself
            if (target.closest('#ghost-card') || target.closest('#ghost-backdrop')) return;
            // Allow clicks on the verification popup
            if (target.closest('#verify-popup') || target.closest('#verify-backdrop')) return;

            // Check if the click is on an interactive element
            const interactive = target.closest('button, a, input, textarea, select, [role="button"], .create-card, .model-option, .add-doc-opt, .filter-opt, .sort-opt, .sidebar-nav-link');

            if (interactive) {
                // Allow sidebar page navigation links (actual href navigation)
                if (interactive.tagName === 'A') {
                    const href = interactive.getAttribute('href');
                    if (href && href !== '#' && !href.startsWith('javascript:')) {
                        // Real navigation link — allow it
                        return;
                    }
                }

                e.preventDefault();
                e.stopPropagation();
                showModal();
            }
        }, true); // Use capture phase to intercept before other handlers
    }

    function showModal() {
        const ghostBackdrop = document.getElementById('ghost-backdrop');
        const ghostCard = document.getElementById('ghost-card');
        if (ghostBackdrop) ghostBackdrop.style.display = 'block';
        if (ghostCard) ghostCard.style.display = 'block';
    }

    function requireAuth() {
        if (!getCurrentUser()) {
            showModal();
            return false;
        }
        return true;
    }

    // Auto-inject on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectModal);
    } else {
        injectModal();
    }

    // Expose globally
    window.getCurrentUser = getCurrentUser;
    window.setCurrentUser = setCurrentUser;
    window.logoutUser = logoutUser;
    window.requireAuth = requireAuth;
    window.checkEmailExists = checkEmailExists;
    window.registerUser = registerUser;
    window.loginUser = loginUser;
    window.getUsers = getUsers;
    window.saveUsers = saveUsers;
    window.closeGhostPopup = function() {
        const ghostBackdrop = document.getElementById('ghost-backdrop');
        const ghostCard = document.getElementById('ghost-card');
        const signupView = document.getElementById('auth-signup-view');
        const passwordView = document.getElementById('auth-password-view');
        const ghostEmailInput = document.getElementById('ghost-email-input');
        const ghostPassword = document.getElementById('ghost-password');
        const ghostAuthError = document.getElementById('ghost-auth-error');
        if (ghostBackdrop) ghostBackdrop.style.display = 'none';
        if (ghostCard) ghostCard.style.display = 'none';
        if (passwordView) passwordView.style.display = 'none';
        if (signupView) signupView.style.display = 'block';
        if (ghostEmailInput) ghostEmailInput.value = '';
        if (ghostPassword) {
            ghostPassword.value = '';
            ghostPassword.style.borderColor = '#333';
        }
        if (ghostAuthError) ghostAuthError.style.display = 'none';
    };

    return {
        getCurrentUser,
        setCurrentUser,
        logoutUser,
        requireAuth,
        showModal,
        injectModal
    };
})();
