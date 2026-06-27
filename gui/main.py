import os
import sys
import threading
import webbrowser
import time
import json
import re
from flask import Flask, jsonify, request, render_template, send_file
import io
import requests

from iptv_filter.controllers.api_client import ApiClient
from iptv_filter.controllers.cache_manager import CacheManager
from iptv_filter.controllers.playlist_parser import DataProcessor
from iptv_filter.controllers.filter_engine import FilterEngine
from iptv_filter.controllers.export_manager import ExportManager
from iptv_filter.controllers.preferences_manager import PreferencesManager
from iptv_filter.utils.stream_checker import StreamChecker
from iptv_filter.utils.language_groups import get_language_group
from iptv_filter.models.channel import Channel
from iptv_filter.utils.countries_map import COUNTRIES_MAP

def normalize_country(country_str):
    if not country_str:
        return ""
    country_str = str(country_str).strip()
    code_lower = country_str.lower()
    if code_lower in COUNTRIES_MAP:
        return COUNTRIES_MAP[code_lower]
    # Try mapping values case-insensitively
    for val in COUNTRIES_MAP.values():
        if val.lower() == code_lower:
            return val
    return country_str.title()

app = Flask(__name__, 
            static_folder=os.path.join("iptv_filter", "static"),
            template_folder=os.path.join("iptv_filter", "templates"))

# Initialize controllers
prefs = PreferencesManager()
cache_manager = CacheManager()
cache_manager.expiry_hours = int(prefs.get_setting("cache_expiry_hours", 24))
api_client = ApiClient(cache_manager)
data_processor = DataProcessor()
filter_engine = FilterEngine()

# Status cache file
STATUS_FILE = os.path.join(cache_manager.cache_dir, "stream_status.json")
PLAYLIST_STATE_FILE = os.path.join(cache_manager.cache_dir, "playlist_state.json")

