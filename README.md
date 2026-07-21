# Project Riko

Project Riko is an anime-focused LLM project by Just Rayen. She listens, and remembers your conversations. It combines local Ollama (supporting reasoning models like `ornith:9b`), GPT-SoVITS voice synthesis, and Faster-Whisper ASR into a fully configurable conversational pipeline.

**tested with python 3.10 and python 3.14 on Windows >= 10 and Linux Ubuntu**

## ✨ Features

- 💬 **Local LLM-based dialogue** using Ollama API (configured with `ornith:9b`)
- 🤖 **Reasoning Model Support:** Automatically strips thinking blocks (`<think>...</think>`) before voice synthesis
- 🧠 **Hybrid Memory Architecture:** Combines short-term rolling context with consolidated long-term facts
- 🔊 **Voice generation** via GPT-SoVITS API (relative path path-resolution)
- 🎧 **Speech recognition** using Faster-Whisper
- 🎙️ **Voice Activity Detection (VAD):** Automatically detects speech and silence to trigger recording hands-free (or manual Enter-key PTT)
- 🔌 **Graceful Fallbacks:** Falls back to text-only mode automatically if the microphone or TTS server is offline
- 📁 Clean, separate configs for application setup and character personality

---

## ⚙️ Configuration

System parameters and personality presets are split into two files located in the project root:

### 1. `config.yaml` (App Settings)
Contains host endpoints, files, and memory consolidation parameters:
```yaml
ollama_host: "http://localhost:11434"
model: "ornith:9b"
history_file: "chat_history.json"
long_term_memory_file: "long_term_memory.json"
max_short_term_turns: 8  # number of conversational turns before old ones are consolidated
recording_mode: "vad"    # "vad" or "manual"
vad_threshold: 0.02      # sensitivity threshold for speech detection
vad_silence_duration: 1.5 # seconds of silence before stopping recording
```

### 2. `character_config.yaml` (Persona & Voice)
Allows swapping out personalities and voice samples:
```yaml
presets:
  default:
    system_prompt: |
      You are a helpful assistant named Riko.
      You speak like a snarky anime girl.
      Always refer to the user as "senpai".

sovits_ping_config:
  text_lang: en
  prompt_lang: en
  ref_audio_path: character_files/main_sample.wav
  prompt_text: This is a sample voice for you to just get started with because it sounds kind of cute but just make sure this doesn't have long silences.
```

---

## 🧠 Memory Architecture

Riko uses a dual-layer memory system to maintain context without overloading the LLM's context window:

```
[User Input] ──> [LLM Query] <── [System Prompt + Long-term Facts]
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
    [Short-Term Memory]     [Response] ──> [TTS Server]
    (chat_history.json)
             │
      (Exceeds Limit)
             ▼
    [Consolidation Prompt]
             ▼
     [Ollama Fact Extractor]
             ▼
    [Long-Term Fact Store]
   (long_term_memory.json)
```

1. **Short-Term Memory (`chat_history.json`):** Tracks the raw rolling dialogue context of the last $N$ turns (configured via `max_short_term_turns`).
2. **Long-Term Memory (`long_term_memory.json`):** Holds a consolidated list of durable facts and user preferences extracted from earlier exchanges (e.g., user name, favorite color, location).
3. **Consolidation Pipeline:** When the short-term conversation window exceeds the configured limit, Riko automatically takes the oldest half of the conversation, asks the LLM to extract/merge facts with existing ones, saves them to `long_term_memory.json`, and prunes them from `chat_history.json`.
4. **Prompt Injection:** At each turn, all active long-term facts are formatted as a bulleted list and appended to the base system prompt before calling the LLM.
5. **Pluggable Storage:** Both memory layers use a pluggable architecture. The memory store implements `BaseMemoryStore` (defined in `server/memory.py`). You can swap out the default `JSONMemoryStore` for an SQLite, Redis, or Vector Database store without changing any application orchestration code.

---

## 🛠️ Setup

### 1. Initialize Python Environment
Create a virtual environment and install the required dependencies:
```bash
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

### 2. Install Hardware Tools
* Make sure you have **FFmpeg** installed and in your system PATH (required for audio recording and playback).
* For GPU acceleration in transcription, make sure you have CUDA & cuDNN installed.

### 3. Setup Ollama
1. Download and run [Ollama](https://ollama.com).
2. Pull the default reasoning model:
   ```bash
   ollama pull ornith:9b
   ```

---

## 🧪 Usage

### 🚀 One-Click Quick Start (Recommended)

Run everything automatically (Ollama check, GPT-SoVITS TTS launch, Riko API server, and browser auto-open):

- **Windows:** Double-click `run_all.bat` or run in terminal:
  ```cmd
  run_all.bat
  ```
- **Terminal / Cross-platform:**
  ```bash
  .venv\Scripts\python run_all.py
  ```

---

### Manual Launch

If you prefer to start services individually:

### 1. Launch the GPT-SoVITS API Server

Navigate to your local GPT-SoVITS repository directory and run the `api_v2.py` server.

> [!WARNING]
> **Windows UTF-8 Encoding Requirement:** On Windows, print statements inside the GPT-SoVITS pipeline containing Chinese characters (e.g., `推理`) will trigger a `UnicodeEncodeError` in standard consoles, causing voice generation to fail and return silent audio. You **must** set the environment variable `PYTHONIOENCODING=utf-8` before launching the script.

- **Windows (PowerShell):**
  ```powershell
  $env:PYTHONIOENCODING="utf-8"
  .\runtime\python.exe api_v2.py
  ```
- **Windows (Command Prompt):**
  ```cmd
  set PYTHONIOENCODING=utf-8
  .\runtime\python.exe api_v2.py
  ```
- **Linux / macOS:**
  ```bash
  PYTHONIOENCODING=utf-8 python api_v2.py
  ```

This starts the voice synthesis API on port `9880`.

### 2. Launch the Riko Companion Web UI Server
In the Riko project directory, start the FastAPI backend server:
- **Windows:**
  ```powershell
  .venv\Scripts\python server/main_api.py
  ```
- **Linux / macOS:**
  ```bash
  .venv/bin/python server/main_api.py
  ```

Now open **[http://127.0.0.1:8000](http://127.0.0.1:8000)** in your web browser. 

* The status badges in the top-right header show you if Riko is successfully connected to your local **LLM** (Ollama), **TTS** (GPT-SoVITS), and **ASR** (Whisper).
* You can speak to her by clicking the microphone button (VAD automatically records and sends your speech, or you can switch to manual Enter-key PTT in the Settings drawer).
* Click the settings cog in the top right to adjust LLM model settings, change system prompts, or view consolidated long-term memory facts.

### 3. Alternative: Run the CLI Chat Orchestrator
If you prefer a console-based terminal interface, you can run:
```bash
.venv\Scripts\python server/main_chat.py
```
* If the ASR/TTS servers are offline, the script automatically runs in a text-only fallback terminal mode.

### 4. Run the Test Suite
To verify that Ollama connectivity, system configuration validation, thinking tag parser, and memory consolidation are all functioning correctly, run:
```bash
.venv\Scripts\python server/test_companion.py
```

---

## 📜 License

MIT — feel free to clone, modify, and build your own local companion.
