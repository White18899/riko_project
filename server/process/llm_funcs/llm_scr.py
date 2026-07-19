import yaml
import json
import os
import re
import ollama
from path_utils import get_project_path
from memory import MemoryManager, strip_thinking

# Load configs
with open(get_project_path('config.yaml'), 'r', encoding='utf-8') as f:
    config = yaml.safe_load(f)

with open(get_project_path('character_config.yaml'), 'r', encoding='utf-8') as f:
    char_config = yaml.safe_load(f)

# Instantiate Ollama client
ollama_host = config.get('ollama_host', 'http://localhost:11434')
ollama_client = ollama.Client(host=ollama_host)
MODEL = config.get('model', 'ornith:9b')

# Instantiate memory manager
memory_manager = MemoryManager(config, char_config)

def get_riko_response_no_tool(prompt_messages):
    """
    Format message history and call local Ollama chat API.
    """
    # Convert standard/custom history structure to Ollama's expected schema: [{'role': ..., 'content': str}]
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
        
    try:
        response = ollama_client.chat(
            model=MODEL,
            messages=ollama_messages
        )
        # Extract content text
        full_text = response.get('message', {}).get('content', '')
        return full_text
    except Exception as e:
        print(f"Error calling local Ollama model: {e}")
        return "I'm sorry, senpai, but I had trouble thinking of what to say. (Ollama connection error)"

def llm_response(user_input):
    """
    Orchestrate history loading, user input appending, model query, response parsing, and memory consolidation.
    """
    if not user_input or not user_input.strip():
        return "I didn't hear you, senpai."

    # 1. Load history
    history = memory_manager.load_short_term()

    # 2. Append user message to history
    history.append({
        "role": "user",
        "content": [
            {"type": "input_text", "text": user_input}
        ]
    })
    memory_manager.save_short_term(history)

    # 3. Retrieve prompt messages (with long-term memories injected)
    prompt_messages = memory_manager.get_prompt_messages()

    # 4. Get response from Ollama
    raw_response = get_riko_response_no_tool(prompt_messages)

    # 5. Parse and strip <think>...</think> block
    clean_response = strip_thinking(raw_response)

    # If the clean response is empty (e.g. model output only thinking, which can happen with reasoning models), fallback
    if not clean_response:
        clean_response = "I see. Let's talk about something else, senpai."

    # 6. Append assistant response to short-term history and save
    history = memory_manager.load_short_term() # Reload to ensure we append to latest
    history.append({
        "role": "assistant",
        "content": [
            {"type": "output_text", "text": clean_response}
        ]
    })
    memory_manager.save_short_term(history)

    # 7. Consolidate memory if short term history is too long
    # Run inline since it's local and we want to ensure state consistency.
    memory_manager.consolidate(ollama_client, MODEL)

    return clean_response

if __name__ == "__main__":
    print('Testing Ollama LLM integration...')
    print(llm_response("Hello, who are you?"))