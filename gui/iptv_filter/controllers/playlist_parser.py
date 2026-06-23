from typing import Dict, List, Any
import os
import re
from iptv_filter.models.channel import Channel
from iptv_filter.models.feed import Feed
from iptv_filter.models.stream import Stream
from iptv_filter.models.playlist import Playlist
from iptv_filter.utils.language_groups import get_language_group
from iptv_filter.utils.countries_map import COUNTRIES_MAP
import requests

class DataProcessor:
    def __init__(self):
        self.language_map = {}
        self.language_code_map = {}

    def process_data(self, api_data: Dict[str, Any]) -> Playlist:
        playlist = Playlist()

        raw_channels = api_data.get("channels", [])
        raw_feeds = api_data.get("feeds", [])
        raw_streams = api_data.get("streams", [])
        raw_languages = api_data.get("languages", [])

        # Build language lookup
        for l in raw_languages:
            code = l.get("code")
            name = l.get("name")
            if code and name:
                self.language_map[code] = name
                self.language_code_map[name] = code

        streams_by_channel = {}
        for s in raw_streams:
            ch_id = s.get("channel")
            if ch_id:
                streams_by_channel.setdefault(ch_id, []).append(s)

        feeds_by_channel = {}
        for f in raw_feeds:
            ch_id = f.get("channel")
            if ch_id:
                feeds_by_channel.setdefault(ch_id, []).append(f)

        for c in raw_channels:
            ch_id = c.get("id")
            if not ch_id:
                continue

            country_code = c.get("country", "")
            country_name = COUNTRIES_MAP.get(country_code.lower(), country_code) if country_code else ""

            channel = Channel(
                id=ch_id,
                name=c.get("name", ""),
                alt_names=c.get("alt_names", []),
                network=c.get("network"),
                owners=c.get("owners", []),
                country=country_name,
                categories=c.get("categories", []),
                is_nsfw=c.get("is_nsfw", False),
                launched=c.get("launched"),
                closed=c.get("closed"),
                replaced_by=c.get("replaced_by"),
                website=c.get("website")
            )

            channel.streams = streams_by_channel.get(ch_id, [])

            channel_feeds = feeds_by_channel.get(ch_id, [])
            langs = set()
            for f in channel_feeds:
                for l in f.get("languages", []):
                    # Store original code for filtering, and map to display string
                    display_lang = self.language_map.get(l, l)
                    langs.add(display_lang)
            channel.languages = list(langs)

            playlist.add_channel(channel)

        return playlist

    def process_m3u(self, m3u_content: str) -> Playlist:
        playlist = Playlist()

        lines = m3u_content.splitlines()
        current_channel = None
        current_vlcopts = {}

        for line in lines:
            line = line.strip()
            if not line:
                continue

            if line.startswith("#EXTINF:"):
                current_vlcopts = {}
                meta = line[8:]
                name = ""
                if "," in meta:
                    meta_parts = meta.split(",", 1)
                    meta = meta_parts[0]
                    name = meta_parts[1].strip()

                ch_id = f"m3u_{len(playlist.channels)}"
                country = ""
                categories = []

                id_match = re.search(r'tvg-id="([^"]+)"', meta)
                if id_match:
                    ch_id = id_match.group(1)

                country_match = re.search(r'tvg-country="([^"]+)"', meta)
                if country_match:
                    country_code = country_match.group(1)
                    country = COUNTRIES_MAP.get(country_code.lower(), country_code)

                group_match = re.search(r'group-title="([^"]+)"', meta)
                if group_match:
                    categories = [group_match.group(1)]

                current_channel = Channel(
                    id=ch_id,
                    name=name or ch_id,
                    country=country,
                    categories=categories
                )

            elif line.startswith("#EXTVLCOPT:"):
                opt = line[11:].strip()
                if opt.startswith("http-user-agent="):
                    current_vlcopts["user_agent"] = opt[16:]
                elif opt.startswith("http-referrer="):
                    current_vlcopts["referrer"] = opt[14:]
            elif line.startswith("#"):
                pass
            else:
                if current_channel:
                    stream_obj = {"url": line}
                    if current_vlcopts:
                        stream_obj.update(current_vlcopts)
                    current_channel.streams.append(stream_obj)
                    playlist.add_channel(current_channel)
                    current_channel = None
                    current_vlcopts = {}

        return playlist

    def load_m3u_file(self, filepath: str) -> Playlist:
        with open(filepath, 'r', encoding='utf-8') as f:
            return self.process_m3u(f.read())

    def load_m3u_url(self, url: str) -> Playlist:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return self.process_m3u(response.text)
