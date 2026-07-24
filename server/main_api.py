import os
import sys
import uuid
import yaml
import re
import json
import requests
import psutil
from datetime import datetime
from typing import Optional, List
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, Response
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

# System Metrics Monitoring Background Loop
import threading
import time
import ctypes

current_cpu_percent = 0.0
current_ram_percent = 0.0

class MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ('dwLength', ctypes.c_ulong),
        ('dwMemoryLoad', ctypes.c_ulong),
        ('ullTotalPhys', ctypes.c_ulonglong),
        ('ullAvailPhys', ctypes.c_ulonglong),
        ('ullTotalPageFile', ctypes.c_ulonglong),
        ('ullAvailPageFile', ctypes.c_ulonglong),
        ('ullTotalVirtual', ctypes.c_ulonglong),
        ('ullAvailVirtual', ctypes.c_ulonglong),
        ('ullAvailExtendedVirtual', ctypes.c_ulonglong),
    ]

def _metrics_monitor_loop():
    global current_cpu_percent, current_ram_percent
    while True:
        try:
            c = psutil.cpu_percent(interval=0.5)
            r = psutil.virtual_memory().percent
            current_cpu_percent = round(c, 1)
            current_ram_percent = round(r, 1)
        except Exception:
            try:
                stat = MEMORYSTATUSEX()
                stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
                ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
                current_ram_percent = float(stat.dwMemoryLoad)
            except Exception:
                pass
        time.sleep(1.5)

threading.Thread(target=_metrics_monitor_loop, daemon=True).start()

def initialize_services():
    global config, char_config, whisper_model, memory_manager, ollama_client, MODEL
    
    # Run validation
    success, tts_available, mic_available, loaded_config, loaded_char_config, error_msg = validate_and_check_services()
    if not success:
        print(f"⚠️ Service check notice: {error_msg}")
        config = loaded_config or {"ollama_host": "http://localhost:11434", "model": "ornith:9b", "history_file": "chat_history.json", "long_term_memory_file": "long_term_memory.json"}
        char_config = loaded_char_config or {"presets": {"default": {"system_prompt": "You are a helpful assistant."}}, "sovits_ping_config": {}}
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

    # Prime psutil CPU percentage tracker
    try:
        psutil.cpu_percent(interval=None)
    except Exception:
        pass

# Run initialization on startup
initialize_services()  # Config reloaded with turn limit 80

# API Endpoints

class ChatRequest(BaseModel):
    message: str
    images: Optional[List[str]] = None
    enable_tts: Optional[bool] = True

def get_system_time_tool():
    now = datetime.now()
    return f"Current local date & time: {now.strftime('%A, %B %d, %Y at %I:%M %p')}"

def get_weather_tool(location="auto"):
    try:
        url = f"https://wttr.in/{requests.utils.quote(location)}?format=3"
        resp = requests.get(url, timeout=3)
        if resp.status_code == 200 and resp.text.strip():
            return f"Weather report: {resp.text.strip()}"
    except Exception:
        pass
    return None

def web_search_tool(query):
    try:
        url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(query)}"
        headers = {'User-Agent': 'Mozilla/5.0'}
        resp = requests.get(url, headers=headers, timeout=4)
        if resp.status_code == 200:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(resp.text, 'html.parser')
            snippets = []
            for a in soup.find_all('a', class_='result__snippet', limit=3):
                snippets.append(a.text.strip())
            if snippets:
                return "\n".join(snippets)
    except Exception:
        pass
    return None

def detect_and_execute_tools(user_message: str) -> str:
    results = []
    msg_lower = user_message.lower()

    if any(k in msg_lower for k in ['time', 'date', 'day is it', 'what time', 'clock']):
        results.append(get_system_time_tool())

    if 'weather' in msg_lower or 'temperature' in msg_lower:
        loc = "auto"
        words = user_message.split()
        for i, w in enumerate(words):
            if w.lower() in ['in', 'for', 'at'] and i + 1 < len(words):
                loc = words[i+1].strip("?.!")
                break
        res = get_weather_tool(loc)
        if res:
            results.append(res)

    if any(msg_lower.startswith(k) for k in ['search ', 'look up ', 'who is ', 'what is ']) and 'weather' not in msg_lower and 'time' not in msg_lower:
        res = web_search_tool(user_message)
        if res:
            results.append(f"Web Search snippets for '{user_message}':\n{res}")

    if results:
        return "\n".join([r for r in results if r])
    return ""

