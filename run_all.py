import os
import sys
import time
import subprocess
import webbrowser
import urllib.request
import urllib.error
import yaml

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

def is_url_responsive(url, timeout=2):
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return True
    except urllib.error.HTTPError:
        # HTTP errors like 404/405/500 still mean the server is running and responding
        return True
    except Exception:
        return False

def check_and_start_ollama(ollama_host="http://localhost:11434"):
    print("🔍 Checking Ollama LLM status...")
    if is_url_responsive(f"{ollama_host}/api/tags"):
        print("  ✅ Ollama is running.")
        return True
    
    print("  ⚠️ Ollama is not responding. Attempting to start 'ollama serve'...")
    try:
        subprocess.Popen(["ollama", "serve"], creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0)
        time.sleep(3)
        if is_url_responsive(f"{ollama_host}/api/tags"):
            print("  ✅ Ollama started successfully.")
            return True
    except Exception as e:
        print(f"  ⚠️ Could not auto-start Ollama: {e}")
        print("  👉 Please ensure Ollama is installed and running.")
    return False

def find_sovits_dir():
    # 1. Check config.yaml
    config_path = os.path.join(PROJECT_ROOT, "config.yaml")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
                if "sovits_dir" in cfg and os.path.isdir(cfg["sovits_dir"]):
                    return cfg["sovits_dir"]
        except Exception:
            pass

    # 2. Known default path
    default_path = r"C:\Users\white\GPT-SoVITS-v4-nvidia50"
    if os.path.isdir(default_path):
        return default_path

    # 3. Check user home folder candidates
    user_home = os.path.expanduser("~")
    for name in os.listdir(user_home):
        if "GPT-SoVITS" in name or "gpt-sovits" in name.lower():
            full_p = os.path.join(user_home, name)
            if os.path.isdir(full_p) and os.path.exists(os.path.join(full_p, "api_v2.py")):
                return full_p

    return None

def check_and_start_tts():
    print("🔍 Checking GPT-SoVITS TTS Server status...")
    if is_url_responsive("http://127.0.0.1:9880/tts"):
        print("  ✅ GPT-SoVITS TTS Server is already running.")
        return True

    print("  🚀 Starting GPT-SoVITS TTS Server...")
    sovits_dir = find_sovits_dir()
    if not sovits_dir:
        print("  ❌ Could not find GPT-SoVITS directory. Please set 'sovits_dir' in config.yaml.")
        return False

    runtime_python = os.path.join(sovits_dir, "runtime", "python.exe")
    api_script = os.path.join(sovits_dir, "api_v2.py")

    if not os.path.exists(runtime_python):
        runtime_python = "python"  # Fallback to system python

    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"

    cmd = [runtime_python, api_script]
    try:
        subprocess.Popen(
            cmd,
            cwd=sovits_dir,
            env=env,
            creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0
        )
        print(f"  ⏳ Started GPT-SoVITS process from {sovits_dir}. Waiting for model initialization...")
        # Wait up to 15 seconds for server to respond
        for _ in range(15):
            time.sleep(1)
            if is_url_responsive("http://127.0.0.1:9880/tts"):
                print("  ✅ GPT-SoVITS TTS Server is live!")
                return True
        print("  ⚠️ TTS server launch initiated, model warm-up may take a few extra seconds.")
        return True
    except Exception as e:
        print(f"  ❌ Failed to start GPT-SoVITS: {e}")
        return False

def main():
    print("==================================================")
    print("       🌸 Starting Riko AI Companion Setup 🌸      ")
    print("==================================================")
    
    # Step 1: Check Ollama
    check_and_start_ollama()

    # Step 2: Check TTS
    check_and_start_tts()

    # Step 3: Launch Web Browser after 2 seconds in background
    def open_browser():
        time.sleep(2.5)
        print("🌐 Opening web browser at http://127.0.0.1:8000...")
        webbrowser.open("http://127.0.0.1:8000")

    import threading
    threading.Thread(target=open_browser, daemon=True).start()

    # Step 4: Run Riko FastAPI Server
    print("🚀 Launching Riko Companion Server (main_api.py)...")
    venv_python = os.path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe")
    if not os.path.exists(venv_python):
        venv_python = sys.executable

    server_script = os.path.join(PROJECT_ROOT, "server", "main_api.py")
    subprocess.run([venv_python, server_script], cwd=PROJECT_ROOT)

if __name__ == "__main__":
    main()
