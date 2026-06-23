import unittest
import random
import string
from iptv_filter.models.channel import Channel
from iptv_filter.controllers.filter_engine import FilterEngine

class TestFuzzyFilterEngine(unittest.TestCase):
    def setUp(self):
        self.engine = FilterEngine()
        
        # Load some mock channels
        channels = []
        for i in range(100):
            ch = Channel(
                id=f"ch_{i}",
                name=f"Channel {i} " + "".join(random.choices(string.ascii_letters, k=5)),
                country=random.choice(["US", "UK", "FR", "IN", "", None]),
                categories=[random.choice(["news", "sports", "movies", "xxx", ""])],
                is_nsfw=random.choice([True, False])
            )
            # Random status
            ch.status_text = random.choice(["Working", "Slow", "Dead", "Geo-blocked", "Unknown"])
            # Random streams
            if random.choice([True, False]):
                ch.streams = [{"url": f"http://example.com/stream_{i}.m3u8"}]
            else:
                ch.streams = []
                
            # Random languages
            ch.languages = [random.choice(["English", "Spanish", "French", "Hindi", ""])]
            channels.append(ch)
            
        self.engine.load_channels(channels)

    def generate_fuzzy_payload(self):
        # Generate potentially toxic/unexpected types for filter inputs
        toxic_values = [
            "", "   ", "A" * 1000, "😊 Unicode", "\x00 NULL byte", 
            None, 12345, True, False, ["list", "of", "strings"], 
            {"dict": "val"}, [None, 123], [123, 456]
        ]
        
        payload = {}
        
        # Search term can be anything
        if random.random() < 0.8:
            payload["search_term"] = random.choice(toxic_values)
            
        # Languages, categories, countries are expected to be lists of strings, but let's send anything
        for field in ["languages", "categories", "countries"]:
            if random.random() < 0.8:
                payload[field] = random.choice(toxic_values)
                
        # Boolean options can be anything
        for field in ["nsfw", "exclude_closed", "favorites_only", "working_only", "selected_only", "exclude_dead", "exclude_no_url"]:
            if random.random() < 0.8:
                payload[field] = random.choice(toxic_values)
                
        # Statuses list
        if random.random() < 0.8:
            payload["statuses"] = random.choice(toxic_values)
            
        # Stream format
        if random.random() < 0.8:
            payload["stream_format"] = random.choice(toxic_values)
            
        # Selected IDs
        if random.random() < 0.8:
            payload["selected_ids"] = random.choice(toxic_values)
            
        # Add completely random query parameters to test **kwargs safety
        for _ in range(random.randint(0, 5)):
            random_key = "".join(random.choices(string.ascii_lowercase, k=8))
            payload[random_key] = random.choice(toxic_values)
            
        return payload

    def test_fuzzy_filtering(self):
        # Run 500 iterations of random fuzzy payload filter calls
        for i in range(500):
            payload = self.generate_fuzzy_payload()
            try:
                self.engine.apply_filters(**payload)
            except Exception as e:
                # If it raises an exception, fail the test and show the failing payload
                self.fail(f"Fuzzy payload caused crash: {payload}. Error: {e}")

if __name__ == "__main__":
    unittest.main()
