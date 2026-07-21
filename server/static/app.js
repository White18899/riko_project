document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const micBtn = document.getElementById('mic-btn');
    const micIcon = document.getElementById('mic-icon');
    const micWave = document.getElementById('mic-wave');
    const typingIndicator = document.getElementById('typing-indicator');
    const toggleSettingsBtn = document.getElementById('toggle-settings-btn');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const settingsDrawer = document.getElementById('settings-drawer');
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');
    const saveConfigBtn = document.getElementById('save-config-btn');
    const resetHistoryBtn = document.getElementById('reset-history-btn');
    const voicePlayer = document.getElementById('voice-player');
    const factsList = document.getElementById('long-term-facts');
    
    // Avatar Elements
    const videoViewport = document.getElementById('video-viewport');
    const characterVideo = document.getElementById('character-video');
    const charStatus = document.getElementById('char-status');
    let currentEmotion = 'neutral';

    // Status Badges
    const statusOllama = document.getElementById('status-ollama');
    const statusTts = document.getElementById('status-tts');
    const statusWhisper = document.getElementById('status-whisper');

    // Configuration Fields
    const systemPromptInput = document.getElementById('system-prompt');
    const refAudioPathInput = document.getElementById('ref-audio-path');
    const promptTextInput = document.getElementById('prompt-text');
    const textLangSelect = document.getElementById('text-lang');
    const promptLangSelect = document.getElementById('prompt-lang');
    const ollamaHostInput = document.getElementById('ollama-host');
    const modelNameInput = document.getElementById('model-name');
    const maxTurnsInput = document.getElementById('max-turns');
    const recordingModeSelect = document.getElementById('recording-mode');
    const vadThresholdInput = document.getElementById('vad-threshold');
    const vadSilenceInput = document.getElementById('vad-silence');

    // State Variables
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let isRequestPending = false;
    let appConfig = {};
    let charConfig = {};

    // Initialize lucide icons
    lucide.createIcons();

    // 1. Fetch Statuses
    async function updateServiceStatus() {
        try {
            const res = await fetch('/api/status');
            if (res.ok) {
                const data = await res.json();
                
                // Ollama
                statusOllama.className = 'status-badge ' + (data.ollama ? 'online' : 'offline');
                
                // TTS (GPT-SoVITS)
                statusTts.className = 'status-badge ' + (data.tts ? 'online' : 'offline');
                
                // ASR (Whisper)
                statusWhisper.className = 'status-badge ' + (data.whisper ? 'online' : 'offline');
            }
        } catch (err) {
            console.error('Error fetching service status:', err);
        }
    }

    // 2. Fetch and Load Configuration
    async function loadConfiguration() {
        try {
            const res = await fetch('/api/config');
            if (res.ok) {
                const data = await res.json();
                appConfig = data.app_config || {};
                charConfig = data.char_config || {};

                // Map to inputs
                // Persona Config
                const defaultPreset = charConfig.presets?.default || {};
                systemPromptInput.value = defaultPreset.system_prompt || '';
                
                const ttsConf = charConfig.sovits_ping_config || {};
                refAudioPathInput.value = ttsConf.ref_audio_path || '';
                promptTextInput.value = ttsConf.prompt_text || '';
                textLangSelect.value = ttsConf.text_lang || 'en';
                promptLangSelect.value = ttsConf.prompt_lang || 'en';

                // App Config
                ollamaHostInput.value = appConfig.ollama_host || '';
                modelNameInput.value = appConfig.model || '';
                maxTurnsInput.value = appConfig.max_short_term_turns || 8;
                recordingModeSelect.value = appConfig.recording_mode || 'vad';
                vadThresholdInput.value = appConfig.vad_threshold || 0.02;
                vadSilenceInput.value = appConfig.vad_silence_duration || 1.5;
            }
        } catch (err) {
            console.error('Error loading configuration:', err);
        }
    }

    // 3. Save Configuration
    saveConfigBtn.addEventListener('click', async () => {
        // Collect form data
        const updatedAppConfig = {
            ...appConfig,
            ollama_host: ollamaHostInput.value.trim(),
            model: modelNameInput.value.trim(),
            max_short_term_turns: parseInt(maxTurnsInput.value, 10),
            recording_mode: recordingModeSelect.value,
            vad_threshold: parseFloat(vadThresholdInput.value),
            vad_silence_duration: parseFloat(vadSilenceInput.value)
        };

        const updatedCharConfig = {
            ...charConfig,
            presets: {
                ...charConfig.presets,
                default: {
                    ...charConfig.presets?.default,
                    system_prompt: systemPromptInput.value
                }
            },
            sovits_ping_config: {
                ...charConfig.sovits_ping_config,
                ref_audio_path: refAudioPathInput.value.trim(),
                prompt_text: promptTextInput.value.trim(),
                text_lang: textLangSelect.value,
                prompt_lang: promptLangSelect.value
            }
        };

        try {
            saveConfigBtn.disabled = true;
            saveConfigBtn.textContent = 'Saving...';
            
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    app_config: updatedAppConfig,
                    char_config: updatedCharConfig
                })
            });

            if (res.ok) {
                alert('Configuration updated successfully!');
                await loadConfiguration();
                await updateServiceStatus();
            } else {
                const errData = await res.json();
                alert(`Error saving configuration: ${errData.detail}`);
            }
        } catch (err) {
            alert(`Network error saving configuration: ${err}`);
        } finally {
            saveConfigBtn.disabled = false;
            saveConfigBtn.textContent = 'Save Changes';
        }
    });

    // 4. Fetch and Load Chat History & Long term facts
    async function loadChatHistory() {
        try {
            const res = await fetch('/api/history');
            if (res.ok) {
                const data = await res.json();
                
                // Load short term conversation
                chatMessages.innerHTML = '';
                const shortTerm = data.short_term || [];
                
                if (shortTerm.length === 0) {
                    appendSystemMessage("Hello, senpai! Welcome back. Speak to me or type a message below.");
                } else {
                    shortTerm.forEach(msg => {
                        const role = msg.role;
                        const content_list = msg.content || [];
                        let text = '';
                        if (Array.isArray(content_list)) {
                            text = content_list.map(c => c.text).join(' ');
                        } else {
                            text = String(content_list);
                        }
                        
                        if (role === 'user') {
                            appendUserMessage(text);
                        } else if (role === 'assistant') {
                            appendAssistantMessage(text, null, null); // History audio links aren't saved on backend
                        }
                    });
                }

                // Load long term memory facts
                factsList.innerHTML = '';
                const longTerm = data.long_term || [];
                if (longTerm.length === 0) {
                    factsList.innerHTML = '<li class="empty-fact">No consolidated memories saved yet, senpai.</li>';
                } else {
                    longTerm.forEach(fact => {
                        const li = document.createElement('li');
                        li.textContent = fact;
                        factsList.appendChild(li);
                    });
                }
                
                scrollToBottom();
            }
        } catch (err) {
            console.error('Error loading chat history:', err);
        }
    }

    // 5. Append User Message
    function appendUserMessage(text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message user';
        msgDiv.innerHTML = `
            <div class="message-content">
                <div class="chat-bubble-text">${escapeHtml(text)}</div>
            </div>
        `;
        chatMessages.appendChild(msgDiv);
        scrollToBottom();
    }

    // 6. Append Assistant Message (supporting reasoning and play button)
    function appendAssistantMessage(text, thinking, audioUrl) {
        // Update Riko's face expressions and emotion dynamically (defer video swap if voice audio will play)
        updateAvatarEmotion(text, !!audioUrl);

        const msgDiv = document.createElement('div');
        msgDiv.className = 'message assistant';
        
        let thinkingHtml = '';
        if (thinking && thinking.trim()) {
            thinkingHtml = `
                <details class="reasoning-box">
                    <summary>Reasoning Process</summary>
                    <div class="reasoning-text">${escapeHtml(thinking)}</div>
                </details>
            `;
        }

        let audioHtml = '';
        if (audioUrl) {
            audioHtml = `
                <button class="audio-play-btn" title="Replay voice" onclick="playAudio('${audioUrl}')">
                    <i data-lucide="play" style="width:12px;height:12px;"></i>
                </button>
            `;
        }

        msgDiv.innerHTML = `
            <div class="message-content">
                ${thinkingHtml}
                <div class="chat-bubble-text">
                    <span>${escapeHtml(text)}</span>
                    ${audioHtml}
                </div>
            </div>
        `;
        chatMessages.appendChild(msgDiv);
        lucide.createIcons(); // Initialize play icons in bubble
        scrollToBottom();
        
        if (audioUrl) {
            playAudio(audioUrl);
        }
    }

    // ==========================================================================
    // 6. 3D WebGL VRM Avatar Setup & Animators
    // ==========================================================================
    const canvas = document.getElementById('avatar-canvas');
    const loadingEl = document.getElementById('avatar-loading');

    // Obsolete SVG element references (stubbed out for compatibility)
    const eyebrowLeft = null;
    const eyebrowRight = null;
    const blushLeft = null;
    const blushRight = null;

    let currentVRM = null;
    let clock = new THREE.Clock();
    let scene, camera, renderer;
    let lookTarget;

    // Avatar State variables
    let targetMouseX = 0;
    let targetMouseY = 1.35;
    let currentMouseX = 0;
    let currentMouseY = 1.35;
    let isSpeaking = false;
    let speakEmotion = 'neutral';

    function init3D() {
        if (!canvas) return;

        // 1. Create Scene
        scene = new THREE.Scene();

        // 2. Camera Setup
        camera = new THREE.PerspectiveCamera(30, canvas.clientWidth / canvas.clientHeight, 0.1, 20.0);
        camera.position.set(0.0, 1.35, 0.95);

        // 3. Renderer Setup
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputEncoding = THREE.sRGBEncoding;

        // 4. Lighting Setup
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
        scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
        dirLight.position.set(1.0, 2.0, 1.0).normalize();
        scene.add(dirLight);

        // 5. LookAt Target
        lookTarget = new THREE.Object3D();
        scene.add(lookTarget);

        // 6. Loader setup using GLTFLoader & THREE_VRM.VRMLoaderPlugin
        const loader = new THREE.GLTFLoader();
        
        loader.register((parser) => {
            return new THREE_VRM.VRMLoaderPlugin(parser);
        });
        
        const modelUrl = '/static/models/AvatarSample_A.vrm';
        
        loader.load(
            modelUrl,
            (gltf) => {
                const vrm = gltf.userData.vrm;
                currentVRM = vrm;
                scene.add(vrm.scene);

                // Disable frustum culling so she doesn't pop out
                vrm.scene.traverse((obj) => {
                    obj.frustumCulled = false;
                });

                // Position model (facing camera)
                vrm.scene.position.set(0, 0, 0);
                vrm.scene.rotation.y = 0;

                // Setup lookAt target
                if (vrm.lookAt) {
                    vrm.lookAt.target = lookTarget;
                }

                // Hide loading spinner
                if (loadingEl) {
                    loadingEl.classList.add('hidden');
                }

                console.log("🤖 VRM Avatar loaded successfully!");
            },
            (progress) => {
                const percent = Math.round((progress.loaded / (progress.total || 15000000)) * 100);
                console.log(`Loading VRM: ${percent}%`);
            },
            (error) => {
                console.error("Failed to load GLTF model:", error);
                if (loadingEl) {
                    loadingEl.innerHTML = "<span>⚠️ Failed to load 3D Model</span>";
                }
            }
        );

        window.addEventListener('resize', onWindowResize);
    }

    function onWindowResize() {
        if (!canvas || !renderer || !camera) return;
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    }

    // Track mouse movement to direct VRM gaze
    document.addEventListener('mousemove', (e) => {
        if (!videoViewport) return;
        const rect = videoViewport.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        
        targetMouseX = x * 2.0; 
        targetMouseY = -y * 1.5 + 1.35; 
    });

    document.addEventListener('touchmove', (e) => {
        if (!videoViewport || e.touches.length === 0) return;
        const rect = videoViewport.getBoundingClientRect();
        const touch = e.touches[0];
        const x = (touch.clientX - rect.left) / rect.width - 0.5;
        const y = (touch.clientY - rect.top) / rect.height - 0.5;
        
        targetMouseX = x * 2.0;
        targetMouseY = -y * 1.5 + 1.35;
    }, { passive: true });

    // Web Audio Analyser for Real-time Lip-Sync
    let audioCtx = null;
    let analyser = null;
    let dataArray = null;

    function initAudioContext() {
        if (audioCtx) return;
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;
            const source = audioCtx.createMediaElementSource(voicePlayer);
            source.connect(analyser);
            analyser.connect(audioCtx.destination);
            dataArray = new Uint8Array(analyser.frequencyBinCount);
            console.log("🔊 Web Audio Context & Analyser initialized successfully!");
        } catch (err) {
            console.warn("Autoplay constraint: Web Audio Context could not start:", err);
        }
    }

    document.addEventListener('click', initAudioContext, { once: true });
    document.addEventListener('touchstart', initAudioContext, { once: true });

    // Main animation loop
    function animate() {
        requestAnimationFrame(animate);

        const delta = clock.getDelta();
        const time = clock.getElapsedTime();

        if (currentVRM) {
            try {
                currentVRM.update(delta);

                // 1. Smooth gaze target tracking
                currentMouseX += (targetMouseX - currentMouseX) * 0.12;
                currentMouseY += (targetMouseY - currentMouseY) * 0.12;
                lookTarget.position.set(currentMouseX, currentMouseY, 1.5);

                // 2. Breathing chest movements
                const chest = currentVRM.humanoid.getNormalizedBoneNode('chest');
                if (chest) {
                    chest.rotation.z = Math.sin(time * 2.0) * 0.008;
                    chest.rotation.x = Math.sin(time * 2.0) * 0.004;
                }

                // 3. Natural Blink interval logic
                let blinkVal = 0;
                const blinkCycle = time % 4.0;
                if (blinkCycle < 0.15) {
                    blinkVal = Math.sin((blinkCycle / 0.15) * Math.PI);
                }
                if (currentVRM.expressionManager) {
                    currentVRM.expressionManager.setValue('blink', blinkVal);
                }

                // 4. Web Audio Lip-Sync mouth movement
                let volume = 0;
                if (analyser && !voicePlayer.paused) {
                    isSpeaking = true;
                    analyser.getByteFrequencyData(dataArray);
                    let sum = 0;
                    for (let i = 0; i < dataArray.length; i++) {
                        sum += dataArray[i];
                    }
                    const avg = sum / dataArray.length;
                    volume = Math.min(avg / 150.0, 1.0); 
                } else {
                    isSpeaking = false;
                }

                // 5. Speech mouth shape Vowel A vs Idle expressions mapping
                if (currentVRM.expressionManager) {
                    if (isSpeaking) {
                        currentVRM.expressionManager.setValue('aa', volume * 0.85);
                        currentVRM.expressionManager.setValue('happy', 0);
                        currentVRM.expressionManager.setValue('angry', 0);
                        currentVRM.expressionManager.setValue('sad', 0);
                    } else {
                        currentVRM.expressionManager.setValue('aa', 0);
                        
                        if (currentEmotion === 'happy') {
                            currentVRM.expressionManager.setValue('happy', 0.85);
                            currentVRM.expressionManager.setValue('angry', 0);
                            currentVRM.expressionManager.setValue('sad', 0);
                        } else if (currentEmotion === 'annoyed') {
                            currentVRM.expressionManager.setValue('angry', 0.95);
                            currentVRM.expressionManager.setValue('happy', 0);
                            currentVRM.expressionManager.setValue('sad', 0);
                        } else if (currentEmotion === 'sad') {
                            currentVRM.expressionManager.setValue('sad', 0.8);
                            currentVRM.expressionManager.setValue('happy', 0);
                            currentVRM.expressionManager.setValue('angry', 0);
                        } else {
                            currentVRM.expressionManager.setValue('happy', 0);
                            currentVRM.expressionManager.setValue('angry', 0);
                            currentVRM.expressionManager.setValue('sad', 0);
                        }
                    }
                }
            } catch (err) {
                console.error("CRITICAL ANIMATION ERROR:", err);
            }
        }

        if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }
    }

    init3D();
    animate();

    // Update Avatar Emotion and Status based on text content
    function updateAvatarEmotion(text, willPlayVoice = false) {
        if (!videoViewport) return;
        
        // Comprehensive tsundere and dynamic sentiment matching
        const annoyedIntenseRegex = /shut up|hate you|go away|idiot|baka|annoyed|bothering|stupid|jerk|stop/i;
        const annoyedRegex = /[😤💢😡👿🤬]|ugh|boring|goldfish|tsundere|irritated|huff/iu;
        
        const happyGreetingRegex = /\b(hi|hello|hey|welcome|greet|greetings|morning)\b/i;
        const happyExcitedRegex = /excited|thrilled|great|wonderful|fantastic|yay|awesome|amazing/i;
        const happyRegex = /[😊✨💖💕❤️😍🌟🎉🌸🥰]|happy|love|smile|cute|senpai|thank/iu;
        
        const sadRegex = /[😢😭💔😰🤧😿]|sad|cry|hurt|tears|sorry|lonely|depressed|unhappy|distressed/iu;
        const thinkingRegex = /\.\.\.|\?|hmm|thinking|wonder|curious|ponder/i;
        
        let emotion = 'neutral';
        let status = 'Idle';
        
        if (sadRegex.test(text)) {
            emotion = 'sad';
            status = 'Sad';
        } else if (annoyedIntenseRegex.test(text)) {
            emotion = 'annoyed';
            status = 'Angry';
        } else if (annoyedRegex.test(text)) {
            emotion = 'annoyed';
            status = 'Annoyed';
        } else if (happyGreetingRegex.test(text)) {
            emotion = 'happy';
            status = 'Greeting';
        } else if (happyExcitedRegex.test(text)) {
            emotion = 'happy';
            status = 'Excited';
        } else if (happyRegex.test(text)) {
            emotion = 'happy';
            status = 'Happy';
        } else if (thinkingRegex.test(text)) {
            emotion = 'thinking';
            status = 'Thinking';
        }
        
        currentEmotion = emotion;
        speakEmotion = emotion;
        
        if (emotion === 'happy') {
            if (happyGreetingRegex.test(text)) speakEmotion = 'happy_greeting';
            else if (happyExcitedRegex.test(text)) speakEmotion = 'happy_excited';
        } else if (emotion === 'annoyed') {
            if (annoyedIntenseRegex.test(text)) speakEmotion = 'annoyed_intense';
        }
        
        // Apply emotion class to container
        videoViewport.className = `video-viewport ${emotion}`;

        if (willPlayVoice) return;
        charStatus.textContent = status;
    }

    // Voice player audio listeners for dynamic status sync
    if (voicePlayer) {
        voicePlayer.addEventListener('play', () => {
            initAudioContext();
            if (videoViewport) {
                videoViewport.classList.add('speaking');
                charStatus.textContent = 'Speaking';
            }
        });
        
        const returnToIdle = () => {
            if (videoViewport) {
                videoViewport.classList.remove('speaking');
                let displayStatus = currentEmotion.charAt(0).toUpperCase() + currentEmotion.slice(1);
                charStatus.textContent = displayStatus;
            }
        };
        
        voicePlayer.addEventListener('pause', returnToIdle);
        voicePlayer.addEventListener('ended', returnToIdle);
    }

    // 7. Append System Message
    function appendSystemMessage(text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message system';
        msgDiv.innerHTML = `
            <div class="message-content">
                <span>${escapeHtml(text)}</span>
            </div>
        `;
        chatMessages.appendChild(msgDiv);
        scrollToBottom();
    }

    // Helper functions
    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function escapeHtml(text) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Global audio playing helper
    window.playAudio = function(url) {
        voicePlayer.src = url;
        voicePlayer.play().catch(err => {
            console.error('Audio play failed:', err);
        });
    };

    // 8. Send Chat Message
    async function sendChatMessage(message) {
        if (!message || !message.trim() || isRequestPending) return;

        isRequestPending = true;
        appendUserMessage(message);
        chatInput.value = '';
        
        // Show typing indicator, active thinking state and video
        typingIndicator.style.display = 'flex';
        chatInput.disabled = true;
        sendBtn.disabled = true;
        
        // Disable mic button visually and functionally
        if (micBtn) {
            micBtn.style.opacity = '0.5';
            micBtn.style.pointerEvents = 'none';
        }
        
        scrollToBottom();

        charStatus.textContent = 'Thinking';
        if (videoViewport) {
            videoViewport.className = 'video-viewport thinking';
        }
        currentEmotion = 'thinking';
        if (eyebrowLeft && eyebrowRight) {
            eyebrowLeft.setAttribute('transform', 'translate(1, -2) rotate(-3)');
            eyebrowRight.setAttribute('transform', 'translate(-1, -2) rotate(3)');
        }

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message })
            });

            if (res.ok) {
                const data = await res.json();
                appendAssistantMessage(data.text, data.thinking, data.audio_url);
                
                // If memory consolidation just ran, refresh facts
                setTimeout(loadChatHistory, 1000); // Slight delay for file I/O to settle
            } else {
                appendSystemMessage("Error: Failed to fetch response from Riko.");
            }
        } catch (err) {
            appendSystemMessage(`Network error connecting to backend: ${err}`);
        } finally {
            typingIndicator.style.display = 'none';
            chatInput.disabled = false;
            sendBtn.disabled = false;
            
            // Re-enable mic button
            if (micBtn) {
                micBtn.style.opacity = '';
                micBtn.style.pointerEvents = '';
            }
            
            isRequestPending = false;
            chatInput.focus();
            scrollToBottom();
        }
    }

    sendBtn.addEventListener('click', () => {
        sendChatMessage(chatInput.value);
    });

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage(chatInput.value);
        }
    });

    // 9. Reset/Clear Chat History
    resetHistoryBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to clear your conversation history, senpai? This cannot be undone.')) {
            return;
        }

        try {
            const res = await fetch('/api/history/clear', { method: 'POST' });
            if (res.ok) {
                alert('Conversation history cleared!');
                await loadChatHistory();
            } else {
                alert('Failed to clear chat history.');
            }
        } catch (err) {
            alert(`Error resetting history: ${err}`);
        }
    });

    // 10. Settings Drawer & Tabs toggles
    toggleSettingsBtn.addEventListener('click', () => {
        settingsDrawer.classList.toggle('open');
        if (settingsDrawer.classList.contains('open')) {
            loadChatHistory(); // refresh long term memories
        }
    });

    closeSettingsBtn.addEventListener('click', () => {
        settingsDrawer.classList.remove('open');
    });

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            
            tabButtons.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
        });
    });

    // 11. Microphone Recording via Browser Web Audio
    micBtn.addEventListener('click', async () => {
        if (!isRecording) {
            // Start recording
            try {
                audioChunks = [];
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                
                mediaRecorder = new MediaRecorder(stream);
                mediaRecorder.addEventListener('dataavailable', event => {
                    audioChunks.push(event.data);
                });

                mediaRecorder.addEventListener('stop', async () => {
                    // Turn chunks into a single audio blob
                    const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                    
                    // Update status to transcribing (listening state)
                    micBtn.className = 'mic-btn listening';
                    micIcon.setAttribute('data-lucide', 'loader');
                    lucide.createIcons();
                    
                    const formData = new FormData();
                    formData.append('file', audioBlob, 'recording.wav');

                    try {
                        const res = await fetch('/api/transcribe', {
                            method: 'POST',
                            body: formData
                        });

                        if (res.ok) {
                            const data = await res.json();
                            const transcript = data.text;
                            if (transcript && transcript.trim()) {
                                // Auto send message
                                sendChatMessage(transcript);
                            } else {
                                console.log("ASR transcribed empty text.");
                            }
                        } else {
                            console.error("Transcription endpoint error.");
                        }
                    } catch (err) {
                        console.error("Failed to upload/transcribe audio:", err);
                    } finally {
                        // Reset mic button
                        micBtn.className = 'mic-btn';
                        micIcon.setAttribute('data-lucide', 'mic');
                        lucide.createIcons();
                        isRecording = false;
                        
                        // Close mic stream tracks
                        stream.getTracks().forEach(track => track.stop());
                    }
                });

                mediaRecorder.start();
                isRecording = true;
                
                // Update UI state to recording
                micBtn.className = 'mic-btn recording';
                micIcon.setAttribute('data-lucide', 'square'); // click square to stop
                lucide.createIcons();

            } catch (err) {
                alert(`Could not access microphone: ${err}`);
                console.error('Mic access error:', err);
            }
        } else {
            // Stop recording
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
        }
    });

    // ==========================================================================
    // 11.5. Interactive Avatar Hotspots & Visual Effects
    // ==========================================================================
    const hotspotHead = document.getElementById('hotspot-head');
    const hotspotFace = document.getElementById('hotspot-face');
    const hotspotChest = document.getElementById('hotspot-chest');
    
    let lastInteractionTime = 0;
    const INTERACTION_COOLDOWN = 5000; // 5s cooldown to prevent LLM/TTS request spamming
    
    // Developer debug visibility key: Press Shift + D to toggle outline of hotspots
    document.addEventListener('keydown', (e) => {
        if (e.shiftKey && (e.key === 'D' || e.key === 'd')) {
            const hotspots = document.querySelectorAll('.hotspot');
            hotspots.forEach(h => h.classList.toggle('debug-visible'));
            console.log("Toggle hotspot outlines!");
        }
    });

    // Particle generator for headpats (hearts/blossoms) and pokes (anger marks)
    function spawnParticle(x, y, emojis) {
        if (!videoViewport) return;
        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
        const particle = document.createElement('div');
        particle.className = 'interaction-particle';
        particle.textContent = emoji;
        particle.style.left = `${x}px`;
        particle.style.top = `${y}px`;
        
        // Apply random minor offsets to make it look organic
        const randomXOffset = (Math.random() - 0.5) * 35;
        const randomYOffset = (Math.random() - 0.5) * 35;
        particle.style.marginLeft = `${randomXOffset}px`;
        particle.style.marginTop = `${randomYOffset}px`;
        
        videoViewport.appendChild(particle);
        
        // Clean up particle element after animation completes
        particle.addEventListener('animationend', () => {
            particle.remove();
        });
    }

    // Dynamic interaction controller to trigger immediate audio/visual feedback and send message
    function triggerInteraction(actionText, type) {
        const now = Date.now();
        if (now - lastInteractionTime < INTERACTION_COOLDOWN) {
            // Visual feedback still triggers on spam clicks, but LLM chat requests are ignored
            return false;
        }
        
        lastInteractionTime = now;
        
        // Immediate visual state change before LLM response begins
        if (type === 'headpat') {
            videoViewport.className = 'video-viewport happy';
            charStatus.textContent = 'Happy';
            
            // Set SVG properties directly
            currentEmotion = 'happy';
            if (eyebrowLeft && eyebrowRight) {
                eyebrowLeft.setAttribute('transform', 'translate(0, -3) rotate(-5)');
                eyebrowRight.setAttribute('transform', 'translate(0, -3) rotate(5)');
            }
            if (blushLeft && blushRight) {
                blushLeft.style.opacity = '0.85';
                blushRight.style.opacity = '0.85';
            }
            
            // Trigger temporary blush overlay
            const blushOverlay = document.getElementById('blush-overlay');
            if (blushOverlay) {
                blushOverlay.style.opacity = '1';
                setTimeout(() => {
                    blushOverlay.style.opacity = '';
                }, 2500);
            }
        } else if (type === 'poke') {
            // Apply screen shake
            videoViewport.classList.add('shake-viewport');
            videoViewport.addEventListener('animationend', () => {
                videoViewport.classList.remove('shake-viewport');
            }, { once: true });
            
            videoViewport.className = 'video-viewport annoyed';
            charStatus.textContent = 'Annoyed';
            
            // Set SVG properties directly
            currentEmotion = 'annoyed';
            if (eyebrowLeft && eyebrowRight) {
                eyebrowLeft.setAttribute('transform', 'translate(3, 4) rotate(15)');
                eyebrowRight.setAttribute('transform', 'translate(-3, 4) rotate(-15)');
            }
            if (blushLeft && blushRight) {
                blushLeft.style.opacity = '0.4';
                blushRight.style.opacity = '0.4';
            }
        }
        
        // Send the action message to trigger Riko's reaction
        sendChatMessage(actionText);
        return true;
    }

    // Headpat dragging/swiping tracking
    let isPatting = false;
    let patParticleCount = 0;
    
    const handleHeadpatStart = (e) => {
        isPatting = true;
        patParticleCount = 0;
        const rect = videoViewport.getBoundingClientRect();
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        if (clientX && clientY) {
            const x = clientX - rect.left;
            const y = clientY - rect.top;
            spawnParticle(x, y, ['🌸', '💖', '✨', '💕', '🥰']);
        }
        triggerInteraction("*pats your head gently*", 'headpat');
    };

    const handleHeadpatMove = (e) => {
        if (!isPatting) return;
        patParticleCount++;
        
        // Throttle particle frequency during drag
        if (patParticleCount % 6 === 0) {
            const rect = videoViewport.getBoundingClientRect();
            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);
            if (clientX && clientY) {
                const x = clientX - rect.left;
                const y = clientY - rect.top;
                spawnParticle(x, y, ['🌸', '💖', '✨', '💕']);
            }
        }
    };

    const handleHeadpatEnd = () => {
        isPatting = false;
    };

    // Headpat listeners (Mouse)
    hotspotHead.addEventListener('mousedown', handleHeadpatStart);
    hotspotHead.addEventListener('mousemove', handleHeadpatMove);
    window.addEventListener('mouseup', handleHeadpatEnd);
    
    // Headpat listeners (Touch/Mobile)
    hotspotHead.addEventListener('touchstart', handleHeadpatStart, { passive: true });
    hotspotHead.addEventListener('touchmove', handleHeadpatMove, { passive: true });
    window.addEventListener('touchend', handleHeadpatEnd);

    // Cheek Poke listeners
    hotspotFace.addEventListener('click', (e) => {
        const rect = videoViewport.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        spawnParticle(x, y, ['💢', '⚡', '💥', '🙄']);
        triggerInteraction("*pokes your cheek*", 'poke');
    });

    // Arm/Body Poke listeners
    hotspotChest.addEventListener('click', (e) => {
        const rect = videoViewport.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        spawnParticle(x, y, ['💢', '❓', '😤', '👊']);
        triggerInteraction("*pokes your side ticklishly*", 'poke');
    });

    // ==========================================================================
    // 12. Auto-run startup fetches & initialization
    // ==========================================================================
    updateServiceStatus();
    loadConfiguration();
    loadChatHistory();
    
    // Initialize default avatar state
    currentEmotion = 'neutral';

    // Poll statuses every 10 seconds
    setInterval(updateServiceStatus, 10000);
});

