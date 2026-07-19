import os
import yaml
import requests
import time
import soundfile as sf 
import sounddevice as sd
from path_utils import get_project_path

# Load YAML config using path utilities
with open(get_project_path('character_config.yaml'), 'r', encoding='utf-8') as f:
    char_config = yaml.safe_load(f)

def clean_text_for_tts(text: str) -> str:
    # Remove markdown emphasis asterisks
    text = text.replace('*', '')
    # Filter out emojis and miscellaneous symbols (U+1F000 and above, and U+2600-U+27BF)
    cleaned = []
    for c in text:
        o = ord(c)
        if o >= 0x1F000 or (0x2600 <= o <= 0x27BF):
            continue
        cleaned.append(c)
    return "".join(cleaned).strip()

def play_audio(path):
    try:
        data, samplerate = sf.read(path)
        sd.play(data, samplerate)
        sd.wait()  # Wait until playback is finished
    except Exception as e:
        print(f"Error playing audio file {path}: {e}")

def sovits_gen(in_text, output_wav_pth="output.wav"):
    url = "http://127.0.0.1:9880/tts"
    
    # Clean text to remove emojis/symbols that crash GPT-SoVITS tokenizer
    in_text = clean_text_for_tts(in_text)
    
    # Resolve reference audio path to absolute path dynamically
    ref_audio = char_config['sovits_ping_config']['ref_audio_path']
    if not os.path.isabs(ref_audio):
        ref_audio = get_project_path(ref_audio)
        # Normalize backslashes for Windows paths
        ref_audio = os.path.abspath(ref_audio)

    payload = {
        "text": in_text,
        "text_lang": char_config['sovits_ping_config']['text_lang'],
        "ref_audio_path": ref_audio,
        "prompt_text": char_config['sovits_ping_config']['prompt_text'],
        "prompt_lang": char_config['sovits_ping_config']['prompt_lang']
    }

    try:
        print(f"🔊 Sending TTS request to GPT-SoVITS...")
        response = requests.post(url, json=payload, timeout=60)
        if response.status_code != 200:
            print(f"⚠️ GPT-SoVITS returned status {response.status_code}: {response.text}")
        response.raise_for_status()

        # Ensure output directory exists
        os.makedirs(os.path.dirname(os.path.abspath(output_wav_pth)), exist_ok=True)
        
        with open(output_wav_pth, "wb") as f:
            f.write(response.content)

        return output_wav_pth

    except Exception as e:
        print("⚠️ GPT-SoVITS TTS generation failed:", e)
        return None

if __name__ == "__main__":
    start_time = time.time()
    output_wav_pth1 = "output.wav"
    path_to_aud = sovits_gen("If you hear this, that means it is set up correctly", output_wav_pth1)
    
    end_time = time.time()
    elapsed_time = end_time - start_time

    print(f"Elapsed time: {elapsed_time:.4f} seconds")
    print(f"Generated file path: {path_to_aud}")
    if path_to_aud and os.path.exists(path_to_aud):
        play_audio(path_to_aud)