def load_stream_statuses():
    if os.path.exists(STATUS_FILE):
        try:
            with open(STATUS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading stream statuses: {e}")
    return {}

def save_stream_statuses():
    statuses = load_stream_statuses()
    for ch in filter_engine.channels:
        statuses[ch.id] = {
            "status_icon": ch.status_icon,
            "status_text": ch.status_text
        }
    try:
        os.makedirs(os.path.dirname(STATUS_FILE), exist_ok=True)
        with open(STATUS_FILE, "w", encoding="utf-8") as f:
            json.dump(statuses, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"Error saving stream statuses: {e}")

def save_playlist_state():
    try:
        os.makedirs(os.path.dirname(PLAYLIST_STATE_FILE), exist_ok=True)
        channels_data = []
        for ch in filter_engine.channels:
            channels_data.append({
                "id": ch.id,
                "name": ch.name,
                "alt_names": ch.alt_names,
                "network": ch.network,
                "owners": ch.owners,
                "country": ch.country,
                "categories": ch.categories,
                "is_nsfw": ch.is_nsfw,
                "launched": ch.launched,
                "closed": ch.closed,
                "replaced_by": ch.replaced_by,
                "website": ch.website,
                "streams": ch.streams,
                "languages": ch.languages,
                "status_icon": ch.status_icon,
                "status_text": ch.status_text
            })
        with open(PLAYLIST_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(channels_data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"Error saving playlist state: {e}")
        return False

def load_playlist_state():
    if os.path.exists(PLAYLIST_STATE_FILE):
        try:
            with open(PLAYLIST_STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            channels = []
            for item in data:
                resolved_country = normalize_country(item.get("country"))
                ch = Channel(
                    id=item.get("id"),
                    name=item.get("name"),
                    alt_names=item.get("alt_names", []),
                    network=item.get("network"),
                    owners=item.get("owners", []),
                    country=resolved_country,
                    categories=item.get("categories", []),
                    is_nsfw=item.get("is_nsfw", False),
                    launched=item.get("launched"),
                    closed=item.get("closed"),
                    replaced_by=item.get("replaced_by"),
                    website=item.get("website"),
                    streams=item.get("streams", []),
                    languages=item.get("languages", []),
                    status_icon=item.get("status_icon", "❓"),
                    status_text=item.get("status_text", "Unknown")
                )
                channels.append(ch)
            data_processor.enrich_channels(channels)
            filter_engine.load_channels(channels)
            return True
        except Exception as e:
            print(f"Error loading playlist state: {e}")
    return False

CUSTOM_CHANNELS_FILE = os.path.join(cache_manager.cache_dir, "custom_channels.json")

def load_custom_channels():
    if os.path.exists(CUSTOM_CHANNELS_FILE):
        try:
            with open(CUSTOM_CHANNELS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            channels = []
            for item in data:
                resolved_country = normalize_country(item.get("country"))
                ch = Channel(
                    id=item.get("id"),
                    name=item.get("name"),
                    alt_names=item.get("alt_names", []),
                    network=item.get("network"),
                    owners=item.get("owners", []),
                    country=resolved_country,
                    categories=item.get("categories", []),
                    is_nsfw=item.get("is_nsfw", False),
                    launched=item.get("launched"),
                    closed=item.get("closed"),
                    replaced_by=item.get("replaced_by"),
                    website=item.get("website"),
                    streams=item.get("streams", []),
                    languages=item.get("languages", []),
                    status_icon=item.get("status_icon", "❓"),
                    status_text=item.get("status_text", "Unknown")
                )
                channels.append(ch)
            return channels
        except Exception as e:
            print(f"Error loading custom channels: {e}")
    return []

def save_custom_channels(custom_list):
    try:
        os.makedirs(os.path.dirname(CUSTOM_CHANNELS_FILE), exist_ok=True)
        channels_data = []
        for ch in custom_list:
            channels_data.append({
                "id": ch.id,
                "name": ch.name,
                "alt_names": ch.alt_names,
                "network": ch.network,
                "owners": ch.owners,
                "country": ch.country,
                "categories": ch.categories,
                "is_nsfw": ch.is_nsfw,
                "launched": ch.launched,
                "closed": ch.closed,
                "replaced_by": ch.replaced_by,
                "website": ch.website,
                "streams": ch.streams,
                "languages": ch.languages,
                "status_icon": ch.status_icon,
                "status_text": ch.status_text
            })
        with open(CUSTOM_CHANNELS_FILE, "w", encoding="utf-8") as f:
            json.dump(channels_data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"Error saving custom channels: {e}")
        return False

def merge_custom_channels(channels_list):
    customs = load_custom_channels()
    custom_map = {c.id: c for c in customs}
    
    # Replace in place for existing ones
    for i, ch in enumerate(channels_list):
        if ch.id in custom_map:
            channels_list[i] = custom_map[ch.id]
            del custom_map[ch.id]
            
    # Insert new ones at the beginning
    for c in custom_map.values():
        channels_list.insert(0, c)


# Thread-safe global variables for async tasks
load_status = {
    "loaded": False,
    "loading": False,
    "error": None,
    "count": 0
}

checking_progress = {
    "completed": 0,
    "total": 0,
    "running": False,
    "status": "Idle",
    "latest_results": [],
    "metrics": {}
}

active_playlist_source = {
    "name": "iptv-org (Official API)",
    "type": "api",
    "url": "https://iptv-org.github.io/api"
}

def get_system_metrics():
    try:
        import psutil
        process = psutil.Process(os.getpid())
        cpu = psutil.cpu_percent()
        ram = process.memory_info().rss / (1024 * 1024)  # MB
        ram_percent = psutil.virtual_memory().percent
        net = psutil.net_io_counters()
        return {
            "cpu_percent": cpu,
            "ram_mb": round(ram, 2),
            "ram_percent": ram_percent,
            "network_sent_mb": round(net.bytes_sent / (1024 * 1024), 2),
            "network_recv_mb": round(net.bytes_recv / (1024 * 1024), 2),
            "threads_active": threading.active_count()
        }
    except Exception:
        # Fallback to simulated/estimated values
        import random
        num_channels = len(filter_engine.channels) if hasattr(filter_engine, 'channels') else 0
        est_ram = 150.0 + num_channels * 0.005  # roughly
        active_threads = threading.active_count()
        cpu_est = min(99.0, active_threads * 0.5 + random.uniform(5, 15)) if active_threads > 5 else random.uniform(2, 5)
        return {
            "cpu_percent": round(cpu_est, 1),
            "ram_mb": round(est_ram, 1),
            "ram_percent": round(min(90.0, est_ram / 160.0), 1),
            "network_sent_mb": 0.0,
            "network_recv_mb": 0.0,
            "threads_active": active_threads
        }

# Helpers
def load_initial_data():
    global load_status
    if load_status["loading"]:
        return
    load_status["loading"] = True
    load_status["error"] = None
    
    try:
        # Try loading saved state first to avoid rescanning/refetching
        if load_playlist_state():
            load_status["loaded"] = True
            load_status["count"] = len(filter_engine.channels)
            return
            
        # Fallback to fetching API
        api_base = prefs.get_setting("api_url", "https://iptv-org.github.io/api")
        api_data = api_client.fetch_all(api_base_url=api_base)
        playlist = data_processor.process_data(api_data)
        
        # Apply cached stream statuses
        statuses = load_stream_statuses()
        for ch in playlist.channels:
            if ch.id in statuses:
                ch.status_text = statuses[ch.id]["status_text"]
                ch.status_icon = statuses[ch.id]["status_icon"]
                
        merge_custom_channels(playlist.channels)
        filter_engine.load_channels(playlist.channels)
        save_playlist_state()
        load_status["loaded"] = True
        load_status["count"] = len(filter_engine.channels)
    except Exception as e:
        load_status["error"] = str(e)
    finally:
        load_status["loading"] = False

@app.route("/")
def index():
    return render_template("index.html", cache_buster=int(time.time()))

@app.route("/api/status")
def get_status():
    stats = {}
    if load_status["loaded"]:
        stats = filter_engine.get_statistics()
    return jsonify({
        "loaded": load_status["loaded"],
        "loading": load_status["loading"],
        "error": load_status["error"],
        "total_channels": load_status["count"],
        "statistics": stats
    })

def apply_cached_statuses(channels_list):
    statuses = load_stream_statuses()
    for ch in channels_list:
        if ch.id in statuses:
            ch.status_text = statuses[ch.id]["status_text"]
            ch.status_icon = statuses[ch.id]["status_icon"]

@app.route("/api/load", methods=["POST"])
def load_data():
    req_data = request.json or {}
    source = req_data.get("source", "api")
    
    global load_status
    load_status["loading"] = True
    load_status["error"] = None
    load_status["loaded"] = False
    
    def worker():
        global active_playlist_source
        try:
            if source == "api":
                api_base = prefs.get_setting("api_url", "https://iptv-org.github.io/api")
                api_data = api_client.fetch_all(force=True, api_base_url=api_base)
                playlist = data_processor.process_data(api_data)
                active_playlist_source = {
                    "name": "iptv-org (Official API)",
                    "type": "api",
                    "url": api_base
                }
            elif source == "url":
                url = req_data.get("url")
                if not url:
                    raise ValueError("URL is required")
                playlist = data_processor.load_m3u_url(url)
                active_playlist_source = {
                    "name": "Temporary URL List",
                    "type": "url",
                    "url": url
                }
            elif source == "file":
                filepath = req_data.get("filepath")
                if not filepath or not os.path.exists(filepath):
                    raise ValueError("Valid file path is required")
                playlist = data_processor.load_m3u_file(filepath)
                prefs.set_setting("last_loaded_file", filepath)
                active_playlist_source = {
                    "name": os.path.basename(filepath),
                    "type": "file",
                    "url": filepath
                }
            
            apply_cached_statuses(playlist.channels)
            merge_custom_channels(playlist.channels)
            filter_engine.load_channels(playlist.channels)
            save_playlist_state()
            load_status["loaded"] = True
            load_status["count"] = len(filter_engine.channels)
        except Exception as e:
            load_status["error"] = str(e)
        finally:
            load_status["loading"] = False
            
    threading.Thread(target=worker, daemon=True).start()
    return jsonify({"status": "loading"})

@app.route("/api/upload-m3u", methods=["POST"])
def upload_m3u():
    if "file" not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400
    
    global load_status
    load_status["loading"] = True
    load_status["error"] = None
    load_status["loaded"] = False
    
    try:
        content = file.read().decode("utf-8", errors="ignore")
        playlist = data_processor.process_m3u(content)
        apply_cached_statuses(playlist.channels)
        merge_custom_channels(playlist.channels)
        filter_engine.load_channels(playlist.channels)
        save_playlist_state()
        load_status["loaded"] = True
        load_status["count"] = len(filter_engine.channels)
        return jsonify({"status": "success", "count": len(filter_engine.channels)})
    except Exception as e:
        load_status["error"] = str(e)
        load_status["loading"] = False
        return jsonify({"error": str(e)}), 500

@app.route("/api/filters-data")
def get_filters_data():
    if not load_status["loaded"]:
        return jsonify({"error": "Data not loaded"}), 400
        
    languages = list(filter_engine.channels_by_language.keys())
    categories = list(filter_engine.channels_by_category.keys())
    countries_counts = filter_engine.get_country_counts()
    
    # Map languages to regional groups
    grouped_languages = {}
    for display_name in languages:
        code = data_processor.language_code_map.get(display_name, display_name)
        group_name = get_language_group(code)
        grouped_languages.setdefault(group_name, []).append({
            "name": display_name,
            "code": code
        })
        
    # Sort groups and languages within groups
    sorted_groups = {}
    for g, langs in grouped_languages.items():
        sorted_groups[g] = sorted(langs, key=lambda x: x["name"])
        
    return jsonify({
        "languages": sorted_groups,
        "categories": sorted(categories),
        "countries": countries_counts,
        "presets": prefs.presets,
        "favorites": list(prefs.favorites)
    })

@app.route("/api/channels", methods=["POST"])
def get_channels():
    if not load_status["loaded"]:
        return jsonify({"error": "Data not loaded"}), 400
        
    filters = request.json or {}
    # Apply favorite list from preferences
    filters["favorites_set"] = prefs.favorites
    
    # Apply filters in engine
    filtered = filter_engine.apply_filters(**filters)
    
    # Format channel list for frontend
    results = []
    # Cap details sent to browser based on settings
    channel_limit = filters.get("channel_limit", int(prefs.get_setting("channel_limit", 10000)))
    if channel_limit > 0:
        capped_list = filtered[:channel_limit]
    else:
        capped_list = filtered
    
    for ch in capped_list:
        results.append({
            "id": ch.id,
            "name": ch.name,
            "country": ch.country,
            "categories": ch.categories,
            "languages": ch.languages,
            "is_nsfw": ch.is_nsfw,
            "status_text": ch.status_text,
            "status_icon": ch.status_icon,
            "is_favorite": ch.id in prefs.favorites,
            "url": ch.streams[0].get("url") if ch.streams else None,
            "user_agent": ch.streams[0].get("user_agent") if ch.streams else None,
            "referrer": ch.streams[0].get("referrer") if ch.streams else None,
            "streams": [{"url": s.get("url"), "quality": s.get("quality"), "label": s.get("label")} for s in ch.streams] if ch.streams else []
        })
        
    # Calculate counts for facets (languages, categories, countries) independently of the selections in these three facets
    filters_no_facets = filters.copy()
    filters_no_facets["languages"] = None
    filters_no_facets["categories"] = None
    filters_no_facets["countries"] = None
    filtered_no_facets = filter_engine.apply_filters(**filters_no_facets)

    # 1. Languages counts
    lang_counts = {}
    for ch in filtered_no_facets:
        for lang in ch.languages:
            lang_counts[lang] = lang_counts.get(lang, 0) + 1

    # 2. Categories counts
    cat_counts = {}
    for ch in filtered_no_facets:
        for cat in ch.categories:
            cat_counts[cat] = cat_counts.get(cat, 0) + 1

    # 3. Countries counts
    country_counts = {}
    for ch in filtered_no_facets:
        if ch.country:
            country_counts[ch.country] = country_counts.get(ch.country, 0) + 1

    # Restore main filtered channels list for correctness
    filter_engine.filtered_channels = filtered


    # Log debug information to file
    try:
        log_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "debug_api.log"))
        with open(log_path, "a", encoding="utf-8") as lf:
            lf.write("=========================================\n")
            lf.write(f"TIMESTAMP: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            lf.write(f"INCOMING REQUEST: {json.dumps({k: v for k, v in filters.items() if k != 'favorites_set'})}\n")
            lf.write(f"FILTERS NO FACETS: {json.dumps({k: v for k, v in filters_no_facets.items() if k not in ['favorites_set']})}\n")
            lf.write(f"FILTERED NO FACETS COUNT: {len(filtered_no_facets)}\n")
            lf.write(f"LANGS SAMPLE: {list(lang_counts.items())[:5]}\n")
            lf.write(f"CATS SAMPLE: {list(cat_counts.items())[:5]}\n")
            lf.write(f"COUNTRIES SAMPLE: {list(country_counts.items())[:5]}\n")
    except Exception as le:
        print(f"Error writing to debug log: {le}")

    return jsonify({
        "total": len(filter_engine.channels),
        "filtered_count": len(filtered),
        "shown_count": len(results),
        "channels": results,
        "counts": {
            "languages": lang_counts,
            "categories": cat_counts,
            "countries": country_counts
        }
    })

@app.route("/api/favorites/toggle", methods=["POST"])
def toggle_favorite():
    req_data = request.json or {}
    channel_id = req_data.get("channel_id")
    if not channel_id:
        return jsonify({"error": "Channel ID required"}), 400
        
    is_added = prefs.toggle_favorite(channel_id)
    return jsonify({"is_favorite": is_added})

@app.route("/api/favorites/bulk-update", methods=["POST"])
def bulk_update_favorites():
    req_data = request.json or {}
    channel_ids = req_data.get("channel_ids", [])
    action = req_data.get("action", "add")
    
    if not channel_ids:
        return jsonify({"error": "Channel IDs are required"}), 400
        
    for ch_id in channel_ids:
        if action == "add":
            prefs.favorites.add(ch_id)
        elif action == "remove":
            prefs.favorites.discard(ch_id)
            
    prefs.save_all()
    return jsonify({"success": True, "favorites": list(prefs.favorites)})

@app.route("/api/check-streams", methods=["POST"])
def check_streams():
    global checking_progress
    if checking_progress["running"]:
        return jsonify({"status": "already_running"})
        
    req_data = request.json or {}
    channel_ids = req_data.get("channel_ids")
    resume = req_data.get("resume", False)
    
    if channel_ids:
        # Check only the selected channels
        channels_to_check = [c for c in filter_engine.channels if c.id in channel_ids]
    elif resume:
        # Check only channels where status is Unknown
        channels_to_check = [c for c in filter_engine.filtered_channels if c.status_text == "Unknown"]
    else:
        # Check all filtered channels
        channels_to_check = filter_engine.filtered_channels.copy()
        
    if not channels_to_check:
        return jsonify({"status": "no_channels"}), 200
        
    checking_progress["total"] = len(channels_to_check)
    checking_progress["completed"] = 0
    checking_progress["running"] = True
    checking_progress["status"] = "Starting stream check..."
    checking_progress["latest_results"] = []
    
    StreamChecker.reset_cancel()
    
    def on_progress(completed, total, last_checked=None):
        global checking_progress
        checking_progress["completed"] = completed
        checking_progress["total"] = total
        checking_progress["status"] = f"Checking streams: {completed}/{total}"
        if last_checked:
            if "latest_results" not in checking_progress:
                checking_progress["latest_results"] = []
            checking_progress["latest_results"].append(last_checked)
            if len(checking_progress["latest_results"]) > 15:
                checking_progress["latest_results"].pop(0)
        
    def on_done():
        global checking_progress
        checking_progress["running"] = False
        if StreamChecker._cancel_event.is_set():
            checking_progress["status"] = "Scan cancelled."
        else:
            checking_progress["status"] = "Finished stream check."
        save_stream_statuses()
        save_playlist_state()
        
    threads = int(prefs.get_setting("stream_check_threads", 150))
    timeout = int(prefs.get_setting("stream_check_timeout", 3))
    
    StreamChecker.check_channels(channels_to_check, on_progress, on_done, max_workers=threads, timeout=timeout)
    return jsonify({"status": "started"})

@app.route("/api/check-streams-progress")
def check_streams_progress():
    global checking_progress
    checking_progress["metrics"] = get_system_metrics()
    return jsonify(checking_progress)

@app.route("/api/cancel-check", methods=["POST"])
def cancel_check():
    global checking_progress
    StreamChecker.cancel_all()
    checking_progress["running"] = False
    checking_progress["status"] = "Scan cancelled by user."
    return jsonify({"status": "cancelled"})

@app.route("/api/channels/check-single", methods=["POST"])
def check_single_stream():
    req_data = request.json or {}
    channel_id = req_data.get("channel_id")
    if not channel_id:
        return jsonify({"error": "Channel ID required"}), 400
        
    ch = next((c for c in filter_engine.channels if c.id == channel_id), None)
    if not ch:
        return jsonify({"error": "Channel not found"}), 404
        
    if ch.streams:
        url = ch.streams[0].get("url")
        user_agent = ch.streams[0].get("user_agent")
        referrer = ch.streams[0].get("referrer")
        headers = {}
        if user_agent:
            headers["User-Agent"] = user_agent
        if referrer:
            headers["Referer"] = referrer
            
        if url:
            timeout = int(prefs.get_setting("stream_check_timeout", 3))
            res = StreamChecker.check_stream(url, timeout=timeout, headers=headers)
            ch.status_icon = res["icon"]
            ch.status_text = res["status"]
        else:
            ch.status_icon = "❓"
            ch.status_text = "Unknown"
    else:
        ch.status_icon = "❌"
        ch.status_text = "No Stream"
        
    save_stream_statuses()
    return jsonify({
        "id": ch.id,
        "status_text": ch.status_text,
        "status_icon": ch.status_icon
    })

@app.route("/api/proxy")
def proxy_stream():
    url = request.args.get("url")
    if not url:
        return "Missing url parameter", 400
        
    from urllib.parse import urljoin, quote
    
    headers = {}
    user_agent = request.args.get("user_agent")
    referrer = request.args.get("referrer")
    
    if user_agent:
        headers["User-Agent"] = user_agent
    else:
        headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        
    if referrer:
        headers["Referer"] = referrer
        
    try:
        response = requests.get(url, headers=headers, stream=True, timeout=10)
        content_type = response.headers.get("Content-Type", "")
        
        # If it's an HLS manifest, we can rewrite relative paths to absolute paths
        if "mpegurl" in content_type.lower() or url.split('?')[0].endswith(".m3u8") or url.split('?')[0].endswith(".m3u"):
            text = response.text
            base_url = response.url
            
            lines = text.splitlines()
            new_lines = []
            for line in lines:
                line_stripped = line.strip()
                if line_stripped and not line_stripped.startswith("#"):
                    # Resolve relative URI
                    absolute_url = urljoin(base_url, line_stripped)
                    # Pass segments through proxy too
                    proxy_param = f"/api/proxy?url={quote(absolute_url)}"
                    if user_agent:
                        proxy_param += f"&user_agent={quote(user_agent)}"
                    if referrer:
                        proxy_param += f"&referrer={quote(referrer)}"
                    new_lines.append(proxy_param)
                elif line_stripped.startswith("#EXT-X-STREAM-INF:") or line_stripped.startswith("#EXT-X-MEDIA:"):
                    newline = line
                    uri_match = re.search(r'URI="([^"]+)"', line)
                    if uri_match:
                        rel_uri = uri_match.group(1)
                        abs_uri = urljoin(base_url, rel_uri)
                        proxy_uri = f"/api/proxy?url={quote(abs_uri)}"
                        if user_agent:
                            proxy_uri += f"&user_agent={quote(user_agent)}"
                        if referrer:
                            proxy_uri += f"&referrer={quote(referrer)}"
                        newline = line.replace(f'URI="{rel_uri}"', f'URI="{proxy_uri}"')
                    new_lines.append(newline)
                else:
                    new_lines.append(line)
                    
            proxied_content = "\n".join(new_lines)
            flask_response = app.response_class(
                response=proxied_content,
                status=response.status_code,
                mimetype="application/vnd.apple.mpegurl"
            )
            flask_response.headers["Access-Control-Allow-Origin"] = "*"
            return flask_response
        else:
            # Non-manifest (like a TS segment). Stream it!
            def generate():
                for chunk in response.iter_content(chunk_size=8192):
                    yield chunk
            flask_response = app.response_class(
                response=generate(),
                status=response.status_code,
                mimetype=content_type
            )
            flask_response.headers["Access-Control-Allow-Origin"] = "*"
            return flask_response
            
    except Exception as e:
        return str(e), 500

@app.route("/api/remove-duplicates", methods=["POST"])
def remove_duplicates():
    count = filter_engine.remove_duplicates()
    save_playlist_state()
    return jsonify({"removed": count})

@app.route("/api/remove-dead", methods=["POST"])
def remove_dead():
    count = filter_engine.remove_dead_streams()
    save_playlist_state()
    return jsonify({"removed": count})

@app.route("/api/remove-geoblocked", methods=["POST"])
def remove_geoblocked():
    count = filter_engine.remove_geoblocked_streams()
    save_playlist_state()
    return jsonify({"removed": count})

@app.route("/api/cache/clear", methods=["POST"])
def clear_api_cache():
    raw_files = ["channels.json", "feeds.json", "streams.json", "languages.json", "categories.json", "countries.json", "cache_metadata.json"]
    cleared = []
    for filename in raw_files:
        filepath = os.path.join(cache_manager.cache_dir, filename)
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
                cleared.append(filename)
            except Exception as e:
                print(f"Error removing raw cache file {filename}: {e}")
    return jsonify({"status": "success", "cleared_files": cleared})

@app.route("/api/custom/selected", methods=["GET"])
def get_custom_selected():
    if not load_status["loaded"]:
        return jsonify({"error": "Data not loaded"}), 400
        
    rules_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "custom", "selected-channels.txt"))
    rules = []
    if os.path.exists(rules_path):
        try:
            with open(rules_path, "r", encoding="utf-8") as f:
                rules = [line.strip() for line in f if line.strip() and not line.strip().startswith("#")]
        except Exception as e:
            return jsonify({"error": f"Failed to read rules file: {str(e)}"}), 500
        
    matched_ids = []
    excluded_ids = []
    
    # Process exclusions and inclusions
    for rule in rules:
        is_exclude = rule.startswith("-")
        clean_rule = rule[1:].strip() if is_exclude else rule
        if not clean_rule:
            continue
            
        for ch in filter_engine.channels:
            matched = False
            if clean_rule.startswith("/") and clean_rule.endswith("/"):
                try:
                    pattern = clean_rule[1:-1]
                    regex = re.compile(pattern, re.IGNORECASE)
                    if ((ch.id and regex.search(ch.id)) or
                        (ch.name and regex.search(ch.name)) or
                        (ch.country and regex.search(ch.country)) or
                        any(regex.search(cat) for cat in ch.categories if cat) or
                        any(regex.search(lang) for lang in ch.languages if lang) or
                        (ch.status_text and regex.search(ch.status_text))):
                        matched = True
                except Exception:
                    pass
            else:
                ch_id_base = ch.id.split("@")[0] if ch.id else ""
                rule_base = clean_rule.split("@")[0]
                rule_lower = clean_rule.lower()
                if (ch.id == clean_rule or
                    (ch.id and ch.id.lower() == rule_lower) or
                    (ch.id and ch_id_base and rule_base and ch_id_base == rule_base) or
                    (ch.name and ch.name.lower() == rule_lower) or
                    (ch.country and ch.country.lower() == rule_lower) or
                    any(cat.lower() == rule_lower for cat in ch.categories if cat) or
                    any(lang.lower() == rule_lower for lang in ch.languages if lang) or
                    (ch.status_text and ch.status_text.lower() == rule_lower)):
                    matched = True
            
            if matched:
                if is_exclude:
                    excluded_ids.append(ch.id)
                else:
                    matched_ids.append(ch.id)
                    
    # Remove duplicates but keep order/uniqueness
    seen_matched = set()
    matched_ids_ordered = []
    for m in matched_ids:
        if m not in seen_matched:
            matched_ids_ordered.append(m)
            seen_matched.add(m)
    matched_ids = matched_ids_ordered

    seen_excluded = set()
    excluded_ids_ordered = []
    for e in excluded_ids:
        if e not in seen_excluded:
            excluded_ids_ordered.append(e)
            seen_excluded.add(e)
    excluded_ids = excluded_ids_ordered

    config = {}
    config_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "custom", "config.json"))
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception as e:
            print(f"Error loading custom config.json: {e}")
            
    return jsonify({
        "rules": rules,
        "matched_ids": matched_ids,
        "excluded_ids": excluded_ids,
        "config": config
    })