def safe_ollama_chat_call(ollama_client, model: str, messages: list, stream: bool = False):
    options = {
        "num_predict": 128,
        "temperature": 0.7,
        "top_k": 30
    }
    def clean_messages():
        for m in messages:
            if isinstance(m, dict) and "images" in m:
                del m["images"]
        if len(messages) > 0 and messages[0].get('role') == 'system':
            messages[0]['content'] += f"\n\n(System Note: The user attached an image, but active model '{model}' is text-only. Inform the user to switch to a vision model like 'llama3.2-vision' or 'llava' to analyze images.)"

    if stream:
        def stream_wrapper():
            try:
                stream_iter = ollama_client.chat(model=model, messages=messages, stream=True, keep_alive="24h", options=options)
                for chunk in stream_iter:
                    yield chunk
            except Exception as e:
                err_msg = str(e)
                if "Multimodal data provided" in err_msg or "does not support multimodal" in err_msg:
                    print(f"⚠️ Model '{model}' does not support vision/images. Retrying stream with text-only payload...")
                    clean_messages()
                    # Yield warning payload to stream caller
                    yield {'warning': f"⚠️ Model '{model}' does not support images. Image was not analyzed. Please switch to a vision model (e.g., llama3.2-vision or llava) in Settings."}
                    retry_stream = ollama_client.chat(model=model, messages=messages, stream=True, keep_alive="24h", options=options)
                    for chunk in retry_stream:
                        yield chunk
                else:
                    raise e
        return stream_wrapper()
    else:
        try:
            return ollama_client.chat(model=model, messages=messages, stream=False, keep_alive="24h", options=options)
        except Exception as e:
            err_msg = str(e)
            if "Multimodal data provided" in err_msg or "does not support multimodal" in err_msg:
                print(f"⚠️ Model '{model}' does not support vision/images. Retrying with text-only payload...")
                clean_messages()
                return ollama_client.chat(model=model, messages=messages, stream=False, keep_alive="24h", options=options)
            raise e

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    global MODEL, ollama_client, memory_manager
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Empty message")

    active_model = "llama3.2-vision" if request.images else MODEL

    try:
        # 1. Load History & Append User Message
        history = memory_manager.load_short_term()
        user_content = [{"type": "input_text", "text": message}]
        if request.images:
            for img in request.images:
                user_content.append({"type": "input_image", "image": img})
        history.append({
            "role": "user",
            "content": user_content
        })
        memory_manager.save_short_term(history)

        # 2. Get prompt messages with relevant long-term memories via RAG
        prompt_messages = memory_manager.get_prompt_messages(message)

        # 3. Format to Ollama Schema
        ollama_messages = []
        for msg in prompt_messages:
            role = msg.get('role')
            content_list = msg.get('content', [])
            content_text = ""
            images = []
            if isinstance(content_list, list):
                content_text = " ".join([c.get('text', '') for c in content_list if isinstance(c, dict) and c.get('type') == 'input_text'])
                for c in content_list:
                    if isinstance(c, dict) and c.get('type') == 'input_image' and c.get('image'):
                        img_data = c.get('image')
                        clean_img = img_data.split(",", 1)[1] if "," in img_data else img_data
                        images.append(clean_img)
            else:
                content_text = str(content_list)
            
            msg_dict = {
                "role": role,
                "content": content_text
            }
            if images:
                msg_dict["images"] = images
            ollama_messages.append(msg_dict)

        # Inject Tool execution results into prompt system context
        tool_results = detect_and_execute_tools(message)
        if tool_results and len(ollama_messages) > 0 and ollama_messages[0]['role'] == 'system':
            ollama_messages[0]['content'] += f"\n\n### REAL-TIME SYSTEM TOOL RESULTS:\n{tool_results}"

        # 4. Request Ollama
        response = safe_ollama_chat_call(
            ollama_client,
            model=active_model,
            messages=ollama_messages,
            stream=False
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
        memory_manager.consolidate(ollama_client, active_model)

        # 8. Generate TTS if enabled and GPT-SoVITS is available
        audio_url = None
        tts_active = False
        
        if request.enable_tts:
            try:
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
            except Exception as e:
                print(f"⚠️ TTS generation skipped/failed: {e}")

        warning_msg = None
        if request.images and len(ollama_messages) > 0 and "(System Note: The user attached an image" in ollama_messages[0].get('content', ''):
            warning_msg = f"⚠️ Model '{MODEL}' does not support images. Image was not analyzed. Please switch to a vision model (e.g., llama3.2-vision or llava) in Settings."

        return {
            "text": clean_response,
            "thinking": thinking,
            "audio_url": audio_url,
            "tts_active": tts_active,
            "warning": warning_msg
        }

    except Exception as e:
        print(f"Error in chat endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat/stream")
async def chat_stream_endpoint(request: ChatRequest):
    global MODEL, ollama_client, memory_manager
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Empty message")

    active_model = "llama3.2-vision" if request.images else MODEL

    def generate_events():
        try:
            # 1. Load History & Append User Message
            history = memory_manager.load_short_term()
            user_content = [{"type": "input_text", "text": message}]
            if request.images:
                for img in request.images:
                    user_content.append({"type": "input_image", "image": img})
            history.append({
                "role": "user",
                "content": user_content
            })
            memory_manager.save_short_term(history)

            # 2. Get prompt messages with relevant long-term memories via RAG
            prompt_messages = memory_manager.get_prompt_messages(message)

            # 3. Format to Ollama Schema
            ollama_messages = []
            for msg in prompt_messages:
                role = msg.get('role')
                content_list = msg.get('content', [])
                content_text = ""
                images = []
                if isinstance(content_list, list):
                    content_text = " ".join([c.get('text', '') for c in content_list if isinstance(c, dict) and c.get('type') == 'input_text'])
                    for c in content_list:
                        if isinstance(c, dict) and c.get('type') == 'input_image' and c.get('image'):
                            img_data = c.get('image')
                            clean_img = img_data.split(",", 1)[1] if "," in img_data else img_data
                            images.append(clean_img)
                else:
                    content_text = str(content_list)
                
                msg_dict = {
                    "role": role,
                    "content": content_text
                }
                if images:
                    msg_dict["images"] = images
                ollama_messages.append(msg_dict)

            # Inject Tool execution results into prompt system context
            tool_results = detect_and_execute_tools(message)
            if tool_results and len(ollama_messages) > 0 and ollama_messages[0]['role'] == 'system':
                ollama_messages[0]['content'] += f"\n\n### REAL-TIME SYSTEM TOOL RESULTS:\n{tool_results}"

            # 4. Stream Ollama chat completion
            response_stream = safe_ollama_chat_call(
                ollama_client,
                model=active_model,
                messages=ollama_messages,
                stream=True
            )

            in_thinking = False
            thinking_acc = []
            answer_acc = []
            sentence_buffer = ""

            def try_generate_sentence_audio(text_chunk):
                if not request.enable_tts:
                    return None
                cleaned = clean_and_truncate_text(text_chunk)
                if not cleaned:
                    return None
                try:
                    from process.tts_func.sovits_ping import sovits_gen
                    uid = uuid.uuid4().hex
                    filename = f"output_{uid}.wav"
                    audio_dir = get_project_path("audio")
                    os.makedirs(audio_dir, exist_ok=True)
                    output_path = os.path.join(audio_dir, filename)
                    
                    gen_path = sovits_gen(cleaned, output_path)
                    if gen_path and os.path.exists(gen_path):
                        return f"/api/audio/{filename}"
                except Exception as e:
                    print(f"⚠️ Sentence TTS generation skipped/failed: {e}")
                return None

            for chunk in response_stream:
                if 'warning' in chunk:
                    yield f"data: {json.dumps({'type': 'warning', 'content': chunk['warning']})}\n\n"
                    continue
                
                content = chunk.get('message', {}).get('content', '')
                if not content:
                    continue

                idx = 0
                while idx < len(content):
                    if not in_thinking:
                        think_start = content.find("<think>", idx)
                        if think_start != -1:
                            pre = content[idx:think_start]
                            if pre:
                                answer_acc.append(pre)
                                sentence_buffer += pre
                                yield f"data: {json.dumps({'type': 'token', 'content': pre})}\n\n"
                            in_thinking = True
                            idx = think_start + len("<think>")
                        else:
                            token_text = content[idx:]
                            answer_acc.append(token_text)
                            sentence_buffer += token_text
                            yield f"data: {json.dumps({'type': 'token', 'content': token_text})}\n\n"
                            idx = len(content)
                    else:
                        think_end = content.find("</think>", idx)
                        if think_end != -1:
                            think_text = content[idx:think_end]
                            if think_text:
                                thinking_acc.append(think_text)
                                yield f"data: {json.dumps({'type': 'thinking', 'content': think_text})}\n\n"
                            in_thinking = False
                            idx = think_end + len("</think>")
                        else:
                            think_text = content[idx:]
                            thinking_acc.append(think_text)
                            yield f"data: {json.dumps({'type': 'thinking', 'content': think_text})}\n\n"
                            idx = len(content)

                # Check if sentence_buffer contains sentence punctuation
                sentence_delims = re.compile(r'([.!?~\n]+)')
                matches = list(sentence_delims.finditer(sentence_buffer))
                if matches:
                    last_match = matches[-1]
                    split_pos = last_match.end()
                    sentence = sentence_buffer[:split_pos].strip()
                    sentence_buffer = sentence_buffer[split_pos:]
                    
                    if sentence:
                        audio_url = try_generate_sentence_audio(sentence)
                        if audio_url:
                            yield f"data: {json.dumps({'type': 'sentence_audio', 'audio_url': audio_url, 'text': sentence})}\n\n"

            # Handle leftover sentence buffer
            if sentence_buffer.strip():
                sentence = sentence_buffer.strip()
                audio_url = try_generate_sentence_audio(sentence)
                if audio_url:
                    yield f"data: {json.dumps({'type': 'sentence_audio', 'audio_url': audio_url, 'text': sentence})}\n\n"

            full_answer = "".join(answer_acc).strip()
            full_thinking = "".join(thinking_acc).strip()
            if not full_answer:
                full_answer = "I see. Let's talk about something else, senpai."
                yield f"data: {json.dumps({'type': 'token', 'content': full_answer})}\n\n"

            # Save assistant response to short-term history
            history = memory_manager.load_short_term()
            history.append({
                "role": "assistant",
                "content": [{"type": "output_text", "text": full_answer}]
            })
            memory_manager.save_short_term(history)

            # Consolidate Memory
            try:
                memory_manager.consolidate(ollama_client, active_model)
            except Exception as e:
                print(f"⚠️ Memory consolidation error during streaming: {e}")

            # Send done event
            yield f"data: {json.dumps({'type': 'done', 'full_text': full_answer, 'thinking': full_thinking})}\n\n"

        except Exception as e:
            print(f"Error in stream generator: {e}")
            yield f"data: {json.dumps({'type': 'error', 'detail': str(e)})}\n\n"

    return StreamingResponse(generate_events(), media_type="text/event-stream")

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

def clean_and_truncate_text(text: str, max_chars: int = 600) -> str:
    # 1. Remove action descriptions inside asterisks (e.g. *giggles*, *pats head*)
    cleaned = re.sub(r'\*.*?\*', '', text)
    # 2. Clean extra whitespaces
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    # 3. Apply safety limit
    return cleaned[:max_chars].strip()

class TTSRequest(BaseModel):
    text: str

@app.post("/api/tts")
async def tts_endpoint(request: TTSRequest):
    try:
        from process.tts_func.sovits_ping import sovits_gen
        
        # Clean and truncate text for instant and natural speech synthesis
        tts_text = clean_and_truncate_text(request.text)
        if not tts_text.strip():
            # If after cleaning there is no dialogue text, return None
            return {"audio_url": None, "tts_active": False}
            
        uid = uuid.uuid4().hex
        filename = f"output_{uid}.wav"
        audio_dir = get_project_path("audio")
        os.makedirs(audio_dir, exist_ok=True)
        output_path = os.path.join(audio_dir, filename)
        
        gen_path = sovits_gen(tts_text, output_path)
        if gen_path and os.path.exists(gen_path):
            return {
                "audio_url": f"/api/audio/{filename}",
                "tts_active": True
            }
        return {"audio_url": None, "tts_active": False}
    except Exception as e:
        print(f"⚠️ TTS generation failed: {e}")
        return {"audio_url": None, "tts_active": False}

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
        
    return {
        "ollama": ollama_ok,
        "tts": tts_ok,
        "whisper": whisper_ok,
        "mic": mic_ok,
        "cpu": current_cpu_percent,
        "ram": current_ram_percent
    }

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    svg_favicon = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🌸</text></svg>"""
    return Response(content=svg_favicon, media_type="image/svg+xml")

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
    # Enable hot-reloading for auto-applying future backend updates
    uvicorn.run("main_api:app", host="127.0.0.1", port=8000, reload=True, reload_dirs=[server_dir])
