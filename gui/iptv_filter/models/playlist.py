from typing import List, Dict
from .channel import Channel

class Playlist:
    def __init__(self):
        self.channels: List[Channel] = []
        self.channel_lookup: Dict[str, Channel] = {}

    def add_channel(self, channel: Channel):
        self.channels.append(channel)
        self.channel_lookup[channel.id] = channel

    def get_channel(self, channel_id: str) -> Channel:
        return self.channel_lookup.get(channel_id)

    def clear(self):
        self.channels.clear()
        self.channel_lookup.clear()
