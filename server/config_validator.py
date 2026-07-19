import os
import yaml
import requests
import sounddevice as sd
from path_utils import get_project_path

def validate_and_check_services():
    """
    Validates config files and checks service connectivity (Ollama, GPT-SoVITS, Microphone).
    Returns (success, tts_available, mic_available, config, char_config, error_msg)
    """
    config_path = get_project_path("config.yaml")
    char_config_path = get_project_path("character_config.yaml")
    
    # 1. Validate Config Files Exist
    if not os.path.exists(config_path):
        return False, False, False, None, None, f"Configuration file missing: config.yaml at {config_path}"
    
    if not os.path.exists(char_config_path):
        return False, False, False, None, None, f"Character config file missing: character_config.yaml at {char_config_path}"
        
    # 2. Parse Config Files
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
    except Exception as e:
        return False, False, False, None, None, f"Failed to parse config.yaml: {e}"
        
    try:
        with open(char_config_path, 'r', encoding='utf-8') as f:
            char_config = yaml.safe_load(f)
    except Exception as e:
        return False, False, False, None, None, f"Failed to parse character_config.yaml: {e}"

    # 3. Check required keys
    required_config = ['ollama_host', 'model']
    for k in required_config:
        if k not in config:
            return False, False, False, None, None, f"Missing required configuration key in config.yaml: {k}"
            
    required_char = ['presets', 'sovits_ping_config']
    for k in required_char:
        if k not in char_config:
            return False, False, False, None, None, f"Missing required configuration key in character_config.yaml: {k}"
            
    if 'default' not in char_config['presets'] or 'system_prompt' not in char_config['presets']['default']:
        return False, False, False, None, None, "presets.default.system_prompt is required in character_config.yaml"

    # 4. Check Ollama connection (Fail Fast)
    ollama_host = config.get('ollama_host')
    try:
        resp = requests.get(f"{ollama_host}/api/tags", timeout=3)
        if resp.status_code != 200:
            return False, False, False, None, None, f"Ollama returned status {resp.status_code} at {ollama_host}"
        
        # Check if target model is pulled
        models_data = resp.json()
        models = [m['name'] for m in models_data.get('models', [])]
        target_model = config.get('model')
        # Check either exact match or match without tag (e.g. ornith:9b matches ornith:9b or ornith:latest)
        model_exists = any(target_model in m or m in target_model for m in models)
        if not model_exists:
            print(f"⚠️ Warning: Target model '{target_model}' not found in Ollama models list: {models}")
            print(f"Please run: ollama pull {target_model}")
            # Do not hard-fail here, but warn
    except Exception as e:
        return False, False, False, None, None, f"Failed to connect to local Ollama at {ollama_host}. Is Ollama running? Error: {e}"

    # 5. Check GPT-SoVITS Connection
    tts_available = True
    try:
        # GPT-SoVITS simple test endpoint or just ping /tts
        # If it returns 405 (method not allowed for GET) or 400 (bad request), it is running.
        # If it returns connection refused, it is not running.
        resp = requests.get("http://127.0.0.1:9880/tts", timeout=2)
        # Standard GPT-SoVITS server doesn't respond to GET on /tts or returns error, but connection works
    except requests.exceptions.ConnectionError:
        print("⚠️ Warning: GPT-SoVITS server is not running at http://127.0.0.1:9880.")
        tts_available = False
    except Exception:
        # Any other exception means connection did not fail completely
        pass

    # 6. Check Microphone device availability
    mic_available = True
    try:
        devices = sd.query_devices()
        input_devices = [d for d in devices if d['max_input_channels'] > 0]
        if not input_devices:
            print("⚠️ Warning: No audio input devices (microphones) detected.")
            mic_available = False
    except Exception as e:
        print(f"⚠️ Warning: Error querying audio devices: {e}")
        mic_available = False

    return True, tts_available, mic_available, config, char_config, ""
