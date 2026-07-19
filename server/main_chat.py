import os
import sys
import uuid
from pathlib import Path
import time

# Resolve paths so we can run from anywhere and import path_utils first
server_dir = os.path.dirname(os.path.abspath(__file__))
if server_dir not in sys.path:
    sys.path.insert(0, server_dir)

from path_utils import get_project_path, get_server_path
from config_validator import validate_and_check_services

# 1. Run Configuration and Service Validation
success, tts_available, mic_available, config, char_config, error_msg = validate_and_check_services()

if not success:
    print(f"\n❌ Startup validation failed:\n{error_msg}")
    sys.exit(1)

# Import functional layers after validation
from process.asr_func.asr_push_to_talk import record_and_transcribe
from process.llm_funcs.llm_scr import llm_response
from process.tts_func.sovits_ping import sovits_gen, play_audio

# Determine operation mode
voice_mode_active = tts_available and mic_available

print('\n========= AI Companion App Initialization ================')
if voice_mode_active:
    print("🎙️  Status: VOICE MODE ACTIVE (ASR + TTS online)")
else:
    print("🚨 Status: TEXT-ONLY FALLBACK MODE")
    if not mic_available:
        print("   - Reason: No microphone input device available.")
    if not tts_available:
        print("   - Reason: GPT-SoVITS server is offline at http://127.0.0.1:9880.")
print('==========================================================\n')

# Initialize Whisper model only if voice mode is active
whisper_model = None
if voice_mode_active:
    print("Loading transcription model (Whisperbase.en)...")
    from faster_whisper import WhisperModel
    # Note: Using float32 for CPU by default for accuracy and stability
    whisper_model = WhisperModel("base.en", device="cpu", compute_type="float32")
    print("Whisper model loaded successfully!")

print("\n(Type 'exit' or 'quit' to close the conversation)\n")

# Start conversation loop
while True:
    try:
        user_spoken_text = ""
        
        if voice_mode_active:
            # Ensure audio output folder exists in project root
            audio_dir = get_project_path("audio")
            os.makedirs(audio_dir, exist_ok=True)
            conversation_recording = os.path.join(audio_dir, "conversation.wav")
            
            # Record voice and get transcription
            user_spoken_text = record_and_transcribe(whisper_model, conversation_recording)
            
            # Check if user spoke
            if not user_spoken_text:
                continue
                
            # Allow keyboard exit if user transcribes exit command
            if user_spoken_text.lower() in ['exit.', 'quit.', 'exit', 'quit']:
                print("Goodbye, senpai!")
                break
        else:
            # Console Input Fallback
            try:
                user_spoken_text = input("💬 Senpai: ").strip()
            except (KeyboardInterrupt, EOFError):
                print("\nGoodbye, senpai!")
                break
                
            if not user_spoken_text:
                continue
                
            if user_spoken_text.lower() in ['exit', 'quit']:
                print("Goodbye, senpai!")
                break

        # Pass to LLM and get the clean parsed response
        print("Thinking...")
        llm_output = llm_response(user_spoken_text)
        print(f"🤖 Riko: {llm_output}")

        # If voice mode is active, synthesize and play
        if voice_mode_active:
            uid = uuid.uuid4().hex
            filename = f"output_{uid}.wav"
            output_wav_path = os.path.join(get_project_path("audio"), filename)
            
            # Generate speech
            gen_aud_path = sovits_gen(llm_output, output_wav_path)
            
            # Play speech if generated successfully
            if gen_aud_path and os.path.exists(gen_aud_path):
                play_audio(gen_aud_path)
            
            # Clean up generated audio files in the audio folder
            try:
                for fp in Path(get_project_path("audio")).glob("*.wav"):
                    if fp.is_file() and fp.name != "conversation.wav":
                        fp.unlink()
            except Exception as e:
                print(f"Error during audio cleanup: {e}")
                
    except KeyboardInterrupt:
        print("\nGoodbye, senpai!")
        break
    except Exception as e:
        print(f"\n⚠️ An unexpected error occurred in conversation: {e}")
        time.sleep(1)