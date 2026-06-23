import os
import time
import json
from iptv_filter.utils.constants import CACHE_DIR, CACHE_EXPIRY_HOURS
from iptv_filter.utils.helpers import load_json_file, save_json_file

class CacheManager:
    def __init__(self, cache_dir: str = CACHE_DIR, expiry_hours: int = CACHE_EXPIRY_HOURS):
        self.cache_dir = cache_dir
        self.expiry_hours = expiry_hours
        self.metadata_file = os.path.join(self.cache_dir, "cache_metadata.json")
        self._ensure_cache_dir()

    def _ensure_cache_dir(self):
        os.makedirs(self.cache_dir, exist_ok=True)
        if not os.path.exists(self.metadata_file):
            save_json_file(self.metadata_file, {})

    def get_metadata(self):
        return load_json_file(self.metadata_file) or {}

    def set_metadata(self, metadata):
        save_json_file(self.metadata_file, metadata)

    def is_cache_valid(self, key: str) -> bool:
        metadata = self.get_metadata()
        timestamp = metadata.get(key, {}).get("timestamp", 0)
        current_time = time.time()
        age_hours = (current_time - timestamp) / 3600
        filepath = os.path.join(self.cache_dir, f"{key}.json")
        return age_hours < self.expiry_hours and os.path.exists(filepath)

    def get(self, key: str):
        if self.is_cache_valid(key):
            filepath = os.path.join(self.cache_dir, f"{key}.json")
            return load_json_file(filepath)
        return None

    def set(self, key: str, data):
        filepath = os.path.join(self.cache_dir, f"{key}.json")
        save_json_file(filepath, data)
        metadata = self.get_metadata()
        metadata[key] = {"timestamp": time.time()}
        self.set_metadata(metadata)
