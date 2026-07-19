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
        // Update Riko's face expressions and emotion dynamically
        updateAvatarEmotion(text);

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

    // Video mapping config utilizing all 13 videos in the /em directory
    const videoMap = {
        // Idle loops
        'idle_neutral': '/em/Woman_resting_idle_202607192147.mp4',
        'idle_happy': '/em/Woman_smiles_hand_over_heart_202607192152.mp4',
        'idle_happy_excited': '/em/Character_grins_flashes_peace_sign_202607192153.mp4',
        'idle_happy_greeting': '/em/Character_smiles_and_waves_202607192153.mp4',
        'idle_annoyed': '/em/Woman_crosses_arms_frustrated_202607192152.mp4',
        'idle_sad': '/em/Woman_covers_face_distressed_crying_202607192149.mp4',
        'idle_thinking': '/em/Woman_thinking_looking_202607192148.mp4',
        'idle_thinking_active': '/em/Woman_thinking_looking_202607192148.mp4',

        // Speaking loops
        'speak_neutral': '/em/Woman_explaining_complex_idea_202607192146.mp4',
        'speak_happy': '/em/Character_laughing_on_balcony_202607192153.mp4',
        'speak_annoyed': '/em/Woman_speaking_with_angry_expression_202607192146.mp4',
        'speak_annoyed_intense': '/em/Character_points_finger_angrily_202607192152.mp4',
        'speak_sad': '/em/Woman_wipes_tear_sad_expression_202607192150.mp4'
    };

    const thinkingVideo = '/em/Woman_thinking_looking_202607192148.mp4';

    function getThinkingVideo() {
        return thinkingVideo;
    }

    let isSpeaking = false;
    let speakEmotion = 'neutral';
    // Instant, black-screen-proof video source swapper
    function setAvatarVideo(src) {
        if (!characterVideo) return;
        
        // Compare with full URL resolved source to prevent unnecessary re-swaps
        const absoluteSrc = new URL(src, window.location.href).href;
        if (characterVideo.src === absoluteSrc) return;
        
        currentVideoSrc = src;
        
        // Directly update source and play with muted compliance
        characterVideo.src = src;
        characterVideo.muted = true;
        characterVideo.play().catch(err => {
            console.warn("Autoplay failed:", err);
        });
    }

    // Fallback: Start playing video on first user interaction if blocked by browser autoplay policy
    const playOnInteraction = () => {
        if (characterVideo && characterVideo.paused) {
            characterVideo.play().catch(err => {
                console.log("First interaction play attempt failed:", err);
            });
        }
        document.removeEventListener('click', playOnInteraction);
        document.removeEventListener('keydown', playOnInteraction);
    };
    document.addEventListener('click', playOnInteraction);
    document.addEventListener('keydown', playOnInteraction);

    // Update Avatar Emotion and Status based on text content
    function updateAvatarEmotion(text) {
        if (!videoViewport || !characterVideo) return;
        
        // Comprehensive tsundere and dynamic sentiment matching
        const annoyedIntenseRegex = /shut up|hate you|go away|idiot|baka|annoyed|bothering|stupid|jerk|stop/i;
        const annoyedRegex = /[😤💢😡👿🤬]|ugh|boring|goldfish|tsundere|irritated|huff/iu;
        
        const happyGreetingRegex = /\b(hi|hello|hey|welcome|greet|greetings|morning)\b/i;
        const happyExcitedRegex = /excited|thrilled|great|wonderful|fantastic|yay|awesome|amazing/i;
        const happyRegex = /[😊✨💖💕❤️😍🌟🎉🌸🥰]|happy|love|smile|cute|senpai|thank/iu;
        
        const sadRegex = /[😢😭💔😰🤧😿]|sad|cry|hurt|tears|sorry|lonely|depressed|unhappy|distressed/iu;
        const thinkingRegex = /\.\.\.|\?|hmm|thinking|wonder|curious|ponder/i;
        
        let emotion = 'neutral';
        let emoji = '';
        let status = 'Idle';
        
        // Select appropriate emotion
        if (sadRegex.test(text)) {
            emotion = 'sad';
            emoji = '💧';
            status = 'Sad';
        } else if (annoyedIntenseRegex.test(text)) {
            emotion = 'annoyed';
            emoji = '💢';
            status = 'Angry';
        } else if (annoyedRegex.test(text)) {
            emotion = 'annoyed';
            emoji = '💢';
            status = 'Annoyed';
        } else if (happyGreetingRegex.test(text)) {
            emotion = 'happy';
            emoji = '👋';
            status = 'Greeting';
        } else if (happyExcitedRegex.test(text)) {
            emotion = 'happy';
            emoji = '✨';
            status = 'Excited';
        } else if (happyRegex.test(text)) {
            emotion = 'happy';
            emoji = '💖';
            status = 'Happy';
        } else if (thinkingRegex.test(text)) {
            emotion = 'thinking';
            emoji = '💭';
            status = 'Thinking';
        }
        
        currentEmotion = emotion;
        speakEmotion = emotion;
        
        // Save sub-emotion flags
        if (emotion === 'happy') {
            if (happyGreetingRegex.test(text)) speakEmotion = 'happy_greeting';
            else if (happyExcitedRegex.test(text)) speakEmotion = 'happy_excited';
        } else if (emotion === 'annoyed') {
            if (annoyedIntenseRegex.test(text)) speakEmotion = 'annoyed_intense';
        }
        
        videoViewport.className = `video-viewport ${emotion}`;
        charStatus.textContent = status;
        
        // Switch to the correct idle video when not speaking
        if (!isSpeaking) {
            let idleKey = `idle_${speakEmotion}`;
            if (!videoMap[idleKey]) idleKey = `idle_${emotion}`;
            
            if (emotion === 'thinking') {
                setAvatarVideo(getThinkingVideo());
            } else {
                setAvatarVideo(videoMap[idleKey] || videoMap['idle_neutral']);
            }
        }
        
    }

    // Voice player audio listeners for dynamic video sync
    if (voicePlayer) {
        voicePlayer.addEventListener('play', () => {
            isSpeaking = true;
            if (videoViewport) {
                videoViewport.classList.add('speaking');
                charStatus.textContent = 'Speaking';
                
                // Select corresponding speaking video
                let speakKey = `speak_${speakEmotion}`;
                if (!videoMap[speakKey]) speakKey = `speak_${currentEmotion}`;
                setAvatarVideo(videoMap[speakKey] || videoMap['speak_neutral']);
            }
        });
        
        const returnToIdle = () => {
            isSpeaking = false;
            if (videoViewport) {
                videoViewport.classList.remove('speaking');
                
                // Capitalize emotion name for status display
                let displayStatus = currentEmotion.charAt(0).toUpperCase() + currentEmotion.slice(1);
                charStatus.textContent = displayStatus;
                
                // Switch back to correct idle video
                let idleKey = `idle_${speakEmotion}`;
                if (!videoMap[idleKey]) idleKey = `idle_${currentEmotion}`;
                setAvatarVideo(videoMap[idleKey] || videoMap['idle_neutral']);
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
        if (!message || !message.trim()) return;

        appendUserMessage(message);
        chatInput.value = '';
        
        // Show typing indicator, active thinking state and video
        typingIndicator.style.display = 'flex';
        chatInput.disabled = true;
        sendBtn.disabled = true;
        scrollToBottom();

        charStatus.textContent = 'Thinking';
        if (videoViewport) {
            videoViewport.className = 'video-viewport thinking';
        }
        setAvatarVideo(getThinkingVideo());

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

    // 12. Auto-run startup fetches
    updateServiceStatus();
    loadConfiguration();
    loadChatHistory();
    setAvatarVideo(videoMap['idle_neutral']);

    // Poll statuses every 10 seconds
    setInterval(updateServiceStatus, 10000);
});
