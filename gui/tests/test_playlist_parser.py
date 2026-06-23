import unittest
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

if __name__ == "__main__":
    unittest.main()
