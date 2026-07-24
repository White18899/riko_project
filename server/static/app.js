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

    // Subtitle Elements
    const toggleSubtitleBtn = document.getElementById('toggle-subtitle-btn');
    const subtitleOverlay = document.getElementById('subtitle-overlay');
    const subtitleTextEl = document.getElementById('subtitle-text');

    // Suggestion & Waveform Elements
    const suggestionPillsContainer = document.getElementById('suggestion-pills-container');
    const voiceWaveformCanvas = document.getElementById('voice-waveform');

    // Status Badges
    const statusOllama = document.getElementById('status-ollama');
    const statusTts = document.getElementById('status-tts');
    const statusWhisper = document.getElementById('status-whisper');
    const statusCpu = document.getElementById('status-cpu');
    const cpuVal = document.getElementById('cpu-val');
    const statusRam = document.getElementById('status-ram');
    const ramVal = document.getElementById('ram-val');

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

    // Image Attachment Elements
    const attachImgBtn = document.getElementById('attach-img-btn');
    const imageInput = document.getElementById('image-input');
    const imagePreviewContainer = document.getElementById('image-preview-container');
    const imagePreviewImg = document.getElementById('image-preview-img');
    const imagePreviewName = document.getElementById('image-preview-name');
    const removeImgBtn = document.getElementById('remove-img-btn');
    let currentAttachedImageBase64 = null;

    // State Variables
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let isRequestPending = false;
    let isTtsMuted = false;
    let appConfig = {};
    let charConfig = {};

    let isSubtitleModeActive = false;
    let fullAnswerText = '';

    // Mic Visualizer state
    let micAudioContext = null;
    let micAnimationId = null;

    // Toggle TTS Mute / Unmute when clicking status badge
    if (statusTts) {
        statusTts.addEventListener('click', () => {
            isTtsMuted = !isTtsMuted;
            const ttsIcon = document.getElementById('tts-icon');
            const ttsLabel = document.getElementById('tts-label');
            if (isTtsMuted) {
                statusTts.className = 'status-badge offline';
                if (ttsLabel) ttsLabel.textContent = 'Muted';
                if (ttsIcon) ttsIcon.setAttribute('data-lucide', 'volume-x');
            } else {
                statusTts.className = 'status-badge online';
                if (ttsLabel) ttsLabel.textContent = 'TTS';
                if (ttsIcon) ttsIcon.setAttribute('data-lucide', 'volume-2');
            }
            if (typeof lucide !== 'undefined') lucide.createIcons();
        });
    }

    // Initialize lucide icons
    lucide.createIcons();

    // 1. Fetch Statuses & Real-Time System Metrics
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

                // CPU Metric
                if (data.cpu !== undefined && cpuVal) {
                    cpuVal.textContent = `${data.cpu}%`;
                    if (statusCpu) statusCpu.className = `status-badge ${data.cpu > 85 ? 'offline' : 'online'}`;
                }

                // RAM Metric
                if (data.ram !== undefined && ramVal) {
                    ramVal.textContent = `${data.ram}%`;
                    if (statusRam) statusRam.className = `status-badge ${data.ram > 90 ? 'offline' : 'online'}`;
                }
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
                        let imgBase64 = null;
                        if (Array.isArray(content_list)) {
                            text = content_list.filter(c => c.type === 'input_text').map(c => c.text).join(' ');
                            const imgItem = content_list.find(c => c.type === 'input_image');
                            if (imgItem) {
                                imgBase64 = imgItem.image;
                            }
                        } else {
                            text = String(content_list);
                        }
                        
                        if (role === 'user') {
                            appendUserMessage(text, imgBase64);
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

    // Image Upload Event Handlers
    if (imageInput) {
        imageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (evt) => {
                    currentAttachedImageBase64 = evt.target.result;
                    if (imagePreviewImg) imagePreviewImg.src = currentAttachedImageBase64;
                    if (imagePreviewName) imagePreviewName.textContent = file.name;
                    if (imagePreviewContainer) imagePreviewContainer.style.display = 'flex';
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (removeImgBtn) {
        removeImgBtn.addEventListener('click', () => {
            currentAttachedImageBase64 = null;
            if (imageInput) imageInput.value = '';
            if (imagePreviewContainer) imagePreviewContainer.style.display = 'none';
        });
    }

    // 5. Append User Message
    function appendUserMessage(text, imgBase64 = null) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message user';
        
        let imgHtml = '';
        if (imgBase64) {
            imgHtml = `<img src="${imgBase64}" style="max-width:180px; max-height:140px; border-radius:8px; display:block; margin-bottom:6px; border:1px solid rgba(255,255,255,0.2);">`;
        }

        msgDiv.innerHTML = `
            <div class="message-content">
                ${imgHtml}
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
                    <span>${formatMessageText(text)}</span>
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
        return msgDiv;
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

    // Stage Theme & Lighting Elements
    const stageThemeSelect = document.getElementById('stage-theme-select');
    let keyLight = null;
    let fillLight = null;
    let rimLight = null;

    function updateStageLighting(theme) {
        if (!scene) return;
        let targetTheme = theme || 'auto';
        if (targetTheme === 'auto') {
            const hr = new Date().getHours();
            if (hr >= 5 && hr < 11) targetTheme = 'morning';
            else if (hr >= 11 && hr < 17) targetTheme = 'daylight';
            else if (hr >= 17 && hr < 20) targetTheme = 'sunset';
            else targetTheme = 'night';
        }

        if (targetTheme === 'morning') {
            if (keyLight) keyLight.color.setHex(0xffdfba);
            if (fillLight) fillLight.color.setHex(0xe0f7fa);
            if (rimLight) rimLight.color.setHex(0xffe0b2);
            scene.background = new THREE.Color(0x1a1528);
        } else if (targetTheme === 'daylight') {
            if (keyLight) keyLight.color.setHex(0xffffff);
            if (fillLight) fillLight.color.setHex(0xb2ebf2);
            if (rimLight) rimLight.color.setHex(0xe0f7fa);
            scene.background = new THREE.Color(0x0f1219);
        } else if (targetTheme === 'sunset') {
            if (keyLight) keyLight.color.setHex(0xff9e80);
            if (fillLight) fillLight.color.setHex(0xd1c4e9);
            if (rimLight) rimLight.color.setHex(0xff80ab);
            scene.background = new THREE.Color(0x231428);
        } else if (targetTheme === 'night') {
            if (keyLight) keyLight.color.setHex(0x80deea);
            if (fillLight) fillLight.color.setHex(0x1a237e);
            if (rimLight) rimLight.color.setHex(0xb388ff);
            scene.background = new THREE.Color(0x0a0c14);
        }
    }

    if (stageThemeSelect) {
        stageThemeSelect.addEventListener('change', (e) => {
            updateStageLighting(e.target.value);
        });
    }

    // Code Studio Elements & Event Handlers
    const toggleCodeModeBtn = document.getElementById('toggle-code-mode-btn');
    const codeStudioPanel = document.getElementById('code-studio-panel');
    const codeStudioEditor = document.getElementById('code-studio-editor');
    const codeLangSelect = document.getElementById('code-lang-select');
    const codeActionReview = document.getElementById('code-action-review');
    const codeActionFix = document.getElementById('code-action-fix');
    const codeActionExplain = document.getElementById('code-action-explain');

    if (toggleCodeModeBtn && codeStudioPanel) {
        toggleCodeModeBtn.addEventListener('click', () => {
            const isOpen = codeStudioPanel.style.display !== 'none';
            codeStudioPanel.style.display = isOpen ? 'none' : 'flex';
            toggleCodeModeBtn.classList.toggle('active', !isOpen);
        });
    }

    function sendCodeActionMessage(actionPrefix) {
        if (!codeStudioEditor) return;
        const code = codeStudioEditor.value.trim();
        if (!code) {
            alert('Please paste or type some code in the editor first, senpai!');
            return;
        }
        const lang = codeLangSelect ? codeLangSelect.value : 'python';
        const formattedMsg = `${actionPrefix} for the following ${lang} code:\n\n\`\`\`${lang}\n${code}\n\`\`\``;
        sendChatMessage(formattedMsg);
    }

    if (codeActionReview) codeActionReview.addEventListener('click', () => sendCodeActionMessage('Please review and suggest improvements'));
    if (codeActionFix) codeActionFix.addEventListener('click', () => sendCodeActionMessage('Please identify and fix any bugs or errors'));
    if (codeActionExplain) codeActionExplain.addEventListener('click', () => sendCodeActionMessage('Please explain step-by-step how this code works'));

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
        camera.position.set(0.0, 1.35, 1.25);

        // 3. Renderer Setup
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputEncoding = THREE.sRGBEncoding;

        // 4. Lighting Setup
        fillLight = new THREE.AmbientLight(0xfff0f5, 0.85);
        scene.add(fillLight);

        keyLight = new THREE.DirectionalLight(0xfffaed, 0.9);
        keyLight.position.set(1.5, 2.5, 1.5).normalize();
        scene.add(keyLight);

        rimLight = new THREE.DirectionalLight(0x70d6ff, 0.5);
        rimLight.position.set(-1.5, 1.8, -1.2).normalize();
        scene.add(rimLight);

        // Apply dynamic stage lighting based on time/theme
        updateStageLighting(stageThemeSelect ? stageThemeSelect.value : 'auto');

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

                // 1. Smooth gaze target tracking (EYES ONLY - No head rotation)
                currentMouseX += (targetMouseX - currentMouseX) * 0.12;
                currentMouseY += (targetMouseY - currentMouseY) * 0.12;
                lookTarget.position.set(currentMouseX * 1.8, currentMouseY, 2.0);

                const headNode = currentVRM.humanoid.getNormalizedBoneNode('head');
                const neckNode = currentVRM.humanoid.getNormalizedBoneNode('neck');
                if (headNode) {
                    headNode.rotation.y = 0;
                    headNode.rotation.x = 0;
                    headNode.rotation.z = Math.sin(time * 0.8) * 0.01; // Gentle subtle resting posture
                }
                if (neckNode) {
                    neckNode.rotation.y = 0;
                    neckNode.rotation.x = 0;
                    neckNode.rotation.z = 0;
                }

                // 2. Breathing chest movements
                const chest = currentVRM.humanoid.getNormalizedBoneNode('chest');
                if (chest) {
                    chest.rotation.z = Math.sin(time * 2.0) * 0.008;
                    chest.rotation.x = Math.sin(time * 2.0) * 0.005;
                }

                // Relax arms down from T-pose to natural standing posture
                const leftArm = currentVRM.humanoid.getNormalizedBoneNode('leftUpperArm');
                if (leftArm) {
                    leftArm.rotation.z = -1.3;
                }
                const rightArm = currentVRM.humanoid.getNormalizedBoneNode('rightUpperArm');
                if (rightArm) {
                    rightArm.rotation.z = 1.3;
                }

                // 3. Natural Randomized Double-Blink interval logic
                let blinkVal = 0;
                const blinkCycle = time % 4.5;
                if (blinkCycle < 0.14) {
                    blinkVal = Math.sin((blinkCycle / 0.14) * Math.PI);
                } else if (blinkCycle >= 0.22 && blinkCycle < 0.34 && Math.sin(time) > 0.3) {
                    blinkVal = Math.sin(((blinkCycle - 0.22) / 0.12) * Math.PI);
                }
                if (currentVRM.expressionManager) {
                    currentVRM.expressionManager.setValue('blink', blinkVal);
                }

                // 4. Web Audio Multi-Vowel Viseme Lip-Sync (Dynamic Syllable Envelope Modulation)
                let activeViseme = 'aa';
                let visemeWeight = 0;
                if (analyser && !voicePlayer.paused) {
                    isSpeaking = true;
                    analyser.getByteFrequencyData(dataArray);
                    
                    const binCount = dataArray.length; // 32 bins
                    let lowEnergy = 0, midEnergy = 0, highEnergy = 0, topEnergy = 0, totalVol = 0;
                    
                    for (let i = 0; i < 4; i++) lowEnergy += dataArray[i];
                    for (let i = 4; i < 10; i++) midEnergy += dataArray[i];
                    for (let i = 10; i < 20; i++) highEnergy += dataArray[i];
                    for (let i = 20; i < binCount; i++) topEnergy += dataArray[i];
                    for (let i = 0; i < binCount; i++) totalVol += dataArray[i];
                    
                    lowEnergy /= 4.0;
                    midEnergy /= 6.0;
                    highEnergy /= 10.0;
                    topEnergy /= 12.0;
                    totalVol /= binCount; // 0..255

                    if (totalVol > 10.0) {
                        // Normalize audio volume and modulate with sine envelope for natural syllable mouth opening & closing dips
                        const normVol = Math.max(0, (totalVol - 10.0) / 90.0);
                        const syllablePulse = (Math.sin(time * 18.0) * 0.35 + 0.65);
                        visemeWeight = Math.min(normVol * syllablePulse * 1.1, 0.85);
                        
                        // Select dominant frequency band for vowel shape
                        let maxE = lowEnergy;
                        activeViseme = 'aa';
                        if (midEnergy > maxE * 1.1) { maxE = midEnergy; activeViseme = 'ih'; }
                        if (highEnergy > maxE * 1.2) { maxE = highEnergy; activeViseme = 'ee'; }
                        if (topEnergy > maxE * 1.3) { maxE = topEnergy; activeViseme = 'ou'; }
                    } else {
                        visemeWeight = 0;
                    }
                } else {
                    isSpeaking = false;
                    visemeWeight = 0;
                }

                // 5. Speech mouth shape vs Idle expressions mapping
                if (currentVRM.expressionManager) {
                    if (isSpeaking) {
                        ['aa', 'ih', 'ee', 'oh', 'ou'].forEach(v => {
                            currentVRM.expressionManager.setValue(v, v === activeViseme ? visemeWeight : 0);
                        });
                        
                        currentVRM.expressionManager.setValue('happy', 0);
                        currentVRM.expressionManager.setValue('angry', 0);
                        currentVRM.expressionManager.setValue('sad', 0);
                    } else {
                        currentVRM.expressionManager.setValue('aa', 0);
                        currentVRM.expressionManager.setValue('ih', 0);
                        currentVRM.expressionManager.setValue('ee', 0);
                        currentVRM.expressionManager.setValue('ou', 0);
                        currentVRM.expressionManager.setValue('oo', 0);
                        
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
            if (typeof resetIdleTimer === 'function') {
                resetIdleTimer();
            }

            // Fade out subtitles after 3 seconds of silence
            if (isSubtitleModeActive && subtitleOverlay) {
                setTimeout(() => {
                    // Check if Riko hasn't started speaking again or pending request
                    if (!isPlayingAudio && !isRequestPending) {
                        subtitleOverlay.style.opacity = '0';
                        setTimeout(() => {
                            // double check that state didn't change during transition
                            if (subtitleOverlay.style.opacity === '0') {
                                subtitleOverlay.style.display = 'none';
                                subtitleOverlay.style.opacity = '';
                            }
                        }, 400);
                    }
                }, 3000);
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

    // Sequential Audio Queue for Streaming Voice
    let audioQueue = [];
    let isPlayingAudio = false;

    function enqueueAudio(url, sentenceText) {
        audioQueue.push({ url, text: sentenceText });
        processAudioQueue();
    }

    function processAudioQueue() {
        if (isPlayingAudio || audioQueue.length === 0) return;
        isPlayingAudio = true;
        const item = audioQueue.shift();

        // Update Riko's face expressions dynamically for sentence
        updateAvatarEmotion(item.text, true);

        // Update subtitle overlay in real-time sentence-by-sentence
        if (isSubtitleModeActive && subtitleOverlay && subtitleTextEl) {
            subtitleOverlay.style.display = 'block';
            subtitleOverlay.style.opacity = '1';
            subtitleTextEl.textContent = item.text;
        }

        if (voicePlayer) {
            voicePlayer.src = item.url;
            voicePlayer.play().catch(err => {
                console.error('Audio play failed:', err);
                isPlayingAudio = false;
                processAudioQueue();
            });
        } else {
            isPlayingAudio = false;
        }
    }

    if (voicePlayer) {
        voicePlayer.addEventListener('ended', () => {
            isPlayingAudio = false;
            processAudioQueue();
        });
    }

    // Scoped audio playing helper
    function playAudio(url) {
        if (!voicePlayer) return;
        audioQueue = [];
        isPlayingAudio = false;
        voicePlayer.src = url;
        voicePlayer.play().catch(err => {
            console.error('Audio play failed:', err);
        });
    }
    window.playAudio = playAudio;

    // 8. Send Chat Message (Real-Time SSE Streaming with Vision & Tools)
    async function sendChatMessage(message) {
        if (!message || !message.trim() || isRequestPending) return;

        isRequestPending = true;
        fullAnswerText = ''; // reset on new prompt
        renderSuggestionPills('idle'); // reset to idle pills during generation
        audioQueue = [];
        isPlayingAudio = false;
        if (voicePlayer && !voicePlayer.paused) {
            voicePlayer.pause();
        }

        const attachedImage = currentAttachedImageBase64;
        currentAttachedImageBase64 = null;
        if (imageInput) imageInput.value = '';
        if (imagePreviewContainer) imagePreviewContainer.style.display = 'none';

        appendUserMessage(message, attachedImage);
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

        // Create Assistant Message DOM element to stream into
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message assistant';
        msgDiv.innerHTML = `
            <div class="message-content">
                <details class="reasoning-box" style="display:none;">
                    <summary>Reasoning Process</summary>
                    <div class="reasoning-text"></div>
                </details>
                <div class="chat-bubble-text">
                    <span class="text-content"></span>
                </div>
            </div>
        `;
        chatMessages.appendChild(msgDiv);
        
        const reasoningBox = msgDiv.querySelector('.reasoning-box');
        const reasoningTextEl = msgDiv.querySelector('.reasoning-text');
        const chatBubbleTextSpan = msgDiv.querySelector('.text-content');
        const chatBubbleContainer = msgDiv.querySelector('.chat-bubble-text');

        let fullThinkingText = '';
        let playedAudioUrls = [];

        try {
            const res = await fetch('/api/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message,
                    images: attachedImage ? [attachedImage] : null,
                    enable_tts: !isTtsMuted
                })
            });

            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop(); // Keep unparsed tail in buffer

                for (const part of parts) {
                    const line = part.trim();
                    if (line.startsWith('data: ')) {
                        try {
                            const event = JSON.parse(line.substring(6));
                            
                            if (event.type === 'thinking') {
                                reasoningBox.style.display = 'block';
                                fullThinkingText += event.content;
                                reasoningTextEl.textContent = fullThinkingText;
                                scrollToBottom();
                            } else if (event.type === 'warning') {
                                appendSystemMessage(event.content);
                            } else if (event.type === 'error') {
                                typingIndicator.style.display = 'none';
                                if (msgDiv) msgDiv.remove();
                                appendSystemMessage(`❌ Ollama Error: ${event.detail}`);
                            } else if (event.type === 'token') {
                                typingIndicator.style.display = 'none';
                                fullAnswerText += event.content;
                                chatBubbleTextSpan.innerHTML = formatMessageText(fullAnswerText);
                                if (typeof lucide !== 'undefined') lucide.createIcons();

                                if (isSubtitleModeActive && subtitleOverlay && subtitleTextEl) {
                                    subtitleOverlay.style.display = 'block';
                                    subtitleOverlay.style.opacity = '1';
                                    subtitleTextEl.textContent = fullAnswerText;
                                }

                                updateAvatarEmotion(fullAnswerText, false);
                                scrollToBottom();
                            } else if (event.type === 'sentence_audio') {
                                if (event.audio_url) {
                                    playedAudioUrls.push(event.audio_url);
                                    enqueueAudio(event.audio_url, event.text);
                                }
                            } else if (event.type === 'done') {
                                fullAnswerText = event.full_text || fullAnswerText;
                                chatBubbleTextSpan.innerHTML = formatMessageText(fullAnswerText);
                                if (typeof lucide !== 'undefined') lucide.createIcons();

                                if (isSubtitleModeActive && subtitleOverlay && subtitleTextEl) {
                                    subtitleOverlay.style.display = 'block';
                                    subtitleOverlay.style.opacity = '1';
                                    subtitleTextEl.textContent = fullAnswerText;
                                }

                                updateAvatarEmotion(fullAnswerText, false);
                                
                                // Add replay audio button if audio was generated
                                if (playedAudioUrls.length > 0) {
                                    const audioBtn = document.createElement('button');
                                    audioBtn.className = 'audio-play-btn';
                                    audioBtn.title = 'Replay voice';
                                    audioBtn.onclick = () => {
                                        playedAudioUrls.forEach(url => enqueueAudio(url, fullAnswerText));
                                    };
                                    audioBtn.innerHTML = '<i data-lucide="play" style="width:12px;height:12px;"></i>';
                                    chatBubbleContainer.appendChild(audioBtn);
                                    lucide.createIcons();
                                }
                                
                                if (fullAnswerText.includes('```')) {
                                    renderSuggestionPills('code');
                                } else {
                                    renderSuggestionPills('idle');
                                }
                                
                                setTimeout(loadChatHistory, 1000);
                            }
                        } catch (err) {
                            console.error('Error parsing SSE event:', err, line);
                        }
                    }
                }
            }
        } catch (err) {
            console.error("Streaming error, attempting standard fallback:", err);
            // If streaming fails, fallback to standard endpoint
            try {
                const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: message })
                });

                if (res.ok) {
                    const data = await res.json();
                    msgDiv.remove(); // Remove empty streaming bubble
                    appendAssistantMessage(data.text, data.thinking, data.audio_url);
                    setTimeout(loadChatHistory, 1000);
                } else {
                    appendSystemMessage("Error: Failed to fetch response from Riko.");
                }
            } catch (fallbackErr) {
                appendSystemMessage(`Network error connecting to backend: ${fallbackErr}`);
            }
        } finally {
            typingIndicator.style.display = 'none';
            chatInput.disabled = false;
            sendBtn.disabled = false;
            
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

    // 11. Microphone Recording via Browser Web Audio & Visualizer Canvas
    micBtn.addEventListener('click', async () => {
        if (!isRecording) {
            // Start recording
            try {
                audioChunks = [];
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                
                // Initialize visualizer context and analyser
                micAudioContext = new (window.AudioContext || window.webkitAudioContext)();
                const micSource = micAudioContext.createMediaStreamSource(stream);
                micAnalyser = micAudioContext.createAnalyser();
                micAnalyser.fftSize = 256;
                micSource.connect(micAnalyser);
                
                const bufferLength = micAnalyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                
                // Align canvas width with the input box size
                voiceWaveformCanvas.width = chatInput.clientWidth;
                voiceWaveformCanvas.height = chatInput.clientHeight;
                const canvasCtx = voiceWaveformCanvas.getContext('2d');
                
                // Swap text area with active canvas
                chatInput.style.display = 'none';
                voiceWaveformCanvas.style.display = 'block';
                
                // Waveform render loop
                function drawWaveform() {
                    if (!isRecording) return;
                    micAnimationId = requestAnimationFrame(drawWaveform);
                    
                    micAnalyser.getByteTimeDomainData(dataArray);
                    canvasCtx.clearRect(0, 0, voiceWaveformCanvas.width, voiceWaveformCanvas.height);
                    
                    canvasCtx.lineWidth = 3;
                    const gradient = canvasCtx.createLinearGradient(0, 0, voiceWaveformCanvas.width, 0);
                    gradient.addColorStop(0, '#ff9a9e');
                    gradient.addColorStop(0.5, '#fecfef');
                    gradient.addColorStop(1, '#a1c4fd');
                    canvasCtx.strokeStyle = gradient;
                    canvasCtx.lineCap = 'round';
                    
                    canvasCtx.beginPath();
                    const sliceWidth = voiceWaveformCanvas.width * 1.0 / bufferLength;
                    let x = 0;
                    
                    for (let i = 0; i < bufferLength; i++) {
                        const v = dataArray[i] / 128.0;
                        const y = v * voiceWaveformCanvas.height / 2;
                        
                        if (i === 0) {
                            canvasCtx.moveTo(x, y);
                        } else {
                            canvasCtx.lineTo(x, y);
                        }
                        x += sliceWidth;
                    }
                    
                    canvasCtx.lineTo(voiceWaveformCanvas.width, voiceWaveformCanvas.height / 2);
                    canvasCtx.stroke();
                }
                
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
                        // Cleanup visualizer
                        if (micAnimationId) {
                            cancelAnimationFrame(micAnimationId);
                            micAnimationId = null;
                        }
                        if (micAudioContext && micAudioContext.state !== 'closed') {
                            micAudioContext.close();
                            micAudioContext = null;
                        }
                        
                        voiceWaveformCanvas.style.display = 'none';
                        chatInput.style.display = 'block';

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
                drawWaveform();
                
                // Update UI state to recording
                micBtn.className = 'mic-btn recording';
                micIcon.setAttribute('data-lucide', 'square'); // click square to stop
                lucide.createIcons();
 
            } catch (err) {
                alert(`Could not access microphone: ${err}`);
                console.error('Mic access error:', err);
                
                // Safety cleanup
                if (micAnimationId) cancelAnimationFrame(micAnimationId);
                if (micAudioContext && micAudioContext.state !== 'closed') micAudioContext.close();
                voiceWaveformCanvas.style.display = 'none';
                chatInput.style.display = 'block';
                isRecording = false;
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
    let lastInteractionTime = 0;
    const INTERACTION_COOLDOWN = 5000; // 5s cooldown to prevent LLM/TTS request spamming

    // Raycaster for 3D model interaction
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

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

    function onCanvasClick(e) {
        if (!canvas || !currentVRM) return;

        // Get normalized device coordinates (-1 to +1) for the mouse/touch
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        
        if (clientX === undefined || clientY === undefined) return;
        
        mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

        // Update the raycaster with camera and mouse position
        raycaster.setFromCamera(mouse, camera);

        // Intersect objects in currentVRM.scene
        const intersects = raycaster.intersectObjects(currentVRM.scene.children, true);

        if (intersects.length > 0) {
            const hit = intersects[0];
            const hitPoint = hit.point; // World space position of hit
            
            // Traverse up to find if it belongs to a humanoid bone
            let boneName = null;
            let current = hit.object;
            while (current) {
                if (currentVRM.humanoid) {
                    for (const [name, bone] of Object.entries(currentVRM.humanoid.humanBones)) {
                        if (bone.node === current) {
                            boneName = name;
                            break;
                        }
                    }
                }
                if (boneName) break;
                current = current.parent;
            }

            // Spawn particles at click coordinates (relative to videoViewport container)
            const viewRect = videoViewport.getBoundingClientRect();
            const px = clientX - viewRect.left;
            const py = clientY - viewRect.top;

            if (boneName) {
                console.log("🎯 Intersected 3D bone:", boneName, "at Y:", hitPoint.y);
                
                // Determine action based on intersected bone and height
                if (boneName === 'head' || boneName === 'neck') {
                    if (hitPoint.y > 1.38) {
                        // Top of head -> Headpat
                        spawnParticle(px, py, ['🌸', '💖', '✨', '💕', '🥰']);
                        triggerInteraction("*pats your head gently*", 'headpat');
                    } else {
                        // Lower head/neck -> Cheek Poke
                        spawnParticle(px, py, ['💢', '⚡', '💥', '🙄']);
                        triggerInteraction("*pokes your cheek*", 'poke');
                    }
                } else {
                    // Arms, chest, hips -> Arm/Body Poke
                    spawnParticle(px, py, ['💢', '❓', '😤', '👊']);
                    triggerInteraction("*pokes your side ticklishly*", 'poke');
                }
            } else {
                // Fallback using height if bone mapping is not direct (e.g. hair/accessories)
                console.log("🎯 Intersected 3D mesh at Y:", hitPoint.y);
                if (hitPoint.y > 1.38) {
                    spawnParticle(px, py, ['🌸', '💖', '✨', '💕', '🥰']);
                    triggerInteraction("*pats your head gently*", 'headpat');
                } else if (hitPoint.y > 1.18) {
                    spawnParticle(px, py, ['💢', '⚡', '💥', '🙄']);
                    triggerInteraction("*pokes your cheek*", 'poke');
                } else {
                    spawnParticle(px, py, ['💢', '❓', '😤', '👊']);
                    triggerInteraction("*pokes your side ticklishly*", 'poke');
                }
            }
        }
    }

    if (canvas) {
        canvas.addEventListener('click', onCanvasClick);
    }

    // ==========================================================================
    // ==========================================================================
    // 11.8. Layout Selection Mode & Sakura Petals
    // ==========================================================================
    const sakuraContainer = document.getElementById('sakura-container');
    let sakuraInterval = null;

    function spawnSakuraPetal() {
        if (!sakuraContainer) return;
        const petal = document.createElement('div');
        petal.className = 'sakura-petal';
        
        const size = Math.random() * 8 + 6;
        const startX = Math.random() * window.innerWidth;
        const duration = Math.random() * 8 + 6;
        
        petal.style.width = `${size}px`;
        petal.style.height = `${size}px`;
        petal.style.left = `${startX}px`;
        petal.style.top = `-20px`;
        petal.style.animationDuration = `${duration}s`;
        
        sakuraContainer.appendChild(petal);
        
        setTimeout(() => {
            petal.remove();
        }, duration * 1000);
    }

    function startSakura() {
        if (!sakuraInterval) {
            sakuraInterval = setInterval(spawnSakuraPetal, 350);
        }
    }

    // Start falling petals
    startSakura();

    // ==========================================================================
    // 11.9. Idle UI Fading System (Disappearing UI)
    // ==========================================================================
    let idleTimer = null;
    const IDLE_TIMEOUT = 10000; // 10 seconds

    function resetIdleTimer() {
        document.body.classList.remove('idle-mode');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            // Only fade out if Riko isn't speaking and no API request is pending
            if (!isSpeaking && !isRequestPending) {
                document.body.classList.add('idle-mode');
            }
        }, IDLE_TIMEOUT);
    }

    // Register global event listeners to reset the idle timer on user activity
    window.addEventListener('mousemove', resetIdleTimer);
    window.addEventListener('keydown', resetIdleTimer);
    window.addEventListener('click', resetIdleTimer);
    window.addEventListener('touchstart', resetIdleTimer);

    // Initial trigger
    resetIdleTimer();

    // ==========================================================================
    // 11.95. Dragging Helper Function
    // ==========================================================================
    function makeDraggable(el, handle) {
        if (!el || !handle) return;
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        
        handle.onmousedown = dragMouseDown;
        handle.ontouchstart = dragTouchStart;

        function dragMouseDown(e) {
            e = e || window.event;
            // Prevent drag if click originates from an interactive element inside handle
            if (e.target !== handle && (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) {
                return;
            }
            e.preventDefault();
            
            // Mouse starting coordinates
            pos3 = e.clientX;
            pos4 = e.clientY;
            
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
            
            // Temporarily suspend transition duration to ensure high-performance dragging
            el.style.transition = 'none';
            
            // Lock current bounding position as absolute left/top styles
            const rect = el.getBoundingClientRect();
            el.style.top = rect.top + 'px';
            el.style.left = rect.left + 'px';
            el.style.bottom = 'auto';
            el.style.right = 'auto';
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            
            el.style.top = (el.offsetTop - pos2) + "px";
            el.style.left = (el.offsetLeft - pos1) + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
            el.style.transition = 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1), transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
        }

        function dragTouchStart(e) {
            if (e.target !== handle && (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) {
                return;
            }
            const touch = e.touches[0];
            pos3 = touch.clientX;
            pos4 = touch.clientY;
            
            document.ontouchend = closeTouchDrag;
            document.ontouchmove = touchDrag;
            
            el.style.transition = 'none';
            
            const rect = el.getBoundingClientRect();
            el.style.top = rect.top + 'px';
            el.style.left = rect.left + 'px';
            el.style.bottom = 'auto';
            el.style.right = 'auto';
        }

        function touchDrag(e) {
            const touch = e.touches[0];
            pos1 = pos3 - touch.clientX;
            pos2 = pos4 - touch.clientY;
            pos3 = touch.clientX;
            pos4 = touch.clientY;
            
            el.style.top = (el.offsetTop - pos2) + "px";
            el.style.left = (el.offsetLeft - pos1) + "px";
        }

        function closeTouchDrag() {
            document.ontouchend = null;
            document.ontouchmove = null;
            el.style.transition = 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1), transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
        }
    }

    // Initialize dragging on panels
    const chatContainerEl = document.querySelector('.chat-container');
    const chatDragHandleEl = document.getElementById('chat-drag-handle');
    const codePanelEl = document.querySelector('.code-studio-panel');
    const codeDragHandleEl = document.getElementById('code-drag-handle');

    makeDraggable(chatContainerEl, chatDragHandleEl);
    makeDraggable(codePanelEl, codeDragHandleEl);

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

    // Subtitle Toggle Button handler
    if (toggleSubtitleBtn) {
        toggleSubtitleBtn.addEventListener('click', () => {
            isSubtitleModeActive = !isSubtitleModeActive;
            document.body.classList.toggle('subtitle-mode-active', isSubtitleModeActive);
            toggleSubtitleBtn.classList.toggle('active', isSubtitleModeActive);

            // Clean up subtitle overlay display state
            if (!isSubtitleModeActive) {
                if (subtitleOverlay) {
                    subtitleOverlay.style.display = 'none';
                    subtitleOverlay.style.opacity = '';
                }
            } else {
                // If there's an ongoing response, show it in subtitles immediately
                if (isRequestPending && fullAnswerText) {
                    if (subtitleOverlay) {
                        subtitleOverlay.style.display = 'block';
                        subtitleOverlay.style.opacity = '1';
                    }
                    if (subtitleTextEl) {
                        subtitleTextEl.textContent = fullAnswerText;
                    }
                }
            }
        });
    }

    // Markdown Code Block Parser
    function formatMessageText(text) {
        if (!text) return '';
        let escaped = escapeHtml(text);
        const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
        return escaped.replace(codeBlockRegex, (match, lang, code) => {
            const cleanLang = lang.trim() || 'code';
            const cleanCode = code.trim();
            const codeId = 'code-' + Math.random().toString(36).substr(2, 9);

            // Escape quotes inside attribute
            const escapedCodeForAttr = cleanCode
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');

            return `
                <div class="chat-code-block" data-code="${escapedCodeForAttr}" data-lang="${cleanLang}">
                    <div class="chat-code-header">
                        <span class="chat-code-lang">${cleanLang}</span>
                        <div class="chat-code-actions">
                            <button class="chat-code-btn copy-btn" onclick="copyChatCode('${codeId}', this)">
                                <i data-lucide="clipboard" style="width:12px;height:12px;"></i> Copy
                            </button>
                            <button class="chat-code-btn inject-btn" onclick="injectToStudio(this)">
                                <i data-lucide="terminal" style="width:12px;height:12px;"></i> Send to Studio
                            </button>
                        </div>
                    </div>
                    <pre><code id="${codeId}">${cleanCode}</code></pre>
                </div>
            `;
        });
    }

    // Bind global functions to window object
    window.copyChatCode = (codeId, btn) => {
        const codeEl = document.getElementById(codeId);
        if (!codeEl) return;
        
        const rawCode = codeEl.textContent;
        navigator.clipboard.writeText(rawCode).then(() => {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = 'Copied!';
            setTimeout(() => {
                btn.innerHTML = originalHtml;
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }, 2000);
        }).catch(err => {
            console.error('Clipboard copy failed:', err);
        });
    };

    window.injectToStudio = (btn) => {
        const codeBlock = btn.closest('.chat-code-block');
        if (!codeBlock) return;
        const code = codeBlock.getAttribute('data-code');
        const lang = codeBlock.getAttribute('data-lang');

        // Open Code Studio Panel if closed
        const studioPanel = document.getElementById('code-studio-panel');
        const toggleBtn = document.getElementById('toggle-code-mode-btn');
        if (studioPanel && studioPanel.style.display === 'none') {
            studioPanel.style.display = 'flex';
            if (toggleBtn) toggleBtn.classList.add('active');
        }

        // Set editor content
        const editor = document.getElementById('code-studio-editor');
        if (editor) {
            const doc = new DOMParser().parseFromString(code, 'text/html');
            editor.value = doc.documentElement.textContent;
        }

        // Select correct language
        const langSelect = document.getElementById('code-lang-select');
        if (langSelect) {
            const normalizedLang = lang.toLowerCase();
            if (normalizedLang.includes('py')) langSelect.value = 'python';
            else if (normalizedLang.includes('js') || normalizedLang.includes('ts')) langSelect.value = 'javascript';
            else if (normalizedLang.includes('html') || normalizedLang.includes('css')) langSelect.value = 'html';
            else if (normalizedLang.includes('sql')) langSelect.value = 'sql';
        }
    };

    // AI Suggestion Pills Rendering Setup
    const idleSuggestions = [
        { label: '🌸 *pat Riko\'s head*', value: '*pat Riko\'s head*' },
        { label: '👋 yo Riko!', value: 'yo Riko!' },
        { label: '💻 Help me code', value: 'Help me code' }
    ];

    const codeSuggestions = [
        { label: '🔍 Explain code', value: 'Can you explain the code you just wrote?' },
        { label: '🔧 Fix bugs', value: 'Are there any potential bugs in this code?' },
        { label: '⚙️ Refactor', value: 'Can you refactor this code to make it clean?' }
    ];

    function renderSuggestionPills(type) {
        if (!suggestionPillsContainer) return;
        suggestionPillsContainer.innerHTML = '';

        const list = type === 'code' ? codeSuggestions : idleSuggestions;
        list.forEach(item => {
            const pill = document.createElement('button');
            pill.className = 'suggestion-pill';
            pill.textContent = item.label;
            pill.addEventListener('click', () => {
                sendSuggestion(item.value);
            });
            suggestionPillsContainer.appendChild(pill);
        });
    }

    function sendSuggestion(val) {
        if (isRequestPending) return;
        sendChatMessage(val);
    }

    // Render initial suggestions
    renderSuggestionPills('idle');
});

