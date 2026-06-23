API_BASE_URL = "https://iptv-org.github.io/api"
API_ENDPOINTS = {
    "channels": f"{API_BASE_URL}/channels.json",
    "feeds": f"{API_BASE_URL}/feeds.json",
    "streams": f"{API_BASE_URL}/streams.json",
    "languages": f"{API_BASE_URL}/languages.json",
    "categories": f"{API_BASE_URL}/categories.json",
    "countries": f"{API_BASE_URL}/countries.json",
}

CACHE_DIR = "cache"
CACHE_EXPIRY_HOURS = 24