@app.route("/api/custom/save-selected", methods=["POST"])
def save_custom_selected():
    if not load_status["loaded"]:
        return jsonify({"error": "Data not loaded"}), 400
        
    req_data = request.json or {}
    channel_ids = req_data.get("channel_ids", [])
    excluded_ids = req_data.get("excluded_ids", [])
    config_data = req_data.get("config", {})
    mode = req_data.get("mode", "overwrite")
    
    rules_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "custom", "selected-channels.txt"))
    config_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "custom", "config.json"))
    try:
        os.makedirs(os.path.dirname(rules_path), exist_ok=True)
        
        # Parse existing rules
        existing_rules = []
        if os.path.exists(rules_path):
            try:
                with open(rules_path, "r", encoding="utf-8") as f:
                    existing_rules = [line.strip() for line in f if line.strip() and not line.strip().startswith("#")]
            except Exception as e:
                print(f"Error reading existing rules: {e}")

        # Separate existing rules into preserved (not loaded) and managed (loaded)
        preserved_inclusions = []
        preserved_exclusions = []
        existing_managed_inclusions = []
        existing_managed_exclusions = []
        
        preserved_inc_set = set()
        preserved_exc_set = set()
        existing_managed_inc_set = set()
        existing_managed_exc_set = set()

        for rule in existing_rules:
            is_exclude = rule.startswith("-")
            clean_rule = rule[1:].strip() if is_exclude else rule
            if not clean_rule:
                continue
                
            matched_loaded = False
            for ch in filter_engine.channels:
                if clean_rule.startswith("/") and clean_rule.endswith("/"):
                    try:
                        pattern = clean_rule[1:-1]
                        regex = re.compile(pattern, re.IGNORECASE)
                        if ((ch.id and regex.search(ch.id)) or
                            (ch.name and regex.search(ch.name)) or
                            (ch.country and regex.search(ch.country)) or
                            any(regex.search(cat) for cat in ch.categories if cat) or
                            any(regex.search(lang) for lang in ch.languages if lang) or
                            (ch.status_text and regex.search(ch.status_text))):
                            matched_loaded = True
                            break
                    except Exception:
                        pass
                else:
                    ch_id_base = ch.id.split("@")[0] if ch.id else ""
                    rule_base = clean_rule.split("@")[0]
                    rule_lower = clean_rule.lower()
                    if (ch.id == clean_rule or
                        (ch.id and ch.id.lower() == rule_lower) or
                        (ch.id and ch_id_base and rule_base and ch_id_base == rule_base) or
                        (ch.name and ch.name.lower() == rule_lower) or
                        (ch.country and ch.country.lower() == rule_lower) or
                        any(cat.lower() == rule_lower for cat in ch.categories if cat) or
                        any(lang.lower() == rule_lower for lang in ch.languages if lang) or
                        (ch.status_text and ch.status_text.lower() == rule_lower)):
                        matched_loaded = True
                        break
            
            if matched_loaded:
                if is_exclude:
                    if clean_rule not in existing_managed_exc_set:
                        existing_managed_exclusions.append(clean_rule)
                        existing_managed_exc_set.add(clean_rule)
                else:
                    if clean_rule not in existing_managed_inc_set:
                        existing_managed_inclusions.append(clean_rule)
                        existing_managed_inc_set.add(clean_rule)
            else:
                if is_exclude:
                    if clean_rule not in preserved_exc_set:
                        preserved_exclusions.append(clean_rule)
                        preserved_exc_set.add(clean_rule)
                else:
                    if clean_rule not in preserved_inc_set:
                        preserved_inclusions.append(clean_rule)
                        preserved_inc_set.add(clean_rule)

        # Build managed lists based on save mode
        if mode == "update":
            managed_inclusions = list(existing_managed_inclusions)
            managed_inclusions_set = set(existing_managed_inc_set)
            
            managed_exclusions = list(existing_managed_exclusions)
            managed_exclusions_set = set(existing_managed_exc_set)
            
            for ch_id in channel_ids:
                if ch_id not in managed_inclusions_set:
                    managed_inclusions.append(ch_id)
                    managed_inclusions_set.add(ch_id)
                if ch_id in managed_exclusions_set:
                    managed_exclusions.remove(ch_id)
                    managed_exclusions_set.remove(ch_id)
                    
            for ch_id in excluded_ids:
                if ch_id not in managed_exclusions_set:
                    managed_exclusions.append(ch_id)
                    managed_exclusions_set.add(ch_id)
                if ch_id in managed_inclusions_set:
                    managed_inclusions.remove(ch_id)
                    managed_inclusions_set.remove(ch_id)
        else:
            # Overwrite mode: current selection completely replaces managed ones
            managed_inclusions = []
            managed_inclusions_set = set()
            for ch_id in channel_ids:
                if ch_id not in managed_inclusions_set:
                    managed_inclusions.append(ch_id)
                    managed_inclusions_set.add(ch_id)
                    
            managed_exclusions = []
            managed_exclusions_set = set()
            for ch_id in excluded_ids:
                if ch_id not in managed_exclusions_set:
                    managed_exclusions.append(ch_id)
                    managed_exclusions_set.add(ch_id)

        # Combine preserved and managed, preserving original order
        final_inclusions = []
        final_inc_set = set()
        for ch_id in preserved_inclusions + managed_inclusions:
            if ch_id not in final_inc_set:
                final_inclusions.append(ch_id)
                final_inc_set.add(ch_id)
                
        final_exclusions = []
        final_exc_set = set()
        for ch_id in preserved_exclusions + managed_exclusions:
            if ch_id not in final_exc_set:
                final_exclusions.append(ch_id)
                final_exc_set.add(ch_id)
        
        # 1. Write selected-channels.txt
        with open(rules_path, "w", encoding="utf-8") as f:
            f.write("# Add channel tvg-ids or exact channel names to include or exclude in your custom playlist.\n")
            f.write("# Prefix rules with - to always exclude them.\n")
            f.write("# Generated from IPTV Filter GUI\n#\n")
            f.write("\n# --- Inclusions ---\n")
            for ch_id in final_inclusions:
                f.write(f"{ch_id}\n")
            f.write("\n# --- Exclusions ---\n")
            for ch_id in final_exclusions:
                f.write(f"-{ch_id}\n")
                
        # 2. Write config.json
        if mode == "update" and os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    old_config = json.load(f)
                for key, val in config_data.items():
                    if isinstance(val, list):
                        merged_list = list(set(old_config.get(key, []) + val))
                        old_config[key] = merged_list
                    elif isinstance(val, bool):
                        if val:
                            old_config[key] = val
                    elif val:
                        old_config[key] = val
                config_data = old_config
            except Exception as e:
                print(f"Error merging config.json: {e}")

        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2, ensure_ascii=False)
            
        # Run custom generator immediately
        run_custom_generator()
            
        # Return only the matched loaded IDs to update the frontend state
        loaded_ids = {ch.id for ch in filter_engine.channels}
        merged_inclusions_loaded = [ch_id for ch_id in final_inclusions if ch_id in loaded_ids]
        merged_exclusions_loaded = [ch_id for ch_id in final_exclusions if ch_id in loaded_ids]
            
        return jsonify({
            "success": True, 
            "count": len(final_inclusions) + len(final_exclusions),
            "merged_inclusions": merged_inclusions_loaded,
            "merged_exclusions": merged_exclusions_loaded
        })
    except Exception as e:
        return jsonify({"error": f"Failed to save configuration files: {str(e)}"}), 500


