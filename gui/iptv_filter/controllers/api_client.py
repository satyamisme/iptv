import requests
import time
from typing import Dict, Any
from iptv_filter.utils.constants import API_ENDPOINTS
from .cache_manager import CacheManager

class ApiClient:
    def __init__(self, cache_manager: CacheManager, api_base_url: str = "https://iptv-org.github.io/api"):
        self.cache = cache_manager
        self.api_base_url = api_base_url

    def fetch_data(self, key: str, force: bool = False, retries: int = 3, api_base_url: str = None) -> Any:
        """Fetches data from cache or API."""
        if not force:
            cached_data = self.cache.get(key)
            if cached_data is not None:
                return cached_data

        base = api_base_url or self.api_base_url
        url = f"{base}/{key}.json"
        
        for attempt in range(retries):
            try:
                response = requests.get(url, timeout=30)
                response.raise_for_status()
                data = response.json()
                self.cache.set(key, data)
                return data
            except requests.RequestException as e:
                if attempt == retries - 1:
                    raise
                time.sleep(2 ** attempt)

    def fetch_all(self, force: bool = False, progress_callback=None, api_base_url: str = None) -> Dict[str, Any]:
        """Fetches all necessary data for the application."""
        result = {}
        # Fetching channels, feeds, streams, languages, categories, countries
        keys = ["channels", "feeds", "streams", "languages", "categories", "countries"]
        total = len(keys)

        for i, key in enumerate(keys):
            if progress_callback:
                progress_callback(i, total, f"Fetching {key}...")
            result[key] = self.fetch_data(key, force=force, api_base_url=api_base_url)

        if progress_callback:
            progress_callback(total, total, "Finished fetching data.")

        return result
