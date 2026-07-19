import os
import sys
import uuid
import yaml
import re
import requests
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Ensure server path is in sys.path
server_dir = os.path.dirname(os.path.abspath(__file__))
if server_dir not in sys.path:
    sys.path.insert(0, server_dir)

from path_utils import get_project_path, get_server_path
from config_validator import validate_and_check_services
from memory import MemoryManager, strip_thinking
import ollama

app = FastAPI(title="Riko AI Companion API")

# Initialize state variables
config = {}
char_config = {}
whisper_model = None
memory_manager = None
ollama_client = None
MODEL = ""

def extract_thinking(text: str) -> str:
    """
    Extracts the reasoning inside <think>...</think> tags.
    """
    match = re.search(r'<think>(.*?)</think>', text, flags=re.DOTALL)
    if match:
        return match.group(1).strip()
    match_unclosed = re.search(r'<think>(.*)$', text, flags=re.DOTALL)
    if match_unclosed:
        return match_unclosed.group(1).strip()
    return ""

def initialize_services():
    global config, char_config, whisper_model, memory_manager, ollama_client, MODEL
    
    # Run validation
    success, tts_available, mic_available, loaded_config, loaded_char_config, error_msg = validate_and_check_services()
    if not success:
        print(f"❌ Startup validation failed: {error_msg}")
        # Fail fast in terminal logs, but keep API running to allow config fixes via UI
        config = {"ollama_host": "http://localhost:11434", "model": "ornith:9b", "history_file": "chat_history.json", "long_term_memory_file": "long_term_memory.json"}
        char_config = {"presets": {"default": {"system_prompt": "You are a helpful assistant."}}, "sovits_ping_config": {}}
    else:
        config = loaded_config
        char_config = loaded_char_config

    # Setup Memory
    memory_manager = MemoryManager(config, char_config)
    
    # Setup Ollama client
    ollama_host = config.get('ollama_host', 'http://localhost:11434')
    ollama_client = ollama.Client(host=ollama_host)
    MODEL = config.get('model', 'ornith:9b')
    
    # Setup Whisper Model for browser uploads
    try:
        from faster_whisper import WhisperModel
        print("Loading Whisper model for web audio transcription...")
        whisper_model = WhisperModel("base.en", device="cpu", compute_type="float32")
        print("Whisper model loaded!")
    except Exception as e:
        print(f"⚠️ Could not load Whisper model: {e}")
        whisper_model = None

# Run initialization on startup
initialize_services()

# API Endpoints

class ChatRequest(BaseModel):
    message: str

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    global MODEL, ollama_client, memory_manager
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Empty message")

    try:
        # 1. Load History & Append User Message
        history = memory_manager.load_short_term()
        history.append({
            "role": "user",
            "content": [{"type": "input_text", "text": message}]
        })
        memory_manager.save_short_term(history)

        # 2. Get prompt messages with long-term memories
        prompt_messages = memory_manager.get_prompt_messages()

        # 3. Format to Ollama Schema
        ollama_messages = []
        for msg in prompt_messages:
            role = msg.get('role')
            content_list = msg.get('content', [])
            content_text = ""
            if isinstance(content_list, list):
                content_text = " ".join([c.get('text', '') for c in content_list if isinstance(c, dict)])
            else:
                content_text = str(content_list)
            
            ollama_messages.append({
                "role": role,
                "content": content_text
            })

        # 4. Request Ollama
        response = ollama_client.chat(
            model=MODEL,
            messages=ollama_messages
        )
        raw_response = response.get('message', {}).get('content', '')

        # 5. Extract thinking & clean response
        thinking = extract_thinking(raw_response)
        clean_response = strip_thinking(raw_response)
        if not clean_response:
            clean_response = "I see. Let's talk about something else, senpai."

        # 6. Save assistant response to short-term history
        history = memory_manager.load_short_term()
        history.append({
            "role": "assistant",
            "content": [{"type": "output_text", "text": clean_response}]
        })
        memory_manager.save_short_term(history)

        # 7. Consolidate Memory
        memory_manager.consolidate(ollama_client, MODEL)

        # 8. Generate TTS if GPT-SoVITS is available
        audio_url = None
        tts_active = False
        
        # Test TTS availability
        tts_available = False
        try:
            resp = requests.get("http://127.0.0.1:9880/tts", timeout=1)
            tts_available = True
        except Exception:
            pass

        if tts_available:
            from process.tts_func.sovits_ping import sovits_gen
            uid = uuid.uuid4().hex
            filename = f"output_{uid}.wav"
            audio_dir = get_project_path("audio")
            os.makedirs(audio_dir, exist_ok=True)
            output_path = os.path.join(audio_dir, filename)
            
            gen_path = sovits_gen(clean_response, output_path)
            if gen_path and os.path.exists(gen_path):
                audio_url = f"/api/audio/{filename}"
                tts_active = True

        return {
            "text": clean_response,
            "thinking": thinking,
            "audio_url": audio_url,
            "tts_active": tts_active
        }

    except Exception as e:
        print(f"Error in chat endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/transcribe")