def run_custom_generator():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    try:
        import subprocess
        print("Running custom/generate.ts --no-check...")
        res = subprocess.run(
            ["npx", "tsx", "custom/generate.ts", "--no-check"],
            cwd=root_dir,
            capture_output=True,
            text=True,
            shell=True
        )
        print("Generator stdout:", res.stdout)
        if res.stderr:
            print("Generator stderr:", res.stderr)
        return res.returncode == 0
    except Exception as e:
        print(f"Error running auto-generator: {e}")
        return False


@app.route("/api/custom/download", methods=["GET"])
def download_custom_playlist_file():
    custom_m3u_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "custom", "custom.m3u"))
    if not os.path.exists(custom_m3u_path):
        # Generate on the fly
        run_custom_generator()
    
    if not os.path.exists(custom_m3u_path):
        return "Custom playlist file does not exist and could not be generated.", 404
        
    return send_file(
        custom_m3u_path,
        as_attachment=True,
        download_name="custom.m3u"
    )


@app.route("/api/presets", methods=["POST"])
def save_preset():
    req_data = request.json or {}
    name = req_data.get("name")
    filters = req_data.get("filters")
    if not name or not filters:
        return jsonify({"error": "Name and filters are required"}), 400
        
    prefs.save_preset(name, filters)
    return jsonify({"status": "success", "presets": prefs.presets})

