import unittest
import os
import json
import shutil
from iptv_filter.models.playlist import Playlist
from iptv_filter.controllers.playlist_parser import DataProcessor

class TestPlaylistParser(unittest.TestCase):
    def setUp(self):
        self.processor = DataProcessor()

    def test_process_m3u_basic(self):
        m3u_data = """#EXTM3U
#EXTINF:-1 tvg-id="CNN" tvg-country="US" group-title="News",CNN International
http://stream.cnn.com/live.m3u8
"""
        playlist = self.processor.process_m3u(m3u_data)
        self.assertEqual(len(playlist.channels), 1)
        ch = playlist.channels[0]
        self.assertEqual(ch.id, "CNN")
        self.assertEqual(ch.name, "CNN International")
        self.assertEqual(ch.country, "United States")
        self.assertEqual(ch.categories, ["News"])
        self.assertEqual(len(ch.streams), 1)
        self.assertEqual(ch.streams[0]["url"], "http://stream.cnn.com/live.m3u8")

    def test_process_m3u_with_vlc_options(self):
        m3u_data = """#EXTM3U
#EXTINF:-1 tvg-id="TestChannel",Test
#EXTVLCOPT:http-user-agent=CustomUA
#EXTVLCOPT:http-referrer=CustomReferer
http://stream.test.com/live.m3u8
"""
        playlist = self.processor.process_m3u(m3u_data)
        self.assertEqual(len(playlist.channels), 1)
        ch = playlist.channels[0]
        self.assertEqual(ch.streams[0]["url"], "http://stream.test.com/live.m3u8")
        self.assertEqual(ch.streams[0].get("user_agent"), "CustomUA")
        self.assertEqual(ch.streams[0].get("referrer"), "CustomReferer")

    def test_enrich_channels_from_cache(self):
        cache_exists = os.path.exists("cache")
        if cache_exists:
            os.rename("cache", "cache_bak")
            
        os.makedirs("cache", exist_ok=True)
        
        try:
            with open("cache/languages.json", "w", encoding="utf-8") as f:
                json.dump([{"code": "eng", "name": "English"}], f)
            with open("cache/channels.json", "w", encoding="utf-8") as f:
                json.dump([{
                    "id": "cnn.us",
                    "name": "CNN US",
                    "country": "US",
                    "categories": ["news"],
                    "is_nsfw": False,
                    "website": "https://cnn.com"
                }], f)
            with open("cache/feeds.json", "w", encoding="utf-8") as f:
                json.dump([{"channel": "cnn.us", "languages": ["eng"]}], f)
                
            m3u_data = """#EXTM3U
#EXTINF:-1 tvg-id="cnn.us",CNN
http://stream.cnn.com/live.m3u8
"""
            playlist = self.processor.process_m3u(m3u_data)
            self.assertEqual(len(playlist.channels), 1)
            ch = playlist.channels[0]
            self.assertEqual(ch.id, "cnn.us")
            self.assertEqual(ch.name, "CNN")
            self.assertEqual(ch.languages, ["English"])
            self.assertEqual(ch.country, "United States")
            self.assertEqual(ch.categories, ["news"])
            self.assertEqual(ch.website, "https://cnn.com")
            
        finally:
            shutil.rmtree("cache", ignore_errors=True)
            if cache_exists:
                os.rename("cache_bak", "cache")

if __name__ == "__main__":
    unittest.main()
