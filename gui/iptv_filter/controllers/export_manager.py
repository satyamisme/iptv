import os
import json
import csv
import shutil
from typing import List
from iptv_filter.models.channel import Channel

class ExportManager:
    @staticmethod
    def _sort_channels(channels: List[Channel], sort_order: str = "default") -> List[Channel]:
        if not sort_order or sort_order == "original":
            return channels
            
        if sort_order == "name_asc":
            return sorted(channels, key=lambda ch: (ch.name or "").strip().lower())
        elif sort_order == "name_desc":
            return sorted(channels, key=lambda ch: (ch.name or "").strip().lower(), reverse=True)
        elif sort_order == "country_asc":
            return sorted(channels, key=lambda ch: (ch.country or "").strip().lower())
        elif sort_order == "category_asc":
            return sorted(channels, key=lambda ch: (ch.categories[0] if ch.categories else "undefined").strip().lower())
        elif sort_order == "language_asc":
            return sorted(channels, key=lambda ch: (ch.languages[0] if ch.languages else "undefined").strip().lower())

        # Default behavior:
        # Load custom/config.json to sort channels if exists
        preferred_languages = []
        category_order = []
        config_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "custom", "config.json"))
        if os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config_data = json.load(f)
                    preferred_languages = [l.strip().lower() for l in config_data.get("preferredLanguages", [])]
                    category_order = [c.strip().lower() for c in config_data.get("categoryOrder", [])]
            except Exception as e:
                print(f"Error loading config for export sorting: {e}")

        def get_sort_key(ch: Channel):
            # 1. Preferred language score
            lang_score = 9999
            if ch.languages:
                for i, pref_lang in enumerate(preferred_languages):
                    if any(l.strip().lower() == pref_lang for l in ch.languages):
                        lang_score = i
                        break
                if lang_score == 9999:
                    lang_score = 1000
                    
            # 2. Language name alphabetical
            lang_name = ch.languages[0].strip().lower() if ch.languages else 'undefined'
            
            # 3. Preferred category score
            cat_score = 9999
            if ch.categories:
                for i, pref_cat in enumerate(category_order):
                    if any(c.strip().lower() == pref_cat for c in ch.categories):
                        cat_score = i
                        break
                if cat_score == 9999:
                    cat_score = 1000
                    
            # 4. Category name alphabetical
            cat_name = ch.categories[0].strip().lower() if ch.categories else 'undefined'
            
            # 5. Channel name alphabetical
            ch_name = ch.name.strip().lower() if ch.name else ''
            
            return (lang_score, lang_name, cat_score, cat_name, ch_name)

        return sorted(channels, key=get_sort_key)

    @staticmethod
    def export_m3u(filepath: str, channels: List[Channel], append: bool = False, sort_order: str = "default"):
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)

        channels = ExportManager._sort_channels(channels, sort_order)

        temp_filepath = filepath + ".tmp"
        
        # If append is True and original file exists, copy it to temp file first
        if append and os.path.exists(filepath):
            try:
                shutil.copy2(filepath, temp_filepath)
            except Exception as e:
                # Fallback to direct writing if copy fails
                temp_filepath = filepath
        
        mode = 'a' if (append and temp_filepath != filepath) else 'w'
        
        # Determine if header should be written
        if append and os.path.exists(filepath):
            try:
                write_header = os.path.getsize(filepath) == 0
            except:
                write_header = True
        else:
            write_header = True

        try:
            with open(temp_filepath, mode, encoding='utf-8') as f:
                if write_header:
                    f.write("#EXTM3U\n")
                elif append:
                    f.write("\n")

                for ch in channels:
                    if not ch.streams:
                        continue

                    for stream in ch.streams:
                        attrs = []
                        attrs.append(f'tvg-id="{ch.id}"')
                        if ch.country:
                            attrs.append(f'tvg-country="{ch.country}"')
                        
                        # Set group-title to Language - Category grouping
                        lang_name = ch.languages[0].strip() if ch.languages else ''
                        cat_name = ch.categories[0].strip() if ch.categories else ''
                        if lang_name and cat_name:
                            group_title = f"{lang_name} - {cat_name}"
                        elif cat_name:
                            group_title = cat_name
                        else:
                            group_title = lang_name or "Undefined"
                            
                        attrs.append(f'group-title="{group_title}"')

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
                        
            # If we wrote to a temp file, rename/replace it to the final filepath
            if temp_filepath != filepath:
                if os.path.exists(filepath):
                    os.replace(temp_filepath, filepath)
                else:
                    os.rename(temp_filepath, filepath)
        except Exception as e:
            # Clean up temp file if it exists and wasn't renamed
            if temp_filepath != filepath and os.path.exists(temp_filepath):
                try:
                    os.remove(temp_filepath)
                except:
                    pass
            raise e

    @staticmethod
    def export_json(filepath: str, channels: List[Channel], sort_order: str = "default"):
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
        channels = ExportManager._sort_channels(channels, sort_order)

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
    def export_csv(filepath: str, channels: List[Channel], sort_order: str = "default"):
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
        channels = ExportManager._sort_channels(channels, sort_order)

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
