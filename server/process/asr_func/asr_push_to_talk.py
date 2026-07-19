import os
import yaml
import sounddevice as sd
import soundfile as sf
import numpy as np
import time
from faster_whisper import WhisperModel

# Attempt to load path_utils to resolve config paths correctly
try:
    from path_utils import get_project_path
    CONFIG_PATH = get_project_path("config.yaml")
except ImportError:
    CONFIG_PATH = "config.yaml"

def load_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                return yaml.safe_load(f) or {}
        except Exception:
            pass
    return {}

def record_audio_manual(output_file, samplerate=16000):
    """
    Original manual push-to-talk (Enter to start, Enter to stop)
    """
    print("\n⌨️  Press ENTER to start recording...")
    input()
    print("🔴 Recording... Press ENTER to stop")
    
    # Start recording
    recording = sd.rec(int(60 * samplerate), samplerate=samplerate, channels=1, dtype='float32')
    input()  # Wait for stop keypress
    sd.stop()
    
    print("⏹️  Saving audio...")
    sf.write(output_file, recording, samplerate)
    return True

def record_audio_vad(output_file, samplerate=16000, threshold=0.02, silence_duration=1.5, timeout=10.0):
    """
    Voice Activity Detection (VAD) recording.
    """
    chunk_size = 1024
    audio_frames = []
    
    speech_started = False
    silence_start_time = None
    start_time = time.time()
    
    print(f"\n🎙️ [VAD Mode] Listening (Threshold: {threshold}). Speak when ready...")
    
    def callback(indata, frames, time_info, status):
        nonlocal speech_started, silence_start_time, audio_frames
        
        # Calculate Root Mean Square (RMS) of amplitude
        rms = np.sqrt(np.mean(indata**2))
        
        if not speech_started:
            if rms > threshold:
                speech_started = True
                print("🔴 Speech detected! Recording...")
                audio_frames.append(indata.copy())
        else:
            audio_frames.append(indata.copy())
            if rms < threshold:
                if silence_start_time is None:
                    silence_start_time = time.time()
            else:
                silence_start_time = None

    try:
        with sd.InputStream(samplerate=samplerate, channels=1, callback=callback, blocksize=chunk_size):
            while True:
                time.sleep(0.1)
                
                # If speech hasn't started and we exceed timeout, exit
                if not speech_started:
                    if time.time() - start_time > timeout:
                        print("⏰ VAD Timeout: No speech detected.")
                        return False
                else:
                    # If speech has started, check if user has been silent for silence_duration
                    if silence_start_time is not None:
                        elapsed_silence = time.time() - silence_start_time
                        if elapsed_silence >= silence_duration:
                            print("⏹️ Speech ended. Stopping recording...")
                            break
    except Exception as e:
        print(f"Error in VAD recording stream: {e}")
        return False

    if audio_frames:
        # Concatenate and save
        recording = np.concatenate(audio_frames, axis=0)
        sf.write(output_file, recording, samplerate)
        return True
    return False

def record_and_transcribe(model, output_file="recording.wav", samplerate=16000):
    """
    Records audio (either VAD or manual based on config) and transcribes using WhisperModel.
    """
    config = load_config()
    mode = config.get('recording_mode', 'vad')
    
    # Standardize samplerate for Whisper (16000Hz is Whisper's native rate)
    if os.path.exists(output_file):
        try:
            os.remove(output_file)
        except Exception:
            pass
            
    success = False
    if mode == 'manual':
        success = record_audio_manual(output_file, samplerate)
    else:
        threshold = config.get('vad_threshold', 0.02)
        silence_duration = config.get('vad_silence_duration', 1.5)
        success = record_audio_vad(output_file, samplerate, threshold, silence_duration)
        
    if not success or not os.path.exists(output_file) or os.path.getsize(output_file) < 100:
        print("⚠️ No speech recorded.")
        return ""
        
    print("🎯 Transcribing voice...")
    segments, _ = model.transcribe(output_file)
    transcription = " ".join([segment.text for segment in segments])
    
    print(f"Transcription: '{transcription.strip()}'")
    return transcription.strip()