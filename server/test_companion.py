import os
import sys
import yaml
import shutil

# Ensure server path is in path
server_dir = os.path.dirname(os.path.abspath(__file__))
if server_dir not in sys.path:
    sys.path.insert(0, server_dir)

from path_utils import get_project_path
from config_validator import validate_and_check_services
from memory import MemoryManager, strip_thinking
from process.llm_funcs.llm_scr import llm_response, ollama_client, MODEL

def run_tests():
    print("====== Running AI Companion Unit & Integration Tests ======\n")
    
    # 1. Test Config Validator
    print("📋 [Test 1] Config & Service Validation")
    success, tts_available, mic_available, config, char_config, error_msg = validate_and_check_services()
    if not success:
        print(f"❌ Failed: {error_msg}")
        return False
    print("✅ Config and Ollama connection checks passed!")
    print(f"   - Ollama host: {config.get('ollama_host')}")
    print(f"   - Target Model: {config.get('model')}")
    print(f"   - GPT-SoVITS TTS Available: {tts_available}")
    print(f"   - Mic Available: {mic_available}")

    # 2. Test <think> block parsing
    print("\n📋 [Test 2] <think> Tag Parser Test")
    test_text_1 = "<think>I need to sound snarky. Let's refer to them as senpai.</think>Hello, senpai! How can I help you today?"
    parsed_1 = strip_thinking(test_text_1)
    if parsed_1 != "Hello, senpai! How can I help you today?":
        print(f"❌ Failed: strip_thinking did not parse standard think tag correctly. Got: '{parsed_1}'")
        return False
        
    test_text_2 = "<think>\nReasoning goes here.\nUnfinished thinking block"
    parsed_2 = strip_thinking(test_text_2)
    if parsed_2 != "":
        print(f"❌ Failed: strip_thinking did not handle unclosed think tag correctly. Got: '{parsed_2}'")
        return False
    print("✅ <think> tag parser working as expected!")

    # Backup existing history files to not overwrite user's state
    history_file = get_project_path(config.get('history_file', 'chat_history.json'))
    long_term_file = get_project_path(config.get('long_term_memory_file', 'long_term_memory.json'))
    
    backup_history = history_file + ".bak"
    backup_lt = long_term_file + ".bak"
    
    if os.path.exists(history_file):
        shutil.copyfile(history_file, backup_history)
    if os.path.exists(long_term_file):
        shutil.copyfile(long_term_file, backup_lt)
        
    try:
        # Clean history files for testing memory logic
        if os.path.exists(history_file):
            os.remove(history_file)
        if os.path.exists(long_term_file):
            os.remove(long_term_file)
            
        # 3. Test LLM Chat Response
        print("\n📋 [Test 3] LLM Chat response and persona consistency")
        user_msg = "Hello, Riko! My name is Alex, and my favorite hobby is painting with watercolors."
        print(f"   Sending: '{user_msg}'")
        response = llm_response(user_msg)
        print(f"   Response received: '{response}'")
        
        # Verify the model has responded in-persona or at least returned text
        if not response or len(response) < 5:
            print("❌ Failed: Empty or invalid response from Ollama model.")
            return False
        print("✅ Ollama LLM response working!")

        # 4. Test Memory Consolidation Trigger
        print("\n📋 [Test 4] Memory Consolidation Logic")
        # Instantiate fresh memory manager
        manager = MemoryManager(config, char_config)
        history = manager.load_short_term()
        
        # Add 9 mock turns (18 messages) to trigger consolidation (max_turns is 8)
        # We want to make sure it contains specific facts so we can verify consolidation extracts them
        mock_facts_conversation = [
            ("user", "I live in Seattle."),
            ("assistant", "Oh, Seattle! It rains a lot there, senpai!"),
            ("user", "My favorite color is green."),
            ("assistant", "Green is a lovely color, senpai!"),
            ("user", "I have a cat named Whiskers."),
            ("assistant", "Whiskers sounds like a cute kitty, senpai!"),
            ("user", "I work as a software developer."),
            ("assistant", "Coding is cool, senpai!"),
            ("user", "I love drinking matcha latte."),
            ("assistant", "Matcha is delicious, senpai!"),
            ("user", "I enjoy playing chess."),
            ("assistant", "Chess is a deep game, senpai!"),
            ("user", "I play electric guitar."),
            ("assistant", "Rock on, senpai!"),
            ("user", "My favorite food is sushi."),
            ("assistant", "Sushi is amazing, senpai!"),
            ("user", "I want to visit Tokyo next year."),
            ("assistant", "Tokyo will be awesome, senpai!")
        ]
        
        for role, text in mock_facts_conversation:
            type_key = "input_text" if role == "user" else "output_text"
            history.append({
                "role": role,
                "content": [{"type": type_key, "text": text}]
            })
            
        manager.save_short_term(history)
        
        # Check that history length exceeds thresholds
        non_system = [m for m in history if m.get('role') != 'system']
        print(f"   Short-term history contains {len(non_system) // 2} turns.")
        
        # Consolidate
        manager.consolidate(ollama_client, MODEL)
        
        # Verify consolidation results
        consolidated_history = manager.load_short_term()
        consolidated_non_system = [m for m in consolidated_history if m.get('role') != 'system']
        print(f"   After consolidation, short-term history contains {len(consolidated_non_system) // 2} turns.")
        
        facts = manager.load_long_term()
        print(f"   Facts extracted in long-term memory:")
        for f in facts:
            print(f"     - {f}")
            
        if len(consolidated_non_system) >= len(non_system):
            print("❌ Failed: Memory consolidation did not prune short-term history.")
            return False
            
        if not facts:
            print("❌ Failed: No facts extracted during consolidation.")
            return False
            
        print("✅ Memory consolidation and long-term memory logic passed!")
        
    finally:
        # Restore backups
        if os.path.exists(history_file):
            os.remove(history_file)
        if os.path.exists(long_term_file):
            os.remove(long_term_file)
            
        if os.path.exists(backup_history):
            shutil.move(backup_history, history_file)
        if os.path.exists(backup_lt):
            shutil.move(backup_lt, long_term_file)
            
    print("\n🎉 ====== All Tests Completed successfully! ======")
    return True

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
