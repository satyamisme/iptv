import os
import json
from typing import Set, Dict, List

class PreferencesManager:
    def __init__(self, data_dir: str = "."):
        self.data_dir = data_dir
        self.favorites_file = os.path.join(self.data_dir, "favorites.json")
        self.presets_file = os.path.join(self.data_dir, "presets.json")
        self.settings_file = os.path.join(self.data_dir, "settings.json")

        self.favorites: Set[str] = set()
        self.presets: Dict[str, dict] = self._default_presets()
        self.settings: dict = {
            "theme": "light",
            "last_loaded_file": "",
            "api_url": "https://iptv-org.github.io/api",
            "channel_limit": 10000,
            "stream_check_threads": 150,
            "stream_check_timeout": 3,
            "cache_expiry_hours": 24,
            "custom_playlists": [
                {"name": "iptv-org (Official API)", "type": "api", "url": "https://iptv-org.github.io/api"},
                {"name": "iptv-org (Index Playlist)", "type": "url", "url": "https://iptv-org.github.io/iptv/index.m3u"},
                {"name": "iptv-org (Index NSFW)", "type": "url", "url": "https://iptv-org.github.io/iptv/index.nsfw.m3u"},
                {"name": "iptv-org (Country-grouped)", "type": "url", "url": "https://iptv-org.github.io/iptv/index.country.m3u"},
                {"name": "iptv-org (Language-grouped)", "type": "url", "url": "https://iptv-org.github.io/iptv/index.language.m3u"},
                {"name": "iptv-org (Category-grouped)", "type": "url", "url": "https://iptv-org.github.io/iptv/index.category.m3u"}
            ]
        }

        self.load_all()

    def _default_presets(self) -> Dict[str, dict]:
        return {
            "Indian Languages": {"languages": ["hin", "tel", "tam", "mal", "kan"]},
            "Kids Content": {"categories": ["kids", "education"]},
            "Family Friendly": {"nsfw": False},
            "News & Education": {"categories": ["news", "education"]}
        }

    def _load_json(self, filepath: str, default: any) -> any:
        if os.path.exists(filepath):
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass
        return default

    def _save_json(self, filepath: str, data: any):
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving {filepath}: {e}")

    def load_all(self):
        fav_list = self._load_json(self.favorites_file, [])
        self.favorites = set(fav_list)

        loaded_presets = self._load_json(self.presets_file, {})
        # Merge with defaults
        self.presets = self._default_presets()
        self.presets.update(loaded_presets)

        loaded_settings = self._load_json(self.settings_file, {})
        # Merge theme, last_loaded_file, api_url
        for k, v in loaded_settings.items():
            if k != "custom_playlists":
                self.settings[k] = v
                
        # Merge custom_playlists carefully so we always keep default playlists
        loaded_playlists = loaded_settings.get("custom_playlists", [])
        default_playlists = self.settings["custom_playlists"]
        
        default_urls = {def_pl.get("url") for def_pl in default_playlists if def_pl.get("url")}
        merged_playlists = default_playlists.copy()
        
        # Append any loaded custom playlists that are not default playlists
        for pl in loaded_playlists:
            if pl.get("url") not in default_urls:
                merged_playlists.append(pl)
                
        self.settings["custom_playlists"] = merged_playlists


    def save_all(self):
        self._save_json(self.favorites_file, list(self.favorites))
        self._save_json(self.presets_file, self.presets)
        self._save_json(self.settings_file, self.settings)

    def toggle_favorite(self, channel_id: str) -> bool:
        """Returns True if added, False if removed"""
        if channel_id in self.favorites:
            self.favorites.remove(channel_id)
            self.save_all()
            return False
        else:
            self.favorites.add(channel_id)
            self.save_all()
            return True

    def is_favorite(self, channel_id: str) -> bool:
        return channel_id in self.favorites

    def save_preset(self, name: str, filters: dict):
        self.presets[name] = filters
        self.save_all()

    def get_preset(self, name: str) -> dict:
        return self.presets.get(name, {})

    def set_setting(self, key: str, value: any):
        self.settings[key] = value
        self.save_all()

    def get_setting(self, key: str, default: any = None) -> any:
        return self.settings.get(key, default)