@app.route("/api/export", methods=["POST"])
def export_playlist():
    req_data = request.json or {}
    filepath = req_data.get("filepath")
    file_format = req_data.get("format", "m3u")
    append = req_data.get("append", False)
    sort_order = req_data.get("sort_order", "default")
    
    if not filepath:
        return jsonify({"error": "Filepath required"}), 400
        
    try:
        if file_format == "json":
            ExportManager.export_json(filepath, filter_engine.filtered_channels, sort_order=sort_order)
        elif file_format == "csv":
            ExportManager.export_csv(filepath, filter_engine.filtered_channels, sort_order=sort_order)
        else:
            ExportManager.export_m3u(filepath, filter_engine.filtered_channels, append=append, sort_order=sort_order)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/download-export", methods=["GET"])
def download_export():
    file_format = request.args.get("format", "m3u")
    sort_order = request.args.get("sort_order", "default")
    
    # Temporary buffer to write export file
    buffer = io.BytesIO()
    
    try:
        temp_file = "temp_export." + file_format
        if file_format == "json":
            ExportManager.export_json(temp_file, filter_engine.filtered_channels, sort_order=sort_order)
            mimetype = "application/json"
            attachment_filename = "playlist.json"
        elif file_format == "csv":
            ExportManager.export_csv(temp_file, filter_engine.filtered_channels, sort_order=sort_order)
            mimetype = "text/csv"
            attachment_filename = "playlist.csv"
        else:
            ExportManager.export_m3u(temp_file, filter_engine.filtered_channels, append=False, sort_order=sort_order)
            mimetype = "audio/x-mpegurl"
            attachment_filename = "playlist.m3u"
            
        with open(temp_file, "rb") as f:
            buffer.write(f.read())
        buffer.seek(0)
        
        # Clean up temp file
        os.remove(temp_file)
        
        return send_file(
            buffer,
            mimetype=mimetype,
            as_attachment=True,
            download_name=attachment_filename
        )
    except Exception as e:
        return str(e), 500

