import unittest
import json
import os
from main import app, load_status

class TestWebAPI(unittest.TestCase):
    def setUp(self):
        self.app = app.test_client()
        self.app.testing = True
        
        # Backup settings.json
        self.settings_backup = None
        if os.path.exists("settings.json"):
            with open("settings.json", "r", encoding="utf-8") as f:
                self.settings_backup = f.read()
                
        # Backup playlist_state.json
        self.state_backup = None
        state_path = "cache/playlist_state.json"
        if os.path.exists(state_path):
            with open(state_path, "r", encoding="utf-8") as f:
                self.state_backup = f.read()

    def tearDown(self):
        # Restore settings.json
        if self.settings_backup is not None:
            with open("settings.json", "w", encoding="utf-8") as f:
                f.write(self.settings_backup)
        elif os.path.exists("settings.json"):
            os.remove("settings.json")
            
        # Restore playlist_state.json
        state_path = "cache/playlist_state.json"
        if self.state_backup is not None:
            with open(state_path, "w", encoding="utf-8") as f:
                f.write(self.state_backup)
        elif os.path.exists(state_path):
            os.remove(state_path)

    def test_status_endpoint(self):
        response = self.app.get('/api/status')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('loaded', data)
        self.assertIn('loading', data)
        self.assertIn('total_channels', data)

    def test_presets_saving(self):
        preset_data = {
            "name": "Custom Test Preset",
            "filters": {
                "search_term": "news",
                "nsfw": False
            }
        }
        response = self.app.post('/api/presets', 
                                 data=json.dumps(preset_data),
                                 content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data["status"], "success")
        self.assertIn("Custom Test Preset", data["presets"])

    def test_save_state_endpoint(self):
        response = self.app.post('/api/save-state')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data.get("status"), "success")

    def test_add_and_update_channel(self):
        # 1. Add channel
        add_data = {
            "name": "API Test Channel",
            "url": "http://example.com/test.m3u8",
            "country": "US",
            "categories": ["news"],
            "languages": ["English"],
            "is_nsfw": False
        }
        response = self.app.post('/api/channels/add',
                                 data=json.dumps(add_data),
                                 content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data.get("success"))
        channel_id = data.get("channel_id")
        self.assertIsNotNone(channel_id)

        # 2. Update channel
        update_data = {
            "channel_id": channel_id,
            "name": "API Test Channel Updated",
            "url": "http://example.com/test_updated.m3u8"
        }
        response = self.app.post('/api/channels/update',
                                 data=json.dumps(update_data),
                                 content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data.get("success"))

    def test_settings_endpoints(self):
        # GET Settings
        response = self.app.get('/api/settings')
        self.assertEqual(response.status_code, 200)
        settings = json.loads(response.data)
        self.assertIn('theme', settings)
        self.assertIn('custom_playlists', settings)

        # POST Settings
        update_settings = {
            "theme": "dark",
            "custom_playlists": [
                {"name": "Test List", "type": "url", "url": "http://example.com/list.m3u"}
            ]
        }
        response = self.app.post('/api/settings',
                                 data=json.dumps(update_settings),
                                 content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["settings"]["theme"], "dark")
        self.assertEqual(len(data["settings"]["custom_playlists"]), 1)

    def test_load_selected_playlist_invalid(self):
        # Load with invalid parameters
        response = self.app.post('/api/playlists/load-selected',
                                 data=json.dumps({}),
                                 content_type='application/json')
        self.assertEqual(response.status_code, 400)

    def test_clear_api_cache(self):
        response = self.app.post('/api/cache/clear')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data.get("status"), "success")
        self.assertIn("cleared_files", data)

    def test_preferences_manager_default_recovery(self):
        from iptv_filter.controllers.preferences_manager import PreferencesManager
        
        # Test default recovery by removing default playlists and calling load_all
        pm = PreferencesManager()
        pm.settings["custom_playlists"] = []
        pm.save_all()
        
        # Re-initialize should restore defaults
        pm2 = PreferencesManager()
        self.assertTrue(len(pm2.settings["custom_playlists"]) >= 6)
        names = [pl["name"] for pl in pm2.settings["custom_playlists"]]
        self.assertIn("iptv-org (Official API)", names)

    def test_apply_filters_with_selection(self):
        from main import filter_engine
        from iptv_filter.models.channel import Channel
        
        # Backup original channels
        original_channels = filter_engine.channels.copy()
        
        try:
            # Set up a few mock channels in filter engine
            ch1 = Channel(id="ch_mock1", name="Test 1")
            ch2 = Channel(id="ch_mock2", name="Test 2")
            filter_engine.load_channels([ch1, ch2])
            
            # 1. No selection filter
            results = filter_engine.apply_filters()
            self.assertEqual(len(results), 2)
            
            # 2. Filter by selected_ids
            results_sel = filter_engine.apply_filters(selected_only=True, selected_ids=["ch_mock1"])
            self.assertEqual(len(results_sel), 1)
            self.assertEqual(results_sel[0].id, "ch_mock1")
        finally:
            # Restore original channels
            filter_engine.load_channels(original_channels)

    def test_check_streams_with_ids(self):
        # Trigger stream checking on specific IDs
        response = self.app.post('/api/check-streams',
                                 data=json.dumps({"channel_ids": ["non_existent"]}),
                                 content_type='application/json')
        # Since mock list is empty, it returns status success/no_channels
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data.get("status"), "no_channels")

    def test_performance_settings(self):
        # Verify defaults exist in settings GET
        response = self.app.get('/api/settings')
        self.assertEqual(response.status_code, 200)
        settings = json.loads(response.data)
        self.assertIn('channel_limit', settings)
        self.assertIn('stream_check_threads', settings)
        self.assertIn('stream_check_timeout', settings)
        self.assertIn('cache_expiry_hours', settings)

        # Update performance settings
        perf_updates = {
            "channel_limit": 5,
            "stream_check_threads": 80,
            "stream_check_timeout": 5,
            "cache_expiry_hours": 12
        }
        response = self.app.post('/api/settings',
                                 data=json.dumps(perf_updates),
                                 content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["settings"]["channel_limit"], 5)
        self.assertEqual(data["settings"]["stream_check_threads"], 80)
        self.assertEqual(data["settings"]["stream_check_timeout"], 5)
        self.assertEqual(data["settings"]["cache_expiry_hours"], 12)

        # Mock channels load and test capping limit
        from main import filter_engine, prefs
        from iptv_filter.models.channel import Channel
        original_channels = filter_engine.channels.copy()
        
        try:
            # Inject new settings to prefs directly for testing
            prefs.set_setting("channel_limit", 2)
            
            # Setup mock channels in filter engine
            mock_channels = [Channel(id=f"ch_{i}", name=f"Channel {i}") for i in range(10)]
            filter_engine.load_channels(mock_channels)
            
            # Set load status loaded to True for api/channels to work
            global load_status
            original_loaded = load_status["loaded"]
            load_status["loaded"] = True
            
            # Request channels
            res = self.app.post('/api/channels', data=json.dumps({}), content_type='application/json')
            self.assertEqual(res.status_code, 200)
            res_data = json.loads(res.data)
            
            # Capped to 2
            self.assertEqual(res_data["shown_count"], 2)
            self.assertEqual(len(res_data["channels"]), 2)
            self.assertEqual(res_data["filtered_count"], 10)
            
            # Test Unlimited (0)
            prefs.set_setting("channel_limit", 0)
            res = self.app.post('/api/channels', data=json.dumps({}), content_type='application/json')
            self.assertEqual(res.status_code, 200)
            res_data = json.loads(res.data)
            
            self.assertEqual(res_data["shown_count"], 10)
            self.assertEqual(len(res_data["channels"]), 10)
            self.assertEqual(res_data["filtered_count"], 10)
            
        finally:
            filter_engine.load_channels(original_channels)
            load_status["loaded"] = original_loaded

    def test_exclude_filters(self):
        from main import filter_engine
        from iptv_filter.models.channel import Channel
        
        original_channels = filter_engine.channels.copy()
        try:
            ch1 = Channel(id="ch_mock1", name="Test 1", languages=["English"], categories=["News"], country="US")
            ch2 = Channel(id="ch_mock2", name="Test 2", languages=["Spanish"], categories=["Movies"], country="MX")
            filter_engine.load_channels([ch1, ch2])
            
            # Exclude languages
            res = filter_engine.apply_filters(languages=["English"], exclude_languages=True)
            self.assertEqual(len(res), 1)
            self.assertEqual(res[0].id, "ch_mock2")
            
            # Exclude categories
            res = filter_engine.apply_filters(categories=["News"], exclude_categories=True)
            self.assertEqual(len(res), 1)
            self.assertEqual(res[0].id, "ch_mock2")
            
            # Exclude countries
            res = filter_engine.apply_filters(countries=["US"], exclude_countries=True)
            self.assertEqual(len(res), 1)
            self.assertEqual(res[0].id, "ch_mock2")
        finally:
            filter_engine.load_channels(original_channels)

    def test_bulk_favorites(self):
        # 1. Bulk Add favorites
        response = self.app.post('/api/favorites/bulk-update',
                                 data=json.dumps({"channel_ids": ["ch_mock1", "ch_mock2"], "action": "add"}),
                                 content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data.get("success"))
        self.assertIn("ch_mock1", data.get("favorites"))
        self.assertIn("ch_mock2", data.get("favorites"))

        # 2. Bulk Remove favorites
        response = self.app.post('/api/favorites/bulk-update',
                                 data=json.dumps({"channel_ids": ["ch_mock1"], "action": "remove"}),
                                 content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data.get("success"))
        self.assertNotIn("ch_mock1", data.get("favorites"))
        self.assertIn("ch_mock2", data.get("favorites"))

    def test_active_playlist_endpoints(self):
        # 1. Get active playlist (should return empty initially or some active)
        response = self.app.get('/api/playlists/active')
        self.assertEqual(response.status_code, 200)

        # 2. Clear all favorites
        response = self.app.post('/api/favorites/clear-all')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data.get("success"))

        # 3. Download favorites M3U
        response = self.app.get('/api/playlists/download-favorites')
        self.assertEqual(response.status_code, 200)

    def test_upload_multiple_playlists(self):
        import io
        file1 = (io.BytesIO(b"#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://example.com/stream1.m3u8"), "test_file_upload1.m3u")
        file2 = (io.BytesIO(b"#EXTM3U\n#EXTINF:-1,Channel 2\nhttp://example.com/stream2.m3u8"), "test_file_upload2.m3u")
        
        response = self.app.post('/api/playlists/upload-multiple',
                                 data={"files": [file1, file2]},
                                 content_type='multipart/form-data')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data.get("success"))
        self.assertEqual(len(data.get("added_playlists", [])), 2)

if __name__ == "__main__":
    unittest.main()