async def transcribe_endpoint(file: UploadFile = File(...)):
    global whisper_model
    if not whisper_model:
        raise HTTPException(status_code=503, detail="Speech recognition model is not loaded/available on backend.")
    
    try:
        # Save temp file
        temp_dir = get_project_path("audio")
        os.makedirs(temp_dir, exist_ok=True)
        temp_file_path = os.path.join(temp_dir, "temp_upload.wav")
        
        with open(temp_file_path, "wb") as buffer:
            shutil_data = await file.read()
            buffer.write(shutil_data)
            
        print("🎯 Web audio received. Transcribing...")
        segments, _ = whisper_model.transcribe(temp_file_path)
        transcription = " ".join([segment.text for segment in segments]).strip()
        print(f"Web Transcription: '{transcription}'")
        
        # Clean up temp file
        try:
            os.remove(temp_file_path)
        except Exception:
            pass
            
        return {"text": transcription}
    except Exception as e:
        print(f"Error in transcription endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/history/clear")
async def clear_history_endpoint():
    global memory_manager
    if memory_manager:
        try:
            if os.path.exists(memory_manager.history_file):
                os.remove(memory_manager.history_file)
            # Re-initialize to default system prompt
            memory_manager.load_short_term()
            return {"status": "success", "message": "Chat history cleared!"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return {"status": "error", "message": "Memory manager not initialized"}

@app.get("/api/audio/{filename}")
async def get_audio_endpoint(filename: str):
    audio_path = os.path.join(get_project_path("audio"), filename)
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(audio_path, media_type="audio/wav")

@app.get("/api/config")
async def get_config_endpoint():
    config_path = get_project_path("config.yaml")
    char_path = get_project_path("character_config.yaml")
    
    app_cfg = {}
    char_cfg = {}
    
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            app_cfg = yaml.safe_load(f) or {}
            
    if os.path.exists(char_path):
        with open(char_path, 'r', encoding='utf-8') as f:
            char_cfg = yaml.safe_load(f) or {}
            
    return {
        "app_config": app_cfg,
        "char_config": char_cfg
    }

class ConfigSaveRequest(BaseModel):
    app_config: dict
    char_config: dict

@app.post("/api/config")
async def save_config_endpoint(request: ConfigSaveRequest):
    config_path = get_project_path("config.yaml")
    char_path = get_project_path("character_config.yaml")
    
    try:
        with open(config_path, 'w', encoding='utf-8') as f:
            yaml.safe_dump(request.app_config, f, default_flow_style=False, allow_unicode=True)
            
        with open(char_path, 'w', encoding='utf-8') as f:
            yaml.safe_dump(request.char_config, f, default_flow_style=False, allow_unicode=True)
            
        # Re-initialize services with new config
        initialize_services()
        return {"status": "success", "message": "Configuration updated successfully!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history")
async def get_history_endpoint():
    global memory_manager
    if not memory_manager:
        return {"short_term": [], "long_term": []}
        
    short_term = memory_manager.load_short_term()
    long_term = memory_manager.load_long_term()
    
    # Strip system prompt from short term history presented to UI
    ui_short_term = [m for m in short_term if m.get('role') != 'system']
    
    return {
        "short_term": ui_short_term,
        "long_term": long_term
    }

@app.get("/api/status")
async def get_status_endpoint():
    ollama_ok = False
    tts_ok = False
    whisper_ok = whisper_model is not None
    mic_ok = False
    
    # 1. Check Ollama
    try:
        resp = requests.get(f"{config.get('ollama_host', 'http://localhost:11434')}/api/tags", timeout=1)
        ollama_ok = resp.status_code == 200
    except Exception:
        pass
        
    # 2. Check TTS
    try:
        resp = requests.get("http://127.0.0.1:9880/tts", timeout=1)
        # Standard server returns 405 for GET on /tts but connection is live
        tts_ok = True
    except requests.exceptions.ConnectionError:
        tts_ok = False
    except Exception:
        tts_ok = True
        
    # 3. Check Mic
    try:
        import sounddevice as sd
        devices = sd.query_devices()
        input_devices = [d for d in devices if d['max_input_channels'] > 0]
        mic_ok = len(input_devices) > 0
    except Exception:
        mic_ok = False
        
    return {
        "ollama": ollama_ok,
        "tts": tts_ok,
        "whisper": whisper_ok,
        "mic": mic_ok
    }

@app.get("/")
async def read_index():
    index_path = get_server_path("static", "index.html")
    if not os.path.exists(index_path):
        # Fallback if UI is not created yet
        return JSONResponse({"status": "running", "message": "Riko API is running, UI index.html is missing."})
    return FileResponse(index_path)

# Serve static files folder
static_dir = get_server_path("static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Serve video assets folder
em_dir = get_project_path("em")
os.makedirs(em_dir, exist_ok=True)
app.mount("/em", StaticFiles(directory=em_dir), name="em")

if __name__ == "__main__":
    import uvicorn
    # Clean up generated audio files at startup
    try:
        audio_dir = get_project_path("audio")
        if os.path.exists(audio_dir):
            for fp in Path(audio_dir).glob("*.wav"):
                fp.unlink()
    except Exception:
        pass
    
    print("\n🚀 Launching Riko Web UI API server...")
    print("Open http://127.0.0.1:8000 in your browser.\n")
    uvicorn.run(app, host="127.0.0.1", port=8000)
