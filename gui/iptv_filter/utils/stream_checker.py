import requests
import time
from typing import Dict, List, Callable
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from requests.adapters import HTTPAdapter

class StreamChecker:
    _cancel_event = threading.Event()

    @classmethod
    def cancel_all(cls):
        cls._cancel_event.set()

    @classmethod
    def reset_cancel(cls):
        cls._cancel_event.clear()

    @staticmethod
    def check_stream(url: str, timeout: int = 3, headers: Dict[str, str] = None, session: requests.Session = None) -> Dict[str, any]:
        start = time.time()
        
        # Ensure headers dict exists and has a default User-Agent
        if not headers:
            headers = {}
        else:
            headers = headers.copy()
            
        if "User-Agent" not in headers:
            headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            
        req_func = session.get if session else requests.get

        # Single GET request with stream=True (fetches headers only, extremely fast)
        try:
            clean_url = url.split('?')[0]
            is_hls = clean_url.endswith('.m3u8') or clean_url.endswith('.m3u')
            
            response = req_func(url, timeout=timeout, headers=headers, stream=True, allow_redirects=True)
            elapsed = time.time() - start

            if response.status_code == 403:
                return {"status": "Geo-blocked", "icon": "🌐", "time": elapsed, "code": 403}
            elif response.status_code >= 400:
                return {"status": "Dead", "icon": "❌", "time": elapsed, "code": response.status_code}
            
            is_hls_content = is_hls or "mpegurl" in response.headers.get("Content-Type", "").lower()
            
            # HLS Manifest Verification & Segment download (Layer 2 & 3)
            if is_hls_content:
                manifest_content = response.content.decode("utf-8", errors="ignore")
                response.close()
                
                if '#EXTM3U' not in manifest_content:
                    return {"status": "Dead", "icon": "❌", "time": elapsed, "code": response.status_code}
                
                # Resolve first segment URL
                from urllib.parse import urljoin
                lines = manifest_content.splitlines()
                segment_url = None
                
                for line in lines:
                    line_stripped = line.strip()
                    if line_stripped and not line_stripped.startswith('#'):
                        segment_url = urljoin(response.url, line_stripped)
                        break
                
                # If master playlist, resolve sub-manifest first
                if segment_url and (segment_url.split('?')[0].endswith('.m3u8') or segment_url.split('?')[0].endswith('.m3u')):
                    try:
                        sub_res = req_func(segment_url, timeout=timeout, headers=headers)
                        if sub_res.status_code < 400 and '#EXTM3U' in sub_res.text:
                            for sub_line in sub_res.text.splitlines():
                                sub_line_stripped = sub_line.strip()
                                if sub_line_stripped and not sub_line_stripped.startswith('#'):
                                    segment_url = urljoin(sub_res.url, sub_line_stripped)
                                    break
                    except Exception:
                        pass
                
                # Layer 3: Direct HLS Segment Check
                if segment_url:
                    try:
                        seg_res = req_func(segment_url, timeout=timeout, headers=headers, stream=True)
                        if seg_res.status_code < 400:
                            chunk = next(seg_res.iter_content(chunk_size=1024), None)
                            seg_res.close()
                            if chunk:
                                status = "Slow" if elapsed > 2.0 else "Working"
                                icon = "⚠️" if elapsed > 2.0 else "✅"
                                return {"status": status, "icon": icon, "time": elapsed, "code": response.status_code}
                    except Exception:
                        pass
                
                # Fallback if manifest loaded but segment check failed
                status = "Slow" if elapsed > 2.0 else "Working"
                icon = "⚠️" if elapsed > 2.0 else "✅"
                return {"status": status, "icon": icon, "time": elapsed, "code": response.status_code}

            # Layer 3: Standard Progressive Media stream check (download first 1024 bytes)
            try:
                chunk = next(response.iter_content(chunk_size=1024), None)
                response.close()
                if chunk:
                    status = "Slow" if elapsed > 2.0 else "Working"
                    icon = "⚠️" if elapsed > 2.0 else "✅"
                    return {"status": status, "icon": icon, "time": elapsed, "code": response.status_code}
            except Exception:
                pass
            return {"status": "Dead", "icon": "❌", "time": elapsed, "code": response.status_code}

        except requests.RequestException:
            return {"status": "Dead", "icon": "❌", "time": time.time() - start, "code": 0}

    @staticmethod
    def check_channels(channels: List[any], progress_callback: Callable[[int, int, dict], None], done_callback: Callable[[], None], max_workers: int = 150, timeout: int = 3):
        def worker():
            total = len(channels)
            completed_lock = threading.Lock()
            completed = 0

            # Create shared optimized session
            session = requests.Session()
            adapter = HTTPAdapter(pool_connections=max_workers, pool_maxsize=max_workers)
            session.mount('http://', adapter)
            session.mount('https://', adapter)

            def check_and_update(ch):
                nonlocal completed
                if StreamChecker._cancel_event.is_set():
                    ch.status_icon = "❓"
                    ch.status_text = "Cancelled"
                    return

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
                        res = StreamChecker.check_stream(url, timeout=timeout, headers=headers, session=session)
                        ch.status_icon = res["icon"]
                        ch.status_text = res["status"]
                    else:
                        ch.status_icon = "❓"
                        ch.status_text = "Unknown"
                else:
                    ch.status_icon = "❌"
                    ch.status_text = "No Stream"

                with completed_lock:
                    completed += 1
                    current_completed = completed

                if progress_callback:
                    progress_callback(current_completed, total, {
                        "id": ch.id,
                        "name": ch.name,
                        "country": ch.country,
                        "languages": ch.languages,
                        "status_text": ch.status_text,
                        "status_icon": ch.status_icon
                    })

            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = [executor.submit(check_and_update, ch) for ch in channels]
                for future in as_completed(futures):
                    if StreamChecker._cancel_event.is_set():
                        for fut in futures:
                            fut.cancel()
                        break

            # Close the session to release connection resources
            session.close()

            if done_callback:
                done_callback()

        threading.Thread(target=worker, daemon=True).start()
