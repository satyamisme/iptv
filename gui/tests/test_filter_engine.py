import unittest
from iptv_filter.models.channel import Channel
from iptv_filter.controllers.filter_engine import FilterEngine

class TestFilterEngine(unittest.TestCase):
    def setUp(self):
        self.engine = FilterEngine()
        self.ch1 = Channel(
            id="cnn",
            name="CNN News",
            country="US",
            categories=["news"],
            is_nsfw=False
        )
        self.ch1.streams = [{"url": "http://cnn.com"}]
        self.ch1.languages = ["English"]

        self.ch2 = Channel(
            id="hbo",
            name="HBO Movies",
            country="US",
            categories=["movies"],
            is_nsfw=False
        )
        self.ch2.streams = [{"url": "http://hbo.com"}]
        self.ch2.languages = ["English"]

        self.ch3 = Channel(
            id="xxx",
            name="Adult Channel",
            country="NL",
            categories=["xxx"],
            is_nsfw=True
        )
        self.ch3.streams = [{"url": "http://xxx.com"}]
        self.ch3.languages = ["Dutch"]

        self.engine.load_channels([self.ch1, self.ch2, self.ch3])

    def test_apply_filters_search(self):
        res = self.engine.apply_filters(search_term="CNN")
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0].id, "cnn")

    def test_apply_filters_nsfw(self):
        # By default, nsfw is False, so adult channel should be excluded
        res = self.engine.apply_filters(nsfw=False)
        self.assertEqual(len(res), 2)
        self.assertNotIn("xxx", [ch.id for ch in res])

        # If nsfw is True, adult channel should be included
        res = self.engine.apply_filters(nsfw=True)
        self.assertEqual(len(res), 3)

    def test_remove_duplicates(self):
        # Add duplicate
        ch4 = Channel(id="cnn_dup", name="CNN Copy")
        ch4.streams = [{"url": "http://cnn.com"}] # Same url as cnn
        
        self.engine.load_channels([self.ch1, self.ch2, ch4])
        self.assertEqual(len(self.engine.filtered_channels), 3)
        
        removed = self.engine.remove_duplicates()
        self.assertEqual(removed, 1)
        self.assertEqual(len(self.engine.filtered_channels), 2)

    def test_apply_filters_exclude_dead(self):
        # Set ch1 to Dead
        self.ch1.status_text = "Dead"
        # By default exclude_dead is False in engine.apply_filters()
        res = self.engine.apply_filters(exclude_dead=False, nsfw=True)
        self.assertEqual(len(res), 3)
        
        # When exclude_dead is True
        res = self.engine.apply_filters(exclude_dead=True, nsfw=True)
        self.assertEqual(len(res), 2)
        self.assertNotIn("cnn", [ch.id for ch in res])

    def test_apply_filters_exclude_no_url(self):
        # ch3 has streams. Remove it to make it stream-less
        self.ch3.streams = []
        
        # By default exclude_no_url is False in engine.apply_filters()
        res = self.engine.apply_filters(exclude_no_url=False, nsfw=True)
        self.assertEqual(len(res), 3)
        
        # When exclude_no_url is True
        res = self.engine.apply_filters(exclude_no_url=True, nsfw=True)
        self.assertEqual(len(res), 2)
        self.assertNotIn("xxx", [ch.id for ch in res])

    def test_remove_geoblocked_streams(self):
        # Set ch1 to Geo-blocked
        self.ch1.status_text = "Geo-blocked"
        
        self.assertEqual(len(self.engine.filtered_channels), 3)
        removed = self.engine.remove_geoblocked_streams()
        self.assertEqual(removed, 1)
        self.assertEqual(len(self.engine.filtered_channels), 2)
        self.assertNotIn("cnn", [ch.id for ch in self.engine.filtered_channels])

if __name__ == "__main__":
    unittest.main()