@app.route("/api/channels/set-status", methods=["POST"])
def set_channel_status():
    req_data = request.json or {}
    channel_id = req_data.get("channel_id")
    status_text = req_data.get("status_text")
    status_icon = req_data.get("status_icon")
    
    if not channel_id or not status_text or not status_icon:
        return jsonify({"error": "Missing parameters"}), 400
        
    ch = next((c for c in filter_engine.channels if c.id == channel_id), None)
    if not ch:
        return jsonify({"error": "Channel not found"}), 404
        
    ch.status_text = status_text
    ch.status_icon = status_icon
    
    save_stream_statuses()
    save_playlist_state()
    return jsonify({"success": True})

@app.route("/api/save-state", methods=["POST"])
def manual_save_state():
    success = save_playlist_state()
    if success:
        return jsonify({"status": "success", "message": "Database state saved successfully!"})
    else:
        return jsonify({"error": "Failed to save database state"}), 500

@app.route("/api/playlists/create-from-selected", methods=["POST"])
def create_playlist_from_selected():
    global active_playlist_source
    req_data = request.json or {}
    name = req_data.get("name")
    channel_ids = req_data.get("channel_ids", [])
    
    if not name or not channel_ids:
        return jsonify({"error": "Playlist name and channel IDs are required"}), 400
        
    # Find matching channels
    selected_channels = [c for c in filter_engine.channels if c.id in channel_ids]
    if not selected_channels:
        return jsonify({"error": "No valid channels selected"}), 400
        
    try:
        # Create safe filename
        name_safe = re.sub(r'[^a-zA-Z0-9]', '_', name).lower() + "_" + str(int(time.time())) + ".m3u"
        playlists_dir = os.path.join(cache_manager.cache_dir, "playlists")
        os.makedirs(playlists_dir, exist_ok=True)
        filepath = os.path.join(playlists_dir, name_safe)
        
        # Write M3U file
        ExportManager.export_m3u(filepath, selected_channels, append=False)
        
        # Add to custom playlists in preferences
        current_playlists = prefs.get_setting("custom_playlists", [])
        new_playlist = {
            "name": name,
            "type": "file",
            "url": filepath,
            "channel_ids": channel_ids
        }
        current_playlists.append(new_playlist)
        prefs.set_setting("custom_playlists", current_playlists)
        
        active_playlist_source = new_playlist
        return jsonify({"success": True, "playlist": new_playlist})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/playlists/add-to-existing", methods=["POST"])
