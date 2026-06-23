import os
import json
import csv
from typing import List
from iptv_filter.models.channel import Channel

class ExportManager:
    @staticmethod
    def export_m3u(filepath: str, channels: List[Channel], append: bool = False):
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)

        mode = 'a' if append else 'w'

        with open(filepath, mode, encoding='utf-8') as f:
            if not append or os.path.getsize(filepath) == 0:
                f.write("#EXTM3U\n")
            else:
                f.write("\n")

            for ch in channels:
                if not ch.streams:
                    continue

                for stream in ch.streams:
                    attrs = []
                    attrs.append(f'tvg-id="{ch.id}"')
                    if ch.country:
                        attrs.append(f'tvg-country="{ch.country}"')
                    if ch.categories:
                        attrs.append(f'group-title="{ch.categories[0]}"')

                    attr_str = " ".join(attrs)
                    f.write(f'#EXTINF:-1 {attr_str},{ch.name}\n')

                    if stream.get("user_agent") or stream.get("referrer"):
                        vlcopts = []
                        if stream.get("user_agent"):
                            vlcopts.append(f'#EXTVLCOPT:http-user-agent={stream["user_agent"]}')
                        if stream.get("referrer"):
                            vlcopts.append(f'#EXTVLCOPT:http-referrer={stream["referrer"]}')
                        f.write("\n".join(vlcopts) + "\n")

                    f.write(f"{stream.get('url')}\n")

    @staticmethod
    def export_json(filepath: str, channels: List[Channel]):
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)

        data = []
        for ch in channels:
            ch_dict = {
                "id": ch.id,
                "name": ch.name,
                "country": ch.country,
                "categories": ch.categories,
                "languages": ch.languages,
                "status": ch.status_text,
                "streams": ch.streams
            }
            data.append(ch_dict)

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    @staticmethod
    def export_csv(filepath: str, channels: List[Channel]):
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)

        with open(filepath, 'w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(["ID", "Name", "Country", "Categories", "Languages", "Status", "Stream URL"])

            for ch in channels:
                url = ch.streams[0].get("url") if ch.streams else ""
                writer.writerow([
                    ch.id,
                    ch.name,
                    ch.country,
                    ", ".join(ch.categories),
                    ", ".join(ch.languages),
                    ch.status_text,
                    url
                ])
