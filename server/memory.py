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

import sqlite3
import math

class SQLiteMemoryStore(BaseMemoryStore):
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS facts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    fact TEXT UNIQUE NOT NULL,
                    category TEXT DEFAULT 'general',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS knowledge_triples (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    subject TEXT NOT NULL,
                    relation TEXT NOT NULL,
                    object TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(subject, relation, object)
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS episodic_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            conn.commit()

    def load_memories(self) -> list:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT fact FROM facts ORDER BY id ASC")
            rows = cursor.fetchall()
            return [r[0] for r in rows]

    def save_memories(self, memories: list):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            for item in memories:
                if isinstance(item, str) and item.strip():
                    cursor.execute("INSERT OR IGNORE INTO facts (fact) VALUES (?)", (item.strip(),))
                elif isinstance(item, dict):
                    fact_str = item.get('fact', '')
                    cat = item.get('category', 'general')
                    if fact_str and fact_str.strip():
                        cursor.execute("INSERT OR IGNORE INTO facts (fact, category) VALUES (?, ?)", (fact_str.strip(), cat))
            conn.commit()

    def save_triple(self, subject: str, relation: str, obj: str):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT OR IGNORE INTO knowledge_triples (subject, relation, object) VALUES (?, ?, ?)",
                (subject.strip(), relation.strip(), obj.strip())
            )
            conn.commit()

    def load_triples(self) -> list:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT subject, relation, object FROM knowledge_triples")
            return cursor.fetchall()

    def search_relevant_facts(self, query: str = None, top_k: int = 8) -> list:
        all_facts = self.load_memories()
        if not all_facts:
            return []
        if not query or not query.strip():
            return all_facts[:top_k]

        query_words = set(re.findall(r'\w+', query.lower()))
        if not query_words:
            return all_facts[:top_k]

        scored_facts = []
        for fact in all_facts:
            fact_words = set(re.findall(r'\w+', fact.lower()))
            intersection = query_words.intersection(fact_words)
            if not intersection:
                score = 0.0
            else:
                score = len(intersection) / math.sqrt(len(query_words) * len(fact_words))
            scored_facts.append((score, fact))

        scored_facts.sort(key=lambda x: x[0], reverse=True)
        relevant = [fact for score, fact in scored_facts if score > 0]
        if len(relevant) < top_k:
            for score, fact in scored_facts:
                if fact not in relevant:
                    relevant.append(fact)
                    if len(relevant) >= top_k:
                        break
        return relevant[:top_k]

    def record_episodic_turn(self, role: str, text: str):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO episodic_history (role, content) VALUES (?, ?)", (role, text))
            conn.commit()

    def search_episodic_history(self, query: str, limit: int = 5) -> list:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT role, content, created_at FROM episodic_history WHERE content LIKE ? ORDER BY id DESC LIMIT ?", (f"%{query}%", limit))
            return cursor.fetchall()


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
        self.db_file = get_project_path(config.get('sqlite_memory_file', 'riko_memory.db'))
        self.max_turns = config.get('max_short_term_turns', 8)
        
        # SQLite Memory Store with RAG capabilities
        self.long_term_store = SQLiteMemoryStore(self.db_file)
        
        # Auto-migrate legacy JSON facts if present and SQLite is fresh
        if os.path.exists(self.long_term_file) and len(self.long_term_store.load_memories()) == 0:
            try:
                with open(self.long_term_file, 'r', encoding='utf-8') as f:
                    legacy_facts = json.load(f)
                    if isinstance(legacy_facts, list) and legacy_facts:
                        self.long_term_store.save_memories(legacy_facts)
                        print(f"📦 Auto-migrated {len(legacy_facts)} facts from long_term_memory.json to SQLite DB.")
            except Exception as e:
                print(f"⚠️ Legacy memory migration warning: {e}")

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
            
            # Also record latest turn into episodic history
            if len(history) > 0:
                last_msg = history[-1]
                role = last_msg.get('role', '')
                content_list = last_msg.get('content', [])
                text = ""
                if isinstance(content_list, list):
                    text = " ".join([c.get('text', '') for c in content_list if isinstance(c, dict)])
                else:
                    text = str(content_list)
                if role and text:
                    self.long_term_store.record_episodic_turn(role, text)
        except Exception as e:
            print(f"Error saving short term history: {e}")

    def load_long_term(self) -> list:
        return self.long_term_store.load_memories()

    def save_long_term(self, facts: list):
        self.long_term_store.save_memories(facts)

    def get_prompt_messages(self, user_query: str = None) -> list:
        """
        Builds the message list for LLM inference.
        Uses dynamic TF-IDF RAG vector search to inject top-K relevant memories per query.
        """
        history = self.load_short_term()
        facts = self.long_term_store.search_relevant_facts(user_query, top_k=8)
        triples = self.long_term_store.load_triples()
        
        injected_prompt = self.base_system_prompt
        memory_blocks = []

        if facts:
            facts_text = "\n".join([f"- {fact}" for fact in facts])
            memory_blocks.append(f"### PERSISTENT LONG-TERM MEMORIES (Relevant Facts):\n{facts_text}")

        if triples:
            triples_text = "\n".join([f"- ({t[0]} -> {t[1]} -> {t[2]})" for t in triples[:6]])
            memory_blocks.append(f"### KNOWLEDGE GRAPH RELATIONSHIPS:\n{triples_text}")

        if memory_blocks:
            injected_prompt = f"{self.base_system_prompt}\n\n" + "\n\n".join(memory_blocks)
            
        if history and history[0].get('role') == 'system':
            history[0]['content'] = [
                {
                    "type": "input_text",
                    "text": injected_prompt
                }
            ]
        else:
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