def add_channels_to_existing_playlist():
    req_data = request.json or {}
    playlist_index = req_data.get("playlist_index")
    channel_ids = req_data.get("channel_ids", [])
    
    if playlist_index is None or not channel_ids:
        return jsonify({"error": "Playlist index and channel IDs are required"}), 400
        
    current_playlists = prefs.get_setting("custom_playlists", [])
    if playlist_index < 0 or playlist_index >= len(current_playlists):
        return jsonify({"error": "Invalid playlist index"}), 400
        
    pl = current_playlists[playlist_index]
    if pl.get("type") != "file":
        return jsonify({"error": "Can only append to local file playlists"}), 400
        
    filepath = pl.get("url")
    if not filepath:
        return jsonify({"error": "Playlist file path is required"}), 400
        
    # Find matching channels
    selected_channels = [c for c in filter_engine.channels if c.id in channel_ids]
    if not selected_channels:
        return jsonify({"error": "No valid channels selected"}), 400
        
    try:
        # Append to M3U file if it exists, otherwise recreate it
        file_exists = os.path.exists(filepath)
        ExportManager.export_m3u(filepath, selected_channels, append=file_exists)
        
        # Update stored channel_ids
        existing_ids = pl.get("channel_ids", [])
        pl["channel_ids"] = list(set(existing_ids + channel_ids))
        prefs.set_setting("custom_playlists", current_playlists)
        
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/playlists", methods=["GET"])
def get_playlists_details():
    current_playlists = prefs.get_setting("custom_playlists", [])
    results = []
    
    for idx, pl in enumerate(current_playlists):
        name = pl.get("name")
        pl_type = pl.get("type")
        url = pl.get("url")
        
        channel_count = 0
        file_size = 0
        
        if pl_type == "file" and url:
            if not os.path.exists(url) and pl.get("channel_ids"):
                try:
                    # Recreate if missing
                    ch_ids = pl["channel_ids"]
                    selected_channels = [c for c in filter_engine.channels if c.id in ch_ids]
                    if selected_channels:
                        ExportManager.export_m3u(url, selected_channels, append=False)
                except Exception as ex:
                    print(f"Error auto-recreating missing file {url}: {ex}")
            
            if os.path.exists(url):
                try:
                    file_size = os.path.getsize(url)
                    with open(url, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                        channel_count = content.count("#EXTINF:")
                except Exception as e:
                    print(f"Error reading playlist file {url}: {e}")
        
        results.append({
            "index": idx,
            "name": name,
            "type": pl_type,
            "url": url,
            "channel_count": channel_count,
            "file_size_bytes": file_size
        })
        
    # Prepend virtual favorites playlist card
    results.insert(0, {
        "index": -1,
        "name": "My Favorites List",
        "type": "virtual",
        "url": "local_favorites_database",
        "channel_count": len(prefs.favorites),
        "file_size_bytes": 0
    })
        
    return jsonify(results)

@app.route("/api/playlists/download", methods=["GET"])
def download_custom_playlist():
    index = request.args.get("index")
    if index is None:
        return "Index is required", 400
    try:
        idx = int(index)
        current_playlists = prefs.get_setting("custom_playlists", [])
        if idx < 0 or idx >= len(current_playlists):
            return "Invalid playlist index", 400
        pl = current_playlists[idx]
        filepath = pl.get("url")
        if not filepath:
            return "Playlist file path is missing", 400
            
        if not os.path.exists(filepath):
            # Recreate playlist file from channel_ids
            channel_ids = pl.get("channel_ids", [])
            if channel_ids:
                selected_channels = [c for c in filter_engine.channels if c.id in channel_ids]
                if selected_channels:
                    ExportManager.export_m3u(filepath, selected_channels, append=False)
                else:
                    return "Playlist file not found and cannot be recreated (no matching channels)", 404
            else:
                return "Playlist file not found", 404
            
        return send_file(
            filepath,
            as_attachment=True,
            download_name=os.path.basename(filepath)
        )
    except Exception as e:
        return str(e), 500

@app.route("/api/channels/delete-selected", methods=["POST"])
def delete_selected_channels():
    req_data = request.json or {}
    channel_ids = req_data.get("channel_ids", [])
    
    if not channel_ids:
        return jsonify({"error": "Channel IDs are required"}), 400
        
    ids_set = set(channel_ids)
    
    # Remove from main channel lists
    filter_engine.channels = [c for c in filter_engine.channels if c.id not in ids_set]
    filter_engine.filtered_channels = [c for c in filter_engine.filtered_channels if c.id not in ids_set]
    filter_engine._build_lookups()
    
    # Remove from custom channels list if any
    customs = load_custom_channels()
    new_customs = [c for c in customs if c.id not in ids_set]
    if len(new_customs) < len(customs):
        save_custom_channels(new_customs)
        
    save_playlist_state()
    return jsonify({"success": True, "count": len(filter_engine.channels)})

@app.route("/api/channels/add", methods=["POST"])
def add_channel():
    req_data = request.json or {}
    name = req_data.get("name")
    url = req_data.get("url")
    if not name or not url:
        return jsonify({"error": "Name and Stream URL are required"}), 400
        
    channel_id = "custom_" + re.sub(r'[^a-zA-Z0-9]', '', name).lower() + str(int(time.time()))
    
    resolved_country = normalize_country(req_data.get("country"))
    ch = Channel(
        id=channel_id,
        name=name,
        country=resolved_country,
        categories=req_data.get("categories", []),
        is_nsfw=req_data.get("is_nsfw", False),
        languages=req_data.get("languages", []),
        status_icon="❓",
        status_text="Unknown"
    )
    ch.streams = [{
        "url": url,
        "user_agent": req_data.get("user_agent"),
        "referrer": req_data.get("referrer")
    }]
    
    filter_engine.channels.insert(0, ch)
    filter_engine._build_lookups()
    filter_engine.filtered_channels.insert(0, ch)
    
    # Save to custom channels list
    customs = load_custom_channels()
    customs.insert(0, ch)
    save_custom_channels(customs)
    
    save_playlist_state()
    return jsonify({"success": True, "channel_id": channel_id})

@app.route("/api/channels/update", methods=["POST"])
def update_channel():
    req_data = request.json or {}
    channel_id = req_data.get("channel_id")
    if not channel_id:
        return jsonify({"error": "Channel ID required"}), 400
        
    ch = next((c for c in filter_engine.channels if c.id == channel_id), None)
    if not ch:
        return jsonify({"error": "Channel not found"}), 404
        
    ch.name = req_data.get("name", ch.name)
    raw_country = req_data.get("country")
    if raw_country is not None:
        ch.country = normalize_country(raw_country)
    
    if "categories" in req_data:
        cats = req_data.get("categories")
        if isinstance(cats, str):
            ch.categories = [c.strip() for c in cats.split(",") if c.strip()]
        else:
            ch.categories = cats
            
    if "languages" in req_data:
        langs = req_data.get("languages")
        if isinstance(langs, str):
            ch.languages = [l.strip() for l in langs.split(",") if l.strip()]
        else:
            ch.languages = langs
            
    ch.is_nsfw = req_data.get("is_nsfw", ch.is_nsfw)
    
    url = req_data.get("url")
    if url:
        user_agent = req_data.get("user_agent")
        referrer = req_data.get("referrer")
        ch.streams = [{
            "url": url,
            "user_agent": user_agent,
            "referrer": referrer
        }]
        
    filter_engine._build_lookups()
    
    # Save to custom channels file too
    customs = load_custom_channels()
    updated = False
    for i, c in enumerate(customs):
        if c.id == channel_id:
            customs[i] = ch
            updated = True
            break
    if not updated:
        customs.insert(0, ch)
    save_custom_channels(customs)
    
    save_playlist_state()
    return jsonify({"success": True})

@app.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify(prefs.settings)

@app.route("/api/settings", methods=["POST"])
def update_settings():
    req_data = request.json or {}
    for k, v in req_data.items():
        prefs.set_setting(k, v)
        if k == "cache_expiry_hours":
            try:
                cache_manager.expiry_hours = int(v)
            except:
                pass
    return jsonify({"status": "success", "settings": prefs.settings})

@app.route("/api/playlists/load-selected", methods=["POST"])
def load_selected_playlist():
    req_data = request.json or {}
    sources = req_data.get("sources", [])
    if not sources:
        pl_type = req_data.get("type")
        url = req_data.get("url")
        if pl_type and url:
            sources = [{"type": pl_type, "url": url}]
            
    if not sources:
        return jsonify({"error": "Playlist type/url or sources are required"}), 400
        
    global load_status
    load_status["loading"] = True
    load_status["error"] = None
    load_status["loaded"] = False
    
    def worker():
        global active_playlist_source
        try:
            combined_channels = []
            existing_channel_keys = set()
            
            for src in sources:
                pl_type = src.get("type")
                url = src.get("url")
                if not pl_type or not url:
                    continue
                
                playlist = None
                if pl_type == "api":
                    api_data = api_client.fetch_all(force=True, api_base_url=url)
                    playlist = data_processor.process_data(api_data)
                    prefs.set_setting("api_url", url)
                elif pl_type == "url":
                    playlist = data_processor.load_m3u_url(url)
                elif pl_type == "file":
                    if not os.path.exists(url):
                        current_playlists = prefs.get_setting("custom_playlists", [])
                        matching_pl = next((p for p in current_playlists if p.get("url") == url), None)
                        if matching_pl and matching_pl.get("channel_ids"):
                            try:
                                ch_ids = matching_pl["channel_ids"]
                                selected_channels = [c for c in filter_engine.channels if c.id in ch_ids]
                                if selected_channels:
                                    ExportManager.export_m3u(url, selected_channels, append=False)
                            except Exception as ex:
                                print(f"Error auto-recreating playlist {url}: {ex}")
                    playlist = data_processor.load_m3u_file(url)
                    
                if playlist:
                    for ch in playlist.channels:
                        stream_url = ch.streams[0].get("url", "") if ch.streams else ""
                        key = (ch.id, stream_url)
                        if key not in existing_channel_keys:
                            existing_channel_keys.add(key)
                            combined_channels.append(ch)
            
            if len(sources) == 1:
                current_playlists = prefs.get_setting("custom_playlists", [])
                pl_name = "Selected Playlist"
                for pl in current_playlists:
                    if pl.get("url") == sources[0].get("url"):
                        pl_name = pl.get("name")
                        break
                active_playlist_source = {
                    "name": pl_name,
                    "type": sources[0].get("type"),
                    "url": sources[0].get("url")
                }
            elif len(sources) > 1:
                active_playlist_source = {
                    "name": f"Combined Playlists ({len(sources)} sources)",
                    "type": "combined",
                    "url": ""
                }
            else:
                active_playlist_source = None
            
            apply_cached_statuses(combined_channels)
            merge_custom_channels(combined_channels)
            filter_engine.load_channels(combined_channels)
            save_playlist_state()
            load_status["loaded"] = True
            load_status["count"] = len(filter_engine.channels)
        except Exception as e:
            load_status["error"] = str(e)
        finally:
            load_status["loading"] = False
            
    threading.Thread(target=worker, daemon=True).start()
    return jsonify({"status": "loading"})

@app.route("/api/playlists/upload-multiple", methods=["POST"])
def upload_multiple_playlists():
    if "files" not in request.files:
        return jsonify({"error": "No files uploaded"}), 400
        
    uploaded_files = request.files.getlist("files")
    playlists_dir = os.path.join(cache_manager.cache_dir, "playlists")
    os.makedirs(playlists_dir, exist_ok=True)
    
    new_playlists = []
    for f in uploaded_files:
        if f.filename == "":
            continue
        filepath = os.path.join(playlists_dir, f.filename)
        f.save(filepath)
        
        new_playlists.append({
            "name": os.path.splitext(f.filename)[0],
            "type": "file",
            "url": filepath
        })
        
    return jsonify({"success": True, "added_playlists": new_playlists})

@app.route("/api/playlists/active", methods=["GET"])
def get_active_playlist_source():
    global active_playlist_source
    return jsonify(active_playlist_source or {})

@app.route("/api/playlists/save-current", methods=["POST"])
def save_current_playlist():
    global active_playlist_source
    if not active_playlist_source or active_playlist_source.get("type") != "file":
        return jsonify({"error": "No active writable playlist loaded"}), 400
    
    filepath = active_playlist_source.get("url")
    if not filepath:
        return jsonify({"error": "Invalid playlist filepath"}), 400
        
    try:
        # Write current filter_engine.channels to M3U file
        ExportManager.export_m3u(filepath, filter_engine.channels, append=False)
        
        # Update channel_ids in settings.json under custom_playlists
        current_playlists = prefs.get_setting("custom_playlists", [])
        channel_ids = [c.id for c in filter_engine.channels]
        
        for pl in current_playlists:
            if pl.get("url") == filepath:
                pl["channel_ids"] = channel_ids
                break
        prefs.set_setting("custom_playlists", current_playlists)
        
        # Also update active_playlist_source in memory
        active_playlist_source["channel_ids"] = channel_ids
        
        return jsonify({"success": True, "message": "Playlist file updated successfully!"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/playlists/download-favorites", methods=["GET"])
def download_favorites():
    fav_channels = [c for c in filter_engine.channels if c.id in prefs.favorites]
    buffer = io.BytesIO()
    try:
        temp_file = "temp_favs.m3u"
        ExportManager.export_m3u(temp_file, fav_channels, append=False)
        with open(temp_file, "rb") as f:
            buffer.write(f.read())
        buffer.seek(0)
        os.remove(temp_file)
        
        return send_file(
            buffer,
            mimetype="audio/x-mpegurl",
            as_attachment=True,
            download_name="favorites.m3u"
        )
    except Exception as e:
        return str(e), 500

@app.route("/api/favorites/clear-all", methods=["POST"])
def clear_all_favorites():
    prefs.favorites.clear()
    prefs.save_all()
    return jsonify({"success": True})

def start_server():
    # Load cached or default data on startup
    threading.Thread(target=load_initial_data, daemon=True).start()
    
    # Wait a tiny bit then launch browser
    def launch_browser():
        time.sleep(1.5)
        webbrowser.open("http://localhost:5000")
        
    threading.Thread(target=launch_browser, daemon=True).start()
    
    # Run server
    app.run(host="localhost", port=5000, debug=True)

if __name__ == "__main__":
    start_server()
