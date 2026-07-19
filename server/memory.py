import os
import json
import re
from abc import ABC, abstractmethod
from path_utils import get_project_path

class BaseMemoryStore(ABC):
    @abstractmethod
    def load_memories(self) -> list:
        pass

    @abstractmethod
    def save_memories(self, memories: list):
        pass

class JSONMemoryStore(BaseMemoryStore):
    def __init__(self, filepath: str):
        self.filepath = filepath

    def load_memories(self) -> list:
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error loading long term memories: {e}")
                return []
        return []

    def save_memories(self, memories: list):
        try:
            with open(self.filepath, 'w', encoding='utf-8') as f:
                json.dump(memories, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving long term memories: {e}")


def strip_thinking(text: str) -> str:
    """
    Strips reasoning <think>...</think> tags and content.
    """
    cleaned = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
    cleaned = re.sub(r'<think>.*$', '', cleaned, flags=re.DOTALL)
    return cleaned.strip()


class MemoryManager:
    def __init__(self, config: dict, character_config: dict):
        self.config = config
        self.character_config = character_config
        
        self.history_file = get_project_path(config.get('history_file', 'chat_history.json'))
        self.long_term_file = get_project_path(config.get('long_term_memory_file', 'long_term_memory.json'))
        self.max_turns = config.get('max_short_term_turns', 8)
        
        # Pluggable store (could easily be swapped for SQLite or Vector store)
        self.long_term_store = JSONMemoryStore(self.long_term_file)
        
        self.base_system_prompt = character_config['presets']['default']['system_prompt']

    def load_short_term(self) -> list:
        if os.path.exists(self.history_file):
            try:
                with open(self.history_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    if isinstance(data, list) and len(data) > 0:
                        return data
            except Exception as e:
                print(f"Error loading short term history: {e}")
        
        # Default initialization
        return [
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": self.base_system_prompt
                    }
                ]
            }
        ]

    def save_short_term(self, history: list):
        try:
            with open(self.history_file, 'w', encoding='utf-8') as f:
                json.dump(history, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving short term history: {e}")

    def load_long_term(self) -> list:
        return self.long_term_store.load_memories()

    def save_long_term(self, facts: list):
        self.long_term_store.save_memories(facts)

    def get_prompt_messages(self) -> list:
        """
        Builds the message list for LLM inference.
        Loads short-term history, loads long-term facts, injects facts into the active system prompt,
        and returns the messages list.
        """
        history = self.load_short_term()
        facts = self.load_long_term()
        
        # Find system prompt and inject facts
        injected_prompt = self.base_system_prompt
        if facts:
            facts_text = "\n".join([f"- {fact}" for fact in facts])
            injected_prompt = (
                f"{self.base_system_prompt}\n\n"
                f"### PERSISTENT LONG-TERM MEMORIES (Facts about user):\n"
                f"{facts_text}"
            )
            
        # Update first system prompt message
        if history and history[0].get('role') == 'system':
            history[0]['content'] = [
                {
                    "type": "input_text",
                    "text": injected_prompt
                }
            ]
        else:
            # Fallback if history structure is weird
            history.insert(0, {
                "role": "system",
                "content": [{"type": "input_text", "text": injected_prompt}]
            })
            
        return history

    def consolidate(self, ollama_client, model: str):
        """
        Consolidates older chat history into long-term memories when short-term history is too long.
        """
        history = self.load_short_term()
        
        # A turn is 2 messages (user + assistant)
        # Total messages = 1 (system prompt) + turns * 2
        non_system_msgs = [m for m in history if m.get('role') != 'system']
        num_turns = len(non_system_msgs) // 2
        
        if num_turns <= self.max_turns:
            return
            
        # We need to consolidate. Let's take the oldest half of the turns to consolidate.
        turns_to_consolidate = num_turns // 2
        msgs_to_consolidate_count = turns_to_consolidate * 2
        
        msgs_to_consolidate = non_system_msgs[:msgs_to_consolidate_count]
        remaining_msgs = non_system_msgs[msgs_to_consolidate_count:]
        
        # Format the conversation text for the summarization prompt
        conv_text = ""
        for m in msgs_to_consolidate:
            role = m.get('role', '').capitalize()
            content_list = m.get('content', [])
            text = ""
            if isinstance(content_list, list):
                text = " ".join([c.get('text', '') for c in content_list if isinstance(c, dict)])
            else:
                text = str(content_list)
            conv_text += f"{role}: {text}\n"
            
        existing_facts = self.load_long_term()
        existing_facts_text = "\n".join([f"- {fact}" for fact in existing_facts]) if existing_facts else "(None)"
        
        prompt = f"""
You are the memory manager for an AI companion.
Your job is to extract durable facts, user preferences, and key recurring topics from the following conversation segment, and merge/update them with the existing list of facts.

Existing facts:
{existing_facts_text}

New conversation segment:
{conv_text}

Rules:
1. Extract new facts about the user (e.g., name, hobbies, preferences, feelings) or key topics discussed.
2. Combine and update any existing facts if the conversation segment provides new info.
3. Keep the list concise and relevant. Avoid temporary or trivial statements.
4. Output the updated facts as a plain bulleted list, one fact per line, starting with '- '. Do not include any thinking tags or introductory/concluding remarks.
"""
        try:
            print("🧠 Consolidating old chat history into long-term memory...")
            response = ollama_client.chat(
                model=model,
                messages=[
                    {"role": "system", "content": "You are a precise information extraction assistant. Output only the requested bulleted list of facts, starting each line with '- '."},
                    {"role": "user", "content": prompt}
                ]
            )
            content = response.get('message', {}).get('content', '')
            content = strip_thinking(content)
            
            # Parse the bulleted list
            new_facts = []
            for line in content.split('\n'):
                line = line.strip()
                if line.startswith('-'):
                    fact = line[1:].strip()
                    if fact:
                        new_facts.append(fact)
                elif line.startswith('*'):
                    fact = line[1:].strip()
                    if fact:
                        new_facts.append(fact)
            
            # Fallback parse if no bullets found
            if not new_facts:
                for line in content.split('\n'):
                    line = line.strip()
                    if line and not line.startswith('<') and len(line) > 5:
                        new_facts.append(line)
            
            if new_facts:
                # Save consolidated facts
                self.save_long_term(new_facts)
                print(f"💾 Saved {len(new_facts)} facts to long-term memory.")
            
            # Reconstruct short-term history: system prompt + remaining messages
            new_history = [
                {
                    "role": "system",
                    "content": [{"type": "input_text", "text": self.base_system_prompt}]
                }
            ] + remaining_msgs
            self.save_short_term(new_history)
            print(f"🧹 Pruned {msgs_to_consolidate_count} messages from short-term memory.")
            
        except Exception as e:
            print(f"Error during memory consolidation: {e}")
