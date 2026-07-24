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
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS relationship_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            ''')
            cursor.execute("INSERT OR IGNORE INTO relationship_state (key, value) VALUES ('affection_score', '25')")
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
        # Load facts with created_at timestamps to calculate recency decay
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT fact, created_at FROM facts ORDER BY id ASC")
            rows = cursor.fetchall()
        
        if not rows:
            return []
            
        all_facts = [r[0] for r in rows]
        fact_timestamps = [r[1] for r in rows]
        
        if not query or not query.strip():
            return all_facts[:top_k]
            
        query_words = [w for w in re.findall(r'\w+', query.lower()) if len(w) > 1]
        if not query_words:
            return all_facts[:top_k]
            
        # Compute term frequency, document lengths, and avg doc length
        docs_words = []
        for fact in all_facts:
            words = re.findall(r'\w+', fact.lower())
            docs_words.append(words)
            
        doc_lengths = [len(d) for d in docs_words]
        avg_doc_len = sum(doc_lengths) / len(doc_lengths) if doc_lengths else 1.0
        
        # Document Frequency for query terms
        df = {}
        for qw in query_words:
            df[qw] = sum(1 for d in docs_words if qw in d)
            
        N = len(all_facts)
        k1 = 1.2
        b = 0.75
        
        from datetime import datetime
        now = datetime.utcnow()
        
        scored_facts = []
        for idx, fact in enumerate(all_facts):
            words = docs_words[idx]
            doc_len = doc_lengths[idx]
            
            # BM25 Raw Score
            bm25_score = 0.0
            for qw in query_words:
                if qw in words:
                    tf = words.count(qw)
                    n_q = df.get(qw, 0)
                    # Safe IDF log
                    idf = math.log((N - n_q + 0.5) / (n_q + 0.5) + 1.0)
                    term_score = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc_len / avg_doc_len)))
                    bm25_score += term_score
                    
            # Recency Decay Factor (decay score up to 30% for older items)
            decay_factor = 1.0
            try:
                ts_str = fact_timestamps[idx]
                ts = datetime.strptime(ts_str.split('.')[0], "%Y-%m-%d %H:%M:%S")
                delta_days = (now - ts).total_seconds() / (24 * 3600)
                # ln(2)/30 ≈ 0.023 -> 30-day half-life decay
                decay_factor = math.exp(-0.023 * max(0.0, delta_days))
            except Exception:
                pass
                
            final_score = bm25_score * (0.7 + 0.3 * decay_factor)
            scored_facts.append((final_score, fact))
            
        scored_facts.sort(key=lambda x: x[0], reverse=True)
        
        relevant = [fact for score, fact in scored_facts if score > 0]
        if len(relevant) < top_k:
            for score, fact in scored_facts:
                if fact not in relevant:
                    relevant.append(fact)
                    if len(relevant) >= top_k:
                        break
        return relevant[:top_k]

    def search_relevant_triples(self, query: str = None, limit: int = 6) -> list:
        if not query or not query.strip():
            return []
            
        # Extract keywords of length > 3
        words = [w.strip().lower() for w in re.findall(r'\w+', query) if len(w) > 3]
        if not words:
            return []
            
        relevant_triples = []
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            for word in words:
                cursor.execute(
                    "SELECT subject, relation, object FROM knowledge_triples WHERE LOWER(subject) LIKE ? OR LOWER(object) LIKE ? LIMIT ?",
                    (f"%{word}%", f"%{word}%", limit)
                )
                rows = cursor.fetchall()
                for r in rows:
                    if r not in relevant_triples:
                        relevant_triples.append(r)
                        if len(relevant_triples) >= limit:
                            break
                if len(relevant_triples) >= limit:
                    break
        return relevant_triples

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
        Uses dynamic BM25 ranking + Graph Triples RAG to inject top-K relevant facts.
        """
        history = self.load_short_term()
        facts = self.long_term_store.search_relevant_facts(user_query, top_k=8)
        triples = self.long_term_store.search_relevant_triples(user_query, limit=6)
        
        # Determine affection level behavior modifier
        affection_score = 25
        try:
            with sqlite3.connect(self.db_file) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT value FROM relationship_state WHERE key = 'affection_score'")
                row = cursor.fetchone()
                if row:
                    affection_score = int(row[0])
        except Exception:
            pass

        if affection_score <= 15:
            modifier = "\n[RELATIONSHIP STATUS: ANNOYED (Lv. 1). Act highly cold, very dismissive, sarcastic, and extremely reluctant to cooperate. Complain about Senpai's requests.]"
        elif affection_score <= 45:
            modifier = "\n[RELATIONSHIP STATUS: TOLERABLE (Lv. 2). Act like a standard tsundere—reluctantly helpful but complaining, calling Senpai 'idiot' or 'baka' occasionally.]"
        elif affection_score <= 75:
            modifier = "\n[RELATIONSHIP STATUS: FRIENDLY (Lv. 3). Act softer and cooperative. Show concern, blush when patted or complimented, but try to hide it under a tsundere act.]"
        else:
            modifier = "\n[RELATIONSHIP STATUS: AFFECTIONATE (Lv. 4). Act sweet, protective, and easily flustered. Openly show affection and support for your beloved Senpai!]"

        injected_prompt = self.base_system_prompt + modifier
        memory_blocks = []

        if facts:
            facts_text = "\n".join([f"- {fact}" for fact in facts])
            memory_blocks.append(f"### PERSISTENT LONG-TERM MEMORIES (Relevant Facts):\n{facts_text}")

        if triples:
            triples_text = "\n".join([f"- ({t[0]} -> {t[1]} -> {t[2]})" for t in triples])
            memory_blocks.append(f"### KNOWLEDGE GRAPH RELATIONSHIPS:\n{triples_text}")

        if memory_blocks:
            injected_prompt = f"{self.base_system_prompt + modifier}\n\n" + "\n\n".join(memory_blocks)
            
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
        Extracts both plain facts and relational graph triples.
        """
        history = self.load_short_term()
        
        non_system_msgs = [m for m in history if m.get('role') != 'system']
        num_turns = len(non_system_msgs) // 2
        
        if num_turns <= self.max_turns:
            return
            
        turns_to_consolidate = num_turns // 2
        msgs_to_consolidate_count = turns_to_consolidate * 2
        
        msgs_to_consolidate = non_system_msgs[:msgs_to_consolidate_count]
        remaining_msgs = non_system_msgs[msgs_to_consolidate_count:]
        
        conv_text = ""
        for m in msgs_to_consolidate:
            role = m.get('role', '').capitalize()
            content_list = m.get('content', [])
            text = ""
            if isinstance(content_list, list):
                text = " ".join([c.get('text', '') for c in content_list if isinstance(c, dict) and c.get('type') == 'input_text'])
            else:
                text = str(content_list)
            conv_text += f"{role}: {text}\n"
            
        existing_facts = self.load_long_term()
        existing_facts_text = "\n".join([f"- {fact}" for fact in existing_facts]) if existing_facts else "(None)"
        
        prompt = f"""
You are the memory manager for an AI companion.
Your job is to:
1. Extract durable facts, user preferences, and key recurring topics from the following conversation segment, and merge/update them with the existing list of facts.
2. Extract key relational triples representing connections in the format: [Subject | Relation | Object] (e.g. [User | likes | Python], [Riko | is | ticklish]). Keep them simple and concise.

Existing facts:
{existing_facts_text}

New conversation segment:
{conv_text}

Rules:
1. Extract new facts about the user (e.g., name, hobbies, preferences, feelings) or key topics discussed.
2. Combine and update any existing facts if the conversation segment provides new info.
3. Keep the list concise and relevant. Avoid temporary or trivial statements.
4. Format your output strictly in two clear sections starting with header lines:
--- FACTS ---
- <fact 1>
- <fact 2>
--- TRIPLES ---
- [Subject | Relation | Object]
- [Subject | Relation | Object]

Do not include any thinking tags or introductory/concluding remarks.
"""
        try:
            print("🧠 Consolidating old chat history into long-term memory...")
            response = ollama_client.chat(
                model=model,
                messages=[
                    {"role": "system", "content": "You are a precise information extraction assistant. Output only the requested sections, starting each line with '- '."},
                    {"role": "user", "content": prompt}
                ]
            )
            content = response.get('message', {}).get('content', '')
            content = strip_thinking(content)
            
            # Parse facts and triples sections
            new_facts = []
            new_triples = []
            
            in_facts = True
            for line in content.split('\n'):
                line = line.strip()
                if "--- FACTS ---" in line:
                    in_facts = True
                    continue
                if "--- TRIPLES ---" in line:
                    in_facts = False
                    continue
                
                if line.startswith('-') or line.startswith('*'):
                    item = line[1:].strip()
                    if not item:
                        continue
                    if in_facts:
                        new_facts.append(item)
                    else:
                        item = item.strip('[]')
                        parts = [p.strip() for p in item.split('|')]
                        if len(parts) == 3:
                            new_triples.append(parts)
            
            # Fallback parse if formatting got lost
            if not new_facts and not new_triples:
                for line in content.split('\n'):
                    line = line.strip()
                    if line.startswith('-'):
                        fact = line[1:].strip()
                        if fact:
                            new_facts.append(fact)
            
            if new_facts:
                self.save_long_term(new_facts)
                print(f"💾 Saved {len(new_facts)} facts to long-term memory.")
                
            if new_triples:
                for t in new_triples:
                    try:
                        self.long_term_store.save_triple(t[0], t[1], t[2])
                    except Exception:
                        pass
                print(f"🕸️ Saved {len(new_triples)} knowledge triples to database.")
            
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
